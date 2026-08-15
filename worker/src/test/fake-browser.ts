/**
 * A FAKE Playwright browser for unit tests — records every call so tests can
 * assert the session was injected and the apply plan ran, with NO real Chromium
 * and NO network. This is what makes "npm test" pass without a browser.
 */
import type {
  Browser,
  BrowserContext,
  BrowserLauncher,
  BrowserLocator,
  BrowserPage,
  NewContextOptions,
} from "../lib/browser.js";
import type { PlaywrightCookie } from "../lib/session-inject.js";

/** Per-selector behavior the test can configure. */
export interface SelectorBehavior {
  /** Number of matches count() returns (default 1). */
  count?: number;
  /** waitFor rejects when true (simulates a missing element). */
  waitForThrows?: boolean;
  /** The named action throws when true. */
  throwOn?: "click" | "fill" | "select" | "upload";
  /** Optional custom error message for thrown selector actions. */
  throwMessage?: string;
}

export interface FakeBrowserOptions {
  /** Map selector → behavior. Unlisted selectors default to count:1, present. */
  selectors?: Record<string, SelectorBehavior>;
  /** Text returned by locator("body").textContent(). */
  bodyText?: string;
  /** The URL page.url() returns (default the goto target). */
  finalUrl?: string;
  /** goto rejects when true. */
  gotoThrows?: boolean;
}

/** A recording of everything that happened, for assertions. */
export interface FakeBrowserRecord {
  launched: number;
  contexts: number;
  cookies: PlaywrightCookie[];
  initScripts: string[];
  contextOptions: NewContextOptions[];
  navigations: string[];
  actions: { kind: string; selector: string; value?: string }[];
  contextClosed: number;
  browserClosed: number;
}

/** Build a fake launcher + its record. */
export function makeFakeBrowser(opts: FakeBrowserOptions = {}): {
  launcher: BrowserLauncher;
  record: FakeBrowserRecord;
} {
  const record: FakeBrowserRecord = {
    launched: 0,
    contexts: 0,
    cookies: [],
    initScripts: [],
    contextOptions: [],
    navigations: [],
    actions: [],
    contextClosed: 0,
    browserClosed: 0,
  };

  function makeLocator(selector: string): BrowserLocator {
    const b = opts.selectors?.[selector] ?? {};
    return {
      async count() {
        return b.count ?? 1;
      },
      async click() {
        if (b.throwOn === "click") throw new Error(b.throwMessage ?? "click failed");
        record.actions.push({ kind: "click", selector });
      },
      async fill(value: string) {
        if (b.throwOn === "fill") throw new Error(b.throwMessage ?? "fill failed");
        record.actions.push({ kind: "fill", selector, value });
      },
      async selectOption(value: string) {
        if (b.throwOn === "select") throw new Error(b.throwMessage ?? "select failed");
        record.actions.push({ kind: "select", selector, value });
      },
      async setInputFiles(files: string | string[]) {
        if (b.throwOn === "upload") throw new Error(b.throwMessage ?? "upload failed");
        record.actions.push({ kind: "upload", selector, value: String(files) });
      },
      async waitFor() {
        if (b.waitForThrows) throw new Error(b.throwMessage ?? "waitFor timeout");
        record.actions.push({ kind: "waitFor", selector });
      },
      async textContent() {
        return selector === "body" ? (opts.bodyText ?? "") : "";
      },
    };
  }

  function makePage(): BrowserPage {
    let current = "";
    return {
      async goto(url: string) {
        if (opts.gotoThrows) throw new Error("goto failed");
        current = url;
        record.navigations.push(url);
      },
      url() {
        return opts.finalUrl ?? current;
      },
      locator(selector: string) {
        return makeLocator(selector);
      },
      async screenshot() {
        return Buffer.from("FAKE-PNG-BYTES");
      },
    };
  }

  function makeContext(): BrowserContext {
    return {
      async addCookies(cookies: PlaywrightCookie[]) {
        record.cookies.push(...cookies);
      },
      async addInitScript(script: string) {
        record.initScripts.push(script);
      },
      async newPage() {
        return makePage();
      },
      async close() {
        record.contextClosed++;
      },
    };
  }

  const browser: Browser = {
    async newContext(o?: NewContextOptions) {
      record.contexts++;
      record.contextOptions.push(o ?? {});
      return makeContext();
    },
    async close() {
      record.browserClosed++;
    },
  };

  const launcher: BrowserLauncher = async () => {
    record.launched++;
    return browser;
  };

  return { launcher, record };
}
