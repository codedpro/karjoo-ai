import { describe, expect, it, vi } from "vitest";
import {
  discoverKarboomListings,
  parseKarboomCard,
  parseKarboomPage,
  parseRelativePersianDate,
  resolveKarboomCityIds,
} from "@ext/lib/karboom-discovery";

const NOW = Date.parse("2026-09-02T12:00:00Z");

/** یک کارت، با همان ساختاری که کاربوم واقعاً می‌فرستد (نمونه‌ی زنده). */
function card(options: {
  code: string;
  title: string;
  company: string;
  city: string;
  posted: string;
}): string {
  return `js-job-position-card job-position-card-active"
     data-href="https://karboom.io/jobs/${options.code}/%D8%B4%D8%BA%D9%84">
<div class="box-intro js-job-item" data-url="https://karboom.io/jobs/details/${options.code}">
<img class="company-logo lazy" alt="${options.company}">
<h3 class="sm-title-size"><a class="no-text-decoration" title="${options.title}"
   href="https://karboom.io/jobs/${options.code}/x">${options.title}</a></h3>
<span class="company-name ellipsis-text m-0">${options.company}</span>
<span class="p-x-5">-</span><span class="pull-right">${options.city}</span>
<p class="date sm-text-size m-0">${options.posted}</p>`;
}

const FRESH = card({
  code: "wjadpo",
  title: "استخدام کارشناس حقوقی",
  company: "شرکت کاغذسازی راشا",
  city: "تهران",
  posted: "۲ روز قبل",
});

describe("parseRelativePersianDate", () => {
  it("عددهای فارسی و واحدهای کاربوم را می‌فهمد", () => {
    expect(parseRelativePersianDate("۲ روز قبل", NOW)).toBe(NOW - 2 * 86_400_000);
    expect(parseRelativePersianDate("۱ هفته قبل", NOW)).toBe(NOW - 604_800_000);
    expect(parseRelativePersianDate("۵ ساعت قبل", NOW)).toBe(NOW - 5 * 3_600_000);
    expect(parseRelativePersianDate("دیروز", NOW)).toBe(NOW - 86_400_000);
    expect(parseRelativePersianDate("لحظاتی پیش", NOW)).toBe(NOW);
  });

  it("متنِ ناشناخته را null می‌دهد، نه تاریخِ حدسی", () => {
    expect(parseRelativePersianDate("چیز نامفهوم", NOW)).toBeNull();
    expect(parseRelativePersianDate("", NOW)).toBeNull();
  });
});

describe("parseKarboomCard", () => {
  it("کد، عنوان، شرکت و شهر را از کارتِ واقعی درمی‌آورد", () => {
    const listing = parseKarboomCard(FRESH, NOW)!;
    expect(listing.externalId).toBe("wjadpo");
    // پیشوندِ «استخدام» بخشی از عنوانِ شغل نیست.
    expect(listing.title).toBe("کارشناس حقوقی");
    expect(listing.company).toBe("شرکت کاغذسازی راشا");
    expect(listing.city).toBe("تهران");
    expect(listing.url).toContain("/jobs/wjadpo/");
    expect(Date.parse(listing.postedAt)).toBe(NOW - 2 * 86_400_000);
  });

  it("کارتِ بی‌تاریخ را دور می‌ریزد به‌جای اینکه تازه فرضش کند", () => {
    expect(parseKarboomCard(FRESH.replace("۲ روز قبل", "؟"), NOW)).toBeNull();
  });
});

describe("resolveKarboomCityIds", () => {
  it("نامِ فارسی را به شناسه‌ی عددی ترجمه می‌کند", () => {
    expect(resolveKarboomCityIds(["تهران", "مشهد"])).toEqual(["87", "130"]);
  });

  it("عدد را دست‌نخورده می‌گذارد و ناشناخته را حذف می‌کند", () => {
    // فرستادنِ نامِ ناشناخته باعث می‌شد کاربوم فیلتر را بی‌صدا نادیده بگیرد.
    expect(resolveKarboomCityIds(["87", "شهرِ ناموجود", ""])).toEqual(["87"]);
  });
});

describe("discoverKarboomListings", () => {
  function pageOf(cards: string[]): string {
    return `<div class="job-position-cards-box">${cards.join("\n")}</div>`;
  }

  it("شهر را به‌صورت address_city_id[] و صفحه را به‌صورت page می‌فرستد", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(urls.length === 1 ? pageOf([FRESH]) : pageOf([]), { status: 200 });
    }) as unknown as typeof fetch;

    await discoverKarboomListings({
      categoryKeys: ["programming-and-software"],
      cities: ["تهران"],
      employmentTypeKeys: [],
      remoteOnly: false,
      maxAgeDays: 45,
    }, fetchImpl, undefined, NOW);

    expect(urls[0]).toContain("/jobs/programming-and-software");
    expect(urls[0]).toContain("address_city_id%5B%5D=87");
    expect(urls[1]).toContain("page=2");
  });

  it("دسته و نوعِ همکاری را اشتراک می‌گیرد، چون کاربوم آن‌ها را با هم نمی‌پذیرد", async () => {
    const other = card({
      code: "zzzzzz", title: "استخدام حسابدار", company: "الف", city: "کرج", posted: "۱ روز قبل",
    });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/jobs/remote")) {
        // فقط zzzzzz دورکاری است.
        return new Response(url.includes("page=2") ? pageOf([]) : pageOf([other]), { status: 200 });
      }
      return new Response(url.includes("page=2") ? pageOf([]) : pageOf([FRESH, other]), { status: 200 });
    }) as unknown as typeof fetch;

    const listings = await discoverKarboomListings({
      categoryKeys: ["accounting-auditing"],
      cities: [],
      employmentTypeKeys: [],
      remoteOnly: true,
      maxAgeDays: 45,
    }, fetchImpl, undefined, NOW);

    expect(listings.map((l) => l.externalId)).toEqual(["zzzzzz"]);
  });

  it("آگهیِ کهنه‌تر از سقفِ تازگی را نمی‌آورد و صفحه‌گردی را متوقف می‌کند", async () => {
    const stale = card({
      code: "oldold", title: "استخدام قدیمی", company: "ب", city: "تهران", posted: "۳ ماه قبل",
    });
    const fetchImpl = vi.fn(async () => new Response(pageOf([FRESH, stale]), { status: 200 })) as unknown as typeof fetch;

    const listings = await discoverKarboomListings({
      categoryKeys: ["x"], cities: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45,
    }, fetchImpl, undefined, NOW);

    expect(listings.map((l) => l.externalId)).toEqual(["wjadpo"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("سقفِ تعداد را رعایت می‌کند تا کشف کلِ نوبت را نخورد", async () => {
    const fetchImpl = vi.fn(async () => new Response(pageOf([FRESH]), { status: 200 })) as unknown as typeof fetch;
    await discoverKarboomListings({
      categoryKeys: ["x"], cities: [], employmentTypeKeys: [], remoteOnly: false,
      maxAgeDays: 45, maxListings: 1,
    }, fetchImpl, undefined, NOW);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("خطای ۴۲۹ را با دلیلِ روشن بالا می‌دهد", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    await expect(discoverKarboomListings({
      categoryKeys: ["x"], cities: [], employmentTypeKeys: [], remoteOnly: false, maxAgeDays: 45,
    }, fetchImpl, undefined, NOW)).rejects.toThrow(/karboom_rate_limited/);
  });
});

describe("parseKarboomPage", () => {
  it("چند کارت را از یک صفحه بیرون می‌کشد", () => {
    const html = `<div>${FRESH}</div><div>${card({
      code: "aabbcc", title: "استخدام برنامه‌نویس", company: "ج", city: "شیراز", posted: "۱ روز قبل",
    })}</div>`;
    expect(parseKarboomPage(html, NOW).map((l) => l.externalId)).toEqual(["wjadpo", "aabbcc"]);
  });
});
