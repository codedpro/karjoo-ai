import "server-only";

/**
 * Jobinja profile WRITE — server-side, via the user's VAULTED session. Endpoint pattern
 * confirmed against a live account (2026-07-18, owner-consented, reverted):
 *   PUT https://jobinja.ir/api/v10/jobseeker-app/cv-builder/{cvId}/{section}   (JSON body)
 *   • basic-data → { working_status, job_title, full_name }
 *   • cv-file    → { cv_file_uuid }
 * Laravel-style CSRF: the XSRF-TOKEN cookie (URL-decoded) is echoed as the X-XSRF-TOKEN header.
 *
 * §10: karjoo never fabricates — it only writes fields the user explicitly edits in karjoo.
 */
import { readSessionBlob } from "@/lib/vault/store";
import { decryptSession } from "@/lib/vault/crypto";
import { sessionBundleSchema } from "@/lib/api/session-schemas";
import { db as defaultDb, type Database } from "@/db";
import { boardProfileSnapshots } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { KARJOO_USER_AGENT } from "@/lib/apply/robots";

const ORIGIN = "https://jobinja.ir";
const API = `${ORIGIN}/api/v10/jobseeker-app/cv-builder`;
const REQUEST_TIMEOUT_MS = 20_000;

/** بخش‌های پشتیبانی‌شده‌ی نوشتن (payload تأییدشده برای basic-data). */
export type JobinjaCvSection = "basic-data";

export interface JobinjaWriteDeps {
  db?: Database;
}

export class JobinjaWriteError extends Error {
  constructor(
    readonly code:
      | "no_session"
      | "decrypt_failed"
      | "no_cookies"
      | "no_cv_id"
      | "missing_fields"
      | "http_error",
    message: string,
  ) {
    super(message);
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** کوکی‌های نشستِ vaultِ کاربر را باز می‌کند → { cookieHeader, xsrf }. */
async function openSession(
  userId: string,
  conn: Database,
): Promise<{ cookieHeader: string; xsrf: string | null }> {
  const blob = await readSessionBlob(userId, "jobinja", conn as never);
  if (!blob) throw new JobinjaWriteError("no_session", "jobinja session not connected");
  let bundleJson: string;
  try {
    bundleJson = decryptSession({ ciphertext: blob.ciphertext, iv: blob.iv, keyVersion: blob.keyVersion });
  } catch {
    throw new JobinjaWriteError("decrypt_failed", "could not decrypt session");
  }
  const parsed = sessionBundleSchema.safeParse(JSON.parse(bundleJson));
  if (!parsed.success) throw new JobinjaWriteError("no_cookies", "session bundle invalid");
  const cookies = parsed.data.cookies ?? [];
  const cookieHeader = cookies.map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join("; ");
  if (!cookieHeader) throw new JobinjaWriteError("no_cookies", "no cookies in session");
  const xsrfRaw = cookies.find((c: { name: string }) => c.name === "XSRF-TOKEN")?.value ?? null;
  const xsrf = xsrfRaw ? decodeURIComponent(xsrfRaw) : null;
  return { cookieHeader, xsrf };
}

/** cvIdِ کاربر را از صفحه‌ی cv-builder کشف می‌کند (id کوتاهِ الفبی-عددی، نه نامِ بخش‌ها). */
export async function discoverCvId(cookieHeader: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ORIGIN}/app/cv-builder`, {
      headers: { "User-Agent": KARJOO_USER_AGENT, Cookie: cookieHeader, "Accept-Language": "fa-IR" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    const SECTIONS = new Set(["basic-data", "cv-file", "personal", "about", "skills", "experience", "education"]);
    for (const m of html.matchAll(/cv-builder\/([A-Za-z0-9]{2,8})(?:\/|["'\\])/g)) {
      const id = m[1]!;
      if (!SECTIONS.has(id) && !/^\d+$/.test(id)) return id;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * cvId را حل می‌کند: اول از عکس‌برداریِ پروفایل (اگر افزونه/ورکر آن را ذخیره کرده باشد —
 * منبعِ مطمئن، چون cvId را SPA با JS می‌گیرد و در HTMLِ خام نیست)، سپس fallbackِ raw-fetch.
 */
export async function resolveCvId(
  userId: string,
  cookieHeader: string,
  conn: Database,
): Promise<string | null> {
  try {
    const snap = await conn.query.boardProfileSnapshots.findFirst({
      where: and(eq(boardProfileSnapshots.userId, userId), eq(boardProfileSnapshots.board, "jobinja")),
      columns: { data: true },
    });
    const data = (snap?.data as Record<string, unknown> | undefined) ?? {};
    const stored = data.cvId ?? data.cv_id;
    if (typeof stored === "string" && /^[A-Za-z0-9]{2,8}$/.test(stored)) return stored;
  } catch {
    /* fall through to raw discovery */
  }
  return discoverCvId(cookieHeader);
}

/** یک بخش را PUT می‌کند (JSON + کوکی + CSRF). خطای HTTP → JobinjaWriteError. */
export async function putCvSection(
  cookieHeader: string,
  xsrf: string | null,
  cvId: string,
  section: JobinjaCvSection,
  payload: Record<string, unknown>,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/${cvId}/${section}`, {
      method: "PUT",
      headers: {
        "User-Agent": KARJOO_USER_AGENT,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: cookieHeader,
        Origin: ORIGIN,
        Referer: `${ORIGIN}/app/cv-builder`,
        ...(xsrf ? { "X-XSRF-TOKEN": xsrf } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new JobinjaWriteError("http_error", `PUT ${section} → HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** فیلدهای اصلیِ پروفایل (basic-data) را روی جابینجا به‌روزرسانی می‌کند. فقط فیلدهای داده‌شده. */
export async function updateJobinjaBasicData(
  userId: string,
  edits: { jobTitle?: string; fullName?: string; workingStatus?: string },
  deps: JobinjaWriteDeps = {},
): Promise<{ ok: true }> {
  const conn = deps.db ?? defaultDb;
  const { cookieHeader, xsrf } = await openSession(userId, conn);
  const cvId = await resolveCvId(userId, cookieHeader, conn);
  if (!cvId) throw new JobinjaWriteError("no_cv_id", "could not determine the Jobinja CV id");

  if (edits.jobTitle === undefined && edits.fullName === undefined && edits.workingStatus === undefined) {
    return { ok: true };
  }

  // basic-data یک PUTِ *کاملِ بخشِ* است و GETِ آن ۴۰۵ می‌دهد (PUT-only) — پس نمی‌توان از خودِ
  // API مقدارِ فعلی را خواند. فرمِ ویرایشِ کارجو هر دو (عنوان + نام) را از پیش پُر و می‌فرستد؛
  // مقادیرِ نبود از آخرین عکس‌برداریِ پروفایل (که افزونه push می‌کند) پُر می‌شوند تا هیچ فیلدی
  // null نشود. اگر عنوان یا نام در دسترس نبود، می‌ایستیم (به‌جای PUTِ ناقص که فیلد را پاک می‌کند).
  const snap = await conn.query.boardProfileSnapshots.findFirst({
    where: and(eq(boardProfileSnapshots.userId, userId), eq(boardProfileSnapshots.board, "jobinja")),
    columns: { data: true },
  });
  const snapData = (snap?.data as Record<string, unknown> | undefined) ?? {};
  const jobTitle = str(edits.jobTitle) ?? str(snapData.headline) ?? str(snapData.job_title);
  const fullName = str(edits.fullName) ?? str(snapData.fullName) ?? str(snapData.full_name);
  const workingStatus = str(edits.workingStatus) ?? str(snapData.working_status) ?? "seeking";
  if (!jobTitle || !fullName) {
    throw new JobinjaWriteError("missing_fields", "job_title and full_name are both required for a basic-data write");
  }

  await putCvSection(cookieHeader, xsrf, cvId, "basic-data", {
    working_status: workingStatus,
    job_title: jobTitle,
    full_name: fullName,
  });
  return { ok: true };
}
