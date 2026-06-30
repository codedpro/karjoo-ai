/**
 * Session-storage capture content script (LOCAL session refresh).
 *
 * Responds to CAPTURE_STORAGE by reading the page's localStorage + sessionStorage
 * (key→value) for THIS board, so the background can keep a fresh LOCAL session
 * snapshot used by background auto-apply (and, premium only, push to the user's
 * OWN encrypted vault).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 — this returns RAW session material (token VALUES), unlike the login-detect
 * probe (which returns key NAMES only). That is intentional and necessary: SPA
 * boards (JobVision/IranTalent) keep their auth token in localStorage, and to
 * replay the user's own session the apply flow needs the value. It is the user's
 * OWN session in the user's OWN browser. The background keeps it LOCAL for
 * Free/Pro and ONLY pushes it to /api/session/refresh (the user's own encrypted
 * vault) for Max/Max+. It is NEVER sent to any other endpoint and NEVER logged.
 * No detection-evasion: faithfully capturing the user's own session is acting as
 * the authorized user, not defeating a bot detector.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { BackgroundToContent, CaptureStorageResult } from "@ext/lib/messages";
import type { CapturedStorage } from "@ext/lib/session-snapshot";

/** Read a Storage object into a plain key→value record (PURE; tested via a fake). */
export function readStorage(store: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key === null) continue;
    const value = store.getItem(key);
    if (value !== null) out[key] = value;
  }
  return out;
}

/** Capture both storages from the current page. */
export function captureStorage(win: Pick<Window, "localStorage" | "sessionStorage"> = window): CapturedStorage {
  return {
    localStorage: readStorage(win.localStorage),
    sessionStorage: readStorage(win.sessionStorage),
  };
}

/* ── content-script wiring (browser only) ─────────────────────────────────── */
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  registerSessionProbeHandler();
}

export function registerSessionProbeHandler(): void {
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundToContent, _sender, sendResponse: (r: CaptureStorageResult) => void) => {
      if (msg.type !== "CAPTURE_STORAGE") return undefined;
      sendResponse({ storage: captureStorage() });
      return true;
    },
  );
}
