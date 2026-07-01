import "server-only";

/**
 * خواندنِ نشستِ کاربر برای داشبورد (server-only) — روی لایه‌ی auth-HTTP سوار است.
 *
 * این فایل «مصرف‌کننده» است: هیچ توکن/کوکی جدیدی صادر نمی‌کند و رازی نمی‌سازد. صرفاً
 * `getCurrentUser` (که کوکیِ `karjoo_session` را می‌خواند، نشست را راستی‌آزمایی می‌کند و
 * کاربرِ فعال را برمی‌گرداند) را صدا می‌زند تا صفحه‌های سرورِ داشبورد (RSC) gate شوند.
 *
 * رفتارِ fail-safe: اگر AUTH_TOKEN_PEPPER یا دیتابیس در دسترس نباشد (حالتِ توسعه‌ی
 * بدونِ راز/DB طبق قاعده‌ی ۶)، به‌جای کرشِ صفحه، «بدونِ نشست» (null) برمی‌گردد و
 * صفحه‌ی gate شده کاربر را به /login می‌فرستد.
 */
import { getCurrentUser } from "@/lib/auth/http";

/** کاربرِ احرازشده‌ی داشبورد — فیلدهای غیرحساسی که UI لازم دارد.
 *
 * هویت اکنون حسابِ Google است؛ پس به‌جای `phone` از `email`/`name`/`avatarUrl` استفاده
 * می‌کنیم. `fullName` نامِ نمایشیِ پروفایلِ کارجو (ستونِ مجزا) است که برای خوشامد به‌کار
 * می‌رود و می‌تواند با نامِ Google (`name`) متفاوت باشد.
 */
export interface DashboardUser {
  userId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  fullName: string | null;
}

/**
 * نشستِ جاری را از روی کوکی می‌خواند → کاربرِ احرازشده یا null.
 *
 * هرگز throw نمی‌کند: نبودِ کوکی، نبودِ pepper، یا خطای DB همگی به null تبدیل
 * می‌شوند (fail-closed برای gate، نه کرش).
 */
export async function getDashboardUser(): Promise<DashboardUser | null> {
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    return {
      userId: user.id,
      email: user.email ?? null,
      name: user.name ?? null,
      avatarUrl: user.avatarUrl ?? null,
      fullName: user.fullName ?? null,
    };
  } catch {
    // pepper تنظیم نشده / DB در دسترس نیست → نشستی نیست (به /login برو).
    return null;
  }
}
