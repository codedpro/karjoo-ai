/**
 * Jobinja content script.
 *
 * Jobinja keeps auth in a session COOKIE, so login DETECTION is done by the
 * background worker via chrome.cookies (it reads cookie NAMES, never sends the
 * value anywhere). This content script therefore only handles:
 *   • CONTENT_PREFILL — pre-fill the apply form (no submit — RULE 2).
 *
 * (A PROBE_SESSION handler is included for symmetry but Jobinja detection is
 *  cookie-based and handled in the background; here it simply reports nothing.)
 */
import { applyPrefill } from "@ext/content/apply-dom";
import type { BackgroundToContent } from "@ext/lib/messages";

chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
  if (msg.type === "PROBE_SESSION" && msg.board === "jobinja") {
    // Jobinja login is detected via chrome.cookies in the background; nothing to
    // read from the page DOM here. Reply with no keys so the contract is uniform.
    sendResponse({ localStorageKeys: [] });
    return true;
  }
  if (msg.type === "CONTENT_PREFILL") {
    sendResponse(applyPrefill(msg.item));
    return true;
  }
  return undefined;
});
