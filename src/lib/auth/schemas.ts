import "server-only";

/**
 * اسکیماهای zod برای ورودیِ خارجیِ مسیرهای احراز هویت کارجو (/api/auth/*).
 *
 * هر چیزی که از بیرون می‌آید پیش از لمسِ منطق/DB اینجا اعتبارسنجی و نرمال می‌شود.
 * شماره‌ی موبایل به قالبِ E.164 ایران (`+98XXXXXXXXXX`) نرمال می‌شود تا با
 * `users.phone` (که E.164 ذخیره می‌کند) یکدست بماند و کوئری/یکتاییِ شماره نشکند.
 */
import { z } from "zod";

/**
 * شماره‌ی موبایلِ ایران را به E.164 (`+98XXXXXXXXXX`) نرمال می‌کند.
 * قالب‌های پذیرفته‌شده: `09xxxxxxxxx`، `9xxxxxxxxx`، `+98xxxxxxxxxx`، `0098xxxxxxxxxx`،
 * `98xxxxxxxxxx`. خروجی همیشه `+98` + ده رقمِ شروع‌شده با `9` است.
 */
export function normalizeIranPhoneE164(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  let local: string; // ۱۰ رقم، شروع با 9
  if (digits.startsWith("0098")) local = digits.slice(4);
  else if (digits.startsWith("98") && digits.length === 12) local = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 11) local = digits.slice(1);
  else if (digits.length === 10 && digits.startsWith("9")) local = digits;
  else return null;

  if (local.length !== 10 || !local.startsWith("9")) return null;
  return `+98${local}`;
}

/** فیلدِ شماره: نرمال به E.164 ایران؛ در صورتِ نامعتبر، خطای اعتبارسنجی. */
const phoneField = z
  .string()
  .trim()
  .min(1, "شماره موبایل لازم است")
  .transform((v, ctx) => {
    const normalized = normalizeIranPhoneE164(v);
    if (!normalized) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "شماره موبایل معتبر نیست" });
      return z.NEVER;
    }
    return normalized;
  });

/** بدنه‌ی POST /api/auth/otp/request — درخواستِ کدِ ورود برای یک شماره. */
export const otpRequestSchema = z.object({
  phone: phoneField,
});
export type OtpRequestBody = z.infer<typeof otpRequestSchema>;

/** بدنه‌ی POST /api/auth/otp/verify — راستی‌آزماییِ کد و ورود. */
export const otpVerifySchema = z.object({
  phone: phoneField,
  /** کدِ عددیِ ۴ تا ۸ رقمی (پیش‌فرضِ سیستم ۶ رقم است؛ بازه‌ی نرم برای انعطاف). */
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, "کد باید ۴ تا ۸ رقم باشد"),
});
export type OtpVerifyBody = z.infer<typeof otpVerifySchema>;
