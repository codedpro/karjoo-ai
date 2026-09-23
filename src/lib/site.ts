/**
 * هویت برند کارجو — یک‌جا، تا در کل سایت تکرار نشود.
 * Public, non-secret brand identity for karjoo-ai.
 */
import { ACTIVE_BOARDS, BOARD_LABELS } from "@/lib/apply/job-filter-options";

export const site = {
  name: "کارجو",
  nameEn: "Karjoo",
  tagline: "اپلای هوشمند کار با هوش مصنوعی",
  description:
    "کارجو با هوش مصنوعی، رزومه‌ی شما را با هزاران آگهی شغلی در جاب‌ویژن، جابینجا و دیگر سایت‌های کاریابی ایران تطبیق می‌دهد و به‌صورت خودکار برای شما اپلای می‌کند.",
  // آدرس عمومی سایت — کارجو عضوِ خانواده‌ی 1xAi است (زیر‌دامنه‌ی 1xai.ir).
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://karjoo.1xai.ir",
  locale: "fa-IR",
  dir: "rtl" as const,
  /**
   * سایت‌های کاریابی‌ای که کارجو واقعاً رویشان جست‌وجو و اپلای می‌کند — از همان فهرستِ
   * فیلترِ کاریاب، تا سایتی که فعال نیست هیچ‌جا به‌عنوانِ «پشتیبانی‌شده» نیاید.
   */
  boards: ACTIVE_BOARDS.map((id) => ({ id, name: BOARD_LABELS[id] })),
};
