import { redirect } from "next/navigation";

/**
 * «زمینه‌های شغلی» حالا گامِ اولِ صفحه‌ی «اپلای خودکار» است.
 *
 * جدا بودنشان یک تضادِ واقعی می‌ساخت: هر دو `preferences.categorySlugs` را می‌نویسند،
 * پس هر کدام آخر ذخیره می‌شد انتخابِ دیگری را پاک می‌کرد. این ری‌دایرکت می‌ماند تا
 * لینک‌ها و بوکمارک‌های قدیمی نشکنند.
 */
export default function InterestsRedirectPage() {
  redirect("/dashboard/auto-apply");
}
