import "server-only";

/**
 * POST /api/internal/grant-credits — *بازنشسته* (۴۱۰ Gone).
 *
 * «گرنتِ اعتبارِ ماهانه» با کیف‌پولِ واحدِ 1xAi حذف شد: پول در 1xai زندگی می‌کند و
 * پلن‌های کارجو فقط «استحقاق + قیمت»‌اند — هیچ اعتباری به کیف‌پولِ محلی واریز نمی‌شود
 * (نه خوش‌آمد، نه ماهانه). شارژ فقط در https://1xai.ir/topup انجام می‌شود.
 *
 * گاردِ رازِ داخلی عمداً می‌ماند (fail-closed مثلِ قبل: بدونِ راز → ۵۰۳، رازِ غلط →
 * ۴۰۱) تا این مسیر برای بیرونی‌ها probe‌پذیر نشود؛ کرانِ قدیمی که هنوز صدا می‌زند
 * به‌جای اجرا، ۴۱۰ِ روشن می‌گیرد و باید خاموش شود.
 */
import { errorJson, guardInternal, withErrorHandling } from "@/lib/api/http";

// از env (راز) استفاده می‌کند → اجرای Node.
export const runtime = "nodejs";
// همیشه پویا — پاسخِ گارد نباید کش شود.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) نگهبانِ رازِ مشترک (fail-closed) — مثلِ قبل، قبل از هر پاسخِ دیگری.
    const blocked = guardInternal(request);
    if (blocked) return blocked;

    // ۲) همیشه ۴۱۰ — گرنتِ ماهانه بازنشسته است؛ پول فقط در کیف‌پولِ واحدِ 1xai.
    return errorJson(
      "گرنتِ اعتبارِ ماهانه بازنشسته شده است — کیف‌پول واحد است و در 1xai زندگی می‌کند (شارژ: https://1xai.ir/topup). این کران را خاموش کنید.",
      410,
    );
  });
}
