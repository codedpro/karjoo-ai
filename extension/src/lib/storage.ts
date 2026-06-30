/**
 * Thin, injectable wrapper over chrome.storage.local for the few values the
 * extension persists: the API origin, the Karjoo session token, and the cached
 * identity.
 *
 * "Injectable" = every function takes an optional `StorageArea` so the pure
 * logic can be unit-tested with an in-memory fake (no real browser in CI).
 *
 * NOTE: the only token stored here is KARJOO's own extension session token
 * (returned by /api/extension/link). We never store any third-party board
 * cookie/token — those stay in the user's browser, owned by the site (RULE 1).
 */
import { DEFAULT_API_ORIGIN, STORAGE_KEYS } from "@ext/lib/config";
import type { Identity } from "@ext/lib/types";

/** Minimal slice of chrome.storage.StorageArea we depend on (promise form). */
export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

/** Resolve the real chrome.storage.local, or throw if unavailable (e.g. tests). */
function defaultArea(): StorageArea {
  // chrome.storage.local already returns promises under MV3.
  return chrome.storage.local as unknown as StorageArea;
}

/* ── session token (Karjoo's own extension token) ──────────────────────── */

export async function getSessionToken(area: StorageArea = defaultArea()): Promise<string | null> {
  const out = await area.get(STORAGE_KEYS.sessionToken);
  const v = out[STORAGE_KEYS.sessionToken];
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function setSessionToken(token: string, area: StorageArea = defaultArea()): Promise<void> {
  if (!token) throw new Error("refusing to store empty session token");
  await area.set({ [STORAGE_KEYS.sessionToken]: token });
}

export async function clearSessionToken(area: StorageArea = defaultArea()): Promise<void> {
  await area.remove([STORAGE_KEYS.sessionToken, STORAGE_KEYS.identity]);
}

export async function isPaired(area: StorageArea = defaultArea()): Promise<boolean> {
  return (await getSessionToken(area)) !== null;
}

/* ── API origin ────────────────────────────────────────────────────────── */

export async function getApiOrigin(area: StorageArea = defaultArea()): Promise<string> {
  const out = await area.get(STORAGE_KEYS.apiOrigin);
  const v = out[STORAGE_KEYS.apiOrigin];
  return typeof v === "string" && v.length > 0 ? normalizeOrigin(v) : DEFAULT_API_ORIGIN;
}

export async function setApiOrigin(origin: string, area: StorageArea = defaultArea()): Promise<void> {
  await area.set({ [STORAGE_KEYS.apiOrigin]: normalizeOrigin(origin) });
}

/** Strip a trailing slash and validate it is a real http(s) origin. */
export function normalizeOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, "");
  const url = new URL(trimmed); // throws on garbage → fail-closed
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported API origin protocol: ${url.protocol}`);
  }
  return trimmed;
}

/* ── cached identity ───────────────────────────────────────────────────── */

export async function getIdentity(area: StorageArea = defaultArea()): Promise<Identity | null> {
  const out = await area.get(STORAGE_KEYS.identity);
  const v = out[STORAGE_KEYS.identity];
  return v && typeof v === "object" ? (v as Identity) : null;
}

export async function setIdentity(identity: Identity, area: StorageArea = defaultArea()): Promise<void> {
  await area.set({ [STORAGE_KEYS.identity]: identity });
}
