/**
 * Tiny typed wrapper around chrome.runtime.sendMessage for the popup.
 * Every call goes to the background worker, which owns the token + API client.
 */
import type { PopupToBackground, Result } from "@ext/lib/messages";

export async function send<T>(msg: PopupToBackground): Promise<T> {
  const res = (await chrome.runtime.sendMessage(msg)) as Result<T> | undefined;
  if (!res) throw new Error("no response from background worker");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
