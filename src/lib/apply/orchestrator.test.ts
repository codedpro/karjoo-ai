/**
 * تست‌های واحدِ خطِ لوله‌ی runAutoApply — بدون DB/شبکه‌ی زنده.
 *
 * همه‌چیز mock می‌شود: کانکتورها (scrapePublic)، scoreAndDraft، enqueueِ صف، و یک
 * dbِ جعلیِ سبک که زنجیره‌ی fluentِ Drizzle (insert/update/select) را تقلید می‌کند و
 * فراخوانی‌ها را ثبت می‌کند. هدف: قفل‌کردنِ قراردادِ pipeline:
 *   ingest → persist → score → match(threshold) → enqueue(dedupe + daily-cap)
 * و این تضمینِ ایمنی که ارکستریتور هرگز connector.apply را صدا نمی‌زند.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runAutoApply,
  DEFAULT_MATCH_THRESHOLD,
  DEFAULT_DAILY_CAP,
} from "@/lib/apply/orchestrator";
import type {
  ApplicationResult,
  CandidateProfile,
  JobBoardConnector,
  JobListing,
} from "@/lib/apply/types";

/* ───────────────────────────────  fixtures  ───────────────────────────── */

const profile: CandidateProfile = {
  fullName: "آزمون",
  skills: ["typescript", "node"],
  preferences: { titles: ["برنامه‌نویس"], cities: ["تهران"] },
};

function listing(id: string, over: Partial<JobListing> = {}): JobListing {
  return {
    id: `jobinja:${id}`,
    board: "jobinja",
    externalId: id,
    title: `شغل ${id}`,
    url: `https://jobinja.ir/jobs/${id}`,
    ...over,
  };
}

/** کانکتورِ جعلی که فهرستِ ثابتی برمی‌گرداند و apply را اگر صدا شود می‌شکند. */
function fakeConnector(listings: JobListing[]): JobBoardConnector & {
  applyCalls: number;
} {
  const c = {
    id: "jobinja" as const,
    displayName: "جابینجا",
    applyType: "structured" as const,
    sessionShape: "cookie" as const,
    applyCalls: 0,
    async scrapePublic() {
      return listings;
    },
    async search() {
      return listings;
    },
    async apply(): Promise<ApplicationResult> {
      c.applyCalls += 1;
      throw new Error("apply نباید توسط ارکستریتور صدا زده شود");
    },
  };
  return c;
}

/**
 * dbِ جعلی: زنجیره‌ی Drizzle را تقلید می‌کند.
 *   • insert(...).values(...).onConflictDoUpdate(...).returning(...) → ردیفِ match/listing
 *   • update(...).set(...).where(...) → no-op
 *   • select(...).from(...).where(...) → شمارشِ سقف روزانه
 * هر آگهیِ ورودی یک listingId و matchId قطعی می‌گیرد.
 */
function makeFakeDb(opts: {
  queuedToday?: number;
  /** وضعیتِ از-پیش‌موجودِ match پس از upsert، به‌ازای externalId (برای تستِ dedupe). */
  matchStatusByExternal?: Record<string, string>;
}) {
  const inserts: { table: string; values: unknown }[] = [];
  const updates: { set: unknown }[] = [];
  let countCalls = 0;

  const tableName = (t: unknown): string => {
    const sym = Object.getOwnPropertySymbols(t as object).find((s) =>
      String(s).includes("Name"),
    );
    return sym ? String((t as Record<symbol, unknown>)[sym]) : "unknown";
  };

  const db = {
    insert(table: unknown) {
      const name = tableName(table);
      let captured: Record<string, unknown> = {};
      const chain = {
        values(v: Record<string, unknown>) {
          captured = v;
          inserts.push({ table: name, values: v });
          return chain;
        },
        onConflictDoUpdate() {
          return chain;
        },
        async returning() {
          if (name === "job_listings") {
            const ext = String(captured.externalId);
            return [{ id: `listing-${ext}`, ...captured }];
          }
          if (name === "matches") {
            const ext = String(captured.listingId).replace("listing-", "");
            const status =
              opts.matchStatusByExternal?.[ext] ?? (captured.status as string);
            return [{ id: `match-${ext}`, status }];
          }
          return [{ id: "x", ...captured }];
        },
      };
      // raw_listings: درج بدون returning (orchestrator مقدارش را نمی‌خواند).
      return chain as typeof chain & { then?: never };
    },
    update() {
      const chain = {
        set(s: unknown) {
          updates.push({ set: s });
          return chain;
        },
        async where() {
          return undefined;
        },
      };
      return chain;
    },
    select() {
      // زنجیره‌ای که هم `.from().where()` و هم `.from().innerJoin().where()` را پشتیبانی کند
      // (countQueuedToday حالا tasks را به matches join می‌کند).
      const chain = {
        innerJoin() {
          return chain;
        },
        async where() {
          countCalls += 1;
          return [{ n: opts.queuedToday ?? 0 }];
        },
      };
      return {
        from() {
          return chain;
        },
      };
    },
    // برای raw_listings که returning ندارد، insert(...).values(...) باید awaitable باشد.
    _stats: () => ({ inserts, updates, countCalls }),
  };
  return db;
}

/* ───────────────────────────────  tests  ──────────────────────────────── */

describe("runAutoApply — قراردادِ pipeline", () => {
  let enqueueFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    enqueueFn = vi.fn(async (input: { idempotencyKey: string; matchId: string }) => ({
      task: { id: `task-${input.matchId}` },
      created: true,
    }));
  });

  it("آگهیِ بالای آستانه را امتیاز می‌دهد، match می‌سازد و وارد صف می‌کند", async () => {
    const conn = makeFakeDb({});
    const connector = fakeConnector([listing("a")]);
    const scoreFn = vi.fn(async () => ({ matchScore: 0.9, coverLetter: "نامه" }));

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      connectors: { jobinja: connector },
      scoreFn,
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });

    expect(report.ingested).toBe(1);
    expect(report.persistedListings).toBe(1);
    expect(report.scored).toBe(1);
    expect(report.matchedAboveThreshold).toBe(1);
    expect(report.queued).toBe(1);
    expect(report.skippedByCap).toBe(0);
    expect(enqueueFn).toHaveBeenCalledOnce();
    expect(enqueueFn.mock.calls[0][0]).toMatchObject({
      idempotencyKey: "apply:match-a",
      matchId: "match-a",
    });
    // مرزِ ایمنی: ارکستریتور هرگز apply را صدا نمی‌زند.
    expect(connector.applyCalls).toBe(0);
  });

  it("آگهیِ زیرِ آستانه را match می‌کند ولی وارد صف نمی‌کند", async () => {
    const conn = makeFakeDb({});
    const connector = fakeConnector([listing("low")]);
    const scoreFn = vi.fn(async () => ({ matchScore: 0.2, coverLetter: "نامه" }));

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      connectors: { jobinja: connector },
      scoreFn,
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });

    expect(report.scored).toBe(1);
    expect(report.matchedAboveThreshold).toBe(0);
    expect(report.queued).toBe(0);
    expect(enqueueFn).not.toHaveBeenCalled();
  });

  it("آستانه قابلِ تنظیم است (threshold سفارشی)", async () => {
    const conn = makeFakeDb({});
    const connector = fakeConnector([listing("mid")]);
    const scoreFn = vi.fn(async () => ({ matchScore: 0.65, coverLetter: "ن" }));

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      threshold: 0.5, // ۰٫۶۵ ≥ ۰٫۵ → باید صف شود
      connectors: { jobinja: connector },
      scoreFn,
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });

    expect(report.queued).toBe(1);
  });

  it("سقفِ روزانه را رعایت می‌کند: مازاد، skippedByCap می‌شود نه queued", async () => {
    const conn = makeFakeDb({ queuedToday: 0 });
    const connector = fakeConnector([listing("a"), listing("b"), listing("c")]);
    const scoreFn = vi.fn(async () => ({ matchScore: 0.95, coverLetter: "ن" }));

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      dailyCap: 2, // فقط ۲ تا از ۳ آگهیِ واجدِ شرایط
      connectors: { jobinja: connector },
      scoreFn,
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });

    expect(report.matchedAboveThreshold).toBe(3);
    expect(report.queued).toBe(2);
    expect(report.skippedByCap).toBe(1);
    expect(enqueueFn).toHaveBeenCalledTimes(2);
  });

  it("سقفِ روزانه شاملِ اپلای‌های قبلیِ همان روز هم می‌شود", async () => {
    const conn = makeFakeDb({ queuedToday: 19 }); // ۱۹ از سقفِ ۲۰ پر است
    const connector = fakeConnector([listing("a"), listing("b")]);
    const scoreFn = vi.fn(async () => ({ matchScore: 0.95, coverLetter: "ن" }));

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      connectors: { jobinja: connector },
      scoreFn,
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });

    expect(report.queued).toBe(1); // فقط ۱ ظرفیتِ باقی‌مانده
    expect(report.skippedByCap).toBe(1);
  });

  it("dedupe: matchِ از-پیش 'queued' دوباره وارد صف نمی‌شود", async () => {
    const conn = makeFakeDb({ matchStatusByExternal: { a: "queued" } });
    const connector = fakeConnector([listing("a")]);
    const scoreFn = vi.fn(async () => ({ matchScore: 0.95, coverLetter: "ن" }));

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      connectors: { jobinja: connector },
      scoreFn,
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });

    expect(report.matchedAboveThreshold).toBe(1);
    expect(report.queued).toBe(0);
    expect(enqueueFn).not.toHaveBeenCalled();
  });

  it("matchِ 'dismissed' (ردشده توسط کاربر) وارد صف نمی‌شود", async () => {
    const conn = makeFakeDb({ matchStatusByExternal: { a: "dismissed" } });
    const connector = fakeConnector([listing("a")]);
    const scoreFn = vi.fn(async () => ({ matchScore: 0.95, coverLetter: "ن" }));

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      connectors: { jobinja: connector },
      scoreFn,
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });

    expect(report.queued).toBe(0);
    expect(enqueueFn).not.toHaveBeenCalled();
  });

  it("enqueue که created=false بدهد (idempotent reuse)، queued را زیاد نمی‌کند", async () => {
    const conn = makeFakeDb({});
    const connector = fakeConnector([listing("a")]);
    const scoreFn = vi.fn(async () => ({ matchScore: 0.95, coverLetter: "ن" }));
    const idemEnqueue = vi.fn(async () => ({ task: { id: "t" }, created: false }));

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      connectors: { jobinja: connector },
      scoreFn,
      enqueueFn: idemEnqueue as never,
      db: conn as never,
    });

    expect(idemEnqueue).toHaveBeenCalledOnce();
    expect(report.queued).toBe(0); // created=false → شمارش نمی‌شود
  });

  it("کانکتورِ ثبت‌نشده را به‌جای کرش، به errors اضافه می‌کند", async () => {
    const conn = makeFakeDb({});
    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobvision"],
      connectors: {}, // jobvision ثبت نشده
      scoreFn: vi.fn(),
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });
    expect(report.errors.some((e) => e.includes("jobvision"))).toBe(true);
    expect(report.queued).toBe(0);
  });

  it("خطای scoreAndDraft روی یک آگهی، اجرا را نمی‌شکند (ثبت در errors، ادامه)", async () => {
    const conn = makeFakeDb({});
    const connector = fakeConnector([listing("bad"), listing("good")]);
    const scoreFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValueOnce({ matchScore: 0.9, coverLetter: "ن" });

    const report = await runAutoApply(profile, {
      userId: "u1",
      boards: ["jobinja"],
      connectors: { jobinja: connector },
      scoreFn: scoreFn as never,
      enqueueFn: enqueueFn as never,
      db: conn as never,
    });

    expect(report.scored).toBe(1); // فقط good امتیاز گرفت
    expect(report.queued).toBe(1);
    expect(report.errors.some((e) => e.includes("gateway down"))).toBe(true);
  });

  it("پیش‌فرض‌ها صادر شده‌اند (آستانه و سقف)", () => {
    expect(DEFAULT_MATCH_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_MATCH_THRESHOLD).toBeLessThanOrEqual(1);
    expect(DEFAULT_DAILY_CAP).toBeGreaterThan(0);
  });
});
