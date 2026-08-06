import "server-only";

/**
 * GET  /api/interests — slugِ دسته‌های انتخابیِ کاربرِ احرازشده (وب).
 * PUT  /api/interests — جایگزینیِ کاملِ مجموعه‌ی انتخاب‌ها (بدنه: { slugs: string[] }).
 *
 * امنیت (§10 — داده‌ی هر کاربر فقط برای همان کاربر): کاربرِ هدف از کوکیِ نشستِ وب
 * گرفته می‌شود (getCurrentUser)، نه از بدنه/کوئری. بدنه عمداً userId نمی‌پذیرد. هر slugِ
 * نامعتبر/ناشناخته در لایه‌ی store بی‌سروصدا حذف می‌شود؛ پاسخ slugهای واقعاً اعمال‌شده را
 * برمی‌گرداند. PUT علاوه بر user_interests، مشتقاتِ titles/categories را در preferencesِ
 * پروفایل همگام می‌کند (مصرفِ orchestrator/جست‌وجو).
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { updateInterestsBodySchema } from "@/lib/interests/schemas";
import { EmptyTaxonomyError, getSelectedSlugs, replaceInterests } from "@/lib/interests/store";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const slugs = await getSelectedSlugs(user.id);
    return json({ count: slugs.length, slugs });
  });
}

export async function PUT(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const { slugs } = await parseJsonBody(request, updateInterestsBodySchema);

    let result;
    try {
      result = await replaceInterests(user.id, slugs);
    } catch (err) {
      if (err instanceof EmptyTaxonomyError) {
        // تاکسونومی seed نشده → هیچ چیزی حذف نشد (fail-closed). به‌جای «ذخیره شد ولی ۰ تا»
        // که داده‌ی کاربر را بی‌صدا می‌بلعید، صریح می‌گوییم مشکل از سمتِ ماست.
        return errorJson(
          "فهرستِ دسته‌های شغلی در دسترس نیست؛ انتخابِ شما ذخیره نشد (چیزی هم پاک نشد). کمی بعد دوباره تلاش کنید.",
          503,
        );
      }
      throw err;
    }

    return json({ count: result.count, slugs: result.appliedSlugs });
  });
}
