import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

/**
 * پیکربندیِ Next.js — کارجو.
 *
 * تصمیمِ Cache Components (PPR):
 *   پرچمِ سراسریِ `cacheComponents: true` را *فعال نکردیم*. فعال‌کردنش کلِ اپ را به
 *   مدلِ جدید می‌بَرد و لازم می‌کند هر ۴۶ route handler و ۱۴ صفحه‌ی موجود migrate شوند
 *   (حذفِ `dynamic = "force-*"`، پوششِ هر دسترسیِ داده‌ی uncached با `use cache`/Suspense،
 *   و بازبینیِ حفظِ stateِ ناوبری). این خارج از دامنه‌ی مالکیتِ Foundation است (صفحه‌های
 *   build-agentها و مسیرهای API/بک‌اند را نباید بشکنیم) و ریسکِ سبز-نماندنِ build را
 *   به‌همراه دارد.
 *
 *   به‌جایش «همان UXِ لازم» را با مسیرِ مجاز و مستندِ جایگزین می‌دهیم:
 *     • پوسته‌ی استاتیکِ بی‌درنگ در `src/app/(dashboard)/layout.tsx` (یک‌بار رندر، فوری).
 *     • بخش‌های وابسته به کاربر داخلِ `<Suspense>` با اسکلتِ هم‌شکلِ محتوا استریم می‌شوند
 *       (Suspense به‌خودیِ‌خود استریم می‌کند؛ نیازی به پرچمِ سراسری نیست).
 *     • دروازه‌بانیِ ارزانِ حضورِ نشست به `proxy.ts` منتقل شد (بدونِ DB، روی لبه).
 *   خروجی همان است: پوسته‌ی فوری + اسکلتِ هر بخش، بدونِ بلاک‌شدنِ کلِ مسیر روی DB.
 *
 *   وقتی همه‌ی مسیرها (شاملِ API و صفحه‌های build-agentها) برای Cache Components آماده
 *   شدند، این پرچم می‌تواند در یک PRِ مجزا و هماهنگ روشن شود.
 */
const nextConfig: NextConfig = {
  // cacheComponents: true, // ← عمداً خاموش؛ توضیح بالا. UX از راهِ static-shell + Suspense.
};

/**
 * پوششِ Sentry (@sentry/nextjs) روی پیکربندی — کارجو (تک‌مستأجر: tenant=karjoo).
 *
 * آپلودِ source-map عمداً *خاموش* است: هیچ authTokenِ معتبری نداریم، پس نه آن را
 * ست می‌کنیم و نه تلاش به آپلود می‌شود. این تضمین می‌کند build بدونِ توکنِ Sentry هم
 * سبز بماند. `silent: true` لاگ‌های ابزارِ Sentry را در build خاموش می‌کند.
 *   • org/project: sentry / karjoo (ثابت؛ پروژه در هاب از قبل ساخته شده).
 *   • url: از SENTRY_URL خوانده می‌شود (هاب داخلی روی 10.10.0.165).
 *   • tunnelRoute: مسیرِ tunnel تا رویداد/replay از سدِ ad-blockerها رد شود.
 * رازها هرگز اینجا hardcode نمی‌شوند — همه از process.env خوانده می‌شوند.
 */
export default withSentryConfig(nextConfig, {
  org: "sentry",
  project: "karjoo",
  sentryUrl: process.env.SENTRY_URL,
  // آپلودِ source-map خاموش: توکن نداریم ⇒ authToken=undefined ⇒ تلاشِ آپلود انجام نمی‌شود.
  authToken: undefined,
  sourcemaps: {
    disable: true,
  },
  silent: true,
  // یادداشت: `disableLogger` (تری‌شیکِ لاگِ دیباگ) با Turbopack پشتیبانی نمی‌شود و
  // deprecated است؛ حذف شد تا هشدارِ deprecation در build نداشته باشیم. `silent`
  // خروجیِ ابزارِ Sentry را در build خاموش نگه می‌دارد.
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
});
