/**
 * تست‌های لایه‌ی واحد (unified.ts) — تمرکز: *مهر و مومِ کلیدِ API در ذخیره‌سازی*.
 *
 * تضمین‌های کلیدی:
 *   • کلیدِ خامِ 1xai هرگز خام ذخیره نمی‌شود — آنچه به DB می‌رود خروجیِ seal است.
 *   • مسیرِ خواندن open می‌کند و بدونِ mint/نوشتنِ دوباره برمی‌گردد.
 *   • چرخشِ کلیدِ خزانه (VaultDecryptionError) → خودترمیمی: کلیدِ تازه mint و مهرشده
 *     جایگزین می‌شود (هرگز plaintext).
 * بدونِ DB/شبکه/رمزنگاریِ واقعی: db جعلی + seal/open/issueِ تزریقی (رمزنگاریِ واقعی
 * تست‌های خودش را در vault دارد).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ensureOnexaiApiKey } from "@/lib/billing/unified";
import { VaultDecryptionError } from "@/lib/vault/crypto";

/** dbِ جعلی: صفِ نتایجِ select + ضبطِ setهای update. */
function makeDb() {
  const selectResults: unknown[][] = [];
  const updates: Record<string, unknown>[] = [];
  const db = {
    select: () => {
      const rows = selectResults.shift() ?? [];
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve(rows),
      };
      return chain;
    },
    update: () => ({
      set: (s: Record<string, unknown>) => {
        updates.push(s);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };
  return { db, selectResults, updates };
}

const sealFn = vi.fn((raw: string) => `SEALED(${raw})`);
const openFn = vi.fn((stored: string) => {
  const m = /^SEALED\((.+)\)$/.exec(stored);
  if (!m) throw new VaultDecryptionError();
  return m[1];
});
const issueFn = vi.fn(async () => "1xai-raw-key");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureOnexaiApiKey — مهر و موم در ذخیره‌سازی", () => {
  it("mint: کلیدِ تازه *مهرشده* ذخیره می‌شود (هرگز خام) و خام برمی‌گردد", async () => {
    const { db, selectResults, updates } = makeDb();
    selectResults.push([{ onexaiApiKey: null }]); // کلیدی نیست
    selectResults.push([{ onexaiUserId: 72, email: "u@x.ir", googleSub: null }]); // گره هست

    const key = await ensureOnexaiApiKey("u1", {
      db: db as never,
      issuePoolApiKeyFn: issueFn as never,
      sealFn,
      openFn,
    });

    expect(key).toBe("1xai-raw-key");
    expect(issueFn).toHaveBeenCalledWith(72, "karjoo");
    // آنچه ذخیره شد خروجیِ seal است — نه کلیدِ خام.
    const stored = updates.find((u) => "onexaiApiKey" in u);
    expect(stored?.onexaiApiKey).toBe("SEALED(1xai-raw-key)");
    expect(stored?.onexaiApiKey).not.toBe("1xai-raw-key");
  });

  it("خواندن: بلابِ مهرشده open می‌شود؛ نه mint، نه نوشتنِ دوباره", async () => {
    const { db, selectResults, updates } = makeDb();
    selectResults.push([{ onexaiApiKey: "SEALED(existing-key)" }]);

    const key = await ensureOnexaiApiKey("u1", {
      db: db as never,
      issuePoolApiKeyFn: issueFn as never,
      sealFn,
      openFn,
    });

    expect(key).toBe("existing-key");
    expect(issueFn).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("چرخشِ خزانه (بلابِ بازنشدنی) → خودترمیمی: کلیدِ تازه mint و مهرشده جایگزین می‌شود", async () => {
    const { db, selectResults, updates } = makeDb();
    selectResults.push([{ onexaiApiKey: "garbage-old-blob" }]); // openFn → VaultDecryptionError
    selectResults.push([{ onexaiUserId: 72, email: "u@x.ir", googleSub: null }]); // گره برای mint

    const key = await ensureOnexaiApiKey("u1", {
      db: db as never,
      issuePoolApiKeyFn: issueFn as never,
      sealFn,
      openFn,
    });

    expect(key).toBe("1xai-raw-key");
    expect(issueFn).toHaveBeenCalledTimes(1);
    const stored = updates.find((u) => "onexaiApiKey" in u);
    expect(stored?.onexaiApiKey).toBe("SEALED(1xai-raw-key)");
  });

  it("خطای غیرِ رمزگشایی از open (باگِ برنامه) بلعیده نمی‌شود", async () => {
    const { db, selectResults } = makeDb();
    selectResults.push([{ onexaiApiKey: "SEALED(x)" }]);
    const throwingOpen = vi.fn(() => {
      throw new TypeError("bug");
    });

    await expect(
      ensureOnexaiApiKey("u1", {
        db: db as never,
        issuePoolApiKeyFn: issueFn as never,
        sealFn,
        openFn: throwingOpen,
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(issueFn).not.toHaveBeenCalled();
  });
});
