"use client";

/**
 * آنالیتیکسِ سمتِ کلاینت — پوشش‌دهنده‌ی SDK مرورگرِ PostHog.
 *
 * با اولین فراخوانیِ `initClient()` از `<AnalyticsProvider />` بوت می‌شود.
 * هر تابع وقتی `NEXT_PUBLIC_POSTHOG_KEY` تنظیم نشده باشد no-op-safe است.
 *
 * تک‌مستأجر: نامِ ثابتِ مستأجر (`karjoo`) به‌عنوانِ یک super-propertyِ ماندگار *و* یک
 * groupِ PostHog روی *هر* رویداد ثبت می‌شود — ترافیکِ ناشناس هم شامل — تا داشبوردها
 * بدونِ نیاز به ورودِ کاربر بتوانند بر اساسِ برند فیلتر کنند. ببینید `setTenant()`.
 * این مقدار با تگِ Sentry (`tenant: 'karjoo'`) هم‌راستاست.
 */

import posthog from "posthog-js";
import { TENANT, type EventName, type EventProps, type IdentifyProps } from "./types";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://ph.io9.uk";

let booted = false;

export function initClient(): void {
  if (booted || typeof window === "undefined" || !POSTHOG_KEY) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // pageviewها را خودمان دستی می‌زنیم (روی ناوبریِ App Router). ببینید trackPageview.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    // اتوکپچرِ استثنا — خطای مدیریت‌نشده + rejectionِ promise سمتِ کلاینت را می‌گیرد
    // تا PostHog Error Tracking یک جریانِ کلاینت داشته باشد. خطای consoleخاموش می‌ماند
    // تا با جریانِ خطای از پیش فیلترشده‌ی Sentry هم‌پوشانی/دوباره‌شماری نکند.
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    // Web Vitals بومیِ PostHog — رویدادِ رزروشده‌ی '$web_vital' را خودِ PostHog منتشر
    // می‌کند (چهار متریکِ اصلی). Sentry هم Web Vitals دارد؛ این‌ها در دو backend مستقل
    // می‌نشینند و تداخلی ندارند.
    capture_performance: {
      web_vitals: true,
      web_vitals_allowed_metrics: ["LCP", "CLS", "FCP", "INP"],
    },
    enable_heatmaps: true,
    // بازپخشِ نشست (session replay) روشن — با ماسکِ ورودی‌ها برای حریمِ خصوصی.
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "[data-private]",
    },
    // خروجیِ console را داخلِ بازپخشِ نشست ضبط کن (زمینه‌ی غنی‌تر برای دیباگ).
    enable_recording_console_log: true,
    persistence: "localStorage+cookie",
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.debug(false);
      // به محضِ بوت، برندِ مستأجر را روی نشست بنشان (حتی برای بازدیدکننده‌ی ناشناس)
      // تا ترافیکِ لاگ‌این‌نشده (pageview / web vital) قابلِ انتساب به برند باشد.
      try {
        ph.register({ tenant: TENANT });
        ph.group("tenant", TENANT, { name: TENANT });
      } catch {
        /* no-op */
      }
    },
  });
  booted = true;
}

function isLoaded(): boolean {
  return booted && typeof window !== "undefined" && !!POSTHOG_KEY;
}

export function track(event: EventName, props: EventProps = {}): void {
  if (!isLoaded()) return;
  try {
    posthog.capture(event, props as Record<string, unknown>);
  } catch (err) {
    console.warn("[analytics] track failed:", err);
  }
}

/**
 * دستگاهِ جاری + همه‌ی رویدادهای بعدی را به برندِ مستأجرِ کارجو گره می‌زند.
 * برای *هر* بازدیدکننده (ناشناس هم) اجرا می‌شود. هم یک super-propertyِ ماندگار
 * (`tenant`) و هم یک groupِ PostHog (`tenant`) می‌نشاند. idempotent است.
 */
export function setTenant(): void {
  if (!isLoaded()) return;
  try {
    posthog.register({ tenant: TENANT });
    posthog.group("tenant", TENANT, { name: TENANT });
  } catch (err) {
    console.warn("[analytics] setTenant failed:", err);
  }
}

export function identify(distinctId: string, props: IdentifyProps = {}): void {
  if (!isLoaded()) return;
  try {
    posthog.identify(distinctId, {
      email: props.email,
      name: props.name,
    });
    // مستأجر را روی identify دوباره تأکید کن (ترافیکِ ناشناس قبلاً از initClient/setTenant
    // آن را دارد، اما identify رویدادهای پیش‌از-ورود را با این شخص merge می‌کند).
    setTenant();
  } catch (err) {
    console.warn("[analytics] identify failed:", err);
  }
}

export function trackPageview(url: string): void {
  // خودبوت‌شونده: <PostHogPageviews/> فرزندِ <AnalyticsProvider/> است، پس effectش پیش از
  // initClient() والد اجرا می‌شود — اولین $pageview هر بارگذاریِ کاملِ صفحه در غیرِ این
  // صورت به SDKِ بوت‌نشده می‌خورد و دور ریخته می‌شود. initClient idempotent است.
  if (!booted) initClient();
  if (!isLoaded()) return;
  try {
    posthog.capture("$pageview", { $current_url: url });
  } catch {
    /* no-op */
  }
}

export function reset(): void {
  if (!isLoaded()) return;
  try {
    posthog.reset();
  } catch {
    /* no-op */
  }
}

/**
 * کنترلِ رضایتِ GDPR. opt-out داخلیِ PostHog روی همه‌ی رویدادها و بازپخشِ نشست
 * رعایت می‌شود.
 */
export function setConsent(accepted: boolean): void {
  if (typeof window === "undefined" || !POSTHOG_KEY) return;
  try {
    if (accepted) posthog.opt_in_capturing();
    else posthog.opt_out_capturing();
  } catch {
    /* no-op */
  }
}
