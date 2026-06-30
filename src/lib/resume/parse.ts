import "server-only";

/**
 * ساخت‌یافته‌سازیِ رزومه با هوش مصنوعی (Track A, WF1) — درگاهِ (seam) AI.
 *
 * این لایه «متنِ خامِ رزومه → فیلدهای ساخت‌یافته» را انجام می‌دهد و دقیقاً مثلِ
 * `scoreAndDraft` از گیت‌وی 1xai عبور می‌کند (هیچ providerِ سختی hard-wire نمی‌شود).
 *
 * جریان:
 *   ۱) ساختِ پرامپتِ فارسی از متنِ رزومه (prompts.ts).
 *   ۲) فراخوانیِ گیت‌وی با خروجیِ JSON ساختاریافته (chatCompleteJson).
 *   ۳) اعتبارسنجیِ سختِ خروجیِ مدل با zod (هرگز به خروجیِ مدل اعتماد نمی‌کنیم).
 *   ۴) برگرداندنِ `ParsedResume`.
 *
 * نگاشت به CandidateProfile در لایه‌ی بالاتر (service.ts) انجام می‌شود تا این تابع
 * تنها یک مسئولیت داشته باشد (فراخوانیِ AI + اعتبارسنجی).
 *
 * خطاها: اگر env هوش مصنوعی نباشد یا گیت‌وی/مدل خروجیِ نامعتبر بدهد، `ResumeParseError`ِ
 * typed با علتِ زیرین پرتاب می‌شود تا فراخواننده بتواند تصمیم بگیرد (پیام به کاربر/لاگ).
 */
import { chatCompleteJson, type GatewayOptions } from "@/lib/ai/gateway";
import { buildResumeParsePrompt } from "@/lib/resume/prompts";
import { parsedResumeSchema, type ParsedResume } from "@/lib/resume/schema";

/** خطای typed این لایه — تا فراخواننده بین «پیکربندی‌نشده»/«خطای مدل»/«متنِ خالی» تمایز بگذارد. */
export class ResumeParseError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ResumeParseError";
    this.cause = cause;
  }
}

/**
 * متنِ خامِ یک رزومه را با هوش مصنوعی به فیلدهای ساخت‌یافته تبدیل می‌کند.
 *
 * @param resumeText متنِ خامِ استخراج‌شده (خروجیِ pdf util). نباید خالی باشد.
 * @param opts فقط برای تزریق در تست (fetch/adapter/config)؛ در مسیرِ واقعی خالی است
 *             و پیکربندی از env خوانده می‌شود.
 * @throws {ResumeParseError} اگر متن خالی باشد، فراخوانیِ گیت‌وی شکست بخورد، یا خروجیِ
 *         مدل با اسکیما هم‌خوان نباشد.
 */
export async function parseResumeText(
  resumeText: string,
  opts: GatewayOptions = {},
): Promise<ParsedResume> {
  if (!resumeText || resumeText.trim().length === 0) {
    throw new ResumeParseError("متنِ رزومه برای پردازشِ هوش مصنوعی خالی است.");
  }

  const messages = buildResumeParsePrompt(resumeText);

  let data: unknown;
  try {
    ({ data } = await chatCompleteJson({ messages, temperature: 0.2 }, opts));
  } catch (cause) {
    throw new ResumeParseError(
      "فراخوانیِ گیت‌وی هوش مصنوعی برای ساخت‌یافته‌سازیِ رزومه ناموفق بود.",
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
