import "server-only";

/**
 * مسیرهای «اپلای خودکارِ افزونه» (نشستِ وب) — سطحِ *مرورگر* (GOAL 3، Track B).
 *
 * این مسیر *فقط* تاگلِ سطحِ افزونه (user_auto_apply) را کنترل می‌کند — اپلای در مرورگرِ
 * خودِ کاربر با نشستِ خودش (حلقه‌ی آلارمِ ۱۵-دقیقه‌ای در extension/). سطحِ *سرور* (پَسیو،
 * ناوگانِ ۲۴/۷، Max/Max+) مسیرِ جداگانه‌ی /api/server-auto-apply دارد و این‌جا لمس نمی‌شود.
 *   • GET  /api/auto-apply — تنظیماتِ مؤثرِ تاگلِ افزونه: { enabled, minScore }.
 *   • PUT  /api/auto-apply — ست‌کردنِ تاگلِ افزونه و/یا آستانه (بدنه: { enabled?, minScore? }).
 *
 * برخلافِ سطحِ سرور، این تاگل برای *همه‌ی* پلن‌ها در دسترس است (اجرا در مرورگرِ خودِ کاربر،
 * بدونِ ورکرِ سرور). امنیت/رضایت (قاعده‌ی ۴ + §۱۰ گاردِ ۱): کاربرِ هدف همیشه از کوکیِ نشست
 * گرفته می‌شود (getCurrentUser)، نه از بدنه/کوئری؛ بدنه عمداً userId نمی‌پذیرد. تاگل پیش‌فرض
 * خاموش است و فقط با یک PUTِ صریحِ خودِ کاربر روشن می‌شود (رضایت). هر گذارِ روشن/خاموش یک
 * ردیفِ audit_events می‌نویسد (auto_apply_enabled/disabled) تا ردِ ممیزیِ *سطحِ افزونه* کامل بماند.
 *
 * این فایل از فایل‌های مالکیتیِ Foundation نیست؛ صرفاً مصرف‌کننده‌ی
 * auto-apply.ts (getAutoApplySettings/setAutoApplyEnabled/recordAutoApplyAudit) است.
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { updateAutoApplyBodySchema } from "@/lib/api/auto-apply-schemas";
import { getCurrentUser } from "@/lib/auth/http";
import { EVENTS, track } from "@/lib/analytics";
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
        metadata: { minScore: updated.minScore, channel: "extension" },
      });

      // آنالیتیکس: فقط گذارِ روشن‌شدن را به‌عنوانِ رویدادِ کلیدیِ محصول ثبت می‌کنیم
      // (خاموش‌کردن رویدادِ conversion نیست). best-effort؛ track هرگز throw نمی‌کند.
      if (updated.enabled) {
        track(user.id, EVENTS.APPLY_ENABLED, {
          minScore: updated.minScore,
          channel: "extension",
        });
      }
    }

    return json({ enabled: updated.enabled, minScore: updated.minScore });
  });
}
