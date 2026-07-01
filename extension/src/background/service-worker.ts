/**
 * Background service worker — the trusted core of the extension.
 *
 * Responsibilities:
 *   • Owns the Karjoo extension session token (in chrome.storage). The popup and
 *     content scripts never read it directly; they message the worker to act.
 *   • Talks to the Karjoo control plane via KarjooApi.
 *   • Performs LOCAL board-session detection (chrome.cookies for Jobinja; asks
 *     the JobVision content script for the SET of localStorage KEYS present).
 *   • Builds the metadata-only connect payload (no secret material — RULE 1).
 *
 * It is a thin message router; all decision logic lives in the tested pure libs.
 */
import { BOARDS, BOARD_IDS, type BoardId } from "@ext/lib/config";
import { KarjooApi } from "@ext/lib/api-client";
import { buildConnectPayload } from "@ext/lib/connect-payload";
import { buildImportPayload } from "@ext/lib/import-payload";
import {
  jobinjaLoggedIn,
  jobvisionLoggedIn,
  eEstekhdamLoggedIn,
  irantalentLoggedIn,
  sessionShapeOf,
  type CookieLike,
} from "@ext/lib/board-detect";
import {
  getApiOrigin,
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  setIdentity,
  getAutoApplySettings,
  getAutoApplyStatus,
} from "@ext/lib/storage";
import {
  setupAutoApplyAlarms,
  registerAutoApplyAlarmListener,
  runAutoApplyTick,
} from "@ext/background/auto-apply";
import type {
  PopupToBackground,
  ProbeSessionResult,
  Result,
} from "@ext/lib/messages";
import type {
  ApplyQueueItem,
  Identity,
  ApplyResultReport,
  AutoApplySettings,
  AutoApplyStatus,
} from "@ext/lib/types";
import type { ScrapeProfileResult, BoardImportOutcome } from "@ext/lib/import-types";

/** Build an authed API client from current storage state. */
async function apiFromStorage(requireToken = true): Promise<KarjooApi> {
  const origin = await getApiOrigin();
  const token = await getSessionToken();
  if (requireToken && !token) throw new Error("not paired — pair the extension first");
  return new KarjooApi({ origin, token });
}

/* ── pairing (no second OTP — RULE 5) ──────────────────────────────────── */

async function handlePair(code: string): Promise<Identity | null> {
  const origin = await getApiOrigin();
  // No token yet — /link is the bootstrap call.
  const api = new KarjooApi({ origin, token: null });
  const { token, identity } = await api.link(code);
  await setSessionToken(token); // store KARJOO's own token (never a board secret)
  if (identity) await setIdentity(identity);
  return identity ?? null;
}

async function handleGetIdentity(): Promise<Identity | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const api = await apiFromStorage();
  const identity = await api.me();
  await setIdentity(identity);
  return identity;
}

/* ── local board-session detection (RULE 1: boolean only) ──────────────── */

async function probeBoardSession(board: BoardId): Promise<ProbeSessionResult> {
  // Cookie-shaped boards (Jobinja, e-estekhdam): read cookie NAMES via
  // chrome.cookies and decide a boolean. The cookie VALUE is never read out of
  // the browser, never sent to Karjoo (RULE 1).
  if (sessionShapeOf(board) === "cookie") {
    const host = boardCookieDomain(board);
    const cookies = await chrome.cookies.getAll({ domain: host });
    const cookieLikes: CookieLike[] = cookies.map((c) => ({ name: c.name, value: c.value }));
    const loggedIn =
      board === "jobinja" ? jobinjaLoggedIn(cookieLikes) : eEstekhdamLoggedIn(cookieLikes);
    return { loggedIn };
  }

  // Token-shaped boards (JobVision, IranTalent): the token is in localStorage,
  // invisible to chrome.cookies. Ask the content script which KEYS exist (never
  // values) and decide a boolean from the key NAMES alone.
  const keys = await probeLocalStorageKeysViaContentScript(board);
  const loggedIn = board === "jobvision" ? jobvisionLoggedIn(keys) : irantalentLoggedIn(keys);
  return { loggedIn };
}

/** The chrome.cookies domain filter for a cookie-shaped board. */
function boardCookieDomain(board: BoardId): string {
  return new URL(BOARDS[board].origin).hostname.replace(/^www\./, "");
}

/** Ask a token-shaped board tab's content script for its localStorage key NAMES only. */
async function probeLocalStorageKeysViaContentScript(board: BoardId): Promise<string[]> {
  const [tab] = await chrome.tabs.query({ url: `${BOARDS[board].origin}/*` });
  if (!tab?.id) return [];
  try {
    const resp = (await chrome.tabs.sendMessage(tab.id, {
      type: "PROBE_SESSION",
      board,
    })) as { localStorageKeys?: string[] } | undefined;
    return resp?.localStorageKeys ?? [];
  } catch {
    // No content script ready (tab not on the board / not loaded) → not detectable.
    return [];
  }
}

/* ── connect board (metadata-only POST — RULE 1) ───────────────────────── */

async function handleConnectBoard(board: BoardId, accountLabel?: string): Promise<{ ok: boolean }> {
  // Build the payload through the single chokepoint that PROVES no secret leaks.
  const payload = buildConnectPayload({ board, accountLabel });
  const api = await apiFromStorage();
  return api.connectBoard(payload);
}

/* ── apply queue ───────────────────────────────────────────────────────── */

async function handleClaimQueue(): Promise<ApplyQueueItem[]> {
  const api = await apiFromStorage();
  const { items } = await api.claimQueue();
  return items;
}

/** Pre-fill (NEVER submit) the form in the relevant board tab. */
async function handlePrefill(item: ApplyQueueItem): Promise<{ ok: boolean; filledFields: string[] }> {
  const origin = BOARDS[item.board]?.origin;
  if (!origin) throw new Error(`unknown board: ${item.board}`);

  // Ensure the job page is open in a tab, then ask its content script to pre-fill.
  const tab = await ensureTab(item.jobUrl, origin);
  if (!tab?.id) throw new Error("could not open the job page");

  const resp = (await chrome.tabs.sendMessage(tab.id, {
    type: "CONTENT_PREFILL",
    item,
  })) as { ok: boolean; filledFields: string[] } | undefined;

  return resp ?? { ok: false, filledFields: [] };
}

/** Report the outcome of a user APPROVED/skipped application. */
async function handleReportResult(report: ApplyResultReport): Promise<{ ok: boolean }> {
  const api = await apiFromStorage();
  const res = await api.reportResult(report);
  return { ok: res.ok };
}

/* ── auto-apply (§10): toggle + status, all server-authoritative ───────────── */

/**
 * Read the auto-apply settings. The SERVER is authoritative; we return the
 * server's value and refresh the local cache. If the server call fails (e.g.
 * offline) we fall back to the cached value so the popup still renders.
 */
async function handleGetAutoApply(): Promise<AutoApplySettings> {
  try {
    const api = await apiFromStorage();
    const s = await api.getAutoApplySettings();
    const settings: AutoApplySettings = { enabled: s.enabled, minScore: s.minScore };
    return settings;
  } catch {
    return getAutoApplySettings();
  }
}

/**
 * Set the auto-apply toggle/threshold (explicit user consent in the popup). The
 * server is the source of truth — we PUT it and, on success, ensure the alarms
 * exist so a freshly-enabled toggle starts draining on the next tick.
 */
async function handleSetAutoApply(enabled: boolean, minScore?: number): Promise<AutoApplySettings> {
  const api = await apiFromStorage();
  const saved = await api.setAutoApplySettings({ enabled, ...(minScore !== undefined ? { minScore } : {}) });
  // Make sure the periodic drain is scheduled (idempotent).
  setupAutoApplyAlarms();
  return saved;
}

async function handleGetAutoApplyStatus(): Promise<AutoApplyStatus | null> {
  return getAutoApplyStatus();
}

/** Manual "run now" from the popup → one background tick (still fully gated). */
async function handleRunAutoApplyNow(): Promise<AutoApplyStatus> {
  return runAutoApplyTick();
}

/* ── profile import (DATA only — RULE 1) ───────────────────────────────────
 * For each requested board: open the user's OWN profile page, ask the import
 * content script to scrape DATA (text), build the DATA-ONLY payload through the
 * chokepoint that PROVES no credential is present, then POST to /api/profile/
 * import. The server binds the data to THIS session's user and re-runs the same
 * no-credentials guard (defense in depth). User-present, user-approved.
 */
async function handleImportProfiles(boards?: BoardId[]): Promise<BoardImportOutcome[]> {
  const api = await apiFromStorage();
  const targets = boards && boards.length > 0 ? boards : BOARD_IDS;
  const outcomes: BoardImportOutcome[] = [];

  for (const board of targets) {
    try {
      outcomes.push(await importOneBoard(api, board));
    } catch (err) {
      outcomes.push({
        board,
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

/** Import one board: open profile page → scrape DATA → DATA-only POST. */
async function importOneBoard(api: KarjooApi, board: BoardId): Promise<BoardImportOutcome> {
  const cfg = BOARDS[board];
  const profileUrl = `${cfg.origin}${cfg.profilePath}`;

  // صفحه‌ی رزومه‌ی خودِ کاربر را باز (یا فوکوس) می‌کنیم — جابینجا: /app/cv-builder (راستی‌آزمایی‌شده).
  // اگر نشانیِ بردِ دیگری هنوز درست نباشد، اسکرپر «رزومه پیدا نشد» را با پیامِ راهنما برمی‌گرداند.
  const tab = await ensureTab(profileUrl, cfg.origin);
  if (!tab?.id) return { board, ok: false, message: "نتوانستم صفحه‌ی رزومه را باز کنم." };

  // Ask the import content script to read the user's OWN profile DOM (DATA only).
  let scraped: ScrapeProfileResult | undefined;
  try {
    scraped = (await chrome.tabs.sendMessage(tab.id, {
      type: "SCRAPE_PROFILE",
      board,
    })) as ScrapeProfileResult | undefined;
  } catch {
    return {
      board,
      ok: false,
      message: "اسکریپت ایمپورت روی صفحه آماده نشد. صفحه را تازه کنید و دوباره تلاش کنید.",
    };
  }

  if (!scraped?.ok || !scraped.profile) {
    return {
      board,
      ok: false,
      message:
        scraped?.message ??
        "رزومه‌ای در این صفحه پیدا نشد — صفحه‌ی رزومه‌ات را در این سایت باز کن و دوباره «وارد کردن» را بزن.",
    };
  }

  // Build the DATA-ONLY body. This THROWS if any credential-shaped key sneaked in
  // — the single chokepoint that makes "no secret leaves the browser" provable.
  const body = buildImportPayload(board, scraped.profile);
  const res = await api.importProfile(body);
  return { board, ok: res.ok, importedSummary: res.summary, message: "ایمپورت شد" };
}

/** Find an open tab for the job URL or open a new one focused on it. */
async function ensureTab(jobUrl: string, origin: string): Promise<chrome.tabs.Tab | undefined> {
  const existing = await chrome.tabs.query({ url: `${origin}/*` });
  const match = existing.find((t) => t.url && sameJob(t.url, jobUrl));
  if (match) {
    await chrome.tabs.update(match.id!, { active: true });
    return match;
  }
  return chrome.tabs.create({ url: jobUrl, active: true });
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

/* ── message router ────────────────────────────────────────────────────── */

async function route(msg: PopupToBackground): Promise<Result<unknown>> {
  switch (msg.type) {
    case "PAIR":
      return { ok: true, data: await handlePair(msg.code) };
    case "GET_IDENTITY":
      return { ok: true, data: await handleGetIdentity() };
    case "SIGN_OUT":
      await clearSessionToken();
      return { ok: true, data: { signedOut: true } };
    case "DETECT_BOARD":
      return { ok: true, data: await probeBoardSession(msg.board) };
    case "CONNECT_BOARD":
      return { ok: true, data: await handleConnectBoard(msg.board, msg.accountLabel) };
    case "CLAIM_QUEUE":
      return { ok: true, data: await handleClaimQueue() };
    case "PREFILL":
      return { ok: true, data: await handlePrefill(msg.item) };
    case "REPORT_RESULT":
      return { ok: true, data: await handleReportResult(msg.report) };
    case "IMPORT_PROFILES":
      return { ok: true, data: await handleImportProfiles(msg.boards) };
    case "GET_AUTO_APPLY":
      return { ok: true, data: await handleGetAutoApply() };
    case "SET_AUTO_APPLY":
      return { ok: true, data: await handleSetAutoApply(msg.enabled, msg.minScore) };
    case "GET_AUTO_APPLY_STATUS":
      return { ok: true, data: await handleGetAutoApplyStatus() };
    case "RUN_AUTO_APPLY_NOW":
      return { ok: true, data: await handleRunAutoApplyNow() };
    default: {
      const _exhaustive: never = msg;
      return { ok: false, error: `unknown message: ${JSON.stringify(_exhaustive)}` };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: PopupToBackground, _sender, sendResponse) => {
  route(msg)
    .then(sendResponse)
    .catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error } satisfies Result<never>);
    });
  // Keep the message channel open for the async response.
  return true;
});

/* ── auto-apply alarms (§10) ────────────────────────────────────────────────
 * Register the alarm LISTENER at load (so it survives the SW being respawned to
 * handle an alarm), and (re)create the alarms on install/startup. The tick itself
 * does NOTHING unless the server-side toggle is ON — see auto-apply.ts. The
 * service worker (and thus background apply) runs only while the browser runs;
 * 24/7 apply is the Max/Max+ worker tier (README). */
registerAutoApplyAlarmListener();
chrome.runtime.onInstalled.addListener(() => setupAutoApplyAlarms());
chrome.runtime.onStartup.addListener(() => setupAutoApplyAlarms());
// Also ensure on plain load (covers dev-reload where onInstalled may not fire).
setupAutoApplyAlarms();
