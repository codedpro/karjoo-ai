import type { BackgroundToContent, ContentApplyResult } from "@ext/lib/messages";
import type { ApplyPlan } from "@ext/lib/apply-runner";

const API_ROOT = "https://www.e-estekhdam.com/search-api";

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
  if (detailData.ats === false) {
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
    return { ok: false, ranSteps: ["session", "upload"], reason: "eestekhdam_apply_failed" };
  }
  return { ok: true, ranSteps: ["session", "position", "upload", "confirmed"] };
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
