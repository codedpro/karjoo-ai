import "server-only";

/**
 * PATCH /api/resume/profile — ذخیره‌ی نسخه‌ی ویرایش‌شده‌ی کاربر روی پروفایلِ کارجو.
 *
 * پس از اینکه کاربر فیلدهای پروفایلِ جامع را (استخراج‌شده‌ی AI یا دستی) در UI دید و
 * تصحیح کرد، این مسیر را با فیلدهای نهایی صدا می‌زند. مستقل از AI/فایل است؛ فقط
 * candidate_profiles را به‌روز می‌کند. رایگان است (هیچ فراخوانیِ مدل ندارد).
 *
 * WF2 (پروفایلِ جامع): همه‌ی فیلدها ذخیره می‌شوند — عکس/خلاصه/تلفن/شهر/حقوق/سابقه/
 * تحصیلات/زبان/لینک + مهارت‌ها. مقادیرِ کاربر *جایگزین* می‌شوند (کاربر صریحاً تأیید کرده).
 *
 * امنیت (قاعده‌ی ۴): userId از نشستِ وب گرفته می‌شود، نه از بدنه — پروفایلِ هر کاربر فقط
 * توسطِ خودش ویرایش می‌شود. هیچ رازی برنمی‌گردد.
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { resumeProfileSaveSchema } from "@/lib/resume/api-schemas";
import { saveFullProfile } from "@/lib/resume/profile-service";
import { toApiProfile } from "@/lib/resume/profile-view";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب.
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) اعتبارسنجیِ بدنه (parseJsonBody در شکست خودش ۴۰۰ می‌دهد).
    const body = await parseJsonBody(request, resumeProfileSaveSchema);

    // ۳) ذخیره/upsert پروفایلِ جامع — به نشست مقید.
    const profile = await saveFullProfile(user.id, {
      fullName: body.fullName,
      headline: body.headline ?? null,
      summary: body.summary ?? null,
      city: body.city ?? null,
      phone: body.phone ?? null,
      avatarUrl: body.avatarUrl ?? null,
      expectedSalary: body.expectedSalary ?? null,
      yearsExperience: body.yearsExperience ?? null,
      skills: body.skills,
      workExperience: body.workExperience,
      education: body.education,
      languages: body.languages,
      links: body.links,
    });

    return json({ profile: toApiProfile(profile) });
  });
}
