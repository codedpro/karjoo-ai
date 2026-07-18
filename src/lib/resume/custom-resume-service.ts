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

function buildJobText(j: typeof jobListings.$inferSelect): string {
  return nonEmpty([
    j.title ? `عنوان: ${j.title}` : null,
    j.company ? `شرکت: ${j.company}` : null,
    j.description ? `\nشرح: ${j.description.slice(0, 6000)}` : null,
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
  const job = await conn.query.jobListings.findFirst({ where: eq(jobListings.id, listingId) });
  if (!job) throw new HttpError(404, "listing not found");
  const userRow = await conn.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true },
  });

  const tailored = await tailorFn(
    userId,
    buildProfileText(profile, userRow?.email),
    buildJobText(job),
    deps.metering ?? {},
  );

  const data: ResumeRenderData = {
    fullName: profile.fullName,
    headline: tailored.headline || profile.headline || null,
    email: userRow?.email ?? null,
    phone: profile.phone ?? null,
    city: profile.city ?? null,
    links: ((profile.links as ProfileLink[] | null) ?? []).map((l) => ({ label: l.label ?? null, url: l.url })),
    summary: tailored.summary,
    skills: tailored.skills,
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
    targetLabel: job.title ?? null,
  };
  const html = renderResumeHtml(data);
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
