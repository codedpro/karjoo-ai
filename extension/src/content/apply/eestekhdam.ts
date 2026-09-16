import type { BackgroundToContent, ContentApplyResult } from "@ext/lib/messages";
import type { ApplyPlan } from "@ext/lib/apply-runner";

const API_ROOT = "https://www.e-estekhdam.com/search-api";
const SITE_ROOT = "https://www.e-estekhdam.com";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function arrayData(value: unknown): Record<string, unknown>[] {
  const payload = record(value);
  const data = payload.data ?? value;
  if (Array.isArray(data)) return data.map(record);
  const wrapped = record(data);
  for (const key of ["items", "positions", "rows"]) {
    if (Array.isArray(wrapped[key])) return (wrapped[key] as unknown[]).map(record);
  }
  return [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s\u200c._\-–—()[\]]+/g, "")
    .trim();
}

function sessionData(value: unknown): Record<string, unknown> {
  return record(record(value).data);
}

function findEmail(value: unknown, depth = 0): string | null {
  if (depth > 4 || !value || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/email/i.test(key) && typeof item === "string" && /^\S+@\S+\.\S+$/.test(item)) return item;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = findEmail(item, depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * The board's own rejection message, condensed into something safe to store.
 *
 * `eestekhdam_apply_failed` was a dead end: 72 failures in a row recorded nothing
 * but the fact that they failed, so there was no way to tell a missing field from
 * a closed ad from a rejected session. The server's own message is the only thing
 * that distinguishes them. Emails are redacted because this string is persisted
 * on the task and shown in the dashboard.
 */
export function failureDetail(status: number, body: unknown): string {
  const record_ = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const raw =
    typeof record_.message === "string" ? record_.message
    : typeof record_.error === "string" ? record_.error
    : typeof body === "string" ? body
    : JSON.stringify(body ?? {});
  const errors = record_.errors && typeof record_.errors === "object"
    ? Object.entries(record_.errors as Record<string, unknown>)
        .map(([field, value]) => `${field}: ${Array.isArray(value) ? value[0] : String(value)}`)
        .join("; ")
    : "";
  const text = [raw, errors].filter(Boolean).join(" | ")
    .replace(/\S+@\S+\.\S+/g, "[email]")
    .replace(/\s+/g, " ")
    .trim();
  return `${status}${text ? ` ${text.slice(0, 180)}` : ""}`;
}

function looksLikeChallenge(value: string): boolean {
  return /mosparo|captcha|کپچا|بررسی امنیتی|من ربات نیستم/i.test(value);
}

async function jsonRequest(url: string, init: RequestInit = {}): Promise<{ response: Response; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "include" });
  const raw = await response.text();
  let body: unknown = {};
  if (raw) {
    try { body = JSON.parse(raw); } catch { body = raw; }
  }
  return { response, body };
}

function dataUrlFile(dataUrl: string, fileName: string): File {
  const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("eestekhdam_resume_upload_failed: invalid resume data");
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName || "resume.pdf", { type: match[1] || "application/pdf" });
}

function planValue(plan: ApplyPlan, key: "resumeFile" | "coverLetter"): string | undefined {
  return plan.steps.find((step) => step.valueKey === key)?.value;
}

function planFileName(plan: ApplyPlan): string {
  return plan.steps.find((step) => step.valueKey === "resumeFile")?.fileName ?? "resume.pdf";
}

function uuidFromUrl(url: string): string | null {
  try {
    return /\/k([a-z0-9]{5})(?=[/?#-]|$)/i.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function positionTitle(position: Record<string, unknown>): string {
  return text(position.title) ?? text(position.position) ?? text(position.name) ?? "";
}

function choosePosition(
  positions: Record<string, unknown>[],
  jobTitle: string,
): { position?: Record<string, unknown>; result?: ContentApplyResult } {
  const wanted = normalize(jobTitle);
  const exactAll = positions.filter((position) => {
    const title = normalize(positionTitle(position));
    return title && (title === wanted || title.includes(wanted) || wanted.includes(title));
  });
  if (
    (exactAll.length === 1 && Boolean(exactAll[0]?.applied)) ||
    (positions.length === 1 && Boolean(positions[0]?.applied))
  ) {
    return { result: { ok: true, alreadyApplied: true, ranSteps: ["already-applied"] } };
  }
  const viable = positions.filter((position) => !position.applied && !position.invalidType);
  if (viable.length === 0 && positions.some((position) => position.invalidType === "gender")) {
    return { result: { ok: false, ranSteps: [], reason: "eestekhdam_gender_mismatch" } };
  }
  const exact = viable.filter((position) => {
    const title = normalize(positionTitle(position));
    return title && (title === wanted || title.includes(wanted) || wanted.includes(title));
  });
  const selected = exact.length === 1 ? exact[0] : viable.length === 1 ? viable[0] : undefined;
  if (!selected) {
    return { result: { ok: false, ranSteps: [], reason: "eestekhdam_position_required" } };
  }
  if (selected.form) {
    return { result: { ok: false, ranSteps: [], reason: "eestekhdam_external_form_required" } };
  }
  return { position: selected };
}

/**
 * How many CVs the account already has stored, when the board will say.
 *
 * "خطا در زمان ذخیره فایل" arrives on a 400 with no further detail. Filename,
 * file size and extension are all ruled out — the PDFs are ~50KB against a 10MB
 * limit, and the uploads that DID succeed used the same Persian filenames. What
 * fits the shape (four accepted, then every one refused) is an account-level
 * limit on stored CVs, since every application uploads another one. The board
 * lists them, so ask instead of guessing, and put the number in the reason.
 */
async function storedFileCounts(): Promise<string> {
  try {
    const { response, body } = await jsonRequest(`${API_ROOT}/ats/cvs`);
    if (!response.ok) return "";
    const data = record(record(body).data ?? body);
    const len = (v: unknown) => (Array.isArray(v) ? v.length : null);
    const cvs = len(data.cvs);
    // `files` is the collection an application actually adds to — the first
    // instrumentation counted `cvs` and reported 1, which looked like the theory
    // was dead when it was simply the wrong list.
    const files = len(data.files);
    const parts = [cvs === null ? "" : `cvs=${cvs}`, files === null ? "" : `files=${files}`];
    const text = parts.filter(Boolean).join(" ");
    return text ? ` [${text}]` : "";
  } catch {
    return "";
  }
}

function primitiveId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function fileId(file: Record<string, unknown>): string | null {
  for (const key of ["id", "fileId", "file_id", "uuid", "key"]) {
    const id = primitiveId(file[key]);
    if (id) return id;
  }
  return null;
}

function eestekhdamFiles(value: unknown): Record<string, unknown>[] {
  const data = record(record(value).data ?? value);
  return Array.isArray(data.files) ? data.files.map(record) : [];
}

interface FileDeleteAction {
  url: string;
  method: string;
  body?: URLSearchParams;
}

function deleteControl(value: string): boolean {
  return /delete|remove|destroy|trash|hazf|حذف/i.test(value);
}

function formBody(form: HTMLFormElement, targetId: string): URLSearchParams {
  const body = new URLSearchParams();
  for (const control of form.querySelectorAll("input[name], select[name], textarea[name]")) {
    const input = control as HTMLInputElement;
    const name = input.getAttribute("name")?.trim();
    if (!name || input.hasAttribute("disabled")) continue;
    const type = input.getAttribute("type")?.toLowerCase() ?? "";
    const value = input.value ?? input.getAttribute("value") ?? "";
    if ((type === "checkbox" || type === "radio") && value !== targetId && !input.hasAttribute("checked")) continue;
    if ((type === "submit" || type === "button") && !deleteControl(`${value} ${input.outerHTML}`)) continue;
    body.append(name, value);
  }
  return body;
}

function csrfToken(doc: Document): string | null {
  return doc.querySelector<HTMLInputElement>('input[name="_token"]')?.value?.trim()
    || doc.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content?.trim()
    || null;
}

function actionContext(node: Element): string {
  const container = node.closest("[data-file-id], [data-id], tr, li, article, .file, .item");
  return `${node.textContent ?? ""} ${node.outerHTML} ${container?.outerHTML ?? ""}`;
}

/** PURE: extract the authenticated file manager's own deletion controls. */
export function discoverFileDeleteActions(doc: Document, targetId: string): FileDeleteAction[] {
  const actions: FileDeleteAction[] = [];
  for (const node of doc.querySelectorAll("form")) {
    const form = node as HTMLFormElement;
    const action = form.getAttribute("action") ?? "/panel/files";
    const evidence = `${action} ${form.textContent ?? ""} ${form.outerHTML}`;
    if (!deleteControl(evidence) || !evidence.includes(targetId)) continue;
    actions.push({
      url: new URL(action, SITE_ROOT).toString(),
      method: (form.getAttribute("method") || "POST").toUpperCase(),
      body: formBody(form, targetId),
    });
  }
  for (const node of doc.querySelectorAll("a[href], [data-url], [data-href]")) {
    const href = node.getAttribute("data-url")
      || node.getAttribute("data-href")
      || node.getAttribute("href")
      || "";
    const context = `${href} ${actionContext(node)}`;
    if (!href || href === "#") continue;
    if (!context.includes(targetId) || !deleteControl(context)) continue;
    actions.push({
      url: new URL(href, SITE_ROOT).toString(),
      method: (node.getAttribute("data-method") || "GET").toUpperCase(),
    });
  }
  return actions.filter(providerAction).filter((action, index) =>
    actions.findIndex((candidate) =>
      candidate.url === action.url && candidate.method === action.method &&
      candidate.body?.toString() === action.body?.toString()) === index);
}

async function textRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("accept", "text/html,application/xhtml+xml");
  return fetch(url, { ...init, headers, credentials: "include", redirect: "follow" });
}

async function currentStoredFiles(): Promise<{
  response: Response;
  files: Record<string, unknown>[];
}> {
  const result = await jsonRequest(`${API_ROOT}/ats/cvs`);
  return { response: result.response, files: eestekhdamFiles(result.body) };
}

async function fileStillExists(targetId: string): Promise<boolean | null> {
  const listed = await currentStoredFiles();
  if (!listed.response.ok) return null;
  return listed.files.some((file) => fileId(file) === targetId);
}

function providerAction(action: FileDeleteAction): boolean {
  try {
    const host = new URL(action.url).hostname.toLowerCase();
    return host === "e-estekhdam.com" || host.endsWith(".e-estekhdam.com");
  } catch {
    return false;
  }
}

async function executeDeleteAction(action: FileDeleteAction, targetId: string): Promise<Response> {
  const headers = new Headers();
  let body: URLSearchParams | undefined;
  if (action.method !== "GET" && action.method !== "HEAD") {
    body = action.body ?? new URLSearchParams({ id: targetId });
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  }
  return textRequest(action.url, { method: action.method, headers, body });
}

async function confirmationAction(response: Response, targetId: string): Promise<FileDeleteAction | null> {
  if (!response.ok) return null;
  const html = await response.clone().text().catch(() => "");
  if (!html || !deleteControl(html) || !html.includes(targetId)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return discoverFileDeleteActions(doc, targetId)[0] ?? null;
}

/**
 * Delete application-upload files through e-estekhdam's authenticated manager,
 * then verify against the JSON list before retrying the tailored PDF upload.
 */
async function clearStoredApplicationFiles(): Promise<{ deleted: number; total: number; reason?: string }> {
  const { response, files } = await currentStoredFiles();
  if (response.status === 401 || response.status === 403) {
    return { deleted: 0, total: 0, reason: "eestekhdam_login_required" };
  }
  if (!response.ok) {
    return { deleted: 0, total: 0, reason: `eestekhdam_file_cleanup_failed: list ${response.status}` };
  }
  const ids = [...new Set(files.map(fileId).filter((id): id is string => Boolean(id)))];
  if (files.length > 0 && ids.length === 0) {
    return { deleted: 0, total: files.length, reason: "eestekhdam_file_cleanup_failed: no file ids" };
  }

  let deleted = 0;
  let lastStatus = "";
  for (const id of ids) {
    const managerUrl = `${SITE_ROOT}/panel/files/`;
    const manager = await textRequest(managerUrl);
    if (manager.status === 401 || manager.status === 403 || /\/login(?:\/|$)/.test(new URL(manager.url || managerUrl).pathname)) {
      return { deleted, total: ids.length, reason: "eestekhdam_login_required" };
    }
    if (!manager.ok) {
      return { deleted, total: ids.length, reason: `eestekhdam_file_cleanup_failed: manager ${manager.status}` };
    }
    const managerHtml = await manager.text();
    const managerDoc = new DOMParser().parseFromString(managerHtml, "text/html");
    const discovered = discoverFileDeleteActions(managerDoc, id).filter(providerAction);
    const token = csrfToken(managerDoc);
    const fallbackBody = (key: "id" | "file_id"): URLSearchParams => {
      const body = new URLSearchParams({ [key]: id });
      if (token) body.set("_token", token);
      return body;
    };
    // Older panel builds expose the collection as a REST-like form without
    // rendering a per-file action. These fallbacks remain safe because every
    // attempt is checked by re-listing the exact id afterward.
    const candidates: FileDeleteAction[] = [
      ...discovered,
      { url: managerUrl, method: "DELETE", body: fallbackBody("id") },
      { url: `${SITE_ROOT}/panel/files/delete`, method: "POST", body: fallbackBody("file_id") },
    ];
    let removed = false;
    for (const action of candidates) {
      if (!providerAction(action)) continue;
      const result = await executeDeleteAction(action, id);
      if (result.status === 401 || result.status === 403 || /\/login(?:\/|$)/.test(new URL(result.url || action.url).pathname)) {
        return { deleted, total: ids.length, reason: "eestekhdam_login_required" };
      }
      lastStatus = `${result.status}`;
      let stillExists = await fileStillExists(id);
      const confirmation = stillExists === true ? await confirmationAction(result, id) : null;
      if (confirmation && providerAction(confirmation)) {
        const confirmed = await executeDeleteAction(confirmation, id);
        lastStatus = `${result.status}/${confirmed.status}`;
        if (confirmed.status === 401 || confirmed.status === 403) {
          return { deleted, total: ids.length, reason: "eestekhdam_login_required" };
        }
        stillExists = await fileStillExists(id);
      }
      if (stillExists === false) {
        deleted += 1;
        removed = true;
        break;
      }
      if (stillExists === null) lastStatus = `${result.status}; verify failed`;
    }
    if (!removed) {
      return {
        deleted,
        total: ids.length,
        reason: `eestekhdam_file_cleanup_failed: delete ${id} ${lastStatus || "failed"}`,
      };
    }
  }
  return { deleted, total: ids.length };
}

/** PURE: does this refusal mean the account cannot store another file? */
export function isFileLimitRefusal(detail: string): boolean {
  return /محدودیت تعداد فایل|ذخیره فایل|too many files|file limit/i.test(detail);
}

function isAlreadyAppliedRefusal(detail: string): boolean {
  return /already applied|قبلا|قبلاً/i.test(detail) && /apply|درخواست|رزومه|ارسال/i.test(detail);
}

export async function executeEEstekhdamApply(plan: ApplyPlan): Promise<ContentApplyResult> {
  if (looksLikeChallenge(document.body?.innerText ?? "")) {
    return { ok: false, ranSteps: [], reason: "eestekhdam_captcha_required" };
  }
  const uuid = uuidFromUrl(plan.jobUrl || location.href);
  if (!uuid) return { ok: false, ranSteps: [], reason: "eestekhdam_form_unavailable" };
  const resumeData = planValue(plan, "resumeFile");
  if (!resumeData) return { ok: false, ranSteps: [], reason: "tailored_resume_missing" };

  const session = await jsonRequest(`${API_ROOT}/auth/session`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const auth = sessionData(session.body);
  if (session.response.status === 401 || session.response.status === 403 || Object.keys(auth).length === 0) {
    return { ok: false, ranSteps: ["session"], reason: "eestekhdam_login_required" };
  }
  const email = findEmail(auth);
  if (!email) return { ok: false, ranSteps: ["session"], reason: "eestekhdam_session_incomplete" };

  const [detail, positionsResponse] = await Promise.all([
    jsonRequest(`${API_ROOT}/jobs/k${encodeURIComponent(uuid)}`),
    jsonRequest(`${API_ROOT}/ats/positions/${encodeURIComponent(uuid)}`),
  ]);
  if ([detail.response.status, positionsResponse.response.status].some((status) => status === 401 || status === 403)) {
    return { ok: false, ranSteps: ["session"], reason: "eestekhdam_login_required" };
  }
  if (!detail.response.ok || !positionsResponse.response.ok) {
    const bodyText = JSON.stringify([detail.body, positionsResponse.body]);
    return {
      ok: false,
      ranSteps: ["session"],
      reason: looksLikeChallenge(bodyText) ? "eestekhdam_security_challenge" : "eestekhdam_form_unavailable",
    };
  }
  const detailData = record(record(detail.body).data);
  const jobId = detailData.id;
  if (typeof jobId !== "number" && typeof jobId !== "string") {
    return { ok: false, ranSteps: ["session"], reason: "eestekhdam_form_unavailable" };
  }
  if (detailData.ats !== true) {
    return { ok: false, ranSteps: ["session"], reason: "eestekhdam_form_unavailable" };
  }
  const selected = choosePosition(arrayData(positionsResponse.body), plan.jobTitle);
  if (selected.result) return selected.result;
  const workId = selected.position?.id;
  if (typeof workId !== "number" && typeof workId !== "string") {
    return { ok: false, ranSteps: ["session"], reason: "eestekhdam_position_required" };
  }

  const form = new FormData();
  form.append("jobId", String(jobId));
  form.append("workId", String(workId));
  form.append("uuid", "");
  form.append("email", email);
  const coverLetter = planValue(plan, "coverLetter")?.trim();
  if (coverLetter) form.append("description", coverLetter);
  form.append("file", dataUrlFile(resumeData, planFileName(plan)));
  const applied = await jsonRequest(`${API_ROOT}/ats/applicants/apply/${encodeURIComponent(String(jobId))}`, {
    method: "POST",
    body: form,
  });
  const serialized = typeof applied.body === "string" ? applied.body : JSON.stringify(applied.body);
  if (applied.response.status === 401 || applied.response.status === 403) {
    return { ok: false, ranSteps: ["session", "upload"], reason: "eestekhdam_login_required" };
  }
  if (looksLikeChallenge(serialized)) {
    return { ok: false, ranSteps: ["session", "upload"], reason: "eestekhdam_captcha_required" };
  }
  if (!applied.response.ok || record(applied.body).ok === false) {
    const detail = failureDetail(applied.response.status, applied.body);
    if (isAlreadyAppliedRefusal(detail)) {
      return {
        ok: true,
        alreadyApplied: true,
        ranSteps: ["session", "position", "already-applied"],
        proof: { provider: "e-estekhdam", signal: "already_applied_api" },
      };
    }
    if (!isFileLimitRefusal(detail)) {
      return { ok: false, ranSteps: ["session", "upload"], reason: `eestekhdam_apply_failed: ${detail}` };
    }

    // The account cannot store another uploaded file. e-estekhdam caps them per
    // account. The user explicitly allows Karjoo to clear those application
    // upload files, so remove the `data.files` collection and retry once with
    // the same tailored PDF.
    //
    // We do NOT fall back to the CV already on the account. Every application is
    // supposed to carry the résumé written for that specific ad; sending a
    // different one and calling it an application would misrepresent what the
    // employer received.
    const cleanup = await clearStoredApplicationFiles();
    if (!cleanup.reason && cleanup.deleted > 0) {
      const retry = await jsonRequest(`${API_ROOT}/ats/applicants/apply/${encodeURIComponent(String(jobId))}`, {
        method: "POST",
        body: form,
      });
      const retrySerialized = typeof retry.body === "string" ? retry.body : JSON.stringify(retry.body);
      if (retry.response.ok && record(retry.body).ok !== false) {
        return {
          ok: true,
          ranSteps: ["session", "position", "cleanup_files", "upload", "confirmed"],
          proof: { provider: "e-estekhdam", signal: "apply_after_cleanup_api_accepted" },
        };
      }
      if (retry.response.status === 401 || retry.response.status === 403) {
        return { ok: false, ranSteps: ["session", "cleanup_files", "upload"], reason: "eestekhdam_login_required" };
      }
      if (looksLikeChallenge(retrySerialized)) {
        return { ok: false, ranSteps: ["session", "cleanup_files", "upload"], reason: "eestekhdam_captcha_required" };
      }
      return {
        ok: false,
        ranSteps: ["session", "cleanup_files", "upload"],
        reason: `eestekhdam_apply_failed_after_cleanup: ${failureDetail(retry.response.status, retry.body)}`,
      };
    }
    const counts = cleanup.reason ? "" : await storedFileCounts();
    const cleanupText = cleanup.reason
      ? cleanup.reason
      : `eestekhdam_file_cleanup_empty: هیچ فایل قابل حذفی در حساب ای‌استخدام پیدا نشد.${counts}`;
    return {
      ok: false,
      ranSteps: ["session", "upload", ...(cleanup.deleted > 0 ? ["cleanup_files"] : [])],
      reason:
        `eestekhdam_file_limit_reached: سقف تعداد فایل‌های حساب شما در ای‌استخدام پر است — ` +
        `پاک‌سازی خودکار فایل‌ها کامل نشد. ${cleanupText}`,
    };
  }
  return {
    ok: true,
    ranSteps: ["session", "position", "upload", "confirmed"],
    proof: { provider: "e-estekhdam", signal: "apply_api_accepted" },
  };
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundToContent, _sender, sendResponse: (result: ContentApplyResult) => void) => {
      if (msg.type !== "CONTENT_APPLY" || msg.plan.board !== "e-estekhdam") return undefined;
      executeEEstekhdamApply(msg.plan).then(sendResponse).catch((error: unknown) => sendResponse({
        ok: false,
        ranSteps: [],
        reason: error instanceof Error ? error.message : String(error),
      }));
      return true;
    },
  );
}
