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
import { BOARDS, type BoardId } from "@ext/lib/config";
import { KarjooApi } from "@ext/lib/api-client";
import { buildConnectPayload } from "@ext/lib/connect-payload";
import {
  jobinjaLoggedIn,
  jobvisionLoggedIn,
  sessionCookieNames,
  type CookieLike,
} from "@ext/lib/board-detect";
import {
  getApiOrigin,
  getSessionToken,
  setSessionToken,
  clearSessionToken,
  setApiOrigin,
  setIdentity,
} from "@ext/lib/storage";
import type {
  PopupToBackground,
  ProbeSessionResult,
  Result,
} from "@ext/lib/messages";
import type { ApplyQueueItem, Identity, ApplyResultReport } from "@ext/lib/types";

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
  if (board === "jobinja") {
    // Jobinja keeps auth in a COOKIE. We read cookie NAMES from the user's own
    // browser via chrome.cookies and decide a boolean. The cookie VALUE is never
    // read out of the browser, never sent to Karjoo.
    const cookies = await chrome.cookies.getAll({ domain: "jobinja.ir" });
    const cookieLikes: CookieLike[] = cookies.map((c) => ({ name: c.name, value: c.value }));
    void sessionCookieNames(board); // (names list kept in one place for clarity)
    return { loggedIn: jobinjaLoggedIn(cookieLikes) };
  }

  if (board === "jobvision") {
    // JobVision is an SPA: the token is in localStorage, invisible to
    // chrome.cookies. Ask the content script which KEYS exist (never values).
    const keys = await probeJobvisionKeysViaContentScript();
    return { loggedIn: jobvisionLoggedIn(keys) };
  }

  return { loggedIn: false };
}

/** Ask the JobVision tab's content script for its localStorage key NAMES only. */
async function probeJobvisionKeysViaContentScript(): Promise<string[]> {
  const [tab] = await chrome.tabs.query({ url: `${BOARDS.jobvision.origin}/*` });
  if (!tab?.id) return [];
  try {
    const resp = (await chrome.tabs.sendMessage(tab.id, {
      type: "PROBE_SESSION",
      board: "jobvision",
    })) as { localStorageKeys?: string[] } | undefined;
    return resp?.localStorageKeys ?? [];
  } catch {
    // No content script ready (tab not on JobVision / not loaded) → treat as not detectable.
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
  return api.reportResult(report);
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
    case "SET_API_ORIGIN":
      await setApiOrigin(msg.origin);
      return { ok: true, data: { origin: msg.origin } };
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
