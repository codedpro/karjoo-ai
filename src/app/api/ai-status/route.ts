import "server-only";

/**
 * GET /api/ai-status — وضعیتِ در دسترس بودنِ سرویسِ هوش مصنوعی (WF3 Track B).
 *
 * خروجی (عمداً مینیمال): `{ maintenance: boolean, reason: 'cap'|'manual'|null }`.
 *   • maintenance=true یعنی هر کنشِ پولیِ AI همین‌حالا بلاک است (سقفِ بودجه‌ی ماهانه
 *     رسیده یا پرچمِ دستیِ ادمین روشن است). UI با این، بنرِ نگه‌داری را نشان می‌دهد و
 *     دکمه‌های AI را غیرفعال می‌کند.
 *   • reason='cap' (سقفِ بودجه) یا 'manual' (خاموشیِ دستی) — فقط همین دو نشانه؛ هرگز
 *     رقمِ خامِ بودجه/دلاری فاش نمی‌شود (آن فقط سمتِ سرور است؛ CONTEXT بخش A).
 *
 * این Foundation#maintenanceStatus را مصرف می‌کند (شمارنده‌ی ماهانه + پرچمِ دستی) و
 * فقط boolean/reason را برمی‌گرداند. نشست لازم است (سطحِ «logged-in users»). در صورتِ
 * هر خطای DB، fail-open («در دسترس») تا یک اختلالِ خواندنِ وضعیت کلِ UIِ AI را قفل نکند —
 * گیتِ واقعی (assertAiAvailable) همچنان سمتِ سرور در metering اعمال می‌شود.
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { maintenanceStatus } from "@/lib/billing/ai-budget";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    try {
      const status = await maintenanceStatus();
      // علت فقط وقتی برگردانده می‌شود که نگه‌داری فعال است؛ پرچمِ دستی بر سقف اولویت دارد
      // (هم‌راستا با AiMaintenanceError.manual). هیچ مبلغی (monthUpstream/cap) لو نمی‌رود.
      const reason = !status.inMaintenance
        ? null
        : status.manual
          ? ("manual" as const)
          : ("cap" as const);

      return json({ maintenance: status.inMaintenance, reason });
    } catch {
      // خواندنِ وضعیت ناموفق (DB در دسترس نیست) → «در دسترس» نمایش بده تا UI قفل نشود.
      return json({ maintenance: false, reason: null });
    }
  });
}
