/**
 * Background auto-apply orchestration (the impure half — chrome.* + network).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 GUARDRAILS (the point of this build):
 *   • A chrome.alarms job runs every AUTO_APPLY_ALARM_MINUTES. Each tick FIRST
 *     fetches the server-authoritative auto-apply settings. If the toggle is OFF
 *     (or no boards are connected, or the extension is not paired) the tick does
 *     NOTHING (decideTick → run:false). The toggle is the user's explicit,
 *     revocable consent.
 *   • It claims the user's pending, above-threshold queue (the server already
 *     gates by toggle + daily cap + threshold). If the server says the queue is
 *     gated (reason: 'disabled' | 'quota_exceeded') the tick stops.
 *   • For each eligible item it drives the per-board APPLY content script IN THE
 *     USER'S OWN BROWSER to fill + submit the public form, then reports the result.
 *     A 429 from the result endpoint = daily cap reached → stop the drain.
 *   • Politeness: a base + jitter delay between applies; a small per-tick budget.
 *   • Works with the popup CLOSED while the browser runs. It CANNOT run with the
 *     browser fully closed — that is the Max/Max+ worker tier (see README).
 *   • No detection-evasion anywhere.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The PURE decisions live in apply-runner.ts; this module is the thin adapter
 * that calls chrome.* / the API and sequences the runner's decisions.
 */
import { BOARDS, type BoardId } from "@ext/lib/config";
import { KarjooApi } from "@ext/lib/api-client";
import {
  getApiOrigin,
  getSessionToken,
  setAutoApplySettings,
  setAutoApplyStatus,
} from "@ext/lib/storage";
import {
  AUTO_APPLY_ALARM,
  AUTO_APPLY_ALARM_MINUTES,
  SESSION_REFRESH_ALARM,
  SESSION_REFRESH_MINUTES,
  MAX_APPLIES_PER_TICK,
  politenessDelayMs,
} from "@ext/lib/auto-apply-config";
import {
  decideTick,
  eligibleItems,
  shouldStopForClaim,
  shouldStopForCap,
  buildApplyPlan,
  applyValuesFor,
  type AutoApplyGate,
} from "@ext/lib/apply-runner";
import { buildApplyResultReport } from "@ext/lib/apply-result-payload";
import { planUsesVault, type AutoApplyStatus } from "@ext/lib/types";
import { refreshAllBoardSessions } from "@ext/background/session-refresh";
import type { ApplyQueueItem } from "@ext/lib/types";
import type { ContentApplyResult } from "@ext/lib/messages";

/* ── alarm setup (call once on startup/install) ────────────────────────────── */

/** Create the periodic alarms. Idempotent — chrome.alarms.create replaces. */
export function setupAutoApplyAlarms(): void {
  if (typeof chrome === "undefined" || !chrome.alarms) return;
  chrome.alarms.create(AUTO_APPLY_ALARM, { periodInMinutes: AUTO_APPLY_ALARM_MINUTES });
  chrome.alarms.create(SESSION_REFRESH_ALARM, { periodInMinutes: SESSION_REFRESH_MINUTES });
}

/** Wire the alarm listener. The service worker calls this at module load. */
export function registerAutoApplyAlarmListener(): void {
  if (typeof chrome === "undefined" || !chrome.alarms?.onAlarm) return;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === AUTO_APPLY_ALARM) void runAutoApplyTick();
    else if (alarm.name === SESSION_REFRESH_ALARM) void runSessionRefreshTick();
  });
}

/* ── one auto-apply tick ───────────────────────────────────────────────────── */

/** Build an authed API client from storage, or null if not paired. */
async function apiOrNull(): Promise<KarjooApi | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const origin = await getApiOrigin();
  return new KarjooApi({ origin, token });
}

/** Persist a non-secret status summary (and return it). */
async function record(status: AutoApplyStatus): Promise<AutoApplyStatus> {
  await setAutoApplyStatus(status);
  return status;
}

/**
 * Run ONE background auto-apply tick. Returns the resulting status (also stored).
 * Safe to call from the alarm or from a manual "run now" popup action.
 */
export async function runAutoApplyTick(): Promise<AutoApplyStatus> {
  const ranAt = Date.now();
  try {
    const api = await apiOrNull();
    if (!api) return record({ ranAt, outcome: "not_paired", submitted: 0, failed: 0 });

    // 1) Server-authoritative settings — cache them for the popup, then gate.
    const settings = await api.getAutoApplySettings();
    await setAutoApplySettings({ enabled: settings.enabled, minScore: settings.minScore });

    const connectedBoards = await listConnectedBoards(api);
    const gate: AutoApplyGate = {
      enabled: settings.enabled,
      minScore: settings.minScore,
      boardsConnected: connectedBoards.length > 0,
    };
    const decision = decideTick(gate);
    if (!decision.run) {
      return record({
        ranAt,
        outcome: decision.reason === "disabled" ? "disabled" : "no_boards",
        submitted: 0,
        failed: 0,
      });
    }

    // 2) Claim the gated queue. The server enforces toggle + cap + threshold; we
    //    pass a small limit and stop early on a cap/disabled signal.
    const claim = await api.claimQueue(MAX_APPLIES_PER_TICK);
    if (shouldStopForClaim(claim)) {
      return record({
        ranAt,
        outcome: claim.reason === "quota_exceeded" ? "quota_reached" : "disabled",
        submitted: 0,
        failed: 0,
      });
    }

    const items = eligibleItems(claim.items, decision.minScore);
    if (items.length === 0) {
      return record({ ranAt, outcome: "empty", submitted: 0, failed: 0 });
    }

    // 3) Apply each item politely, stopping the moment the server reports the cap.
    let submitted = 0;
    let failed = 0;
    for (const [i, item] of items.entries()) {
      // Politeness: jittered delay before each apply except the first.
      if (i > 0) await sleep(politenessDelayMs());

      const reachedCap = await applyOne(
        api,
        item,
        () => {
          submitted += 1;
        },
        () => {
          failed += 1;
        },
      );
      if (reachedCap) {
        return record({
          ranAt,
          outcome: "quota_reached",
          submitted,
          failed,
          message: "سقفِ روزانه‌ی اپلای پر شد.",
        });
      }
    }

    return record({
      ranAt,
      outcome: submitted > 0 ? "applied" : "empty",
      submitted,
      failed,
    });
  } catch (err) {
    return record({
      ranAt,
      outcome: "error",
      submitted: 0,
      failed: 0,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Apply to one item. Drives the board content script to fill + submit, then
 * reports the result. Returns true ONLY when the server reported the daily cap
 * (HTTP 429) so the caller stops the whole drain.
 */
async function applyOne(
  api: KarjooApi,
  item: ApplyQueueItem,
  onSubmitted: () => void,
  onFailed: () => void,
): Promise<boolean> {
  const plan = buildApplyPlan(item, applyValuesFor(item));
  if (!plan) {
    await safeReport(api, item.id, "skipped", "no apply spec for board");
    onFailed();
    return false;
  }

  // Open/focus the job page and drive its apply content script.
  const origin = BOARDS[item.board]?.origin;
  let exec: ContentApplyResult;
  try {
    const tab = await ensureTab(item.jobUrl, origin ?? item.jobUrl);
    if (!tab?.id) throw new Error("could not open the job page");
    exec = (await chrome.tabs.sendMessage(tab.id, {
      type: "CONTENT_APPLY",
      plan,
    })) as ContentApplyResult;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const cap = await safeReport(api, item.id, "failed", reason);
    onFailed();
    return cap;
  }

  if (exec?.ok) {
    const cap = await safeReport(api, item.id, "submitted");
    if (!cap) onSubmitted();
    return cap;
  }

  const reason = exec?.reason ?? "apply failed on page";
  const cap = await safeReport(api, item.id, "failed", reason);
  onFailed();
  return cap;
}

/**
 * Report a result through the no-secrets chokepoint. Returns true if the server
 * answered 429 (daily cap reached). Never throws (failures are swallowed into a
 * false so the drain can continue/stop cleanly).
 */
async function safeReport(
  api: KarjooApi,
  id: string,
  status: "submitted" | "failed" | "skipped",
  reason?: string,
): Promise<boolean> {
  try {
    const report = buildApplyResultReport({ id, status, reason });
    const res = await api.reportResult(report);
    return shouldStopForCap({ ok: res.ok, status: res.status });
  } catch {
    return false;
  }
}

/** Connected board ids from /api/extension/me (status !== expired/needs_reauth). */
async function listConnectedBoards(api: KarjooApi): Promise<BoardId[]> {
  try {
    const me = (await api.meRaw()) as { boards?: { board: string; status?: string }[] };
    return (me.boards ?? [])
      .filter((b) => b.status === undefined || b.status === "connected")
      .map((b) => b.board as BoardId)
      .filter((b): b is BoardId => b in BOARDS);
  } catch {
    return [];
  }
}

/* ── session refresh tick (delegated) ──────────────────────────────────────── */

export async function runSessionRefreshTick(): Promise<void> {
  const api = await apiOrNull();
  if (!api) return;
  // Plan decides whether the session may leave the device: Free/Pro keep it
  // LOCAL; only Max/Max+ push it to the user's own encrypted vault. getPlan()
  // fails closed to 'free' (no push) on any error.
  const plan = await api.getPlan();
  await refreshAllBoardSessions(api, { pushToVault: planUsesVault(plan) });
}

/* ── tab + timing helpers (shared shape with the assisted flow) ────────────── */

async function ensureTab(jobUrl: string, origin: string): Promise<chrome.tabs.Tab | undefined> {
  const existing = await chrome.tabs.query({ url: `${origin}/*` });
  const match = existing.find((t) => t.url && sameJob(t.url, jobUrl));
  if (match?.id !== undefined) {
    await chrome.tabs.update(match.id, { active: true });
    return match;
  }
  return chrome.tabs.create({ url: jobUrl, active: false });
}

function sameJob(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
