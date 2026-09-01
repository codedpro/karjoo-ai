import { BOARDS } from "@ext/lib/config";
import { KarjooApi } from "@ext/lib/api-client";
import {
  getApiOrigin,
  getNotifiedBlockedAt,
  getOrCreateExecutorId,
  getSessionToken,
  getInterventionTabId,
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
    abortActiveCycle();
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

/**
 * Bumped by pause/stop. The in-flight cycle compares the generation it started
 * with against this and gives up at its next checkpoint, so pressing Stop halts
 * discovery now instead of after the current board finishes paginating.
 */
let cycleGeneration = 0;

export function abortActiveCycle(): void {
  cycleGeneration += 1;
}

/** Stop work based on old filters, then force a fresh discovery/drain pass. */
export function restartAfterFiltersChanged(): void {
  abortActiveCycle();
  const previous = activeCycle;
  void (async () => {
    if (previous) await previous.catch(logTickFailure);
    await runAutoApplyTick(true);
  })().catch(logTickFailure);
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

export function discoveryIsDue(input: {
  force: boolean;
  queueCount: number;
  lastDiscoveryAt: number;
  now?: number;
}): boolean {
  if (input.force) return true;
  if (input.queueCount >= DISCOVERY_QUEUE_CEILING) return false;
  return !input.lastDiscoveryAt ||
    (input.now ?? Date.now()) - input.lastDiscoveryAt >= 10 * 60_000;
}

async function runCycle(force: boolean): Promise<AutoApplyStatus> {
  const ranAt = Date.now();
  const generation = cycleGeneration;
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
    return discoverAndDrain(api, executorId, {
      aborted: () => cycleGeneration !== generation,
      backgroundEnabled: overview.run.backgroundEnabled,
      discoverDue: discoveryIsDue({
        force,
        queueCount: Number(overview.counts.queued ?? 0),
        lastDiscoveryAt,
      }),
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
  options: {
    backgroundEnabled: boolean;
    discoverDue: boolean;
    lastDiscoveryAt: number;
    /** True once the user pressed pause/stop — abandon the cycle promptly. */
    aborted: () => boolean;
  },
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
      if (options.aborted() || Date.now() >= discoveryDeadline) break;
      if (!board.enabled || !board.hasTargeting) continue;
      if (board.board === "jobinja" && board.searchUrl) {
        const result = await discoverJobinja(api, executorId, board.searchUrl, discovery.maxAgeDays);
        discovered += result.discovered;
        // A login/security page only makes this provider unavailable for this
        // discovery pass. It must not stop already-queued jobs on other sites.
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

  let sessionFailureStreak = 0;
  let resumeFailureStreak = 0;
  const boardFailureStreak = new Map<string, number>();
  /** Boards parked for the rest of this run after repeated refusals. */
  const parkedBoards = new Set<string>();
  for (;;) {
    if (options.aborted()) {
      return record({ ranAt, outcome: "disabled", submitted, failed });
    }
    await api.mutateExecutionRun({
      action: "heartbeat",
      executorId,
    });
    await api.mutateExecutionRun({
      action: "progress",
      executorId,
      progress: { stage: "claiming", discovered, submitted, failed, lastDiscoveryAt },
    });
    const claim = await api.claimQueue(1, executorId, [...parkedBoards]);
    if (claim.reason === "all_boards_parked") {
      await api.mutateExecutionRun({
        action: "progress",
        executorId,
        progress: { stage: "waiting", discovered, submitted, failed, lastDiscoveryAt },
      });
      return record({
        ranAt,
        outcome: submitted > 0 ? "applied" : "empty",
        submitted,
        failed,
        message: "all_boards_parked",
      });
    }
    if (
      claim.reason === "tailored_resume_generation_failed" ||
      claim.reason === "tailored_resume_missing"
    ) {
      // One listing's resume failing is not a reason to stop thousands of others.
      // The server already backs that task off for 30 minutes, so the next tick
      // picks a different one. Only a run of failures means something systemic
      // (no credit, AI down) that the user actually has to act on.
      // The platform's monthly AI budget is spent. No listing will tailor until
      // that is raised, so waiting quietly would leave the panel saying "nothing
      // in progress" forever with no way to learn why.
      if (claim.code === "ai_maintenance") {
        await api.mutateExecutionRun({ action: "block", executorId, reason: "ai_maintenance" });
        await notify(
          "ساخت رزومه ممکن نیست",
          "سقف ماهانهٔ سرویس هوش مصنوعی پر شده است. صف حفظ شده؛ پس از افزایش سقف دوباره شروع کنید.",
        );
        return record({ ranAt, outcome: "error", submitted, failed, message: "ai_maintenance" });
      }
      resumeFailureStreak += 1;
      if (resumeFailureStreak < RESUME_FAILURE_STREAK_LIMIT) {
        await api.mutateExecutionRun({
          action: "progress",
          executorId,
          progress: { stage: "waiting", discovered, submitted, failed, lastDiscoveryAt },
        });
        return record({
          ranAt,
          outcome: submitted > 0 ? "applied" : "empty",
          submitted,
          failed,
          message: claim.reason,
        });
      }
      await api.mutateExecutionRun({
        action: "block",
        executorId,
        reason: claim.reason,
      });
      await notify(
        "ساخت رزومه متوقف شد",
        "چند بار پشت‌سرهم رزومهٔ اختصاصی ساخته نشد. صف حفظ شده است.",
      );
      return record({ ranAt, outcome: "error", submitted, failed, message: claim.reason });
    }
    resumeFailureStreak = 0;
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
    const skipped = result.alreadyApplied || (!result.ok && isSkippableReason(result.reason));
    sessionFailureStreak =
      !result.ok && isSessionLevelReason(result.reason) ? sessionFailureStreak + 1 : 0;
    // Only genuine failures count — a skip means we chose not to submit.
    const hardFailure = !result.ok && !skipped;
    boardFailureStreak.set(
      item.board,
      hardFailure ? (boardFailureStreak.get(item.board) ?? 0) + 1 : 0,
    );
    const report = buildApplyResultReport({
      id: item.id,
      status: skipped ? "skipped" : result.ok ? "submitted" : "failed",
      ...(result.alreadyApplied ? { reason: "already_applied_on_board" } : {}),
      // A SUCCESS can carry a reason too: e-estekhdam may accept the application
      // with the account's own CV when its file limit blocks the tailored PDF.
      // Recording that is the difference between an honest history and one that
      // claims a tailored résumé was sent when it was not.
      ...(result.reason && !result.alreadyApplied ? { reason: result.reason } : {}),
    });
    await api.reportResult(report, executorId);
    if (result.ok && !result.alreadyApplied) submitted += 1;
    else if (!result.ok) failed += 1;

    // The board is refusing everything we send it. Park THAT board for the rest
    // of this run and carry on with the others — stopping the whole run meant one
    // board's outage also halted the boards that were working fine.
    if ((boardFailureStreak.get(item.board) ?? 0) >= BOARD_FAILURE_STREAK_LIMIT) {
      parkedBoards.add(item.board);
      await notify(
        "ارسال به این سایت متوقف شد",
        `چند درخواست پشت‌سرهم در ${item.board} رد شد. بقیهٔ سایت‌ها ادامه می‌دهند و صف حفظ شده است.`,
      );
    }

    // The session, not the ad, is the problem — stop before the queue is spent.
    if (sessionFailureStreak >= SESSION_FAILURE_STREAK_LIMIT) {
      const reason = result.reason ?? "login_required";
      await api.mutateExecutionRun({ action: "block", executorId, reason });
      await notify(
        "اپلای متوقف شد",
        "ورود به سایت کاریابی لازم است. وارد شوید و دوباره «شروع» را بزنید؛ صف حفظ شده است.",
      );
      return record({ ranAt, outcome: "error", submitted, failed, message: reason });
    }
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
    if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
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
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      ranSteps: [],
      reason: /resume download/i.test(reason) ? `resume_download_failed: ${reason}` : reason,
    };
  } finally {
    if (managed?.tab.id && shouldCloseManagedTab(managed.created, false)) {
      await chrome.tabs.remove(managed.tab.id).catch(() => undefined);
    }
  }
}

/**
 * A skippable reason that is about the SESSION rather than the ad.
 *
 * Skipping these is right for one job — the next ad may be on a board we are
 * still signed into. But if they keep coming back, the session itself is gone,
 * and skipping onward would march through thousands of queued tasks marking each
 * one skipped and pinging the board for nothing. `SESSION_FAILURE_STREAK_LIMIT`
 * is the safety valve: a few in a row ends the run instead of burning the queue.
 */
export function isSessionLevelReason(reason?: string): boolean {
  return Boolean(
    reason &&
      /(login_required|captcha_required|security_(check|challenge)|session_incomplete|resume_setup_required|account_unverified)/.test(
        reason,
      ),
  );
}

/**
 * Consecutive hard failures on ONE board before we stop applying to it.
 *
 * A board that has rejected the last several submissions is telling us something
 * — a daily cap, a rate limit, an account restriction. Continuing is both futile
 * and the fastest way to get the user's account restricted further: this queue
 * ran 76 consecutive failed submissions into a single board before anyone
 * noticed. Stop, surface the board's own message, and let the user decide.
 */
export const BOARD_FAILURE_STREAK_LIMIT = 5;

/**
 * Consecutive claims that could not produce a tailored resume before we stop.
 *
 * A single listing whose resume generation fails is normal — an odd job title,
 * an AI hiccup — and the server already delays that task by 30 minutes so the
 * next tick moves on to another. Blocking the whole run on the first one meant
 * two bad listings could halt a queue of five thousand.
 */
export const RESUME_FAILURE_STREAK_LIMIT = 4;

/** Consecutive session-level skips that mean "stop", not "keep skipping". */
export const SESSION_FAILURE_STREAK_LIMIT = 3;

/**
 * Conditions that cannot be completed automatically are terminal for this job,
 * not for the queue. Record them as skipped and immediately claim the next task.
 *
 * A skip must not consume a retry, which is why a closed or already-applied ad
 * belongs here: retrying it can never succeed, and leaving it as "failed" sent
 * the same dead listing round the queue again and again.
 */
export function isSkippableReason(reason?: string): boolean {
  return Boolean(
    reason &&
      /(login_required|captcha_required|security_(check|challenge)|form_unavailable|position_required|external_form_required|session_incomplete|resume_setup_required|account_unverified|screening_questions_required|relocation_confirmation_required|manual_action_required|job_unavailable|already_applied|gender_mismatch)/.test(
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
