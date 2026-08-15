import { BOARDS } from "@ext/lib/config";
import { KarjooApi } from "@ext/lib/api-client";
import {
  getApiOrigin,
  getNotifiedBlockedAt,
  getOrCreateExecutorId,
  getSessionToken,
  setAutoApplyStatus,
  setNotifiedBlockedAt,
} from "@ext/lib/storage";
import {
  AUTO_APPLY_ALARM,
  SESSION_REFRESH_ALARM,
  SESSION_REFRESH_MINUTES,
} from "@ext/lib/auto-apply-config";
import { buildApplyPlan, applyValuesFor } from "@ext/lib/apply-runner";
import { buildApplyResultReport } from "@ext/lib/apply-result-payload";
import { planUsesVault, type ApplyQueueItem, type AutoApplyStatus, type ExtensionRunOverview } from "@ext/lib/types";
import { refreshAllBoardSessions } from "@ext/background/session-refresh";
import { sendToTab, waitForTabComplete } from "@ext/background/tab-utils";
import type { ContentApplyResult, ContentDiscoveryResult } from "@ext/lib/messages";

let activeCycle: Promise<AutoApplyStatus> | null = null;

export function setupAutoApplyAlarms(): void {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  chrome.alarms.create(AUTO_APPLY_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(SESSION_REFRESH_ALARM, { periodInMinutes: SESSION_REFRESH_MINUTES });
}

export function registerAutoApplyAlarmListener(): void {
  if (typeof chrome === "undefined" || !chrome.alarms?.onAlarm) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_APPLY_ALARM) void runAutoApplyTick();
    else if (alarm.name === SESSION_REFRESH_ALARM) void runSessionRefreshTick();
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
    void runAutoApplyTick(true);
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
    return discoverAndDrain(api, executorId, {
      backgroundEnabled: overview.run.backgroundEnabled,
      discoverDue: force || !lastDiscoveryAt || Date.now() - lastDiscoveryAt >= 10 * 60_000,
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
  const discovery = options.discoverDue ? await api.getDiscoveryConfig() : null;
  if (discovery && !discovery.paused && discovery.hasTargeting && discovery.searchUrl) {
    const result = await discoverJobinja(api, executorId, discovery.searchUrl, discovery.maxAgeDays);
    lastDiscoveryAt = Date.now();
    discovered = result.discovered;
    if (result.blocked) {
      return record({ ranAt, outcome: "error", submitted, failed, message: result.reason });
    }
  }

  for (;;) {
    await api.mutateExecutionRun({
      action: "heartbeat",
      executorId,
    });
    const claim = await api.claimQueue(1, executorId);
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

    const result = await applyOne(item);
    if (!result.ok && isBlockingReason(result.reason)) {
      const reason = result.reason ?? "jobinja_security_check";
      await api.mutateExecutionRun({ action: "block", executorId, taskId: item.id, reason });
      await notify("اپلای متوقف شد", "جابینجا نیاز به ورود یا تایید امنیتی دارد. صف حفظ شد.");
      return record({ ranAt, outcome: "error", submitted, failed, message: reason });
    }

    const report = buildApplyResultReport({
      id: item.id,
      status: result.ok ? "submitted" : "failed",
      ...(!result.ok && result.reason ? { reason: result.reason } : {}),
    });
    await api.reportResult(report, executorId);
    if (result.ok) submitted += 1;
    else failed += 1;
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
      await api.mutateExecutionRun({
        action: "block",
        executorId,
        reason,
      });
      await notify("کشف شغل متوقف شد", "صفحهٔ جابینجا را بررسی و ورود/تایید امنیتی را تکمیل کنید.");
      return { discovered, blocked: true, reason };
    }
    if (page.listings.length > 0) {
      const imported = await api.importDiscoveredListings(page.listings);
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
  if (tab?.id) await chrome.tabs.remove(tab.id).catch(() => undefined);
  return { discovered, blocked: false };
}

async function applyOne(item: ApplyQueueItem): Promise<ContentApplyResult> {
  const plan = buildApplyPlan(item, applyValuesFor(item));
  if (!plan) return { ok: false, ranSteps: [], reason: "no apply spec for board" };
  try {
    const tab = await ensureTab(item.jobUrl, BOARDS[item.board]?.origin ?? item.jobUrl);
    if (!tab?.id) throw new Error("could not open the job page");
    await waitForTabComplete(tab.id);
    return await sendToTab<ContentApplyResult>(tab.id, { type: "CONTENT_APPLY", plan });
  } catch (error) {
    return { ok: false, ranSteps: [], reason: error instanceof Error ? error.message : String(error) };
  }
}

function isBlockingReason(reason?: string): boolean {
  return Boolean(reason && /jobinja_(security_check|login_required)/.test(reason));
}

async function notifyBlockedRun(overview: ExtensionRunOverview): Promise<void> {
  const blockedAt = overview.run.blockedAt;
  if (overview.run.state !== "blocked" || !blockedAt || blockedAt === await getNotifiedBlockedAt()) return;
  await setNotifiedBlockedAt(blockedAt);
  await notify("اپلای سرور متوقف شد", "جابینجا سرور را محدود کرد. افزونه را باز و «ادامه با افزونه» را بزنید.");
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
  const api = await apiOrNull();
  if (!api) return;
  await refreshAllBoardSessions(api, { pushToVault: planUsesVault(await api.getPlan()) });
}

async function ensureTab(jobUrl: string, origin: string): Promise<chrome.tabs.Tab | undefined> {
  const existing = await chrome.tabs.query({ url: `${origin}/*` });
  const match = existing.find((tab) => tab.url && sameJob(tab.url, jobUrl));
  if (match?.id !== undefined) {
    await chrome.tabs.update(match.id, { active: false });
    return match;
  }
  return chrome.tabs.create({ url: jobUrl, active: false });
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
