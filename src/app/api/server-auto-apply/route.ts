import "server-only";

/**
 * مسیرهای «اپلای خودکارِ سرور» (نشستِ وب) — Track B، سطحِ *سرور/پَسیو* (GOAL 3).
 *
 * این سطح کاملاً مستقل از تاگلِ افزونه (/api/auto-apply) است:
 *   • GET  /api/server-auto-apply — وضعیتِ تاگلِ سرور + واجدِ شرایط بودن:
 *       { enabled, minScore, eligible, plan, planLabel, workerIpLimit }.
 *   • PUT  /api/server-auto-apply — ست‌کردنِ تاگلِ سطحِ سرور و/یا آستانه
 *       (بدنه: { enabled?, minScore? }). فقط برای پلن‌های Max/Max+ (workerIpLimit > 0).
 *
 * پلن‌گِیت (سختِ Track B): پیش از هر نوشتنی، اگر پلنِ کاربر ورکر ندارد (Free/Pro) و کاربر
 * می‌خواهد تاگل را روشن کند، با ۴۰۳ و بدنه‌ی ساخت‌یافته (code:'not_entitled') رد می‌شود —
 * هیچ upsert/ممیزی‌ای رخ نمی‌دهد. خاموش‌کردن همیشه مجاز است (کاربری که پلنش پایین آمده باید
 * بتواند رضایتِ قبلی را لغو کند).
 *
 * امنیت/رضایت (قاعده‌ی ۴ + §۱۰): کاربرِ هدف همیشه از کوکیِ نشست گرفته می‌شود (getCurrentUser)،
 * نه از بدنه؛ بدنه عمداً userId نمی‌پذیرد. تاگل پیش‌فرض خاموش است و فقط با یک PUTِ صریحِ خودِ
 * کاربر روشن می‌شود. هر گذارِ روشن/خاموش یک ردیفِ audit_events می‌نویسد
 * (server_auto_apply_enabled/disabled) تا این سطح ردِ ممیزیِ *جدا* از افزونه داشته باشد.
 *
 * این فایل مصرف‌کننده‌ی هسته‌ی Foundation است (getServerAutoApplySettings/
 * setServerAutoApplyEnabled/recordAutoApplyAudit + workerIpLimitFor)؛ فایلِ مالکیتی نیست.
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { updateServerAutoApplyBodySchema } from "@/lib/api/server-auto-apply-schemas";
import { getCurrentUser } from "@/lib/auth/http";
import {
  getServerAutoApplySettings,
  recordAutoApplyAudit,
  setServerAutoApplyEnabled,
} from "@/lib/apply/auto-apply";
import { planFor, workerIpLimitFor } from "@/lib/billing/plans";

// به DB و node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ────────────────────────  GET /api/server-auto-apply  ─────────────────────── */

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // تنظیماتِ مؤثرِ سطحِ سرور — نبودِ ردیف → پیش‌فرضِ محتاطانه { enabled:false, minScore:0.7 }.
    const settings = await getServerAutoApplySettings(user.id);
    const workerIpLimit = workerIpLimitFor(user.plan);

    return json({
      enabled: settings.enabled,
      minScore: settings.minScore,
      // واجدِ شرایطِ سطحِ سرور فقط پلن‌های دارای ورکر (Max/Max+) هستند.
      eligible: workerIpLimit > 0,
      plan: planFor(user.plan).key,
      planLabel: planFor(user.plan).labelFa,
      workerIpLimit,
    });
  });
}

/* ────────────────────────  PUT /api/server-auto-apply  ─────────────────────── */

export async function PUT(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // اعتبارسنجیِ بدنه — { enabled?, minScore? }، دستِ‌کم یکی حاضر (۴۰۰ در غیرِ این صورت).
    const body = await parseJsonBody(request, updateServerAutoApplyBodySchema);

    const workerIpLimit = workerIpLimitFor(user.plan);
    const eligible = workerIpLimit > 0;

    // پلن‌گِیتِ سخت: پلنِ بدونِ ورکر (Free/Pro) *نمی‌تواند روشن کند*. هر تلاش برای روشن‌کردن
    // (یا صرفِ تغییرِ آستانه در حالِ فعال‌بودنِ درخواست‌شده) پیش از هر نوشتنی با ۴۰۳ رد می‌شود.
    // خاموش‌کردن (enabled=false) همیشه مجاز است تا رضایتِ قبلی قابلِ لغو بماند.
    const wantsEnable = body.enabled === true;
    // تغییرِ آستانه بدونِ enabled صریح، فقط وقتی معنا دارد که کاربر واجدِ شرایط باشد.
    const wantsThresholdOnly = body.enabled === undefined && body.minScore !== undefined;

    if (!eligible && (wantsEnable || wantsThresholdOnly)) {
      return errorJson(
        "اپلای خودکارِ سرور نیازمندِ پلنِ Max یا Max+ است. برای فعال‌سازی، پلنِ خود را ارتقا دهید.",
        403,
        {
          code: "not_entitled",
          plan: planFor(user.plan).key,
          planLabel: planFor(user.plan).labelFa,
          workerIpLimit,
        },
      );
    }

    // وضعیتِ فعلی را پیش از تغییر می‌خوانیم تا گذارِ تاگل را برای ممیزی تشخیص دهیم.
    const before = await getServerAutoApplySettings(user.id);

    // مقدارِ نهاییِ enabled: اگر در بدنه نبود، همان حالتِ فعلی حفظ می‌شود (فقط آستانه تغییر کند).
    const nextEnabled = body.enabled ?? before.enabled;

    const updated = await setServerAutoApplyEnabled(user.id, nextEnabled, {
      ...(body.minScore === undefined ? {} : { minScore: body.minScore }),
    });

    // ردِ ممیزیِ گذارِ تاگلِ سرور — فقط وقتی حالتِ روشن/خاموش واقعاً عوض شده باشد.
    // metadata فقط متادیتای تصمیم است (آستانه)، هرگز نشست/راز نیست.
    if (before.enabled !== updated.enabled) {
      await recordAutoApplyAudit({
        userId: user.id,
        eventType: updated.enabled
          ? "server_auto_apply_enabled"
          : "server_auto_apply_disabled",
        metadata: { minScore: updated.minScore, channel: "server" },
      });
    }

    return json({ enabled: updated.enabled, minScore: updated.minScore });
  });
}
