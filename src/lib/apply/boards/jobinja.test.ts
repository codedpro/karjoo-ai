/**
 * تست‌های پارسرِ جابینجا — کاملاً آفلاین.
 *
 * فیکسچرِ `__fixtures__/jobinja-search.html` یک برداشتِ واقعی از صفحه‌ی
 * `https://jobinja.ir/jobs` است (نمای خروج‌از‌حساب). این‌جا فقط پارس می‌کنیم؛
 * هیچ درخواست شبکه‌ای زده نمی‌شود. fetch هم در تستِ `scrapePublicWith` تزریق (mock)
 * می‌شود تا شبکه لمس نشود.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSearchUrl,
  jobinja,
  parseListingCard,
  parseSearchHtml,
} from "@/lib/apply/boards/jobinja";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
  join(here, "__fixtures__", "jobinja-search.html"),
  "utf8",
);

describe("jobinja.parseSearchHtml (فیکسچر واقعی)", () => {
  const listings = parseSearchHtml(fixtureHtml);

  it("همه‌ی ۲۰ آگهی صفحه را بدون تکرار استخراج می‌کند", () => {
    expect(listings.length).toBe(20);
    const ids = new Set(listings.map((l) => l.externalId));
    expect(ids.size).toBe(20); // یکتایی externalId
  });

  it("هر آگهی فیلدهای پایه و شکل id درست را دارد", () => {
    for (const l of listings) {
      expect(l.board).toBe("jobinja");
      expect(l.externalId).toMatch(/^[A-Za-z0-9]+$/);
      expect(l.id).toBe(`jobinja:${l.externalId}`);
      expect(l.title.length).toBeGreaterThan(0);
      // URL مطلقِ تمیز و بدون پارامترهای ردیابی.
      expect(l.url.startsWith("https://jobinja.ir/companies/")).toBe(true);
      expect(l.url).not.toContain("?");
      expect(l.url).not.toContain("_ref");
      // externalId باید همان short-id داخل URL باشد.
      expect(l.url).toContain(`/jobs/${l.externalId}/`);
    }
  });

  it("اولین آگهی را با عنوان/شرکت/شهر/تاریخ درست نرمال می‌کند", () => {
    const first = listings[0];
    expect(first.externalId).toBe("tO4x");
    expect(first.id).toBe("jobinja:tO4x");
    expect(first.title).toBe("مسئول اداری (خانم)");
    expect(first.company).toBe("رایان تدبیر ایتوک | Rayan Tadbir Etook");
    expect(first.city).toBe("تهران، تهران");
    // «(امروز)» باید بدون پرانتز نرمال شود.
    expect(first.postedAt).toBe("امروز");
  });

  it("تاریخ انتشار را بدون پرانتز و با نیم‌فاصله‌ی سالم درمی‌آورد", () => {
    const withDays = listings.find((l) => l.postedAt?.includes("روز پیش"));
    expect(withDays).toBeDefined();
    expect(withDays?.postedAt).not.toContain("(");
    expect(withDays?.postedAt).not.toContain(")");
  });

  it("در نمای خروج‌از‌حساب حقوق پشت لینک ورود است → salary خالی می‌ماند", () => {
    // هیچ آگهی نباید متنِ لینکِ «برای مشاهده حقوق وارد شوید» را به‌عنوان حقوق ثبت کند.
    for (const l of listings) {
      if (l.salary) {
        expect(l.salary).not.toContain("وارد شوید");
      }
    }
  });

  it("نام شرکت‌ها به‌درستی decode شده‌اند (entityها باز شده‌اند)", () => {
    for (const l of listings) {
      if (l.company) {
        expect(l.company).not.toContain("&amp;");
        expect(l.company).not.toContain("&zwnj;");
      }
    }
  });
});

describe("jobinja.parseListingCard (شاخه‌های مصنوعی)", () => {
  it("وقتی حقوقِ عمومی موجود است، salary را استخراج می‌کند", () => {
    const card = `
      <li class="o-listView__item c-jobListView__item">
        <h2 class="o-listView__itemTitle c-jobListView__title">
          <a class="c-jobListView__titleLink" href="https://jobinja.ir/companies/acme/jobs/AbC9/test-job?_ref=1">
            توسعه‌دهنده‌ی ارشد
          </a>
          <span class="c-jobListView__passedDays">(۳ روز پیش)</span>
        </h2>
        <ul class="c-jobListView__meta">
          <li class="c-jobListView__metaItem">
            <i class="c-jobListView__metaItemIcon c-icon c-icon--construction"></i>
            <span>آکمه</span>
          </li>
          <li class="c-jobListView__metaItem">
            <i class="c-jobListView__metaItemIcon c-icon c-icon--place"></i>
            <span>تهران</span>
          </li>
          <li class="c-jobListView__metaItem">
            <i class="c-jobListView__metaItemIcon c-icon c-icon--resume"></i>
            <span>
              <span>تمام&zwnj;وقت</span>
              از ۲۰ میلیون تومان
            </span>
          </li>
        </ul>
      </li>`;
    const listing = parseListingCard(card);
    expect(listing).not.toBeNull();
    expect(listing?.id).toBe("jobinja:AbC9");
    expect(listing?.externalId).toBe("AbC9");
    expect(listing?.title).toBe("توسعه‌دهنده‌ی ارشد");
    expect(listing?.company).toBe("آکمه");
    expect(listing?.city).toBe("تهران");
    expect(listing?.postedAt).toBe("۳ روز پیش");
    expect(listing?.salary).toContain("تومان");
    expect(listing?.url).toBe("https://jobinja.ir/companies/acme/jobs/AbC9/test-job");
  });

  it("کارت بدون لینک عنوان معتبر را با null رد می‌کند (برداشت نمی‌شکند)", () => {
    const broken = `<li class="c-jobListView__item"><div>بدون لینک</div></li>`;
    expect(parseListingCard(broken)).toBeNull();
  });
});

describe("jobinja.buildSearchUrl", () => {
  it("کلیدواژه و شهرها را به پارامترهای فیلتر جابینجا نگاشت می‌کند", () => {
    const url = new URL(buildSearchUrl({ titles: ["برنامه‌نویس"], cities: ["تهران"] }, 1));
    expect(url.origin + url.pathname).toBe("https://jobinja.ir/jobs");
    expect(url.searchParams.get("filters[keywords][0]")).toBe("برنامه‌نویس");
    expect(url.searchParams.get("filters[locations][]")).toBe("تهران");
    // صفحه‌ی ۱ نباید پارامتر page بدهد.
    expect(url.searchParams.has("page")).toBe(false);
  });

  it("برای صفحه‌های بعدی پارامتر page را اضافه می‌کند", () => {
    const url = new URL(buildSearchUrl({}, 3));
    expect(url.searchParams.get("page")).toBe("3");
  });
});

describe("jobinja.scrapePublicWith (fetch تزریق‌شده — بدون شبکه)", () => {
  it("HTML را از fetch تزریقی می‌گیرد و آگهی‌های نرمال‌شده برمی‌گرداند", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      // صفحه‌ی اول: فیکسچر واقعی؛ صفحه‌های بعدی: خالی → توقف زودهنگام.
      const body = calls === 1 ? fixtureHtml : "<html><body>no jobs</body></html>";
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    };

    const result = await jobinja.scrapePublicWith(
      { titles: ["مسئول اداری"] },
      { fetchImpl: fakeFetch, maxPages: 2, delayMs: 0 },
    );

    expect(result.listings.length).toBe(20);
    expect(result.listings[0]?.board).toBe("jobinja");
    expect(result.listings[0]?.id).toMatch(/^jobinja:/);
    // صفحه‌ی دوم خالی بود؛ پس fetch دو بار صدا شد و بعدش متوقف شد.
    expect(calls).toBe(2);
    // صفحه‌ی دوم خالی → به انتها رسیدیم (مکان‌نما باید به ۱ بازنشانی شود).
    expect(result.pagesFetched).toBe(2);
    expect(result.reachedEnd).toBe(true);
  });

  it("از startPage آغاز می‌کند و در رسیدن به targetCount می‌ایستد (reachedEnd=false)", async () => {
    // کارتِ حداقلی و معتبر برای parseSearchHtml: بلوکِ c-jobListView__item با titleLink و
    // shortIdِ الفبی-عددی (بدون _). هر صفحه ۲۰ آگهیِ یکتا تولید می‌کند.
    const card = (id: string): string =>
      `<li class="c-jobListView__item">` +
      `<a class="c-jobListView__titleLink" href="/companies/acme/jobs/${id}/t">عنوان</a>` +
      `</li>`;
    const pages: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      pages.push(String(input));
      const n = pages.length;
      const rows = Array.from({ length: 20 }, (_, i) => card(`P${n}a${i}`)).join("");
      return new Response(`<ul>${rows}</ul>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    };

    const result = await jobinja.scrapePublicWith(
      { titles: ["x"] },
      { fetchImpl: fakeFetch, maxPages: 5, startPage: 4, targetCount: 25, delayMs: 0 },
    );

    // targetCount=25 با ۲۰ آگهی در هر صفحه → دو صفحه واکشی می‌شود، نه انتها.
    expect(result.listings.length).toBeGreaterThanOrEqual(25);
    expect(result.pagesFetched).toBe(2);
    expect(result.reachedEnd).toBe(false);
    // باید از صفحه‌ی ۴ آغاز کرده باشد.
    expect(pages[0]).toContain("page=4");
    expect(pages[1]).toContain("page=5");
  });

  it("با stopWhenStaleDays روی صفحه‌ی قدیمی متوقف می‌شود", async () => {
    const card = (id: string, posted: string): string =>
      `<li class="c-jobListView__item">` +
      `<a class="c-jobListView__titleLink" href="/companies/acme/jobs/${id}/t">عنوان</a>` +
      `<span class="c-jobListView__passedDays">(${posted})</span>` +
      `</li>`;
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls += 1;
      const rows =
        calls === 1
          ? card("Fresh1", "امروز") + card("Fresh2", "۳ روز پیش")
          : card("Old1", "۲ ماه پیش") + card("Old2", "۳ ماه پیش");
      return new Response(`<ul>${rows}</ul>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    };

    const result = await jobinja.scrapePublicWith(
      { sort: "published_at_desc" },
      {
        fetchImpl: fakeFetch,
        maxPages: Number.POSITIVE_INFINITY,
        stopWhenStaleDays: 45,
        delayMs: 0,
      },
    );

    expect(result.listings.map((job) => job.externalId)).toEqual(["Fresh1", "Fresh2"]);
    expect(result.pagesFetched).toBe(2);
    expect(result.reachedEnd).toBe(true);
  });

  it("روی پاسخ غیر-200 خطای روشن پرتاب می‌کند", async () => {
    const failingFetch: typeof fetch = async () =>
      new Response("nope", { status: 503 });
    await expect(
      jobinja.scrapePublicWith({}, { fetchImpl: failingFetch, maxPages: 1, delayMs: 0 }),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("jobinja.search / apply هنوز پیاده نشده‌اند", () => {
  it("search خطای not implemented می‌دهد", async () => {
    await expect(jobinja.search({})).rejects.toThrow(/not implemented/);
  });
  it("apply خطای not implemented می‌دهد", async () => {
    const job = parseSearchHtml(fixtureHtml)[0];
    await expect(jobinja.apply(job, { fullName: "x", skills: [] }, "نامه")).rejects.toThrow(
      /not implemented/,
    );
  });
});
