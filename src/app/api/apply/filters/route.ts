import "server-only";

/**
 * GET  /api/apply/filters — «فیلترهای اپلای»ِ کاربرِ احرازشده + URLِ پیش‌نمایشِ جابینجا.
 * PUT  /api/apply/filters — ذخیره‌ی کاملِ انتخاب‌های پیکر (بدنه: applyFiltersInputSchema).
 *
 * پیوُتِ محصول: انتخابِ «دسته/فیلترِ خودِ جابینجا» مسیرِ *پیش‌فرض* (بدونِ AI) است؛ کارجو
 * به همه‌ی آگهی‌های این جست‌وجوی فیلترشده اپلای می‌کند. این مسیر فقط انتخاب‌ها را در
 * preferencesِ پروفایل ذخیره می‌کند (هلپرِ Foundation: writeApplyFilters).
 *
 * امنیت (§10 — داده‌ی هر کاربر فقط برای همان کاربر): کاربرِ هدف از کوکیِ نشست گرفته
 * می‌شود (getCurrentUser)، نه از بدنه/کوئری. بدنه عمداً `userId` نمی‌پذیرد. تاگلِ
 * «فیلترِ هوشمند (AI)» (`aiFilterEnabled`) مالِ مسیرِ گیت‌شده‌ی پریمیوم (Track C) است؛
 * این مسیر آن را *حفظ* می‌کند تا با ذخیره‌ی فیلترها پاک نشود.
 *
 * URLِ پیش‌نمایش با `buildSearchUrl`ِ خودِ کانکتور (منبعِ حقیقتِ سرور) ساخته می‌شود تا
 * کاربر دقیقاً ببیند به چه جست‌وجویی اپلای خواهد شد.
 */
import { errorJson, json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { applyFiltersInputSchema } from "@/lib/apply/apply-filters-form";
import {
  readApplyFilters,
  toJobPreferences,
  writeApplyFilters,
  type ApplyFilters,
} from "@/lib/apply/filters";
import { buildSearchUrl } from "@/lib/apply/boards/jobinja";

// به DB و node API (cookies) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * URLِ پیش‌نمایشِ جابینجا از فیلترهای ذخیره‌شده. عمداً `titles` را شامل نمی‌شود تا
 * پیش‌نمایش دقیقاً همان چیزی باشد که در پیکر انتخاب شده (نه کلیدواژه‌ی مشتق از علاقه‌مندی‌ها).
 */
function previewUrlFor(filters: ApplyFilters): string {
  const prefs = toJobPreferences({
    categorySlugs: filters.categorySlugs,
    cities: filters.cities,
    jobTypes: filters.jobTypes,
    remoteOnly: filters.remoteOnly,
    ...(filters.minSalary === undefined ? {} : { minSalary: filters.minSalary }),
    ...(filters.sort === undefined ? {} : { sort: filters.sort }),
  });
  return buildSearchUrl(prefs, 1);
}

/** بدنه‌ی پاسخ (GET/PUT) — فیلترهای مؤثر + URLِ جست‌وجوی هدف. */
function filtersResponse(filters: ApplyFilters) {
  return json({ filters, previewUrl: previewUrlFor(filters) });
}

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUserOrBearer(request);
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const filters = await readApplyFilters(user.id);
    return filtersResponse(filters);
  });
}

export async function PUT(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUserOrBearer(request);
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const input = await parseJsonBody(request, applyFiltersInputSchema);

    // تاگلِ AI (مالِ Track C) را از حالتِ فعلی حفظ کن؛ این مسیر آن را نمی‌سازد/نمی‌بندد.
    const current = await readApplyFilters(user.id);

    const next: ApplyFilters = {
      categorySlugs: input.categorySlugs,
      cities: input.cities,
      jobTypes: input.jobTypes,
      remoteOnly: input.remoteOnly,
      ...(input.minSalary && input.minSalary > 0 ? { minSalary: input.minSalary } : {}),
      ...(input.sort ? { sort: input.sort } : {}),
      paused: input.paused,
      ...(input.dailyLimit && input.dailyLimit > 0 ? { dailyLimit: input.dailyLimit } : {}),
      ...(input.weeklyLimit && input.weeklyLimit > 0 ? { weeklyLimit: input.weeklyLimit } : {}),
      aiFilterEnabled: current.aiFilterEnabled,
      maxAgeDays: input.maxAgeDays,
      boardFiltersVersion: 1,
      boardFilters: input.boardFilters ?? {
        jobinja: {
          enabled: current.boardFilters.jobinja.enabled,
          categoryKeys: input.categorySlugs,
          cities: input.cities,
          employmentTypeKeys: input.jobTypes,
          remoteOnly: input.remoteOnly,
          ...(input.minSalary ? { minSalary: input.minSalary } : {}),
          ...(input.sort ? { sort: input.sort } : {}),
        },
        jobvision: current.boardFilters.jobvision,
        "e-estekhdam": current.boardFilters["e-estekhdam"],
        irantalent: current.boardFilters.irantalent,
      },
    };

    const { filters } = await writeApplyFilters(user.id, next, {
      fallbackFullName: user.fullName ?? user.name ?? undefined,
    });

    return filtersResponse(filters);
  });
}
