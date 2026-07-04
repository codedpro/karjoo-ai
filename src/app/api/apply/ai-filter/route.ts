import "server-only";

/**
 * مسیرهای «فیلترِ هوشمند (AI)» — تاگلِ پریمیومِ Phase 4 (Track C).
 *
 *   • GET  /api/apply/ai-filter — وضعیتِ گیت: { enabled, entitled, aiFilter, plan, balanceToman }.
 *   • PUT  /api/apply/ai-filter — ست‌کردنِ تاگل (بدنه: { enabled: boolean }).
 *
 * پیوُت محصول: مسیرِ پایه «فیلترمودِ همه‌ی شغل‌ها» است و AI هرگز الزامی نیست. این تاگل فقط
 * لایه‌ی *اختیاریِ پریمیوم* را کنترل می‌کند. روشن‌کردنش فقط برای کاربرِ واجدِ استحقاق (موجودی
 * > ۰، گیتِ موجودِ assertCanUsePaidAi) مجاز است؛ برای بقیه ۴۰۲ + دعوت به ارتقا برمی‌گردد و
 * تاگل ذخیره نمی‌شود (کاربر همچنان مسیرِ فیلترمودِ همه‌ی شغل‌ها را دارد).
 *
 * امنیت/رضایت (قاعده‌ی ۴ + §۱۰): کاربرِ هدف همیشه از کوکیِ نشست گرفته می‌شود (getCurrentUser)،
 * نه از بدنه/کوئری؛ بدنه عمداً userId نمی‌پذیرد (schema `.strict()`). این فایل از فایل‌های
 * مالکیتیِ Foundation/Track A/B نیست؛ صرفاً مصرف‌کننده‌ی ai-gate.ts + filters.ts است.
 */
import { z } from "zod";

import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { getAiFilterGateState } from "@/lib/apply/ai-gate";
import { setAiFilterEnabled } from "@/lib/apply/filters";

// به DB و node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا (وابسته به کوکی).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** بدنه‌ی PUT — فقط `enabled` مجاز است (بدونِ userId؛ کاربر از نشست). */
const putBodySchema = z.object({ enabled: z.boolean() }).strict();

/* ───────────────────────────  GET /api/apply/ai-filter  ─────────────────────────── */

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const state = await getAiFilterGateState(user.id);
    return json(state);
  });
}

/* ───────────────────────────  PUT /api/apply/ai-filter  ─────────────────────────── */

export async function PUT(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const { enabled } = await parseJsonBody(request, putBodySchema);

    // روشن‌کردن فقط برای واجدِ استحقاق. در غیرِ این صورت ۴۰۲ + پیامِ ارتقا و *بدونِ* ذخیره
    // (تاگل خاموش می‌ماند؛ کاربر همچنان فیلترمودِ همه‌ی شغل‌ها را دارد — AI هرگز الزامی نیست).
    if (enabled) {
      const state = await getAiFilterGateState(user.id);
      if (!state.entitled) {
        return errorJson(
          "برای فعال‌سازیِ «فیلترِ هوشمند (AI)» کیف‌پولتان باید موجودی داشته باشد. لطفاً شارژ کنید یا پلنتان را ارتقا دهید.",
          402,
          { plan: state.plan, balanceToman: state.balanceToman },
        );
      }
    }

    await setAiFilterEnabled(user.id, enabled, {
      fallbackFullName: user.fullName ?? user.name ?? undefined,
    });

    const state = await getAiFilterGateState(user.id);
    return json(state);
  });
}
