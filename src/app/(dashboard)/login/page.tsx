/**
 * صفحه‌ی ورود — قابِ سبکِ RTL با دو راه: «ورود با گوگل» و ایمیل/گذرواژه‌ی 1xai.
 *
 * Server component: دکمه‌ی گوگل صرفاً یک لینکِ `<a>` به اندپوینتِ شروعِ جریانِ OAuth
 * (`/api/auth/google`) است؛ همان‌جا state ساخته و کاربر به Google هدایت می‌شود، و
 * بازگشت از کال‌بک کوکیِ نشست را ست می‌کند. فرمِ ایمیل/گذرواژه (جزیره‌ی کلاینتیِ
 * PasswordLoginForm) همان حسابِ استخرِ مشترکِ 1xai را می‌سنجد — حسابِ کارجو و 1xAi
 * یکی است؛ ساختِ حساب و بازیابیِ گذرواژه در خودِ 1xai انجام می‌شود.
 *
 *   • اگر کاربر از پیش نشستِ معتبر دارد → مستقیم به /dashboard (تا فرمِ ورود را نبیند).
 *   • `?error=<code>` (بازگشتِ ناموفق از OAuth) به یک بنرِ فارسیِ دوستانه نگاشت می‌شود.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { IconArrowStart } from "@/components/dashboard/icons";
import { loginErrorMessage } from "@/components/dashboard/login-error";
import { getDashboardUser } from "@/components/dashboard/session";
import { PasswordLoginForm } from "./password-form";

// به DB دست می‌زند (راستی‌آزماییِ نشست) → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "ورود",
  description: "ورود به داشبورد کارجو با حساب گوگل.",
  robots: { index: false, follow: false },
};

/** اندپوینتِ شروعِ جریانِ OAuth (state می‌سازد و به Google redirect می‌کند). */
const GOOGLE_START_PATH = "/api/auth/google";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>;
}) {
  const [user, params] = await Promise.all([getDashboardUser(), searchParams]);
  if (user) redirect("/dashboard");

  const errorMessage = loginErrorMessage(params.error);

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        {/* لوگو */}
        <Link
          href="/"
          className="focus-ring mx-auto flex w-fit items-center rounded-lg"
          aria-label="کارجو — خانه"
        >
          <Logo size={40} title="کارجو" className="text-foreground" />
        </Link>

        <div className="mt-8 rounded-3xl border border-border bg-card p-7 shadow-sm sm:p-8">
          <h1 className="text-xl font-extrabold">ورود به داشبورد</h1>
          <p className="mt-1.5 text-sm text-muted">
            با حساب گوگل یا ایمیل/گذرواژه‌ی 1xai وارد شوید؛ اگر حساب ندارید، همین‌جا
            ساخته می‌شود.
          </p>

          {errorMessage ? (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400"
            >
              {errorMessage}
            </div>
          ) : null}

          {/* دکمه‌ی ورود با گوگل — لینکِ سرور-رندرشده، بدونِ JSِ کلاینت. */}
          <a
            href={GOOGLE_START_PATH}
            className="mt-6 flex w-full items-center justify-center gap-3 rounded-full border border-border bg-card px-6 py-3 text-base font-bold shadow-sm transition-colors hover:bg-foreground/5"
          >
            <GoogleGlyph />
            ورود با گوگل
          </a>

          {/* جداکننده‌ی «یا» بینِ گوگل و فرمِ ایمیل/گذرواژه. */}
          <div
            aria-hidden="true"
            className="mt-6 flex items-center gap-3 text-xs font-bold text-muted"
          >
            <span className="h-px flex-1 bg-border" />
            یا
            <span className="h-px flex-1 bg-border" />
          </div>

          {/* فرمِ ایمیل/گذرواژه — همان حسابِ استخرِ مشترکِ 1xai (جزیره‌ی کلاینتی). */}
          <PasswordLoginForm />

          <p className="mt-3 text-center text-xs text-muted">
            حسابِ کارجو و 1xAi یکی است.
          </p>
          <p className="mt-2 flex items-center justify-center gap-4 text-xs">
            <a
              href="https://1xai.ir/register"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-foreground"
            >
              ساختِ حساب در 1xai ↗
            </a>
            <a
              href="https://1xai.ir/forgot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted hover:text-foreground"
            >
              فراموشیِ گذرواژه ↗
            </a>
          </p>

          <p className="mt-4 text-center text-xs text-muted">
            با ورود، شرایطِ استفاده و حریمِ خصوصیِ کارجو را می‌پذیرید.
          </p>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <IconArrowStart className="h-4 w-4" />
            بازگشت به صفحه‌ی اصلی
          </Link>
        </p>
      </div>
    </main>
  );
}

/** آرمِ چندرنگِ «G» گوگل (SVG درون‌خطی — بدونِ بارگیریِ خارجی). */
function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 48 48"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7A21.99 21.99 0 0 0 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18A13.2 13.2 0 0 1 11 24c0-1.45.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.94 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
