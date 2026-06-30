/**
 * Background LOCAL session refresh (the impure half — chrome.cookies + content
 * probe + storage).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 — local session refresh:
 *   Periodically RECAPTURE the user's CURRENT session for each connected board:
 *     • cookies via chrome.cookies (cookie-shaped boards: jobinja, e-estekhdam),
 *     • localStorage/sessionStorage via the session-probe content script
 *       (token-shaped SPA boards: jobvision, irantalent).
 *   Keep a fresh LOCAL snapshot (chrome.storage.local) used by background apply so
 *   it keeps working as the board rotates the session.
 *
 *   For Free/Pro the snapshot STAYS ON THE DEVICE — it is never transmitted.
 *   For Max/Max+ (pushToVault=true) the SAME snapshot is ALSO pushed to the user's
 *   OWN encrypted vault via POST /api/session/refresh — the ONLY transmission of
 *   raw session material, and only to that endpoint, only the user's own session.
 *
 *   No detection-evasion: this is the user's own session, captured faithfully.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { BOARDS, type BoardId } from "@ext/lib/config";
import { sessionShapeOf } from "@ext/lib/board-detect";
import { setSessionSnapshot } from "@ext/lib/storage";
import {
  buildSessionRefreshBody,
  snapshotHasMaterial,
  type SessionSnapshot,
  type CapturedCookie,
  type CapturedStorage,
} from "@ext/lib/session-snapshot";
import type { KarjooApi } from "@ext/lib/api-client";
import type { CaptureStorageResult } from "@ext/lib/messages";

export interface RefreshOptions {
  /** Premium only: also push the captured session to the user's own vault. */
  pushToVault: boolean;
}

/**
 * Refresh sessions for every connected board. Best-effort and resilient: a
 * failure on one board never aborts the others.
 */
export async function refreshAllBoardSessions(api: KarjooApi, opts: RefreshOptions): Promise<void> {
  let boards: BoardId[] = [];
  try {
    const me = await api.meRaw();
    boards = (me.boards ?? [])
      .filter((b) => b.status === undefined || b.status === "connected")
      .map((b) => b.board as BoardId)
      .filter((b): b is BoardId => b in BOARDS);
  } catch {
    return;
  }

  for (const board of boards) {
    try {
      await refreshOneBoard(api, board, opts);
    } catch {
      // Swallow per-board errors — refresh is best-effort.
    }
  }
}

/** Capture one board's current session, store it LOCALLY, and (premium) push it. */
export async function refreshOneBoard(
  api: KarjooApi,
  board: BoardId,
  opts: RefreshOptions,
): Promise<void> {
  const shape = sessionShapeOf(board);
  const snapshot: SessionSnapshot = {
    board,
    shape,
    capturedAt: Date.now(),
  };

  if (shape === "cookie") {
    snapshot.cookies = await captureCookies(board);
  } else {
    snapshot.storage = await captureStorageViaContentScript(board);
  }

  // Nothing captured (user logged out / tab not open) → don't overwrite a good
  // snapshot with an empty one; just skip.
  if (!snapshotHasMaterial(snapshot)) return;

  // 1) Always keep a fresh LOCAL copy (device-only for Free/Pro).
  await setSessionSnapshot(snapshot);

  // 2) Premium only: push to the user's OWN encrypted vault.
  if (opts.pushToVault) {
    // The user's OWN browser UA — sent so the worker can replay with matching
    // headers. This is the user's real UA, not a spoofed one (§10).
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : undefined;
    const body = buildSessionRefreshBody(snapshot, ua);
    if (body) {
      try {
        await api.refreshSession(body);
      } catch {
        // Vault push is best-effort; the local snapshot is what apply uses.
      }
    }
  }
}

/** Read the board's cookies (name+value) via chrome.cookies for the apply replay. */
async function captureCookies(board: BoardId): Promise<CapturedCookie[]> {
  if (typeof chrome === "undefined" || !chrome.cookies) return [];
  const host = new URL(BOARDS[board].origin).hostname.replace(/^www\./, "");
  const cookies = await chrome.cookies.getAll({ domain: host });
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    ...(typeof c.expirationDate === "number" ? { expirationDate: c.expirationDate } : {}),
  }));
}

/** Ask the session-probe content script (on the board tab) for storage k/v. */
async function captureStorageViaContentScript(board: BoardId): Promise<CapturedStorage> {
  if (typeof chrome === "undefined" || !chrome.tabs) return {};
  const [tab] = await chrome.tabs.query({ url: `${BOARDS[board].origin}/*` });
  if (tab?.id === undefined) return {};
  try {
    const resp = (await chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE_STORAGE",
      board,
    })) as CaptureStorageResult | undefined;
    return resp?.storage ?? {};
  } catch {
    return {};
  }
}
