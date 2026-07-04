/**
 * تست‌های واحدِ منبعِ دسته‌بندی‌های جابینجا — بدونِ شبکه‌ی واقعی (fetch/store تزریقی).
 */
import { describe, expect, it, vi } from "vitest";

import {
  FALLBACK_CATEGORIES,
  getJobinjaCategories,
  mapRawCategories,
  type CategoryCacheStore,
} from "@/lib/apply/boards/jobinja-categories";

/** fetchِ جعلیِ موفق که آرایه‌ی خام را برمی‌گرداند. */
function okFetch(raw: unknown): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => raw,
  })) as unknown as typeof fetch;
}

/** fetchِ جعلی که خطا می‌دهد (شبکه down). */
const failFetch = (async () => {
  throw new Error("network down");
}) as unknown as typeof fetch;

const RAW_SAMPLE = [
  { id: 1, machine_name: "وب،‌-برنامه‌نویسی-و-نرم‌افزار", name: "وب و نرم‌افزار", english_name: "web" },
  { id: 2, machine_name: "طراحی", name: "طراحی", english_name: "Designing\n" },
];

describe("mapRawCategories", () => {
  it("آرایه‌ی معتبر را به {slug,name,englishName} نگاشت می‌کند", () => {
    const out = mapRawCategories(RAW_SAMPLE);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      slug: "وب،‌-برنامه‌نویسی-و-نرم‌افزار",
      name: "وب و نرم‌افزار",
      englishName: "web",
    });
    // english_name با newline تمیز می‌شود.
    expect(out[1].englishName).toBe("Designing");
  });

  it("آیتم‌های بی‌machine_name/بی‌name را کنار می‌گذارد", () => {
    const out = mapRawCategories([
      { machine_name: "", name: "x" },
      { machine_name: "ok", name: "" },
      { name: "no-slug" },
      { machine_name: "valid", name: "معتبر" },
    ]);
    expect(out).toEqual([{ slug: "valid", name: "معتبر", englishName: "" }]);
  });

  it("اسلاگِ تکراری را حذف می‌کند و ورودیِ غیرآرایه → []", () => {
    const dup = mapRawCategories([
      { machine_name: "a", name: "الف" },
      { machine_name: "a", name: "الف دوم" },
    ]);
    expect(dup).toHaveLength(1);
    expect(mapRawCategories(null)).toEqual([]);
    expect(mapRawCategories({})).toEqual([]);
  });
});

describe("getJobinjaCategories", () => {
  it("واکشیِ موفق → source='live' و لیستِ نرمال‌شده", async () => {
    const store: CategoryCacheStore = { value: null };
    const out = await getJobinjaCategories({ fetchImpl: okFetch(RAW_SAMPLE), store, now: 1000 });
    expect(out.source).toBe("live");
    expect(out.categories).toHaveLength(2);
    // کش پُر شد.
    expect(store.value?.data).toHaveLength(2);
  });

  it("کشِ تازه → source='cache' بدونِ واکشیِ دوباره", async () => {
    const store: CategoryCacheStore = { value: { at: 1000, data: RAW_SAMPLE.map((r) => ({ slug: r.machine_name, name: r.name, englishName: "x" })) } };
    const spy = vi.fn(okFetch(RAW_SAMPLE));
    const out = await getJobinjaCategories({ fetchImpl: spy as unknown as typeof fetch, store, now: 2000, ttlMs: 10_000 });
    expect(out.source).toBe("cache");
    expect(spy).not.toHaveBeenCalled();
  });

  it("خطای شبکه + کشِ خالی → source='fallback' (لیستِ داخلی، بدونِ throw)", async () => {
    const store: CategoryCacheStore = { value: null };
    const out = await getJobinjaCategories({ fetchImpl: failFetch, store, now: 1000 });
    expect(out.source).toBe("fallback");
    expect(out.categories).toBe(FALLBACK_CATEGORIES);
    expect(out.categories.length).toBeGreaterThan(0);
  });

  it("خطای شبکه + کشِ کهنه → source='cache' (دادهٔ قبلی حفظ)", async () => {
    const stale = [{ slug: "old", name: "قدیمی", englishName: "" }];
    const store: CategoryCacheStore = { value: { at: 0, data: stale } };
    const out = await getJobinjaCategories({ fetchImpl: failFetch, store, now: 999_999, ttlMs: 1 });
    expect(out.source).toBe("cache");
    expect(out.categories).toBe(stale);
  });

  it("پاسخِ خالی/نامعتبر → fallback (نه لیستِ خالی)", async () => {
    const store: CategoryCacheStore = { value: null };
    const out = await getJobinjaCategories({ fetchImpl: okFetch([]), store, now: 1000 });
    expect(out.source).toBe("fallback");
  });
});
