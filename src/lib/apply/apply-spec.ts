/**
 * مشخصاتِ اعلانیِ اپلایِ هر سایت (APPLY_SPEC) — قاعده‌ی ۵ (CONTEXT/§۱۰).
 *
 * این یک نقشه‌ی *داده‌ایِ خالص* است (بدونِ DB/شبکه/راز و *بدونِ* "server-only") که هم
 * اسکریپتِ محتوای افزونه و هم بعداً نودِ کارگر آن را مصرف می‌کنند تا روی صفحه‌ی همان
 * سایت فرمِ اپلای را پر و ثبت کنند. خودِ ثبت کارِ executor (افزونه/کارگر) است؛ این فایل
 * فقط «کجا کلیک/چه فیلدی را پر کن» را به‌صورتِ سلکتور توصیف می‌کند.
 *
 * مرزِ §۱۰ (خطِ سرخ): اینجا هیچ چیزِ مربوط به دور زدنِ تشخیصِ ربات نیست — نه جعلِ
 * fingerprint، نه حلِ کپچا، نه چرخشِ هویت. صرفاً سلکتورهای فرمِ عمومیِ سایت‌اند که با
 * نشستِ *خودِ کاربر* پر می‌شوند (اقدام به‌عنوانِ کاربرِ مجاز).
 *
 * وضعیت: jobinja «best-effort واقعی» (سلکتورهای محتمل بر اساسِ ساختارِ فرمِ jobinja)؛
 * jobvision/e-estekhdam/irantalent داربست‌اند با TODO(real-account) چون فرمِ ثبتِ
 * احرازهویت‌شده‌شان بدونِ حسابِ واقعی قابلِ تأیید نیست.
 */

/** شناسه‌ی سایت‌هایی که APPLY_SPEC دارند — هم‌راستا با jobBoardEnum/registry. */
export type ApplyBoardId = "jobinja" | "jobvision" | "e-estekhdam" | "irantalent";

/** نوعِ یک گامِ تعاملی در جریانِ اپلای. */
export type ApplyStepKind =
  | "click" // کلیک روی یک سلکتور (دکمه/لینک).
  | "fill" // پر کردنِ یک فیلدِ ورودی با متن (از valueKey).
  | "select" // انتخابِ یک گزینه از منوی کشویی.
  | "upload" // پیوستِ فایل (رزومه) به یک input[type=file].
  | "waitFor"; // انتظار تا ظاهرشدنِ یک سلکتور (هم‌گام‌سازیِ SPA/مرحله‌ای).

/**
 * منبعِ مقدارِ یک گامِ fill/select/upload — اشاره به دادهٔ پروفایل/درفت که executor
 * تزریق می‌کند (هرگز سلکتور خودش مقدارِ خام را در bundle حمل نمی‌کند).
 */
export type ApplyValueKey =
  | "coverLetter" // انگیزه‌نامه‌ی درفت‌شده (از match).
  | "resumeFile" // فایلِ رزومه (برای گامِ upload).
  | "fullName"
  | "phone"
  | "email";

/** یک گامِ منفردِ جریانِ اپلای (اعلانی، قابلِ تفسیر توسطِ executor). */
export interface ApplyStep {
  kind: ApplyStepKind;
  /** سلکتورِ CSS هدفِ این گام. */
  selector: string;
  /** برای fill/select/upload: کدام مقدار از داده‌ی executor تزریق شود. */
  valueKey?: ApplyValueKey;
  /** توضیحِ انسانیِ گام (برای لاگ/دیباگ/UIِ افزونه). */
  note?: string;
  /** آیا نبودِ این سلکتور «خطا»ست یا گامِ اختیاری است (مثلاً انگیزه‌نامه که همه‌جا نیست)؟ */
  optional?: boolean;
}

/** مشخصاتِ کاملِ اپلایِ یک سایت — قراردادِ مشترکِ افزونه/کارگر. */
export interface BoardApplySpec {
  board: ApplyBoardId;
  /**
   * بلوغِ این مشخصات:
   *   • "best-effort" — سلکتورها بر اساسِ ساختارِ واقعیِ فرم حدس زده شده‌اند (jobinja).
   *   • "scaffold"    — داربست؛ سلکتورها placeholder‌اند و باید با حسابِ واقعی تأیید شوند.
   */
  maturity: "best-effort" | "scaffold";
  /** الگوی URLِ صفحه‌ی آگهی که این مشخصات روی آن اعمال می‌شود (برای match در content-script). */
  urlPattern: RegExp;
  /** دکمه‌ای که جریانِ اپلای را روی صفحه‌ی آگهی آغاز می‌کند. */
  applyButtonSelector: string;
  /** فیلدِ انگیزه‌نامه (در صورتِ وجود) — اختیاری چون همه‌ی سایت‌ها ندارند. */
  coverLetterFieldSelector?: string;
  /** دکمه‌ی نهاییِ ثبتِ اپلای. */
  submitSelector: string;
  /** سلکتورِ حالتِ موفقیت (پیامِ «درخواست شما ثبت شد») برای تأییدِ نتیجه. */
  confirmSelector?: string;
  /** گام‌های ترتیبیِ جریان (executor به‌ترتیب اجرا می‌کند). */
  steps: ApplyStep[];
  /** نکات/هشدارهای پیاده‌سازی (مثلاً «SPA است؛ waitFor لازم»). */
  notes?: string[];
}

/* ──────────────────────────────  jobinja  ──────────────────────────────── */
/**
 * jobinja — best-effort واقعی.
 *
 * jobinja صفحه‌ی آگهی را سمتِ سرور رندر می‌کند و اپلای با کلیکِ «ارسال رزومه» یک فرم/مودال
 * باز می‌کند که شاملِ فیلدِ «توضیحات/انگیزه‌نامه» و دکمه‌ی ثبت است. سلکتورها بر اساسِ
 * کلاس‌بندیِ BEMِ jobinja (c-jobView*, c-applyForm*) تخمین زده شده‌اند و باید با یک حسابِ
 * واقعی صحیح‌سنجی شوند، اما ساختارِ کلی پایدار است.
 */
const JOBINJA_SPEC: BoardApplySpec = {
  board: "jobinja",
  maturity: "best-effort",
  urlPattern: /^https:\/\/jobinja\.ir\/companies\/[^/]+\/jobs\/[A-Za-z0-9]+/,
  applyButtonSelector: "a.c-jobView__applyButton, button.c-jobView__applyButton",
  coverLetterFieldSelector: "textarea[name='application[body]'], textarea.c-applyForm__message",
  submitSelector: "form.c-applyForm button[type='submit'], button.c-applyForm__submit",
  confirmSelector: ".c-applyForm__success, .c-flashMessage--success",
  steps: [
    {
      kind: "click",
      selector: "a.c-jobView__applyButton, button.c-jobView__applyButton",
      note: "بازکردنِ فرمِ ارسالِ رزومه.",
    },
    {
      kind: "waitFor",
      selector: "form.c-applyForm",
      note: "انتظار تا رندرِ فرمِ اپلای.",
    },
    {
      kind: "fill",
      selector: "textarea[name='application[body]'], textarea.c-applyForm__message",
      valueKey: "coverLetter",
      optional: true,
      note: "انگیزه‌نامه — اگر فیلد موجود بود پر می‌شود.",
    },
    {
      kind: "click",
      selector: "form.c-applyForm button[type='submit'], button.c-applyForm__submit",
      note: "ثبتِ نهاییِ اپلای.",
    },
    {
      kind: "waitFor",
      selector: ".c-applyForm__success, .c-flashMessage--success",
      note: "تأییدِ ثبتِ موفق.",
    },
  ],
  notes: [
    "نشستِ کوکیِ خودِ کاربر استفاده می‌شود (sessionShape=cookie).",
    "سلکتورها best-effort‌اند؛ پیش از انتشار با یک حسابِ واقعیِ jobinja صحت‌سنجی شوند.",
  ],
};

/* ──────────────────────────────  jobvision  ─────────────────────────────── */
/**
 * jobvision — داربست (TODO(real-account)).
 *
 * jobvision یک SPA است و توکنِ احراز در localStorage می‌نشیند (نه کوکی)؛ فرمِ اپلای
 * پویا رندر می‌شود، پس waitFor ضروری است. سلکتورها placeholder‌اند تا با حسابِ واقعی پر شوند.
 */
const JOBVISION_SPEC: BoardApplySpec = {
  board: "jobvision",
  maturity: "scaffold",
  urlPattern: /^https:\/\/(www\.)?jobvision\.ir\/jobs\/\d+/,
  // TODO(real-account): سلکتورهای واقعیِ دکمه‌ی «ارسال رزومه»ی jobvision.
  applyButtonSelector: "[data-test='apply-button']",
  coverLetterFieldSelector: "[data-test='cover-letter']",
  submitSelector: "[data-test='apply-submit']",
  confirmSelector: "[data-test='apply-success']",
  steps: [
    {
      kind: "click",
      selector: "[data-test='apply-button']",
      note: "TODO(real-account): دکمه‌ی شروعِ اپلای.",
    },
    {
      kind: "waitFor",
      selector: "[data-test='apply-form']",
      note: "TODO(real-account): انتظار تا رندرِ فرمِ SPA.",
    },
    {
      kind: "fill",
      selector: "[data-test='cover-letter']",
      valueKey: "coverLetter",
      optional: true,
      note: "TODO(real-account): فیلدِ انگیزه‌نامه.",
    },
    {
      kind: "click",
      selector: "[data-test='apply-submit']",
      note: "TODO(real-account): ثبتِ نهایی.",
    },
  ],
  notes: [
    "SPA با توکن در localStorage (sessionShape=token) — capture با content-script.",
    "TODO(real-account): همه‌ی سلکتورها با حسابِ واقعیِ jobvision صحت‌سنجی شوند.",
  ],
};

/* ────────────────────────────  e-estekhdam  ─────────────────────────────── */
/**
 * e-estekhdam — داربست (TODO(real-account)).
 *
 * بسیاری از آگهی‌های e-estekhdam «تماس از طریقِ متن» (applyType=contact) هستند؛ برای
 * آگهی‌های دارای فرمِ ساختاریافته این داربست استفاده می‌شود. سلکتورها placeholder‌اند.
 */
const E_ESTEKHDAM_SPEC: BoardApplySpec = {
  board: "e-estekhdam",
  maturity: "scaffold",
  urlPattern: /^https:\/\/(www\.)?e-estekhdam\.com\/.+/,
  // TODO(real-account): سلکتورهای واقعیِ فرمِ اپلایِ e-estekhdam.
  applyButtonSelector: ".job-apply-btn",
  coverLetterFieldSelector: "textarea[name='message']",
  submitSelector: "form.apply-form button[type='submit']",
  confirmSelector: ".apply-success",
  steps: [
    {
      kind: "click",
      selector: ".job-apply-btn",
      note: "TODO(real-account): شروعِ اپلای (برای آگهیِ ساختاریافته).",
    },
    {
      kind: "fill",
      selector: "textarea[name='message']",
      valueKey: "coverLetter",
      optional: true,
      note: "TODO(real-account): پیام/انگیزه‌نامه.",
    },
    {
      kind: "click",
      selector: "form.apply-form button[type='submit']",
      note: "TODO(real-account): ثبت.",
    },
  ],
  notes: [
    "بسیاری از آگهی‌ها contact-in-text‌اند (applyType=contact) و این جریان روی آن‌ها اعمال نمی‌شود.",
    "TODO(real-account): سلکتورها با حسابِ واقعی صحت‌سنجی شوند.",
  ],
};

/* ────────────────────────────  irantalent  ─────────────────────────────── */
/**
 * irantalent — داربست (TODO(real-account)). شکلِ نشست/فرم هنوز TBD است (§۷).
 */
const IRANTALENT_SPEC: BoardApplySpec = {
  board: "irantalent",
  maturity: "scaffold",
  urlPattern: /^https:\/\/(www\.)?irantalent\.com\/.+/,
  // TODO(real-account): سلکتورهای واقعیِ فرمِ اپلایِ irantalent.
  applyButtonSelector: "[data-qa='apply-button']",
  coverLetterFieldSelector: "[data-qa='cover-letter']",
  submitSelector: "[data-qa='apply-submit']",
  confirmSelector: "[data-qa='apply-success']",
  steps: [
    {
      kind: "click",
      selector: "[data-qa='apply-button']",
      note: "TODO(real-account): شروعِ اپلای.",
    },
    {
      kind: "waitFor",
      selector: "[data-qa='apply-form']",
      note: "TODO(real-account): انتظار تا فرم.",
    },
    {
      kind: "fill",
      selector: "[data-qa='cover-letter']",
      valueKey: "coverLetter",
      optional: true,
      note: "TODO(real-account): انگیزه‌نامه.",
    },
    {
      kind: "click",
      selector: "[data-qa='apply-submit']",
      note: "TODO(real-account): ثبت.",
    },
  ],
  notes: [
    "شکلِ نشست/فرم TBD (§۷ سند معماری).",
    "TODO(real-account): همه‌ی سلکتورها با حسابِ واقعی صحت‌سنجی شوند.",
  ],
};

/** نقشه‌ی مشخصاتِ اپلایِ همه‌ی سایت‌ها — منبعِ حقیقت برای افزونه/کارگر. */
export const APPLY_SPEC: Record<ApplyBoardId, BoardApplySpec> = {
  jobinja: JOBINJA_SPEC,
  jobvision: JOBVISION_SPEC,
  "e-estekhdam": E_ESTEKHDAM_SPEC,
  irantalent: IRANTALENT_SPEC,
};

/** مشخصاتِ اپلایِ یک سایت را برمی‌گرداند، یا undefined اگر سایت پشتیبانی نشود. */
export function getApplySpec(board: string): BoardApplySpec | undefined {
  return APPLY_SPEC[board as ApplyBoardId];
}

/** آیا برای این سایت مشخصاتِ «best-effort واقعی» داریم (در برابرِ صرفاً داربست)؟ */
export function isApplySpecReady(board: string): boolean {
  return getApplySpec(board)?.maturity === "best-effort";
}

/**
 * تشخیص می‌دهد یک URL با کدام مشخصاتِ سایت تطبیق می‌خورد (برای content-scriptِ افزونه
 * که باید بداند روی صفحه‌ی فعلی کدام spec را اعمال کند). اولین تطبیق برگردانده می‌شود.
 */
export function matchApplySpecByUrl(url: string): BoardApplySpec | undefined {
  for (const spec of Object.values(APPLY_SPEC)) {
    if (spec.urlPattern.test(url)) return spec;
  }
  return undefined;
}
