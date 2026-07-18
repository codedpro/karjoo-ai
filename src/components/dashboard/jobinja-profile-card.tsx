"use client";

/**
 * کارتِ «پروفایلِ جابینجای شما» (client component) — نمایشِ عکس‌برداریِ رزومه‌ی جابینجا که
 * در فازِ ۲ ذخیره شده، به‌همراهِ دکمه‌ی «به‌روزرسانی» (همگام‌سازیِ سمتِ سرور).
 *
 * چرا client؟ فقط برای دکمه‌ی همگام‌سازی (fetch + حالتِ بارگذاری + router.refresh + مدیریتِ
 * ۴۰۹). خودِ داده در سرور (RSC) خوانده و به شکلِ سریال‌پذیر (JobinjaProfileView) پاس داده
 * می‌شود؛ این‌جا هیچ I/O یا رازی نیست. تاریخ ازپیش در سرور به فارسی قالب می‌گیرد تا
 * ناهماهنگیِ hydration پیش نیاید. همه‌ی فیلدها اختیاری‌اند و مدافعانه رندر می‌شوند.
 */
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
} from "./ui";
import {
  IconLink,
  IconMail,
  IconMapPin,
  IconPhone,
  IconPlug,
  IconRefresh,
  IconUser,
} from "./icons";

/** فیلدهای نمایشیِ پروفایلِ جابینجا — از snapshotِ سرور مدافعانه نگاشته می‌شود (سریال‌پذیر). */
export interface JobinjaProfileView {
  fullName: string | null;
  headline: string | null;
  employmentStatus: string | null;
  about: string | null;
  skills: string[];
  email: string | null;
  phone: string | null;
  city: string | null;
  province: string | null;
  publicUrl: string | null;
  /** تاریخِ به‌روزرسانی — ازپیش در سرور به فارسی قالب‌گرفته (تهی اگر نامعتبر). */
  fetchedAtLabel: string | null;
}

/** آیا رشته‌ای واقعی و ناتهی است؟ (تریمِ فاصله). */
function has(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function JobinjaProfileCard({
  profile,
}: {
  profile: JobinjaProfileView | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** همگام‌سازیِ سمتِ سرور: POST به روتِ sync، سپس تازه‌سازیِ RSC. */
  async function runSync() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    // مثلِ دکمه‌ی شارژ: لبه‌ی کندِ ایران را با abort ۲۰ ثانیه‌ای مقید می‌کنیم.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("/api/boards/jobinja/sync", {
        method: "POST",
        signal: controller.signal,
      });
      if (res.status === 409) {
        setError("ابتدا جابینجا را وصل کنید.");
        return;
      }
      if (res.status === 401) {
        setError("برای همگام‌سازی وارد شوید.");
        return;
      }
      const data: { ok?: boolean; profile?: boolean; error?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok || data.ok === false) {
        setError(
          has(data.error) ? data.error : "همگام‌سازی ناموفق بود. دوباره تلاش کنید.",
        );
        return;
      }
      setNotice(
        data.profile
          ? "پروفایل به‌روزرسانی شد."
          : "همگام‌سازی انجام شد؛ تغییرِ تازه‌ای در پروفایل نبود.",
      );
      router.refresh();
    } catch {
      setError(
        controller.signal.aborted
          ? "همگام‌سازی بیش از حد طول کشید. دوباره تلاش کنید."
          : "اتصال به سرور برقرار نشد.",
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  const syncButton = (
    <Button variant="secondary" size="sm" onClick={runSync} disabled={busy}>
      <IconRefresh className={busy ? "animate-spin" : undefined} aria-hidden />
      {busy ? "در حال همگام‌سازی…" : "به‌روزرسانی از جابینجا"}
    </Button>
  );

  /** پیام‌های وضعیت (خطا/موفقیت) — مشترک بینِ حالتِ خالی و کارت. */
  const feedback = (
    <>
      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-rose-500">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 text-sm font-medium text-emerald-500">{notice}</p>
      ) : null}
    </>
  );

  /* ─────────────────────────── حالتِ خالی ─────────────────────────── */
  if (!profile) {
    return (
      <div>
        <EmptyState
          icon={<IconPlug />}
          title="هنوز پروفایلِ جابینجا همگام نشده"
          body="با افزونه به جابینجا وصل شوید یا همین‌جا «به‌روزرسانی» را بزنید تا رزومه‌ی جابینجای شما این‌جا نمایش داده شود."
          action={syncButton}
        />
        <div className="text-center">{feedback}</div>
      </div>
    );
  }

  /* ─────────────────────────── کارتِ پروفایل ───────────────────────── */
  const contactRow = [
    has(profile.email) ? { icon: <IconMail aria-hidden />, text: profile.email } : null,
    has(profile.phone) ? { icon: <IconPhone aria-hidden />, text: profile.phone } : null,
    locationText(profile)
      ? { icon: <IconMapPin aria-hidden />, text: locationText(profile) }
      : null,
  ].filter(Boolean) as { icon: ReactNode; text: string }[];

  return (
    <Card padded className="space-y-6">
      {/* هدر: نام + عنوانِ شغلی + وضعیتِ اشتغال + دکمه‌ی همگام‌سازی */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand/10 text-brand [&>svg]:h-6 [&>svg]:w-6"
            aria-hidden
          >
            <IconUser />
          </span>
          <div className="min-w-0">
            <h2 className="text-balance text-xl font-extrabold tracking-tight">
              {has(profile.fullName) ? profile.fullName : "کارجوی جابینجا"}
            </h2>
            {has(profile.headline) ? (
              <p className="mt-1 text-pretty text-sm leading-6 text-muted">
                {profile.headline}
              </p>
            ) : null}
            {has(profile.employmentStatus) ? (
              <div className="mt-2">
                <Badge tone="green">{profile.employmentStatus}</Badge>
              </div>
            ) : null}
          </div>
        </div>
        <div className="shrink-0">{syncButton}</div>
      </div>

      {/* ردیفِ تماس — فقط فیلدهای موجود */}
      {contactRow.length > 0 ? (
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          {contactRow.map((c, i) => (
            <li key={i} className="inline-flex items-center gap-2 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-muted">
              {c.icon}
              <span className="ltr-nums break-all">{c.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* درباره‌ی من */}
      {has(profile.about) ? (
        <section>
          <h3 className="text-sm font-bold text-foreground">درباره‌ی من</h3>
          <p className="mt-2 whitespace-pre-line text-pretty text-sm leading-7 text-muted">
            {profile.about}
          </p>
        </section>
      ) : null}

      {/* مهارت‌ها */}
      {profile.skills.length > 0 ? (
        <section>
          <h3 className="text-sm font-bold text-foreground">مهارت‌ها</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.skills.map((s, i) => (
              <Badge key={`${s}-${i}`} tone="brand">
                {s}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {/* پاورقی: لینکِ عمومی + آخرین به‌روزرسانی */}
      <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        {has(profile.publicUrl) ? (
          <a
            href={profile.publicUrl}
            target="_blank"
            rel="nofollow noopener noreferrer"
            className="focus-ring inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-brand transition-colors hover:brightness-110 [&>svg]:h-4 [&>svg]:w-4"
          >
            <IconLink aria-hidden />
            مشاهده در جابینجا ↗
          </a>
        ) : (
          <span />
        )}
        {has(profile.fetchedAtLabel) ? (
          <p className="ltr-nums text-xs text-muted">
            آخرین به‌روزرسانی: {profile.fetchedAtLabel}
          </p>
        ) : null}
      </div>

      {feedback}
    </Card>
  );
}

/** شهر و استان را به یک رشته‌ی خوانا می‌چسباند (هرکدام که موجود باشد). */
function locationText(p: JobinjaProfileView): string {
  const parts = [p.city, p.province].filter(has);
  return parts.join("، ");
}
