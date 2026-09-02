/**
 * KARBOOM APPLY content script (karboom.io).
 *
 * کاربوم سایتی است که سمتِ سرور رندر می‌شود و ارسالِ رزومه‌اش یک «ویزارد» چندمرحله‌ایِ
 * سرورگردان است: هر مرحله را GET می‌کنی و قالبِ HTML‌اش را می‌گیری، پرش می‌کنی، POST
 * می‌کنی و سرور خودش می‌گوید مرحله‌ی بعد کدام است (`{currentStep}`) تا به `done` برسد.
 * ترتیبِ مرحله‌ها را ما تصمیم نمی‌گیریم؛ دقیقاً همان چیزی را دنبال می‌کنیم که سرور
 * برمی‌گرداند — همان کاری که دکمه‌ی «ارسال رزومه»ی خودِ سایت می‌کند.
 *
 *   1. شناسه‌ی عددیِ آگهی را از `/jobs/details/{code}` بخوان
 *   2. POST /jobs/apply/{id} → اولین مرحله
 *   3. حلقه: GET مرحله → پرکردنِ فرم از همان چیزی که سرور پیش‌پر کرده → POST
 *   4. در مرحله‌ی `select_resume` رزومه‌ی اختصاصیِ همین آگهی آپلود می‌شود
 *   5. `done` یعنی ثبت شد؛ `account` یعنی نشست از دست رفته
 *
 * فرم‌های میانی (مشخصاتِ فردی، سوابق، تحصیلات…) با همان مقادیری پس فرستاده می‌شوند
 * که سرور از پروفایلِ خودِ کاربر پیش‌پر کرده است. هیچ داده‌ای ساخته یا حدس زده
 * نمی‌شود؛ اگر کاربوم فیلدی را لازم بداند که پروفایلِ کاربر ندارد، ویزارد در همان
 * مرحله می‌ماند و ما با خطای روشن شکست می‌خوریم تا کاربر پروفایلش را کامل کند.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 — نشستِ خودِ کاربر در مرورگرِ خودِ کاربر، و فقط وقتی که رانرِ پس‌زمینه
 * CONTENT_APPLY بفرستد (که خودش تنها پس از تأییدِ سرور رخ می‌دهد). توکنِ CSRF فقط
 * روی خودِ karboom.io مصرف می‌شود، هرگز لاگ یا به کارجو فرستاده نمی‌شود. هیچ چیزی
 * این‌جا تشخیصِ ربات را دور نمی‌زند.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { BackgroundToContent, ContentApplyResult } from "@ext/lib/messages";
import type { ApplyPlan } from "@ext/lib/apply-runner";

const ORIGIN = "https://karboom.io";
/** سقفِ مرحله‌ها؛ ویزارد ۱۹ مرحله دارد، این مرز فقط جلوی حلقه‌ی بی‌پایان را می‌گیرد. */
const MAX_STEPS = 40;
/** مرحله‌هایی که پایانِ کارند. */
const TERMINAL_STEPS = new Set(["done", "account"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fail(reason: string, ranSteps: string[]): ContentApplyResult {
  return { ok: false, ranSteps, reason };
}

/** PURE: نشانیِ آگهی → کدِ کوتاهِ کاربوم (`/jobs/{code}/{slug}`). */
export function karboomCodeFromUrl(url: string): string | null {
  try {
    const path = new URL(url, ORIGIN).pathname;
    return /^\/jobs\/(?:details\/)?([A-Za-z0-9_-]{4,20})(?:\/|$)/.exec(path)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** PURE: قطعه‌ی HTMLِ آگهی → شناسه‌ی عددی که ویزارد با آن کار می‌کند. */
export function karboomJobIdFromHtml(html: string): string | null {
  return /data-job="(\d+)"/.exec(html)?.[1] ?? null;
}

/** PURE: پیامِ «قبلاً درخواست داده‌اید» را از پاسخِ کاربوم تشخیص بده. */
export function looksAlreadyApplied(body: unknown): boolean {
  const serialized = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return /قبلا|قبلاً|already applied/i.test(serialized) && /درخواست|رزومه|apply/i.test(serialized);
}

/** توکنِ CSRF از همان صفحه‌ای که این اسکریپت داخلش اجرا می‌شود. */
function documentCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  return meta?.content?.trim() || null;
}

/** درزهای تزریق‌پذیر، تا منطق بدونِ مرورگر هم آزمودنی بماند. */
export interface KarboomDeps {
  fetchImpl: typeof fetch;
  csrfToken: () => string | null;
}

interface StepResponse {
  status: number;
  body: unknown;
}

async function request(
  deps: KarboomDeps,
  path: string,
  init: RequestInit = {},
): Promise<StepResponse> {
  const token = deps.csrfToken();
  const response = await deps.fetchImpl(`${ORIGIN}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      accept: "application/json",
      "x-requested-with": "XMLHttpRequest",
      ...(token ? { "x-csrf-token": token } : {}),
      ...(init.headers ?? {}),
    },
  });
  const raw = await response.text();
  let body: unknown = raw;
  try {
    body = JSON.parse(raw);
  } catch {
    /* کاربوم گاهی HTML برمی‌گرداند؛ متنِ خام برای تشخیصِ خطا کافی است. */
  }
  return { status: response.status, body };
}

function dataUrlFile(dataUrl: string, fileName: string): File {
  const match = /^data:([^;,]+)?;base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("karboom_resume_upload_failed: invalid resume data");
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

/** PURE: مقدارِ یک ویژگی از متنِ داخلِ تگ. */
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return match ? decodeEntities(match[1]!) : undefined;
}

/** PURE: آیا ویژگیِ بولینی مثل checked/selected روی تگ هست؟ */
function hasFlag(tag: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`, "i").test(tag);
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * PURE: فیلدهای یک قالبِ مرحله را همان‌طور که سرور پیش‌پر کرده جمع کن.
 *
 * دقیقاً همان چیزی فرستاده می‌شود که مرورگر می‌فرستاد: دکمه‌ها و ورودی‌های فایل
 * بیرون می‌مانند، رادیو/چک‌باکسِ تیک‌نخورده هم نه. هیچ مقداری ساخته یا حدس زده
 * نمی‌شود — این تضمین می‌کند رزومه‌ای با داده‌ی جعلی ثبت نشود.
 */
export function collectStepFields(html: string): Array<[string, string]> {
  const fields: Array<[string, string]> = [];

  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const tag = match[1]!;
    const name = attribute(tag, "name");
    if (!name) continue;
    const type = (attribute(tag, "type") ?? "text").toLowerCase();
    if (type === "file" || type === "submit" || type === "button" || type === "image") continue;
    if ((type === "checkbox" || type === "radio") && !hasFlag(tag, "checked")) continue;
    fields.push([name, attribute(tag, "value") ?? ""]);
  }

  for (const match of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = attribute(match[1]!, "name");
    if (name) fields.push([name, decodeEntities(match[2]!).trim()]);
  }

  for (const match of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = attribute(match[1]!, "name");
    if (!name) continue;
    const options = [...match[2]!.matchAll(/<option\b([^>]*)>/gi)];
    const chosen = options.filter((option) => hasFlag(option[1]!, "selected"));
    // مرورگر وقتی هیچ گزینه‌ای selected نباشد، اولی را می‌فرستد.
    const effective = chosen.length > 0 ? chosen : options.slice(0, 1);
    for (const option of effective) fields.push([name, attribute(option[1]!, "value") ?? ""]);
  }

  return fields;
}

/** PURE: نامِ ورودیِ فایلِ همین مرحله (کاربوم فقط در select_resume یکی دارد). */
export function fileInputName(html: string): string | null {
  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    const tag = match[1]!;
    if ((attribute(tag, "type") ?? "").toLowerCase() !== "file") continue;
    const name = attribute(tag, "name");
    if (name) return name;
  }
  return null;
}

/** یک مرحله را بگیر، پر کن و بفرست؛ خروجی نامِ مرحله‌ی بعدی است. */
async function submitStep(
  deps: KarboomDeps,
  step: string,
  jobId: string,
  plan: ApplyPlan,
  ranSteps: string[],
): Promise<{ next: string } | ContentApplyResult> {
  const stepPath = STEP_PATHS[step];
  if (stepPath === undefined) return fail(`karboom_unknown_step: ${step}`, ranSteps);
  const url = `/jobs/apply/${encodeURIComponent(jobId)}${stepPath}`;

  const rendered = await request(deps, url, { method: "GET" });
  if (rendered.status === 401 || rendered.status === 403 || rendered.status === 422) {
    return fail("karboom_login_required", ranSteps);
  }
  if (rendered.status < 200 || rendered.status >= 300) {
    return fail(`karboom_step_unavailable: ${step} ${rendered.status}`, ranSteps);
  }
  const content = text(record(rendered.body).content);
  if (content === undefined) return fail(`karboom_step_empty: ${step}`, ranSteps);

  const fields = collectStepFields(content);
  const fileField = fileInputName(content);

  let init: RequestInit;
  if (fileField) {
    // تنها جایی که فایل می‌خواهد `select_resume` است و ما همان‌جا رزومه‌ی اختصاصیِ
    // این آگهی را می‌گذاریم. اگر رزومه‌ی اختصاصی نداریم، **رزومه‌ی دیگری جایگزین
    // نمی‌کنیم** — کاربر صریحاً گفته یا رزومه‌ی اختصاصی یا هیچ.
    const resumeData = planValue(plan, "resumeFile");
    if (!resumeData) return fail("karboom_tailored_resume_missing", ranSteps);
    const form = new FormData();
    for (const [name, value] of fields) {
      // مقدارِ `resume` به رزومه‌ی ذخیره‌شده‌ی حساب اشاره می‌کند؛ هم‌زمان با آپلودِ
      // اختصاصی فرستاده نمی‌شود تا کاربوم فایلِ ما را بردارد.
      if (name === "resume") continue;
      form.append(name, value);
    }
    form.append(fileField, dataUrlFile(resumeData, planFileName(plan)));
    init = { method: "POST", body: form };
  } else {
    const params = new URLSearchParams();
    for (const [name, value] of fields) params.append(name, value);
    const coverLetter = planValue(plan, "coverLetter")?.trim();
    if (coverLetter && params.has("description")) params.set("description", coverLetter);
    init = {
      method: "POST",
      body: params.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    };
  }

  const posted = await request(deps, url, init);
  if (posted.status === 401 || posted.status === 403) return fail("karboom_login_required", ranSteps);
  if (looksAlreadyApplied(posted.body)) return { ok: true, alreadyApplied: true, ranSteps };
  if (posted.status === 422) {
    // کاربوم داده‌ای می‌خواهد که پروفایلِ کاربر ندارد. چیزی نمی‌سازیم.
    return fail(`karboom_profile_incomplete: ${step}`, ranSteps);
  }
  if (posted.status < 200 || posted.status >= 300) {
    return fail(`karboom_step_failed: ${step} ${posted.status}`, ranSteps);
  }
  const next = text(record(posted.body).currentStep);
  if (!next) return fail(`karboom_step_no_progress: ${step}`, ranSteps);
  return { next };
}

/** مسیرِ هر مرحله، دقیقاً همان نگاشتی که `ApplyJob.initSteps` در خودِ سایت می‌سازد. */
const STEP_PATHS: Record<string, string> = {
  apply: "",
  job_status: "/job-status",
  select_resume: "/select-resume",
  personal_info: "/personal-info",
  job_experience: "/job-experience",
  education: "/education",
  knowledge: "/knowledge",
  options: "/options",
  option_biography: "/options/biography",
  option_language: "/options/language",
  option_research: "/options/research",
  option_project: "/options/project",
  option_honor: "/options/honor",
  option_volunteer: "/options/volunteer",
  option_social_link: "/options/social-link",
  review_resume: "/review-resume",
  final: "/final",
};

export async function executeKarboomApply(
  plan: ApplyPlan,
  deps: KarboomDeps = { fetchImpl: fetch, csrfToken: documentCsrfToken },
): Promise<ContentApplyResult> {
  const ranSteps: string[] = [];

  /* 1 — شناسه‌ی عددیِ آگهی --------------------------------------------------- */
  const code = karboomCodeFromUrl(plan.jobUrl);
  if (!code) return fail("karboom_job_code_missing", ranSteps);
  const details = await request(deps, `/jobs/details/${encodeURIComponent(code)}`, { method: "GET" });
  const jobId = karboomJobIdFromHtml(typeof details.body === "string" ? details.body : "");
  ranSteps.push("resolve");
  if (!jobId) return fail("karboom_job_id_missing", ranSteps);

  /* 2 — شروعِ ویزارد --------------------------------------------------------- */
  const started = await request(deps, `/jobs/apply/${encodeURIComponent(jobId)}`, { method: "POST" });
  ranSteps.push("start");
  if (started.status === 401 || started.status === 403 || started.status === 422) {
    return fail("karboom_login_required", ranSteps);
  }
  if (looksAlreadyApplied(started.body)) {
    return { ok: true, alreadyApplied: true, ranSteps: [...ranSteps, "already-applied"] };
  }
  if (started.status < 200 || started.status >= 300) {
    return fail(`karboom_apply_failed: ${started.status}`, ranSteps);
  }
  let current = text(record(started.body).currentStep);
  if (!current) return fail("karboom_apply_no_step", ranSteps);

  /* 3 — حلقه‌ی مرحله‌ها، تا جایی که سرور بگوید ------------------------------- */
  const visited = new Map<string, number>();
  for (let index = 0; index < MAX_STEPS && !TERMINAL_STEPS.has(current); index += 1) {
    // اگر سرور دوباره همان مرحله را بخواهد یعنی اعتبارسنجی رد شده و ما جلو نمی‌رویم.
    const seen = (visited.get(current) ?? 0) + 1;
    visited.set(current, seen);
    if (seen > 2) return fail(`karboom_step_stalled: ${current}`, ranSteps);

    const outcome = await submitStep(deps, current, jobId, plan, ranSteps);
    ranSteps.push(current);
    if (!("next" in outcome)) return outcome;
    current = outcome.next;
  }

  /* 4 — فقط `done` یعنی ثبت شد ---------------------------------------------- */
  if (current === "account") return fail("karboom_login_required", ranSteps);
  if (current !== "done") return fail(`karboom_submission_unconfirmed: ${current}`, ranSteps);
  return { ok: true, ranSteps: [...ranSteps, "confirmed"] };
}

/* ── content-script wiring (browser only) ─────────────────────────────────── */
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (msg: BackgroundToContent, _sender, sendResponse: (result: ContentApplyResult) => void) => {
      if (msg.type !== "CONTENT_APPLY" || msg.plan.board !== "karboom") return undefined;
      executeKarboomApply(msg.plan).then(sendResponse).catch((error: unknown) => sendResponse({
        ok: false,
        ranSteps: [],
        reason: error instanceof Error ? error.message : String(error),
      }));
      return true;
    },
  );
}
