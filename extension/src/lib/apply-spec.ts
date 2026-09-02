/**
 * APPLY_SPEC (extension copy) — the declarative per-board apply field/selector
 * spec that the background apply-runner and the per-board content scripts consume
 * to fill + submit an application on the board page.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY A COPY (and not an import)?
 *   This is the MV3 extension package (its own package.json / build). It cannot
 *   import the control-plane module `src/lib/apply/apply-spec.ts` (different
 *   package, `server-only`-adjacent, Node deps). Foundation owns the canonical
 *   spec; this file MIRRORS its shape and selectors FAITHFULLY so both ends agree.
 *   It is pure data (no DB / network / secret / "server-only").
 *
 * §10 (the one firm line): nothing here is detection-evasion — no fingerprint
 * spoofing, no captcha solving, no identity rotation. These are just the public
 * form selectors of each board, filled with the USER'S OWN session in the user's
 * own browser (acting as the authorized user).
 *
 * Maturity (mirrors Foundation):
 *   • jobinja                      → "best-effort" real selectors.
 *   • jobvision/e-estekhdam/irantalent → native adapters validated against the
 *     boards' own apply APIs.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { BoardId } from "@ext/lib/config";

/** Board ids that have an APPLY_SPEC — same union as the board registry. */
export type ApplyBoardId = BoardId;

/** A single interactive step kind in an apply flow. */
export type ApplyStepKind =
  | "click" // کلیک روی یک سلکتور (دکمه/لینک).
  | "fill" // پر کردنِ یک فیلدِ ورودی با متن (از valueKey).
  | "select" // انتخابِ گزینه از منوی کشویی.
  | "upload" // پیوستِ فایل (رزومه).
  | "waitFor"; // انتظار تا ظاهرشدنِ یک سلکتور (هم‌گام‌سازیِ SPA/مرحله‌ای).

/**
 * Where a fill/select/upload step gets its value — a reference into the
 * executor-injected data (the runner provides the actual cover-letter text etc.;
 * the spec never carries raw values).
 */
export type ApplyValueKey =
  | "coverLetter"
  | "resumeFile"
  | "resumeFileName"
  | "fullName"
  | "phone"
  | "email";

/** One declarative step in the apply flow (interpreted by the executor). */
export interface ApplyStep {
  kind: ApplyStepKind;
  /** CSS selector this step targets. */
  selector: string;
  /** For fill/select/upload: which value the executor injects. */
  valueKey?: ApplyValueKey;
  /** Human note (logs/debug/UI). Never a value. */
  note?: string;
  /** Whether a missing selector is an error or an optional step (e.g. cover letter). */
  optional?: boolean;
  /** Conditional step: run only when this value is present (per-job custom résumé upload path). */
  requiresValueKey?: ApplyValueKey;
}

/** Full apply spec for one board — the shared contract for extension + worker. */
export interface BoardApplySpec {
  board: ApplyBoardId;
  /**
   * Maturity:
   *   • "best-effort" — selectors guessed from the board's real form structure.
   *   • "scaffold"    — placeholder selectors; must be verified with a real account.
   */
  maturity: "best-effort" | "scaffold";
  /** URL pattern of a job posting page this spec applies to (content-script match). */
  urlPattern: RegExp;
  /** The button that STARTS the apply flow on the posting page. */
  applyButtonSelector: string;
  /** The cover-letter field (when present) — optional, not all boards have one. */
  coverLetterFieldSelector?: string;
  /** The FINAL submit button. */
  submitSelector: string;
  /** Success-state selector ("your application was submitted") to confirm outcome. */
  confirmSelector?: string;
  /** Ordered steps (executor runs them in order). */
  steps: ApplyStep[];
  /** Implementation notes/warnings. */
  notes?: string[];
}

/* ──────────────────────────────  jobinja  ──────────────────────────────── */
/**
 * jobinja — best-effort real. Server-rendered; "ارسال رزومه" opens a form/modal
 * with a "توضیحات/انگیزه‌نامه" field and a submit button. Selectors mirror the
 * Foundation spec (jobinja BEM: c-jobView*, c-applyForm*).
 */
const JOBINJA_SPEC: BoardApplySpec = {
  board: "jobinja",
  maturity: "best-effort",
  urlPattern: /^https:\/\/jobinja\.ir\/companies\/[^/]+\/jobs\/[A-Za-z0-9]+/,
  applyButtonSelector: ".c-slideToggle__mobileFormToggler button.c-btn--primary, .c-sticky-button__holder button.c-btn--primary",
  // jobinja انگیزه‌نامه ندارد — عمداً حذف شد (رزومه‌ی سفارشیِ هر شغل جایگزینش می‌شود، فاز ۵).
  submitSelector: "#apply-form input[type='submit'], #apply-form button[type='submit']",
  confirmSelector: ".js-flashMessageMsg, .c-flashMessage__message",
  steps: [
    {
      kind: "click",
      selector: ".c-slideToggle__mobileFormToggler button.c-btn--primary, .c-sticky-button__holder button.c-btn--primary",
      optional: true,
      note: "بازکردنِ فرم در موبایل؛ در دسکتاپ مخفی است و رد می‌شود.",
    },
    {
      kind: "waitFor",
      selector: "#apply-form",
      note: "انتظار تا رندرِ فرمِ اپلای (#apply-form).",
    },
    {
      kind: "click",
      selector: "#apply_choice_uploaded_cv",
      requiresValueKey: "resumeFile",
      note: "انتخابِ «آپلودِ رزومه»؛ نبودن این مسیر اپلای را متوقف می‌کند.",
    },
    {
      kind: "upload",
      selector: "#apply-form input[type='file']",
      valueKey: "resumeFile",
      note: "آپلودِ رزومه‌ی سفارشیِ هدف‌گیری‌شده‌ی این آگهی (PDF).",
    },
    {
      kind: "fill",
      selector: "#contactInp, input[name='telephone']",
      valueKey: "phone",
      optional: true,
      note: "شماره‌ی تماس — اگر از پیش پر نشده باشد.",
    },
    {
      kind: "click",
      selector: "#apply-form input[type='submit'], #apply-form button[type='submit']",
      note: "ثبتِ نهاییِ اپلای («ارسال رزومه»).",
    },
    {
      // فلشِ تأیید همیشه رندر نمی‌شود (زنده تأیید شد ۱۴۰۵/۰۴/۳۰) — یک ثبتِ واقعی ممکن است بی‌فلش
      // بماند. optional تا نبودِ فلش «submitted/تأییدنشده» شود (confirmed=false از confirmSelector)
      // نه «failed»ِ کاذب که می‌تواند retry → اپلایِ تکراری بسازد.
      kind: "waitFor",
      selector: ".js-flashMessageMsg, .c-flashMessage__message",
      optional: true,
      note: "تأییدِ ثبت (پیامِ فلش) — best-effort؛ نبودش شکست نیست.",
    },
  ],
  notes: [
    "نشستِ کوکیِ خودِ کاربر استفاده می‌شود (sessionShape=cookie).",
    "سلکتورها روی حسابِ زنده اعتبارسنجی شدند (۲۰۲۶-۰۷-۱۸)؛ jobinja انگیزه‌نامه ندارد.",
    "مسیرِ رزومه‌ی سفارشیِ هر شغل (آپلود) در فاز ۵ اضافه می‌شود.",
  ],
};

/* ──────────────────────────────  jobvision  ─────────────────────────────── */
/** JobVision native apply is handled by its board-specific content adapter. */
const JOBVISION_SPEC: BoardApplySpec = {
  board: "jobvision",
  maturity: "best-effort",
  urlPattern: /^https:\/\/(www\.)?jobvision\.ir\/jobs\/\d+/,
  applyButtonSelector: ".jvt-btn-send-resume",
  submitSelector: ".jvt-btn-send-resume",
  steps: [
    { kind: "click", selector: ".jvt-btn-send-resume", note: "Native profile-resume apply button." },
  ],
  notes: [
    "SPA با توکن در localStorage (sessionShape=token).",
    "JobVision uses its account-wide native profile resume; no per-job upload is performed.",
  ],
};

/* ────────────────────────────  e-estekhdam  ─────────────────────────────── */
/** e-estekhdam — scaffold (TODO(real-account)). Many ads are contact-in-text. */
const E_ESTEKHDAM_SPEC: BoardApplySpec = {
  board: "e-estekhdam",
  maturity: "best-effort",
  urlPattern: /^https:\/\/(www\.)?e-estekhdam\.com\/.+/,
  applyButtonSelector: "button",
  coverLetterFieldSelector: "textarea.inp-description",
  submitSelector: "button[type='submit']",
  steps: [
    {
      kind: "upload",
      selector: "input[type='file']",
      valueKey: "resumeFile",
      requiresValueKey: "resumeFile",
      note: "فایل PDF اختصاصی که توسط API ای‌استخدام ارسال می‌شود.",
    },
    {
      kind: "fill",
      selector: "textarea.inp-description",
      valueKey: "coverLetter",
      optional: true,
      note: "متن معرفی اختیاری که همراه رزومه ارسال می‌شود.",
    },
  ],
  notes: [
    "فقط آگهی‌های ATS با فرم داخلی وارد صف می‌شوند.",
    "اسکریپت محتوا فرم multipart رسمی سایت را با نشست فعال مرورگر ارسال می‌کند.",
  ],
};

/* ────────────────────────────  irantalent  ─────────────────────────────── */
/**
 * irantalent — native apply, driven by its board-specific content adapter
 * (content/apply/irantalent.ts) against IranTalent's own JSON API. The spec here
 * exists to carry the optional cover letter to that adapter;
 * the selectors describe the site's own easy-apply dialog for provenance, but the
 * adapter never clicks them.
 */
const IRANTALENT_SPEC: BoardApplySpec = {
  board: "irantalent",
  maturity: "best-effort",
  urlPattern: /^https:\/\/(www\.)?irantalent\.com\/(en\/)?job\/[^/]+\/\d+/,
  applyButtonSelector: "button.apply-button",
  coverLetterFieldSelector: "textarea",
  submitSelector: "button.apply-button",
  steps: [
    {
      kind: "fill",
      selector: "textarea",
      valueKey: "coverLetter",
      optional: true,
      note: "انگیزه‌نامه‌ی اختیاری همراهِ درخواست.",
    },
  ],
  notes: [
    "نشستِ کوکیِ خودِ کاربر استفاده می‌شود (sessionShape=cookie، auth_token_irantalent_new).",
    "ایران‌تلنت رزومه را از پروفایل/account-level خودش می‌فرستد؛ PDF اختصاصی هر آگهی آپلود نمی‌شود.",
    "آگهیِ بسته/اپلای‌شده یا سؤالاتِ غربالگری باعث توقف می‌شود.",
  ],
};

/* ─────────────────────────────  karboom  ───────────────────────────────── */
/**
 * karboom — ارسالِ رزومه از راهِ ویزارِد چندمرحله‌ایِ خودِ کاربوم، که آداپتورِ
 * اختصاصی‌اش (content/apply/karboom.ts) آن را دنبال می‌کند. برخلافِ ایران‌تلنت،
 * کاربوم در مرحله‌ی «انتخابِ رزومه» آپلودِ PDF مخصوصِ همان آگهی را می‌پذیرد، پس
 * رزومه‌ی اختصاصی واقعاً فرستاده می‌شود. سلکتورها فقط برای مستندسازیِ منشأ‌اند؛
 * آداپتور روی آن‌ها کلیک نمی‌کند.
 */
const KARBOOM_SPEC: BoardApplySpec = {
  board: "karboom",
  maturity: "best-effort",
  urlPattern: /^https:\/\/(www\.)?karboom\.io\/jobs\/[A-Za-z0-9_-]+/,
  applyButtonSelector: ".js-apply-job",
  coverLetterFieldSelector: "textarea[name=\"description\"]",
  submitSelector: ".js-apply-job-continue",
  steps: [
    {
      kind: "upload",
      selector: ".js-upload-pdf",
      valueKey: "resumeFile",
      note: "PDF اختصاصیِ همین آگهی، در مرحله‌ی select_resume ویزارد آپلود می‌شود.",
    },
    {
      kind: "fill",
      selector: "textarea[name=\"description\"]",
      valueKey: "coverLetter",
      optional: true,
      note: "متنِ معرفیِ اختیاری، اگر مرحله‌ای چنین فیلدی داشته باشد.",
    },
  ],
  notes: [
    "نشستِ کوکیِ خودِ کاربر استفاده می‌شود (sessionShape=cookie).",
    "ویزارد سرورگردان است: مرحله‌ی بعدی را خودِ کاربوم در پاسخ اعلام می‌کند.",
    "فرم‌های میانی با همان مقادیرِ پیش‌پرشده‌ی پروفایلِ کاربر پس فرستاده می‌شوند؛ داده‌ای ساخته نمی‌شود.",
    "اگر کاربوم فیلدی لازم بداند که پروفایل ندارد، با karboom_profile_incomplete متوقف می‌شویم.",
  ],
};

/** The full apply-spec map — source of truth for the extension executor. */
export const APPLY_SPEC: Record<ApplyBoardId, BoardApplySpec> = {
  jobinja: JOBINJA_SPEC,
  jobvision: JOBVISION_SPEC,
  "e-estekhdam": E_ESTEKHDAM_SPEC,
  irantalent: IRANTALENT_SPEC,
  karboom: KARBOOM_SPEC,
};

/** The apply spec for a board, or undefined if unsupported. */
export function getApplySpec(board: string): BoardApplySpec | undefined {
  return APPLY_SPEC[board as ApplyBoardId];
}

/** Does this board have a real "best-effort" spec (vs. only a scaffold)? */
export function isApplySpecReady(board: string): boolean {
  return getApplySpec(board)?.maturity === "best-effort";
}

/**
 * Which board spec matches this URL (for a content script deciding which spec to
 * apply to the current page). First match wins.
 */
export function matchApplySpecByUrl(url: string): BoardApplySpec | undefined {
  for (const spec of Object.values(APPLY_SPEC)) {
    if (spec.urlPattern.test(url)) return spec;
  }
  return undefined;
}
