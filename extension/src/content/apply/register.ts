/**
 * Shared registration for per-board APPLY content scripts.
 *
 * Each board's apply content script imports `registerApplyHandler(board)` and is
 * injected on that board's pages. The handler responds to CONTENT_APPLY by
 * running the APPLY_SPEC executor against the page.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 — the content script NEVER auto-applies on its own. It only acts when the
 * BACKGROUND runner sends CONTENT_APPLY, which the runner does ONLY after it has
 * confirmed (server-side) that the auto-apply toggle is ON, the daily cap is not
 * reached, and the item is above the user's threshold. The handler additionally
 * refuses any plan whose board does not match this script's board (defense in
 * depth). No detection-evasion: it drives the public form with the user's own
 * session in the user's own browser.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { executeApplyPlan } from "@ext/content/apply/apply-executor";
import type { BoardId } from "@ext/lib/config";
import type { BackgroundToContent, ContentApplyResult } from "@ext/lib/messages";

export function registerApplyHandler(board: BoardId): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundToContent, _sender, sendResponse: (r: ContentApplyResult) => void) => {
      if (msg.type !== "CONTENT_APPLY") return undefined;
      // Defense in depth: never run a plan meant for a different board.
      if (msg.plan.board !== board) {
        sendResponse({ ok: false, ranSteps: [], reason: `board mismatch: ${msg.plan.board}` });
        return true;
      }
      executeApplyPlan(msg.plan)
        .then((res) => sendResponse(res))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            ranSteps: [],
            reason: err instanceof Error ? err.message : String(err),
          }),
        );
      // Keep the channel open for the async executor result.
      return true;
    },
  );
}
