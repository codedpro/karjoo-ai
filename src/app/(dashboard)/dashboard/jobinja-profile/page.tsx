/**
 * صفحه‌ی «پروفایلِ جابینجای شما» (Server component) — gate شده با نشست.
 *
 * عکس‌برداریِ رزومه‌ی جابینجا (که در فازِ ۲ ذخیره شده) را از DB می‌خواند و به‌شکلِ یک کارت
 * نمایش می‌دهد. تعاملْ (دکمه‌ی همگام‌سازی) در JobinjaProfileCard (client) است؛ خواندنِ داده
 * این‌جا در سرور (RSC) انجام می‌شود و مدافعانه به فیلدهای سریال‌پذیر نگاشته می‌شود — هیچ فیلدی
 * تضمین‌شده نیست، پس هرکدام که موجود بود رندر می‌شود.
 *
 * الگوی Next 16 (پوسته‌ی فوری): هدرِ استاتیک بی‌درنگ می‌آید؛ بخشِ وابسته به DB داخلِ
 * `<Suspense>` استریم می‌شود. مقید به نشست (قاعده‌ی ۴). فارسی/RTL.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getDashboardUser } from "@/components/dashboard/session";
import {
  JobinjaProfileCard,
  type JobinjaProfileView,
} from "@/components/dashboard/jobinja-profile-card";
import { PageHeader, Skeleton, SkeletonText } from "@/components/dashboard/ui";
import { getProfileSnapshot } from "@/lib/apply/boards/jobinja-read";

// راستی‌آزماییِ نشست + خواندنِ DB → اجرای Node (استریم با Suspense).
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "پروفایلِ جابینجا",
  robots: { index: false, follow: false },
};

export default async function JobinjaProfilePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-8">
      <PageHeader
        title="پروفایلِ جابینجای شما"
        subtitle="نگاهی به رزومه‌ی جابینجای شما همان‌گونه که هوش مصنوعیِ کارجو می‌بیند. برای تازه‌سازی از «به‌روزرسانی» استفاده کنید."
      />

      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileSection userId={user.userId} />
      </Suspense>
    </div>
  );
}

/* ───────────────────────── بخشِ async (Suspense) ───────────────────────── */

async function ProfileSection({ userId }: { userId: string }) {
  const snapshot = await getProfileSnapshot(userId, "jobinja");
  const profile = snapshot ? toProfileView(snapshot) : null;
  return <JobinjaProfileCard profile={profile} />;
}

/* ─────────────────────────  نگاشتِ مدافعانه‌ی داده  ─────────────────────── */

/** رشته‌ی ناتهی را برمی‌گرداند، وگرنه null (هرچیزِ غیر-رشته/تهی → null). */
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** اولین کلیدِ موجودِ ناتهی از میانِ نام‌های محتمل (تحملِ نام‌گذاریِ متفاوتِ منبع). */
function pick(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = str(data[k]);
    if (v) return v;
  }
  return null;
}

/** آرایه‌ی مهارت‌ها را نرمال می‌کند: فقط رشته‌های ناتهیِ یکتا. */
function skillList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    const s = str(item);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** تاریخ را به فارسی (شمسیِ نمایشی + ساعت) قالب می‌گیرد — در سرور، ایمن در خطا. */
function faDateTime(d: Date): string | null {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return null;
  }
}

/** snapshotِ DB را به فیلدهای نمایشیِ سریال‌پذیرِ کارت نگاشت می‌کند (همه اختیاری). */
function toProfileView(snapshot: {
  data: Record<string, unknown>;
  publicUrl: string | null;
  fetchedAt: Date;
}): JobinjaProfileView {
  const data = snapshot.data ?? {};
  return {
    fullName: pick(data, "fullName", "name"),
    headline: pick(data, "headline", "title", "jobTitle"),
    employmentStatus: pick(data, "employmentStatus", "employment_status", "jobStatus"),
    about: pick(data, "about", "summary", "bio"),
    skills: skillList(data.skills),
    email: pick(data, "email"),
    phone: pick(data, "phone", "mobile"),
    city: pick(data, "city"),
    province: pick(data, "province", "state"),
    // publicUrlِ ستونِ اختصاصی مقدم است؛ در نبودش از داخلِ data.
    publicUrl: str(snapshot.publicUrl) ?? pick(data, "publicUrl"),
    fetchedAtLabel: snapshot.fetchedAt instanceof Date ? faDateTime(snapshot.fetchedAt) : null,
  };
}

/* ─────────────────────────────── اسکلت ────────────────────────────────── */

/** اسکلتِ هم‌شکلِ کارتِ پروفایل — هدر (آواتار + دو خط)، تماس، درباره، و چیپ‌های مهارت. */
function ProfileSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6" aria-hidden>
      <div className="flex items-start gap-4">
        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3.5 w-64" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-40" />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        <Skeleton className="h-4 w-24" />
        <SkeletonText lines={3} />
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-full" />
        ))}
      </div>
    </div>
  );
}
