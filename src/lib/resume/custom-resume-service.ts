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
import {
  pickTemplate,
  renderResumeTemplate,
  resumeFileName,
  type ResumeLang,
  type ResumeTemplateData,
} from "@/lib/resume/resume-templates";

export interface GenerateDeps {
  db?: Database;
  metering?: MeteringOptions;
  /** تزریق برای تست — پیش‌فرض meteredTailorResume. */
  tailorFn?: typeof meteredTailorResume;
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
 */
function keepOnlyRealSkills(aiSkills: string[], evidence: string): string[] {
  const norm = (v: string) => v.toLowerCase().replace(/[\s._-]+/g, "");
  const hay = norm(evidence);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const s of aiSkills) {
    const key = norm(s);
    if (!key || seen.has(key)) continue;
    if (!hay.includes(key)) continue; // جایی در دادهٔ واقعیِ کاربر شاهدی ندارد → حذف
    seen.add(key);
    kept.push(s); // ترتیب/نگارشِ هدف‌گیری‌شده‌ی AI حفظ می‌شود
  }
  return kept;
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
  if (!job.description && job.board === "jobinja" && job.url) {
    try {
      const { fetchJobDescription } = await import("@/lib/apply/boards/jobinja");
      const description = await fetchJobDescription(job.url);
      if (description) {
        await conn
          .update(jobListings)
          .set({ description, updatedAt: new Date() })
          .where(eq(jobListings.id, listingId));
        job = { ...job, description };
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
  let coverageHint = "";
  /** تکنولوژی‌هایی که هم آگهی خواسته و هم کاربر شاهد دارد — همان تقاطعی که مدل باید نام ببرد. */
  let matchedTech: string[] = [];
  if (job.description) {
    try {
      const reqs = await extractJobRequirements(userId, `${job.title}\n${job.description}`, deps.metering ?? {});
      // فقط تکنولوژی‌ها سنجیده می‌شوند: آن‌ها نامِ مشخص‌اند و تطبیقِ رشته‌ای معنا دارد.
      // الزاماتِ نثری («تجربه‌ی کار در استارتاپِ پرسرعت») هیچ‌وقت زیررشته‌ای تطبیق نمی‌خورند
      // و فقط سیگنال را خراب می‌کنند؛ آن‌ها را مستقیم به مدل می‌دهیم تا خودش قضاوت کند.
      const cov = assessCoverage(reqs.technologies, evidenceText);
      matchedTech = cov.covered;
      const parts: string[] = [];
      if (cov.covered.length) {
        parts.push(
          `• تکنولوژی‌هایی که این آگهی خواسته و کاربر برایشان شاهد دارد (از رزومه یا از حوزه‌های اعلامیِ خودش). **هر کدام باید جایی در رزومه صریح نام برده شود** — در مهارت‌ها و دستِ‌کم یکی در bulletهای سوابق: ${cov.covered.join("، ")}`,
        );
      }
      if (cov.missing.length) {
        parts.push(`• آگهی این‌ها را هم خواسته ولی کاربر شاهدی ندارد — **نام نبر**: ${cov.missing.join("، ")}`);
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

  const tailored = await tailorFn(
    userId,
    buildProfileText(profile, userRow?.email),
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
    skills: keepOnlyRealSkills(tailored.skills, evidenceText),
    experience: tailored.experience.map((e) => ({
      company: e.company ?? null,
      title: e.title ?? null,
      period: e.period ?? null,
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
export const __testables = { keepOnlyRealSkills, buildProfileText };
