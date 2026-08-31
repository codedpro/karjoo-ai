/**
 * IranTalent APPLY content script (irantalent.com).
 *
 * IranTalent is an Angular SPA backed by a JSON API at api.irantalent.com. The
 * site authenticates every request with `Authorization: <token_type> <token>`,
 * built from its own first-party `auth_token_irantalent_new` cookie. This script
 * runs inside the logged-in irantalent.com origin and drives the SAME public
 * application transaction the site's own "easy apply" button performs:
 *
 *   1. read the user's identity + cv id           (candidate/profile)
 *   2. confirm the job is still open and unapplied (employer/position/:id)
 *   3. check the site's own apply preconditions    (…/check-apply-conditions)
 *   4. upload the TAILORED pdf as a cv attachment  (POST /file → file id)
 *   5. verify the stored attachment is that pdf    (returned id + file name)
 *   6. submit with that explicit file id           (…/position/:id/apply)
 *   7. prove the application exists                (is_applied / applied-jobs)
 *
 * Step 4 uses IranTalent's per-application attachment (`file_id` in the apply
 * body), so each submission is pinned to the pdf generated for THAT job — no
 * blind account-level CV swap, and no way for two tasks to cross attachments.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 — the user's OWN session in the user's OWN browser, acting only when the
 * background runner sends CONTENT_APPLY (which it does only after the server has
 * confirmed the toggle, the caps, and the tailored resume). The auth token is
 * read from the page's own cookie, used only against irantalent.com's own API,
 * and never logged or sent to Karjoo. Nothing here evades a bot detector.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { BackgroundToContent, ContentApplyResult } from "@ext/lib/messages";
import type { ApplyPlan } from "@ext/lib/apply-runner";

const API_ROOT = "https://api.irantalent.com/api/v1";
/** IranTalent's file-type lookup id for a CV document (lookup type 16, id 41). */
const CV_FILE_TYPE_ID = 41;
/** Position status ids that mean "still live". */
const LIVE_STATUS_IDS = new Set([169, 170]);
/** The site's own auth cookie; holds a JSON token envelope. */
const AUTH_COOKIE = "auth_token_irantalent_new";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fail(reason: string, ranSteps: string[]): ContentApplyResult {
  return { ok: false, ranSteps, reason };
}

/**
 * Build the Authorization header exactly the way irantalent.com's own http
 * service does. The token never leaves this origin.
 */
export function authorizationFromCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== AUTH_COOKIE) continue;
    try {
      const envelope = record(JSON.parse(decodeURIComponent(part.slice(index + 1).trim())));
      const tokenType = text(envelope.token_type);
      const accessToken = text(envelope.access_token);
      return tokenType && accessToken ? `${tokenType} ${accessToken}` : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** PURE: the position id in a canonical /job/:slug/:position_id url. */
export function positionIdFromUrl(url: string): string | null {
  try {
    const match = /\/job\/[^/]+\/(\d+)/.exec(new URL(url).pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function looksLikeChallenge(value: string): boolean {
  return /recaptcha|captcha|کپچا|بررسی امنیتی|are you a robot/i.test(value);
}

function planValue(plan: ApplyPlan, key: "resumeFile" | "coverLetter"): string | undefined {
  return plan.steps.find((step) => step.valueKey === key)?.value;
}

function planFileName(plan: ApplyPlan): string {
  return plan.steps.find((step) => step.valueKey === "resumeFile")?.fileName ?? "resume.pdf";
}

/** PURE: decode the runner's data: url into an uploadable File. */
export function dataUrlFile(dataUrl: string, fileName: string): File {
  const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("irantalent_resume_missing: invalid resume data");
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName || "resume.pdf", { type: match[1] || "application/pdf" });
}

/**
 * PURE: does the attachment IranTalent stored correspond to the pdf we just
 * uploaded for THIS task? The site rewrites the stored name, so we accept an
 * exact match or the uploaded stem, and require the returned id to be present.
 */
export function attachmentMatchesTask(
  uploaded: { id: unknown; fileName: string | undefined },
  expectedFileName: string,
): boolean {
  const id = uploaded.id;
  if (typeof id !== "number" && !(typeof id === "string" && id.trim())) return false;
  const stored = uploaded.fileName;
  if (!stored) return true;
  const normalize = (value: string) => value.toLowerCase().replace(/\.pdf$/, "").replace(/[^a-z0-9]+/g, "");
  const want = normalize(expectedFileName);
  const got = normalize(stored);
  return want.length === 0 || got.includes(want) || want.includes(got);
}

interface JsonReply { status: number; body: unknown; raw: string }

async function api(
  path: string,
  authorization: string,
  init: RequestInit = {},
): Promise<JsonReply> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("authorization", authorization);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`${API_ROOT}/${path}`, { ...init, headers });
  const raw = await response.text();
  let body: unknown = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { status: response.status, body, raw };
}

/**
 * Serialize attachment replacement + submission within this origin. The
 * background runner already drains the queue one item at a time; this is a
 * second, local guarantee that no two IranTalent tasks overlap between the
 * upload and the terminal result (the window in which a shared account-level
 * attachment could otherwise be crossed).
 */
let applyChain: Promise<unknown> = Promise.resolve();

export function executeIranTalentApply(plan: ApplyPlan): Promise<ContentApplyResult> {
  const next = applyChain.then(() => runIranTalentApply(plan), () => runIranTalentApply(plan));
  applyChain = next.catch(() => undefined);
  return next;
}

async function runIranTalentApply(plan: ApplyPlan): Promise<ContentApplyResult> {
  const ranSteps: string[] = [];
  if (looksLikeChallenge(document.body?.innerText ?? "")) {
    return fail("irantalent_security_challenge", ranSteps);
  }

  const authorization = authorizationFromCookie(document.cookie);
  if (!authorization) return fail("irantalent_login_required", ranSteps);

  const positionId = positionIdFromUrl(plan.jobUrl || location.href);
  if (!positionId) return fail("irantalent_job_unavailable", ranSteps);

  const resumeData = planValue(plan, "resumeFile");
  // Every IranTalent application carries its own tailored pdf — there is no
  // fallback to the profile resume.
  if (!resumeData) return fail("irantalent_resume_missing", ranSteps);
  const fileName = planFileName(plan);

  /* 1 — identity ---------------------------------------------------------- */
  const profile = await api("candidate/profile", authorization);
  ranSteps.push("identity");
  if (profile.status === 401 || profile.status === 403) {
    return fail("irantalent_login_required", ranSteps);
  }
  if (looksLikeChallenge(profile.raw)) return fail("irantalent_security_challenge", ranSteps);
  const profileData = record(record(profile.body).data ?? profile.body);
  const cvId = record(profileData.cv).id;
  if (typeof cvId !== "number" && typeof cvId !== "string") {
    // The call succeeded, so the session is fine — the payload no longer carries
    // the cv id we apply with. That is a contract change, not a logged-out user.
    return fail(
      profile.status >= 200 && profile.status < 300
        ? "irantalent_provider_changed"
        : "irantalent_login_required",
      ranSteps,
    );
  }

  /* 2 — job still actionable ---------------------------------------------- */
  const position = await api(`employer/position/${encodeURIComponent(positionId)}`, authorization);
  ranSteps.push("position");
  if (!(position.status >= 200 && position.status < 300)) {
    return fail("irantalent_job_unavailable", ranSteps);
  }
  const positionData = record(record(position.body).data ?? position.body);
  if (positionData.is_applied === true) {
    return { ok: true, alreadyApplied: true, ranSteps: [...ranSteps, "already-applied"] };
  }
  const statusId = record(positionData.status).id;
  if (typeof statusId === "number" && !LIVE_STATUS_IDS.has(statusId)) {
    return fail("irantalent_job_unavailable", ranSteps);
  }
  if (
    positionData.is_crawler === true ||
    text(positionData.redirection_url) ||
    text(positionData.apply_redirect_link)
  ) {
    return fail("irantalent_job_unavailable", ranSteps);
  }
  // Screening questions need answers we are not authorized to invent.
  const screening = positionData.screening_questions;
  if (Array.isArray(screening) && screening.length > 0) {
    return fail("irantalent_screening_questions_required", ranSteps);
  }

  /* 3 — the site's own apply preconditions -------------------------------- */
  const conditions = await api(
    `candidate/cv/${encodeURIComponent(String(cvId))}/position/${encodeURIComponent(positionId)}/check-apply-conditions`,
    authorization,
  );
  ranSteps.push("conditions");
  if (conditions.status === 401 || conditions.status === 403) {
    return fail("irantalent_login_required", ranSteps);
  }
  const conditionData = record(record(conditions.body).data ?? conditions.body);
  if (conditionData.is_applied === true) {
    return { ok: true, alreadyApplied: true, ranSteps: [...ranSteps, "already-applied"] };
  }
  if (conditionData.is_email_verified === false) {
    return fail("irantalent_account_unverified", ranSteps);
  }

  /* 4 — attach the tailored pdf ------------------------------------------- */
  const form = new FormData();
  form.append("attach_file", dataUrlFile(resumeData, fileName), fileName);
  form.append("attachable_id", String(cvId));
  form.append("attachable_type", "cv");
  form.append("file_type_id", String(CV_FILE_TYPE_ID));
  form.append("file_name", fileName);
  const upload = await api("file", authorization, { method: "POST", body: form });
  ranSteps.push("upload");
  if (upload.status === 401 || upload.status === 403) {
    return fail("irantalent_login_required", ranSteps);
  }
  if (looksLikeChallenge(upload.raw)) return fail("irantalent_security_challenge", ranSteps);
  if (!(upload.status >= 200 && upload.status < 300)) {
    return fail("irantalent_resume_upload_failed", ranSteps);
  }
  const uploaded = record(record(upload.body).data ?? upload.body);
  const fileId = uploaded.id;

  /* 5 — prove the stored attachment is THIS task's pdf --------------------- */
  if (!attachmentMatchesTask({ id: fileId, fileName: text(uploaded.file_name) }, fileName)) {
    return fail("irantalent_resume_verification_failed", ranSteps);
  }
  ranSteps.push("attachment-verified");

  /* 6 — submit, pinned to that attachment ---------------------------------- */
  const coverLetter = planValue(plan, "coverLetter")?.trim();
  const applied = await api(
    `candidate/cv/${encodeURIComponent(String(cvId))}/position/${encodeURIComponent(positionId)}/apply`,
    authorization,
    {
      method: "POST",
      body: JSON.stringify({
        file_id: fileId,
        ...(coverLetter ? { cover_letter: coverLetter } : {}),
      }),
    },
  );
  ranSteps.push("submit");
  if (applied.status === 401 || applied.status === 403) {
    return fail("irantalent_login_required", ranSteps);
  }
  if (looksLikeChallenge(applied.raw)) return fail("irantalent_security_challenge", ranSteps);
  if (applied.status === 409 || record(applied.body).already_applied === true) {
    return { ok: true, alreadyApplied: true, ranSteps: [...ranSteps, "already-applied"] };
  }
  if (!(applied.status >= 200 && applied.status < 300)) {
    return fail("irantalent_apply_failed", ranSteps);
  }

  /* 7 — durable proof, never inferred from the submit call alone ----------- */
  const confirmed = await confirmApplication(positionId, String(cvId), authorization);
  ranSteps.push("verify");
  if (!confirmed) return fail("irantalent_submission_unconfirmed", ranSteps);
  return { ok: true, ranSteps: [...ranSteps, "confirmed"] };
}

/** Re-read the board's own state: the position flag first, the history second. */
async function confirmApplication(
  positionId: string,
  cvId: string,
  authorization: string,
): Promise<boolean> {
  const position = await api(`employer/position/${encodeURIComponent(positionId)}`, authorization);
  const positionData = record(record(position.body).data ?? position.body);
  if (positionData.is_applied === true) return true;

  const history = await api(
    `candidate/cv/${encodeURIComponent(cvId)}/application/applied-jobs`,
    authorization,
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
    const candidates = [entry.position_id, entry.id, record(entry.position).id];
    return candidates.some((value) => String(value ?? "") === positionId);
  });
}

/* ── content-script wiring (browser only) ─────────────────────────────────── */
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundToContent, _sender, sendResponse: (result: ContentApplyResult) => void) => {
      if (msg.type !== "CONTENT_APPLY" || msg.plan.board !== "irantalent") return undefined;
      executeIranTalentApply(msg.plan).then(sendResponse).catch((error: unknown) => sendResponse({
        ok: false,
        ranSteps: [],
        reason: error instanceof Error ? error.message : String(error),
      }));
      return true;
    },
  );
}
