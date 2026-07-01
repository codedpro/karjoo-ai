import "server-only";

/**
 * POST /api/internal/obs-smoke  — «دودِ مشاهده‌پذیری» (verification probe).
 *
 * وقتی فراخوانی شود، دقیقاً *یکی* از هر سیگنال به هابِ مشاهده‌پذیری می‌فرستد تا پس از
 * استقرار بتوان بررسی کرد هر سه backend داده را دریافت کرده‌اند:
 *   • Sentry  — یک captureException با پیامِ «Karjoo observability probe» (عمداً از فیلترِ smoke عبور می‌کند تا دیده شود).
 *   • Loki    — یک logger.error (سپس flush تا پیش از پاسخ به Loki برود).
 *   • PostHog — یک track('obs_smoke') سمتِ سرور با posthog-node (سپس shutdown/flush).
 *
 * سپس { ok: true, sent: [...] } برمی‌گرداند (فقط سیگنال‌هایی که واقعاً پیکربندی شده‌اند).
 *
 * نکته‌ی طراحی — راستی‌آزمایی: پیامِ خطای Sentry عمداً هیچ‌یک از زیررشته‌های drop
 * (مثلِ «obs-smoke»/«karjoo-smoke-») را ندارد، پس isSmokeEvent آن را حذف نمی‌کند و
 * رویداد واقعاً در استریمِ ایشوهای پروژه‌ی karjoo ظاهر می‌شود (برای اثباتِ دریافت). عنوانِ
 * ایشو «safe to resolve» است. نشانِ یکتای اجرا (marker) فقط در tagها می‌آید (نه در پیام).
 *
 * محافظت: مثلِ بقیه‌ی /api/internal/* با رازِ مشترکِ داخلی (INTERNAL_API_SECRET) و هدرِ
 * X-Internal-Secret محافظت می‌شود (guardInternal: fail-closed → ۵۰۳ اگر راز ست نشده،
 * ۴۰۱ اگر راز نادرست؛ مقایسه طول‌ثابت). posthog-node فقط سمتِ سرور import می‌شود.
 */
import * as Sentry from "@sentry/nextjs";
import { PostHog } from "posthog-node";

import { guardInternal, json, withErrorHandling } from "@/lib/api/http";
import { logger } from "@/lib/observability/logger";

// به Node API (process.env، fetch، posthog-node) و logger دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — هیچ کشی روی یک probeِ راستی‌آزمایی نباید بیفتد.
export const dynamic = "force-dynamic";

/** سرورِ PostHog (اختیاری): فقط اگر کلیدِ سرور تنظیم شده باشد track می‌کنیم. */
const POSTHOG_KEY = process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://ph.io9.uk";

/**
 * یک event به PostHog (سمتِ سرور) می‌فرستد و بی‌درنگ flush/shutdown می‌کند. هرگز throw
 * نمی‌کند: اگر کلید نباشد یا ارسال شکست بخورد، false برمی‌گرداند و probe ادامه می‌دهد.
 */
async function trackPosthogSmoke(distinctId: string, marker: string): Promise<boolean> {
  if (!POSTHOG_KEY) return false;
  const client = new PostHog(POSTHOG_KEY, {
    host: POSTHOG_HOST,
    // probe یک‌بارمصرف است؛ نمی‌خواهیم بچ/interval پس‌زمینه بماند.
    flushAt: 1,
    flushInterval: 0,
  });
  try {
    client.capture({
      distinctId,
      event: "obs_smoke",
      properties: {
        tenant: "karjoo",
        source: "obs-smoke-endpoint",
        marker,
        env: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
      },
    });
    // shutdown صف را flush می‌کند و منتظرِ ارسال می‌ماند (پیش از پاسخ).
    await client.shutdown();
    return true;
  } catch {
    // هرگز نگذار خطای PostHog به مسیرِ درخواست نشت کند.
    try {
      await client.shutdown();
    } catch {
      /* بی‌صدا */
    }
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) نگهبانِ رازِ مشترک (fail-closed). هدر: X-Internal-Secret ← INTERNAL_API_SECRET.
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    // نشانِ یکتای این اجرا — تا در هر سه backend بتوان همین probe را پیدا/همبسته کرد.
    const marker = `karjoo-smoke-${Date.now()}`;
    const sent: string[] = [];

    // ۲) Sentry — یک استثنای راستی‌آزمایی که *به‌عمد از فیلترِ isSmokeEvent عبور می‌کند*
    //    تا واقعاً در استریمِ ایشوهای پروژه‌ی karjoo دیده شود (پیام هیچ‌یک از زیررشته‌های
    //    drop مثلِ «obs-smoke»/«karjoo-smoke-» را ندارد؛ marker فقط در tag می‌آید). پس از
    //    تأییدِ دریافت، ایشو را در Sentry resolve کنید — عنوانش می‌گوید safe to resolve.
    try {
      Sentry.captureException(new Error("Karjoo observability probe — safe to resolve"), {
        tags: { source: "obs-verify", tenant: "karjoo", marker },
      });
      // مطمئن شو پیش از پاسخ به Sentry رفته (probeها اغلب بلافاصله پس از پاسخ کشته می‌شوند).
      await Sentry.flush(2000).catch(() => {});
      sent.push("sentry");
    } catch {
      /* هرگز throw نکن — probe باید سیگنال‌های دیگر را هم امتحان کند. */
    }

    // ۳) Loki — یک خطِ error، سپس flushِ دستی تا پیش از پاسخ به Loki برود.
    try {
      logger.error("obs-smoke loki test", {
        marker,
        tenant: "karjoo",
        source: "obs-smoke-endpoint",
      });
      await logger.flush();
      sent.push("loki");
    } catch {
      /* logger هرگز throw نمی‌کند؛ این فقط دفاعِ اضافه است. */
    }

    // ۴) PostHog — یک track('obs_smoke') سمتِ سرور + flush/shutdown.
    if (await trackPosthogSmoke(marker, marker)) {
      sent.push("posthog");
    }

    return json({ ok: true, sent, marker });
  });
}
