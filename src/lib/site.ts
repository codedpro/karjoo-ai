/**
 * هویت برند کارجو — یک‌جا، تا در کل سایت تکرار نشود.
 * Public, non-secret brand identity for karjoo-ai.
 */
export const site = {
  name: "کارجو",
  nameEn: "Karjoo",
  tagline: "اپلای هوشمند کار با هوش مصنوعی",
  description:
    "کارجو با هوش مصنوعی، رزومه‌ی شما را با هزاران آگهی شغلی در جاب‌ویژن، جابینجا و دیگر سایت‌های کاریابی ایران تطبیق می‌دهد و به‌صورت خودکار برای شما اپلای می‌کند.",
  // آدرس عمومی سایت — هنگام استقرار به‌روزرسانی شود.
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://karjoo.ai",
  locale: "fa-IR",
  dir: "rtl" as const,
  /** پلتفرم‌های کاریابی پشتیبانی‌شده (هدفِ اپلای خودکار). */
  boards: [
    { name: "جاب‌ویژن", en: "JobVision" },
    { name: "جابینجا", en: "Jobinja" },
    { name: "ای‌استخدام", en: "E-estekhdam" },
    { name: "کاربوم", en: "Karboom" },
    { name: "لینکدین", en: "LinkedIn" },
  ],
} as const;
