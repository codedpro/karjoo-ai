/**
 * Browser abstraction — the NARROW Playwright surface the apply runner needs.
 *
 * The runner is written against these interfaces, NOT against playwright-core
 * directly, so unit tests inject a fake browser and never download or launch a
 * real one. The real adapter (`launchChromium`) is the ONLY place that imports
 * playwright-core, and it is excluded from the unit tests.
 *
 * CRITICAL (per the task): we depend on `playwright-core` (downloads NO browsers)
 * and a configurable executablePath. `npm install && npm run build && npm test`
 * pass with NO real browser. The browser is launched only at runtime on a VM that
 * has a Chromium installed.
 */
import type { PlaywrightCookie } from "./session-inject.js";

/** A located element handle (the subset we use). */
export interface BrowserLocator {
  /** Count of matching elements (0 → not present). */
  count(): Promise<number>;
  /** Click the first match. */
  click(opts?: { timeout?: number }): Promise<void>;
  /** Fill the first match (input/textarea). */
  fill(value: string, opts?: { timeout?: number }): Promise<void>;
  /** Select an option by value/label. */
  selectOption(value: string, opts?: { timeout?: number }): Promise<void>;
  /** Set input files (for upload steps). */
  setInputFiles(files: string | string[], opts?: { timeout?: number }): Promise<void>;
  /** Wait for the element to be attached/visible. */
  waitFor(opts?: { timeout?: number; state?: "attached" | "visible" }): Promise<void>;
}

/** A page within a context (the subset we use). */
export interface BrowserPage {
  goto(url: string, opts?: { timeout?: number; waitUntil?: string }): Promise<void>;
  url(): string;
  locator(selector: string): BrowserLocator;
  screenshot(opts?: { type?: "png" | "jpeg" }): Promise<Buffer | Uint8Array>;
}

/** A browser context = one isolated session (the subset we use). */
export interface BrowserContext {
  addCookies(cookies: PlaywrightCookie[]): Promise<void>;
  addInitScript(script: string): Promise<void>;
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

/** Options for creating a context (the user's UA goes here). */
export interface NewContextOptions {
  userAgent?: string;
}

/** A launched browser (the subset we use). */
export interface Browser {
  newContext(opts?: NewContextOptions): Promise<BrowserContext>;
  close(): Promise<void>;
}

/** A function that launches a browser — injected into the processor (real or fake). */
export type BrowserLauncher = (opts: {
  headless: boolean;
  executablePath: string | null;
}) => Promise<Browser>;

/**
 * The REAL launcher, backed by playwright-core. Imported lazily so the module
 * graph (and the unit tests) never need playwright-core resolved at load time.
 * Requires a system Chromium via executablePath (we never download one).
 */
export const launchChromium: BrowserLauncher = async ({ headless, executablePath }) => {
  // Lazy import: keeps playwright-core out of the test/build-without-browser path.
  const { chromium } = await import("playwright-core");
  const launchOpts: Parameters<typeof chromium.launch>[0] = { headless };
  if (executablePath) launchOpts.executablePath = executablePath;
  const browser = await chromium.launch(launchOpts);
  return browser as unknown as Browser;
};
