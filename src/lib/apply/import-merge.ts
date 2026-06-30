/**
 * منطقِ خالصِ «merge وصله‌ی پروفایلِ ایمپورت‌شده روی CandidateProfile کاربر» (WF1، Track C).
 *
 * این ماژول قلبِ تصمیمِ «چه چیزی روی پروفایلِ موجودِ کاربر اعمال شود» است و عمداً
 * خالص (بدون DB/شبکه/راز) نگه داشته شده تا هم در اندپوینتِ سرور و هم در تستِ واحد
 * بدونِ اصطکاک استفاده شود. اندپوینت فقط: ردیفِ فعلی را می‌خواند → این تابع را صدا
 * می‌زند → نتیجه را می‌نویسد.
 *
 * قاعده‌ی merge (مهم — مطابق Track C): «مقادیرِ ویرایش‌شده‌ی کاربر را کورکورانه
 * clobber نکن»:
 *   • skills: *append/union* — مهارت‌های تازه به مهارت‌های موجود اضافه می‌شوند
 *     (یکتا، case-insensitive، ترتیبِ موجود حفظ می‌شود). هرگز کم نمی‌شوند.
 *   • fullName/headline/yearsExperience/city/resumeText: فقط *پر کردنِ خالی‌ها* —
 *     اگر کاربر از قبل مقدارِ معنادار دارد، دست نمی‌خوریم؛ فقط فیلدهای خالی/نداشته
 *     با داده‌ی ایمپورت پر می‌شوند.
 *
 * خروجی، علاوه بر مقادیرِ نهایی، دقیقاً «چه فیلدهایی واقعاً تغییر کردند» را برمی‌گرداند
 * (برای شفافیت: appliedFields رکوردِ ایمپورت و بدنه‌ی پاسخ).
 */
import type { ProfilePatch } from "@/lib/apply/import";

/**
 * زیرمجموعه‌ای از CandidateProfile که merge با آن سروکار دارد. اندپوینت ردیفِ DB را
 * به این شکل می‌دهد (یا undefined اگر کاربر هنوز پروفایلی ندارد).
 */
export interface MergeableProfile {
  fullName?: string | null;
  headline?: string | null;
  skills?: string[] | null;
  yearsExperience?: number | null;
  city?: string | null;
  resumeText?: string | null;
}

/** مقادیرِ نهاییِ فیلدهایی که merge آن‌ها را تغییر داده (برای نوشتن روی DB). */
export interface MergedProfileFields {
  fullName?: string;
  headline?: string;
  skills?: string[];
  yearsExperience?: number;
  city?: string;
  resumeText?: string;
}

/** نتیجه‌ی merge: مقادیرِ تغییرکرده + فهرستِ نامِ فیلدهایی که واقعاً عوض شدند. */
export interface MergeResult {
  /** فقط فیلدهایی که واقعاً تغییر کرده‌اند (برای `db.update(...).set(changed)`). */
  changed: MergedProfileFields;
  /** نامِ فیلدهایی که تغییر کردند (برای appliedFields/شفافیت). */
  appliedFieldNames: string[];
  /** مهارت‌هایی که تازه افزوده شدند (زیرمجموعه‌ی skills تغییرکرده). */
  addedSkills: string[];
}

/** آیا یک مقدارِ رشته‌ایِ موجود «معنادار» است؟ (غیرِ null/خالی پس از trim). */
function hasMeaningfulString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * skills را union می‌کند: مهارت‌های موجود حفظ می‌شوند و مهارت‌های تازه (که از قبل
 * نبوده‌اند، case-insensitive) append می‌شوند. خروجی: لیستِ نهایی + لیستِ افزوده‌ها.
 */
function unionSkills(
  existing: string[] | null | undefined,
  incoming: string[] | undefined,
): { merged: string[]; added: string[] } | null {
  if (!incoming || incoming.length === 0) return null;

  const base = Array.isArray(existing) ? existing : [];
  const seen = new Set(base.map((s) => s.toLowerCase()));
  const merged = [...base];
  const added: string[] = [];

  for (const skill of incoming) {
    const trimmed = skill.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trimmed);
    added.push(trimmed);
  }

  // اگر هیچ مهارتِ تازه‌ای افزوده نشد، تغییری نیست.
  return added.length > 0 ? { merged, added } : null;
}

/**
 * وصله‌ی ایمپورت‌شده را روی پروفایلِ موجود merge می‌کند (خالص). قاعده‌ها در سرآیندِ
 * ماژول توضیح داده شده‌اند: skills → union/append؛ بقیه → فقط پر کردنِ خالی‌ها.
 *
 * @param existing پروفایلِ فعلیِ کاربر (یا undefined اگر هنوز پروفایلی ندارد).
 * @param patch    وصله‌ای که از داده‌ی ایمپورت نرمال شده.
 */
export function mergeProfilePatch(
  existing: MergeableProfile | undefined,
  patch: ProfilePatch,
): MergeResult {
  const current = existing ?? {};
  const changed: MergedProfileFields = {};
  const appliedFieldNames: string[] = [];

  // فیلدهای تک‌مقداری: فقط وقتی کاربر مقدارِ معناداری ندارد پر می‌شوند.
  if (patch.fullName !== undefined && !hasMeaningfulString(current.fullName)) {
    changed.fullName = patch.fullName;
    appliedFieldNames.push("fullName");
  }
  if (patch.headline !== undefined && !hasMeaningfulString(current.headline)) {
    changed.headline = patch.headline;
    appliedFieldNames.push("headline");
  }
  if (
    patch.yearsExperience !== undefined &&
    (current.yearsExperience === null || current.yearsExperience === undefined)
  ) {
    changed.yearsExperience = patch.yearsExperience;
    appliedFieldNames.push("yearsExperience");
  }
  if (patch.city !== undefined && !hasMeaningfulString(current.city)) {
    changed.city = patch.city;
    appliedFieldNames.push("city");
  }
  if (patch.resumeText !== undefined && !hasMeaningfulString(current.resumeText)) {
    changed.resumeText = patch.resumeText;
    appliedFieldNames.push("resumeText");
  }

  // skills: همیشه union/append (هرگز clobber؛ هرگز کم نمی‌شود).
  const skillsResult = unionSkills(current.skills, patch.skills);
  const addedSkills = skillsResult?.added ?? [];
  if (skillsResult) {
    changed.skills = skillsResult.merged;
    appliedFieldNames.push("skills");
  }

  return { changed, appliedFieldNames, addedSkills };
}
