/**
 * Auto-apply runtime configuration + politeness math (pure).
 *
 * These defaults MIRROR the control-plane env defaults (Foundation:
 * KARJOO_AUTO_APPLY_ALARM_MINUTES=15, KARJOO_AUTO_APPLY_JITTER_MS_MIN=2000,
 * KARJOO_AUTO_APPLY_JITTER_MS_MAX=8000) so the extension behaves consistently
 * with the server's expectations. They can be overridden at build time via
 * esbuild `define` (process.env.*), but the source of truth for whether ANY
 * auto-apply happens is always the server toggle + per-day cap (never these
 * numbers).
 *
 * §10 guardrail (politeness): every background apply is preceded by a small,
 * randomized delay (base + jitter) so the extension never hammers a board. This
 * is account-safety/politeness — NOT detection-evasion (we are not mimicking
 * human timing to defeat a bot detector; we throttle ourselves to be a good
 * citizen and protect the user's account).
 */

/** Build-time overrides (esbuild `define`); absent at runtime in the browser. */
declare const process: {
  env: {
    KARJOO_AUTO_APPLY_ALARM_MINUTES?: string;
    KARJOO_AUTO_APPLY_JITTER_MS_MIN?: string;
    KARJOO_AUTO_APPLY_JITTER_MS_MAX?: string;
    KARJOO_SESSION_REFRESH_MINUTES?: string;
  };
};

function envNum(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const env = typeof process !== "undefined" ? process.env : {};

/** chrome.alarms name for the periodic background-apply drain. */
export const AUTO_APPLY_ALARM = "karjoo.autoApply" as const;

/** chrome.alarms name for the periodic local session refresh/recapture. */
export const SESSION_REFRESH_ALARM = "karjoo.sessionRefresh" as const;

/** Auto-apply drain interval (minutes). Default 15 (matches Foundation). */
export const AUTO_APPLY_ALARM_MINUTES: number = envNum(
  env.KARJOO_AUTO_APPLY_ALARM_MINUTES,
  15,
);

/** Local session refresh interval (minutes). Default 30. */
export const SESSION_REFRESH_MINUTES: number = envNum(
  env.KARJOO_SESSION_REFRESH_MINUTES,
  30,
);

/** Jitter floor/ceiling (ms) between consecutive applies. Default 2000/8000. */
export const JITTER_MS_MIN: number = envNum(env.KARJOO_AUTO_APPLY_JITTER_MS_MIN, 2000);
export const JITTER_MS_MAX: number = envNum(env.KARJOO_AUTO_APPLY_JITTER_MS_MAX, 8000);

/**
 * How many items to attempt per alarm tick. Kept small so one tick is a polite,
 * bounded burst rather than a flood; the daily cap (server-enforced) is the real
 * limit. The drain stops early the moment the server reports the cap is reached.
 */
export const MAX_APPLIES_PER_TICK = 5 as const;

/** Per-step DOM timeout (ms) for `waitFor` steps in the executor. */
export const STEP_TIMEOUT_MS = 15_000 as const;

/**
 * Compute the politeness delay (ms) before the NEXT apply: a fixed floor plus a
 * uniform jitter in [min, max]. Injectable RNG so it is deterministic in tests.
 * Bounds are auto-swapped if inverted (defensive, mirrors Foundation).
 */
export function politenessDelayMs(rng: () => number = Math.random): number {
  const lo = Math.min(JITTER_MS_MIN, JITTER_MS_MAX);
  const hi = Math.max(JITTER_MS_MIN, JITTER_MS_MAX);
  const span = hi - lo;
  const r = clamp01(rng());
  return Math.round(lo + r * span);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
