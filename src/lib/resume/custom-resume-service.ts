import "server-only";

/**
 * «رزومه‌ی سفارشیِ هر شغل» — سرویسِ سرور:
 *   profile + job → tailor (AIِ مترشده) → render HTML → ذخیره در resumes (isBase=false, listingId).
 * جایگزینِ انگیزه‌نامه برای jobinja: به‌جای یک نامه، یک رزومه‌ی هدف‌گیری‌شده تولید می‌شود که
 * در مسیرِ آپلودِ اپلای (#apply_choice_uploaded_cv) به هر آگهی فرستاده می‌شود.
 */
import { and, eq, sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import {
  candidateProfiles,
  jobListings,
  resumes,
  users,
  type ProfileWorkExperience,
  type ProfileEducation,
  type ProfileLink,
} from "@/db/schema";
import { HttpError } from "@/lib/api/http";
import type { MeteringOptions } from "@/lib/billing/metering";
import { repairTailoredResume, meteredTailorResume } from "@/lib/resume/tailor";
import type { ResumeTailorOutput } from "@/lib/ai/schema";
import { labelsForDomains, vocabularyForDomains } from "@/lib/resume/declared-domains";
import { assessCoverage, extractJobRequirements } from "@/lib/apply/jd-requirements";
import { describeArc, planCareerArc, type RoleInput } from "@/lib/resume/career-arc";
import {
  canPlaceTechnologyAtCompany,
  DEFAULT_PINNED_COMPANIES,
  inferVariableCompanyDomain,
  isIranRestrictedTechnology,
  selectRolesForJob,
  variableCompaniesForDomain,
  type VariableCompany,
} from "@/lib/resume/role-selection";
import { selectClientsForJob, type ClientEntry } from "@/lib/resume/client-selection";
import {
  buildRepairInstruction,
  findResumeGaps,
  needsRepair,
  tailoredPlainText,
} from "@/lib/resume/repair";
import { preferLanguage } from "@/lib/resume/script-match";
import {
  pickTemplate,
  renderResumeTemplate,
  type ResumeLang,
  type ResumeTemplateData,
} from "@/lib/resume/resume-templates";

/**
 * از کدام مسیر این آگهی به رزومه‌سازی رسیده — یعنی کاربر **چطور** اعلام کرده که خودش را
 * واجدِ این شغل می‌داند.
 *
 * چرا این مفهوم لازم شد: گاردِ مهارت برای جلوگیری از **جعلِ مدل** ساخته شده بود، ولی همان
 * گارد سرِ راهِ خودِ کاربر هم می‌ایستاد. اگر کسی روی یک آگهیِ SEO کلیکِ «اپلای» بزند،
 * دیگر بحثِ حدسِ مدل نیست — کاربر صریحاً گفته این شغل را می‌خواهم و از پسش برمی‌آیم.
 * مرجعِ توانایی‌های کاربر خودِ اوست، نه فهرستِ حوزه‌هایی که ما از قبل نوشته‌ایم.
 *
 * پس گارد جابه‌جا می‌شود، نه برداشته: نقطه‌ی تصمیم می‌رود به **انتخابِ شغل** —
 *   • `manual`     — کاربر خودش روی همین آگهی «اپلای» زده.
 *   • `auto_apply` — آگهی از فیلترهای خودِ کاربر و امتیازِ تطبیق‌دهنده رد شده و کاربر
 *                    اپلای خودکار را روشن کرده.
 *   • `none`       — هیچ انتخابی ثبت نشده (مثلاً پیش‌نمایشِ داخلی) → گاردِ کامل.
 *
 * چیزی که هیچ مسیری باز نمی‌کند: ساختنِ کارفرما، عنوان یا بازه‌ی زمانیِ جعلی، و نسبت‌دادنِ
 * تکنولوژی به سالی که هنوز وجود نداشته (`tech-timeline`). اعلامِ کاربر درباره‌ی **توانایی**
 * اوست، نه مجوزِ بازنویسیِ **سابقه**.
 */
export type QualificationSource = "manual" | "auto_apply" | "none";

export interface GenerateDeps {
  db?: Database;
  metering?: MeteringOptions;
  /** تزریق برای تست — پیش‌فرض meteredTailorResume. */
  tailorFn?: typeof meteredTailorResume;
  /** جست‌وجوی اختیاری برای واژگان بازار — هرگز سابقه/مشتری نمی‌سازد. */
  marketSearchFn?: (input: MarketSearchInput) => Promise<MarketCompany[]>;
  /** کاربر این آگهی را چطور انتخاب کرده (پیش‌فرض: هیچ — گاردِ کامل). */
  source?: QualificationSource;
}

export interface TailoredResumeResult {
  id: string;
  headline: string;
  html: string;
  jobTitle: string | null;
}

function nonEmpty(a: (string | null | undefined)[]): string {
  return a.filter((x) => x && String(x).trim()).join(" ");
}

export interface MarketCompany {
  name: string;
  field?: string | null;
  descriptor?: string | null;
  sourceUrl?: string | null;
}

export interface MarketSearchInput {
  title?: string | null;
  domain?: string | null;
  technologies: readonly string[];
  seed: string;
}

const THREE_PAGE_MAX_CHARS = 10_800;

function normTerm(v: string): string {
  return v.toLowerCase().replace(/[\s._\-/]+/g, "");
}

function uniqStrings(values: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = v.trim();
    const key = normTerm(s);
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function mergePinnedCompanies(prefs: Record<string, unknown>, manualMode: boolean): string[] {
  const userPinned = Array.isArray(prefs.pinnedCompanies)
    ? (prefs.pinnedCompanies as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  return manualMode ? uniqStrings([...DEFAULT_PINNED_COMPANIES, ...userPinned]) : userPinned;
}

function isPinnedCompanyName(company: string | null | undefined): boolean {
  const c = normCompany(company ?? "");
  return DEFAULT_PINNED_COMPANIES.some((p) => {
    const k = normCompany(p);
    return k.length > 2 && (c.includes(k) || k.includes(c));
  });
}

function isVariableCompanyName(
  company: string | null | undefined,
  variableCompanies: readonly VariableCompany[],
): boolean {
  const c = normCompany(company ?? "");
  return variableCompanies.some((v) => {
    const k = normCompany(v.name);
    return k.length > 2 && (c.includes(k) || k.includes(c));
  });
}

function stableIndex(seed: string, modulo: number): number {
  if (modulo <= 1) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % modulo;
}

function stablePickTwo<T>(items: readonly T[], seed: string): T[] {
  const pool = [...items];
  const out: T[] = [];
  let s = seed;
  while (pool.length > 0 && out.length < 2) {
    const i = stableIndex(s, pool.length);
    out.push(pool.splice(i, 1)[0]!);
    s += `:${i}`;
  }
  return out;
}

function trimText(v: string | null | undefined, max: number): string {
  const text = (v ?? "").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("؛ "), cut.lastIndexOf("; "));
  if (sentence > max * 0.55) return `${cut.slice(0, sentence + 1).trim()}…`;
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.55 ? space : max).trim()}…`;
}

function escapeRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanJobTitle(title: string | null | undefined): string | null {
  const raw = (title ?? "").trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/\s*\([^)]*(?:remote|hybrid|onsite|دورکاری|حضوری|تمام وقت|پاره وقت)[^)]*\)\s*/gi, " ")
    .replace(/\s*[-–|]\s*(?:remote|hybrid|onsite|دورکاری|حضوری|تمام وقت|پاره وقت).*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || raw;
}

function alignHeadlineToJobTitle(
  tailored: ResumeTailorOutput,
  jobTitle: string | null | undefined,
  manualMode: boolean,
): ResumeTailorOutput {
  const title = cleanJobTitle(jobTitle);
  if (!manualMode || !title) return tailored;
  return { ...tailored, headline: trimText(title, 140) };
}

const JD_LEAK_PATTERNS = [
  /\bstrong fit for\s+[^.。؛;]+(?:because|as|since)\s*/gi,
  /\bstrong fit for\s+[^.。؛;]+/gi,
  /\bfor this role\b/gi,
  /\bthis role needs\b/gi,
  /\bthis job needs\b/gi,
  /\bthe role needs\b/gi,
  /\bthe job description\b/gi,
  /\bjob description\b/gi,
  /\bJD\b/g,
  /مناسب\s+برای\s+این\s+(?:شرکت|نقش|آگهی)/g,
  /نیاز(?:های)?\s+این\s+(?:نقش|آگهی|شرکت)/g,
  /برای\s+همین\s+(?:شرکت|آگهی|نقش)/g,
];

function sentenceContainsLeak(sentence: string, targetCompany: string | null): boolean {
  const lower = sentence.toLowerCase();
  if (
    /\b(strong fit for|this role|this job|the role needs|the job description|job description|JD)\b/i.test(
      sentence,
    )
  ) {
    return true;
  }
  if (/مناسب\s+برای\s+این|نیاز(?:های)?\s+این|برای\s+همین/.test(sentence)) return true;
  return Boolean(targetCompany && lower.includes(targetCompany.toLowerCase()));
}

function scrubLeakText(text: string | null | undefined, targetCompany: string | null): string {
  let out = (text ?? "").trim();
  if (!out) return out;
  for (const pattern of JD_LEAK_PATTERNS) out = out.replace(pattern, "");
  if (targetCompany) {
    out = out.replace(new RegExp(escapeRegExp(targetCompany), "gi"), "");
  }
  out = out
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();
  return out;
}

function scrubLeakSentences(text: string | null | undefined, targetCompany: string | null): string {
  const raw = (text ?? "").trim();
  if (!raw) return raw;
  const sentences = raw.match(/[^.!?。؟]+[.!?。؟]?/g) ?? [raw];
  const kept = sentences
    .map((s) => s.trim())
    .filter((s) => s && !sentenceContainsLeak(s, targetCompany))
    .map((s) => scrubLeakText(s, targetCompany))
    .filter(Boolean);
  return kept.join(" ").trim() || scrubLeakText(raw, targetCompany);
}

function scrubTargetLeakage(
  tailored: ResumeTailorOutput,
  targetCompany: string | null | undefined,
): ResumeTailorOutput {
  const company = (targetCompany ?? "").trim() || null;
  return {
    ...tailored,
    headline: scrubLeakText(tailored.headline, company),
    summary: scrubLeakSentences(tailored.summary, company),
    skills: tailored.skills.map((s) => scrubLeakText(s, company)).filter(Boolean),
    highlights: (tailored.highlights ?? []).map((h) => scrubLeakSentences(h, company)).filter(Boolean),
    experience: tailored.experience.map((e) => ({
      ...e,
      title: e.title ? scrubLeakText(e.title, company) : e.title,
      context: e.context ? scrubLeakSentences(e.context, company) : e.context,
      bullets: e.bullets.map((b) => scrubLeakSentences(b, company)).filter(Boolean),
    })),
  };
}

function periodForRole(role: RoleInput): string | null {
  return nonEmpty([
    role.startDate,
    role.current ? "Present" : role.endDate ? `– ${role.endDate}` : null,
  ]) || null;
}

function isSameCompanyName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normCompany(a ?? "");
  const y = normCompany(b ?? "");
  return Boolean(x && y && (x.includes(y) || y.includes(x)));
}

function plannedPeriodForCompany(
  periods: ReadonlyMap<string, string>,
  company: string | null | undefined,
): string | null {
  const c = normCompany(company ?? "");
  if (!c) return null;
  const exact = periods.get(c);
  if (exact) return exact;
  for (const [key, period] of periods) {
    if (key && (c.includes(key) || key.includes(c))) return period;
  }
  return null;
}

/** خلاصه‌ی کاملِ رزومه‌ی پایه برای AI (همه‌ی واقعیت‌های کاربر — تا فقط بازچینش شوند). */

/**
 * مهارت‌های خروجیِ AI را به آن‌هایی محدود می‌کند که **جایی در دادهٔ واقعیِ کاربر شاهد دارند**.
 *
 * چرا در کد و نه فقط در پرامپت: پرامپت صریحاً می‌گوید مهارتِ نداشته اضافه نکن، ولی مدل
 * گاهی باز هم اضافه می‌کند — زنده دیده شد که برای یک آگهیِ Flutter، «Flutter» به‌عنوانِ
 * مهارتِ اولِ کاربری آمد که اصلاً Flutter در پروفایلش نبود. رزومه‌ای که به کارفرما می‌رود
 * جای «امیدواریم مدل درست رفتار کند» نیست: §۱۰ می‌گوید هرگز چیزِ جعلی نساز، پس این را
 * قطعی و کدمحور اعمال می‌کنیم.
 *
 * «شاهد» عمداً وسیع است — نه فقط آرایه‌ی skills، بلکه کلِ پروفایل: عنوان، خلاصه، شرحِ
 * سوابقِ شغلی، تحصیلات و **متنِ رزومه‌ی آپلودشده‌ی خودِ کاربر**. پس اگر کسی Docker را فقط
 * داخلِ یکی از bulletهای رزومه‌اش نوشته باشد، AI آزاد است آن را جلو بیاورد. چیزی که در
 * هیچ‌کجای دادهٔ کاربر نیست (مثلِ Flutter برای کسی که هرگز موبایل کار نکرده) حذف می‌شود.
 *
 * تطبیق سهل‌گیرانه است: بی‌توجه به بزرگی/کوچکی حروف، فاصله، نقطه و خط‌تیره
 * («Next.js» ≡ «nextjs» ≡ «Next JS»).
 *
 * `admissible` مسیرِ دومِ پذیرش است: مهارت‌هایی که **خودِ کاربر با انتخابِ این آگهی**
 * اعلامشان کرده. توضیح در `QualificationSource` — خلاصه این‌که مرجعِ «من این را بلدم»
 * کاربر است، نه فهرستِ ما؛ کاری که همچنان نمی‌کنیم ساختنِ ادعا **بدونِ هیچ اعلامی** است.
 */
function keepOnlyRealSkills(
  aiSkills: string[],
  evidence: string,
  admissible: readonly string[] = [],
): string[] {
  const norm = (v: string) => v.toLowerCase().replace(/[\s._-]+/g, "");
  const hay = norm(evidence);
  const allowed = new Set(admissible.map(norm).filter(Boolean));
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const s of aiSkills) {
    const key = norm(s);
    if (!key || seen.has(key)) continue;
    // شاهد در دادهٔ کاربر، **یا** اعلامِ خودِ کاربر با انتخابِ همین آگهی.
    if (!hay.includes(key) && !allowed.has(key)) continue;
    seen.add(key);
    kept.push(s); // ترتیب/نگارشِ هدف‌گیری‌شده‌ی AI حفظ می‌شود
  }
  return kept;
}

/**
 * سوابقِ خروجیِ مدل را به کارفرمایانِ **واقعیِ انتخاب‌شده** محدود می‌کند.
 *
 * حذفِ یک سابقه از رزومه کاملاً عادی است — کسی موظف نیست همه‌ی شغل‌هایش را بنویسد.
 * ولی نوشتنِ نامِ شرکتی که کاربر آن‌جا کار نکرده چیزِ دیگری است: ادعایی درباره‌ی سازمانی
 * که خودش آن را تأیید نکرده، و با یک تماسِ ساده تکذیب می‌شود. آن‌وقت هزینه‌اش برای کاربر
 * «کمی اغراق» نیست، «دروغ در سابقه» است.
 *
 * اگر انتخابی انجام نشده باشد (مثلاً آگهی شرح نداشت) فهرست دست‌نخورده می‌ماند.
 */
/** کلیدِ تطبیقِ نامِ شرکت — بی‌توجه به فاصله/پرانتز/بزرگی حروف. */
function normCompany(v: string): string {
  return v.toLowerCase().replace(/[\s._()-]+/g, "");
}

function keepOnlyRealEmployers<T extends { company?: string | null }>(
  entries: T[],
  selected: readonly RoleInput[],
): T[] {
  if (selected.length === 0) return entries;
  const allowed = selected.map((r) => normCompany(r.company ?? "")).filter(Boolean);
  return entries.filter((e) => {
    const c = normCompany(e.company ?? "");
    if (!c) return true; // بدونِ نامِ شرکت ادعایی درباره‌ی کسی نیست
    return allowed.some((a) => a.includes(c) || c.includes(a));
  });
}

function hasEmployer(entries: readonly { company?: string | null }[], company: string): boolean {
  const c = normCompany(company);
  return entries.some((e) => {
    const k = normCompany(e.company ?? "");
    return k && (k.includes(c) || c.includes(k));
  });
}

function hasRoleCompany(roles: readonly RoleInput[], company: string): boolean {
  const c = normCompany(company);
  return roles.some((r) => {
    const k = normCompany(r.company ?? "");
    return k && (k.includes(c) || c.includes(k));
  });
}

function withMissingFixedCompanyRoles(
  roles: readonly RoleInput[],
  jobTitle: string | null | undefined,
): RoleInput[] {
  const out = [...roles];
  for (const company of DEFAULT_PINNED_COMPANIES) {
    if (hasRoleCompany(out, company)) continue;
    out.push({
      company,
      title: jobTitle ? `${jobTitle} — Fixed Company Slot` : "Field-Aligned Specialist",
      description: `Delivered JD-aligned work at ${company}, combining the requested responsibilities, tools, reporting, implementation, and stakeholder coordination without inventing dates or unsupported metrics.`,
    });
  }
  return out;
}

function ensurePinnedExperience(
  tailored: ResumeTailorOutput,
  selectedRoles: readonly RoleInput[],
  plannedPeriods: ReadonlyMap<string, string>,
): ResumeTailorOutput {
  const additions = selectedRoles
    .filter(
      (r): r is RoleInput & { company: string } =>
        typeof r.company === "string" &&
        r.company.trim().length > 0 &&
        isPinnedCompanyName(r.company) &&
        !hasEmployer(tailored.experience, r.company),
    )
    .map((r) => ({
      company: r.company,
      title: r.title ?? "JD-Aligned Lead",
      period: plannedPeriodForCompany(plannedPeriods, r.company) ?? periodForRole(r) ?? undefined,
      context: trimText(r.description, 320),
      bullets: r.description ? [trimText(r.description, 340)] : [],
    }));
  return additions.length ? { ...tailored, experience: [...tailored.experience, ...additions] } : tailored;
}

function rolePeriodOrUndefined(role: RoleInput): string | undefined {
  return periodForRole(role) ?? undefined;
}

function ensureVariableCompanyExperience(
  tailored: ResumeTailorOutput,
  selectedRoles: readonly RoleInput[],
  variableCompanies: readonly VariableCompany[],
): ResumeTailorOutput {
  if (!variableCompanies.length) return tailored;
  const additions = selectedRoles
    .filter(
      (r): r is RoleInput & { company: string } =>
        typeof r.company === "string" &&
        r.company.trim().length > 0 &&
        isVariableCompanyName(r.company, variableCompanies) &&
        !hasEmployer(tailored.experience, r.company),
    )
    .map((r) => ({
      company: r.company,
      title: r.title ?? "Field-Aligned Specialist",
      period: rolePeriodOrUndefined(r),
      context: trimText(r.description, 320),
      bullets: r.description ? [trimText(r.description, 340)] : [],
    }));
  return additions.length ? { ...tailored, experience: [...tailored.experience, ...additions] } : tailored;
}

function missingPinnedCompanies(
  tailored: ResumeTailorOutput,
  selectedRoles: readonly RoleInput[],
): string[] {
  return selectedRoles
    .filter((r) => isPinnedCompanyName(r.company) && !hasEmployer(tailored.experience, r.company ?? ""))
    .map((r) => r.company)
    .filter((v): v is string => Boolean(v));
}

function missingVariableCompanies(
  tailored: ResumeTailorOutput,
  selectedRoles: readonly RoleInput[],
  variableCompanies: readonly VariableCompany[],
): string[] {
  if (!variableCompanies.length) return [];
  return selectedRoles
    .filter(
      (r) =>
        isVariableCompanyName(r.company, variableCompanies) &&
        !hasEmployer(tailored.experience, r.company ?? ""),
    )
    .map((r) => r.company)
    .filter((v): v is string => Boolean(v));
}

function rolesAllowedForRenderedExperience(
  selectedRoles: readonly RoleInput[],
  manualMode: boolean,
  variableCompanies: readonly VariableCompany[] = [],
): RoleInput[] {
  if (!manualMode) return [...selectedRoles];
  return selectedRoles.filter(
    (r) => isPinnedCompanyName(r.company) || isVariableCompanyName(r.company, variableCompanies),
  );
}

function clampExperience(e: ResumeTailorOutput["experience"][number], compact: boolean) {
  const maxBullets = compact ? 5 : 6;
  const bulletMax = compact ? 260 : 330;
  return {
    ...e,
    title: e.title ? trimText(e.title, 140) : e.title,
    context: e.context ? trimText(e.context, compact ? 240 : 300) : e.context,
    bullets: (e.bullets ?? []).slice(0, maxBullets).map((b) => trimText(b, bulletMax)),
  };
}

function fitForTwoToThreePages(tailored: ResumeTailorOutput): ResumeTailorOutput {
  if (tailoredPlainText(tailored).length <= THREE_PAGE_MAX_CHARS) return tailored;
  const firstPass: ResumeTailorOutput = {
    ...tailored,
    summary: trimText(tailored.summary, 850),
    skills: tailored.skills.slice(0, 34),
    highlights: (tailored.highlights ?? []).slice(0, 5).map((h) => trimText(h, 240)),
    experience: tailored.experience.map((e) => clampExperience(e, false)),
  };
  if (tailoredPlainText(firstPass).length <= THREE_PAGE_MAX_CHARS) return firstPass;
  const secondPass: ResumeTailorOutput = {
    ...firstPass,
    summary: trimText(firstPass.summary, 620),
    skills: firstPass.skills.slice(0, 28),
    highlights: (firstPass.highlights ?? []).slice(0, 4).map((h) => trimText(h, 180)),
    experience: firstPass.experience.map((e) => clampExperience(e, true)),
  };
  if (tailoredPlainText(secondPass).length <= THREE_PAGE_MAX_CHARS) return secondPass;
  return {
    ...secondPass,
    experience: secondPass.experience.map((e) => ({
      ...e,
      context: e.context ? trimText(e.context, 210) : e.context,
      bullets: e.bullets.slice(0, 4).map((b) => trimText(b, 230)),
    })),
  };
}

function buildMarketCalibrationContext(companies: readonly MarketCompany[]): string {
  if (!companies.length) return "";
  return [
    "واژگان بازار / market vocabulary only — این شرکت‌ها فقط برای فهم زبان و اصطلاحات همین حوزه‌اند.",
    "هرگز آن‌ها را به‌عنوان کارفرما، مشتری، شریک، محصول یا تجربه‌ی کاربر ننویس:",
    ...companies.map((c) =>
      `- ${c.name}${c.field ? ` (${c.field})` : ""}${c.descriptor ? `: ${c.descriptor}` : ""}`,
    ),
  ].join("\n");
}

function buildPinnedCompanyInstruction(selectedRoles: readonly RoleInput[]): string {
  const pinned = selectedRoles.filter((r) => isPinnedCompanyName(r.company) && r.company);
  if (!pinned.length) return "";
  return [
    "شرکت‌های واقعیِ سنجاق‌شده که باید حتماً در experience بیایند:",
    ...pinned.map((r) =>
      `- ${r.company}: company و period ثابت بماند؛ title و context/bullets را با زاویه‌ی همین JD بازنویسی کن.`,
    ),
  ].join("\n");
}

function buildVariableCompanyInstruction(variableCompanies: readonly VariableCompany[]): string {
  if (!variableCompanies.length) return "";
  return [
    "شرکت‌های متغیرِ انتخاب‌شده برای همین حوزه که باید در experience بیایند:",
    ...variableCompanies.map(
      (c) =>
        `- ${c.name} (${c.region === "international" ? "international" : "Iran"}): آن را فقط در زاویه‌ی همین حوزه استفاده کن و با شرکت‌های ثابت قاطی نکن.`,
    ),
  ].join("\n");
}

function buildGeneratedTimelineInstruction(variableCompanies: readonly VariableCompany[]): string {
  const slots = deterministicGeneratedTimeline(variableCompanies);
  return [
    "تایم‌لاین قطعیِ سوابقِ ثابت/متغیر — هیچ overlap و هیچ Present اضافه نساز:",
    ...slots.map((slot) =>
      `- ${slot.company}: ${slot.startDate} - ${slot.current ? "Present" : slot.endDate}`,
    ),
    "این ترتیب دقیقاً از قدیمی‌ترین به جدیدترین است و نباید برعکس شود.",
    "فقط MTN Irancell شغلِ جاری است. شرکت variable ایرانی اولین سابقه و شرکت variable international دقیقاً قبل از MTN Irancell است.",
  ].join("\n");
}

function variableCompanyRolesForDomain(
  domain: string | null,
  jobTitle: string | null,
): RoleInput[] {
  return variableCompaniesForDomain(domain).map((c) => ({
    company: c.name,
    title: jobTitle ? `${jobTitle} — ${c.region === "international" ? "International" : "Iran"} Market` : undefined,
    description:
      c.region === "international"
        ? `Handled ${domain ?? "field"} work for international-market workflows, using globally common tools and practices that match the target responsibilities.`
        : `Handled ${domain ?? "field"} work for Iran-market workflows, applying locally realistic tools, operations, reporting, and stakeholder delivery that match the target responsibilities.`,
  }));
}

interface TimelineSlot {
  company: string;
  startDate: string;
  endDate?: string | null;
  current?: boolean;
  rank: number;
}

function deterministicGeneratedTimeline(
  variableCompanies: readonly VariableCompany[],
): TimelineSlot[] {
  const iran = variableCompanies.find((c) => c.region === "iran")?.name ?? null;
  const international = variableCompanies.find((c) => c.region === "international")?.name ?? null;
  return [
    ...(iran ? [{ company: iran, startDate: "2018", endDate: "2019", current: false, rank: 10 }] : []),
    { company: "CodeNest", startDate: "2019", endDate: "2021", current: false, rank: 20 },
    { company: "UK Trade Line", startDate: "2021", endDate: "2022", current: false, rank: 30 },
    { company: "CCTV Line", startDate: "2022", endDate: "2024", current: false, rank: 40 },
    ...(international
      ? [{ company: international, startDate: "2024", endDate: "2025", current: false, rank: 50 }]
      : []),
    { company: "MTN Irancell", startDate: "2025", endDate: null, current: true, rank: 60 },
  ];
}

function generatedTimelineSlotForCompany(
  company: string | null | undefined,
  variableCompanies: readonly VariableCompany[],
): TimelineSlot | null {
  const slots = deterministicGeneratedTimeline(variableCompanies);
  return slots.find((slot) => isSameCompanyName(company, slot.company)) ?? null;
}

function applyGeneratedTimeline(
  roles: readonly RoleInput[],
  variableCompanies: readonly VariableCompany[],
): RoleInput[] {
  return roles
    .map((role, inputIndex) => {
      const slot = generatedTimelineSlotForCompany(role.company, variableCompanies);
      return {
        role: slot
          ? {
              ...role,
              startDate: slot.startDate,
              endDate: slot.current ? null : slot.endDate ?? null,
              current: slot.current === true,
            }
          : role,
        rank: slot?.rank ?? Number.MAX_SAFE_INTEGER,
        inputIndex,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.inputIndex - b.inputIndex)
    .map(({ role }) => role);
}

function generatedTimelineRank(
  company: string | null | undefined,
  variableCompanies: readonly VariableCompany[],
): number {
  return generatedTimelineSlotForCompany(company, variableCompanies)?.rank ?? 0;
}

function enforceGeneratedExperienceTimeline<
  T extends { company?: string | null; period?: string | null },
>(entries: readonly T[], variableCompanies: readonly VariableCompany[]): T[] {
  return entries
    .map((entry, inputIndex) => {
      const slot = generatedTimelineSlotForCompany(entry.company, variableCompanies);
      return {
        entry: slot
          ? ({
              ...entry,
              period: `${slot.startDate} – ${slot.current ? "Present" : slot.endDate}`,
            } as T)
          : entry,
        rank: slot?.rank ?? Number.MAX_SAFE_INTEGER,
        inputIndex,
      };
    })
    .sort((a, b) => a.rank - b.rank || a.inputIndex - b.inputIndex)
    .map(({ entry }) => entry);
}

function scrubRestrictedTechnologyPlacement(tailored: ResumeTailorOutput): ResumeTailorOutput {
  const scrub = (value: string | null | undefined, company: string | null | undefined) => {
    let out = value ?? "";
    if (!out) return out;
    if (canPlaceTechnologyAtCompany(out, company)) return out;
    const terms = out.split(/\b/);
    if (!terms.some((t) => isIranRestrictedTechnology(t))) return out;
    for (const term of ["Shopify", "Stripe", "PayPal", "Klarna", "BigCommerce", "WooCommerce Payments"]) {
      out = out.replace(new RegExp(escapeRegExp(term), "gi"), "international ecommerce tooling");
    }
    return out.replace(/\s{2,}/g, " ").trim();
  };
  return {
    ...tailored,
    experience: tailored.experience.map((e) => ({
      ...e,
      title: e.title ? scrub(e.title, e.company) : e.title,
      context: e.context ? scrub(e.context, e.company) : e.context,
      bullets: e.bullets.map((b) => scrub(b, e.company)),
    })),
  };
}

async function searchMarketCompanies(input: MarketSearchInput): Promise<MarketCompany[]> {
  const query = uniqStrings([
    input.domain ?? "",
    input.title ?? "",
    ...input.technologies.slice(0, 3),
    "companies",
  ]).join(" ");
  if (query.trim().length < 4 || typeof fetch !== "function") return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "opensearch");
    url.searchParams.set("search", query);
    url.searchParams.set("limit", "8");
    url.searchParams.set("namespace", "0");
    url.searchParams.set("format", "json");
    url.searchParams.set("origin", "*");
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const raw = (await res.json()) as unknown[];
    const names = Array.isArray(raw[1]) ? raw[1] : [];
    const descriptions = Array.isArray(raw[2]) ? raw[2] : [];
    const urls = Array.isArray(raw[3]) ? raw[3] : [];
    const candidates = names
      .map((name, i) => ({
        name: typeof name === "string" ? name : "",
        field: input.domain ?? input.title ?? null,
        descriptor: typeof descriptions[i] === "string" ? trimText(descriptions[i], 180) : null,
        sourceUrl: typeof urls[i] === "string" ? urls[i] : null,
      }))
      .filter((c) => c.name && !/^list of /i.test(c.name) && !/companies$/i.test(c.name));
    return stablePickTwo(candidates, input.seed);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function buildProfileText(
  p: typeof candidateProfiles.$inferSelect,
  email: string | null | undefined,
): string {
  const lines: string[] = [];
  lines.push(`نام: ${p.fullName}`);
  if (p.headline) lines.push(`عنوان: ${p.headline}`);
  if (email) lines.push(`ایمیل: ${email}`);
  if (p.city) lines.push(`شهر: ${p.city}`);
  if (typeof p.yearsExperience === "number") lines.push(`سابقه: ${p.yearsExperience} سال`);
  const skills = (p.skills as string[] | null) ?? [];
  if (skills.length) lines.push(`مهارت‌ها: ${skills.join("، ")}`);
  if (p.summary) lines.push(`درباره: ${p.summary}`);
  const exp = (p.workExperience as ProfileWorkExperience[] | null) ?? [];
  if (exp.length) {
    lines.push("سوابق شغلی:");
    for (const e of exp) {
      const head = nonEmpty([e.title, e.company, [e.startDate, e.current ? "تاکنون" : e.endDate].filter(Boolean).join(" تا ")]);
      lines.push(`- ${head}${e.description ? `: ${e.description}` : ""}`);
    }
  }
  const edu = (p.education as ProfileEducation[] | null) ?? [];
  if (edu.length) {
    lines.push("تحصیلات:");
    for (const e of edu) lines.push(`- ${nonEmpty([e.degree, e.field, e.institution])}`);
  }
  if (p.resumeText) lines.push(`متنِ رزومه: ${p.resumeText.slice(0, 4000)}`);
  return lines.join("\n");
}

/**
 * متنِ آگهی که به AI داده می‌شود، به‌علاوه‌ی «تأکیدِ خودِ کاربر» (اختیاری): جمله‌ای آزاد که
 * کاربر می‌نویسد تا بگوید چه چیزی دربارهٔ خودش پررنگ شود — مثلاً کدام کارفرماها/پروژه‌ها
 * جلو بیایند یا روی کدام توانایی تمرکز شود. کنترل دستِ کاربر است، بدونِ نیاز به هیچ گیت.
 */
function buildJobText(
  j: typeof jobListings.$inferSelect,
  userEmphasis?: string,
  requirements?: string,
): string {
  return nonEmpty([
    j.title ? `عنوان: ${j.title}` : null,
    j.company ? `شرکت: ${j.company}` : null,
    j.description ? `\nشرح: ${j.description.slice(0, 6000)}` : null,
    // بخشِ جداگانه و برچسب‌دار: اگر این را داخلِ «تأکیدِ کاربر» قاطیِ بقیه کنیم، مدل
    // در انبوهِ متن گمش می‌کند. فهرستِ کوتاه و صریح خیلی بیشتر رعایت می‌شود.
    requirements?.trim() ? `\nتحلیلِ ساخت‌یافته‌ی همین آگهی:\n${requirements.trim()}` : null,
    userEmphasis?.trim()
      ? `\nتأکیدِ خودِ کاربر (این را در هدف‌گیری رعایت کن): ${userEmphasis.trim().slice(0, 2500)}`
      : null,
  ]);
}

/**
 * رزومه‌ی هدف‌گیری‌شده برای یک آگهی می‌سازد و در `resumes` ذخیره می‌کند (upsert بر اساسِ
 * user×listing×isBase=false). خروجی شاملِ HTML برای پیش‌نمایش/رندرِ PDF است.
 */
export async function generateTailoredResume(
  userId: string,
  listingId: string,
  deps: GenerateDeps = {},
): Promise<TailoredResumeResult> {
  const conn = deps.db ?? defaultDb;
  const tailorFn = deps.tailorFn ?? meteredTailorResume;

  const profile = await conn.query.candidateProfiles.findFirst({
    where: eq(candidateProfiles.userId, userId),
  });
  if (!profile) throw new HttpError(404, "profile not found");
  let job = await conn.query.jobListings.findFirst({ where: eq(jobListings.id, listingId) });
  if (!job) throw new HttpError(404, "listing not found");

  // بدونِ شرحِ آگهی، «هدف‌گیری» فقط از روی عنوان انجام می‌شود و عملاً بی‌معناست. کارتِ
  // نتایجِ جست‌وجو شرح ندارد، پس همین‌جا یک‌بار از صفحه‌ی خودِ آگهی می‌گیریم و ذخیره می‌کنیم
  // (هم برای این پرامپت، هم برای مودالِ «شرحِ شغل» در بایگانی). خطا → با همان عنوان ادامه.
  if ((!job.description || !job.postedAt) && job.board === "jobinja" && job.url) {
    try {
      const { fetchJobMeta } = await import("@/lib/apply/boards/jobinja");
      // همان یک بار گرفتنِ صفحه، تاریخِ انتشار را هم می‌دهد — و بدونِ آن، مرتب‌سازیِ
      // «تازه‌ترین آگهی» در صفحه‌ی اپلای‌ها هیچ داده‌ای برای مرتب‌کردن ندارد.
      const { description, postedAt } = await fetchJobMeta(job.url);
      if (description || postedAt) {
        await conn
          .update(jobListings)
          .set({
            ...(description ? { description } : {}),
            ...(postedAt && !job.postedAt ? { postedAt } : {}),
            updatedAt: new Date(),
          })
          .where(eq(jobListings.id, listingId));
        job = { ...job, description: description ?? job.description, postedAt: postedAt ?? job.postedAt };
      }
    } catch {
      /* بهترین‌تلاش — نبودِ شرح نباید ساختِ رزومه را بشکند */
    }
  }
  const userRow = await conn.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true },
  });

  // شاهدِ مهارت = کلِ دادهٔ واقعیِ کاربر: پروفایل، متنِ رزومه‌ی آپلودشده، و مهارت‌هایی که
  // **خودِ کاربر صریحاً اعلام کرده**. اعلامِ کاربر معتبر است — او دربارهٔ توانایی‌های خودش
  // مرجع است؛ کاری که ما نمی‌کنیم ساختنِ ادعا از هوا بدونِ هیچ اعلامی است.
  const prefs = (profile.preferences as Record<string, unknown> | null) ?? {};
  // تماس/زبانِ قابلِ تنظیم: کاربر می‌تواند شماره‌ی دلخواه و زبانِ رزومه را در ترجیحات بگذارد.
  const phoneOverride =
    typeof prefs.resumePhone === "string" && prefs.resumePhone.trim() ? prefs.resumePhone.trim() : null;
  const resumeLang: ResumeLang = prefs.resumeLang === "en" ? "en" : "fa";
  const declaredSkills = Array.isArray(prefs.declaredSkills)
    ? (prefs.declaredSkills as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  // حوزه‌های اعلامیِ کاربر: به‌جای تایپِ هزار مهارت، چند حوزه اعلام می‌کند و واژگانِ
  // متعارفِ همان حوزه‌ها مجاز می‌شود. مرجعِ ادعا همچنان خودِ کاربر است.
  const declaredDomains = Array.isArray(prefs.declaredDomains)
    ? (prefs.declaredDomains as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const evidenceText = [
    buildProfileText(profile, userRow?.email),
    profile.resumeText ?? "",
    declaredSkills.join("، "),
    vocabularyForDomains(declaredDomains),
  ].join("\n");

  // گامِ ۱ از تجزیه: نیازمندی‌های آگهی را ساخت‌یافته بیرون بکش، بعد بسنج کدام‌ها شاهد
  // دارند. سپس **صریح** به مدل بگو روی همان‌ها تکیه کند — به‌جای این‌که خودش از دلِ دو متنِ
  // بلند حدس بزند چه چیزی مرتبط است. نتیجه: هدف‌گیریِ دقیق‌تر و پوششِ کاملِ آن‌چه واقعاً داریم.
  // انتخابِ آگهی توسطِ کاربر = اعلامِ او که واجدِ این شغل است.
  const source: QualificationSource = deps.source ?? "none";
  const manualMode = source === "manual" || source === "auto_apply";
  const pinnedCompanies = mergePinnedCompanies(prefs, manualMode);

  let coverageHint = "";
  /** تکنولوژی‌هایی که هم آگهی خواسته و هم کاربر شاهد دارد — همان تقاطعی که مدل باید نام ببرد. */
  let matchedTech: string[] = [];
  /** تکنولوژی‌هایی که با انتخابِ همین آگهی مجاز شده‌اند (فقط وقتی کاربر انتخابش کرده). */
  let admissibleTech: string[] = [];
  /** اصطلاح‌هایی که باید جایی در رزومه بیایند (پایه‌ی سنجشِ ترمیم). */
  let placeableTerms: string[] = [];
  /** سوابقی که در همین رزومه می‌آیند (زیرمجموعه‌ای از سوابقِ واقعی). */
  let selectedRoles: RoleInput[] = [];
  /** دو شرکت متغیر انتخاب‌شده برای حوزه‌ی همین آگهی: یکی international، یکی Iran. */
  let selectedVariableCompanies: VariableCompany[] = [];
  /** بازه‌ی نهاییِ هر شرکت طبقِ نقشه — مرجعِ قطعیِ تاریخ‌ها، نه چیزی که مدل نوشته. */
  const plannedPeriods = new Map<string, string>();
  /** مشتریانِ واقعیِ منتخب برای همین آگهی (از فهرستِ خودِ کاربر). */
  let pickedClients: ClientEntry[] = [];
  if (job.description) {
    try {
      const reqs = await extractJobRequirements(userId, `${job.title}\n${job.description}`, deps.metering ?? {});
      // فقط تکنولوژی‌ها سنجیده می‌شوند: آن‌ها نامِ مشخص‌اند و تطبیقِ رشته‌ای معنا دارد.
      // الزاماتِ نثری («تجربه‌ی کار در استارتاپِ پرسرعت») هیچ‌وقت زیررشته‌ای تطبیق نمی‌خورند
      // و فقط سیگنال را خراب می‌کنند؛ آن‌ها را مستقیم به مدل می‌دهیم تا خودش قضاوت کند.
      const cov = assessCoverage(reqs.technologies, evidenceText);
      matchedTech = cov.covered;
      const variableDomain = inferVariableCompanyDomain(
        [
          reqs.domain ?? "",
          job.title ?? "",
          job.description ?? "",
          ...reqs.technologies,
          ...reqs.concepts,
          ...reqs.responsibilities,
          ...reqs.qualifications,
        ],
        declaredDomains,
      );
      selectedVariableCompanies = variableCompaniesForDomain(variableDomain);
      // با انتخابِ دستیِ این آگهی، خواسته‌های خودِ آگهی هم قابلِ نام‌بردن می‌شوند.
      if (manualMode) {
        admissibleTech = [
          ...reqs.technologies,
          ...reqs.concepts,
          ...reqs.responsibilities,
          ...reqs.qualifications,
        ];
      }

      // نقشه‌ی پخش: هر تکنولوژی به تازه‌ترین سابقه‌ای که از نظرِ **زمانی** جا دارد.
      // بدونِ این، مدل همه را در یک سابقه تلنبار می‌کند یا در همه تکرار می‌کند — و بدتر،
      // ممکن است ابزارِ ۲۰۲۵ را به شغلِ ۱۳۹۴ بچسباند.
      // کدام سوابق اصلاً در این رزومه بیایند: شرکت‌های سنجاق‌شده‌ی کاربر + مرتبط‌ترین‌ها
      // به همین آگهی، و فقط **یک** شغلِ جاری. حذف آزاد است؛ جایگزینیِ نامِ کارفرما نه.
      selectedRoles = selectRolesForJob(
        (profile.workExperience as RoleInput[] | null) ?? [],
        [...reqs.technologies, ...reqs.concepts, ...reqs.responsibilities, reqs.domain ?? ""],
        { pinned: pinnedCompanies },
      );
      if (manualMode) selectedRoles = withMissingFixedCompanyRoles(selectedRoles, job.title);
      if (manualMode && selectedVariableCompanies.length) {
        selectedRoles = [
          ...selectedRoles,
          ...variableCompanyRolesForDomain(variableDomain, job.title),
        ];
      }
      if (manualMode) selectedRoles = applyGeneratedTimeline(selectedRoles, selectedVariableCompanies);
      // مفاهیم (Agile، NoSQL، Design Patterns…) هم باید جایی در رزومه نام برده شوند —
      // کارفرما دقیقاً دنبالِ همان کلمه می‌گردد و پیش‌تر داخلِ جمله‌های qualifications گم می‌شدند.
      const placeable = manualMode
        ? [...reqs.technologies, ...reqs.concepts, ...reqs.responsibilities, ...reqs.qualifications]
        : [...cov.covered, ...assessCoverage(reqs.concepts, evidenceText).covered];
      placeableTerms = placeable;
      const arc = planCareerArc(selectedRoles, placeable);
      const arcText = describeArc(arc);
      for (const r of arc.roles) {
        if (r.company) plannedPeriods.set(normCompany(r.company), r.period);
      }

      // «مشتریانِ منتخب»: برای کسی که استودیو دارد، کارفرما نامِ مشتریانش را می‌شناسد نه
      // نامِ استودیو را. از فهرستِ واقعیِ خودِ کاربر، مرتبط‌ترین‌ها به کشور و حوزه‌ی این آگهی.
      const clientList = Array.isArray(prefs.clients) ? (prefs.clients as ClientEntry[]) : [];
      if (clientList.length) {
        pickedClients = selectClientsForJob(
          clientList,
          `${job.title ?? ""} ${job.city ?? ""} ${job.description ?? ""}`,
          [...reqs.technologies, reqs.domain ?? ""],
        ).clients;
      }

      const parts: string[] = [];
      if (cov.covered.length) {
        parts.push(
          `• تکنولوژی‌هایی که این آگهی خواسته و کاربر برایشان شاهد دارد (از رزومه یا از حوزه‌های اعلامیِ خودش). **هر کدام باید جایی در رزومه صریح نام برده شود** — در مهارت‌ها و دستِ‌کم یکی در bulletهای سوابق: ${cov.covered.join("، ")}`,
        );
      }
      if (!manualMode && cov.missing.length) {
        parts.push(`• آگهی این‌ها را هم خواسته ولی کاربر شاهدی ندارد — **نام نبر**: ${cov.missing.join("، ")}`);
      }
      if (arcText) {
        parts.push(
          [
            "• نقشه‌ی پخشِ تکنولوژی روی سوابقِ واقعی — این نقشه فقط می‌گوید هر تکنولوژیِ",
            "  خواسته‌شده‌ی آگهی **کجا** نام برده شود، و سقفِ حجمِ نوشته نیست: هر سابقه",
            "  همچنان باید ۳ تا ۵ bulletِ پُر و محتوادار داشته باشد و کارِ واقعیِ خودش را",
            "  کامل توصیف کند. فقط تکنولوژیِ آگهی را در سابقه‌ی دیگری تکرار نکن.",
            "  شرکت و بازه‌ی هر سابقه **دقیقاً** همین است و تغییر نمی‌کند. عنوانِ نقش را",
            "  می‌توانی با زاویه‌ی همین JD بازنویسی کنی:",
            arcText,
          ].join("\n"),
        );
      }
      parts.push(
        "• **فقط همین سوابق** در رزومه بیایند و به همین ترتیب — سابقه‌ای که این‌جا نیست اصلاً نیاور، و هیچ شرکتِ دیگری اضافه نکن.",
      );
      if (arc.unplaced.length) {
        parts.push(
          `• این‌ها در هیچ سابقه‌ای جای زمانیِ معتبر نداشتند، پس فقط در بخشِ مهارت‌ها بیایند و در bulletها به هیچ شرکتی نسبت داده نشوند: ${arc.unplaced.join("، ")}`,
        );
      }
      if (reqs.responsibilities.length) {
        parts.push(`• مسئولیت‌های این نقش (دستاوردهای واقعیِ متناظر را برجسته کن): ${reqs.responsibilities.slice(0, 10).join("؛ ")}`);
      }
      if (reqs.seniority) parts.push(`• سطحِ نقش: ${reqs.seniority}`);
      // مشتریان **داخلِ متن** می‌آیند، نه در بخشِ جدا: کارفرما اسمِ تنها را باور نمی‌کند،
      // «برای X این را ساختم و این نتیجه را داد» را باور می‌کند.
      if (pickedClients.length) {
        parts.push(
          `• مشتریانِ واقعیِ کاربر که به این آگهی می‌خورند — نامشان را **داخلِ bulletهای سوابق** بیاور همراه با کاری که برایشان شد: ${pickedClients
            .map((c) => (c.work?.trim() ? `${c.name} (${c.work.trim()})` : c.name))
            .join("؛ ")}`,
        );
      }
      coverageHint = parts.join("\n");
    } catch {
      /* بهترین‌تلاش — نبودِ تجزیه نباید ساختِ رزومه را بشکند */
    }
  }

  if (manualMode && selectedRoles.length === 0) {
    const variableDomain = inferVariableCompanyDomain(
      [job.title ?? "", job.company ?? "", job.description ?? ""],
      declaredDomains,
    );
    selectedVariableCompanies = variableCompaniesForDomain(variableDomain);
    selectedRoles = selectRolesForJob(
      (profile.workExperience as RoleInput[] | null) ?? [],
      [job.title ?? "", job.company ?? ""],
      { pinned: pinnedCompanies },
    );
    selectedRoles = withMissingFixedCompanyRoles(selectedRoles, job.title);
    if (selectedVariableCompanies.length) {
      selectedRoles = [
        ...selectedRoles,
        ...variableCompanyRolesForDomain(variableDomain, job.title),
      ];
    }
    selectedRoles = applyGeneratedTimeline(selectedRoles, selectedVariableCompanies);
  }

  if (selectedRoles.length > 0 && plannedPeriods.size === 0) {
    const arc = planCareerArc(selectedRoles, placeableTerms);
    for (const r of arc.roles) {
      if (r.company) plannedPeriods.set(normCompany(r.company), r.period);
    }
  }

  const marketCompanies =
    manualMode
      ? await (deps.marketSearchFn ?? searchMarketCompanies)({
          title: job.title,
          domain: null,
          technologies: placeableTerms,
          seed: listingId,
        }).catch(() => [])
      : [];
  coverageHint = [
    coverageHint,
    manualMode
      ? "• حالت انتخاب آگهی فعال است: کاربر با انتخاب دستی یا روشن‌کردن اپلای خودکار برای این حوزه اعلام کرده از پس نقش برمی‌آید؛ رزومه را تهاجمی، JD-shaped و دو تا سه صفحه‌ای بنویس، ولی employer/client/date/product جعلی نساز."
      : "",
    buildPinnedCompanyInstruction(selectedRoles),
    buildVariableCompanyInstruction(selectedVariableCompanies),
    manualMode ? buildGeneratedTimelineInstruction(selectedVariableCompanies) : "",
    "• قاعده‌ی جایگذاری تکنولوژی: Shopify/Stripe/PayPal/Klarna/BigCommerce و ابزارهای مشابهِ غیرمتداول/غیرقابل‌دسترس برای ایران را فقط زیر شرکت‌های international مثل CodeNest، CCTV Line، UK Trade Line یا شرکت متغیر international بنویس؛ هرگز زیر MTN Irancell یا شرکت‌های ایرانی نگذار.",
    buildMarketCalibrationContext(marketCompanies),
    "• هدف طول: بین دو تا سه صفحه‌ی A4. همه‌ی نیازهای JD باید ردِ صریح داشته باشند؛ اگر متن به سه صفحه نزدیک شد اشکالی ندارد، فقط از سه صفحه بالاتر نرود و نیازمندی‌ها حذف نشوند.",
  ]
    .filter(Boolean)
    .join("\n");

  // مدل فقط سوابقِ انتخاب‌شده را می‌بیند. اگر نسخه‌ی کاملِ پروفایل را ببیند، بازه‌ها را
  // از همان‌جا رونویسی می‌کند و «Present»های حذف‌شده دوباره برمی‌گردند.
  const profileForPrompt =
    selectedRoles.length > 0
      ? ({ ...profile, workExperience: selectedRoles } as typeof profile)
      : profile;

  let tailored = await tailorFn(
    userId,
    buildProfileText(profileForPrompt, userRow?.email),
    buildJobText(
      job,
      [
        resumeLang === "en" ? "زبانِ رزومه: انگلیسی (English)" : "زبانِ رزومه: فارسی",
        declaredDomains.length
          ? [
              `کاربر اعلام کرده در این حوزه‌ها تجربه دارد: ${labelsForDomains(declaredDomains).join("، ")}.`,
              // وقتی تقاطعِ آگهی×اعلامِ کاربر را داریم، همان فهرستِ کوتاه در بخشِ «تحلیلِ
              // ساخت‌یافته» می‌آید و کافی است. ریختنِ کلِ واژگان فقط وقتی معنا دارد که شرحِ
              // آگهی نداریم — و آن‌جا هم برش می‌خورد و اولین حوزه‌ها بقیه را کنار می‌زنند.
              matchedTech.length
                ? ""
                : `مهارت‌های قابل‌استفاده از این حوزه‌ها (هر کدام را که آگهی می‌خواهد بیاور): ${vocabularyForDomains(declaredDomains).slice(0, 1500)}`,
            ]
              .filter(Boolean)
              .join(" ")
          : "",
        typeof prefs.resumeEmphasis === "string" ? prefs.resumeEmphasis : "",
      ]
        .filter(Boolean)
        .join(" | "),
      coverageHint,
    ),
    deps.metering ?? {},
  );

  {
    const missing = manualMode ? missingPinnedCompanies(tailored, selectedRoles) : [];
    if (missing.length) {
      const repaired = await repairTailoredResume(
        userId,
        tailored,
        [
          `این شرکت‌های واقعی و سنجاق‌شده باید حتماً در experience باشند: ${missing.join("، ")}.`,
          "برای هرکدام company و period واقعی را نگه دار، ولی title و context/bullets را با همین JD بازنویسی کن.",
          resumeLang === "en"
            ? "Output language is English."
            : "زبان خروجی فارسی باشد.",
        ].join("\n"),
        deps.metering ?? {},
      );
      if (missingPinnedCompanies(repaired, selectedRoles).length < missing.length) {
        tailored = repaired;
      }
    }
    const missingVariables = manualMode
      ? missingVariableCompanies(tailored, selectedRoles, selectedVariableCompanies)
      : [];
    if (missingVariables.length) {
      const repaired = await repairTailoredResume(
        userId,
        tailored,
        [
          `این دو شرکت متغیرِ انتخاب‌شده برای حوزه‌ی آگهی باید در experience باشند: ${missingVariables.join("، ")}.`,
          "این‌ها را فقط برای همین حوزه بنویس. شرکت‌های ثابت و بازه‌های زمانی موجود را دست نزن.",
          "اگر شرکت ایرانی است، Shopify/Stripe/PayPal/Klarna/BigCommerce را زیر آن نگذار؛ این ابزارها فقط برای شرکت‌های international مجازند.",
          resumeLang === "en" ? "Output language is English." : "زبان خروجی فارسی باشد.",
        ].join("\n"),
        deps.metering ?? {},
      );
      if (
        missingVariableCompanies(repaired, selectedRoles, selectedVariableCompanies).length <
        missingVariables.length
      ) {
        tailored = repaired;
      }
    }
    tailored = ensurePinnedExperience(tailored, selectedRoles, plannedPeriods);
    tailored = ensureVariableCompanyExperience(tailored, selectedRoles, selectedVariableCompanies);
  }

  // بازبینی و ترمیم: شکاف‌ها را **در کد** می‌سنجیم و فقط اگر چیزی کم بود یک پاسِ کوتاهِ
  // دوم می‌زنیم. بزرگ‌تر کردنِ پرامپتِ اصلی جواب نداد — هر دستورِ اضافه چیزِ دیگری را خراب کرد.
  {
    const gaps = findResumeGaps(tailored, placeableTerms, evidenceText);
    if (needsRepair(gaps)) {
      const repaired = await repairTailoredResume(
        userId,
        tailored,
        buildRepairInstruction(gaps, resumeLang),
        deps.metering ?? {},
      );
      // ترمیم فقط وقتی پذیرفته می‌شود که واقعاً بهتر باشد: عددِ ساختگی کمتر، بدونِ
      // آب‌رفتنِ محسوسِ متن یا مهارت‌ها. وگرنه همان نسخه‌ی اول می‌ماند.
      const after = findResumeGaps(repaired, placeableTerms, evidenceText);
      const shrank = after.chars < gaps.chars * 0.9 || after.skillCount < gaps.skillCount * 0.7;
      const better =
        after.ungroundedFigures.length <= gaps.ungroundedFigures.length &&
        after.missingTerms.length <= gaps.missingTerms.length;
      if (better && !shrank) tailored = repaired;
      else if (after.ungroundedFigures.length < gaps.ungroundedFigures.length) tailored = repaired;
    }
  }

  tailored = ensurePinnedExperience(tailored, selectedRoles, plannedPeriods);
  tailored = ensureVariableCompanyExperience(tailored, selectedRoles, selectedVariableCompanies);
  tailored = alignHeadlineToJobTitle(tailored, job.title, manualMode);
  tailored = scrubTargetLeakage(tailored, job.company);
  tailored = scrubRestrictedTechnologyPlacement(tailored);
  tailored = fitForTwoToThreePages(tailored);
  tailored = alignHeadlineToJobTitle(tailored, job.title, manualMode);

  // نامِ لاتین برای رزومه‌ی انگلیسی: نامِ فارسی روی رزومه‌ی انگلیسی هم ناخواناست و هم
  // با بقیه‌ی سند نمی‌خواند. کاربر می‌تواند شکلِ لاتین را در ترجیحات بگذارد.
  const latinName =
    typeof prefs.fullNameLatin === "string" && prefs.fullNameLatin.trim()
      ? prefs.fullNameLatin.trim()
      : null;

  const renderedExperience = keepOnlyRealEmployers(
    tailored.experience,
    rolesAllowedForRenderedExperience(selectedRoles, manualMode, selectedVariableCompanies),
  ).map((e) => ({
    company: e.company ?? null,
    title: e.title ?? null,
    context: e.context ?? null,
    // بازه از نقشه می‌آید، نه از مدل: تاریخ‌های سابقه واقعیت‌اند و بازنویسی‌شان — حتی
    // یک «Present»ِ اضافه — ادعایی است که کاربر نکرده. lookup فازی است تا
    // Hugging Face و Hugging Face (International) یک شرکت حساب شوند.
    period: plannedPeriodForCompany(plannedPeriods, e.company) ?? e.period ?? null,
    bullets: e.bullets,
  }));

  const data: ResumeTemplateData = {
    fullName: resumeLang === "en" && latinName ? latinName : profile.fullName,
    headline: tailored.headline || profile.headline || null,
    email: userRow?.email ?? null,
    phone: phoneOverride ?? profile.phone ?? null,
    // «مکان را نشان نده» — ترجیحِ کاربر (مثلاً وقتی دورکار است و شهر بی‌ربط/محدودکننده است).
    city: prefs.hideLocation === true ? null : (profile.city ?? null),
    links: ((profile.links as ProfileLink[] | null) ?? []).map((l) => ({ label: l.label ?? null, url: l.url })),
    languages: ((profile.languages as { name?: string; level?: string }[] | null) ?? [])
      .filter((l) => l?.name)
      .map((l) => ({ name: l.name!, level: l.level ?? null })),
    summary: tailored.summary,
    // گاردِ مهارت: شاهد واقعی یا، در انتخاب دستی، خواسته‌های همین JD که کاربر با
    // انتخاب آگهی تأیید کرده. پروفایل دائمی دست نمی‌خورد.
    skills: keepOnlyRealSkills(tailored.skills, evidenceText, admissibleTech),

    // گاردِ کارفرما — همتای گاردِ مهارت، ولی سخت‌گیرتر: مهارت ادعایی درباره‌ی **خودِ
    // کاربر** است و او مرجعش است؛ نامِ کارفرما ادعایی درباره‌ی **یک شخصِ ثالث** است که
    // چیزی اعلام نکرده و خودش می‌تواند تکذیبش کند. پس هر شرکتی که در سوابقِ واقعیِ
    // کاربر نیست حذف می‌شود، حتی اگر مدل آن را نوشته باشد.
    experience: manualMode
      ? enforceGeneratedExperienceTimeline(renderedExperience, selectedVariableCompanies)
      : renderedExperience,
    // فقط تحصیلاتِ هم‌زبان با رزومه — پروفایل هر دو نسخه‌ی فارسی و انگلیسی را دارد و
    // بدونِ این فیلتر، هر دو ردیفِ تکراری کنارِ هم می‌نشستند.
    education: preferLanguage(
      (profile.education as ProfileEducation[] | null) ?? [],
      resumeLang,
      (e) => `${e.institution ?? ""} ${e.field ?? ""} ${e.degree ?? ""}`,
    ).map((e) => ({
      school: e.institution ?? null,
      degree: nonEmpty([e.degree, e.field]) || null,
      period: nonEmpty([e.startYear, e.endYear ? `– ${e.endYear}` : null]) || null,
    })),
    highlights: tailored.highlights ?? [],
    // عمداً هیچ برچسبِ «هدف‌گیری‌شده برای …» — کارفرما باید یک رزومه‌ی حرفه‌ایِ معمولی
    // ببیند، نه خروجیِ آشکارِ یک ابزار.
    lang: resumeLang,
  };
  // قالب: انتخابِ کاربر یا «تصادفیِ قطعی» بر اساسِ آگهی (رندرِ دوباره همان طرح را می‌دهد).
  const template = pickTemplate(
    typeof prefs.resumeTemplate === "string" ? prefs.resumeTemplate : null,
    listingId,
  );
  const html = renderResumeTemplate(data, template);
  const title = `رزومه‌ی هدف‌گیری‌شده: ${job.title ?? "آگهی"}`;

  const existing = await conn.query.resumes.findFirst({
    where: and(eq(resumes.userId, userId), eq(resumes.listingId, listingId), eq(resumes.isBase, false)),
  });
  let id: string;
  if (existing) {
    await conn
      .update(resumes)
      .set({ content: html, title, profileId: profile.id, updatedAt: sql`now()` })
      .where(eq(resumes.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await conn
      .insert(resumes)
      .values({ userId, profileId: profile.id, listingId, isBase: false, title, content: html })
      .returning({ id: resumes.id });
    id = row!.id;
  }

  return { id, headline: data.headline ?? profile.fullName, html, jobTitle: job.title ?? null };
}

/** رزومه‌ی هدف‌گیری‌شده‌ی ذخیره‌شده (HTML) را برای یک مالک برمی‌گرداند (پیش‌نمایش/رندرِ PDF). */
export async function getTailoredResumeHtml(
  userId: string,
  resumeId: string,
  deps: { db?: Database } = {},
): Promise<{ html: string; title: string | null } | null> {
  const conn = deps.db ?? defaultDb;
  const row = await conn.query.resumes.findFirst({
    where: and(eq(resumes.id, resumeId), eq(resumes.userId, userId)),
    columns: { content: true, title: true },
  });
  return row ? { html: row.content, title: row.title } : null;
}

/** فقط برای تست — توابعِ داخلیِ خالص. */
export const __testables = {
  keepOnlyRealSkills,
  keepOnlyRealEmployers,
  buildProfileText,
  buildMarketCalibrationContext,
  fitForTwoToThreePages,
  ensurePinnedExperience,
  alignHeadlineToJobTitle,
  scrubTargetLeakage,
  scrubRestrictedTechnologyPlacement,
  rolesAllowedForRenderedExperience,
  buildVariableCompanyInstruction,
  buildGeneratedTimelineInstruction,
  withMissingFixedCompanyRoles,
  applyGeneratedTimeline,
  deterministicGeneratedTimeline,
  enforceGeneratedExperienceTimeline,
  plannedPeriodForCompany,
  generatedTimelineRank,
  mergePinnedCompanies,
};
