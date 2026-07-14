/**
 * تست‌های واحدِ robots.txt — کاملاً آفلاین (fetch تزریق‌شده، کش کنترل‌شده).
 *
 * موردِ کلیدی (بخش ۱۰ سند): robots.txtِ جابینجا فقط `/style_guide/` را منع می‌کند؛
 * پس `/jobs` باید «مجاز» باشد.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  KARJOO_USER_AGENT,
  clearRobotsCache,
  getRobotsFor,
  isAllowed,
  isPathAllowed,
  matchesPattern,
  parseRobotsTxt,
} from "@/lib/apply/robots";

afterEach(() => clearRobotsCache());

/** robots.txtِ شبیه‌سازی‌شده‌ی جابینجا (طبق بخش ۱۰ سند). */
const JOBINJA_ROBOTS = `
User-agent: *
Disallow: /style_guide/
`;

function fetchReturning(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "content-type": "text/plain" },
    })) as unknown as typeof fetch;
}

describe("parseRobotsTxt", () => {
  it("گروهِ * با Disallow را پارس می‌کند", () => {
    const parsed = parseRobotsTxt(JOBINJA_ROBOTS);
    expect(parsed.groups.has("*")).toBe(true);
    const rules = parsed.groups.get("*")!;
    expect(rules).toEqual([{ type: "disallow", pattern: "/style_guide/" }]);
  });

  it("کامنت‌ها و خطوطِ خالی را نادیده می‌گیرد", () => {
    const parsed = parseRobotsTxt(`
# a comment
User-agent: *

Disallow: /private   # inline comment
Allow: /private/ok
`);
    expect(parsed.groups.get("*")).toEqual([
      { type: "disallow", pattern: "/private" },
      { type: "allow", pattern: "/private/ok" },
    ]);
  });

  it("چند User-agent پشتِ‌سرِهم یک گروهِ مشترک می‌سازند", () => {
    const parsed = parseRobotsTxt(`
User-agent: foo
User-agent: bar
Disallow: /x
`);
    expect(parsed.groups.get("foo")).toEqual([{ type: "disallow", pattern: "/x" }]);
    expect(parsed.groups.get("bar")).toEqual([{ type: "disallow", pattern: "/x" }]);
  });
});

describe("matchesPattern", () => {
  it("تطبیقِ پیشوندی", () => {
    expect(matchesPattern("/jobs", "/jobs")).toBe(true);
    expect(matchesPattern("/jobs", "/jobs/123")).toBe(true);
    expect(matchesPattern("/jobs", "/companies")).toBe(false);
  });

  it("از * (هر دنباله) پشتیبانی می‌کند", () => {
    expect(matchesPattern("/a/*/c", "/a/b/c")).toBe(true);
    expect(matchesPattern("/a/*.pdf", "/a/x/y.pdf")).toBe(true);
  });

  it("$ مسیر را به انتها لنگر می‌زند", () => {
    expect(matchesPattern("/x$", "/x")).toBe(true);
    expect(matchesPattern("/x$", "/x/y")).toBe(false);
  });
});

describe("isPathAllowed — موردِ جابینجا", () => {
  const jobinja = parseRobotsTxt(JOBINJA_ROBOTS);

  it("/jobs مجاز است (فقط /style_guide/ منع شده)", () => {
    expect(isPathAllowed(jobinja, "/jobs")).toBe(true);
    expect(isPathAllowed(jobinja, "/jobs?filters[keywords][0]=x")).toBe(true);
  });

  it("/style_guide/ منع است", () => {
    expect(isPathAllowed(jobinja, "/style_guide/")).toBe(false);
    expect(isPathAllowed(jobinja, "/style_guide/buttons")).toBe(false);
  });
});

describe("isPathAllowed — خاص‌ترین قاعده برنده است", () => {
  const parsed = parseRobotsTxt(`
User-agent: *
Disallow: /private
Allow: /private/public
`);

  it("Disallowِ کلی، Allowِ خاص‌تر را نقض نمی‌کند", () => {
    expect(isPathAllowed(parsed, "/private/secret")).toBe(false);
    expect(isPathAllowed(parsed, "/private/public/x")).toBe(true); // خاص‌تر → allow
  });

  it("در تساویِ طول، Allow بر Disallow اولویت دارد", () => {
    const tie = parseRobotsTxt(`
User-agent: *
Disallow: /p
Allow: /p
`);
    expect(isPathAllowed(tie, "/p/x")).toBe(true);
  });

  it("Disallow خالی = اجازه‌ی همه‌چیز", () => {
    const open = parseRobotsTxt(`
User-agent: *
Disallow:
`);
    expect(isPathAllowed(open, "/anything")).toBe(true);
  });
});

describe("isPathAllowed — گروهِ خاصِ user-agent", () => {
  const parsed = parseRobotsTxt(`
User-agent: *
Disallow:

User-agent: KarjooBot
Disallow: /no-bots
`);

  it("خاص‌ترین گروهِ منطبق با UAِ ما (KarjooBot) انتخاب می‌شود", () => {
    // UAِ ما شاملِ توکنِ karjoobot است → گروهِ خاص اعمال می‌شود.
    expect(isPathAllowed(parsed, "/no-bots", KARJOO_USER_AGENT)).toBe(false);
    expect(isPathAllowed(parsed, "/ok", KARJOO_USER_AGENT)).toBe(true);
  });

  it("UAِ بی‌ربط به گروهِ * می‌افتد (همه مجاز)", () => {
    expect(isPathAllowed(parsed, "/no-bots", "SomeOtherCrawler/2.0")).toBe(true);
  });
});

describe("getRobotsFor — fetch + cache", () => {
  it("یک‌بار fetch می‌کند و سپس از کش می‌خواند", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => {
      calls += 1;
      return new Response(JOBINJA_ROBOTS, { status: 200 });
    }) as unknown as typeof fetch;

    const now = () => 1_000;
    await getRobotsFor("https://jobinja.ir", { fetchImpl, now });
    await getRobotsFor("https://jobinja.ir", { fetchImpl, now });
    expect(calls).toBe(1); // دومی از کش
  });

  it("۴۰۴/خطا → ParsedRobotsِ خالی (اجازه‌ی همه‌چیز) و کش‌شده", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = (async () => {
      calls += 1;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const parsed = await getRobotsFor("https://x.example", { fetchImpl, now: () => 0 });
    expect(parsed.groups.size).toBe(0);
    expect(isPathAllowed(parsed, "/anything")).toBe(true);
    // دومی هم نباید دوباره fetch کند (نتیجه‌ی منفی هم کش می‌شود).
    await getRobotsFor("https://x.example", { fetchImpl, now: () => 0 });
    expect(calls).toBe(1);
  });

  it("خطای شبکه (throw) → fail-open (اجازه)", async () => {
    const fetchImpl: typeof fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const parsed = await getRobotsFor("https://down.example", { fetchImpl, now: () => 0 });
    expect(isPathAllowed(parsed, "/jobs")).toBe(true);
  });
});

describe("isAllowed (URLِ کامل)", () => {
  it("/jobs روی جابینجا مجاز است", async () => {
    const fetchImpl = fetchReturning(JOBINJA_ROBOTS);
    const ok = await isAllowed("https://jobinja.ir/jobs?page=2", KARJOO_USER_AGENT, {
      fetchImpl,
      now: () => 0,
    });
    expect(ok).toBe(true);
  });

  it("/style_guide/ روی جابینجا منع است", async () => {
    const fetchImpl = fetchReturning(JOBINJA_ROBOTS);
    const ok = await isAllowed("https://jobinja.ir/style_guide/x", KARJOO_USER_AGENT, {
      fetchImpl,
      now: () => 0,
    });
    expect(ok).toBe(false);
  });

  it("URLِ نامعتبر → false", async () => {
    expect(await isAllowed("not-a-url")).toBe(false);
  });
});

describe("اتصالِ robots به jobinja.scrapePublicWith", () => {
  it("اگر robots مسیر را منع کند، صفحه واکشی نمی‌شود (skip مودبانه)", async () => {
    const { jobinja } = await import("@/lib/apply/boards/jobinja");
    let pageFetches = 0;
    const fetchImpl: typeof fetch = (async () => {
      pageFetches += 1;
      return new Response("<html></html>", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await jobinja.scrapePublicWith(
      { titles: ["x"] },
      { fetchImpl, maxPages: 2, delayMs: 0, isAllowed: async () => false },
    );

    expect(result.listings).toEqual([]);
    expect(result.reachedEnd).toBe(true); // منعِ robots = انتها (مکان‌نما بازنشانی)
    expect(pageFetches).toBe(0); // هیچ صفحه‌ای واکشی نشد
  });

  it("اگر robots اجازه دهد، واکشی طبقِ معمول انجام می‌شود", async () => {
    const { jobinja } = await import("@/lib/apply/boards/jobinja");
    let pageFetches = 0;
    const fetchImpl: typeof fetch = (async () => {
      pageFetches += 1;
      return new Response("<html></html>", { status: 200 });
    }) as unknown as typeof fetch;

    await jobinja.scrapePublicWith(
      { titles: ["x"] },
      { fetchImpl, maxPages: 1, delayMs: 0, isAllowed: async () => true },
    );

    expect(pageFetches).toBe(1);
  });
});
