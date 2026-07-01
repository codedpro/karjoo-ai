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
import { DEFAULT_API_ORIGIN, STORAGE_KEYS, type BoardId } from "@ext/lib/config";
import type { Identity, AutoApplySettings, AutoApplyStatus } from "@ext/lib/types";
import type { SessionSnapshot } from "@ext/lib/session-snapshot";

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
  // On sign-out, also drop the locally-captured raw board sessions and the
  // auto-apply UI caches — no stale session/state lingers after un-pairing.
  await area.remove([
    STORAGE_KEYS.sessionToken,
    STORAGE_KEYS.identity,
    STORAGE_KEYS.sessionSnapshots,
    STORAGE_KEYS.autoApplySettings,
    STORAGE_KEYS.autoApplyStatus,
  ]);
}

export async function isPaired(area: StorageArea = defaultArea()): Promise<boolean> {
  return (await getSessionToken(area)) !== null;
}

/* ── API origin (LOCKED) ─────────────────────────────────────────────────
 * The control-plane origin is fixed at build time (DEFAULT_API_ORIGIN, inlined
 * by esbuild from KARJOO_API / the production default). It is deliberately NOT
 * user-overridable: getApiOrigin() ALWAYS returns the compile-time constant and
 * NEVER reads chrome.storage, so a user can't repoint the extension at a rogue
 * control plane.
 *
 * The `_area` parameter is accepted (and ignored) only to preserve the injectable
 * call signature used elsewhere; it has no effect on the returned value.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getApiOrigin(_area?: StorageArea): Promise<string> {
  return DEFAULT_API_ORIGIN;
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

/* ── cached auto-apply settings (UI cache; server is authoritative) ─────────── */

/** Default settings when nothing is cached yet (toggle OFF — fail-closed). */
export const DEFAULT_AUTO_APPLY_SETTINGS: AutoApplySettings = { enabled: false, minScore: 0.7 };

export async function getAutoApplySettings(
  area: StorageArea = defaultArea(),
): Promise<AutoApplySettings> {
  const out = await area.get(STORAGE_KEYS.autoApplySettings);
  const v = out[STORAGE_KEYS.autoApplySettings];
  if (v && typeof v === "object") {
    const s = v as Partial<AutoApplySettings>;
    return {
      enabled: s.enabled === true,
      minScore: typeof s.minScore === "number" ? s.minScore : DEFAULT_AUTO_APPLY_SETTINGS.minScore,
    };
  }
  return { ...DEFAULT_AUTO_APPLY_SETTINGS };
}

export async function setAutoApplySettings(
  settings: AutoApplySettings,
  area: StorageArea = defaultArea(),
): Promise<void> {
  await area.set({ [STORAGE_KEYS.autoApplySettings]: settings });
}

/* ── last-run status (non-secret summary for the popup) ─────────────────────── */

export async function getAutoApplyStatus(
  area: StorageArea = defaultArea(),
): Promise<AutoApplyStatus | null> {
  const out = await area.get(STORAGE_KEYS.autoApplyStatus);
  const v = out[STORAGE_KEYS.autoApplyStatus];
  return v && typeof v === "object" ? (v as AutoApplyStatus) : null;
}

export async function setAutoApplyStatus(
  status: AutoApplyStatus,
  area: StorageArea = defaultArea(),
): Promise<void> {
  await area.set({ [STORAGE_KEYS.autoApplyStatus]: status });
}

/* ── LOCAL session snapshots (device-only raw session for the apply flow) ─────
 * These hold RAW session material (the whole point of local refresh). They are
 * stored only in chrome.storage.local and are NEVER sent anywhere except
 * /api/session/refresh (the user's own encrypted vault, premium only). Free/Pro:
 * they never leave the device. We expose a typed map keyed by board.
 */

export async function getSessionSnapshots(
  area: StorageArea = defaultArea(),
): Promise<Partial<Record<BoardId, SessionSnapshot>>> {
  const out = await area.get(STORAGE_KEYS.sessionSnapshots);
  const v = out[STORAGE_KEYS.sessionSnapshots];
  return v && typeof v === "object" ? (v as Partial<Record<BoardId, SessionSnapshot>>) : {};
}

export async function getSessionSnapshot(
  board: BoardId,
  area: StorageArea = defaultArea(),
): Promise<SessionSnapshot | null> {
  const all = await getSessionSnapshots(area);
  return all[board] ?? null;
}

export async function setSessionSnapshot(
  snapshot: SessionSnapshot,
  area: StorageArea = defaultArea(),
): Promise<void> {
  const all = await getSessionSnapshots(area);
  all[snapshot.board] = snapshot;
  await area.set({ [STORAGE_KEYS.sessionSnapshots]: all });
}

/** Forget all locally-captured session snapshots (e.g. on sign-out). */
export async function clearSessionSnapshots(area: StorageArea = defaultArea()): Promise<void> {
  await area.remove([STORAGE_KEYS.sessionSnapshots]);
}
