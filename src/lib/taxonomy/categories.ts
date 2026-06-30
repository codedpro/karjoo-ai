/**
 * تاکسونومیِ دسته‌بندیِ مشاغلِ بازارِ کارِ ایران (WF1) — منبعِ حقیقتِ seed.
 *
 * این فهرستِ خالص (بدونِ DB/شبکه) جدولِ job_categories را seed می‌کند و عناوینِ
 * موردنظرِ کاربر را به JobPreferences (titles/categories) که جست‌وجو/تطبیق از آن
 * استفاده می‌کند، نگاشت می‌دهد. هر دسته یک slugِ پایدار (در URL/فیلتر) و برچسبِ
 * دوزبانه (فارسی/انگلیسی) دارد. عمداً تک‌سطحی (parent ندارد) برای سادگی؛ ساختار از
 * زیرشاخه پشتیبانی می‌کند (jobCategories.parentId) و بعداً قابلِ گسترش است.
 *
 * این ماژول «server-only» نیست تا هم در اسکریپتِ seed (سرور) و هم در UI/تست استفاده شود.
 */

/** یک ورودیِ دسته‌بندیِ شغلی در تاکسونومیِ seed. */
export interface CategorySeed {
  /** شناسه‌ی پایدارِ یکتا (kebab-case، در URL/فیلتر). */
  slug: string;
  /** برچسبِ فارسی (نمایش به کاربر). */
  labelFa: string;
  /** برچسبِ انگلیسی. */
  labelEn: string;
  /** ترتیبِ نمایش (کوچک‌تر = بالاتر). */
  sortOrder: number;
}

/**
 * ~۲۵ دسته‌ی متداولِ بازارِ کارِ ایران. ترتیب با sortOrder کنترل می‌شود تا UI پایدار بماند.
 * افزودنِ دسته = یک ردیفِ تازه با slugِ یکتا (هرگز slugِ موجود را تغییر نده — مرجعِ
 * انتخاب‌های کاربر است).
 */
export const JOB_CATEGORY_SEED: readonly CategorySeed[] = [
  { slug: "software-development", labelFa: "برنامه‌نویسی و توسعهٔ نرم‌افزار", labelEn: "Software Development", sortOrder: 10 },
  { slug: "it-network", labelFa: "فناوری اطلاعات و شبکه", labelEn: "IT & Networking", sortOrder: 20 },
  { slug: "data-ai", labelFa: "داده و هوش مصنوعی", labelEn: "Data & AI", sortOrder: 30 },
  { slug: "devops-cloud", labelFa: "دواپس و زیرساخت ابری", labelEn: "DevOps & Cloud", sortOrder: 40 },
  { slug: "cybersecurity", labelFa: "امنیت سایبری", labelEn: "Cybersecurity", sortOrder: 50 },
  { slug: "product-management", labelFa: "مدیریت محصول", labelEn: "Product Management", sortOrder: 60 },
  { slug: "graphic-ui-design", labelFa: "طراحی گرافیک و رابط کاربری", labelEn: "Graphic & UI/UX Design", sortOrder: 70 },
  { slug: "marketing-sales", labelFa: "بازاریابی و فروش", labelEn: "Marketing & Sales", sortOrder: 80 },
  { slug: "digital-marketing", labelFa: "بازاریابی دیجیتال", labelEn: "Digital Marketing", sortOrder: 90 },
  { slug: "content-translation", labelFa: "تولید محتوا و ترجمه", labelEn: "Content & Translation", sortOrder: 100 },
  { slug: "finance-accounting", labelFa: "مالی و حسابداری", labelEn: "Finance & Accounting", sortOrder: 110 },
  { slug: "banking-insurance", labelFa: "بانکداری و بیمه", labelEn: "Banking & Insurance", sortOrder: 120 },
  { slug: "management-business", labelFa: "مدیریت و کسب‌وکار", labelEn: "Management & Business", sortOrder: 130 },
  { slug: "human-resources", labelFa: "منابع انسانی", labelEn: "Human Resources", sortOrder: 140 },
  { slug: "customer-support", labelFa: "پشتیبانی مشتریان", labelEn: "Customer Support", sortOrder: 150 },
  { slug: "civil-engineering", labelFa: "مهندسی عمران", labelEn: "Civil Engineering", sortOrder: 160 },
  { slug: "mechanical-engineering", labelFa: "مهندسی مکانیک", labelEn: "Mechanical Engineering", sortOrder: 170 },
  { slug: "electrical-engineering", labelFa: "مهندسی برق", labelEn: "Electrical Engineering", sortOrder: 180 },
  { slug: "industrial-engineering", labelFa: "مهندسی صنایع", labelEn: "Industrial Engineering", sortOrder: 190 },
  { slug: "architecture", labelFa: "معماری", labelEn: "Architecture", sortOrder: 200 },
  { slug: "healthcare-medical", labelFa: "سلامت و پزشکی", labelEn: "Healthcare & Medical", sortOrder: 210 },
  { slug: "education-teaching", labelFa: "آموزش و تدریس", labelEn: "Education & Teaching", sortOrder: 220 },
  { slug: "legal", labelFa: "حقوقی", labelEn: "Legal", sortOrder: 230 },
  { slug: "logistics-supply-chain", labelFa: "لجستیک و زنجیرهٔ تأمین", labelEn: "Logistics & Supply Chain", sortOrder: 240 },
  { slug: "manufacturing-production", labelFa: "تولید و صنعت", labelEn: "Manufacturing & Production", sortOrder: 250 },
  { slug: "hospitality-tourism", labelFa: "گردشگری و هتلداری", labelEn: "Hospitality & Tourism", sortOrder: 260 },
] as const;

/** همه‌ی slugها — برای اعتبارسنجی/تست (یکتایی) و انتخابِ کاربر. */
export const JOB_CATEGORY_SLUGS: readonly string[] = JOB_CATEGORY_SEED.map((c) => c.slug);

/** نگاشتِ slug → ورودیِ دسته، برای lookupِ سریع (مثلاً تبدیلِ انتخاب به برچسب/عنوان). */
export const JOB_CATEGORY_BY_SLUG: ReadonlyMap<string, CategorySeed> = new Map(
  JOB_CATEGORY_SEED.map((c) => [c.slug, c] as const),
);

/** آیا این slug یک دسته‌ی معتبرِ تاکسونومی است؟ */
export function isValidCategorySlug(slug: string): boolean {
  return JOB_CATEGORY_BY_SLUG.has(slug);
}
