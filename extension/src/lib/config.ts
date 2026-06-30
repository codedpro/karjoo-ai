/**
 * Runtime configuration for the Karjoo extension.
 *
 * The Karjoo API origin can be set at build time (`KARJOO_API` env → inlined as
 * `process.env.KARJOO_API_DEFAULT`) and overridden at runtime by the user via
 * the popup (persisted in chrome.storage). This keeps a single source of truth
 * for "where is the control plane" without hard-coding it.
 */

/** Build-time default; esbuild's `define` replaces this literal. */
declare const process: { env: { KARJOO_API_DEFAULT?: string } };

export const DEFAULT_API_ORIGIN: string =
  (typeof process !== "undefined" && process.env?.KARJOO_API_DEFAULT) ||
  "http://localhost:3000";

/** chrome.storage keys — centralized so every module agrees on the names. */
export const STORAGE_KEYS = {
  /** The Karjoo API origin (string). */
  apiOrigin: "karjoo.apiOrigin",
  /** The extension session token returned by /api/extension/link (string). */
  sessionToken: "karjoo.sessionToken",
  /** Cached signed-in identity from /api/extension/me (object). */
  identity: "karjoo.identity",
} as const;

/** The two boards this extension assists with. */
export const BOARDS = {
  jobinja: {
    id: "jobinja" as const,
    displayName: "جابینجا",
    origin: "https://jobinja.ir",
    /** Jobinja keeps auth in a session COOKIE → detectable via chrome.cookies. */
    sessionShape: "cookie" as const,
  },
  jobvision: {
    id: "jobvision" as const,
    displayName: "جاب‌ویژن",
    origin: "https://jobvision.ir",
    /** JobVision is an SPA: auth is a JWT in localStorage → needs a content-script probe. */
    sessionShape: "token" as const,
  },
} as const;

export type BoardId = keyof typeof BOARDS;
