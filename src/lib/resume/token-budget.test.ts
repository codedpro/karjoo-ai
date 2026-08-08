/**
 * سقفِ توکنِ خروجی برای کارهای «JSONِ بلند» (پارس و هدف‌گیریِ رزومه).
 *
 * چرا تست دارد: سقفِ عمومیِ گیت‌وی ۱۲۰۰ توکن است و برای این دو کار کم است — JSON **وسطِ
 * رشته** بریده می‌شود و کاربر فقط «درخواست ناموفق بود» می‌بیند، بدونِ هیچ سرنخی.
 * زنده رخ داد: رزومه‌ی ۶٬۷۴۱ نویسه‌ای → «Unterminated string in JSON at position 4715».
 * اگر کسی این سقف‌ها را پایین بیاورد یا حذف کند، همان باگ بی‌صدا برمی‌گردد.
 */
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_AI_MAX_OUTPUT_TOKENS } from "@/lib/env";
import { RESUME_PARSE_MAX_TOKENS } from "@/lib/resume/parse";
import { RESUME_TAILOR_MAX_TOKENS } from "@/lib/resume/tailor";

describe("سقفِ توکنِ رزومه", () => {
  it("هر دو سقف از سقفِ عمومیِ گیت‌وی بزرگ‌ترند", () => {
    expect(RESUME_PARSE_MAX_TOKENS).toBeGreaterThan(DEFAULT_AI_MAX_OUTPUT_TOKENS);
    expect(RESUME_TAILOR_MAX_TOKENS).toBeGreaterThan(DEFAULT_AI_MAX_OUTPUT_TOKENS);
  });

  it("به‌اندازه‌ی یک رزومه‌ی کامل بزرگ‌اند (نه یک عددِ نمادین)", () => {
    // یک رزومه‌ی واقعیِ دو‌صفحه‌ای به‌صورت JSON حدودِ ۲ تا ۳ هزار توکن می‌شود.
    expect(RESUME_PARSE_MAX_TOKENS).toBeGreaterThanOrEqual(3000);
    expect(RESUME_TAILOR_MAX_TOKENS).toBeGreaterThanOrEqual(3000);
  });
});

describe("فراخوانیِ مترشده سقف را واقعاً می‌فرستد", () => {
  it("meteredParseResumeText مقدارِ maxTokens را پاس می‌دهد", async () => {
    const meteredChatJson = vi.fn(async () => ({
      result: {
        data: { fullName: "X", skills: [], experience: [], education: [], languages: [], links: [] },
      },
    }));
    vi.doMock("@/lib/billing/metering", () => ({ meteredChatJson }));
    vi.resetModules();

    const { meteredParseResumeText } = await import("@/lib/resume/metered-parse");
    await meteredParseResumeText("u1", "یک متنِ رزومه‌ی نمونه برای تست.").catch(() => {});

    expect(meteredChatJson).toHaveBeenCalled();
    const call = meteredChatJson.mock.calls[0] as unknown as unknown[];
    const req = call?.[2] as { maxTokens?: number } | undefined;
    expect(req?.maxTokens).toBe(RESUME_PARSE_MAX_TOKENS);
    vi.doUnmock("@/lib/billing/metering");
  });
});
