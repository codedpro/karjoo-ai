/**
 * Tiny typed wrapper around chrome.runtime.sendMessage for the popup.
 * Every call goes to the background worker, which owns the token + API client.
 *
 * The background is an MV3 service worker that can be ASLEEP when the popup
 * opens. `chrome.runtime.sendMessage` normally wakes it, but if the worker is
 * slow to boot (or throws before responding) the promise can hang — which is
 * exactly what left the popup blank (BUG 3). So every send is bounded by a
 * timeout and callers are expected to try/catch it and render a visible state
 * instead of letting a rejection blank the popup.
 */
import type { PopupToBackground, Result } from "@ext/lib/messages";

/** Default cap on how long we wait for a (possibly-asleep) SW to answer. */
export const SEND_TIMEOUT_MS = 8000;

export async function send<T>(msg: PopupToBackground, timeoutMs = SEND_TIMEOUT_MS): Promise<T> {
  const res = (await withTimeout(
    chrome.runtime.sendMessage(msg) as Promise<Result<T> | undefined>,
    timeoutMs,
    "پاسخی از هسته‌ی افزونه دریافت نشد (زمان انتظار به پایان رسید).",
  )) as Result<T> | undefined;
  if (!res) throw new Error("no response from background worker");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Reject with `message` if `p` doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}
