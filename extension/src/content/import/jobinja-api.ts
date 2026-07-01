/**
 * Jobinja CV reader via Jobinja's OWN internal API.
 *
 * WHY: /app/cv-builder is a JavaScript app — its DOM is empty before hydration, so
 * scraping the raw HTML finds nothing. The reliable source is the same API the page
 * itself calls: GET /api/v10/resume + /api/v10/jobseeker-app/cv-builder/{id}/{...}.
 * The content script runs SAME-ORIGIN on jobinja.ir, so the user's own session
 * cookies ride automatically (credentials:"include") — we never read or forward a
 * cookie/token (RULE 1, docs §10); we only read profile DATA out of the JSON.
 *
 * The exact JSON field names differ across Jobinja versions, so every read is
 * TOLERANT (tries several plausible keys) and returns null when nothing is found,
 * letting the caller fall back to DOM scraping.
 */
import type {
  ScrapedProfile,
  ScrapedEducation,
  ScrapedExperience,
} from "@ext/lib/import-types";

const BASE = "https://jobinja.ir/api/v10";

/** A parsed JSON value we treat structurally (no `any`). */
type Json = unknown;

async function getJson(path: string): Promise<Json> {
  try {
    const res = await fetch(BASE + path, {
      credentials: "include",
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    });
    if (!res.ok) return null;
    return (await res.json()) as Json;
  } catch {
    return null;
  }
}

function rec(x: Json): Record<string, Json> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, Json>) : null;
}

/** First defined, non-empty value among the candidate keys. */
function pick(x: Json, ...keys: string[]): Json {
  const o = rec(x);
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Unwrap {data:[…]} | {result:[…]} | {data:{…}} | […] | {…} into its payload. */
function unwrap(x: Json): Json {
  const o = rec(x);
  if (o) {
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.result)) return o.result;
    if (o.data !== undefined) return o.data;
  }
  return x;
}

function asArray(x: Json): Json[] {
  const u = unwrap(x);
  if (Array.isArray(u)) return u;
  return u === undefined || u === null ? [] : [u];
}

function str(v: Json): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/**
 * Read the user's OWN Jobinja CV. Returns a ScrapedProfile with whatever fields it
 * could extract, or null if the API is unreachable / returned nothing usable.
 */
export async function scrapeJobinjaViaApi(): Promise<ScrapedProfile | null> {
  const resume = await getJson("/resume");
  if (resume === null) return null;
  const rd = unwrap(resume);

  const cvId =
    str(pick(rd, "id", "cv_id", "cvId", "resume_id")) ??
    str(pick(resume, "id", "cv_id", "cvId"));
  const cvb = cvId ? `/jobseeker-app/cv-builder/${cvId}` : null;

  const [personalR, aboutR, skillsR, expR, eduR] = await Promise.all([
    cvb ? getJson(`${cvb}/personal`) : getJson("/resume/fa/personal-info"),
    cvb ? getJson(`${cvb}/about`) : Promise.resolve(null),
    cvb ? getJson(`${cvb}/skills`) : Promise.resolve(null),
    cvb ? getJson(`${cvb}/experience`) : Promise.resolve(null),
    cvb ? getJson(`${cvb}/education`) : Promise.resolve(null),
  ]);

  const personal = unwrap(personalR) ?? rd;
  const about = unwrap(aboutR);

  const fullName =
    str(pick(personal, "full_name", "fullName", "name", "display_name")) ??
    str(pick(rd, "full_name", "name"));
  const headline = str(pick(personal, "job_title", "jobTitle", "headline", "title", "position"));
  const city = str(pick(personal, "city", "location", "province", "residence_city"));
  const resumeText =
    str(pick(about, "body", "text", "summary", "about", "description")) ??
    str(pick(personal, "about", "summary", "bio"));

  const skills = asArray(skillsR)
    .map((s) => str(pick(s, "title", "name", "skill", "label")) ?? str(s))
    .filter((x): x is string => !!x);

  const experience: ScrapedExperience[] = asArray(expR)
    .map((e) => ({
      title: str(pick(e, "job_title", "jobTitle", "title", "position", "role")),
      company: str(pick(e, "company_name", "companyName", "company", "organization")),
      duration:
        str(pick(e, "duration")) ??
        ([str(pick(e, "start_date", "startDate", "from")), str(pick(e, "end_date", "endDate", "to"))]
          .filter(Boolean)
          .join(" - ") || undefined),
    }))
    .filter((e) => e.title || e.company);

  const education: ScrapedEducation[] = asArray(eduR)
    .map((e) => ({
      degree: str(pick(e, "degree", "level", "grade")),
      field: str(pick(e, "field", "major", "field_of_study")),
      institution: str(pick(e, "institution", "university", "school", "college")),
      year: str(pick(e, "year", "graduation_year", "end_date", "endDate")),
    }))
    .filter((e) => e.degree || e.field || e.institution);

  const profile: ScrapedProfile = {};
  if (fullName) profile.fullName = fullName;
  if (headline) profile.headline = headline;
  if (city) profile.city = city;
  if (resumeText) profile.resumeText = resumeText;
  if (skills.length) profile.skills = skills;
  if (experience.length) profile.experience = experience;
  if (education.length) profile.education = education;

  return Object.keys(profile).length > 0 ? profile : null;
}
