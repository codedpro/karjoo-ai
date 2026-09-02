/**
 * Runtime configuration for the Karjoo extension.
 *
 * The Karjoo API origin is fixed at BUILD time (`KARJOO_API` env → inlined as
 * `process.env.KARJOO_API_DEFAULT`, defaulting to the production control plane).
 * It is NOT user-overridable: `getApiOrigin()` in storage.ts always returns this
 * compile-time constant, so a user can never repoint the extension at a rogue
 * control plane. This is the single source of truth for "where is the control
 * plane".
 */

/** Build-time default; esbuild's `define` replaces this literal. */
declare const process: { env: { KARJOO_API_DEFAULT?: string } };

export const DEFAULT_API_ORIGIN: string =
  (typeof process !== "undefined" && process.env?.KARJOO_API_DEFAULT) ||
  "https://karjoo.1xai.ir";
// (کارجو اکنون زیرِ برندِ 1xAi است. دامنه‌ی قدیمِ karjooai.itmaster.uk هنوز همان بک‌اند
//  را سرو می‌کند، پس نشست‌های Bearerِ جفت‌شده‌ی موجود با سوییچِ دامنه نمی‌شکنند — همان
//  DB و همان توکن؛ فراخوانی‌های افزونه Bearer-authاند، نه کوکی‌محور.)

/** chrome.storage keys — centralized so every module agrees on the names. */
export const STORAGE_KEYS = {
  // NOTE: the API origin is intentionally NOT a storage key. It is locked to the
  // compile-time DEFAULT_API_ORIGIN and can't be overridden at runtime, so there
  // is nothing to persist. See getApiOrigin() in storage.ts.
  /** The extension session token returned by /api/extension/link (string). */
  sessionToken: "karjoo.sessionToken",
  /** Cached signed-in identity from /api/extension/me (object). */
  identity: "karjoo.identity",
  /**
   * Last-known auto-apply settings mirrored from the server (object:
   * { enabled, minScore }). The SERVER is authoritative — this is only a UI cache
   * so the popup can render the toggle instantly before the round-trip.
   */
  autoApplySettings: "karjoo.autoApply.settings",
  /**
   * Status of the most recent background auto-apply tick (object: AutoApplyStatus)
   * — shown in the popup "last run" view. Non-secret summary only.
   */
  autoApplyStatus: "karjoo.autoApply.status",
  /**
   * LOCAL, device-only captured session snapshots, keyed by board
   * (map: board → SessionSnapshot). RAW session material — used by the apply flow
   * and (premium only) the vault push; NEVER sent anywhere except
   * /api/session/refresh. Free/Pro: stays here, never leaves the device.
   */
  sessionSnapshots: "karjoo.session.snapshots",
  /** Stable UUID identifying this browser installation as a queue executor. */
  executorId: "karjoo.executorId",
  /** Last blocked timestamp already shown as a browser notification. */
  notifiedBlockedAt: "karjoo.notifiedBlockedAt",
  /** Single extension-created tab retained for login/security intervention. */
  interventionTabId: "karjoo.interventionTabId",
} as const;

/**
 * The job boards this extension assists with. The `id`s here are the SAME string
 * values as the control-plane `JobBoardId` union (src/lib/apply/types.ts), so the
 * extension can POST `{ board }` to the server without any translation.
 *
 * `profilePath` is the user's OWN profile/résumé page on each board — where the
 * import content script reads the user's own data (read-only, user-present).
 */
export const BOARDS = {
  jobinja: {
    id: "jobinja" as const,
    displayName: "جابینجا",
    origin: "https://jobinja.ir",
    /** Jobinja keeps auth in a session COOKIE → detectable via chrome.cookies. */
    sessionShape: "cookie" as const,
    /** The signed-in user's own CV editor (verified live 2026-07-01). */
    profilePath: "/app/cv-builder",
  },
  jobvision: {
    id: "jobvision" as const,
    displayName: "جاب‌ویژن",
    origin: "https://jobvision.ir",
    /** JobVision is an SPA: auth is a JWT in localStorage → needs a content-script probe. */
    sessionShape: "token" as const,
    /** The signed-in user's own résumé/profile page in the SPA. */
    profilePath: "/resume",
  },
  "e-estekhdam": {
    id: "e-estekhdam" as const,
    displayName: "ای‌استخدام",
    origin: "https://www.e-estekhdam.com",
    /** e-estekhdam is server-rendered; auth lives in a session COOKIE. */
    sessionShape: "cookie" as const,
    /** The signed-in user's own profile page. */
    profilePath: "/karfarmas/profile",
  },
  karboom: {
    id: "karboom" as const,
    displayName: "کاربوم",
    origin: "https://karboom.io",
    /** کاربوم سمتِ سرور رندر می‌شود؛ ورود در کوکیِ نشستِ لاراول است. */
    sessionShape: "cookie" as const,
    /** صفحه‌ی پروفایلِ خودِ کاربر (مهمان ۳۰۲ به /account می‌خورد). */
    profilePath: "/profile",
  },
  irantalent: {
    id: "irantalent" as const,
    displayName: "ایران‌تلنت",
    origin: "https://www.irantalent.com",
    /** IranTalent stores its OAuth token in a first-party cookie. */
    sessionShape: "cookie" as const,
    /** The signed-in user's own profile/CV page. */
    profilePath: "/candidate/cv/edit",
  },
} as const;

export type BoardId = keyof typeof BOARDS;

/** The board ids, as a runtime array (ordered) — handy for iteration in the popup/bg. */
export const BOARD_IDS = Object.keys(BOARDS) as BoardId[];

/** Providers that are production-ready in the unified extension manager. */
export const ACTIVE_PROVIDER_IDS = ["jobinja", "jobvision", "e-estekhdam", "irantalent", "karboom"] as const;
export type ActiveProviderId = (typeof ACTIVE_PROVIDER_IDS)[number];

export function isActiveProviderId(value: string): value is ActiveProviderId {
  return (ACTIVE_PROVIDER_IDS as readonly string[]).includes(value);
}

export const PROVIDER_JOBS_URLS: Record<ActiveProviderId, string> = {
  jobinja: "https://jobinja.ir/jobs",
  jobvision: "https://jobvision.ir/jobs",
  "e-estekhdam": "https://www.e-estekhdam.com/search",
  irantalent: "https://www.irantalent.com/jobs",
  karboom: "https://karboom.io/jobs",
};
