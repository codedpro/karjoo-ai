import "server-only";

/**
 * اسکیماهای zod برای ورودیِ خارجیِ مسیرهای API کارجو.
 *
 * هر چیزی که از بیرون می‌آید (بدنه/کوئری) پیش از لمسِ DB یا منطق، اینجا اعتبارسنجی
 * می‌شود. UUIDها سخت‌گیرانه چک می‌شوند تا کوئریِ Drizzle با ورودیِ بدشکل نخورد.
 */
import { z } from "zod";

/** بدنه‌ی POST /api/internal/ingest — یک اجرای ingest+match برای یک پروفایل. */
export const ingestBodySchema = z.object({
  /** پروفایلِ کارجوی هدف (UUID موجود در candidate_profiles). */
  profileId: z.string().uuid("profileId باید UUID معتبر باشد"),
  /** آستانه‌ی امتیاز برای drafted-شدن (۰..۱). اختیاری. */
  scoreThreshold: z.number().min(0).max(1).optional(),
  /** سقفِ تعداد آگهیِ پردازش‌شده در این اجرا. اختیاری. */
  limit: z.number().int().positive().max(500).optional(),
});

export type IngestBody = z.infer<typeof ingestBodySchema>;

/**
 * کوئریِ GET /api/matches — فهرستِ تطبیق‌های کاربرِ احرازشده.
 * کوئری‌پارامترها همیشه رشته‌اند؛ پس عدد را با coerce می‌سازیم.
 *
 * نکته‌ی امنیتی (قاعده‌ی ۴ CONTEXT): این اسکیما عمداً `userId` نمی‌گیرد — کاربرِ هدف
 * فقط از نشستِ احرازشده استخراج می‌شود، نه از کوئریِ قابلِ دستکاری. پذیرفتنِ userId از
 * بیرون به هر کسی اجازه می‌داد تطبیق‌های هر کاربری را با حدسِ UUID بخواند.
 */
export const matchesQuerySchema = z.object({
  /** فیلتر اختیاری روی وضعیت تطبیق. */
  status: z
    .enum(["pending", "scored", "drafted", "queued", "dismissed"])
    .optional(),
  /** صفحه‌بندی: حداکثر تعداد ردیف (۱..۱۰۰، پیش‌فرض ۲۰). */
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** صفحه‌بندی: آفست (≥۰، پیش‌فرض ۰). */
  offset: z.coerce.number().int().min(0).default(0),
});

export type MatchesQuery = z.infer<typeof matchesQuerySchema>;
