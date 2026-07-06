/**
 * Shared tab helpers for the background apply flows (assisted + auto).
 *
 * A freshly `chrome.tabs.create`'d tab does NOT have its content-script listener
 * registered until the page reaches document_idle, so an *immediate*
 * `chrome.tabs.sendMessage` throws "Receiving end does not exist" and the apply
 * spuriously fails on most fresh tabs. These helpers (1) wait for the tab to
 * finish loading and (2) retry the send with a short backoff while the content
 * script comes up.
 */

/** Sleep for `ms` (retry backoff). */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve once the tab reaches status 'complete', or after `timeoutMs` (so a
 * stuck/slow page can't hang the drain forever). Safe if the tab is already
 * complete when called (resolves promptly via a one-shot get()).
 */
export function waitForTabComplete(tabId: number, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Maybe it already finished before we attached the listener.
    chrome.tabs.get(tabId, (t) => {
      if (!chrome.runtime.lastError && t && t.status === "complete") finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

const NO_RECEIVER = /Receiving end does not exist|Could not establish connection/i;

/**
 * `chrome.tabs.sendMessage` with retries: even after 'complete', the content
 * script's listener can take a beat to register. Retries ONLY the "no receiving
 * end" error (with linear backoff); any other error is thrown immediately.
 */
export async function sendToTab<T>(tabId: number, message: unknown, tries = 5): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!NO_RECEIVER.test(msg)) throw err;
      await delay(300 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
