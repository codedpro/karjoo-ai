/**
 * update-check — the "is a newer extension available?" probe (BUG 5 / Track A).
 *
 * The extension is distributed as an UNPACKED zip, so there is no Chrome Web
 * Store auto-update. Instead the control plane exposes GET
 * `${origin}/api/extension/version` returning the CURRENT manifest version as a
 * single source of truth; the popup (and, optionally, a background alarm) fetch
 * it, compare against `chrome.runtime.getManifest().version`, and — if the
 * server is strictly newer — surface a Persian "نسخه‌ی جدید موجود است" banner
 * linking to the re-download.
 *
 * SAFETY / RESILIENCE (non-negotiable):
 *   • Network failure, timeout, non-2xx, or a malformed body → returns
 *     `{ updateAvailable: false }`. It NEVER throws and NEVER blocks the popup.
 *   • The version comparison is fail-closed (see version-compare.ts): a hostile
 *     or garbled `version` string can't fake an update.
 *   • This makes NO change to the metadata-only / own-session-only posture — it
 *     is a plain unauthenticated GET of a public version manifest.
 */
import { isNewerVersion } from "@ext/lib/version-compare";

/** Shape returned by GET /api/extension/version (Track B). */
export interface VersionManifest {
  /** The latest available extension version, e.g. "0.2.0". */
  version: string;
  /** Where to re-download the zip (relative to the control-plane origin). */
  downloadUrl?: string;
  /** Optional human-readable release notes (Persian). */
  notes?: string;
}

/** Result of an update check — always resolves, never rejects. */
export interface UpdateCheckResult {
  updateAvailable: boolean;
  /** The server's latest version (only when it parsed successfully). */
  latestVersion?: string;
  /** Absolute URL to re-download the new zip (only when an update is available). */
  downloadUrl?: string;
  notes?: string;
}

/** Minimal fetch signature we depend on (injectable for tests). */
export type FetchLike = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_DOWNLOAD_PATH = "/karjoo-extension.zip";

/**
 * Parse an unknown JSON body into a VersionManifest, or `null` if it doesn't
 * carry a usable `version` string. (Fail-closed — a bad body yields no update.)
 */
export function parseVersionManifest(body: unknown): VersionManifest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.version !== "string" || b.version.trim().length === 0) return null;
  const manifest: VersionManifest = { version: b.version };
  if (typeof b.downloadUrl === "string" && b.downloadUrl.length > 0) manifest.downloadUrl = b.downloadUrl;
  if (typeof b.notes === "string" && b.notes.length > 0) manifest.notes = b.notes;
  return manifest;
}

/**
 * Decide the update result from the current version + a parsed server manifest.
 * Pure, so it's unit-tested. `origin` is used to absolutize a relative
 * downloadUrl; if the server omits one we fall back to the canonical zip path.
 */
export function decideUpdate(
  currentVersion: string,
  manifest: VersionManifest | null,
  origin: string,
): UpdateCheckResult {
  if (!manifest) return { updateAvailable: false };
  if (!isNewerVersion(manifest.version, currentVersion)) {
    return { updateAvailable: false, latestVersion: manifest.version };
  }
  const path = manifest.downloadUrl ?? DEFAULT_DOWNLOAD_PATH;
  let downloadUrl: string;
  try {
    // Absolutize a relative path against the (locked) control-plane origin.
    downloadUrl = new URL(path, origin).toString();
  } catch {
    downloadUrl = origin.replace(/\/+$/, "") + DEFAULT_DOWNLOAD_PATH;
  }
  return {
    updateAvailable: true,
    latestVersion: manifest.version,
    downloadUrl,
    ...(manifest.notes ? { notes: manifest.notes } : {}),
  };
}

/**
 * Fetch the server version manifest and decide whether an update is available.
 * Resilient by construction: any network/timeout/parse failure resolves to
 * `{ updateAvailable: false }`.
 *
 * @param origin           the locked control-plane origin (from getApiOrigin()).
 * @param currentVersion   chrome.runtime.getManifest().version.
 * @param opts.fetchImpl   injectable fetch (defaults to global fetch).
 * @param opts.timeoutMs   abort after this many ms (defaults to 4000).
 */
export async function checkForUpdate(
  origin: string,
  currentVersion: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<UpdateCheckResult> {
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
  if (!fetchImpl) return { updateAvailable: false };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const url = `${origin.replace(/\/+$/, "")}/api/extension/version`;
    const res = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) return { updateAvailable: false };
    const body = await res.json();
    const manifest = parseVersionManifest(body);
    return decideUpdate(currentVersion, manifest, origin);
  } catch {
    // Network error, timeout/abort, or bad JSON → no banner, never blocks.
    return { updateAvailable: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
