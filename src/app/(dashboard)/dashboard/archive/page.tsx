import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getDashboardUser } from "@/components/dashboard/session";
import { EmptyState, PageHeader } from "@/components/dashboard/ui";
import {
  ApplicationArchiveTable,
  type ArchiveRow,
} from "@/components/dashboard/application-archive-table";
import { listApplicationArchive } from "@/lib/apply/application-archive";

/**
 * «بایگانیِ اپلای» — سابقه‌ی کاملِ آن‌چه از طرفِ کاربر فرستاده شده.
 *
 * تفاوتش با /dashboard/applications: آن‌جا قیفِ وضعیت است که از خودِ جابینجا **خوانده**
 * می‌شود؛ این‌جا چیزی است که **خودِ کارجو فرستاده** — با شرحِ آگهی و مهم‌تر از همه، همان
 * نسخه‌ی رزومه‌ای که واقعاً ارسال شده. برای وقتی کارفرما تماس می‌گیرد و کاربر باید بداند
 * دقیقاً چه چیزی دیده است.
 */
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "بایگانیِ اپلای",
  robots: { index: false, follow: false },
};

export default async function ArchivePage() {
  const user = await getDashboardUser();
  if (!user) redirect("/login");

  const items = await listApplicationArchive(user.userId, 200);

  // تاریخ‌ها برای مرزِ سرور→کلاینت باید سریال‌پذیر باشند.
  const rows: ArchiveRow[] = items.map((i) => ({
    ...i,
    submittedAt: i.submittedAt ? i.submittedAt.toISOString() : null,
    createdAt: i.createdAt.toISOString(),
  }));

  const withResume = rows.filter((r) => r.resume).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <PageHeader
        title="بایگانیِ اپلای"
        subtitle="هر اپلایی که از طرفِ شما ارسال شده — همراه با شرحِ آگهی و همان رزومه‌ای که فرستاده شد."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="هنوز اپلایی ثبت نشده"
          body="پس از اولین اپلای (با افزونه یا اپلای خودکارِ سرور)، همین‌جا شرکت، شرحِ شغل و رزومه‌ی ارسال‌شده را می‌بینید."
        />
      ) : (
        <>
          <p className="mb-4 text-xs text-muted">
            از {rows.length} اپلای، برای {withResume} مورد رزومه‌ی سفارشیِ همان آگهی ذخیره شده است.
          </p>
          <ApplicationArchiveTable rows={rows} />
        </>
      )}
    </div>
  );
}
