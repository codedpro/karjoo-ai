/**
 * One vocabulary for every board.
 *
 * Each board describes a job differently: Jobinja puts "تهران، تهران" in the
 * city, JobVision hands us a schema.org category label, IranTalent numeric
 * category ids, Karboom only the facet we happened to search. A job finder that
 * filters on those raw fields cannot offer one filter that means the same thing
 * everywhere — "Tehran", "remote" or "software" would each mean something
 * different per site.
 *
 * So every listing is described in ONE vocabulary, derived the same way for all
 * boards from what every board has — the title (and the description where the
 * board supplies one):
 *
 *   • category       — a slug from the site-wide taxonomy (lib/taxonomy)
 *   • employmentType — full_time | part_time | project | internship
 *   • remote         — the job can be done remotely
 *   • city           — a clean Persian city name
 *
 * Pure and deterministic: the same listing always gets the same attributes, so
 * filters are stable and testable. Unknown stays null — a job we cannot place is
 * shown under "all", never forced into a wrong bucket.
 */
/** A slug from the site-wide taxonomy (lib/taxonomy/categories). */
export type JobCategorySlug = string;

export type EmploymentType = "full_time" | "part_time" | "project" | "internship";

export interface ListingAttributes {
  category: JobCategorySlug | null;
  employmentType: EmploymentType | null;
  remote: boolean;
  city: string | null;
}

/** Normalise Persian/Arabic variants and spacing so keywords match reliably. */
export function normalizeText(value: string | null | undefined): string {
  return ` ${(value ?? "")
    .toLowerCase()
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[‌‏‎]/g, " ")
    .replace(/[ً-ٟ]/g, "")
    .replace(/[-_/|،,()[\]{}.:;!؟?«»"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

const PERSIAN = /[\u0600-\u06FF]/;
/**
 * Persian words take suffixes a keyword list cannot enumerate: «محتوای»,
 * «دندانپزشکی», «برنامه‌نویسان». A plain word match missed them — «تولید محتوای
 * اینستاگرام» fell through to "manufacturing" on «تولید». Persian keywords
 * therefore also match with the common suffixes; Latin ones stay exact, so "it"
 * never matches "item".
 */
const PERSIAN_SUFFIX = "(?:ی|ها|های|ای|ان|یان|ین|هایی)?";
const matcherCache = new Map<string, RegExp>();

function matcher(keyword: string): RegExp {
  let re = matcherCache.get(keyword);
  if (!re) {
    const k = normalizeText(keyword).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(PERSIAN.test(k) ? ` ${k}${PERSIAN_SUFFIX} ` : ` ${k} `);
    matcherCache.set(keyword, re);
  }
  return re;
}

/** Word-ish match of a keyword in normalised text (suffix-tolerant for Persian). */
function has(text: string, keyword: string): boolean {
  return matcher(keyword).test(text);
}

/**
 * Category rules, MOST SPECIFIC FIRST — the first match wins. Order matters:
 * «مدیر محصول» must hit product management before the generic «مدیر», and
 * «تست نرم افزار» must stay software before «کنترل کیفیت» reaches production.
 */
const CATEGORY_RULES: Array<[JobCategorySlug, string[]]> = [
  ["product-management", ["مدیر محصول", "مالک محصول", "product manager", "product owner", "scrum master", "اسکرام مستر"]],
  ["cybersecurity", ["امنیت سایبری", "امنیت شبکه", "امنیت اطلاعات", "مرکز عملیات امنیت", "تست نفوذ", "رمزنگاری", "امنیت", "security", "soc", "pentest", "penetration tester"]],
  ["devops-cloud", ["devops", "دواپس", "sre", "kubernetes", "cloud", "زیرساخت", "لینوکس", "linux", "دیتاسنتر", "دیتا سنتر"]],
  ["data-ai", ["بینایی ماشین", "هوش مصنوعی", "یادگیری ماشین", "هوش تجاری", "پردازش زبان", "تحلیلگر داده", "تحلیل داده", "علم داده", "دیتا", "داده", "data", "ai", "nlp", "machine learning", "bi", "deep learning"]],
  ["digital-marketing", ["دیجیتال مارکتینگ", "دیجیتال مارکتر", "سئو", "seo", "sem", "ppc", "digital marketing", "سوشال مدیا", "شبکه های اجتماعی", "ادمین اینستاگرام", "ادمین سایت", "گوگل ادز", "performance marketing", "ecrm"]],
  ["graphic-ui-design", ["ویدئو گرافی", "ویدیوگرافی", "طراح رابط", "تجربه کاربری", "ui", "ux", "طراح گرافیک", "گرافیست", "گرافیک", "graphic", "موشن گرافیست", "motion", "designer", "design lead", "product designer", "تدوینگر", "فیلمبردار", "عکاس"]],
  ["software-development", [
    "sqa", "برنامه نویس", "برنامه نویسی", "توسعه دهنده", "مهندس نرم افزار", "نرم افزار", "تست نرم افزار",
    "فرانت اند", "فرانت", "بک اند", "بکند", "فول استک", "developer", "programmer", "software",
    "frontend", "front end", "backend", "back end", "full stack", "fullstack", "react", "node",
    "python", "php", "laravel", "java", "net", "android", "اندروید", "ios", "flutter", "django",
    "golang", "go", "وردپرس", "wordpress", "qa", "unity", "bpms",
  ]],
  ["it-network", ["شبکه", "network", "فناوری اطلاعات", "helpdesk", "help desk", "هلپ دسک", "پشتیبانی فنی", "سخت افزار", "تکنسین کامپیوتر", "it"]],
  ["content-translation", ["تولید محتوا", "تولیدمحتوا", "محتوا", "content", "نویسنده", "کپی رایتر", "copywriter", "مترجم", "ترجمه", "translator", "ویراستار", "گوینده"]],
  ["human-resources", ["منابع انسانی", "کارگزینی", "امور کارکنان", "جذب و استخدام", "جذب نیرو", "hr", "recruiter", "talent"]],
  ["finance-accounting", ["حسابدار", "حسابداری", "حسابرس", "مالی", "خزانه دار", "معامله گر", "تریدر", "فارکس", "ارز دیجیتال", "ارزهای دیجیتال", "بورس", "accountant", "accounting", "finance", "audit", "trader"]],
  ["banking-insurance", ["بانک", "بانکداری", "بیمه", "banking", "insurance"]],
  ["legal", ["حقوقی", "وکیل", "مشاور حقوقی", "legal", "lawyer"]],
  ["healthcare-medical", ["پزشک", "پرستار", "دندانپزشک", "دندان", "داروساز", "دارویی", "بهداشت", "ماما", "فیزیوتراپ", "آزمایشگاه", "کلینیک", "medical", "nurse"]],
  ["customer-support", ["مرکزتماس", "پشتیبانی", "خدمات مشتریان", "ارتباط با مشتری", "ارتباط با مشتریان", "مرکز تماس", "کال سنتر", "اپراتور تلفن", "پاسخگوی تلفن", "پاسخگو", "crm", "support", "call center", "customer service"]],
  ["marketing-sales", ["برند", "brand", "campaign", "کمپین", "فروش", "فروشنده", "فروشگاه", "بازاریاب", "بازاریابی", "مارکتینگ", "ویزیتور", "توسعه بازار", "توسعه کسب و کار", "توسعه کسب وکار", "sales", "marketing", "business development"]],
  ["architecture", ["معمار", "معماری", "طراح داخلی", "دکوراسیون", "architect"]],
  ["civil-engineering", ["عمران", "سازه", "نقشه بردار", "civil"]],
  ["mechanical-engineering", ["مکانیک", "تاسیسات", "تأسیسات", "mechanical"]],
  ["electrical-engineering", ["برق", "الکترونیک", "ابزار دقیق", "electrical", "electronics"]],
  ["industrial-engineering", ["مهندسی صنایع", "کارشناس صنایع", "برنامه ریزی تولید", "کنترل پروژه", "industrial"]],
  ["education-teaching", ["معلم", "مدرس", "تدریس", "مربی", "آموزگار", "teacher", "tutor"]],
  ["logistics-supply-chain", ["لجستیک", "انبار", "انباردار", "تدارکات", "زنجیره تامین", "حمل و نقل", "راننده", "کارپرداز", "بازرگانی", "بازرگانی خارجی", "توزیع", "logistics", "supply chain"]],
  ["hospitality-tourism", ["هتل", "رستوران", "گردشگری", "آژانس مسافرتی", "آشپز", "باریستا", "کافه", "گارسون", "پذیرش", "tourism"]],
  ["manufacturing-production", ["کنترل کیفی", "تولید", "کارخانه", "خط تولید", "کنترل کیفیت", "اپراتور تولید", "اپراتور دستگاه", "تکنسین", "جوشکار", "تراشکار", "qc"]],
  ["management-business", ["مدیرعامل", "مدیر", "مدیریت", "سرپرست", "manager", "director", "ceo", "coo"]],
];

const EMPLOYMENT_RULES: Array<[EmploymentType, string[]]> = [
  ["internship", ["کارآموز", "کارآموزی", "کار آموز", "intern", "internship"]],
  ["part_time", ["پاره وقت", "part time"]],
  ["project", ["پروژه ای", "پروژه‌ای", "فریلنس", "فریلنسر", "freelance", "project based"]],
  ["full_time", ["تمام وقت", "full time"]],
];

const REMOTE_KEYWORDS = ["دورکاری", "دور کاری", "دورکار", "از راه دور", "remote", "telecommute"];

/** Latin city spellings boards sometimes use → the Persian name. */
const CITY_ALIASES: Record<string, string> = {
  tehran: "تهران",
  karaj: "کرج",
  mashhad: "مشهد",
  isfahan: "اصفهان",
  esfahan: "اصفهان",
  shiraz: "شیراز",
  tabriz: "تبریز",
  qom: "قم",
  ahvaz: "اهواز",
  rasht: "رشت",
  kish: "کیش",
};

/**
 * Iranian cities a listing can name. Boards mix cities with provinces,
 * municipal districts and neighbourhoods («منطقه ۶، آرژانتین», «سعادت آباد»,
 * «شهرک صنعتی توس»); only a real city belongs in the city filter.
 */
const KNOWN_CITIES = `
تهران مشهد اصفهان کرج شیراز تبریز قم اهواز کرمانشاه ارومیه رشت زاهدان همدان کرمان یزد اردبیل بندرعباس اراک
اسلامشهر زنجان سنندج قزوین خرم‌آباد گرگان ساری شهریار قدس کاشان ملارد دزفول نیشابور بابل خمینی‌شهر سبزوار
آمل پاکدشت بروجرد آبادان قرچک بوشهر ورامین بجنورد نجف‌آباد بیرجند شاهرود بم سیرجان مراغه خوی میاندوآب ماهشهر
مرودشت ایلام شهرکرد یاسوج سمنان بهبهان جهرم قائم‌شهر بابلسر رفسنجان ساوه دامغان مهاباد اندیمشک شوشتر ابهر فسا
گنبد‌کاووس نوشهر چالوس رامسر تنکابن لاهیجان بندرانزلی انزلی آستارا فومن سرعین صوفیان شبستر گلوگاه مرند میانه
سلماس نقده بوکان سقز مریوان بانه کیش قشم چابهار ایرانشهر زابل تربت‌حیدریه تربت‌جام کاشمر قوچان گناباد فردوس
طبس شیروان اسفراین کهریزک رباط‌کریم پردیس دماوند فیروزکوه هشتگرد نظرآباد فردیس کمال‌شهر محمدشهر ماهدشت لواسان
رودهن بومهن پرند اندیشه باقرشهر نسیم‌شهر صالح‌آباد جیرفت زرند بافت میبد اردکان ابرکوه تفت شاهین‌شهر فولادشهر
زرین‌شهر مبارکه فلاورجان نطنز گلپایگان خوانسار لنجان ملایر نهاوند تویسرکان اسدآباد الیگودرز دورود ازنا کوهدشت
کنگاور هرسین سنقر ماکو بستان‌آباد اهر عجب‌شیر سراب مشگین‌شهر پارس‌آباد خلخال لار کازرون داراب آباده استهبان
فیروزآباد اقلید بروجن فارسان دهدشت دوگنبدان گچساران برازجان کنگان عسلویه جم خرمشهر شوش ایذه مسجدسلیمان
رامهرمز هندیجان بندرلنگه میناب جاسک سراوان خاش بندرترکمن کردکوی کلاله مینودشت آزادشهر نکا بهشهر جویبار
محمودآباد نور گرمسار تاکستان آبیک خرمدره قیدار خدابنده چهاردانگه بوئین‌زهرا
`
  .trim()
  .split(/\s+/);

/** The 31 provinces — a province is not a city. */
const PROVINCES = [
  "تهران", "البرز", "اصفهان", "فارس", "خراسان رضوی", "خراسان شمالی", "خراسان جنوبی", "آذربایجان شرقی",
  "آذربایجان غربی", "اردبیل", "گیلان", "مازندران", "گلستان", "سمنان", "قم", "مرکزی", "قزوین", "زنجان", "همدان",
  "کردستان", "کرمانشاه", "لرستان", "ایلام", "خوزستان", "چهارمحال و بختیاری", "کهگیلویه و بویراحمد", "بوشهر",
  "هرمزگان", "کرمان", "یزد", "سیستان و بلوچستان",
];

/** Neighbourhoods and districts of Tehran that boards give in place of the city. */
const TEHRAN_AREAS = [
  "سعادت آباد", "ونک", "آرژانتین", "پاسداران", "سهروردی", "پونک", "عباس آباد", "میرداماد", "مطهری", "چیتگر",
  "صادقیه", "جاده مخصوص", "تهرانپارس", "زعفرانیه", "شهرک غرب", "نیاوران", "آیت الله کاشانی", "ستارخان",
  "اندرزگو", "توحید", "انقلاب", "جنت آباد", "امانیه", "سنایی", "جردن", "یوسف آباد", "ولیعصر", "شریعتی",
  "فرمانیه", "الهیه", "جمهوری", "ظفر", "قیطریه", "اقدسیه", "تجریش", "گیشا", "فاطمی", "نارمک", "هفت تیر",
  "شهرک صنعتی شمس آباد", "احمد آباد مستوفی", "شهرک استقلال", "بهجت آباد", "طرشت", "شهران", "اکباتان",
  "ملاصدرا", "مرزداران", "کریمخان", "گاندی", "قلهک", "شادآباد", "باغ فیض", "تهرانسر", "آرارات", "سیدخندان",
  "ولنجک", "شیخ بهایی", "رسالت", "امیرآباد", "دروس", "بلوار کشاورز", "میدان آزادی",
];

/** Industrial parks → the city they belong to. */
const PARK_CITIES: Array<[string, string]> = [
  ["شهرک صنعتی توس", "مشهد"],
  ["شهرک صنعتی بزرگ شیراز", "شیراز"],
  ["شهرک صنعتی جی", "اصفهان"],
];

/** Spacing-, ZWNJ- and «آ»-insensitive key: «قائم شهر» = «قائم‌شهر», «یوسف اباد» = «یوسف آباد». */
const cityKey = (value: string) => value.replace(/[\s‌]+/g, "").replace(/آ/g, "ا");
const CITY_BY_KEY = new Map(KNOWN_CITIES.map((c) => [cityKey(c), c]));
const PROVINCE_KEYS = new Set(PROVINCES.map(cityKey));
const TEHRAN_AREA_KEYS = TEHRAN_AREAS.map(cityKey);

/** PURE: a clean Persian city name from whatever the board wrote — or null. */
export function normalizeCity(raw: string | null | undefined): string | null {
  const value = (raw ?? "").replace(/[ي]/g, "ی").replace(/[ك]/g, "ک").trim();
  if (!value || /دورکاری|remote/i.test(value)) return null;

  const segments = value
    .split(/[،,]/)
    .map((part) => part.trim().replace(/^استان\s+/, "").replace(/^شهر\s+/, "").trim())
    .filter(Boolean);
  const hasDistrict = segments.some((part) => part.startsWith("منطقه"));
  const places = segments.filter((part) => !part.startsWith("منطقه"));

  // A named city wins, most specific (last) first: «تهران، ورامین» is Varamin,
  // «اصفهان، منطقه ۵، سپاهان‌شهر» is Isfahan.
  for (const part of [...places].reverse()) {
    const alias = CITY_ALIASES[part.toLowerCase()];
    if (alias) return alias;
    const city = CITY_BY_KEY.get(cityKey(part));
    if (city) return city;
    const park = PARK_CITIES.find(([name]) => cityKey(part) === cityKey(name));
    if (park) return park[1];
  }
  // A Tehran neighbourhood, or a bare «منطقه N» (the municipal districts are Tehran's).
  if (hasDistrict || places.some((part) => TEHRAN_AREA_KEYS.some((area) => cityKey(part).includes(area)))) {
    return "تهران";
  }
  // «استان، شهر» with a small town we do not list: the second part is the city.
  if (places.length === 2 && PROVINCE_KEYS.has(cityKey(places[0]!)) && /[؀-ۿ]/.test(places[1]!)) {
    const town = places[1]!;
    return PROVINCE_KEYS.has(cityKey(town)) ? null : town.slice(0, 60);
  }
  // Anything else — a province alone, an unknown neighbourhood, a Latin name —
  // stays unknown rather than showing up as a «city» in the filter.
  return null;
}

/** PURE: the unified attributes of one listing. */
export function deriveListingAttributes(input: {
  title: string;
  description?: string | null;
  city?: string | null;
}): ListingAttributes {
  const title = normalizeText(input.title);
  const all = normalizeText(`${input.title} ${input.description ?? ""}`);

  // Category from the TITLE only: descriptions list benefits, tools and company
  // blurbs that would drag a sales job into "software" on the word "CRM".
  let category: JobCategorySlug | null = null;
  for (const [slug, keywords] of CATEGORY_RULES) {
    if (keywords.some((keyword) => has(title, keyword))) {
      category = slug;
      break;
    }
  }

  let employmentType: EmploymentType | null = null;
  for (const [type, keywords] of EMPLOYMENT_RULES) {
    if (keywords.some((keyword) => has(all, keyword))) {
      employmentType = type;
      break;
    }
  }

  return {
    category,
    employmentType,
    remote: REMOTE_KEYWORDS.some((keyword) => has(all, keyword)) || /دورکاری|remote/i.test(input.city ?? ""),
    city: normalizeCity(input.city),
  };
}
