import "server-only";

/**
 * موتور امتیازدهی و نگارش انگیزه‌نامه — درگاهِ (seam) هوش مصنوعی کنترل‌پلین.
 *
 * این فایل قرارداد `scoreAndDraft` را که ارکستریتور به آن وابسته است نگه می‌دارد و
 * نقطه‌ی اتصال به گیت‌وی 1xai است (بخش ۲ و ۶ سند معماری: «همه‌ی فراخوانی‌های مدل از
 * طریق گیت‌وی 1xai»). مرحله‌ی Integrate این تابع را به `index.ts` متصل می‌کند.
 *
 * چرا فایل جدا از index.ts؟ تا ارکستریتور بتواند مستقیماً وابستگی‌اش را از این مسیر
 * بگیرد و در تست به‌سادگی mock شود، بدون دست‌زدن به قرارداد عمومیِ index.ts.
 *
 * جریان کار پیاده‌سازی واقعی:
 *   ۱) ساخت پرامپت ترکیبی فارسی (امتیاز + انگیزه‌نامه) از پروفایل و آگهی.
 *   ۲) فراخوانی گیت‌وی با خروجی JSON ساختاریافته.
 *   ۳) اعتبارسنجی سختِ خروجی مدل با zod (هرگز به خروجی مدل اعتماد نمی‌کنیم).
 *   ۴) برگرداندن شکل دامنه‌ای موردانتظار `index.ts`.
 *
 * خطاها: اگر env هوش مصنوعی نباشد یا گیت‌وی/مدل خروجیِ نامعتبر بدهد، `ScoringError`ِ
 * typed با علتِ زیرین پرتاب می‌شود تا فراخواننده بتواند تصمیم بگیرد (skip / retry / log).
 */
import { chatCompleteJson, type GatewayOptions } from "@/lib/ai/gateway";
import { buildScoreAndDraftPrompt } from "@/lib/ai/prompts";
import { scoreAndDraftSchema } from "@/lib/ai/schema";
import type { CandidateProfile, JobListing } from "@/lib/apply/types";

/** خروجی امتیازدهی: امتیاز تطبیق ۰..۱ و انگیزه‌نامه‌ی پیش‌نویس. */
export interface ScoreAndDraftResult {
  /** امتیاز تطبیق در بازه‌ی ۰ تا ۱. */
  matchScore: number;
  /** انگیزه‌نامه‌ی تولیدشده برای این آگهی. */
  coverLetter: string;
  /** توضیح اختیاری مدل درباره‌ی دلیل امتیاز (برای نمایش به کاربر). */
  reason?: string;
}

/** خطای typed این لایه — تا فراخواننده بین «پیکربندی‌نشده»، «خطای مدل» و … تمایز بگذارد. */
export class ScoringError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ScoringError";
    this.cause = cause;
  }
}

/**
 * یک آگهی را در برابر پروفایل کاربر امتیاز می‌دهد و انگیزه‌نامه می‌نویسد.
 *
 * هر دو خروجی در یک فراخوانیِ مدل گرفته می‌شوند (کاهش هزینه/تأخیر). دلایلِ آرایه‌ایِ
 * مدل برای حفظِ قرارداد موجود، به یک رشته‌ی `reason` تبدیل می‌شوند.
 *
 * `opts` فقط برای تزریق در تست (fetch/adapter/config) است؛ در مسیر واقعی خالی می‌ماند
 * و پیکربندی از env خوانده می‌شود.
 */
export async function scoreAndDraft(
  job: JobListing,
  profile: CandidateProfile,
  opts: GatewayOptions = {},
): Promise<ScoreAndDraftResult> {
  const messages = buildScoreAndDraftPrompt(job, profile);

  let data: unknown;
  try {
    ({ data } = await chatCompleteJson({ messages, temperature: 0.4 }, opts));
  } catch (cause) {
    throw new ScoringError(
      "فراخوانی گیت‌وی هوش مصنوعی برای امتیازدهی/نگارش ناموفق بود.",
      cause,
    );
  }

  const parsed = scoreAndDraftSchema.safeParse(data);
  if (!parsed.success) {
    throw new ScoringError(
      `خروجی مدل با اسکیمای موردانتظار هم‌خوان نبود: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("؛ ")}`,
      parsed.error,
    );
  }

  const reason = parsed.data.reasons.length > 0 ? parsed.data.reasons.join("؛ ") : undefined;

  return {
    matchScore: parsed.data.matchScore,
    coverLetter: parsed.data.coverLetter,
    reason,
  };
}
