import { BOARDS } from "@ext/lib/config";
import { KarjooApi } from "@ext/lib/api-client";
import {
  getApiOrigin,
  getNotifiedBlockedAt,
  getOrCreateExecutorId,
  getSessionToken,
  getInterventionTabId,
  setInterventionTabId,
  clearInterventionTabId,
  setAutoApplyStatus,
  setNotifiedBlockedAt,
} from "@ext/lib/storage";
import {
  AUTO_APPLY_ALARM,
  politenessDelayMs,
  SESSION_REFRESH_ALARM,
  SESSION_REFRESH_MINUTES,
} from "@ext/lib/auto-apply-config";
import { buildApplyPlan, applyValuesFor } from "@ext/lib/apply-runner";
import { buildApplyResultReport } from "@ext/lib/apply-result-payload";
import { planUsesVault, type ApplyQueueItem, type AutoApplyStatus, type ExtensionRunOverview } from "@ext/lib/types";
import { refreshAllBoardSessions } from "@ext/background/session-refresh";
import { sendToTab, waitForTabComplete } from "@ext/background/tab-utils";
import type { ContentApplyResult, ContentDiscoveryResult } from "@ext/lib/messages";
import { discoverJobvisionListings } from "@ext/lib/jobvision-discovery";
import { discoverEEstekhdamListings } from "@ext/lib/eestekhdam-discovery";
import { discoverIranTalentListings } from "@ext/lib/irantalent-discovery";
import { readIranTalentAuthorization } from "@ext/lib/irantalent-session";

let activeCycle: Promise<AutoApplyStatus> | null = null;

export function setupAutoApplyAlarms(): void {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  chrome.alarms.create(AUTO_APPLY_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(SESSION_REFRESH_ALARM, { periodInMinutes: SESSION_REFRESH_MINUTES });
}

export function registerAutoApplyAlarmListener(): void {
  if (typeof chrome === "undefined" || !chrome.alarms?.onAlarm) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    // An alarm callback has nobody to catch for it: an unhandled rejection here
    // surfaces as "Uncaught (in promise)" in the service worker and kills the
    // tick. A transient 502 from a control-plane deploy must never do that.
    if (alarm.name === AUTO_APPLY_ALARM) void runAutoApplyTick().catch(logTickFailure);
    else if (alarm.name === SESSION_REFRESH_ALARM) {
      void runSessionRefreshTick().catch(logTickFailure);
    }
  });
}

async function apiOrNull(): Promise<KarjooApi | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return new KarjooApi({ origin: await getApiOrigin(), token });
}

async function record(status: AutoApplyStatus): Promise<AutoApplyStatus> {
  await setAutoApplyStatus(status);
  return status;
}

export async function getRunOverview(): Promise<ExtensionRunOverview | null> {
  const api = await apiOrNull();
  return api ? api.getExecutionRun() : null;
}

export async function mutateRun(
  action: "start" | "takeover" | "pause" | "stop",
  backgroundEnabled = true,
): Promise<ExtensionRunOverview> {
  const api = await apiOrNull();
  if (!api) throw new Error("افزونه هنوز به کارجو متصل نیست.");
  const executorId = await getOrCreateExecutorId();
  const overview = await api.mutateExecutionRun({
    action,
    executorId,
    ...((action === "start" || action === "takeover") ? { backgroundEnabled } : {}),
  });
  if (action === "start" || action === "takeover") {
    await closeInterventionTab();
    void runAutoApplyTick(true).catch(logTickFailure);
  } else if (action === "pause" || action === "stop") {
    await closeInterventionTab();
  }
  return overview;
}

export async function setRunBackground(enabled: boolean): Promise<ExtensionRunOverview | null> {
  const api = await apiOrNull();
  if (!api) return null;
  const executorId = await getOrCreateExecutorId();
  const overview = await api.getExecutionRun();
  if (overview.run.owner !== "extension" || overview.run.executorId !== executorId) return overview;
  return api.mutateExecutionRun({ action: "heartbeat", executorId, backgroundEnabled: enabled });
}

export async function runAutoApplyTick(force = false): Promise<AutoApplyStatus> {
  if (activeCycle) return activeCycle;
  activeCycle = runCycle(force).finally(() => { activeCycle = null; });
  return activeCycle;
}

/**
 * Above this many pending tasks, a tick skips discovery entirely and spends its
 * whole life applying. Queueing more work when thousands are already waiting is
 * pure waste, and it is what made the panel sit on "discovering" forever.
 */
const DISCOVERY_QUEUE_CEILING = 300;

/** Wall-clock slice one tick may spend discovering, across ALL boards. */
const DISCOVERY_BUDGET_MS = 45_000;

/** Listings one board may collect in a single pass. */
const DISCOVERY_LISTING_CEILING = 300;

async function runCycle(force: boolean): Promise<AutoApplyStatus> {
  const ranAt = Date.now();
  try {
    const api = await apiOrNull();
    if (!api) return record({ ranAt, outcome: "not_paired", submitted: 0, failed: 0 });
    const executorId = await getOrCreateExecutorId();
    const overview = await api.getExecutionRun();
    await notifyBlockedRun(overview);
    if (
      overview.run.owner !== "extension" ||
      overview.run.executorId !== executorId ||
      overview.run.state !== "running" ||
      (!overview.run.backgroundEnabled && !force)
    ) {
      return record({ ranAt, outcome: "disabled", submitted: 0, failed: 0 });
    }
    const lastDiscoveryAt = Number(overview.run.progress.lastDiscoveryAt ?? 0);
    // A deep queue means discovery is not what this user needs — applying is.
    // Discovering anyway is what starved the apply loop: a board with thousands
    // of live ads kept every tick busy paginating while 6k tasks sat pending.
    const queueIsDeep = Number(overview.counts.queued ?? 0) >= DISCOVERY_QUEUE_CEILING;
    return discoverAndDrain(api, executorId, {
      backgroundEnabled: overview.run.backgroundEnabled,
      discoverDue:
        !queueIsDeep &&
        (force || !lastDiscoveryAt || Date.now() - lastDiscoveryAt >= 10 * 60_000),
      lastDiscoveryAt,
    });
  } catch (error) {
    return record({
      ranAt,
      outcome: "error",
      submitted: 0,
      failed: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function discoverAndDrain(
  api: KarjooApi,
  executorId: string,
  options: { backgroundEnabled: boolean; discoverDue: boolean; lastDiscoveryAt: number },
): Promise<AutoApplyStatus> {
  const ranAt = Date.now();
  let discovered = 0;
  let submitted = 0;
  let failed = 0;

  let lastDiscoveryAt = options.lastDiscoveryAt;
  // Discovery gets a wall-clock slice of the tick, shared across boards. Whatever
  // it has found when the budget runs out is imported and the run moves on to
  // applying; the next tick picks discovery up again.
  const discoveryDeadline = Date.now() + DISCOVERY_BUDGET_MS;
  const discovery = options.discoverDue ? await api.getDiscoveryConfig() : null;
  if (discovery && !discovery.paused) {
    for (const board of discovery.boards) {
      if (Date.now() >= discoveryDeadline) break;
      if (!board.enabled || !board.hasTargeting) continue;
      if (board.board === "jobinja" && board.searchUrl) {
        const result = await discoverJobinja(api, executorId, board.searchUrl, discovery.maxAgeDays);
        discovered += result.discovered;
        if (result.blocked) {
          return record({ ranAt, outcome: "error", submitted, failed, message: result.reason });
        }
      } else if (board.board === "jobvision") {
        const listings = await discoverJobvisionListings({
          categoryKeys: board.categoryKeys,
          employmentTypeKeys: board.employmentTypeKeys,
          remoteOnly: board.remoteOnly,
          maxAgeDays: discovery.maxAgeDays,
          deadlineAt: discoveryDeadline,
          maxListings: DISCOVERY_LISTING_CEILING,
        }, fetch, async (count) => {
          await api.mutateExecutionRun({
            action: "progress",
            executorId,
            progress: { stage: "discovering", board: "jobvision", discovered: discovered + count },
          });
        });
        for (let index = 0; index < listings.length; index += 100) {
          const imported = await api.importDiscoveredListings("jobvision", listings.slice(index, index + 100));
          discovered += imported.ingested;
        }
      } else if (board.board === "e-estekhdam") {
        const listings = await discoverEEstekhdamListings({
          categoryKeys: board.categoryKeys,
          cities: board.cities,
          employmentTypeKeys: board.employmentTypeKeys,
          remoteOnly: board.remoteOnly,
          maxAgeDays: discovery.maxAgeDays,
          deadlineAt: discoveryDeadline,
          maxListings: DISCOVERY_LISTING_CEILING,
        }, fetch, async (count) => {
          await api.mutateExecutionRun({
            action: "progress",
            executorId,
            progress: {
              stage: "discovering",
              board: "e-estekhdam",
              discovered: discovered + count,
            },
          });
        });
        for (let index = 0; index < listings.length; index += 100) {
          const imported = await api.importDiscoveredListings(
            "e-estekhdam",
            listings.slice(index, index + 100),
          );
          discovered += imported.ingested;
        }
      } else if (board.board === "irantalent") {
        // The bearer token only makes IranTalent return this user's own
        // `is_applied` flags; discovery still works signed out.
        const authorization = await readIranTalentAuthorization();
        const listings = await discoverIranTalentListings({
          categoryKeys: board.categoryKeys,
          employmentTypeKeys: board.employmentTypeKeys,
          remoteOnly: board.remoteOnly,
          maxAgeDays: discovery.maxAgeDays,
          authorization,
          deadlineAt: discoveryDeadline,
          maxListings: DISCOVERY_LISTING_CEILING,
        }, fetch, async (count) => {
          await api.mutateExecutionRun({
            action: "progress",
            executorId,
            progress: {
              stage: "discovering",
              board: "irantalent",
              discovered: discovered + count,
            },
          });
        });
        for (let index = 0; index < listings.length; index += 100) {
          const imported = await api.importDiscoveredListings(
            "irantalent",
            listings.slice(index, index + 100),
          );
          discovered += imported.ingested;
        }
      }
    }
    lastDiscoveryAt = Date.now();
  }

  for (;;) {
    await api.mutateExecutionRun({
      action: "heartbeat",
      executorId,
    });
    await api.mutateExecutionRun({
      action: "progress",
      executorId,
      progress: { stage: "claiming", discovered, submitted, failed, lastDiscoveryAt },
    });
    const claim = await api.claimQueue(1, executorId);
    if (
      claim.reason === "tailored_resume_generation_failed" ||
      claim.reason === "tailored_resume_missing"
    ) {
      await api.mutateExecutionRun({
        action: "block",
        executorId,
        reason: claim.reason,
      });
      await notify(
        "ساخت رزومه متوقف شد",
        "رزومهٔ اختصاصی آماده نشد. هیچ رزومه‌ای برای جابینجا ارسال نشد.",
      );
      return record({ ranAt, outcome: "error", submitted, failed, message: claim.reason });
    }
    const item = claim.items[0];
    if (!item) {
      if (options.backgroundEnabled) {
        await api.mutateExecutionRun({
          action: "progress",
          executorId,
          progress: { stage: "waiting", discovered, submitted, failed, lastDiscoveryAt },
        });
      } else {
        await api.mutateExecutionRun({ action: "complete", executorId });
      }
      return record({
        ranAt,
        outcome: submitted > 0 ? "applied" : "empty",
        submitted,
        failed,
        message: discovered > 0 ? `${discovered} آگهی بررسی شد.` : undefined,
      });
    }

    await api.mutateExecutionRun({
      action: "progress",
      executorId,
      currentTaskId: item.id,
      progress: {
        stage: "applying",
        title: item.jobTitle,
        company: item.company ?? "",
        discovered,
        submitted,
        failed,
        lastDiscoveryAt,
      },
    });

    const result = await applyOne(api, executorId, item, {
      discovered,
      submitted,
      failed,
      lastDiscoveryAt,
    });
    if (!result.ok && isBlockingReason(result.reason)) {
      const reason = result.reason ?? "jobinja_security_check";
      await api.mutateExecutionRun({ action: "block", executorId, taskId: item.id, reason });
      await notify(
        "اپلای متوقف شد",
        "سایت کاریابی نیاز به ورود، تکمیل فرم یا تایید امنیتی دارد. صف حفظ شد.",
      );
      return record({ ranAt, outcome: "error", submitted, failed, message: reason });
    }

    const report = buildApplyResultReport({
      id: item.id,
      status: result.alreadyApplied ? "skipped" : result.ok ? "submitted" : "failed",
      ...(result.alreadyApplied ? { reason: "already_applied_on_board" } : {}),
      ...(!result.ok && result.reason ? { reason: result.reason } : {}),
    });
    await api.reportResult(report, executorId);
    if (result.ok && !result.alreadyApplied) submitted += 1;
    else if (!result.ok) failed += 1;
    await new Promise((resolve) => setTimeout(resolve, politenessDelayMs()));
  }
}

async function discoverJobinja(
  api: KarjooApi,
  executorId: string,
  firstUrl: string,
  maxAgeDays: number,
): Promise<{ discovered: number; blocked: boolean; reason?: string }> {
  let url: string | null = firstUrl;
  let discovered = 0;
  const visited = new Set<string>();
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  let tab: chrome.tabs.Tab | undefined;

  let retainTab = false;
  try {
    while (url && !visited.has(url)) {
      visited.add(url);
      tab = tab?.id
        ? await chrome.tabs.update(tab.id, { url, active: false })
        : await chrome.tabs.create({ url, active: false });
      if (!tab.id) throw new Error("could not open Jobinja discovery tab");
      await waitForTabComplete(tab.id);
      const page: ContentDiscoveryResult = await sendToTab<ContentDiscoveryResult>(
        tab.id,
        { type: "CONTENT_DISCOVER_JOBINJA" },
      );
      if (page.securityChallenge || page.loginRequired) {
        const reason = page.securityChallenge ? "jobinja_security_check: discovery blocked" : "jobinja_login_required: discovery blocked";
        await api.mutateExecutionRun({ action: "block", executorId, reason });
        retainTab = true;
        await retainInterventionTab(tab.id);
        await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
        await notify("کشف شغل متوقف شد", "صفحهٔ جابینجا را بررسی و ورود/تایید امنیتی را تکمیل کنید.");
        return { discovered, blocked: true, reason };
      }
      if (page.listings.length > 0) {
        const imported = await api.importDiscoveredListings("jobinja", page.listings);
        discovered += imported.ingested;
      }
      await api.mutateExecutionRun({
        action: "progress",
        executorId,
        progress: {
          stage: "discovering",
          discovered,
          bulkApplyAvailable: page.bulkApplyAvailable,
          lastDiscoveryAt: Date.now(),
        },
      });
      if (page.oldestPostedAt && new Date(page.oldestPostedAt).getTime() < cutoff) break;
      url = page.nextUrl;
    }
    return { discovered, blocked: false };
  } finally {
    if (tab?.id && !retainTab) await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

async function applyOne(
  api: KarjooApi,
  executorId: string,
  item: ApplyQueueItem,
  progress: Record<string, unknown>,
): Promise<ContentApplyResult> {
  if (item.resumeStrategy === "tailored_pdf" && !item.resume) {
    return { ok: false, ranSteps: [], reason: "tailored_resume_missing" };
  }
  let managed: { tab: chrome.tabs.Tab; created: boolean } | null = null;
  let retainTab = false;
  try {
    let preparedItem = item;
    if (item.resumeStrategy === "tailored_pdf" && item.resume) {
      await api.mutateExecutionRun({
        action: "progress",
        executorId,
        currentTaskId: item.id,
        progress: { ...progress, stage: "downloading_resume", title: item.jobTitle, company: item.company ?? "" },
      });
      const resume = await api.downloadTaskResume(item.resume.downloadUrl);
      preparedItem = {
        ...item,
        resume: { ...item.resume, dataUrl: resume.dataUrl, fileName: resume.fileName },
      };
    }
    const plan = buildApplyPlan(preparedItem, applyValuesFor(preparedItem));
    if (!plan) return { ok: false, ranSteps: [], reason: "no apply spec for board" };

    await api.mutateExecutionRun({
      action: "progress",
      executorId,
      currentTaskId: item.id,
      progress: { ...progress, stage: "opening_job", title: item.jobTitle, company: item.company ?? "" },
    });
    managed = await ensureManagedTab(item.jobUrl, BOARDS[item.board]?.origin ?? item.jobUrl);
    if (!managed.tab.id) throw new Error("could not open the job page");
    await waitForTabComplete(managed.tab.id);
    await api.mutateExecutionRun({
      action: "progress",
      executorId,
      currentTaskId: item.id,
      progress: { ...progress, stage: item.resumeStrategy === "tailored_pdf" ? "uploading_resume" : "applying", title: item.jobTitle, company: item.company ?? "" },
    });
    const result = await sendToTab<ContentApplyResult>(managed.tab.id, {
      type: "CONTENT_APPLY",
      plan,
    });
    if (!result.ok && isBlockingReason(result.reason) && managed.created) {
      retainTab = true;
      await retainInterventionTab(managed.tab.id);
      await chrome.tabs.update(managed.tab.id, { active: true }).catch(() => undefined);
    }
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      ranSteps: [],
      reason: /resume download/i.test(reason) ? `resume_download_failed: ${reason}` : reason,
    };
  } finally {
    if (managed?.tab.id && shouldCloseManagedTab(managed.created, retainTab)) {
      await chrome.tabs.remove(managed.tab.id).catch(() => undefined);
    }
  }
}

/**
 * Reasons that stop the WHOLE run because only the user can clear them (a login,
 * a captcha, an unverified account). Per-task problems — a closed job, a failed
 * upload, an unconfirmed submit — are recorded against that task and the run
 * continues with the next one.
 */
function isBlockingReason(reason?: string): boolean {
  return Boolean(
    reason &&
      /(jobinja_(security_check|login_required)|jobvision_(login_required|captcha_required|security_challenge|resume_setup_required)|eestekhdam_(login_required|captcha_required|security_challenge|form_unavailable|position_required|external_form_required|session_incomplete)|irantalent_(login_required|security_challenge|account_unverified)|tailored_resume_|(?<![a-z_])resume_(render|download|upload)_failed)/.test(
        reason,
      ),
  );
}

async function notifyBlockedRun(overview: ExtensionRunOverview): Promise<void> {
  const blockedAt = overview.run.blockedAt;
  if (overview.run.state !== "blocked" || !blockedAt || blockedAt === await getNotifiedBlockedAt()) return;
  await setNotifiedBlockedAt(blockedAt);
  await notify(
    "اپلای سرور متوقف شد",
    "سایت کاریابی اجرای سرور را محدود کرد. افزونه را باز و «ادامه با افزونه» را بزنید.",
  );
}

async function notify(title: string, message: string): Promise<void> {
  if (!chrome.notifications) return;
  await chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
    title,
    message,
  });
}

export async function runSessionRefreshTick(): Promise<void> {
  try {
    const api = await apiOrNull();
    if (!api) return;
    await refreshAllBoardSessions(api, { pushToVault: planUsesVault(await api.getPlan()) });
  } catch (error) {
    // Session refresh is best-effort upkeep; a failed tick just waits for the
    // next alarm rather than taking down the worker.
    logTickFailure(error);
  }
}

/** Record a background tick failure without letting it escape as unhandled. */
function logTickFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("[karjoo] background tick failed; will retry on the next alarm:", message);
}

async function ensureManagedTab(
  jobUrl: string,
  origin: string,
): Promise<{ tab: chrome.tabs.Tab; created: boolean }> {
  const existing = await chrome.tabs.query({ url: `${origin}/*` });
  const match = existing.find((tab) => tab.url && sameJob(tab.url, jobUrl));
  if (match?.id !== undefined) {
    await chrome.tabs.update(match.id, { active: false });
    return { tab: match, created: false };
  }
  const tab = await chrome.tabs.create({ url: jobUrl, active: false });
  return { tab, created: true };
}

async function retainInterventionTab(tabId: number): Promise<void> {
  const previous = await getInterventionTabId();
  if (previous !== null && previous !== tabId) {
    await chrome.tabs.remove(previous).catch(() => undefined);
  }
  await setInterventionTabId(tabId);
}

async function closeInterventionTab(): Promise<void> {
  const tabId = await getInterventionTabId();
  if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => undefined);
  await clearInterventionTabId();
}

function sameJob(a: string, b: string): boolean {
  try {
    const first = new URL(a);
    const second = new URL(b);
    return first.origin === second.origin && first.pathname === second.pathname;
  } catch {
    return a === b;
  }
}

/** Close only tabs opened by this executor; keep one only for required user intervention. */
export function shouldCloseManagedTab(created: boolean, retainedForIntervention: boolean): boolean {
  return created && !retainedForIntervention;
}
