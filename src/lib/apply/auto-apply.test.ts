/**
 * تست‌های گیتِ اپلای خودکار (auto-apply.ts) — با readRow/readCountToday تزریقی (بدونِ DB).
 *
 * تمرکز: قاعده‌ی ۱ — هیچ اپلای خودکاری مگر تاگل روشن + زیرِ سقفِ روزانه؛ و آستانه‌ی مؤثر
 * درست برگردد. fail-closed وقتی ردیفِ تنظیمات وجود ندارد (enabled=false).
 */
import { describe, expect, it } from "vitest";

import {
  assertAutoApplyAllowed,
  AutoApplyNotAllowedError,
  DEFAULT_AUTO_APPLY_MIN_SCORE,
  getAutoApplySettings,
  isAutoApplyEnabled,
} from "@/lib/apply/auto-apply";
import type { UserAutoApplyRow } from "@/db/schema";

function row(overrides: Partial<UserAutoApplyRow> = {}): UserAutoApplyRow {
  return {
    id: "row-1",
    userId: "u1",
    enabled: true,
    minScore: 0.7,
    updatedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

describe("getAutoApplySettings — پیش‌فرضِ محتاطانه", () => {
  it("نبودِ ردیف ⇒ enabled=false و minScore پیش‌فرض", async () => {
    const out = await getAutoApplySettings("u1", { readRow: async () => null });
    expect(out).toEqual({ enabled: false, minScore: DEFAULT_AUTO_APPLY_MIN_SCORE });
  });

  it("ردیفِ موجود ⇒ همان enabled/minScore", async () => {
    const out = await getAutoApplySettings("u1", {
      readRow: async () => row({ enabled: true, minScore: 0.85 }),
    });
    expect(out).toEqual({ enabled: true, minScore: 0.85 });
  });

  it("isAutoApplyEnabled با تاگلِ خاموش ⇒ false", async () => {
    const enabled = await isAutoApplyEnabled("u1", {
      readRow: async () => row({ enabled: false }),
    });
    expect(enabled).toBe(false);
  });
});

describe("assertAutoApplyAllowed — گاردهای قاعده‌ی ۱", () => {
  it("تاگل خاموش ⇒ AutoApplyNotAllowedError('disabled') — و سهمیه اصلاً چک نمی‌شود", async () => {
    let counted = false;
    const err = await assertAutoApplyAllowed("u1", "free", {
      readRow: async () => row({ enabled: false }),
      readCountToday: async () => {
        counted = true;
        return 0;
      },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AutoApplyNotAllowedError);
    expect((err as AutoApplyNotAllowedError).code).toBe("disabled");
    expect(counted, "وقتی تاگل خاموش است نباید سهمیه را بشمارد").toBe(false);
  });

  it("تاگل روشن + زیرِ سقف (free) ⇒ مجاز با آستانه‌ی مؤثر", async () => {
    const out = await assertAutoApplyAllowed("u1", "free", {
      readRow: async () => row({ enabled: true, minScore: 0.75 }),
      readCountToday: async () => 10,
    });
    expect(out.minScore).toBe(0.75);
    expect(out.quota).toEqual({ limit: 100, usedToday: 10, remaining: 90 });
  });

  it("تاگل روشن ولی سقفِ روزانه پر (free=100) ⇒ AutoApplyNotAllowedError('quota_exceeded')", async () => {
    const err = await assertAutoApplyAllowed("u1", "free", {
      readRow: async () => row({ enabled: true }),
      readCountToday: async () => 100,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AutoApplyNotAllowedError);
    const e = err as AutoApplyNotAllowedError;
    expect(e.code).toBe("quota_exceeded");
    expect(e.usedToday).toBe(100);
    expect(e.limit).toBe(100);
  });

  it("پلنِ پولی (pro) با تاگل روشن ⇒ مجاز، بدونِ سقف و بدونِ شمارش", async () => {
    let counted = false;
    const out = await assertAutoApplyAllowed("u1", "pro", {
      readRow: async () => row({ enabled: true, minScore: 0.6 }),
      readCountToday: async () => {
        counted = true;
        return 99_999;
      },
    });
    expect(out.minScore).toBe(0.6);
    expect(out.quota.limit).toBeNull();
    expect(counted, "پلنِ نامحدود نباید سهمیه را بشمارد").toBe(false);
  });
});
