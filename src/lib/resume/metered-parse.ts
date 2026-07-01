import "server-only";

/**
 * مسیرِ تولیدیِ مترشده‌ی ساخت‌یافته‌سازیِ رزومه با هوش مصنوعی (server-only).
 *
 * چرا جدا از parse.ts؟ تابعِ `parseResumeText` در parse.ts خالص می‌ماند تا تست‌های
 * واحد دست‌نخورده بمانند. این لایه همان منطق را اما از طریقِ `meteredChatJson` عبور
 * می‌دهد تا به کیف‌پولِ کاربر مقید شود.
 *
 * یادآوریِ بیلینگ (CONTEXT): آپلودِ PDF + استخراجِ متنِ خام «رایگان» است (بدونِ AI)؛
 * فقط همین مرحله‌ی «parse با هوش مصنوعی» پولی است و باید از این مسیر عبور کند.
 */
import { buildResumeParsePrompt } from "@/lib/resume/prompts";
import { parsedResumeSchema, type ParsedResume } from "@/lib/resume/schema";
import { ResumeParseError } from "@/lib/resume/parse";
import { meteredChatJson, type MeteringOptions } from "@/lib/billing/metering";
import { logger } from "@/lib/observability/logger";

/**
 * متنِ خامِ رزومه را با هوش مصنوعی به فیلدهای ساخت‌یافته تبدیل می‌کند — *مترشده*.
 *
 * @param userId کاربری که هزینه به کیف‌پولش بسته می‌شود (به نشست مقید، نه payload).
 * @param resumeText متنِ خامِ استخراج‌شده. نباید خالی باشد.
 * @param opts آپشن‌های مترینگ — در مسیرِ واقعی خالی، در تست تزریقی.
 *
 * @throws {InsufficientBalanceError} اگر پیش از فراخوانی موجودی کافی نباشد (بدونِ هزینه).
 * @throws {ResumeParseError} اگر متن خالی باشد یا گیت‌وی/مدل خروجیِ نامعتبر بدهد.
 */
export async function meteredParseResumeText(
  userId: string,
  resumeText: string,
  opts: MeteringOptions = {},
): Promise<ParsedResume> {
  if (!resumeText || resumeText.trim().length === 0) {
    throw new ResumeParseError("متنِ رزومه برای پردازشِ هوش مصنوعی خالی است.");
  }

  const messages = buildResumeParsePrompt(resumeText);

  let data: unknown;
  try {
    const out = await meteredChatJson(userId, "resume_parse", { messages, temperature: 0.2 }, opts);
    data = out.result.data;
  } catch (cause) {
    if (cause instanceof ResumeParseError) throw cause;
    if (isInsufficientBalance(cause)) throw cause;
    // خطای واقعیِ فراخوانیِ مترشده‌ی هوش مصنوعی (نه موجودیِ ناکافی، نه خطای اسکیما):
    // به هابِ مشاهده‌پذیری (Loki) لاگ کن تا خطاهای متر/گیت‌وی قابلِ رصد باشند. بدونِ نشتِ
    // متنِ رزومه (فقط طولِ آن). logger هرگز throw/بلاک نمی‌کند؛ رفتارِ مسیر تغییری نمی‌کند.
    logger.error("metered resume parse failed", {
      path: "resume/metered-parse",
      userId,
      resumeTextLength: resumeText.length,
      err: cause instanceof Error ? cause : new Error(String(cause)),
    });
    throw new ResumeParseError(
      "فراخوانیِ مترشده‌ی گیت‌وی هوش مصنوعی برای ساخت‌یافته‌سازیِ رزومه ناموفق بود.",
      cause,
    );
  }

  const parsed = parsedResumeSchema.safeParse(data);
  if (!parsed.success) {
    throw new ResumeParseError(
      `خروجیِ مدل با اسکیمای موردانتظار هم‌خوان نبود: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("؛ ")}`,
      parsed.error,
    );
  }

  return parsed.data;
}

/** آیا این خطا از نوعِ موجودیِ ناکافیِ بیلینگ است؟ */
function isInsufficientBalance(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "InsufficientBalanceError" ||
      (err as { code?: string }).code === "insufficient_balance")
  );
}
