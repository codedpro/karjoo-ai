/**
 * سازنده‌های پرامپت فارسی برای موتور هوش مصنوعی کارجو.
 *
 * دو وظیفه:
 *   (الف) امتیازدهی تطبیق شغل (job-match scoring)
 *   (ب)  نگارش انگیزه‌نامه‌ی اختصاصی (cover letter / انگیزه‌نامه)
 *
 * این فایل فقط «متن» می‌سازد؛ نه شبکه می‌زند نه رازی دارد، پس server-only نیست و در
 * تست واحد مستقیماً قابل بررسی است. خروجی مدل با `response_format: json_object`
 * خواسته می‌شود و بعداً با اسکیماهای zod (schema.ts) اعتبارسنجی می‌گردد.
 *
 * قاعده‌ی مهم برای مدل: همیشه فارسی، همیشه فقط JSON، بدون متن اضافه/مارک‌داون.
 */
import type { ChatMessage } from "@/lib/ai/gateway";
import type { CandidateProfile, JobListing } from "@/lib/apply/types";

/** قطع کردن متن‌های بلند (رزومه/شرح آگهی) تا پرامپت بیش از حد بزرگ نشود. */
function clamp(text: string | undefined, max: number): string {
  if (!text) return "";
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** خلاصه‌ی خوانا و فشرده از پروفایل کارجو برای تزریق در پرامپت. */
export function summarizeProfile(profile: CandidateProfile): string {
  const lines: string[] = [];
  lines.push(`نام: ${profile.fullName}`);
  if (profile.headline) lines.push(`عنوان حرفه‌ای: ${profile.headline}`);
  if (typeof profile.yearsExperience === "number") {
    lines.push(`سابقه: ${profile.yearsExperience} سال`);
  }
  if (profile.city) lines.push(`شهر: ${profile.city}`);
  if (profile.skills.length > 0) {
    lines.push(`مهارت‌ها: ${profile.skills.join("، ")}`);
  }
  const prefs = profile.preferences;
  if (prefs) {
    if (prefs.titles?.length) lines.push(`عناوین موردنظر: ${prefs.titles.join("، ")}`);
    if (prefs.cities?.length) lines.push(`شهرهای موردنظر: ${prefs.cities.join("، ")}`);
    if (typeof prefs.minSalary === "number") {
      lines.push(`حداقل حقوق موردنظر: ${prefs.minSalary}`);
    }
    if (prefs.employmentTypes?.length) {
      lines.push(`نوع همکاری موردنظر: ${prefs.employmentTypes.join("، ")}`);
    }
  }
  const resume = clamp(profile.resumeText, 4000);
  if (resume) lines.push(`\nخلاصه/متن رزومه:\n${resume}`);
  return lines.join("\n");
}

/** خلاصه‌ی خوانا از یک آگهی شغلی برای تزریق در پرامپت. */
export function summarizeJob(job: JobListing): string {
  const lines: string[] = [];
  lines.push(`عنوان شغل: ${job.title}`);
  if (job.company) lines.push(`شرکت: ${job.company}`);
  if (job.city) lines.push(`شهر: ${job.city}`);
  if (job.salary) lines.push(`حقوق: ${job.salary}`);
  if (job.postedAt) lines.push(`تاریخ انتشار: ${job.postedAt}`);
  const desc = clamp(job.description, 4000);
  if (desc) lines.push(`\nشرح آگهی:\n${desc}`);
  return lines.join("\n");
}

/* ──────────────────────────────────────────────────────────────────────────
 * (الف) امتیازدهی تطبیق شغل
 * ────────────────────────────────────────────────────────────────────────── */

const MATCH_SYSTEM = [
  "تو یک کارشناس استخدام و کاریابی در بازار کار ایران هستی.",
  "وظیفه‌ات سنجش میزان تطبیق یک «کارجو» با یک «آگهی شغلی» است.",
  "تمام تحلیل را بر پایه‌ی مهارت‌ها، سابقه، شهر و ترجیحات کارجو نسبت به نیازمندی‌های آگهی انجام بده.",
  "خروجی را فقط و فقط به‌صورت یک شیء JSON معتبر بده؛ هیچ متن اضافه، توضیح یا مارک‌داونی ننویس.",
  "ساختار خروجی دقیقاً این است:",
  '{"matchScore": <عدد اعشاری بین 0 و 1>, "reasons": [<حداکثر چند جمله‌ی کوتاه فارسی>]}',
  "matchScore یعنی احتمال تناسب: 0 کاملاً بی‌ربط، 1 تطبیق عالی.",
  "دلایل (reasons) باید کوتاه، مشخص و فارسی باشند و به نقاط قوت/ضعف تطبیق اشاره کنند.",
].join("\n");

/**
 * پرامپت امتیازدهی تطبیق: پیام‌های system + user را برای فراخوانی JSON می‌سازد.
 * خروجی موردانتظار مدل با `matchScoreSchema` (schema.ts) اعتبارسنجی می‌شود.
 */
export function buildMatchScorePrompt(
  job: JobListing,
  profile: CandidateProfile,
): ChatMessage[] {
  const user = [
    "اطلاعات کارجو:",
    summarizeProfile(profile),
    "",
    "اطلاعات آگهی شغلی:",
    summarizeJob(job),
    "",
    "میزان تطبیق این کارجو با این آگهی را بسنج و فقط JSON بخواسته‌شده را برگردان.",
  ].join("\n");

  return [
    { role: "system", content: MATCH_SYSTEM },
    { role: "user", content: user },
  ];
}

/* ──────────────────────────────────────────────────────────────────────────
 * (ب) نگارش انگیزه‌نامه‌ی اختصاصی
 * ────────────────────────────────────────────────────────────────────────── */

const COVER_SYSTEM = [
  "تو یک نویسنده‌ی حرفه‌ای انگیزه‌نامه (cover letter) برای بازار کار ایران هستی.",
  "بر اساس پروفایل کارجو و آگهی شغلی، یک انگیزه‌نامه‌ی فارسیِ کوتاه، حرفه‌ای و متقاعدکننده بنویس.",
  "قواعد نگارش:",
  "• فارسیِ روان و رسمی؛ بدون اغراق و بدون ادعای دروغ.",
  "• فقط بر پایه‌ی مهارت‌ها و سوابق واقعیِ آمده در پروفایل بنویس؛ چیزی از خودت نساز.",
  "• به نیازمندی‌های همان آگهی اشاره‌ی مشخص کن (چرا این فرد مناسب این نقش است).",
  "• حدود ۳ تا ۵ پاراگراف کوتاه؛ بدون جای‌خالیِ پرنشده مثل [نام شرکت].",
  "خروجی را فقط به‌صورت یک شیء JSON معتبر بده؛ هیچ متن اضافه یا مارک‌داونی ننویس.",
  'ساختار خروجی دقیقاً این است: {"coverLetter": "<متن کامل انگیزه‌نامه>"}',
].join("\n");

/**
 * پرامپت نگارش انگیزه‌نامه: پیام‌های system + user را برای فراخوانی JSON می‌سازد.
 * خروجی موردانتظار مدل با `coverLetterSchema` (schema.ts) اعتبارسنجی می‌شود.
 */
export function buildCoverLetterPrompt(
  job: JobListing,
  profile: CandidateProfile,
): ChatMessage[] {
  const user = [
    "اطلاعات کارجو:",
    summarizeProfile(profile),
    "",
    "اطلاعات آگهی شغلی:",
    summarizeJob(job),
    "",
    "برای همین آگهی و همین کارجو یک انگیزه‌نامه بنویس و فقط JSON خواسته‌شده را برگردان.",
  ].join("\n");

  return [
    { role: "system", content: COVER_SYSTEM },
    { role: "user", content: user },
  ];
}

/* ──────────────────────────────────────────────────────────────────────────
 * (ج) ترکیبی: امتیاز + انگیزه‌نامه در یک فراخوانی
 * ────────────────────────────────────────────────────────────────────────── */

const SCORE_AND_DRAFT_SYSTEM = [
  "تو هم‌زمان کارشناس استخدام و نویسنده‌ی انگیزه‌نامه برای بازار کار ایران هستی.",
  "برای یک کارجو و یک آگهی شغلی، دو کار را با هم انجام بده:",
  "۱) میزان تطبیق را به‌صورت عددی بین 0 و 1 بسنج و دلایل کوتاه فارسی بده.",
  "۲) یک انگیزه‌نامه‌ی فارسیِ کوتاه و حرفه‌ای، فقط بر پایه‌ی سوابق واقعی، بنویس.",
  "هیچ ادعای دروغ یا جای‌خالیِ پرنشده نگذار. همه‌چیز فارسی.",
  "خروجی را فقط به‌صورت یک شیء JSON معتبر بده؛ بدون هیچ متن اضافه یا مارک‌داون.",
  "ساختار خروجی دقیقاً این است:",
  '{"matchScore": <عدد بین 0 و 1>, "reasons": [<چند جمله‌ی کوتاه>], "coverLetter": "<متن انگیزه‌نامه>"}',
].join("\n");

/**
 * پرامپت ترکیبیِ «امتیاز + انگیزه‌نامه» در یک فراخوانیِ مدل (کاهش هزینه/تأخیر).
 * خروجی با `scoreAndDraftSchema` (schema.ts) اعتبارسنجی می‌شود. `scoreAndDraft`
 * از همین استفاده می‌کند.
 */
export function buildScoreAndDraftPrompt(
  job: JobListing,
  profile: CandidateProfile,
): ChatMessage[] {
  const user = [
    "اطلاعات کارجو:",
    summarizeProfile(profile),
    "",
    "اطلاعات آگهی شغلی:",
    summarizeJob(job),
    "",
    "هم امتیاز تطبیق و هم انگیزه‌نامه را تولید کن و فقط JSON خواسته‌شده را برگردان.",
  ].join("\n");

  return [
    { role: "system", content: SCORE_AND_DRAFT_SYSTEM },
    { role: "user", content: user },
  ];
}

const RESUME_TAILOR_SYSTEM = [
  "تو یک نویسنده‌ی حرفه‌ایِ رزومه برای بازار کار ایران هستی.",
  "کاربر یک رزومه‌ی پایه و یک شرحِ آگهیِ شغلی دارد. یک نسخه‌ی رزومه‌ی *هدف‌گیری‌شده برای همان آگهی* بساز:",
  "۱) خلاصه را برای همین نقش بازنویسی کن: با **مجموع سال‌های تجربه‌ی واقعیِ کاربر** شروع کن و بلافاصله همان چیزی را بگو که این آگهی می‌خواهد (اگر کاربر واقعاً آن را دارد).",
  "۲) مهارت‌ها را بر اساسِ ربط به آگهی مرتب کن — هر تکنولوژیِ خواسته‌شده در آگهی که کاربر **واقعاً** دارد باید در چند موردِ اول باشد. مهارتی که کاربر ندارد هرگز اضافه نکن.",
  "۳) برای هر تجربه‌ی شغلی، bulletهایی بنویس که همان کارِ واقعی را با واژگانِ همین آگهی توصیف کند: هر جا کاربر واقعاً با تکنولوژیِ موردِ نیازِ آگهی کار کرده، همان‌جا صریح نامش را بیاور. bulletهای بی‌ربط به این آگهی را حذف یا کوتاه کن.",
  "۴) در highlights، ۳ تا ۵ موردِ قوی بیاور که مستقیماً به نیازِ همین آگهی پاسخ می‌دهند (از دستاوردهای واقعیِ کاربر).",
  "قاعده‌ی سخت (تخطی‌ناپذیر): هیچ چیزِ نادرست/جعلی اضافه نکن — نه مهارت، نه کارفرما، نه دستاورد.",
  "به‌ویژه **مدت‌زمان‌ها را دست نبر**: `period` هر سابقه باید دقیقاً همان بازه‌ی واقعیِ رزومه‌ی پایه بماند. سِنیوریتی را با *عمقِ کار* و مجموع سال‌ها نشان بده، نه با طولانی‌کردنِ سابقه‌ها. تجربه‌ی جعلی در مصاحبه لو می‌رود و به کاربر آسیب می‌زند.",
  "زبانِ محتوا همان زبانِ داده‌ی کاربر (انگلیسی/فارسی) بماند.",
  "خروجی را فقط به‌صورت یک شیء JSON معتبر بده؛ بدون هیچ متن اضافه یا مارک‌داون. ساختار:",
  '{"headline":"<عنوانِ هدف>","summary":"<خلاصه>","skills":["..."],"experience":[{"company":"..","title":"..","period":"..","bullets":["..."]}],"highlights":["..."]}',
].join("\n");

/**
 * پرامپتِ «رزومه‌ی سفارشیِ هر شغل» — محتوای رزومه‌ی پایه را برای یک آگهیِ خاص بازنویسی/
 * هدف‌گیری می‌کند. خروجی با `resumeTailorSchema` (schema.ts) اعتبارسنجی می‌شود.
 * `profileText` را فراخواننده از ردیفِ کاملِ candidate_profiles می‌سازد (سوابق/تحصیلات/درباره)،
 * و `jobText` = عنوان + شرحِ آگهی.
 */
export function buildResumeTailorPrompt(profileText: string, jobText: string): ChatMessage[] {
  const user = [
    "رزومه‌ی پایه‌ی کاربر:",
    profileText,
    "",
    "شرحِ آگهیِ شغلی:",
    jobText,
    "",
    "یک رزومه‌ی هدف‌گیری‌شده برای همین آگهی بساز و فقط JSON خواسته‌شده را برگردان.",
  ].join("\n");

  return [
    { role: "system", content: RESUME_TAILOR_SYSTEM },
    { role: "user", content: user },
  ];
}
