import "server-only";

/**
 * اپلایِ سمتِ سرورِ ای‌استخدام — کاملاً HTTP، بدونِ مرورگر.
 *
 * ای‌استخدام پشتِ صفحه‌اش یک APIِ JSON دارد (`/search-api`) و ارسالِ رزومه هم از همان
 * راه انجام می‌شود؛ پس مثلِ ایران‌تلنت و کاربوم می‌توان اپلای را مستقیم از کنترل‌پلین
 * انجام داد. ترتیبِ کار همان چیزی است که خودِ سایت انجام می‌دهد:
 *
 *   ۱) نشست (`/auth/session`) → ایمیلِ حساب
 *   ۲) آگهی (`/jobs/k{uuid}`) و «عنوان‌های شغلیِ» همان آگهی (`/ats/positions/{uuid}`)
 *   ۳) انتخابِ عنوانِ درست (یا توقف، اگر مبهم باشد)
 *   ۴) ارسالِ رزومه‌ی اختصاصیِ همین آگهی روی `/ats/applicants/apply/{jobId}`
 *
 * این ماژول پورتِ سمتِ سرورِ `extension/src/content/apply/eestekhdam.ts` است. دو تفاوت:
 * کوکی‌ها از خزانه می‌آیند (به‌جای `credentials:"include"`)، و مسیرِ پاک‌سازیِ فایل‌ها
 * به‌جای `DOMParser` با خواندنِ regexیِ همان فرم‌ها کار می‌کند (روی سرور DOM نداریم).
 *
 * §۱۰: با نشستِ خودِ کاربر و روی فرمِ عمومیِ خودِ سایت. کپچا دور زده نمی‌شود — دیده شدنش
 * یعنی توقف با دلیلِ روشن. هیچ رزومه‌ای جز رزومه‌ی نوشته‌شده برای همین آگهی فرستاده
 * نمی‌شود.
 */
import {
  BoardHttpSession,
  isAuthFailure,
  redirectedToLogin,
  type BoardHttpOptions,
  type BoardHttpResponse,
} from "@/lib/apply/boards/board-session-http";
import { attribute, collectFormFields, csrfTokenFromHtml, formBlocks, stripTags } from "@/lib/apply/boards/html-forms";

const SITE_ROOT = "https://www.e-estekhdam.com";
const API_ROOT = "/search-api";

export type EEstekhdamApplyStatus = "submitted" | "skipped" | "failed";

export interface EEstekhdamApplyOutcome {
  status: EEstekhdamApplyStatus;
  reason?: string;
  ranSteps: string[];
  proof?: Record<string, unknown>;
}

export interface EEstekhdamApplyInput {
  session: string;
  jobUrl: string;
  /** عنوانِ آگهی — برای انتخابِ «عنوانِ شغلیِ» درست داخلِ همان آگهی. */
  jobTitle: string;
  /** رزومه‌ی اختصاصیِ همین آگهی. ای‌استخدام بدونِ فایل اصلاً درخواست نمی‌پذیرد. */
  resumePdf: Uint8Array;
  resumeFileName: string;
  coverLetter?: string;
}

/* ─────────────────────────────  کمک‌کننده‌ها  ──────────────────────────────── */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s‌._\-–—()[\]]+/g, "")
    .trim();
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

function fail(reason: string, ranSteps: string[]): EEstekhdamApplyOutcome {
  return { status: "failed", reason, ranSteps };
}

function skip(reason: string, ranSteps: string[]): EEstekhdamApplyOutcome {
  return { status: "skipped", reason, ranSteps };
}

/** PURE: نشانیِ آگهی → شناسه‌ی کوتاهِ ای‌استخدام (`…/kAB12-…`). */
export function uuidFromUrl(url: string): string | null {
  try {
    return /\/k([a-z0-9]{5})(?=[/?#-]|$)/i.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * PURE: پیامِ ردِ خودِ سایت، فشرده‌شده تا ذخیره‌کردنش امن باشد.
 *
 * `eestekhdam_apply_failed`ِ خالی یک بن‌بست بود: ده‌ها شکستِ پشتِ‌هم چیزی جز «شکست
 * خورد» ثبت نمی‌کرد و نمی‌شد فیلدِ نداشته را از آگهیِ بسته یا نشستِ رد‌شده تشخیص داد.
 * ایمیل‌ها پاک می‌شوند چون این رشته روی task می‌نشیند و در داشبورد دیده می‌شود.
 */
export function failureDetail(status: number, body: unknown): string {
  const payload = record(body);
  const raw =
    typeof payload.message === "string"
      ? payload.message
      : typeof payload.error === "string"
        ? payload.error
        : typeof body === "string"
          ? body
          : JSON.stringify(body ?? {});
  const errors =
    payload.errors && typeof payload.errors === "object"
      ? Object.entries(payload.errors as Record<string, unknown>)
          .map(([field, value]) => `${field}: ${Array.isArray(value) ? value[0] : String(value)}`)
          .join("; ")
      : "";
  return `${status}${(() => {
    const merged = [raw, errors]
      .filter(Boolean)
      .join(" | ")
      .replace(/\S+@\S+\.\S+/g, "[email]")
      .replace(/\s+/g, " ")
      .trim();
    return merged ? ` ${merged.slice(0, 180)}` : "";
  })()}`;
}

/** PURE: آیا سایت به‌جای پاسخ، تأییدِ امنیتی/کپچا نشان داده؟ */
export function looksLikeChallenge(value: string): boolean {
  return /mosparo|captcha|کپچا|بررسی امنیتی|من ربات نیستم/i.test(value);
}

/** PURE: آیا این رد یعنی حساب نمی‌تواند فایلِ دیگری ذخیره کند؟ */
export function isFileLimitRefusal(detail: string): boolean {
  return /محدودیت تعداد فایل|ذخیره فایل|too many files|file limit/i.test(detail);
}

function isAlreadyAppliedRefusal(detail: string): boolean {
  return /already applied|قبلا|قبلاً/i.test(detail) && /apply|درخواست|رزومه|ارسال/i.test(detail);
}

function positionTitle(position: Record<string, unknown>): string {
  return text(position.title) ?? text(position.position) ?? text(position.name) ?? "";
}

/**
 * PURE: کدام «عنوانِ شغلی»ِ داخلِ این آگهی همانی است که کاربر برایش صف شده؟
 *
 * یک آگهیِ ای‌استخدام می‌تواند چند عنوان داشته باشد. اگر انتخاب قطعی نباشد **هیچ‌کدام**
 * را نمی‌فرستیم: درخواست برای عنوانِ اشتباه بدتر از نفرستادن است.
 */
export function choosePosition(
  positions: Record<string, unknown>[],
  jobTitle: string,
): { position?: Record<string, unknown>; outcome?: EEstekhdamApplyOutcome } {
  const wanted = normalize(jobTitle);
  const matchesWanted = (position: Record<string, unknown>): boolean => {
    const title = normalize(positionTitle(position));
    return Boolean(title) && (title === wanted || title.includes(wanted) || wanted.includes(title));
  };

  const exactAll = positions.filter(matchesWanted);
  if (
    (exactAll.length === 1 && Boolean(exactAll[0]?.applied)) ||
    (positions.length === 1 && Boolean(positions[0]?.applied))
  ) {
    return {
      outcome: {
        status: "submitted",
        reason: "already_applied_on_board",
        ranSteps: ["already-applied"],
        proof: { provider: "e-estekhdam", signal: "position_already_applied" },
      },
    };
  }

  const viable = positions.filter((position) => !position.applied && !position.invalidType);
  if (viable.length === 0 && positions.some((position) => position.invalidType === "gender")) {
    return { outcome: skip("eestekhdam_gender_mismatch", ["session", "position"]) };
  }
  const exact = viable.filter(matchesWanted);
  const selected = exact.length === 1 ? exact[0] : viable.length === 1 ? viable[0] : undefined;
  if (!selected) {
    return { outcome: skip("eestekhdam_position_required", ["session", "position"]) };
  }
  if (selected.form) {
    return { outcome: skip("eestekhdam_external_form_required", ["session", "position"]) };
  }
  return { position: selected };
}

/* ───────────────────────  پاک‌سازیِ فایل‌های حساب  ───────────────────────── */

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

export interface FileDeleteAction {
  url: string;
  method: string;
  body?: URLSearchParams;
}

function deleteControl(value: string): boolean {
  return /delete|remove|destroy|trash|hazf|حذف/i.test(value);
}

function isProviderAction(action: FileDeleteAction): boolean {
  try {
    const host = new URL(action.url).hostname.toLowerCase();
    return host === "e-estekhdam.com" || host.endsWith(".e-estekhdam.com");
  } catch {
    return false;
  }
}

/**
 * PURE: کنترل‌های حذفِ خودِ «مدیریت فایل»ِ ای‌استخدام را از HTMLِ صفحه بیرون می‌کشد.
 *
 * نسخه‌ی افزونه این کار را با `DOMParser` می‌کند؛ روی سرور DOM نداریم، پس همان فرم‌ها و
 * لینک‌ها با regex خوانده می‌شوند. منطق یکی است: فقط کنترلی پذیرفته می‌شود که هم نشانه‌ی
 * «حذف» داشته باشد و هم شناسه‌ی همان فایلِ هدف — تا چیزی جز فایلِ موردِ نظر حذف نشود.
 */
export function discoverFileDeleteActions(html: string, targetId: string): FileDeleteAction[] {
  const actions: FileDeleteAction[] = [];

  for (const form of formBlocks(html)) {
    const action = attribute(form.openTag, "action") ?? "/panel/files";
    const evidence = `${action} ${stripTags(form.inner)} ${form.outer}`;
    if (!deleteControl(evidence) || !evidence.includes(targetId)) continue;
    const body = new URLSearchParams();
    for (const [name, value] of collectFormFields(form.inner, { includeButtons: true })) {
      // رادیو/چک‌باکسِ خودِ این فایل باید فرستاده شود حتی اگر در HTML تیک نخورده باشد.
      body.append(name, value);
    }
    if (!body.has("id") && !body.has("file_id")) body.append("id", targetId);
    actions.push({
      url: new URL(action, SITE_ROOT).toString(),
      method: (attribute(form.openTag, "method") || "POST").toUpperCase(),
      body,
    });
  }

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const tag = match[1]!;
    const href = attribute(tag, "data-url") ?? attribute(tag, "data-href") ?? attribute(tag, "href") ?? "";
    if (!href || href === "#") continue;
    const context = `${href} ${tag} ${stripTags(match[2]!)}`;
    if (!context.includes(targetId) || !deleteControl(context)) continue;
    actions.push({
      url: new URL(href, SITE_ROOT).toString(),
      method: (attribute(tag, "data-method") || "GET").toUpperCase(),
    });
  }

  return actions.filter(isProviderAction).filter(
    (action, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.url === action.url &&
          candidate.method === action.method &&
          candidate.body?.toString() === action.body?.toString(),
      ) === index,
  );
}

/* ──────────────────────────────  اجرا  ───────────────────────────────────── */

class Client {
  constructor(private readonly http: BoardHttpSession) {}

  api(path: string, init: RequestInit = {}): Promise<BoardHttpResponse> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
    return this.http.request(`${API_ROOT}${path}`, { ...init, headers });
  }

  page(path: string, init: RequestInit = {}): Promise<BoardHttpResponse> {
    const headers = new Headers(init.headers);
    headers.set("accept", "text/html,application/xhtml+xml");
    return this.http.request(path, { ...init, headers });
  }
}

async function currentStoredFiles(
  client: Client,
): Promise<{ status: number; files: Record<string, unknown>[] }> {
  const listed = await client.api("/ats/cvs");
  return { status: listed.status, files: eestekhdamFiles(listed.body) };
}

async function fileStillExists(client: Client, targetId: string): Promise<boolean | null> {
  const listed = await currentStoredFiles(client);
  if (listed.status < 200 || listed.status >= 300) return null;
  return listed.files.some((file) => fileId(file) === targetId);
}

/**
 * چند فایل در حسابِ کاربر هست، وقتی سایت حاضر باشد بگوید — همین عدد در دلیلِ شکست
 * می‌نشیند تا «سقف پر است» قابلِ راستی‌آزمایی باشد.
 */
async function storedFileCounts(client: Client): Promise<string> {
  try {
    const listed = await client.api("/ats/cvs");
    if (listed.status < 200 || listed.status >= 300) return "";
    const data = record(record(listed.body).data ?? listed.body);
    const len = (value: unknown) => (Array.isArray(value) ? value.length : null);
    const parts = [
      len(data.cvs) === null ? "" : `cvs=${len(data.cvs)}`,
      len(data.files) === null ? "" : `files=${len(data.files)}`,
    ].filter(Boolean);
    return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
  } catch {
    return "";
  }
}

async function executeDeleteAction(
  client: Client,
  action: FileDeleteAction,
  targetId: string,
  csrf: string | null,
): Promise<BoardHttpResponse> {
  const headers = new Headers();
  let body: URLSearchParams | undefined;
  if (action.method !== "GET" && action.method !== "HEAD") {
    body = action.body ?? new URLSearchParams({ id: targetId });
    if (csrf && !body.has("_token")) body.set("_token", csrf);
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
    headers.set("x-requested-with", "XMLHttpRequest");
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  return client.page(action.url, { method: action.method, headers, ...(body ? { body } : {}) });
}

/**
 * فایل‌های آپلودیِ درخواست‌ها را از طریقِ «مدیریت فایل»ِ خودِ ای‌استخدام حذف می‌کند و
 * پیش از تلاشِ دوباره، حذف را با فهرستِ JSON راستی‌آزمایی می‌کند.
 */
async function clearStoredApplicationFiles(
  client: Client,
): Promise<{ deleted: number; total: number; reason?: string }> {
  const listed = await currentStoredFiles(client);
  if (isAuthFailure(listed.status)) {
    return { deleted: 0, total: 0, reason: "eestekhdam_login_required" };
  }
  if (listed.status < 200 || listed.status >= 300) {
    return { deleted: 0, total: 0, reason: `eestekhdam_file_cleanup_failed: list ${listed.status}` };
  }
  const ids = [...new Set(listed.files.map(fileId).filter((id): id is string => Boolean(id)))];
  if (listed.files.length > 0 && ids.length === 0) {
    return { deleted: 0, total: listed.files.length, reason: "eestekhdam_file_cleanup_failed: no file ids" };
  }

  const managerPath = "/panel/files/";
  let deleted = 0;
  let lastStatus = "";
  for (const id of ids) {
    const manager = await client.page(managerPath);
    if (isAuthFailure(manager.status) || redirectedToLogin(manager.url)) {
      return { deleted, total: ids.length, reason: "eestekhdam_login_required" };
    }
    if (manager.status < 200 || manager.status >= 300) {
      return { deleted, total: ids.length, reason: `eestekhdam_file_cleanup_failed: manager ${manager.status}` };
    }
    const csrf = csrfTokenFromHtml(manager.raw);
    const fallbackBody = (key: "id" | "file_id"): URLSearchParams => {
      const body = new URLSearchParams({ [key]: id });
      if (csrf) body.set("_token", csrf);
      return body;
    };
    // بعضی نسخه‌های پنل برای هر فایل کنترلِ جداگانه رندر نمی‌کنند. این دو تلاشِ پشتیبان
    // امن می‌مانند چون بعدِ هر تلاش، وجودِ همان شناسه دوباره بررسی می‌شود.
    const candidates: FileDeleteAction[] = [
      ...discoverFileDeleteActions(manager.raw, id),
      { url: `${SITE_ROOT}${managerPath}`, method: "DELETE", body: fallbackBody("id") },
      { url: `${SITE_ROOT}/panel/files/delete`, method: "POST", body: fallbackBody("file_id") },
    ];

    let removed = false;
    for (const action of candidates) {
      if (!isProviderAction(action)) continue;
      const result = await executeDeleteAction(client, action, id, csrf);
      if (isAuthFailure(result.status) || redirectedToLogin(result.url)) {
        return { deleted, total: ids.length, reason: "eestekhdam_login_required" };
      }
      lastStatus = `${result.status}`;
      const stillExists = await fileStillExists(client, id);
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

function applyForm(input: EEstekhdamApplyInput, jobId: string, workId: string, email: string): FormData {
  const form = new FormData();
  form.append("jobId", jobId);
  form.append("workId", workId);
  form.append("uuid", "");
  form.append("email", email);
  const coverLetter = input.coverLetter?.trim();
  if (coverLetter) form.append("description", coverLetter);
  form.append(
    "file",
    new File([input.resumePdf as BlobPart], input.resumeFileName || "resume.pdf", {
      type: "application/pdf",
    }),
  );
  return form;
}

export async function applyToEEstekhdam(
  input: EEstekhdamApplyInput,
  options: BoardHttpOptions = {},
): Promise<EEstekhdamApplyOutcome> {
  const http = BoardHttpSession.open(SITE_ROOT, input.session, options);
  if (!http) return fail("eestekhdam_login_required", []);
  const client = new Client(http);

  const uuid = uuidFromUrl(input.jobUrl);
  if (!uuid) return skip("eestekhdam_form_unavailable", []);

  /* ۱ — نشست ------------------------------------------------------------------ */
  const session = await client.api("/auth/session", { method: "POST", body: JSON.stringify({}) });
  const auth = record(record(session.body).data);
  if (isAuthFailure(session.status) || Object.keys(auth).length === 0) {
    return fail("eestekhdam_login_required", ["session"]);
  }
  const email = findEmail(auth);
  if (!email) return fail("eestekhdam_session_incomplete", ["session"]);

  /* ۲ — آگهی و عنوان‌های شغلیِ آن ---------------------------------------------- */
  const [detail, positions] = await Promise.all([
    client.api(`/jobs/k${encodeURIComponent(uuid)}`),
    client.api(`/ats/positions/${encodeURIComponent(uuid)}`),
  ]);
  if ([detail.status, positions.status].some(isAuthFailure)) {
    return fail("eestekhdam_login_required", ["session"]);
  }
  const bothOk = [detail, positions].every((res) => res.status >= 200 && res.status < 300);
  if (!bothOk) {
    const merged = `${detail.raw} ${positions.raw}`;
    return looksLikeChallenge(merged)
      ? fail("eestekhdam_security_challenge", ["session"])
      : skip("eestekhdam_form_unavailable", ["session"]);
  }
  const detailData = record(record(detail.body).data);
  const jobId = primitiveId(detailData.id);
  if (!jobId) return skip("eestekhdam_form_unavailable", ["session"]);
  if (detailData.ats !== true) {
    // این آگهی اصلاً فرمِ درخواستِ داخلِ سایت ندارد (ایمیل/لینکِ بیرونی).
    return skip("eestekhdam_external_apply_only", ["session"]);
  }

  /* ۳ — انتخابِ عنوانِ شغلی ---------------------------------------------------- */
  const chosen = choosePosition(arrayData(positions.body), input.jobTitle);
  if (chosen.outcome) return chosen.outcome;
  const workId = primitiveId(chosen.position?.id);
  if (!workId) return skip("eestekhdam_position_required", ["session", "position"]);

  /* ۴ — ارسال ------------------------------------------------------------------ */
  const applied = await client.api(`/ats/applicants/apply/${encodeURIComponent(jobId)}`, {
    method: "POST",
    body: applyForm(input, jobId, workId, email),
  });
  // کپچا **قبل از** ۴۰۱/۴۰۳ بررسی می‌شود: صفحه‌ی تأییدِ امنیتی معمولاً خودش ۴۰۳
  // برمی‌گرداند، و اگر اول وضعیت را نگاه کنیم به کاربر می‌گوییم «حسابت را دوباره وصل
  // کن» در حالی‌که نشستش سالم است و فقط باید یک کپچا را رد کند. دو دلیلِ متفاوت، دو
  // کارِ متفاوت برای کاربر.
  if (looksLikeChallenge(applied.raw)) {
    return fail("eestekhdam_captcha_required", ["session", "upload"]);
  }
  if (isAuthFailure(applied.status)) {
    return fail("eestekhdam_login_required", ["session", "upload"]);
  }
  if ((applied.status >= 200 && applied.status < 300) && record(applied.body).ok !== false) {
    return {
      status: "submitted",
      ranSteps: ["session", "position", "upload", "confirmed"],
      proof: { provider: "e-estekhdam", signal: "apply_api_accepted" },
    };
  }

  const detailText = failureDetail(applied.status, applied.body);
  if (isAlreadyAppliedRefusal(detailText)) {
    return {
      status: "submitted",
      reason: "already_applied_on_board",
      ranSteps: ["session", "position", "already-applied"],
      proof: { provider: "e-estekhdam", signal: "already_applied_api" },
    };
  }
  if (!isFileLimitRefusal(detailText)) {
    return fail(`eestekhdam_apply_failed: ${detailText}`, ["session", "upload"]);
  }

  /* ۵ — سقفِ فایلِ حساب: پاک‌سازی و *یک* تلاشِ دوباره -------------------------- */
  // کاربر صریحاً اجازه داده فایل‌های آپلودیِ درخواست‌ها پاک شوند. به رزومه‌ی ذخیره‌شده‌ی
  // حساب پناه نمی‌بریم: هر درخواست باید همان رزومه‌ای را ببرد که برای همان آگهی نوشته
  // شده؛ فرستادنِ رزومه‌ای دیگر یعنی کارفرما چیزی جز آنچه فکر می‌کند دریافت کند.
  const cleanup = await clearStoredApplicationFiles(client);
  if (!cleanup.reason && cleanup.deleted > 0) {
    const retry = await client.api(`/ats/applicants/apply/${encodeURIComponent(jobId)}`, {
      method: "POST",
      body: applyForm(input, jobId, workId, email),
    });
    if ((retry.status >= 200 && retry.status < 300) && record(retry.body).ok !== false) {
      return {
        status: "submitted",
        ranSteps: ["session", "position", "cleanup_files", "upload", "confirmed"],
        proof: { provider: "e-estekhdam", signal: "apply_after_cleanup_api_accepted" },
      };
    }
    if (looksLikeChallenge(retry.raw)) {
      return fail("eestekhdam_captcha_required", ["session", "cleanup_files", "upload"]);
    }
    if (isAuthFailure(retry.status)) {
      return fail("eestekhdam_login_required", ["session", "cleanup_files", "upload"]);
    }
    return fail(
      `eestekhdam_apply_failed_after_cleanup: ${failureDetail(retry.status, retry.body)}`,
      ["session", "cleanup_files", "upload"],
    );
  }

  const cleanupText = cleanup.reason
    ? cleanup.reason
    : `eestekhdam_file_cleanup_empty: هیچ فایل قابل حذفی در حساب ای‌استخدام پیدا نشد.${await storedFileCounts(client)}`;
  return fail(
    "eestekhdam_file_limit_reached: سقف تعداد فایل‌های حساب شما در ای‌استخدام پر است — " +
      `پاک‌سازی خودکار فایل‌ها کامل نشد. ${cleanupText}`,
    ["session", "upload", ...(cleanup.deleted > 0 ? ["cleanup_files"] : [])],
  );
}
