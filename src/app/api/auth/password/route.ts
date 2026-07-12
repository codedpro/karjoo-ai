import "server-only";

/**
 * POST /api/auth/password — ورود با ایمیل/گذرواژه‌ی *استخرِ مشترکِ 1xai*.
 *
 * «یک انسان، یک حساب»: کارجو گذرواژه‌ای از خودش ندارد؛ اعتبارسنجی به 1xai واگذار
 * می‌شود (verifyPoolPassword — bcrypt همان‌جا می‌ماند، کارجو هرگز هش نمی‌بیند). پس از
 * تأیید، کاربرِ محلیِ متناظر با ایمیل پیدا/ساخته و به شناسه‌ی استخر گره می‌خورد و
 * *همان* نشستِ وبِ مسیرِ Google صادر می‌شود (issueSession('web') + setSessionCookie).
 *
 * گام‌ها:
 *   ۱) بدنه‌ی JSON با zod (strict): {email, password}. ایمیل نرمال (trim/lowercase).
 *   ۲) محدودسازِ نرخ per-IP و per-email (۱۰ بار / ۱۰ دقیقه) → ۴۲۹ با Retry-After.
 *   ۳) verifyPoolPassword → null → ۴۰۱ با پیامِ یکنواخت (بدونِ افشای وجود/نبودِ حساب).
 *   ۴) پیدا/ساختِ کاربرِ محلی با email؛ onexaiUserId در صورتِ خالی‌بودن تثبیت می‌شود.
 *   ۵) کاربرِ غیرفعال (isActive=false) → همان ۴۰۱ یکنواخت (بدونِ نشتِ وضعیت).
 *   ۶) issueSession('web') + setSessionCookie → {ok:true}.
 *
 * قواعدِ ایمنی:
 *   • 1xai در دسترس نباشد (OnexaiSvcUnavailableError) → ۵۰۳ (fail-closed؛ هرگز
 *     اعتبارسنجیِ محلی/جایگزین وجود ندارد).
 *   • پیامِ خطای اعتبارِ نادرست همیشه یکسان است («ایمیل یا گذرواژه نادرست است») تا
 *     enumerate‌کردنِ حساب‌ها ممکن نباشد. گذرواژه هرگز لاگ نمی‌شود.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import type { User } from "@/db/schema";
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { issueSession, WEB_SESSION_TTL_MS } from "@/lib/auth/core";
import { clientIp, setSessionCookie } from "@/lib/auth/http";
import { OnexaiSvcUnavailableError, verifyPoolPassword } from "@/lib/onexai/svc";
import { EVENTS, flush, identify, track } from "@/lib/analytics";

// به DB و node API (crypto/cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** پیامِ یکنواختِ اعتبارِ نادرست — عمداً بینِ «حساب نیست» و «گذرواژه غلط است» فرق نمی‌گذارد. */
const INVALID_CREDENTIALS_MESSAGE = "ایمیل یا گذرواژه نادرست است";

/** سقفِ تلاشِ ورود per-key (IP و email جداگانه) در پنجره‌ی ۱۰ دقیقه‌ای. */
export const PASSWORD_RATE_LIMIT_MAX = 10;
export const PASSWORD_RATE_LIMIT_WINDOW_MS = 10 * 60_000;

/** بدنه‌ی ورود: ایمیلِ نرمال‌شده (trim/lowercase) + گذرواژه‌ی ناخالی. strict — فیلدِ اضافه ممنوع. */
const passwordBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(320)
      .pipe(z.email("ایمیل نامعتبر است")),
    password: z.string().min(1, "گذرواژه لازم است").max(1024),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) اعتبارسنجیِ بدنه (پیش از هر کارِ گران).
    const body = await parseJsonBody(request, passwordBodySchema);

    // ۲) گاردِ نرخ (ضدِ brute-force): هم per-IP (اسپمِ یک مبدأ) و هم per-email (حمله‌ی
    //    توزیع‌شده روی یک حساب). هر دو باید مجاز باشند.
    const ipLimit = checkRateLimit(
      `password:${clientIp(request)}`,
      PASSWORD_RATE_LIMIT_MAX,
      PASSWORD_RATE_LIMIT_WINDOW_MS,
    );
    const emailLimit = checkRateLimit(
      `password:${body.email}`,
      PASSWORD_RATE_LIMIT_MAX,
      PASSWORD_RATE_LIMIT_WINDOW_MS,
    );
    if (!ipLimit.allowed || !emailLimit.allowed) {
      const retryAfterSec = Math.max(ipLimit.retryAfterSec, emailLimit.retryAfterSec);
      return new Response(
        JSON.stringify({
          error: "تلاش‌های زیاد؛ چند دقیقه صبر کنید و دوباره تلاش کنید.",
          retryAfterSec,
        }),
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(retryAfterSec),
          },
        },
      );
    }

    // ۳) اعتبارسنجیِ گذرواژه در برابرِ استخرِ مشترک (fail-closed: 1xai پایین → ۵۰۳).
    let pool: { id: number; email: string } | null;
    try {
      pool = await verifyPoolPassword(body.email, body.password);
    } catch (err) {
      if (err instanceof OnexaiSvcUnavailableError) {
        return errorJson("ورود با گذرواژه موقتاً در دسترس نیست", 503);
      }
      throw err;
    }
    if (!pool) {
      return errorJson(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    // ۴) پیدا/ساختِ کاربرِ محلی با ایمیل؛ گرهِ onexaiUserId در صورتِ نیاز تثبیت می‌شود
    //    (ورودِ بعدی/مسیرهای پولی دیگر resolve لازم ندارند).
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, body.email))
      .limit(1);

    let user: User;
    if (!existing) {
      const [created] = await db
        .insert(users)
        .values({ email: body.email, onexaiUserId: pool.id })
        .returning();
      user = created;
    } else if (existing.onexaiUserId == null) {
      const [updated] = await db
        .update(users)
        .set({ onexaiUserId: pool.id, updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      user = updated ?? existing;
    } else {
      user = existing;
    }

    // ۵) کاربرِ غیرفعال → همان ۴۰۱ یکنواخت (وضعیتِ حساب به بیرون نشت نمی‌کند).
    if (user.isActive === false) {
      return errorJson(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    // ۶) *همان* نشستِ وبِ مسیرِ Google: issueSession('web') + کوکیِ httpOnly.
    const userAgent = request.headers.get("user-agent");
    const { token } = await issueSession(user.id, "web", { userAgent });
    await setSessionCookie(token, WEB_SESSION_TTL_MS);

    // آنالیتیکسِ سرور — best-effort و مقید به نشست؛ هر خطا بلعیده می‌شود (ورود نمی‌شکند).
    try {
      identify(user.id, { email: user.email ?? undefined, name: user.name ?? undefined });
      track(user.id, EVENTS.LOGIN, { method: "password" });
      await flush();
    } catch {
      /* آنالیتیکس هرگز مسیرِ ورود را نمی‌شکند. */
    }

    return json({ ok: true });
  });
}
