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
import { meteredTailorResume } from "@/lib/resume/tailor";
import { renderResumeHtml, type ResumeRenderData } from "@/lib/resume/resume-template";
import { labelsForDomains, vocabularyForDomains } from "@/lib/resume/declared-domains";
import { assessCoverage, extractJobRequirements } from "@/lib/apply/jd-requirements";
import { describeArc, planCareerArc, type RoleInput } from "@/lib/resume/career-arc";
import { DEFAULT_PINNED_COMPANIES, selectRolesForJob } from "@/lib/resume/role-selection";
import { selectClientsForJob, type ClientEntry } from "@/lib/resume/client-selection";
import {
  pickTemplate,
  renderResumeTemplate,
  resumeFileName,
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
      ? `\nتأکیدِ خودِ کاربر (این را در هدف‌گیری رعایت کن): ${userEmphasis.trim().slice(0, 1000)}`
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
  const userSelected = source !== "none";

  let coverageHint = "";
  /** تکنولوژی‌هایی که هم آگهی خواسته و هم کاربر شاهد دارد — همان تقاطعی که مدل باید نام ببرد. */
  let matchedTech: string[] = [];
  /** تکنولوژی‌هایی که با انتخابِ همین آگهی مجاز شده‌اند (فقط وقتی کاربر انتخابش کرده). */
  let admissibleTech: string[] = [];
  /** سوابقی که در همین رزومه می‌آیند (زیرمجموعه‌ای از سوابقِ واقعی). */
  let selectedRoles: RoleInput[] = [];
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
      // با انتخابِ این آگهی، خواسته‌های خودِ آگهی هم قابلِ نام‌بردن می‌شوند.
      if (userSelected) admissibleTech = reqs.technologies;

      // نقشه‌ی پخش: هر تکنولوژی به تازه‌ترین سابقه‌ای که از نظرِ **زمانی** جا دارد.
      // بدونِ این، مدل همه را در یک سابقه تلنبار می‌کند یا در همه تکرار می‌کند — و بدتر،
      // ممکن است ابزارِ ۲۰۲۵ را به شغلِ ۱۳۹۴ بچسباند.
      // کدام سوابق اصلاً در این رزومه بیایند: شرکت‌های سنجاق‌شده‌ی کاربر + مرتبط‌ترین‌ها
      // به همین آگهی، و فقط **یک** شغلِ جاری. حذف آزاد است؛ جایگزینیِ نامِ کارفرما نه.
      const pinnedCompanies = Array.isArray(prefs.pinnedCompanies)
        ? (prefs.pinnedCompanies as unknown[]).filter((v): v is string => typeof v === "string")
        : DEFAULT_PINNED_COMPANIES;
      selectedRoles = selectRolesForJob(
        (profile.workExperience as RoleInput[] | null) ?? [],
        [...reqs.technologies, ...reqs.responsibilities, reqs.domain ?? ""],
        { pinned: pinnedCompanies },
      );
      const arc = planCareerArc(
        selectedRoles,
        userSelected ? reqs.technologies : cov.covered,
      );
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
      if (!userSelected && cov.missing.length) {
        parts.push(`• آگهی این‌ها را هم خواسته ولی کاربر شاهدی ندارد — **نام نبر**: ${cov.missing.join("، ")}`);
      }
      if (arcText) {
        parts.push(
          [
            "• نقشه‌ی پخشِ تکنولوژی روی سوابقِ واقعی — این نقشه فقط می‌گوید هر تکنولوژیِ",
            "  خواسته‌شده‌ی آگهی **کجا** نام برده شود، و سقفِ حجمِ نوشته نیست: هر سابقه",
            "  همچنان باید ۳ تا ۵ bulletِ پُر و محتوادار داشته باشد و کارِ واقعیِ خودش را",
            "  کامل توصیف کند. فقط تکنولوژیِ آگهی را در سابقه‌ی دیگری تکرار نکن.",
            "  شرکت، عنوان و بازه‌ی هر سابقه **دقیقاً** همین است و تغییر نمی‌کند:",
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
      coverageHint = parts.join("\n");
    } catch {
      /* بهترین‌تلاش — نبودِ تجزیه نباید ساختِ رزومه را بشکند */
    }
  }

  // مدل فقط سوابقِ انتخاب‌شده را می‌بیند. اگر نسخه‌ی کاملِ پروفایل را ببیند، بازه‌ها را
  // از همان‌جا رونویسی می‌کند و «Present»های حذف‌شده دوباره برمی‌گردند.
  const profileForPrompt =
    selectedRoles.length > 0
      ? ({ ...profile, workExperience: selectedRoles } as typeof profile)
      : profile;

  const tailored = await tailorFn(
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

  const data: ResumeTemplateData = {
    fullName: profile.fullName,
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
    // گاردِ ضدِجعل: فقط مهارت‌هایی که واقعاً در پروفایل هست.
    skills: keepOnlyRealSkills(tailored.skills, evidenceText, admissibleTech),
    // نام‌ها مستقیم از فهرستِ خودِ کاربر می‌آیند و اصلاً از مدل عبور نمی‌کنند.
    clients: pickedClients.map((c) => ({ name: c.name, work: c.work ?? null })),
    // گاردِ کارفرما — همتای گاردِ مهارت، ولی سخت‌گیرتر: مهارت ادعایی درباره‌ی **خودِ
    // کاربر** است و او مرجعش است؛ نامِ کارفرما ادعایی درباره‌ی **یک شخصِ ثالث** است که
    // چیزی اعلام نکرده و خودش می‌تواند تکذیبش کند. پس هر شرکتی که در سوابقِ واقعیِ
    // کاربر نیست حذف می‌شود، حتی اگر مدل آن را نوشته باشد.
    experience: keepOnlyRealEmployers(tailored.experience, selectedRoles).map((e) => ({
      company: e.company ?? null,
      title: e.title ?? null,
      // بازه از نقشه می‌آید، نه از مدل: تاریخ‌های سابقه واقعیت‌اند و بازنویسی‌شان — حتی
      // یک «Present»ِ اضافه — ادعایی است که کاربر نکرده.
      period: (e.company ? plannedPeriods.get(normCompany(e.company)) : null) ?? e.period ?? null,
      bullets: e.bullets,
    })),
    education: ((profile.education as ProfileEducation[] | null) ?? []).map((e) => ({
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
export const __testables = { keepOnlyRealSkills, keepOnlyRealEmployers, buildProfileText };
