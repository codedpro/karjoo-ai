import "server-only";

/**
 * POST /api/resume/parse — ساخت‌یافته‌سازیِ یک رزومه‌ی آپلودشده با هوش مصنوعی (نشستِ وب).
 *
 * ورودی: `{ resumeFileId }`. جریان:
 *   ۱) احراز هویتِ وب → userId.
 *   ۲) خواندنِ رکوردِ resume_files *فقط اگر متعلق به همین کاربر باشد* (قاعده‌ی ۴؛ شرطِ
 *      ترکیبیِ id+userId تا کاربری نتواند با حدسِ id رزومه‌ی دیگری را پردازش کند).
 *   ۳) اگر متنِ استخراج‌شده ندارد → ۴۲۲ (نمی‌توان فیلد ساخت).
 *   ۴) فراخوانیِ گیت‌وی 1xai برای استخراجِ فیلدهای ساخت‌یافته (parseResumeText).
 *   ۵) ذخیره‌ی parsedFields روی رکورد + upsertِ پروفایلِ کارجوی کاربر (persistParsedFields).
 *   ۶) برگرداندنِ فیلدهای استخراج‌شده + پروفایلِ به‌روزشده.
 *
 * هیچ رازی برنمی‌گردد؛ خطاهای AI به پیامِ کاربری نگاشت می‌شوند (بدونِ نشتِ جزئیاتِ داخلی).
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { resumeParseSchema } from "@/lib/resume/api-schemas";
import { ResumeParseError } from "@/lib/resume/parse";
import { meteredParseResumeText } from "@/lib/resume/metered-parse";
import { GatewayError } from "@/lib/ai/gateway";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import {
  getResumeFileOwned,
  persistParsedFields,
} from "@/lib/resume/service";

// به DB و گیت‌وی هوش مصنوعی دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — userId از نشست.
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) اعتبارسنجیِ بدنه.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorJson("بدنه‌ی JSON نامعتبر است.", 400);
    }
    const parsedBody = resumeParseSchema.safeParse(body);
    if (!parsedBody.success) {
      return errorJson("ورودی نامعتبر است.", 400);
    }

    // ۳) خواندنِ رکورد با مالکیتِ کاربر (قاعده‌ی ۴).
    const record = await getResumeFileOwned(user.id, parsedBody.data.resumeFileId);
    if (!record) {
      return errorJson("رزومه یافت نشد.", 404);
    }

    // ۴) بدونِ متنِ استخراج‌شده نمی‌توان فیلد ساخت.
    if (!record.extractedText || record.extractedText.trim().length === 0) {
      return errorJson(
        "از این فایل متنی استخراج نشده است (ممکن است PDF تصویری/اسکن باشد).",
        422,
      );
    }

    // ۵) فراخوانیِ AIِ مترشده برای ساخت‌یافته‌سازی (به کیف‌پولِ کاربر مقید).
    //    گیتِ موجودی پیش از فراخوانی؛ کسرِ هزینه‌ی واقعی پس از آن.
    let parsed;
    try {
      parsed = await meteredParseResumeText(user.id, record.extractedText);
    } catch (err) {
      return mapAiError(err);
    }

    // ۶) ذخیره‌ی فیلدها + upsertِ پروفایل (به نشست مقید).
    const { profile } = await persistParsedFields(user.id, record.id, parsed);

    return json({
      resumeFileId: record.id,
      parsed,
      profile: {
        fullName: profile.fullName,
        headline: profile.headline,
        city: profile.city,
        yearsExperience: profile.yearsExperience,
        skills: profile.skills,
      },
    });
  });
}

/**
 * خطای لایه‌ی AI را به پاسخِ تمیزِ کاربری نگاشت می‌کند (بدونِ نشتِ جزئیاتِ داخلی).
 *   • موجودیِ ناکافی → ۴۰۲ (نیازمندِ شارژِ کیف‌پول).
 *   • گیت‌وی پیکربندی‌نشده → ۵۰۳ (سرویس موقتاً در دسترس نیست).
 *   • خطای مدل/پاسخِ نامعتبر → ۵۰۲ (سرویسِ بالادست بد پاسخ داد).
 */
function mapAiError(err: unknown): Response {
  // گیتِ بیلینگ: پیش از هر فراخوانی پرتاب می‌شود؛ هرگز هزینه‌ی بالادست خرج نشده.
  if (err instanceof InsufficientBalanceError) {
    return errorJson(err.message, 402);
  }
  const cause = err instanceof ResumeParseError ? err.cause : err;
  if (cause instanceof GatewayError && cause.code === "not_configured") {
    return errorJson("سرویسِ هوش مصنوعی پیکربندی نشده است.", 503);
  }
  if (err instanceof ResumeParseError) {
    return errorJson("پردازشِ هوش مصنوعیِ رزومه ناموفق بود. کمی بعد دوباره تلاش کنید.", 502);
  }
  // خطای غیرمنتظره → بگذار withErrorHandling آن را به ۵۰۰ تبدیل کند.
  throw err;
}
