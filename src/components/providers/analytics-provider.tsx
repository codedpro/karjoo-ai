"use client";

/**
 * پرووایدرِ آنالیتیکس — اپ را با موارد زیر می‌پوشاند:
 *   • SDK مرورگرِ PostHog (pageview روی ناوبری، Web Vitals، بازپخشِ نشست).
 *   • super-property + groupِ ثابتِ مستأجر (`tenant: 'karjoo'`) روی هر رویداد.
 *   • identify کاربر پس از ورود (از روی کوکیِ نشست، با یک fetchِ سبک به /api/auth/me).
 *
 * کارجو تک‌مستأجر است و نشستِ کاستوم دارد (کوکیِ `karjoo_session`، بدونِ next-auth).
 * چون هیچ context نشستِ کلاینتی نداریم، این پرووایدر یک‌بار پس از mount شناسه‌ی
 * کاربرِ واردشده را از `/api/auth/me` می‌خواند و identify می‌زند؛ روی صفحه‌های
 * ناشناس/لاگین آن اندپوینت ۴۰۱ می‌دهد و ترافیک ناشناس (ولی همچنان مستأجرشده) می‌ماند.
 *
 * RSC-safe: این یک کامپوننتِ کلاینت است؛ layoutِ سرور دست‌نخورده می‌ماند و فقط این
 * را دورِ children می‌پیچد. هیچ propِ غیرسریال‌پذیری از سرور نمی‌گیرد.
 *
 * همه‌چیز guard-شده است: اگر PostHog پیکربندی نشده باشد یا هر فراخوانی خطا دهد،
 * آنالیتیکس هرگز اپ را نمی‌شکند (خطاها بلعیده می‌شوند).
 */

import { Suspense, useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { identify, initClient, setTenant } from "@/lib/analytics/client";
import { PostHogPageviews } from "./posthog-pageviews";

interface MeResponse {
  user?: {
    id: string;
    email: string | null;
    name: string | null;
    avatarUrl?: string | null;
  };
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  // بوتِ یک‌باره‌ی PostHog + برندینگِ مستأجر — پس از hydration (window واقعی است).
  useEffect(() => {
    initClient();
    setTenant();
  }, []);

  // identify کاربرِ واردشده (اگر نشستِ معتبری هست). یک fetchِ سبک و best-effort:
  // موفق → identify + Sentry.setUser؛ ۴۰۱/خطا → ناشناس می‌ماند (بی‌سروصدا).
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) return; // ۴۰۱ = ناشناس؛ کاری نکن.
        const data = (await res.json()) as MeResponse;
        const user = data.user;
        if (!user?.id) return;
        identify(user.id, {
          email: user.email ?? undefined,
          name: user.name ?? undefined,
        });
        Sentry.setUser({ id: user.id, email: user.email ?? undefined });
      } catch {
        // abort / شبکه / JSON خراب — بی‌سروصدا رد شو؛ آنالیتیکس هرگز اپ را نمی‌شکند.
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageviews />
      </Suspense>
      {children}
    </>
  );
}
