/**
 * تستِ لایه‌ی store علاقه‌مندی (Track B) — DB کاملاً mock می‌شود (بدون DB/شبکه).
 *
 * تمرکز: جایگزینیِ کاملِ user_interests، حذفِ slugِ ناشناخته، مقیدسازیِ همه‌ی کوئری‌ها
 * به userId (§10)، و همگام‌سازیِ titles/categories در preferencesِ پروفایل (و گذشتن
 * بی‌خطا وقتی پروفایلی نیست).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ───────────────────────────  mock DB قابلِ پیکربندی  ───────────────────────── */

const h = vi.hoisted(() => {
  return {
    // صف‌های نتیجه‌ی select (به ترتیبِ فراخوانی مصرف می‌شوند).
    selectQueue: [] as unknown[][],
    deleteCalls: [] as unknown[],
    insertValues: [] as unknown[],
    updateSets: [] as unknown[],
  };
});

/** یک query-builderِ زنجیره‌ایِ thenable که نتیجه‌ی بعدیِ صف را برمی‌گرداند. */
function makeSelectBuilder() {
  const rows = h.selectQueue.shift() ?? [];
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "limit", "orderBy"]) {
    builder[m] = () => builder;
  }
  builder.then = (resolve: (r: unknown[]) => unknown) => Promise.resolve(resolve(rows));
  return builder;
}

function makeTx() {
  return {
    select: vi.fn(() => makeSelectBuilder()),
    delete: vi.fn(() => ({
      where: (w: unknown) => {
        h.deleteCalls.push(w);
        return Promise.resolve(undefined);
      },
    })),
    insert: vi.fn(() => ({
      values: (v: unknown) => {
        h.insertValues.push(v);
        return Promise.resolve(undefined);
      },
    })),
    update: vi.fn(() => ({
      set: (s: unknown) => {
        h.updateSets.push(s);
        return { where: () => Promise.resolve(undefined) };
      },
    })),
  };
}

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => makeSelectBuilder()),
    transaction: vi.fn((cb: (tx: unknown) => unknown) => cb(makeTx())),
  },
}));

import { getSelectedSlugs, replaceInterests } from "@/lib/interests/store";

beforeEach(() => {
  h.selectQueue.length = 0;
  h.deleteCalls.length = 0;
  h.insertValues.length = 0;
  h.updateSets.length = 0;
  vi.clearAllMocks();
});

describe("getSelectedSlugs", () => {
  it("slugها را به ترتیبِ sortOrder برمی‌گرداند", async () => {
    h.selectQueue.push([
      { slug: "finance-accounting", sortOrder: 110 },
      { slug: "software-development", sortOrder: 10 },
    ]);
    const slugs = await getSelectedSlugs("u1");
    expect(slugs).toEqual(["software-development", "finance-accounting"]);
  });

  it("خالی → آرایه‌ی خالی", async () => {
    h.selectQueue.push([]);
    expect(await getSelectedSlugs("u1")).toEqual([]);
  });
});

describe("replaceInterests", () => {
  it("slugهای معتبر → حذفِ قبلی‌ها + درجِ تازه‌ها + همگام‌سازیِ پروفایل", async () => {
    // select #1: ردیف‌های دسته برای slugهای ورودی.
    h.selectQueue.push([
      { id: "cat-sw", slug: "software-development" },
      { id: "cat-data", slug: "data-ai" },
    ]);
    // select #2: پروفایلِ کاربر (وجود دارد).
    h.selectQueue.push([{ id: "prof-1", preferences: { cities: ["تهران"] } }]);

    const result = await replaceInterests("u1", ["software-development", "data-ai"]);

    expect(result.appliedSlugs).toEqual(["software-development", "data-ai"]);
    expect(result.count).toBe(2);

    // delete فراخوانی شد (جایگزینیِ کامل).
    expect(h.deleteCalls).toHaveLength(1);

    // insert با هر دو دسته، مقید به userId.
    const inserted = h.insertValues[0] as { userId: string; categoryId: string }[];
    expect(inserted).toEqual([
      { userId: "u1", categoryId: "cat-sw" },
      { userId: "u1", categoryId: "cat-data" },
    ]);

    // preferences همگام شد: titles/categories بازنویسی، cities نگه داشته.
    const set = h.updateSets[0] as { preferences: Record<string, unknown> };
    expect(set.preferences.categories).toEqual(["software-development", "data-ai"]);
    expect(set.preferences.cities).toEqual(["تهران"]);
    expect(Array.isArray(set.preferences.titles)).toBe(true);
  });

  it("slugِ ناشناخته در نتیجه‌ی DB نیست → اعمال نمی‌شود", async () => {
    // فقط یک دسته‌ی معتبر از DB برمی‌گردد (دیگری ناشناخته بود).
    h.selectQueue.push([{ id: "cat-sw", slug: "software-development" }]);
    h.selectQueue.push([]); // پروفایلی نیست.

    const result = await replaceInterests("u1", ["software-development", "ghost"]);
    expect(result.appliedSlugs).toEqual(["software-development"]);
    expect(result.count).toBe(1);
  });

  it("آرایه‌ی خالی → فقط حذف، بدونِ insert", async () => {
    h.selectQueue.push([]); // پروفایلی نیست.
    const result = await replaceInterests("u1", []);
    expect(result.count).toBe(0);
    expect(h.deleteCalls).toHaveLength(1);
    expect(h.insertValues).toHaveLength(0);
  });

  it("بدونِ پروفایل → همگام‌سازیِ preferences رخ نمی‌دهد (بدون خطا)", async () => {
    h.selectQueue.push([{ id: "cat-sw", slug: "software-development" }]);
    h.selectQueue.push([]); // پروفایل: خالی.

    const result = await replaceInterests("u1", ["software-development"]);
    expect(result.count).toBe(1);
    expect(h.updateSets).toHaveLength(0);
  });
});
