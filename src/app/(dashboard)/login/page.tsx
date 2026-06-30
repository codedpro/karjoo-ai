/**
 * صفحه‌ی ورود/ثبت‌نام — قابِ ساده‌ی RTL با فرمِ phone→OTP.
 *
 * Server component: اگر کاربر از پیش نشستِ معتبر دارد، مستقیم به /dashboard می‌رود
 * (تا فرمِ ورود را دوباره نبیند). در غیرِ این صورت فرمِ کلاینت را رندر می‌کند.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/dashboard/login-form";
import { getDashboardUser } from "@/components/dashboard/session";
import { site } from "@/lib/site";

// به DB دست می‌زند (راستی‌آزماییِ نشست) → اجرای Node.
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "ورود",
  description: "ورود به داشبورد کارجو با شماره موبایل.",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const user = await getDashboardUser();
  if (user) redirect("/dashboard");

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="w-full max-w-sm">
        {/* لوگو */}
        <Link href="/" className="mx-auto flex w-fit items-center gap-2 text-xl font-bold">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-2 text-white">
            ک
          </span>
          <span>{site.name}</span>
        </Link>

        <div className="mt-8 rounded-3xl border border-border bg-card p-7 shadow-sm sm:p-8">
          <h1 className="text-xl font-extrabold">ورود به داشبورد</h1>
          <p className="mt-1.5 text-sm text-muted">
            با شماره موبایل وارد شوید؛ اگر حساب ندارید، همین‌جا ساخته می‌شود.
          </p>

          <div className="mt-6">
            <LoginForm />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          <Link href="/" className="hover:text-foreground">
            ← بازگشت به صفحه‌ی اصلی
          </Link>
        </p>
      </div>
    </main>
  );
}
