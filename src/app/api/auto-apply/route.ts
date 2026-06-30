import "server-only";

/**
 * مسیرهای «اپلای خودکار» (نشستِ وب) — Track A، مصرف‌کننده‌ی هسته‌ی Foundation:
 *   • GET  /api/auto-apply — تنظیماتِ مؤثرِ کاربر: { enabled, minScore }.
 *   • PUT  /api/auto-apply — ست‌کردنِ تاگلِ رضایت و/یا آستانه (بدنه: { enabled?, minScore? }).
 *
 * امنیت/رضایت (قاعده‌ی ۴ + §۱۰ گاردِ ۱): کاربرِ هدف همیشه از کوکیِ نشست گرفته می‌شود
 * (getCurrentUser)، نه از بدنه/کوئری؛ بدنه عمداً userId نمی‌پذیرد. تاگل پیش‌فرض خاموش
 * است و فقط با یک PUTِ صریحِ خودِ کاربر روشن می‌شود (رضایت). هر تغییرِ روشن/خاموش‌شدنِ
 * تاگل یک ردیفِ audit_events می‌نویسد (auto_apply_enabled/disabled) تا ردِ ممیزی کامل بماند.
 *
 * این فایل از فایل‌های مالکیتیِ Foundation نیست؛ صرفاً مصرف‌کننده‌ی
 * auto-apply.ts (getAutoApplySettings/setAutoApplyEnabled/recordAutoApplyAudit) است.
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { updateAutoApplyBodySchema } from "@/lib/api/auto-apply-schemas";
import { getCurrentUser } from "@/lib/auth/http";
import {
  getAutoApplySettings,
  recordAutoApplyAudit,
  setAutoApplyEnabled,
} from "@/lib/apply/auto-apply";

// به DB و node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ───────────────────────────  GET /api/auto-apply  ─────────────────────────── */

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // تنظیماتِ مؤثر — نبودِ ردیف → پیش‌فرضِ محتاطانه { enabled:false, minScore:0.7 }.
    const settings = await getAutoApplySettings(user.id);
    return json({ enabled: settings.enabled, minScore: settings.minScore });
  });
}

/* ───────────────────────────  PUT /api/auto-apply  ─────────────────────────── */

export async function PUT(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // اعتبارسنجیِ بدنه — { enabled?, minScore? }، دستِ‌کم یکی حاضر (۴۰۰ در غیرِ این صورت).
    const body = await parseJsonBody(request, updateAutoApplyBodySchema);

    // وضعیتِ فعلی را پیش از تغییر می‌خوانیم تا گذارِ تاگل را برای ممیزی تشخیص دهیم.
    const before = await getAutoApplySettings(user.id);

    // مقدارِ نهاییِ enabled: اگر در بدنه نبود، همان حالتِ فعلی حفظ می‌شود (فقط آستانه تغییر کند).
    const nextEnabled = body.enabled ?? before.enabled;

    const updated = await setAutoApplyEnabled(user.id, nextEnabled, {
      ...(body.minScore === undefined ? {} : { minScore: body.minScore }),
    });

    // ردِ ممیزیِ گذارِ تاگل — فقط وقتی حالتِ روشن/خاموش واقعاً عوض شده باشد.
    // metadata فقط متادیتای تصمیم است (آستانه)، هرگز نشست/راز نیست.
    if (before.enabled !== updated.enabled) {
      await recordAutoApplyAudit({
        userId: user.id,
        eventType: updated.enabled ? "auto_apply_enabled" : "auto_apply_disabled",
        metadata: { minScore: updated.minScore },
      });
    }

    return json({ enabled: updated.enabled, minScore: updated.minScore });
  });
}
