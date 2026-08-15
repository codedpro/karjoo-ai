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
import { parseJobinjaDiscoveryPage } from "@ext/lib/jobinja-discovery";

/** باید با CVID_MESSAGE در content/jobinja-cvid.ts (دنیای MAIN) یکسان بماند. */
const CVID_MESSAGE = "karjoo:jobinja-cvid";

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
  if (msg.type === "CONTENT_DISCOVER_JOBINJA") {
    sendResponse(parseJobinjaDiscoveryPage(document, window.location.href));
    return true;
  }
  return undefined;
});

// cvId که هوکِ دنیای MAIN (jobinja-cvid) از URLهای cv-builder برداشته، اینجا (دنیای isolated)
// دریافت و به SW فرستاده می‌شود تا ذخیره شود (برای نوشتنِ سمتِ سرورِ پروفایل). فقط id — نه داده.
let lastCvId: string | null = null;
window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const data = e.data as { source?: string; cvId?: string } | null;
  if (!data || data.source !== CVID_MESSAGE || typeof data.cvId !== "string") return;
  if (data.cvId === lastCvId) return; // فقط یک‌بار به‌ازای هر id
  lastCvId = data.cvId;
  try {
    chrome.runtime.sendMessage({ type: "JOBINJA_CVID", cvId: data.cvId });
  } catch {
    /* SW may be asleep; next capture retries */
  }
});
