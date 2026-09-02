import "server-only";

/**
 * رجیستریِ کانکتورهای سایت‌های کاریابی — ماژولِ برگ (leaf).
 *
 * چرا جدا از index.ts؟ index.ts بشکه‌ی (barrel) عمومیِ این دامنه است و
 * orchestrator.ts را هم صادر مجدد می‌کند؛ اما orchestrator خودش به رجیستری نیاز دارد.
 * اگر رجیستری داخلِ index.ts می‌ماند، چرخه‌ی import (index → orchestrator → index)
 * شکل می‌گرفت. با گذاشتنِ رجیستری در این ماژولِ برگ، هم index و هم orchestrator
 * مستقیماً از اینجا import می‌کنند و چرخه‌ای نیست.
 */
import { eEstekhdam } from "@/lib/apply/boards/e-estekhdam";
import { irantalent } from "@/lib/apply/boards/irantalent";
import { jobinja } from "@/lib/apply/boards/jobinja";
import { jobvision } from "@/lib/apply/boards/jobvision";
import type { JobBoardConnector, JobBoardId } from "@/lib/apply/types";

/**
 * ثبت کانکتورها — افزودن سایت کاریابی تازه = یک ورودی اینجا.
 *
 * کانکتور فقط برای سایت‌هایی ثبت می‌شود که اجرای واقعی دارند. providerهای بعدی در
 * PROVIDER_CAPABILITIES شناخته می‌شوند، اما تا زمان ساخت آداپتور اینجا connector ندارند.
 */
export const connectors: Record<string, JobBoardConnector> = {
  [jobvision.id]: jobvision,
  [jobinja.id]: jobinja,
  [eEstekhdam.id]: eEstekhdam,
  [irantalent.id]: irantalent,
};

export function getConnector(id: JobBoardId): JobBoardConnector | undefined {
  return connectors[id];
}

/**
 * وضعیتِ آماده‌به‌کار بودنِ هر سایت — **تنها منبعِ حقیقت** برای «آیا این سایت واقعاً
 * کار می‌کند؟». عمداً اینجا (نه داخلِ لیترالِ هر کانکتور در boards/*.ts) نگه داشته
 * می‌شود تا افزودنِ این پرچم به تداخلِ فایل با ترک‌های دیگر نینجامد.
 *
 *   • `live`           — search()/apply()ِ سمتِ سرور واقعاً پیاده شده‌اند (فقط جابینجا).
 *   • `extension_only` — کانکتورِ سرور داربست است، اما آداپتورِ افزونه روی نشستِ
 *                        خودِ کاربر کار می‌کند؛ پس اتصال معنا دارد.
 *   • `coming_soon`    — نه سرور نه افزونه؛ اتصال رد می‌شود.
 *
 * `Record<JobBoardId, …>` عمداً روی کلِ یونیونِ JobBoardId جامع است؛ اگر شناسه‌ی
 * تازه‌ای به یونیون اضافه شود، TypeScript تا زمانِ افزودنِ وضعیتِ آن اینجا کامپایل
 * نمی‌شود (fail-safe: پیش‌فرضِ ضمنی «زنده» وجود ندارد).
 */
export const BOARD_STATUS: Record<JobBoardId, "live" | "extension_only" | "coming_soon"> = {
  jobinja: "live",
  jobvision: "extension_only",
  "e-estekhdam": "extension_only",
  irantalent: "extension_only",
  karboom: "extension_only",
  linkedin: "coming_soon",
  iranestekhdam: "coming_soon",
  divar: "coming_soon",
  quera: "coming_soon",
  remoteok: "coming_soon",
  weworkremotely: "coming_soon",
  ponisha: "coming_soon",
  parscoders: "coming_soon",
  bankestekhdam: "coming_soon",
};

export type ProviderWorkflowState = "live" | "in_progress" | "planned";

export interface ProviderCapability {
  id: JobBoardId;
  displayName: string;
  publicName: string;
  publicVisible: boolean;
  workflowState: ProviderWorkflowState;
  discovery: boolean;
  applicationSync: boolean;
  easyApply: boolean;
  autoApply: boolean;
  sessionShape: "cookie" | "token";
  note: string;
}

export const PROVIDER_CAPABILITIES: Record<JobBoardId, ProviderCapability> = {
  jobinja: {
    id: "jobinja",
    displayName: "جابینجا",
    publicName: "Jobinja",
    publicVisible: true,
    workflowState: "live",
    discovery: true,
    applicationSync: true,
    easyApply: true,
    autoApply: true,
    sessionShape: "cookie",
    note: "جریان کامل جست‌وجو، همگام‌سازی و اپلای فعال است.",
  },
  jobvision: {
    id: "jobvision",
    displayName: "جاب‌ویژن",
    publicName: "JobVision",
    publicVisible: true,
    workflowState: "in_progress",
    discovery: true,
    applicationSync: true,
    easyApply: true,
    autoApply: true,
    sessionShape: "token",
    note: "مسیر افزونه فعال است و تا تأیید کامل سرور در حال تکمیل می‌ماند.",
  },
  "e-estekhdam": {
    id: "e-estekhdam",
    displayName: "ای‌استخدام",
    publicName: "E-estekhdam",
    publicVisible: true,
    workflowState: "in_progress",
    discovery: true,
    applicationSync: true,
    easyApply: true,
    autoApply: true,
    sessionShape: "cookie",
    note: "جریان افزونه فعال است و مسیر کامل ارائه‌دهنده مرحله‌ای تکمیل می‌شود.",
  },
  irantalent: {
    id: "irantalent",
    displayName: "ایران‌تلنت",
    publicName: "IranTalent",
    publicVisible: true,
    workflowState: "in_progress",
    discovery: true,
    applicationSync: true,
    easyApply: true,
    autoApply: true,
    sessionShape: "cookie",
    note: "با رزومه‌ی پروفایل خود ایران‌تلنت ارسال می‌شود و مسیر افزونه/سرور در حال تکمیل است.",
  },
  karboom: {
    id: "karboom",
    displayName: "کاربوم",
    publicName: "Karboom",
    publicVisible: true,
    workflowState: "in_progress",
    discovery: true,
    applicationSync: true,
    easyApply: true,
    autoApply: true,
    sessionShape: "cookie",
    note: "مسیر افزونه فعال است؛ رزومه‌ی اختصاصیِ هر آگهی در ویزارد کاربوم آپلود می‌شود.",
  },
  iranestekhdam: {
    id: "iranestekhdam",
    displayName: "ایران استخدام",
    publicName: "IranEstekhdam",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "مرجع فعال آگهی‌های خصوصی و دولتی؛ آداپتور جست‌وجو و سوابق در صف ساخت است.",
  },
  divar: {
    id: "divar",
    displayName: "دیوار",
    publicName: "Divar Jobs",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "بازار بزرگ آگهی‌های استخدام محلی؛ اتصال با محدودیت‌های ضداسپم باید جداگانه طراحی شود.",
  },
  quera: {
    id: "quera",
    displayName: "کوئرا مگنت",
    publicName: "Quera Magnet",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "منبع تخصصی فرصت‌های فنی و برنامه‌نویسی؛ اولویت مناسب برای کشف شغل‌های tech.",
  },
  remoteok: {
    id: "remoteok",
    displayName: "RemoteOK",
    publicName: "RemoteOK",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "فید بین‌المللی فرصت‌های remote؛ برای کشف و بازکردن در سایت مقصد مناسب است.",
  },
  weworkremotely: {
    id: "weworkremotely",
    displayName: "We Work Remotely",
    publicName: "We Work Remotely",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "منبع remote-first بین‌المللی؛ شروع خوب برای discovery بدون اپلای خودکار.",
  },
  ponisha: {
    id: "ponisha",
    displayName: "پونیشا",
    publicName: "Ponisha",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "بازار پروژه و فریلنس؛ رفتار آن از job board استخدامی جداگانه مدل می‌شود.",
  },
  parscoders: {
    id: "parscoders",
    displayName: "پارس‌کدرز",
    publicName: "Parscoders",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "بازار پروژه‌های فریلنس؛ برای مسیر project-board جدا از استخدام تمام‌وقت مناسب است.",
  },
  bankestekhdam: {
    id: "bankestekhdam",
    displayName: "بانک استخدام",
    publicName: "Bank Estekhdam",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "تجمیع‌کننده و خبرخوان استخدام؛ احتمالاً ابتدا فقط discovery/open-in-provider می‌گیرد.",
  },
  linkedin: {
    id: "linkedin",
    displayName: "لینکدین",
    publicName: "LinkedIn",
    publicVisible: true,
    workflowState: "planned",
    discovery: false,
    applicationSync: false,
    easyApply: false,
    autoApply: false,
    sessionShape: "cookie",
    note: "در نقشه‌ی راه اتصال‌های بعدی است.",
  },
};

/**
 * آیا سایتِ داده‌شده واقعاً کار می‌کند؟ ورودی `string` است (نه JobBoardId) تا در
 * مرزهای اعتبارسنجی (مثلِ بدنه‌ی درخواست) بدونِ cast قابلِ استفاده باشد؛ شناسه‌ی
 * ناشناخته → `false` (fail-closed).
 */
export function isBoardLive(id: string): boolean {
  return PROVIDER_CAPABILITIES[id as JobBoardId]?.workflowState === "live";
}

/** Boards that can be connected in the extension, including browser-only adapters. */
export function isBoardConnectable(id: string): boolean {
  const status = BOARD_STATUS[id as JobBoardId];
  return status === "live" || status === "extension_only";
}

/** فهرستِ شناسه‌ی سایت‌هایی که واقعاً کار می‌کنند — درزِ یکپارچگی برای orchestrator. */
export function liveBoardIds(): JobBoardId[] {
  return (Object.keys(PROVIDER_CAPABILITIES) as JobBoardId[]).filter((id) => isBoardLive(id));
}

export function providerCapabilities(): ProviderCapability[] {
  return Object.values(PROVIDER_CAPABILITIES);
}

export function publicProviderCapabilities(): ProviderCapability[] {
  return providerCapabilities().filter((provider) => provider.publicVisible);
}
