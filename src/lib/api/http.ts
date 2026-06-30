import "server-only";

/**
 * کمک‌کننده‌های مشترکِ مسیرهای API کنترل‌پلین کارجو.
 *
 * هدف: نازک نگه‌داشتنِ route handlerها. هر مسیر فقط «اعتبارسنجی → فراخوانی منطق →
 * پاسخ JSON با کد وضعیت درست» را انجام می‌دهد و قالبِ خطا/موفقیت اینجا یک‌جا تعریف
 * می‌شود تا یکدست بماند و هیچ رازی (کلید/توکن/پیام داخلی حساس) به بدنه‌ی پاسخ نشت نکند.
 */
import { ZodError, type ZodType } from "zod";

import { requireInternalSecret } from "@/lib/env";

/** قالب یکدستِ پاسخِ خطا — همیشه فیلد `error` متنی و کوتاه. */
export interface ApiError {
  error: string;
  /** جزئیاتِ اعتبارسنجی (بدون افشای داده‌ی حساس). */
  details?: unknown;
}

/** پاسخ JSON موفق با کد وضعیت دلخواه (پیش‌فرض ۲۰۰). */
export function json<T>(data: T, status = 200): Response {
  return Response.json(data, { status });
}

/** پاسخ JSON خطا با کد وضعیت و پیام کوتاه. */
export function errorJson(
  message: string,
  status: number,
  details?: unknown,
): Response {
  const body: ApiError = details === undefined ? { error: message } : { error: message, details };
  return Response.json(body, { status });
}

/**
 * خطایی که عمداً به یک کد وضعیت HTTP نگاشت می‌شود. منطق پایین‌دست می‌تواند این را
 * پرتاب کند و هندلر آن را به پاسخِ تمیز تبدیل می‌کند (بدون نشتِ stack/پیام داخلی).
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** نشانه‌گذاری «هنوز پیاده نشده» تا هندلر ۵۰۱ (Not Implemented) برگرداند. */
export class NotImplementedError extends HttpError {
  constructor(message: string) {
    super(501, message);
    this.name = "NotImplementedError";
  }
}

/**
 * نگهبانِ مسیرهای داخلی: هدرِ `X-Internal-Secret` را با رازِ مشترک مقایسه می‌کند.
 * اگر رازِ سرور تنظیم نشده باشد، fail-closed (۵۰۳) می‌شود — هرگز با رازِ خالی باز نمی‌ماند.
 * مقایسه طول‌ثابت است تا کانال جانبیِ زمان‌سنجی نشت ندهد.
 *
 * در صورت رد، یک `Response` آماده برمی‌گرداند؛ در صورت قبول، null.
 */
export function guardInternal(request: Request): Response | null {
  let expected: string;
  try {
    expected = requireInternalSecret();
  } catch {
    // رازِ سرور تنظیم نشده → مسیر داخلی غیرفعال است (fail-closed).
    return errorJson("internal API disabled", 503);
  }

  const provided = request.headers.get("x-internal-secret") ?? "";
  if (!timingSafeEqual(provided, expected)) {
    return errorJson("unauthorized", 401);
  }
  return null;
}

/** مقایسه‌ی طول‌ثابتِ دو رشته (مقاوم در برابر حمله‌ی زمان‌سنجی). */
function timingSafeEqual(a: string, b: string): boolean {
  // طولِ متفاوت = نابرابر؛ ولی همچنان روی طولِ ثابت پیمایش می‌کنیم.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * بدنه‌ی JSON درخواست را امن می‌خواند و با اسکیمای zod اعتبارسنجی می‌کند.
 * در صورت بدنه‌ی نامعتبر/غیرJSON یا شکستِ اسکیما، `HttpError(400)` پرتاب می‌کند.
 */
export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new HttpError(400, "validation failed", flattenZod(result.error));
  }
  return result.data;
}

/**
 * پارامترهای جست‌وجوی URL را با اسکیمای zod اعتبارسنجی می‌کند.
 * در صورت شکست، `HttpError(400)` با جزئیاتِ تمیز پرتاب می‌کند.
 */
export function parseSearchParams<T>(searchParams: URLSearchParams, schema: ZodType<T>): T {
  const obj = Object.fromEntries(searchParams.entries());
  const result = schema.safeParse(obj);
  if (!result.success) {
    throw new HttpError(400, "validation failed", flattenZod(result.error));
  }
  return result.data;
}

/** خطای zod را به شکلِ امن و کوتاه (path → message) تخت می‌کند. */
function flattenZod(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((i) => ({
    field: i.path.join(".") || "(root)",
    message: i.message,
  }));
}

/**
 * بسته‌بندِ یکدستِ هندلر: هر خطای پرتاب‌شده را به پاسخِ JSON تمیز نگاشت می‌کند.
 *   • HttpError → کد وضعیتِ خودش (با جزئیات، اگر باشد)
 *   • ZodError → ۴۰۰
 *   • هر چیز دیگر → ۵۰۰ با پیام عمومی (پیام واقعی فقط در لاگ سرور، نه در بدنه).
 */
export async function withErrorHandling(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return errorJson(err.message, err.status, err.details);
    }
    if (err instanceof ZodError) {
      return errorJson("validation failed", 400, flattenZod(err));
    }
    // خطای غیرمنتظره: جزئیات را لاگ کن، ولی به کلاینت پیام عمومی بده (بدون نشت).
    console.error("[api] unhandled error:", err);
    return errorJson("internal server error", 500);
  }
}
