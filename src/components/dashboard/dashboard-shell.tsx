/**
 * `DashboardShell` — اکنون یک wrapperِ سازگاریِ نازک است (Server component).
 *
 * پوسته‌ی واقعیِ داشبورد (هدر/برند/ناوبریِ کناری/چیپِ کاربر) به
 * `src/app/(dashboard)/layout.tsx` منتقل شد تا **یک‌بار و به‌صورتِ استاتیک** رندر شود و
 * فوراً بیاید (بدونِ بلاک‌شدن روی DB). ناوبری هم به کامپوننتِ کلاینتِ
 * `dashboard-nav.tsx` رفت که لینکِ فعال را از `usePathname` مشتق می‌کند — پس صفحه‌ها
 * دیگر لازم نیست `active` را دستی پاس بدهند.
 *
 * این کامپوننت صرفاً برای سازگاریِ عقب‌رو نگه داشته شده تا صفحه‌هایی که هنوز
 * `<DashboardShell active="…">` را import می‌کنند نشکنند؛ فقط فرزندان را عبور می‌دهد.
 * صفحه‌های جدید نیازی به آن ندارند و می‌توانند مستقیماً محتوا را رندر کنند.
 */
import type { ReactNode } from "react";

/** کلیدهای ناوبری — برای سازگاری با امضاهای موجود. دیگر برای های‌لایت لازم نیست. */
export type NavKey =
  | "home"
  | "matches"
  | "applications"
  | "auto-apply"
  | "interests"
  | "resume"
  | "models"
  | "billing"
  | "plans";

export function DashboardShell({
  children,
}: {
  /** پذیرفته می‌شود ولی نادیده گرفته می‌شود — ناوبری اکنون از مسیر مشتق می‌شود. */
  active?: NavKey;
  children: ReactNode;
}) {
  return <>{children}</>;
}
