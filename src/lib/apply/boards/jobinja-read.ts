import "server-only";

/**
 * Jobinja authenticated READS (analytics + profile) — server-side, via the user's
 * VAULTED session. Zero account risk: only GETs the pages the user could open by hand
 * (/jobs/applied, /app/cv-builder). Parsers are tolerant regex (no external dep), mirroring
 * boards/jobinja.ts. The extension can also PUSH the same parsed shapes (same-origin read),
 * which is the primary path; this server sync is the fallback ("both", per the owner decision).
 */
import { and, eq, sql } from "drizzle-orm";

import { db as defaultDb, type Database } from "@/db";
import { boardApplications, boardProfileSnapshots } from "@/db/schema";
import { readSessionBlob } from "@/lib/vault/store";
import { decryptSession } from "@/lib/vault/crypto";
import { sessionBundleSchema } from "@/lib/api/session-schemas";
import { KARJOO_USER_AGENT } from "@/lib/apply/robots";

const ORIGIN = "https://jobinja.ir";

/**
 * بیشینه‌ی صفحه‌های «درخواست‌های من» که در هر همگام‌سازی خوانده می‌شود (۲۵ ردیف در هر
 * صفحه ⇒ تا ۵۰۰ درخواست). سقف است تا یک صفحه‌بندیِ خراب، همگام‌سازی را بی‌انتها نکند.
 */
const MAX_APPLIED_PAGES = 20;
const REQUEST_TIMEOUT_MS = 20_000;

/** دسته‌ی نرمال‌شده‌ی وضعیت. */
export type ApplicationStatusCategory =
  | "pending"
  | "review"
  | "interview"
  | "hired"
  | "rejected"
  | "other";

/** یک ردیفِ درخواستِ اپلایِ پارس‌شده (ورودیِ ingest — از سرور یا افزونه). */
export interface ParsedApplication {
  externalId: string;
  title?: string | null;
  company?: string | null;
  url?: string | null;
  statusRaw?: string | null;
  statusCategory: ApplicationStatusCategory;
}

/** نگاشتِ پروفایلِ پارس‌شده (نمایش «پروفایلِ جابینجای شما»). */
export interface ParsedProfile {
  fullName?: string | null;
  headline?: string | null;
  about?: string | null;
  skills?: string[];
  email?: string | null;
  phone?: string | null;
  province?: string | null;
  city?: string | null;
  publicUrl?: string | null;
  [k: string]: unknown;
}

/* ─────────────────────────────  status normalizer  ─────────────────────── */

/** متنِ فارسیِ وضعیت را به دسته‌ی نرمال‌شده می‌نگارد. */
/**
 * کلیدهای ماشین‌خوانِ خودِ جابینجا → دسته‌بندیِ قیفِ ما.
 *
 * این‌ها از `init-state.statuses` گرفته شده‌اند (منبعِ خودِ سایت)، نه حدس:
 *   sent(ارسال به کارفرما) · reviewed(بررسی‌شده) · interview_accepted(مصاحبه) ·
 *   hired(استخدام‌شده) · others(سایر) · pending(در انتظار بررسی کارفرما)
 *
 * چرا لازم بود: پیش‌تر `machine_status` (کلیدِ **انگلیسی**) به الگوهای **فارسی** داده
 * می‌شد، پس هیچ‌کدام تطبیق نمی‌خورد و ۲۹۵ از ۴۶۴ درخواست در «سایر» می‌افتاد — یعنی قیف
 * عملاً بی‌معنا بود.
 */
const JOBINJA_MACHINE_STATUS: Record<string, ApplicationStatusCategory> = {
  pending: "pending",
  sent: "pending",
  new: "pending",
  reviewed: "review",
  seen: "review",
  viewed: "review",
  interview_accepted: "interview",
  interview: "interview",
  hired: "hired",
  rejected: "rejected",
  declined: "rejected",
  archived: "rejected",
  others: "other",
};

export function normalizeApplicationStatus(raw: string | null | undefined): ApplicationStatusCategory {
  const s = (raw ?? "").trim();
  if (!s) return "pending";

  // ۱) کلیدِ ماشین‌خوانِ جابینجا (دقیق‌ترین منبع).
  const machine = JOBINJA_MACHINE_STATUS[s.toLowerCase()];
  if (machine) return machine;

  // ۲) متنِ فارسی (نمایشی) — نیم‌فاصله را حذف می‌کنیم تا «بررسی‌شده»/«رد‌شده» هم بگیرند.
  const fa = s.replace(/\u200c/g, "");
  if (/استخدام\s*شده/.test(fa)) return "hired";
  if (/مصاحبه|دعوت/.test(fa)) return "interview";
  if (/رد|بایگان|عدم|منفی|لغو/.test(fa)) return "rejected";
  if (/بررسی|دیده|مشاهده|بازبین/.test(fa)) return "review";
  if (/انتظار|جدید|ارسال|ثبت|new|pending/i.test(fa)) return "pending";
  return "other";
}

/* ─────────────────────  تاریخِ شمسیِ جابینجا → Date  ────────────────────── */

const FA_MONTHS: Record<string, number> = {
  فروردین: 1, اردیبهشت: 2, خرداد: 3, تیر: 4, مرداد: 5, امرداد: 5, شهریور: 6,
  مهر: 7, آبان: 8, آذر: 9, دی: 10, بهمن: 11, اسفند: 12,
};

/** ارقامِ فارسی/عربی → لاتین. */
function faDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = "۰۱۲۳۴۵۶۷۸۹".indexOf(d);
    return String(fa >= 0 ? fa : "٠١٢٣٤٥٦٧٨٩".indexOf(d));
  });
}

/** جلالی → میلادی (الگوریتمِ استانداردِ تبدیل). */
function jalaliToGregorian(jy: number, jm: number, jd: number): Date {
  let gy = jy > 979 ? 1600 : 621;
  const y = jy > 979 ? jy - 979 : jy;
  let days =
    365 * y + Math.floor(y / 33) * 8 + Math.floor(((y % 33) + 3) / 4) + 78 + jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  gy += 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const md = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > md[gm]!; gm += 1) gd -= md[gm]!;
  return new Date(Date.UTC(gy, gm - 1, gd));
}

/**
 * تاریخِ نمایشیِ جابینجا («۱۷ امرداد ۱۴۰۵») → Date واقعی.
 *
 * جابینجا تاریخ را **رشته‌ی شمسیِ فارسی** می‌دهد، نه ISO. بدونِ تبدیل، مرتب‌سازی و
 * «چند وقت پیش» در داشبورد بی‌معنا می‌شد (تاریخ‌ها اصلاً پارس نمی‌شدند).
 */
export function parseJalaliDate(input: string | null | undefined): Date | null {
  const s = faDigits((input ?? "").trim());
  if (!s) return null;
  const m = /^(\d{1,2})\s+([^\s\d]+)\s+(\d{4})$/.exec(s);
  if (!m) return null;
  const day = Number(m[1]);
  const month = FA_MONTHS[m[2]!.replace(/\u200c/g, "")];
  const year = Number(m[3]);
  if (!month || !day || !year) return null;
  try {
    return jalaliToGregorian(year, month, day);
  } catch {
    return null;
  }
}

/* ─────────────────────────────  html helpers  ─────────────────────────── */

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&zwnj;/g, "‌")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * مقدارِ یک صفتِ HTML را برای **JSON** باز می‌کند.
 *
 * جدا از `decode` است چون آن یکی متن‌گراست: تگ‌ها را حذف و فاصله‌ها را جمع می‌کند و
 * `&quot;` را هم نمی‌شناسد — یعنی روی JSON هم بی‌اثر است و هم مخرب. این‌جا فقط موجودیت‌های
 * XMLِ لازم باز می‌شوند و بقیه‌ی نویسه‌ها دست‌نخورده می‌مانند تا JSON.parse موفق شود.
 */
function decodeAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // آخر: تا &amp;quot; دوباره‌رمزگشایی نشود
}

/* ────────────────────────  /jobs/applied  (analytics)  ─────────────────── */

/**
 * درخواست‌های کاربر را از صفحه‌ی «درخواست‌های من» بیرون می‌کشد.
 *
 * **مسیرِ اصلی: JSONِ جاسازی‌شده.** این صفحه دیگر لیست را در HTML رندر نمی‌کند — یک اپِ
 * Vue است که فقط قالب (`{{ application.job.title }}`) را می‌فرستد و داده را در صفتِ
 * `init-state` (JSONِ HTML-escape‌شده) می‌گذارد. پس اسکرپِ مارک‌آپ همیشه صفر برمی‌گرداند
 * (زنده تأیید شد ۱۴۰۵/۰۵/۱۷: ۰ درخواست با وجودِ ورودِ موفق). خواندنِ همان JSON هم دقیق‌تر
 * است و هم شامل `machine_status` و تاریخ.
 *
 * اگر `init-state` نبود، به اسکرپِ قدیمی برمی‌گردیم (برای طرح‌بندی‌های قدیمی/تستِ فیکسچر).
 */
export function parseAppliedJobs(html: string): ParsedApplication[] {
  const fromState = parseAppliedFromInitState(html);
  if (fromState.length > 0) return fromState;
  return parseAppliedFromMarkup(html);
}

/** صفحه‌بندیِ درخواست‌ها در `init-state.applications`. */
export interface AppliedPageInfo {
  currentPage: number;
  lastPage: number;
}

/** صفحه‌بندیِ صفحه‌ی «درخواست‌های من» را می‌خواند (برای پیمایشِ همه‌ی صفحه‌ها). */
export function parseAppliedPageInfo(html: string): AppliedPageInfo | null {
  const raw = /init-state="([^"]+)"/.exec(html)?.[1];
  if (!raw) return null;
  try {
    const st = JSON.parse(decodeAttr(raw)) as {
      applications?: { current_page?: number; last_page?: number };
    };
    const cur = Number(st.applications?.current_page ?? 0);
    const last = Number(st.applications?.last_page ?? 0);
    if (!Number.isFinite(cur) || !Number.isFinite(last) || last < 1) return null;
    return { currentPage: cur || 1, lastPage: last };
  } catch {
    return null;
  }
}

/** شکلِ کمینه‌ی هر ردیفِ درخواست در `init-state.applications.data[]`. */
interface InitStateApplication {
  short_id?: string;
  status?: string;
  machine_status?: string;
  created_at?: string;
  job_link?: string;
  details_link?: string;
  job?: { title?: string; company?: { name?: string } | null };
}

/** JSONِ `init-state` را می‌خواند و به ParsedApplication نگاشت می‌کند. */
export function parseAppliedFromInitState(html: string): ParsedApplication[] {
  const raw = /init-state="([^"]+)"/.exec(html)?.[1];
  if (!raw) return [];
  let state: { applications?: { data?: InitStateApplication[] } };
  try {
    state = JSON.parse(decodeAttr(raw)) as typeof state;
  } catch {
    return [];
  }
  const rows = state.applications?.data;
  if (!Array.isArray(rows)) return [];

  const out: ParsedApplication[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = typeof r?.short_id === "string" ? r.short_id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // machine_status ماشین‌خوان است و بر متنِ فارسی اولویت دارد؛ متن fallback می‌ماند.
    const statusRaw = r.status?.trim() || r.machine_status?.trim() || null;
    out.push({
      externalId: id,
      title: r.job?.title?.trim() || null,
      company: r.job?.company?.name?.trim() || null,
      url: r.job_link?.trim() || r.details_link?.trim() || `${ORIGIN}/jobs/applied/${id}`,
      statusRaw,
      statusCategory: normalizeApplicationStatus(r.machine_status ?? r.status ?? null),
    });
  }
  return out;
}

/** اسکرپِ قدیمیِ مارک‌آپ — فقط fallback. */
function parseAppliedFromMarkup(html: string): ParsedApplication[] {
  const out: ParsedApplication[] = [];
  const seen = new Set<string>();
  // هر بلوکِ آیتم را حولِ یک لینکِ /jobs/applied/{id} برش می‌زنیم.
  const linkRe = /\/jobs\/applied\/([A-Za-z0-9]+)/g;
  const positions: { id: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) positions.push({ id: m[1]!, idx: m.index });

  for (let i = 0; i < positions.length; i += 1) {
    const { id, idx } = positions[i]!;
    if (seen.has(id)) continue;
    seen.add(id);
    // پنجره‌ی *روبه‌جلو* از این لینک تا لینکِ آیتمِ بعدی (یا ۲۰۰۰ نویسه) — محتوای همین آیتم.
    // (نگاهِ روبه‌عقب وضعیتِ آیتمِ قبلی را نشت می‌داد.)
    const end = i + 1 < positions.length ? positions[i + 1]!.idx : Math.min(html.length, idx + 2000);
    const block = html.slice(idx, end);
    const title =
      matchGroup(/>([\s\S]{1,140}?)<\/a>/, block) ??
      matchGroup(/class="[^"]*(?:c-jobListView__titleLink|o-listView__title)[^"]*"[^>]*>([\s\S]{0,120}?)</, block) ??
      matchGroup(/<h[23][^>]*>([\s\S]{0,120}?)</, block);
    const company =
      matchGroup(/class="[^"]*(?:c-jobListView__meta|o-listView__meta|company)[^"]*"[^>]*>([\s\S]{0,80}?)</, block);
    const statusRaw =
      matchGroup(/class="[^"]*job-status[^"]*"[^>]*>([\s\S]{0,60}?)</, block) ??
      matchGroup(/class="[^"]*c-jobOverview__label[^"]*"[^>]*>([\s\S]{0,60}?)</, block) ??
      firstStatusKeyword(block);
    out.push({
      externalId: id,
      title: title ? decode(title) : null,
      company: company ? decode(company) : null,
      url: `${ORIGIN}/jobs/applied/${id}`,
      statusRaw: statusRaw ? decode(statusRaw) : null,
      statusCategory: normalizeApplicationStatus(statusRaw),
    });
  }
  return out;
}

function matchGroup(re: RegExp, s: string): string | null {
  const m = re.exec(s);
  const g = m?.[1]?.trim();
  return g && g.length ? g : null;
}

function firstStatusKeyword(block: string): string | null {
  const kw = ["مصاحبه", "در انتظار", "بررسی", "دیده شده", "رد شده", "بایگانی", "جدید", "دعوت"];
  const text = decode(block);
  for (const w of kw) if (text.includes(w)) return w;
  return null;
}

/* ────────────────────────  /app/cv-builder  (profile)  ─────────────────── */

/**
 * پروفایلِ رندرِ سرورِ cv-builder را best-effort پارس می‌کند (نام/عنوان از SSR). داده‌ی کامل
 * (مهارت‌ها/درباره) اغلب پس از hydration می‌آید؛ آن مسیر با push افزونه پوشش داده می‌شود.
 */
export function parseJobinjaProfileFromHtml(html: string): ParsedProfile {
  const title = matchGroup(/<title>([^<]*)<\/title>/, html) ?? "";
  // «ویرایش رزومه‌‌ی {name} | جابینجا»
  const nameFromTitle = matchGroup(/رزومه[‌\s]*ی\s+([^|<]+?)\s*(?:\||$)/, title);
  const email = matchGroup(/[\w.+-]+@[\w-]+\.[\w.-]+/, decode(html));
  const publicSlug = matchGroup(/\/profile\/([A-Za-z0-9]+)/, html);
  return {
    fullName: nameFromTitle ? decode(nameFromTitle) : null,
    email: email ?? null,
    publicUrl: publicSlug ? `${ORIGIN}/profile/${publicSlug}` : null,
  };
}

/* ─────────────────────────  authenticated fetch  ───────────────────────── */

/** رشته‌ی هدرِ Cookie را از bundleِ نشست می‌سازد. */
export function cookieHeaderFromBundle(bundleJson: string): string {
  const parsed = sessionBundleSchema.safeParse(JSON.parse(bundleJson));
  if (!parsed.success) return "";
  const cookies = parsed.data.cookies ?? [];
  return cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; ");
}

async function fetchWithCookies(path: string, cookieHeader: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ORIGIN}${path}`, {
      headers: {
        "User-Agent": KARJOO_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "fa-IR,fa;q=0.9,en;q=0.8",
        Cookie: cookieHeader,
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────────  ingest / store  ────────────────────────── */

export interface JobinjaReadDeps {
  db?: Database;
}

/** درخواست‌های اپلای را upsert می‌کند (کلیدِ dedupe: user×board×externalId). */
export async function upsertApplications(
  userId: string,
  board: string,
  apps: ParsedApplication[],
  deps: JobinjaReadDeps = {},
): Promise<number> {
  const conn = deps.db ?? defaultDb;
  let n = 0;
  for (const a of apps) {
    if (!a.externalId) continue;
    await conn
      .insert(boardApplications)
      .values({
        userId,
        board,
        externalId: a.externalId,
        title: a.title ?? null,
        company: a.company ?? null,
        url: a.url ?? null,
        statusRaw: a.statusRaw ?? null,
        statusCategory: a.statusCategory,
        lastSeenAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [boardApplications.userId, boardApplications.board, boardApplications.externalId],
        set: {
          title: sql`coalesce(excluded.title, ${boardApplications.title})`,
          company: sql`coalesce(excluded.company, ${boardApplications.company})`,
          url: sql`coalesce(excluded.url, ${boardApplications.url})`,
          statusRaw: sql`excluded.status_raw`,
          statusCategory: sql`excluded.status_category`,
          lastSeenAt: sql`now()`,
        },
      });
    n += 1;
  }
  return n;
}

/** عکس‌برداریِ پروفایل را upsert می‌کند (یک ردیف به‌ازای user×board). */
export async function upsertProfileSnapshot(
  userId: string,
  board: string,
  data: ParsedProfile,
  deps: JobinjaReadDeps = {},
): Promise<void> {
  const conn = deps.db ?? defaultDb;
  const publicUrl = typeof data.publicUrl === "string" ? data.publicUrl : null;
  await conn
    .insert(boardProfileSnapshots)
    .values({ userId, board, data, publicUrl, fetchedAt: sql`now()` })
    .onConflictDoUpdate({
      target: [boardProfileSnapshots.userId, boardProfileSnapshots.board],
      set: { data, publicUrl, fetchedAt: sql`now()` },
    });
}

/* ────────────────────────  server-vault sync (fallback)  ───────────────── */

export interface SyncResult {
  ok: boolean;
  reason?: string;
  applications: number;
  profile: boolean;
}

/**
 * fallbackِ سمتِ سرور: نشستِ vaultِ کاربر را باز می‌کند، /jobs/applied و /app/cv-builder را
 * می‌گیرد، پارس و upsert می‌کند. اگر نشستی نبود/منقضی بود → ok:false (fail-safe؛ push افزونه
 * مسیرِ اصلی است).
 */
export async function syncJobinjaFromVault(
  userId: string,
  deps: JobinjaReadDeps = {},
): Promise<SyncResult> {
  const conn = deps.db ?? defaultDb;
  const blob = await readSessionBlob(userId, "jobinja", conn as never);
  if (!blob) return { ok: false, reason: "no_session", applications: 0, profile: false };

  let bundleJson: string;
  try {
    bundleJson = decryptSession({ ciphertext: blob.ciphertext, iv: blob.iv, keyVersion: blob.keyVersion });
  } catch {
    return { ok: false, reason: "decrypt_failed", applications: 0, profile: false };
  }
  const cookieHeader = cookieHeaderFromBundle(bundleJson);
  if (!cookieHeader) return { ok: false, reason: "no_cookies", applications: 0, profile: false };

  const [appliedHtml, cvHtml] = await Promise.all([
    fetchWithCookies("/jobs/applied", cookieHeader),
    fetchWithCookies("/app/cv-builder", cookieHeader),
  ]);

  // پیمایشِ **همه‌ی صفحه‌ها**: جابینجا ۲۵ درخواست در هر صفحه می‌دهد، پس خواندنِ صفحه‌ی
  // اول یعنی سقفِ ۲۵ تا — کاربری با ۵۰ درخواست فقط نیمی از وضعیت‌ها را می‌دید. تا
  // MAX_APPLIED_PAGES صفحه جلو می‌رویم (سقفِ ایمنی در برابرِ صفحه‌بندیِ بی‌انتها).
  let applications = 0;
  if (appliedHtml) {
    const all = [...parseAppliedJobs(appliedHtml)];
    const page1 = parseAppliedPageInfo(appliedHtml);
    const lastPage = Math.min(page1?.lastPage ?? 1, MAX_APPLIED_PAGES);
    for (let page = 2; page <= lastPage; page += 1) {
      const html = await fetchWithCookies(`/jobs/applied?page=${page}`, cookieHeader);
      if (!html) break;
      const rows = parseAppliedJobs(html);
      if (rows.length === 0) break; // صفحه‌ی خالی → پایان
      all.push(...rows);
    }
    // یکتاسازی روی externalId (صفحه‌ها ممکن است هم‌پوشانی داشته باشند).
    const seen = new Set<string>();
    const unique = all.filter((a) => (seen.has(a.externalId) ? false : (seen.add(a.externalId), true)));
    applications = await upsertApplications(userId, "jobinja", unique, { db: conn });
  }
  let profile = false;
  if (cvHtml) {
    const p = parseJobinjaProfileFromHtml(cvHtml);
    if (p.fullName || p.email || p.publicUrl) {
      await upsertProfileSnapshot(userId, "jobinja", p, { db: conn });
      profile = true;
    }
  }
  return { ok: appliedHtml !== null || cvHtml !== null, applications, profile };
}

/* ─────────────────────────────  read (for UI)  ─────────────────────────── */

export interface ApplicationFunnel {
  total: number;
  pending: number;
  review: number;
  interview: number;
  /** استخدام‌شده — نتیجه‌ی نهاییِ مثبت. */
  hired: number;
  rejected: number;
  other: number;
}

/** قیفِ تحلیل + فهرستِ درخواست‌ها برای نمایش. */
export async function getApplications(
  userId: string,
  board: string,
  deps: JobinjaReadDeps = {},
): Promise<{ funnel: ApplicationFunnel; items: (typeof boardApplications.$inferSelect)[] }> {
  const conn = deps.db ?? defaultDb;
  const items = await conn.query.boardApplications.findMany({
    where: and(eq(boardApplications.userId, userId), eq(boardApplications.board, board)),
    orderBy: (t, { desc }) => [desc(t.lastSeenAt)],
    limit: 500,
  });
  const funnel: ApplicationFunnel = {
    total: items.length,
    pending: 0,
    review: 0,
    interview: 0,
    hired: 0,
    rejected: 0,
    other: 0,
  };
  for (const it of items) funnel[it.statusCategory] += 1;
  return { funnel, items };
}

/** آخرین عکس‌برداریِ پروفایل. */
export async function getProfileSnapshot(
  userId: string,
  board: string,
  deps: JobinjaReadDeps = {},
): Promise<(typeof boardProfileSnapshots.$inferSelect) | null> {
  const conn = deps.db ?? defaultDb;
  const row = await conn.query.boardProfileSnapshots.findFirst({
    where: and(eq(boardProfileSnapshots.userId, userId), eq(boardProfileSnapshots.board, board)),
  });
  return row ?? null;
}
