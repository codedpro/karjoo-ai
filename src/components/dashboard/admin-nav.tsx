import "server-only";

/**
 * گروهِ ناوبریِ «مدیریت» (Server component) — فقط برای ادمین‌ها رندر می‌شود.
 *
 * چرا جدا از `dashboard-nav.tsx`؟ چون ادمین‌بودن یک واقعیتِ *سروری* است (نشست +
 * allowlist) و نباید پوسته را بلاک کند. layout این کامپوننت را داخلِ
 * `<Suspense fallback={null}>` می‌گذارد: پوسته و ناوبریِ عادی فوراً می‌آیند و این گروه
 * چند میلی‌ثانیه بعد اضافه می‌شود.
 *
 * مرزِ Server→Client (درسی که با شکستنِ layout گرفته شد): این فایل *هیچ propی* به
 * کلاینت نمی‌دهد. آیتم‌های ناوبری `icon` دارند که یک تابعِ کامپوننت است و توابع
 * سریالایز نمی‌شوند؛ پس خودِ فهرست آن‌طرفِ مرز (در `dashboard-nav.tsx`) زندگی می‌کند و
 * این‌جا فقط `<AdminNavSection />`ِ بی‌پراپ رندر می‌شود.
 *
 * یادآوریِ امنیتی: پنهان‌کردنِ لینک امنیت نیست — هر صفحه/اکشنِ ادمین *خودش* هم از
 * `isDashboardAdmin()`/`actingAdmin()` عبور می‌کند. این‌جا فقط ناوبری است.
 */
import { isDashboardAdmin } from "./admin-guard";
import { AdminNavSection } from "./dashboard-nav";

export async function AdminNavGroup() {
  if (!(await isDashboardAdmin())) return null;
  return <AdminNavSection />;
}
