import "server-only";

/**
 * GET /api/plans — فهرستِ تعریفِ پلن‌ها (Free/Pro/Max/Max+) برای نمایش.
 *
 * این مسیر «عمومی» است (نیاز به نشست ندارد): صرفاً تعریفِ نسخه‌دارِ پلن‌ها از
 * `plans.ts` (قیمت، اعتبارِ ماهانه، سهمیه‌ی اپلای، تعدادِ IPِ ورکر، تماسِ مستقیم و
 * فهرستِ قابلیت‌ها) را برمی‌گرداند تا صفحه‌ی قیمت‌گذاری/ارتقا بتواند کارت‌ها را بسازد.
 *
 * هیچ داده‌ی کاربری/حساسی اینجا نیست؛ منبعِ حقیقت یک ثابتِ خالصِ کد است
 * (`PLAN_LIST`). چون به DB/کوکی دست نمی‌زند، می‌تواند ایستا/کش‌پذیر بماند، اما برای
 * سادگی و هم‌خوانی با بقیه‌ی مسیرها صرفاً JSON برمی‌گرداند.
 */
import { json, withErrorHandling } from "@/lib/api/http";
import { PLANS_VERSION, PLAN_LIST } from "@/lib/billing/plans";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    return json({
      version: PLANS_VERSION,
      plans: PLAN_LIST,
    });
  });
}
