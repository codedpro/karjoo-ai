/**
 * قراردادِ «ایمپورتِ پروفایل از سایت‌های کاریابی» (WF1، قابلیتِ حملِ داده‌ی کاربر).
 *
 * کاربر دادهٔ *خودش* را از سایتی که در آن لاگین است ایمپورت می‌کند: افزونه (با نشستِ
 * خودِ کاربر و حضورِ کاربر) صفحه‌ی پروفایل/رزومه‌ی او را می‌خواند و *داده‌ی* ساخت‌یافته
 * را به اندپوینتِ ایمپورتِ کارجو POST می‌کند. این ماژول آن داده‌ی خام را به یک
 * «وصله‌ی پروفایل» (profilePatch) و فهرستِ سوابقِ اپلای نرمال می‌کند.
 *
 * قواعدِ سختِ §10 که این ماژول تضمین می‌کند:
 *   • هرگز اعتبارنامه: ورودی فقط *داده* است؛ هر فیلدِ شبیهِ کوکی/توکن/رمز/هدرِ
 *     احراز هویت با `assertNoCredentials` رد می‌شود (پیش از هر پردازشی).
 *   • دادهٔ هر کاربر فقط برای همان کاربر — این ماژول هیچ userId‌ای از payload نمی‌خواند
 *     و نمی‌پذیرد؛ اندپوینت پروفایل را به نشستِ کاربر bind می‌کند (نه به ورودیِ کلاینت).
 *
 * این ماژول «server-only» نیست: تابعِ خالص و بدونِ راز/شبکه/IO است تا در تستِ واحد و
 * هم در مسیرِ سرور بدونِ اصطکاک استفاده شود. اعتبارسنجیِ شکلِ ورودیِ HTTP (zod) و
 * پایدارسازی (DB) مسئولیتِ اندپوینت است؛ اینجا فقط نرمال‌سازیِ خالص انجام می‌شود.
 */
import type { JobBoardId } from "@/lib/apply/types";

/* ──────────────────────────────────────────────────────────────────────────
 * شکل‌های دامنه
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * وصله‌ای از فیلدهای پروفایل که از داده‌ی ایمپورت‌شده استخراج شده‌اند. زیرمجموعه‌ای از
 * CandidateProfile است؛ فقط فیلدهایی که واقعاً در payload بودند پر می‌شوند (بقیه
 * undefined می‌مانند تا merge، مقادیرِ موجودِ کاربر را پاک نکند).
 */
export interface ProfilePatch {
  fullName?: string;
  headline?: string;
  skills?: string[];
  yearsExperience?: number;
  city?: string;
  /** متنِ رزومه/خلاصه‌ی حرفه‌ای که از سایت ایمپورت شد. */
  resumeText?: string;
}

/** یک سابقه‌ی اپلایِ ایمپورت‌شده از تاریخچه‌ی کاربر در یک سایت (DATA، نه نشست). */
export interface ImportedApplication {
  /** عنوانِ شغلِ اپلای‌شده. */
  title?: string;
  /** نامِ شرکت. */
  company?: string;
  /** شناسه/ارجاعِ آگهی در سایتِ مبدأ (در صورتِ وجود). */
  externalRef?: string;
  /** وضعیتِ اپلای همان‌طور که سایت نشان می‌دهد (متنِ خام، نرمال‌نشده). */
  status?: string;
  /** آدرسِ آگهی (در صورتِ وجود). */
  url?: string;
  /** تاریخِ اپلای به‌صورتِ رشته (همان‌طور که سایت نشان داده). */
  appliedAt?: string;
}

/** خروجیِ نرمال‌سازیِ یک ایمپورت. */
export interface NormalizedImport {
  /** فیلدهایی که باید روی CandidateProfile کاربر merge شوند. */
  profilePatch: ProfilePatch;
  /** سوابقِ اپلایِ ایمپورت‌شده (در صورتِ وجود). */
  applications?: ImportedApplication[];
}

/** payloadِ خامی که افزونه می‌فرستد — شکلِ آزاد (per-board)؛ هرگز شاملِ اعتبارنامه. */
export type RawImportPayload = Record<string, unknown>;

/**
 * قراردادِ نرمال‌سازِ هر سایت. خالص: یک payloadِ خام را به NormalizedImport تبدیل
 * می‌کند. هیچ شبکه/IO/رازی ندارد. خطا برای ورودیِ نامعتبر throw نمی‌کند (مگر اعتبارنامه)؛
 * فیلدهای ناشناخته را نادیده می‌گیرد و فقط آنچه می‌فهمد را برمی‌گرداند.
 */
export type BoardProfileImporter = (raw: RawImportPayload) => NormalizedImport;

/* ──────────────────────────────────────────────────────────────────────────
 * نگهبانِ §10: ردِ هر فیلدِ شبیهِ اعتبارنامه
 * ────────────────────────────────────────────────────────────────────────── */

/** خطای typed وقتی payload فیلدِ شبیهِ اعتبارنامه دارد — اندپوینت آن را به ۴۲۲ تبدیل می‌کند. */
export class CredentialLeakError extends Error {
  /** نام (مسیرِ) فیلدِ مشکوک که باعثِ رد شد. */
  readonly field: string;
  constructor(field: string) {
    super(
      `ایمپورت رد شد: فیلدِ شبیهِ اعتبارنامه «${field}» در داده دیده شد. ` +
        "ایمپورت فقط داده‌ی پروفایل را می‌پذیرد؛ هرگز کوکی/توکن/رمز (قاعده‌ی §10).",
    );
    this.name = "CredentialLeakError";
    this.field = field;
  }
}

/**
 * کلیدهای ممنوع (case-insensitive، تطبیقِ زیررشته‌ای). هر کلیدِ شیئی که شاملِ یکی از
 * این‌ها باشد، payload را رد می‌کند. عمداً سخت‌گیرانه: بهتر است یک ایمپورتِ بی‌گناه رد
 * شود تا اینکه یک اعتبارنامه نشت کند.
 */
const FORBIDDEN_KEY_SUBSTRINGS = [
  "cookie",
  "password",
  "passwd",
  "secret",
  "token", // accessToken/refreshToken/jwt-as-token/csrfToken
  "jwt",
  "bearer",
  "authorization",
  "auth_header",
  "authheader",
  "credential",
  "session", // sessionId/sessionBlob/localStorage-session
  "apikey",
  "api_key",
  "privatekey",
  "private_key",
  "set-cookie",
  "csrf",
  "xsrf",
  "otp",
] as const;

/** آیا نامِ یک کلید شبیهِ اعتبارنامه است؟ (case-insensitive، زیررشته‌ای). */
function isForbiddenKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_KEY_SUBSTRINGS.some((bad) => lower.includes(bad));
}

/**
 * کلِ ساختار (تودرتو: شیء/آرایه) را پیمایش می‌کند و اگر هر کلیدی شبیهِ اعتبارنامه بود،
 * `CredentialLeakError` می‌اندازد. این نگهبانِ §10 است: باید *پیش از* هر پردازش/ذخیره‌ای
 * روی payloadِ خام اجرا شود. depth محدود است تا ساختارهای مخرب (عمیق) منع شوند.
 */
export function assertNoCredentials(value: unknown, path = "", depth = 0): void {
  if (depth > 12) {
    throw new CredentialLeakError(`${path || "(root)"} (عمقِ تودرتوییِ بیش از حد)`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoCredentials(item, `${path}[${i}]`, depth + 1));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isForbiddenKey(key)) {
        throw new CredentialLeakError(childPath);
      }
      assertNoCredentials(child, childPath, depth + 1);
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * کمک‌تابع‌های خالصِ استخراج
 * ────────────────────────────────────────────────────────────────────────── */

/** اولین مقدارِ رشته‌ایِ غیرخالی را از میانِ کلیدهای کاندید (case-insensitive) برمی‌گرداند. */
function pickString(obj: RawImportPayload, keys: string[]): string | undefined {
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) lowerMap.set(k.toLowerCase(), v);
  for (const key of keys) {
    const v = lowerMap.get(key.toLowerCase());
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** اولین عددِ معتبر را از میانِ کلیدهای کاندید برمی‌گرداند (رشته‌ی عددی هم پذیرفته می‌شود). */
function pickNumber(obj: RawImportPayload, keys: string[]): number | undefined {
  const lowerMap = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) lowerMap.set(k.toLowerCase(), v);
  for (const key of keys) {
    const v = lowerMap.get(key.toLowerCase());
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number.parseFloat(v.replace(/[^\d.]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** آرایه‌ای از رشته‌های مهارت را نرمال می‌کند: trim، حذفِ خالی، حذفِ تکراری (case-insensitive). */
function normalizeSkills(value: unknown): string[] | undefined {
  let raw: unknown[] = [];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string") {
    // رشته‌ی جداشده با ویرگول/خط‌تیره فارسی/انگلیسی.
    raw = value.split(/[,،;|]/);
  } else {
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s =
      typeof item === "string"
        ? item.trim()
        : item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
          ? (item as { name: string }).name.trim()
          : "";
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

/** فقط فیلدهای تعریف‌شده را در یک شیء نگه می‌دارد (تا profilePatch، فیلدِ undefined نداشته باشد). */
function compactPatch(patch: ProfilePatch): ProfilePatch {
  const out: ProfilePatch = {};
  if (patch.fullName !== undefined) out.fullName = patch.fullName;
  if (patch.headline !== undefined) out.headline = patch.headline;
  if (patch.skills !== undefined) out.skills = patch.skills;
  if (patch.yearsExperience !== undefined) out.yearsExperience = patch.yearsExperience;
  if (patch.city !== undefined) out.city = patch.city;
  if (patch.resumeText !== undefined) out.resumeText = patch.resumeText;
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * نرمال‌سازِ عمومی (best-effort)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * نرمال‌سازِ عمومی: کلیدهای رایجِ پروفایل را با نام‌های متداول (fa/en) از payload
 * استخراج می‌کند. هوک‌های هر سایت روی همین می‌نشینند و فقط تفاوت‌های ساختاریِ سایت را
 * هندل می‌کنند. خالص — هیچ اعتبارنامه‌ای را لمس نمی‌کند (assertNoCredentials جدا اجرا می‌شود).
 */
export function genericNormalize(raw: RawImportPayload): NormalizedImport {
  const profile = (isRecord(raw.profile) ? raw.profile : raw) as RawImportPayload;

  const patch: ProfilePatch = {
    fullName: pickString(profile, ["fullName", "full_name", "name", "نام", "displayName"]),
    headline: pickString(profile, [
      "headline",
      "title",
      "jobTitle",
      "position",
      "عنوان",
      "عنوان‌شغلی",
    ]),
    skills: normalizeSkills(
      profile.skills ?? profile.skillList ?? profile["مهارت‌ها"] ?? profile.expertise,
    ),
    yearsExperience: pickNumber(profile, [
      "yearsExperience",
      "years_experience",
      "experienceYears",
      "totalExperience",
      "سابقه",
    ]),
    city: pickString(profile, ["city", "location", "town", "شهر", "محل"]),
    resumeText: pickString(profile, [
      "resumeText",
      "resume_text",
      "summary",
      "about",
      "bio",
      "description",
      "خلاصه",
      "درباره",
    ]),
  };

  const applications = normalizeApplications(
    raw.applications ?? raw.applicationHistory ?? (profile.applications as unknown),
  );

  return {
    profilePatch: compactPatch(patch),
    ...(applications && applications.length > 0 ? { applications } : {}),
  };
}

/** سوابقِ اپلایِ خام را به ImportedApplication[] نرمال می‌کند (best-effort). */
function normalizeApplications(value: unknown): ImportedApplication[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ImportedApplication[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const rec = item as RawImportPayload;
    const app: ImportedApplication = {
      title: pickString(rec, ["title", "jobTitle", "position", "عنوان"]),
      company: pickString(rec, ["company", "companyName", "employer", "شرکت"]),
      externalRef: pickString(rec, ["externalRef", "jobId", "id", "ref", "شناسه"]),
      status: pickString(rec, ["status", "state", "وضعیت"]),
      url: pickString(rec, ["url", "link", "آدرس"]),
      appliedAt: pickString(rec, ["appliedAt", "applied_at", "date", "submittedAt", "تاریخ"]),
    };
    // فقط اگر دستِ‌کم یک فیلدِ معنادار داشت نگه می‌داریم.
    if (Object.values(app).some((v) => v !== undefined)) {
      out.push(compactApplication(app));
    }
  }
  return out.length > 0 ? out : undefined;
}

function compactApplication(app: ImportedApplication): ImportedApplication {
  const out: ImportedApplication = {};
  for (const [k, v] of Object.entries(app)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/* ──────────────────────────────────────────────────────────────────────────
 * هوک‌های هر سایت + رجیستری
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * اطلاعاتِ مشترکِ هر نرمال‌ساز را با generic ادغام می‌کند: ابتدا generic (که شکل‌های
 * متداول و شیءِ `profile` تودرتو را می‌فهمد) را اجرا می‌کند، سپس فیلدهای *خالی‌مانده*
 * را با نگاشتِ خاصِ همان سایت پر می‌کند (generic اولویت دارد چون عمومی‌تر و امن‌تر است؛
 * فقط جاهای خالی با کلیدهای اختصاصیِ سایت تکمیل می‌شوند). merge هرگز فیلدِ پرشده را
 * بازنویسی نمی‌کند.
 */
function withBoardOverrides(
  raw: RawImportPayload,
  boardPatch: ProfilePatch,
  boardApplications?: ImportedApplication[],
): NormalizedImport {
  const base = genericNormalize(raw);
  const patch: ProfilePatch = { ...base.profilePatch };

  // فقط خالی‌ها را با نگاشتِ اختصاصیِ سایت پر کن (generic اولویت دارد).
  if (patch.fullName === undefined && boardPatch.fullName !== undefined)
    patch.fullName = boardPatch.fullName;
  if (patch.headline === undefined && boardPatch.headline !== undefined)
    patch.headline = boardPatch.headline;
  if (patch.yearsExperience === undefined && boardPatch.yearsExperience !== undefined)
    patch.yearsExperience = boardPatch.yearsExperience;
  if (patch.city === undefined && boardPatch.city !== undefined)
    patch.city = boardPatch.city;
  if (patch.resumeText === undefined && boardPatch.resumeText !== undefined)
    patch.resumeText = boardPatch.resumeText;
  // skills را union می‌کنیم (هر دو منبع را نگه می‌داریم، یکتا case-insensitive).
  patch.skills = mergeSkillArrays(patch.skills, boardPatch.skills);

  const applications =
    base.applications && base.applications.length > 0
      ? base.applications
      : boardApplications;

  return {
    profilePatch: compactPatch(patch),
    ...(applications && applications.length > 0 ? { applications } : {}),
  };
}

/**
 * مهارت‌هایی که به‌صورتِ آرایه‌ای از شیء با کلیدِ `title` می‌آیند (جاب‌ویژن SPA) را به
 * آرایه‌ای از رشته نگاشت می‌کند تا normalizeSkills (که `.name`/رشته را می‌فهمد، نه
 * `.title`) بتواند آن‌ها را بگیرد. ورودیِ غیرِآرایه را دست‌نخورده پاس می‌دهد.
 */
function skillTitlesToStrings(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (isRecord(item) && typeof item.title === "string") return item.title;
    return item;
  });
}

/** دو آرایه‌ی مهارت را union می‌کند (یکتا، case-insensitive)؛ undefined اگر هر دو خالی. */
function mergeSkillArrays(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  if (!a && !b) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...(a ?? []), ...(b ?? [])]) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * جابینجا — نگاشتِ best-effort برای شکلِ واقعیِ صفحه‌ی رزومه (`/resumes`/`/my/resume`).
 * صفحه‌ی رزومه‌ی جابینجا داده را با کلیدهایی مثلِ `full_name`، `job_title`/`field`،
 * `skills` (آرایه‌ی نام‌ها)، `city`/`location`، `summary`/`about_me` نشان می‌دهد و
 * تاریخچه‌ی اپلای را زیرِ `applications`/`my_applications`. generic بیشترِ این‌ها را
 * می‌گیرد؛ اینجا کلیدهای اختصاصیِ جابینجا (about_me/field/my_applications) اضافه می‌شوند.
 */
function jobinjaImporter(raw: RawImportPayload): NormalizedImport {
  const p = (isRecord(raw.profile) ? raw.profile : raw) as RawImportPayload;
  const boardPatch: ProfilePatch = {
    fullName: pickString(p, ["first_and_last_name", "full_name_fa"]),
    headline: pickString(p, ["field", "job_field", "career_level"]),
    skills: normalizeSkills(p["skill_tags"] ?? p["abilities"]),
    city: pickString(p, ["resident_city", "province"]),
    resumeText: pickString(p, ["about_me", "career_summary"]),
  };
  const boardApps = normalizeApplications(
    raw["my_applications"] ?? raw["sent_applications"],
  );
  return withBoardOverrides(raw, boardPatch, boardApps);
}

/**
 * جاب‌ویژن — SPA با APIِ JSON. پروفایل معمولاً زیرِ شیءِ تودرتو مثلِ `resume`/`cv` یا
 * `userProfile` می‌آید و فیلدها camelCase اند (`firstName`+`lastName`، `jobTitle`،
 * `skills:[{title}]`، `cityTitle`، `aboutMe`/`summary`). تاریخچه‌ی اپلای زیرِ
 * `requests`/`appliedJobs`. نگاشتِ اختصاصی این تفاوت‌ها را پوشش می‌دهد.
 */
function jobvisionImporter(raw: RawImportPayload): NormalizedImport {
  const p = (isRecord(raw.resume)
    ? raw.resume
    : isRecord(raw.userProfile)
      ? raw.userProfile
      : isRecord(raw.profile)
        ? raw.profile
        : raw) as RawImportPayload;

  const first = pickString(p, ["firstName", "first_name"]);
  const last = pickString(p, ["lastName", "last_name"]);
  const composedName =
    first || last ? [first, last].filter(Boolean).join(" ") : undefined;

  const boardPatch: ProfilePatch = {
    fullName: composedName,
    headline: pickString(p, ["jobTitle", "currentJobTitle", "desiredJobTitle"]),
    // مهارت‌های جاب‌ویژن آرایه‌ای از {title}/{name} است.
    skills: normalizeSkills(skillTitlesToStrings(p["skills"] ?? p["skillList"])),
    yearsExperience: pickNumber(p, ["totalWorkExperience", "workExperienceYears"]),
    city: pickString(p, ["cityTitle", "residenceCity", "cityName"]),
    resumeText: pickString(p, ["aboutMe", "summary", "bio"]),
  };
  const boardApps = normalizeApplications(raw["requests"] ?? raw["appliedJobs"]);
  return withBoardOverrides(raw, boardPatch, boardApps);
}

/**
 * ای‌استخدام — پروفایلِ کاربر (e-estekhdam.com/account). نوعِ اپلای «تماس» است اما
 * کاربر همچنان رزومه/پروفایل دارد. کلیدهای متداول: `name`، `job_title`/`tag`،
 * `skills`، `city`، `summary`/`resume`. generic بیشتر را می‌گیرد؛ نگاشتِ اختصاصی
 * چند کلیدِ فارسیِ سایت را تکمیل می‌کند.
 */
function eEstekhdamImporter(raw: RawImportPayload): NormalizedImport {
  const p = (isRecord(raw.profile) ? raw.profile : raw) as RawImportPayload;
  const boardPatch: ProfilePatch = {
    headline: pickString(p, ["job_category", "category", "tag"]),
    skills: normalizeSkills(p["specialties"] ?? p["abilities"]),
    city: pickString(p, ["resident_city"]),
    resumeText: pickString(p, ["resume", "cover_text"]),
  };
  return withBoardOverrides(raw, boardPatch);
}

/**
 * ایران‌تلنت — پروفایلِ انگلیسی‌محور (irantalent.com). فیلدها camelCase/انگلیسی:
 * `firstName`+`lastName`، `headline`/`currentPosition`، `skills:[{name}]`،
 * `location`/`cityName`، `summary`. تاریخچه‌ی اپلای زیرِ `applications`.
 */
function irantalentImporter(raw: RawImportPayload): NormalizedImport {
  const p = (isRecord(raw.profile) ? raw.profile : raw) as RawImportPayload;
  const first = pickString(p, ["firstName", "first_name"]);
  const last = pickString(p, ["lastName", "last_name"]);
  const composedName =
    first || last ? [first, last].filter(Boolean).join(" ") : undefined;

  const boardPatch: ProfilePatch = {
    fullName: composedName,
    headline: pickString(p, ["currentPosition", "professionalTitle"]),
    skills: normalizeSkills(p["skills"]),
    yearsExperience: pickNumber(p, ["experienceYears", "totalExperienceYears"]),
    city: pickString(p, ["cityName", "locationCity"]),
    resumeText: pickString(p, ["summary", "professionalSummary", "aboutMe"]),
  };
  return withBoardOverrides(raw, boardPatch);
}

/** رجیستریِ نرمال‌سازِ هر سایت. افزودنِ سایتِ تازه = یک ورودی اینجا. */
const importers: Partial<Record<JobBoardId, BoardProfileImporter>> = {
  jobinja: jobinjaImporter,
  jobvision: jobvisionImporter,
  "e-estekhdam": eEstekhdamImporter,
  irantalent: irantalentImporter,
};

/** آیا برای این سایت نرمال‌ساز ثبت شده است؟ */
export function hasImporter(board: JobBoardId): boolean {
  return board in importers;
}

/**
 * نقطه‌ی ورودِ عمومی: یک payloadِ خام را برای یک سایت نرمال می‌کند.
 *
 * ۱) ابتدا `assertNoCredentials` (نگهبانِ §10) — اگر فیلدِ اعتبارنامه‌مانند بود throw.
 * ۲) سپس نرمال‌سازِ همان سایت (یا generic اگر هوکِ اختصاصی نباشد).
 *
 * @throws {CredentialLeakError} اگر payload فیلدِ شبیهِ اعتبارنامه داشته باشد.
 */
export function normalizeImportedProfile(
  board: JobBoardId,
  rawPayload: RawImportPayload,
): NormalizedImport {
  assertNoCredentials(rawPayload);
  const importer = importers[board] ?? genericNormalize;
  return importer(rawPayload);
}
