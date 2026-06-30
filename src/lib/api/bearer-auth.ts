import "server-only";

/**
 * نگهبانِ احراز هویتِ Bearer برای مسیرهای API کارجو (افزونه و وب).
 *
 * این لایه‌ی نازک، هدرِ `Authorization: Bearer <token>` را می‌خواند و با
 * `verifySessionToken` از هسته‌ی auth راستی‌آزمایی می‌کند. توکنِ نشست یک رشته‌ی
 * تصادفیِ مات (opaque) است که فقط هشش در DB ذخیره شده؛ این توکن از بدنه‌ی پاسخِ
 * `/api/extension/link` (redeem) یا ورودِ وب به کلاینت داده می‌شود و در هدر برمی‌گردد.
 *
 * قواعد ایمنی:
 *   • fail-closed — هر مسیرِ ناموفق (نبودِ هدر، توکنِ نامعتبر/منقضی، نوعِ نادرستِ نشست)
 *     به `HttpError(401)` می‌انجامد؛ هرگز با نشستِ نامعتبر باز نمی‌ماند.
 *   • قاعده‌ی ۴ (CONTEXT): نشستِ هر کاربر فقط برای همان کاربر؛ این تابع فقط `userId`
 *     احرازشده را برمی‌گرداند و مسیرها باید کوئری‌هایشان را به همین userId مقید کنند.
 *   • تزریق‌پذیر — `verify` قابلِ override در تست است (هسته‌ی auth mock می‌شود) تا
 *     تست‌ها بدون DB/شبکه‌ی زنده اجرا شوند (قاعده‌ی پروژه).
 */
import {
  verifySessionToken as defaultVerify,
  type VerifiedSession,
} from "@/lib/auth/core";
import { HttpError } from "@/lib/api/http";

/** امضای تابعِ راستی‌آزماییِ نشست — هم‌راستا با `verifySessionToken` هسته. */
export type VerifySessionFn = (token: string) => Promise<VerifiedSession | null>;

/** آپشن‌های نگهبانِ Bearer — تزریقِ تابعِ راستی‌آزمایی برای تست. */
export interface BearerAuthOptions {
  /** override راستی‌آزمایی (پیش‌فرض `verifySessionToken` هسته). فقط برای تست. */
  verify?: VerifySessionFn;
  /**
   * در صورت تعیین، فقط نشستِ همین نوع پذیرفته می‌شود (مثلاً 'extension' برای مسیرهای
   * افزونه). اگر undefined باشد، هر دو نوعِ web/extension مجازند.
   */
  requireKind?: "web" | "extension";
}

/**
 * توکنِ خامِ Bearer را از هدرِ `Authorization` استخراج می‌کند.
 * قالبِ موردِانتظار: `Bearer <token>` (حساس به حروف بزرگِ کلیدواژه نیست).
 * در صورتِ نبود/بدشکل بودن، null برمی‌گرداند (فراخواننده fail-closed می‌کند).
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * مسیر را احراز هویت می‌کند و نشستِ معتبر را برمی‌گرداند، یا `HttpError(401)` پرتاب
 * می‌کند. در صورت تعیینِ `requireKind`، نشستِ با نوعِ متفاوت هم ۴۰۱ می‌شود (نشتِ
 * نوع را با همان پیامِ عمومیِ unauthorized پنهان می‌کنیم).
 */
export async function requireBearerSession(
  request: Request,
  opts: BearerAuthOptions = {},
): Promise<VerifiedSession> {
  const token = extractBearerToken(request);
  if (!token) {
    throw new HttpError(401, "unauthorized");
  }

  const verify = opts.verify ?? defaultVerify;
  const session = await verify(token);
  if (!session) {
    throw new HttpError(401, "unauthorized");
  }

  if (opts.requireKind && session.session.kind !== opts.requireKind) {
    throw new HttpError(401, "unauthorized");
  }

  return session;
}
