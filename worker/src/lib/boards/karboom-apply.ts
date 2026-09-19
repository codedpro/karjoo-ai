/**
 * اپلایِ سمتِ سرورِ کاربوم — کاملاً HTTP، بدونِ مرورگر.
 *
 * کاربوم سمتِ سرور رندر می‌شود و ارسالِ رزومه‌اش یک «ویزارد» چندمرحله‌ایِ سرورگردان
 * است: هر مرحله را GET می‌کنی و قالبِ HTML‌اش را می‌گیری، پرش می‌کنی، POST می‌کنی و
 * سرور خودش می‌گوید مرحله‌ی بعد کدام است (`currentStep`) تا به `done` برسد. ترتیبِ
 * مرحله‌ها را ما تصمیم نمی‌گیریم؛ دقیقاً همان چیزی را دنبال می‌کنیم که سرور می‌گوید —
 * همان کاری که دکمه‌ی «ارسال رزومه»ی خودِ سایت می‌کند.
 *
 *   ۱. شناسه‌ی عددیِ آگهی را از `/jobs/details/{code}` بخوان
 *   ۲. POST /jobs/apply/{id} → اولین مرحله
 *   ۳. حلقه: GET مرحله → پرکردن از همان چیزی که سرور پیش‌پر کرده → POST
 *   ۴. در مرحله‌ی `select_resume` رزومه‌ی اختصاصیِ همین آگهی آپلود می‌شود
 *   ۵. `done` یعنی ثبت شد؛ `account` یعنی نشست از دست رفته
 *
 * این ماژول پورتِ سمتِ سرورِ `extension/src/content/apply/karboom.ts` است. تفاوتِ
 * واقعی فقط دو چیز است: کوکی‌ها به‌جای `credentials:"include"` از خزانه می‌آیند، و
 * توکنِ CSRF به‌جای `document` از خودِ HTMLِ صفحه‌ی آگهی خوانده می‌شود.
 *
 * §۱۰: فرم‌های میانی با همان مقادیری پس فرستاده می‌شوند که سرور از پروفایلِ خودِ
 * کاربر پیش‌پر کرده. هیچ داده‌ای ساخته یا حدس زده نمی‌شود؛ اگر کاربوم فیلدی بخواهد که
 * پروفایل ندارد، ویزارد همان‌جا می‌ماند و ما با خطای روشن شکست می‌خوریم تا کاربر
 * پروفایلش را کامل کند. هیچ چیزی این‌جا تشخیصِ ربات را دور نمی‌زند.
 */
import {
  BoardHttpSession,
  isAuthFailure,
  type BoardHttpOptions,
  type BoardHttpResponse,
} from "./board-session-http.js";
import {
  collectFormFields,
  csrfTokenFromHtml,
  fileInputName,
} from "./html-forms.js";

const ORIGIN = "https://karboom.io";
/** سقفِ مرحله‌ها؛ ویزارد ۱۹ مرحله دارد، این مرز فقط جلوی حلقه‌ی بی‌پایان را می‌گیرد. */
const MAX_STEPS = 40;
/** مرحله‌هایی که پایانِ کارند. */
const TERMINAL_STEPS = new Set(["done", "account"]);

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

export type KarboomApplyStatus = "submitted" | "skipped" | "failed";

export interface KarboomApplyOutcome {
  status: KarboomApplyStatus;
  reason?: string;
  ranSteps: string[];
  proof?: Record<string, unknown>;
}

export interface KarboomApplyInput {
  /** بسته‌ی نشستِ رمزگشایی‌شده‌ی خودِ کاربر. */
  session: string;
  jobUrl: string;
  /** رزومه‌ی اختصاصیِ همین آگهی — کاربوم آن را در ویزارد آپلود می‌کند. */
  resumePdf: Uint8Array;
  resumeFileName: string;
  coverLetter?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fail(reason: string, ranSteps: string[]): KarboomApplyOutcome {
  return { status: "failed", reason, ranSteps };
}

function skip(reason: string, ranSteps: string[]): KarboomApplyOutcome {
  return { status: "skipped", reason, ranSteps };
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

/** PURE: آیا این آگهی دیگر پذیرای درخواست نیست؟ */
export function looksClosed(body: unknown): boolean {
  const serialized = typeof body === "string" ? body : JSON.stringify(body ?? "");
  return /منقضی|بسته شده|پایان یافته|expired|closed/i.test(serialized);
}

/** درزهای تزریق‌پذیر، تا منطق بدونِ شبکه هم آزمودنی بماند. */
interface WizardContext {
  http: BoardHttpSession;
  csrfToken: string | null;
  jobId: string;
  input: KarboomApplyInput;
}

async function wizardRequest(
  ctx: WizardContext,
  path: string,
  init: RequestInit = {},
): Promise<BoardHttpResponse> {
  return ctx.http.request(path, {
    ...init,
    headers: {
      accept: "application/json",
      "x-requested-with": "XMLHttpRequest",
      ...(ctx.csrfToken ? { "x-csrf-token": ctx.csrfToken } : {}),
      ...(init.headers ?? {}),
    },
  });
}

/** یک مرحله را بگیر، پر کن و بفرست؛ خروجی نامِ مرحله‌ی بعدی است. */
async function submitStep(
  ctx: WizardContext,
  step: string,
  ranSteps: string[],
): Promise<{ next: string } | KarboomApplyOutcome> {
  const stepPath = STEP_PATHS[step];
  if (stepPath === undefined) return fail(`karboom_unknown_step: ${step}`, ranSteps);
  const url = `/jobs/apply/${encodeURIComponent(ctx.jobId)}${stepPath}`;

  const rendered = await wizardRequest(ctx, url, { method: "GET" });
  if (isAuthFailure(rendered.status) || rendered.status === 422) {
    return fail("karboom_login_required", ranSteps);
  }
  if (rendered.status < 200 || rendered.status >= 300) {
    return fail(`karboom_step_unavailable: ${step} ${rendered.status}`, ranSteps);
  }
  const content = text(record(rendered.body).content);
  if (content === undefined) return fail(`karboom_step_empty: ${step}`, ranSteps);

  const fields = collectFormFields(content);
  const fileField = fileInputName(content);

  let init: RequestInit;
  if (fileField) {
    // تنها جایی که فایل می‌خواهد `select_resume` است و ما همان‌جا رزومه‌ی اختصاصیِ
    // این آگهی را می‌گذاریم. اگر رزومه‌ی اختصاصی نداریم، **رزومه‌ی دیگری جایگزین
    // نمی‌کنیم** — قرار است کارفرما همان رزومه‌ای را ببیند که برای همین آگهی نوشته شده.
    const form = new FormData();
    for (const [name, value] of fields) {
      // مقدارِ `resume` به رزومه‌ی ذخیره‌شده‌ی حساب اشاره می‌کند؛ هم‌زمان با آپلودِ
      // اختصاصی فرستاده نمی‌شود تا کاربوم فایلِ ما را بردارد.
      if (name === "resume") continue;
      form.append(name, value);
    }
    form.append(
      fileField,
      new File([ctx.input.resumePdf], ctx.input.resumeFileName || "resume.pdf", {
        type: "application/pdf",
      }),
    );
    init = { method: "POST", body: form };
  } else {
    const params = new URLSearchParams();
    for (const [name, value] of fields) params.append(name, value);
    const coverLetter = ctx.input.coverLetter?.trim();
    if (coverLetter && params.has("description")) params.set("description", coverLetter);
    init = {
      method: "POST",
      body: params.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    };
  }

  const posted = await wizardRequest(ctx, url, init);
  if (isAuthFailure(posted.status)) return fail("karboom_login_required", ranSteps);
  if (looksAlreadyApplied(posted.body)) {
    return {
      status: "submitted",
      reason: "already_applied_on_board",
      ranSteps: [...ranSteps, "already-applied"],
      proof: { provider: "karboom", signal: "already_applied_response" },
    };
  }
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

/**
 * ویزاردِ اپلایِ کاربوم را برای یک آگهی از ابتدا تا `done` می‌راند.
 *
 * خروجی همان قراردادِ `applyToIranTalent` است تا رانرِ مشترک بتواند هر دو را یکسان
 * گزارش کند.
 */
export async function applyToKarboom(
  input: KarboomApplyInput,
  options: BoardHttpOptions = {},
): Promise<KarboomApplyOutcome> {
  const ranSteps: string[] = [];

  const http = BoardHttpSession.open(ORIGIN, input.session, options);
  if (!http) return fail("karboom_login_required", ranSteps);

  /* ۱ — شناسه‌ی عددیِ آگهی + توکنِ CSRFِ همان صفحه ------------------------------ */
  const code = karboomCodeFromUrl(input.jobUrl);
  if (!code) return skip("karboom_job_code_missing", ranSteps);

  const details = await http.request(`/jobs/details/${encodeURIComponent(code)}`, {
    method: "GET",
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  ranSteps.push("resolve");
  if (isAuthFailure(details.status)) return fail("karboom_login_required", ranSteps);
  if (details.status < 200 || details.status >= 300) {
    return skip(`karboom_job_unavailable: ${details.status}`, ranSteps);
  }
  const jobId = karboomJobIdFromHtml(details.raw);
  if (!jobId) {
    // آگهیِ بسته/حذف‌شده هم `data-job` ندارد — این شکست نیست، این آگهی دیگر نیست.
    return skip(looksClosed(details.raw) ? "karboom_job_closed" : "karboom_job_id_missing", ranSteps);
  }

  const ctx: WizardContext = {
    http,
    // توکن ابتدا از صفحه‌ی آگهی؛ اگر آن‌جا نبود از کوکیِ XSRFِ خودِ لاراول.
    csrfToken: csrfTokenFromHtml(details.raw) ?? http.cookie("XSRF-TOKEN") ?? null,
    jobId,
    input,
  };

  /* ۲ — شروعِ ویزارد --------------------------------------------------------- */
  const started = await wizardRequest(ctx, `/jobs/apply/${encodeURIComponent(jobId)}`, {
    method: "POST",
  });
  ranSteps.push("start");
  if (isAuthFailure(started.status) || started.status === 422) {
    return fail("karboom_login_required", ranSteps);
  }
  if (looksAlreadyApplied(started.body)) {
    return {
      status: "submitted",
      reason: "already_applied_on_board",
      ranSteps: [...ranSteps, "already-applied"],
      proof: { provider: "karboom", signal: "already_applied_response" },
    };
  }
  if (started.status < 200 || started.status >= 300) {
    return fail(`karboom_apply_failed: ${started.status}`, ranSteps);
  }
  let current = text(record(started.body).currentStep);
  if (!current) return fail("karboom_apply_no_step", ranSteps);

  /* ۳ — حلقه‌ی مرحله‌ها، تا جایی که سرور بگوید ------------------------------- */
  const visited = new Map<string, number>();
  for (let index = 0; index < MAX_STEPS && !TERMINAL_STEPS.has(current); index += 1) {
    // اگر سرور دوباره همان مرحله را بخواهد یعنی اعتبارسنجی رد شده و ما جلو نمی‌رویم.
    const seen = (visited.get(current) ?? 0) + 1;
    visited.set(current, seen);
    if (seen > 2) return fail(`karboom_step_stalled: ${current}`, ranSteps);

    const outcome = await submitStep(ctx, current, ranSteps);
    ranSteps.push(current);
    if (!("next" in outcome)) return outcome;
    current = outcome.next;
  }

  /* ۴ — فقط `done` یعنی ثبت شد ---------------------------------------------- */
  if (current === "account") return fail("karboom_login_required", ranSteps);
  if (current !== "done") return fail(`karboom_submission_unconfirmed: ${current}`, ranSteps);
  return {
    status: "submitted",
    ranSteps: [...ranSteps, "confirmed"],
    proof: { provider: "karboom", signal: "wizard_done" },
  };
}
