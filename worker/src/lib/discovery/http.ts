/**
 * The node's HTTP client for PUBLIC discovery.
 *
 * Every request the crawler makes goes through here, and three things are
 * non-negotiable (§10 — "read-only public listing aggregation: honour robots.txt,
 * polite rate limits, identifiable UA"):
 *
 *   • It says who it is. The UA is KarjooBot with a contact URL — never a browser
 *     string pretending to be a person. If a board decides not to serve an
 *     identified bot, that is the board's call and we report it.
 *   • It asks first. robots.txt is checked for every URL before it is fetched; a
 *     disallowed URL throws RobotsDisallowedError and is NOT requested.
 *   • It is slow on purpose. Consecutive requests to one host are spaced out, so
 *     a 24/7 crawler never looks like a burst.
 *
 * It carries no session and no cookies. Discovery is anonymous: the user's own
 * session is spent only on applying, where it is actually needed.
 */
import { isAllowed, KARJOO_USER_AGENT } from "./robots.js";

export { KARJOO_USER_AGENT };

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots_disallowed: ${url}`);
    this.name = "RobotsDisallowedError";
  }
}

export interface PoliteFetchOptions {
  /** Minimum gap between two requests to the same host (ms). */
  minGapMs?: number;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Skip the robots check — ONLY for tests that inject their own fetch. */
  skipRobots?: boolean;
}

const DEFAULT_MIN_GAP_MS = 1_500;
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Build a fetch that is identified, robots-checked and host-spaced. It has the
 * shape of `fetch`, so the per-board modules take it exactly as they took the
 * browser's fetch in the extension.
 */
export function politeFetch(options: PoliteFetchOptions = {}): typeof fetch {
  const minGapMs = options.minGapMs ?? DEFAULT_MIN_GAP_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const inner = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const lastByHost = new Map<string, number>();
  /**
   * One queue per host. Spacing has to hold under concurrency: e-estekhdam's
   * discovery fetches a page's twenty job details with Promise.all, and a plain
   * "check the last request time" lets all twenty read the same timestamp and
   * fire together — a burst, exactly what the spacing exists to prevent. Chaining
   * each request's slot onto the previous one serialises them per host.
   */
  const chainByHost = new Map<string, Promise<void>>();

  async function takeSlot(host: string): Promise<void> {
    const previous = chainByHost.get(host) ?? Promise.resolve();
    const slot = previous.then(async () => {
      const last = lastByHost.get(host);
      if (last !== undefined) {
        const wait = last + minGapMs - now();
        if (wait > 0) await sleep(wait);
      }
      lastByHost.set(host, now());
    });
    chainByHost.set(host, slot.catch(() => undefined));
    await slot;
  }

  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (!options.skipRobots && !(await isAllowed(url, KARJOO_USER_AGENT, { fetchImpl: inner }))) {
      throw new RobotsDisallowedError(url);
    }

    await takeSlot(new URL(url).host);

    const headers = new Headers(init.headers);
    headers.set("user-agent", KARJOO_USER_AGENT);
    if (!headers.has("accept-language")) headers.set("accept-language", "fa-IR,fa;q=0.9,en;q=0.8");
    headers.delete("cookie");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // `credentials` is a browser concept; the extension modules pass it and
      // Node ignores it — this client never sends cookies either way.
      const { credentials: _credentials, ...rest } = init;
      void _credentials;
      return await inner(url, { ...rest, headers, signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}
