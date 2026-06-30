/**
 * JobVision content script.
 *
 * JobVision is an SPA whose auth JWT lives in localStorage (NOT a cookie), so
 * chrome.cookies cannot see it. This script can:
 *   1. PROBE_SESSION — report which localStorage KEY NAMES exist. It returns ONLY
 *      the key names, NEVER the token values. This lets the background decide the
 *      boolean "logged in?" without any secret leaving the browser (RULE 1).
 *   2. CONTENT_PREFILL — pre-fill the apply form (no submit — RULE 2).
 */
import { sessionTokenKeys } from "@ext/lib/board-detect";
import { applyPrefill } from "@ext/content/apply-dom";
import type { BackgroundToContent } from "@ext/lib/messages";

/**
 * Collect the localStorage KEY NAMES that look like auth tokens. We read
 * `localStorage` keys and filter to candidates — we DO NOT read or return any
 * value. The JWT itself stays in the page, owned by JobVision.
 */
function probeLocalStorageKeys(): string[] {
  const candidates = sessionTokenKeys("jobvision").map((k) => k.toLowerCase());
  const present: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (candidates.includes(key.toLowerCase())) {
      present.push(key); // key NAME only — never localStorage.getItem(key)
    }
  }
  return present;
}

chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
  if (msg.type === "PROBE_SESSION" && msg.board === "jobvision") {
    sendResponse({ localStorageKeys: probeLocalStorageKeys() });
    return true;
  }
  if (msg.type === "CONTENT_PREFILL") {
    sendResponse(applyPrefill(msg.item));
    return true;
  }
  return undefined;
});
