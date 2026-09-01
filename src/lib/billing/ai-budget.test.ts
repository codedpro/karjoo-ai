/**
 * تست‌های گاردریلِ بودجه‌ی هوش مصنوعی (ai-budget.ts) — با dbِ fakeِ تزریقی (بدونِ DB).
 *
 * fake فقط زنجیره‌های دقیقی را که این ماژول می‌زند پیاده می‌کند: select.from.where.limit
 * (خواندنِ بودجه/تنظیمات) و insert.values.onConflictDoUpdate (افزایش/تنظیم). state در
 * حافظه نگه‌داری می‌شود تا رفتارِ upsert و خواندن راستی‌آزمایی شود.
 */
import { describe, expect, it } from "vitest";

import {
  assertAiAvailable,
  currentMonthUpstreamToman,
  incrementMonthUpstream,
  isAiInMaintenance,
  maintenanceStatus,
  periodMonthOf,
} from "@/lib/billing/ai-budget";
import { AiMaintenanceError } from "@/lib/billing/errors";
import { DEFAULT_AI_MONTHLY_BUDGET_USD } from "@/lib/env";
import { appAiBudget, appSettings } from "@/db/schema";

/** زمانِ ثابت برای تعیین‌پذیریِ ماه (UTC): ژوئنِ ۲۰۲۶. */
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06
const PERIOD = "2026-06";

/**
 * یک dbِ fakeِ کمینه که جدول‌های in-memory را با همان زنجیره‌های Drizzle پشتیبانی می‌کند.
 * فقط آنچه ai-budget.ts استفاده می‌کند را پیاده می‌کند.
 */
function makeFakeDb() {
  const budget = new Map<string, number>(); // period → upstreamCostToman
  const settings = new Map<string, boolean>(); // key → aiMaintenanceManual

  function tableFor(table: unknown) {
    if (table === appAiBudget) return "budget" as const;
    if (table === appSettings) return "settings" as const;
    throw new Error("unexpected table in fake db");
  }

  const db = {
    select(_cols?: unknown) {
      return {
        from(table: unknown) {
          const which = tableFor(table);
          return {
            where(_cond: unknown) {
              return {
                async limit(_n: number) {
                  if (which === "budget") {
                    return budget.has(PERIOD)
                      ? [{ total: budget.get(PERIOD) }]
                      : [];
                  }
                  return settings.has("global")
                    ? [{ manual: settings.get("global") }]
                    : [];
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      const which = tableFor(table);
      return {
        values(vals: Record<string, unknown>) {
          return {
            async onConflictDoUpdate(_args: unknown) {
              if (which === "budget") {
                const period = vals.periodMonth as string;
                const inc = vals.upstreamCostToman as number;
                budget.set(period, (budget.get(period) ?? 0) + inc);
              } else {
                settings.set("global", vals.aiMaintenanceManual as boolean);
              }
            },
          };
        },
      };
    },
  };

  return { db: db as never, budget, settings };
}

describe("periodMonthOf", () => {
  it("ماه را به قالبِ YYYY-MM (UTC) برمی‌گرداند", () => {
    expect(periodMonthOf(NOW)).toBe(PERIOD);
    expect(periodMonthOf(Date.UTC(2026, 0, 1))).toBe("2026-01");
    expect(periodMonthOf(Date.UTC(2026, 11, 31))).toBe("2026-12");
  });
});

describe("incrementMonthUpstream / currentMonthUpstreamToman", () => {
  it("شمارنده‌ی ماه را به‌صورتِ جمع‌شونده افزایش می‌دهد", async () => {
    const { db } = makeFakeDb();
    expect(await currentMonthUpstreamToman(db, NOW)).toBe(0);
    await incrementMonthUpstream(600, db, NOW);
    await incrementMonthUpstream(400, db, NOW);
    expect(await currentMonthUpstreamToman(db, NOW)).toBe(1000);
  });

  it("مبلغِ ≤ ۰ را نادیده می‌گیرد (no-op)", async () => {
    const { db } = makeFakeDb();
    await incrementMonthUpstream(0, db, NOW);
    await incrementMonthUpstream(-50, db, NOW);
    expect(await currentMonthUpstreamToman(db, NOW)).toBe(0);
  });
});

// سقفِ تستی تزریق می‌شود (env در تست قابلِ stub نیست؛ snapshot در بوت). cap = ۷۰۰۰۰.
const CAP = 70_000;

describe("maintenanceStatus / isAiInMaintenance — سقفِ بودجه", () => {
  it("زیرِ سقف ⇒ بدونِ نگه‌داری", async () => {
    const { db } = makeFakeDb();
    await incrementMonthUpstream(69_999, db, NOW);
    const status = await maintenanceStatus(db, NOW, CAP);
    expect(status.capToman).toBe(CAP);
    expect(status.capReached).toBe(false);
    expect(status.inMaintenance).toBe(false);
    expect(await isAiInMaintenance(db, NOW, CAP)).toBe(false);
  });

  it("رسیدن به سقف ⇒ نگه‌داری (capReached)", async () => {
    const { db } = makeFakeDb();
    await incrementMonthUpstream(70_000, db, NOW);
    const status = await maintenanceStatus(db, NOW, CAP);
    expect(status.capReached).toBe(true);
    expect(status.inMaintenance).toBe(true);
    expect(status.manual).toBe(false);
  });

  it("سقفِ ۰ یا منفی ⇒ بدونِ سقف (سرویس قفل نمی‌شود)", async () => {
    const { db } = makeFakeDb();
    await incrementMonthUpstream(999_999, db, NOW);
    expect(await isAiInMaintenance(db, NOW, 0)).toBe(false);
  });
});

describe("maintenanceStatus — پرچمِ دستی", () => {
  it("پرچمِ دستیِ روشن ⇒ نگه‌داری حتی زیرِ سقف", async () => {
    const { db, settings } = makeFakeDb();
    settings.set("global", true);
    const status = await maintenanceStatus(db, NOW, CAP);
    expect(status.manual).toBe(true);
    expect(status.capReached).toBe(false);
    expect(status.inMaintenance).toBe(true);
  });
});

describe("assertAiAvailable", () => {
  it("در دسترس ⇒ بدونِ خطا", async () => {
    const { db } = makeFakeDb();
    await expect(assertAiAvailable(db, NOW, CAP)).resolves.toBeUndefined();
  });

  it("نگه‌داری ⇒ AiMaintenanceError", async () => {
    const { db } = makeFakeDb();
    await incrementMonthUpstream(70_000, db, NOW);
    const err = await assertAiAvailable(db, NOW, CAP).catch((e) => e);
    expect(err).toBeInstanceOf(AiMaintenanceError);
    expect((err as AiMaintenanceError).code).toBe("ai_maintenance");
  });
});

describe("the internal monthly cap is off by default", () => {
  it("does not halt AI on an estimated spend figure", () => {
    // The cap compared the month's total against Karjoo's own price estimates,
    // not real spend. On 2026-09-01 the internal meter read 2,105,279 toman while
    // the actual 1xai wallet movement was 786,792 — and the product stopped
    // itself on the fabricated number. 1xai computes and debits the real cost, so
    // an empty wallet is the accurate guard; this soft cap is opt-in now.
    expect(DEFAULT_AI_MONTHLY_BUDGET_USD).toBe(0);
  });

  it("still honours a cap the owner sets deliberately", async () => {
    const { db } = makeFakeDb();
    await incrementMonthUpstream(2_000_000, db, NOW);
    const status = await maintenanceStatus(db, NOW, 1_000_000);
    expect(status.capReached).toBe(true);
    expect(status.inMaintenance).toBe(true);
  });

  it("treats a zero cap as unlimited, never as 'already exceeded'", async () => {
    const { db } = makeFakeDb();
    await incrementMonthUpstream(9_999_999, db, NOW);
    const status = await maintenanceStatus(db, NOW, 0);
    expect(status.capReached).toBe(false);
    expect(status.inMaintenance).toBe(false);
  });
});
