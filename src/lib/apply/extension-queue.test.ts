/**
 * تستِ واحدِ هِلپرِ خالصِ تفکیکِ فیلترمود از AIمود در صفِ افزونه.
 */
import { describe, expect, it } from "vitest";

import { isFilterModeTask } from "@/lib/apply/extension-queue";

describe("isFilterModeTask", () => {
  it("payload با mode='filter' → true", () => {
    expect(isFilterModeTask({ mode: "filter", board: "jobinja" })).toBe(true);
  });

  it("mode='ai' یا بدونِ mode → false (گیتِ آستانه اعمال می‌شود)", () => {
    expect(isFilterModeTask({ mode: "ai" })).toBe(false);
    expect(isFilterModeTask({ board: "jobinja" })).toBe(false);
    expect(isFilterModeTask({})).toBe(false);
  });

  it("مقادیرِ غیرشیء → false", () => {
    expect(isFilterModeTask(null)).toBe(false);
    expect(isFilterModeTask(undefined)).toBe(false);
    expect(isFilterModeTask("filter")).toBe(false);
    expect(isFilterModeTask(42)).toBe(false);
  });
});

/**
 * معافیتِ مودِ دستی از آستانه‌ی امتیاز.
 *
 * آستانه برای جایی است که هیچ‌کس انتخاب نکرده — کشفِ خودکار نباید سرِخود اپلای کند.
 * وقتی کاربر خودش روی یک آگهی «اپلای» می‌زند، عددِ heuristic ما نباید جلوی تصمیمش را
 * بگیرد. زنده دیده شد: آگهی‌ای با امتیاز ۰٫۷ که کاربر خودش انتخاب کرده بود، پشتِ
 * آستانه‌ی ۰٫۷۵ گیر کرد و هرگز ارسال نشد.
 */
describe("claimUserApplyItems — معافیتِ انتخابِ کاربر", () => {
  it("مودهای معاف در شرطِ گیت هستند", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/apply/extension-queue.ts", "utf8"),
    );
    // شرط باید هر دو مود را بپذیرد، نه فقط filter.
    expect(src).toMatch(/'mode'\s+in\s+\('filter',\s*'manual'\)/);
  });

  it("گیتِ provider و رزومهٔ PDF برای ای‌استخدام در query حاضر است", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/apply/extension-queue.ts", "utf8"),
    );
    expect(src).toMatch(/allowedBoards/);
    expect(src).toMatch(/inArray\(jobListings\.board, \[\.\.\.opts\.allowedBoards\]\)/);
    expect(src).toMatch(/eq\(jobListings\.board, "jobvision"\), tailoredResumeExists/);
  });
});
