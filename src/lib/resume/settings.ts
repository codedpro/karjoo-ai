import "server-only";

import { eq, sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { candidateProfiles } from "@/db/schema";
import { SKILL_DOMAINS } from "@/lib/resume/declared-domains";
import type { ResumeSettingsSaveBody } from "@/lib/resume/api-schemas";
import { DEFAULT_PROFILE_NAME } from "@/lib/resume/profile-service";

export const BROAD_MATCHING_SECTIONS = [
  { id: "software", label: "نرم‌افزار و فناوری" },
  { id: "seo-digital-marketing", label: "سئو و بازاریابی دیجیتال" },
  { id: "marketing-sales", label: "بازاریابی و فروش" },
] as const;

export type ResumeSettings = ResumeSettingsSaveBody;

const DOMAIN_IDS = new Set(SKILL_DOMAINS.map((domain) => domain.id));
const SECTION_IDS = new Set(BROAD_MATCHING_SECTIONS.map((section) => section.id));
const TEMPLATE_IDS = new Set(["classic", "modern", "compact", "signature"]);

const DEFAULT_SETTINGS: ResumeSettings = {
  gender: "unspecified",
  fullNameLatin: "",
  resumePhone: "",
  resumeLang: "fa",
  resumeTemplate: "classic",
  hideLocation: false,
  broadMatchingMode: false,
  broadMatchingSections: [],
  declaredDomains: [],
  resumeEmphasis: "",
  clients: [],
  unlimitedApply: false,
};

function cleanStrings(value: unknown, allowed?: ReadonlySet<string>, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.trim();
    if (!clean || seen.has(clean) || (allowed && !allowed.has(clean))) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function clientNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return cleanStrings(
    value.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return (item as Record<string, unknown>).name;
      return undefined;
    }),
  );
}

export function parseResumeSettings(
  raw: Record<string, unknown> | null | undefined,
): ResumeSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const gender = ["male", "female", "unspecified"].includes(String(raw.gender))
    ? (raw.gender as ResumeSettings["gender"])
    : "unspecified";
  const resumeLang = raw.resumeLang === "en" ? "en" : "fa";
  const resumeTemplate = TEMPLATE_IDS.has(String(raw.resumeTemplate))
    ? (raw.resumeTemplate as ResumeSettings["resumeTemplate"])
    : "classic";
  return {
    gender,
    fullNameLatin: text(raw.fullNameLatin),
    resumePhone: text(raw.resumePhone),
    resumeLang,
    resumeTemplate,
    hideLocation: raw.hideLocation === true,
    broadMatchingMode: raw.broadMatchingMode === true,
    broadMatchingSections: cleanStrings(raw.broadMatchingSections, SECTION_IDS, 3) as ResumeSettings["broadMatchingSections"],
    declaredDomains: cleanStrings(raw.declaredDomains, DOMAIN_IDS, 30),
    resumeEmphasis: text(raw.resumeEmphasis),
    clients: clientNames(raw.clients),
    unlimitedApply: raw.unlimitedApply === true,
  };
}

/** Preference fragment owned by this editor. Null removes an optional text key. */
export function resumeSettingsPatch(settings: ResumeSettings): Record<string, unknown> {
  return {
    gender: settings.gender,
    fullNameLatin: settings.fullNameLatin.trim() || null,
    resumePhone: settings.resumePhone.trim() || null,
    resumeLang: settings.resumeLang,
    resumeTemplate: settings.resumeTemplate,
    hideLocation: settings.hideLocation,
    broadMatchingMode: settings.broadMatchingMode,
    broadMatchingSections: cleanStrings(settings.broadMatchingSections, SECTION_IDS, 3),
    declaredDomains: cleanStrings(settings.declaredDomains, DOMAIN_IDS, 30),
    resumeEmphasis: settings.resumeEmphasis.trim() || null,
    clients: cleanStrings(settings.clients).map((name) => ({ name })),
    unlimitedApply: settings.unlimitedApply,
  };
}

type SettingsDb = Pick<typeof defaultDb, "select" | "update" | "insert">;

export async function readResumeSettings(
  userId: string,
  conn: SettingsDb = defaultDb,
): Promise<ResumeSettings> {
  const [row] = await conn
    .select({ preferences: candidateProfiles.preferences })
    .from(candidateProfiles)
    .where(eq(candidateProfiles.userId, userId))
    .limit(1);
  return parseResumeSettings(row?.preferences ?? null);
}

export async function writeResumeSettings(
  userId: string,
  settings: ResumeSettings,
  opts: { db?: SettingsDb; fallbackFullName?: string } = {},
): Promise<ResumeSettings> {
  const conn = opts.db ?? defaultDb;
  const patch = resumeSettingsPatch(settings);
  const encoded = JSON.stringify(patch);
  const preferences = sql<Record<string, unknown>>`
    jsonb_strip_nulls(coalesce(${candidateProfiles.preferences}, '{}'::jsonb) || ${encoded}::jsonb)
  `;

  const [updated] = await conn
    .update(candidateProfiles)
    .set({ preferences, updatedAt: sql`now()` })
    .where(eq(candidateProfiles.userId, userId))
    .returning({ preferences: candidateProfiles.preferences });
  if (updated) return parseResumeSettings(updated.preferences);

  const [created] = await conn
    .insert(candidateProfiles)
    .values({
      userId,
      fullName: opts.fallbackFullName?.trim() || DEFAULT_PROFILE_NAME,
      preferences: patch,
    })
    .onConflictDoUpdate({
      target: candidateProfiles.userId,
      set: { preferences, updatedAt: sql`now()` },
    })
    .returning({ preferences: candidateProfiles.preferences });
  return parseResumeSettings(created?.preferences ?? patch);
}
