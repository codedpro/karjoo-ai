import "server-only";

/**
 * اپلایِ سمتِ سرورِ ایران‌تلنت — کاملاً HTTP، بدونِ مرورگر.
 *
 * برخلافِ جابینجا (که فرمِ DOM دارد و ورکر با Playwright آن را می‌راند)، ایران‌تلنت یک
 * APIِ JSON است؛ پس اپلای را می‌توان مستقیم از کنترل‌پلین انجام داد. همان ترتیبِ
 * آداپتورِ افزونه رعایت می‌شود، چون همان تراکنشِ خودِ سایت است:
 *
 *   ۱) هویت + cv_id  ۲) بازبودن و اپلای‌نشدنِ آگهی  ۳) پیش‌شرط‌های خودِ سایت
 *   ۴) آپلودِ PDFِ اختصاصی  ۵) تأییدِ اینکه پیوستِ ذخیره‌شده همان است
 *   ۶) ثبت با همان file_id  ۷) اثباتِ وجودِ درخواست
 *
 * §10: با نشستِ خودِ کاربر (که یا افزونه گرفته یا سرور با اعتبارنامه‌ی خودش ساخته).
 * هیچ کپچایی دور زده نمی‌شود؛ سؤالاتِ غربالگری پاسخِ ساختگی نمی‌گیرند.
 */
const API_ROOT = "https://api.irantalent.com/api/v1";
const CV_FILE_TYPE_ID = 41;
const LIVE_STATUS_IDS = new Set([169, 170]);
const AUTH_COOKIE = "auth_token_irantalent_new";

export type IranTalentApplyStatus = "submitted" | "skipped" | "failed";

export interface IranTalentApplyOutcome {
  status: IranTalentApplyStatus;
  reason?: string;
  ranSteps: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** PURE: هدرِ Authorization را از نشستِ ذخیره‌شده بازمی‌سازد. */
export function authorizationFromSession(session: string): string | null {
  try {
    const bundle = record(JSON.parse(session));
    const cookies = Array.isArray(bundle.cookies) ? bundle.cookies : [];
    for (const raw of cookies) {
      const cookie = record(raw);
      if (text(cookie.name) !== AUTH_COOKIE) continue;
      const value = text(cookie.value);
      if (!value) return null;
      const envelope = record(JSON.parse(decodeURIComponent(value)));
      const tokenType = text(envelope.token_type);
      const accessToken = text(envelope.access_token);
      return tokenType && accessToken ? `${tokenType} ${accessToken}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** PURE: شناسه‌ی آگهی از نشانیِ canonical. */
export function positionIdFromUrl(url: string): string | null {
  try {
    return /\/job\/[^/]+\/(\d+)/.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** PURE: آیا پیوستِ ذخیره‌شده همانِ PDFِ این وظیفه است؟ */
export function attachmentMatchesTask(
  uploaded: { id: unknown; fileName: string | undefined },
  expectedFileName: string,
): boolean {
  const id = uploaded.id;
  if (typeof id !== "number" && !(typeof id === "string" && id.trim())) return false;
  const stored = uploaded.fileName;
  if (!stored) return true;
  const normalize = (v: string) => v.toLowerCase().replace(/\.pdf$/, "").replace(/[^a-z0-9]+/g, "");
  const want = normalize(expectedFileName);
  const got = normalize(stored);
  return want.length === 0 || got.includes(want) || want.includes(got);
}

interface Reply { status: number; body: unknown; raw: string }

async function api(
  path: string,
  authorization: string,
  fetchImpl: typeof fetch,
  init: RequestInit = {},
): Promise<Reply> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", authorization);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetchImpl(`${API_ROOT}/${path}`, { ...init, headers });
  const raw = await response.text();
  let body: unknown = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { status: response.status, body, raw };
}

function fail(reason: string, ranSteps: string[]): IranTalentApplyOutcome {
  return { status: "failed", reason, ranSteps };
}

function skip(reason: string, ranSteps: string[]): IranTalentApplyOutcome {
  return { status: "skipped", reason, ranSteps };
}

export interface IranTalentApplyInput {
  session: string;
  jobUrl: string;
  /** PDFِ اختصاصیِ همین آگهی. بدونِ آن اپلای انجام نمی‌شود. */
  resumePdf: Uint8Array;
  resumeFileName: string;
  coverLetter?: string;
}

export async function applyToIranTalent(
  input: IranTalentApplyInput,
  fetchImpl: typeof fetch = fetch,
): Promise<IranTalentApplyOutcome> {
  const ranSteps: string[] = [];
  const authorization = authorizationFromSession(input.session);
  if (!authorization) return fail("irantalent_login_required", ranSteps);
  const positionId = positionIdFromUrl(input.jobUrl);
  if (!positionId) return skip("irantalent_job_unavailable", ranSteps);
  if (input.resumePdf.byteLength === 0) return fail("irantalent_resume_missing", ranSteps);

  /* ۱ — هویت */
  const profile = await api("candidate/profile", authorization, fetchImpl);
  ranSteps.push("identity");
  if (profile.status === 401 || profile.status === 403) {
    return fail("irantalent_login_required", ranSteps);
  }
  const profileData = record(record(profile.body).data ?? profile.body);
  const cvId = record(profileData.cv).id;
  if (typeof cvId !== "number" && typeof cvId !== "string") {
    return fail(
      profile.status >= 200 && profile.status < 300
        ? "irantalent_provider_changed"
        : "irantalent_login_required",
      ranSteps,
    );
  }

  /* ۲ — وضعیتِ آگهی */
  const position = await api(`employer/position/${encodeURIComponent(positionId)}`, authorization, fetchImpl);
  ranSteps.push("position");
  if (!(position.status >= 200 && position.status < 300)) {
    return skip("irantalent_job_unavailable", ranSteps);
  }
  const data = record(record(position.body).data ?? position.body);
  if (data.is_applied === true) return skip("irantalent_already_applied", ranSteps);
  const statusId = record(data.status).id;
  if (typeof statusId === "number" && !LIVE_STATUS_IDS.has(statusId)) {
    return skip("irantalent_job_unavailable", ranSteps);
  }
  if (data.is_crawler === true || text(data.redirection_url) || text(data.apply_redirect_link)) {
    return skip("irantalent_job_unavailable", ranSteps);
  }
  const screening = data.screening_questions;
  if (Array.isArray(screening) && screening.length > 0) {
    return skip("irantalent_screening_questions_required", ranSteps);
  }

  /* ۳ — پیش‌شرط‌های خودِ سایت */
  const conditions = await api(
    `candidate/cv/${encodeURIComponent(String(cvId))}/position/${encodeURIComponent(positionId)}/check-apply-conditions`,
    authorization,
    fetchImpl,
  );
  ranSteps.push("conditions");
  if (conditions.status === 401 || conditions.status === 403) {
    return fail("irantalent_login_required", ranSteps);
  }
  const conditionData = record(record(conditions.body).data ?? conditions.body);
  if (conditionData.is_applied === true) return skip("irantalent_already_applied", ranSteps);
  if (conditionData.is_email_verified === false) {
    return fail("irantalent_account_unverified", ranSteps);
  }

  /* ۴ — آپلودِ PDFِ اختصاصی */
  const form = new FormData();
  form.append(
    "attach_file",
    new Blob([input.resumePdf as unknown as BlobPart], { type: "application/pdf" }),
    input.resumeFileName,
  );
  form.append("attachable_id", String(cvId));
  form.append("attachable_type", "cv");
  form.append("file_type_id", String(CV_FILE_TYPE_ID));
  form.append("file_name", input.resumeFileName);
  const upload = await api("file", authorization, fetchImpl, { method: "POST", body: form });
  ranSteps.push("upload");
  if (upload.status === 401 || upload.status === 403) {
    return fail("irantalent_login_required", ranSteps);
  }
  if (!(upload.status >= 200 && upload.status < 300)) {
    return fail("irantalent_resume_upload_failed", ranSteps);
  }
  const uploaded = record(record(upload.body).data ?? upload.body);
  const fileId = uploaded.id;

  /* ۵ — اثباتِ پیوست */
  if (!attachmentMatchesTask({ id: fileId, fileName: text(uploaded.file_name) }, input.resumeFileName)) {
    return fail("irantalent_resume_verification_failed", ranSteps);
  }
  ranSteps.push("attachment-verified");

  /* ۶ — ثبت */
  const applied = await api(
    `candidate/cv/${encodeURIComponent(String(cvId))}/position/${encodeURIComponent(positionId)}/apply`,
    authorization,
    fetchImpl,
    {
      method: "POST",
      body: JSON.stringify({
        file_id: fileId,
        ...(input.coverLetter?.trim() ? { cover_letter: input.coverLetter.trim() } : {}),
      }),
    },
  );
  ranSteps.push("submit");
  if (applied.status === 401 || applied.status === 403) {
    return fail("irantalent_login_required", ranSteps);
  }
  if (applied.status === 409 || record(applied.body).already_applied === true) {
    return skip("irantalent_already_applied", ranSteps);
  }
  if (!(applied.status >= 200 && applied.status < 300)) {
    return fail("irantalent_apply_failed", ranSteps);
  }

  /* ۷ — اثباتِ ماندگار */
  const confirmed = await confirmApplication(positionId, String(cvId), authorization, fetchImpl);
  ranSteps.push("verify");
  if (!confirmed) return fail("irantalent_submission_unconfirmed", ranSteps);
  return { status: "submitted", ranSteps: [...ranSteps, "confirmed"] };
}

async function confirmApplication(
  positionId: string,
  cvId: string,
  authorization: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const position = await api(`employer/position/${encodeURIComponent(positionId)}`, authorization, fetchImpl);
  if (record(record(position.body).data ?? position.body).is_applied === true) return true;
  const history = await api(
    `candidate/cv/${encodeURIComponent(cvId)}/application/applied-jobs`,
    authorization,
    fetchImpl,
  );
  if (!(history.status >= 200 && history.status < 300)) return false;
  const body = record(history.body);
  const rows = Array.isArray(body.data)
    ? body.data
    : Array.isArray(record(body.data).data)
      ? record(body.data).data as unknown[]
      : [];
  return rows.some((row) => {
    const entry = record(row);
    return [entry.position_id, entry.id, record(entry.position).id].some(
      (value) => String(value ?? "") === positionId,
    );
  });
}
