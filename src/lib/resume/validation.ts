/**
 * اعتبارسنجیِ ورودیِ آپلودِ رزومه (Track A, WF1) — تابعِ خالص، قابلِ تست، بدونِ I/O.
 *
 * این لایه «قواعدِ پذیرشِ فایل» را یک‌جا نگه می‌دارد تا route نازک بماند و قواعد در
 * تستِ واحد بدونِ ساختنِ Request/multipart قابلِ بررسی باشند:
 *   • فقط PDF (نوعِ MIME + امضای بایت %PDF-).
 *   • سقفِ اندازه (تا فایلِ بزرگ سرور/دیسک را اشباع نکند).
 *   • حداقلِ اندازه (تا فایلِ تهی/۰بایت رد شود).
 *
 * چرا امضای بایت هم چک می‌شود؟ نوعِ MIME از کلاینت قابلِ جعل است؛ امضای %PDF در
 * ابتدای فایل یک سدِ ارزانِ سمتِ سرور است (نه امنیتِ کامل، ولی فیلترِ خطاهای رایج).
 */

/** سقفِ اندازه‌ی فایلِ رزومه: ۵ مگابایت (رزومه‌ی PDF معمولاً خیلی کمتر است). */
export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** حداقلِ اندازه‌ی معقول برای یک PDF (کمتر از این، فایلِ خراب/تهی است). */
export const MIN_RESUME_BYTES = 100;

/** نوعِ MIME پذیرفته‌شده. */
export const RESUME_MIME = "application/pdf";

/** نتیجه‌ی اعتبارسنجی: یا معتبر، یا یک پیامِ خطای فارسیِ کاربری. */
export type ResumeValidation = { ok: true } | { ok: false; error: string };

/**
 * یک رشته‌ی base64 (با یا بدونِ پیشوندِ `data:...;base64,`) را به بایت تبدیل می‌کند.
 * تابعِ خالص؛ در صورتِ ورودیِ نامعتبر یک `Uint8Array` خالی برمی‌گرداند (فراخواننده با
 * اعتبارسنجیِ اندازه/امضا ردش می‌کند). پیشوندِ data URL در صورتِ وجود حذف می‌شود.
 */
export function decodeBase64Pdf(input: string): Uint8Array {
  const comma = input.indexOf(",");
  const payload =
    input.startsWith("data:") && comma !== -1 ? input.slice(comma + 1) : input;
  try {
    return new Uint8Array(Buffer.from(payload, "base64"));
  } catch {
    return new Uint8Array(0);
  }
}

/** آیا بایت‌ها با امضای فایلِ PDF (`%PDF-`) آغاز می‌شوند؟ */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  // %PDF-  →  0x25 0x50 0x44 0x46 0x2D
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return true;
}

/**
 * یک فایلِ آپلودیِ رزومه را اعتبارسنجی می‌کند (نوع/اندازه/امضا). در صورتِ رد، پیامِ
 * فارسیِ مناسبِ نمایش به کاربر می‌دهد (هیچ جزئیاتِ داخلیِ حساسی فاش نمی‌شود).
 *
 * @param bytes    بایت‌های فایل.
 * @param mimeType نوعِ MIME گزارش‌شده توسطِ کلاینت (قابلِ جعل — به‌تنهایی کافی نیست).
 */
export function validateResumeUpload(
  bytes: Uint8Array,
  mimeType: string | null | undefined,
): ResumeValidation {
  if (bytes.length < MIN_RESUME_BYTES) {
    return { ok: false, error: "فایل خالی یا بسیار کوچک است." };
  }
  if (bytes.length > MAX_RESUME_BYTES) {
    return {
      ok: false,
      error: "حجمِ فایل بیش از حدِ مجاز است (حداکثر ۵ مگابایت).",
    };
  }
  // نوعِ MIME (در صورتِ ارائه) باید PDF باشد؛ ولی منبعِ اصلیِ حقیقت، امضای بایت است.
  if (mimeType && mimeType !== RESUME_MIME) {
    return { ok: false, error: "فقط فایلِ PDF پذیرفته می‌شود." };
  }
  if (!hasPdfSignature(bytes)) {
    return {
      ok: false,
      error: "فایل یک PDF معتبر نیست (امضای فایل نادرست است).",
    };
  }
  return { ok: true };
}
