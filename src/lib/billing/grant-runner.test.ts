/**
 * تست‌های اجراگرِ گرنتِ ماهانه (grant-runner.ts) — بدونِ DB، با گرنت/کاربرانِ تزریقی.
 *
 * تضمین‌های کلیدی (WF3 تراکِ C):
 *   • حلقه روی کاربران، خلاصه‌ی درست (granted/skipped/ineligible/total) می‌سازد.
 *   • *ایدمپوتنسیِ دو اجرا در یک ماه*: اجرای دوم در همان ماه چیزی credit نمی‌کند
 *     (همان مکانیزمِ refIdِ Foundation از طریقِ inMemoryGrantStoreِ مشترک).
 *   • ماهِ متفاوت ⇒ گرنتِ تازه.
 *   • خطای یک کاربر، اجرا را متوقف نمی‌کند (errors شمرده می‌شود).
 */
import { describe, expect, it } from "vitest";

import { runMonthlyGrants, type GrantCandidate } from "@/lib/billing/grant-runner";
import { grantMonthlyCredits, inMemoryGrantStore } from "@/lib/billing/grants";

const JUNE = Date.UTC(2026, 5, 10); // 2026-06
const JULY = Date.UTC(2026, 6, 10); // 2026-07

/**
 * یک «grant» تزریقی که از inMemoryGrantStoreِ مشترکِ Foundation استفاده می‌کند — تا
 * ایدمپوتنسیِ واقعیِ refId (نه یک ماک ساده) در عبورِ اجراگر آزموده شود.
 */
function sharedStoreGrant() {
  const store = inMemoryGrantStore();
  const grant = (userId: string, plan: GrantCandidate["plan"], now: number) =>
    grantMonthlyCredits(userId, { store, plan }, now);
  return { store, grant };
}

describe("runMonthlyGrants — خلاصه‌ی پایه", () => {
  it("کاربرانِ پولی و Free را درست دسته‌بندی می‌کند", async () => {
    const { grant, store } = sharedStoreGrant();
    const candidates: GrantCandidate[] = [
      { id: "u-pro", plan: "pro" },
      { id: "u-max", plan: "max" },
      { id: "u-free", plan: "free" }, // بی‌اعتبار
    ];

    const summary = await runMonthlyGrants(
      { now: JUNE },
      { candidates, grant },
    );

    expect(summary.period).toBe("2026-06");
    expect(summary.scanned).toBe(3);
    expect(summary.granted).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.ineligible).toBe(1);
    expect(summary.totalGrantedToman).toBe(100_000 + 500_000);
    expect(summary.errors).toBe(0);
    expect(store.balances.get("u-pro")).toBe(100_000);
    expect(store.balances.get("u-max")).toBe(500_000);
    expect(store.balances.has("u-free")).toBe(false);
  });
});

describe("runMonthlyGrants — ایدمپوتنسیِ دو اجرا در یک ماه", () => {
  it("اجرای دومِ همان ماه ⇒ همه skipped، بدونِ creditِ دوباره", async () => {
    const { grant, store } = sharedStoreGrant();
    const candidates: GrantCandidate[] = [
      { id: "u-pro", plan: "pro" },
      { id: "u-max", plan: "max" },
    ];

    const first = await runMonthlyGrants({ now: JUNE }, { candidates, grant });
    const second = await runMonthlyGrants({ now: JUNE }, { candidates, grant });

    // اجرای اول: هر دو گرنت گرفتند.
    expect(first.granted).toBe(2);
    expect(first.skipped).toBe(0);
    expect(first.totalGrantedToman).toBe(600_000);

    // اجرای دومِ همان ماه: هیچ گرنتِ تازه‌ای — همه skipped.
    expect(second.scanned).toBe(2);
    expect(second.granted).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.ineligible).toBe(0);
    expect(second.totalGrantedToman).toBe(0);

    // موجودی فقط یک‌بار افزایش یافته (no double-grant).
    expect(store.balances.get("u-pro")).toBe(100_000);
    expect(store.balances.get("u-max")).toBe(500_000);
    // refIdها فقط برای ماهِ ژوئن ثبت شده (۲ تا، نه ۴).
    expect(store.grantedRefIds.size).toBe(2);
  });

  it("ماهِ بعد ⇒ گرنتِ تازه (نه skipped)", async () => {
    const { grant, store } = sharedStoreGrant();
    const candidates: GrantCandidate[] = [{ id: "u-pro", plan: "pro" }];

    await runMonthlyGrants({ now: JUNE }, { candidates, grant });
    const july = await runMonthlyGrants({ now: JULY }, { candidates, grant });

    expect(july.granted).toBe(1);
    expect(july.skipped).toBe(0);
    expect(july.period).toBe("2026-07");
    // دو ماه ⇒ دو گرنت ⇒ مجموعِ موجودی.
    expect(store.balances.get("u-pro")).toBe(200_000);
    expect(store.grantedRefIds.size).toBe(2);
  });
});

describe("runMonthlyGrants — تابِ خطا", () => {
  it("خطای یک کاربر اجرا را متوقف نمی‌کند", async () => {
    const candidates: GrantCandidate[] = [
      { id: "u-ok1", plan: "pro" },
      { id: "u-bad", plan: "pro" },
      { id: "u-ok2", plan: "max" },
    ];
    const grant = async (
      userId: string,
      plan: GrantCandidate["plan"],
      now: number,
    ) => {
      if (userId === "u-bad") throw new Error("boom");
      return grantMonthlyCredits(userId, { store: inMemoryGrantStore(), plan }, now);
    };

    const summary = await runMonthlyGrants(
      { now: JUNE },
      { candidates, grant },
    );

    expect(summary.scanned).toBe(3);
    expect(summary.granted).toBe(2);
    expect(summary.errors).toBe(1);
  });
});

describe("runMonthlyGrants — انتخابِ هدف‌مند (userIds)", () => {
  it("listCandidates را با userIds صدا می‌زند", async () => {
    let seenIds: string[] | undefined = ["sentinel"];
    const listCandidates = async (ids?: string[]) => {
      seenIds = ids;
      return [{ id: "u-pro", plan: "pro" as const }];
    };
    const { grant } = sharedStoreGrant();

    const summary = await runMonthlyGrants(
      { now: JUNE, userIds: ["u-pro"] },
      { listCandidates, grant },
    );

    expect(seenIds).toEqual(["u-pro"]);
    expect(summary.granted).toBe(1);
  });
});
