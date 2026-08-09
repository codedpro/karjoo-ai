import "server-only";

/**
 * انتخابِ «مشتریانِ منتخب» برای هر آگهی.
 *
 * مسئله‌ی واقعی: کسی که استودیوی خودش را دارد و ۲۰۰+ پروژه برای ۱۰۰+ مشتری در چند کشور
 * انجام داده، در رزومه فقط یک سطر می‌گیرد — «بنیان‌گذار، CodeNest» — و تمامِ آن نام‌های
 * شناخته‌شده نادیده می‌ماند. کارفرما هم دقیقاً همان نام‌ها را می‌شناسد، نه نامِ استودیو را.
 *
 * راه‌حل **درست** همین است و نیازی به ساختنِ کارفرمای جعلی ندارد: مشتریانِ واقعی را
 * فهرست کن و برای هر آگهی مرتبط‌ترین‌ها را جلو بیاور. «Selected clients» بخشِ کاملاً
 * متعارفِ رزومه‌ی فریلنسری/استودیویی است و هر ادعایش هم قابلِ دفاع است، چون واقعاً
 * همان کار انجام شده.
 *
 * دو محورِ انتخاب — همان دو چیزی که کاربر خواست:
 *   • **کشور**: آگهیِ ایران → مشتریانِ ایرانی جلو؛ آگهیِ دورکارِ خارج → مشتریانِ UK/EU.
 *   • **حوزه**: آگهیِ تحلیلِ داده → مشتریانی که همان کار برایشان شده.
 *
 * هر مشتری را **خودِ کاربر** وارد می‌کند. این ماژول چیزی کشف یا پیشنهاد نمی‌کند و
 * هیچ نامی از خودش نمی‌سازد؛ فقط از میانِ فهرستِ واقعی مرتب و انتخاب می‌کند.
 */

/** یک مشتریِ واقعی که کاربر برایش کار کرده. */
export interface ClientEntry {
  name: string;
  /** کشور — برای هم‌راستاکردن با محلِ آگهی (مثلاً "IR"، "UK"، "NL"). */
  country?: string | null;
  /** حوزه/صنعت («fintech»، «telecom»، «ecommerce»). */
  domain?: string | null;
  /** کارِ انجام‌شده — یک عبارتِ کوتاه، برای نمایش کنارِ نام. */
  work?: string | null;
  /** سالِ انجامِ کار (برای ترتیبِ تازگی). */
  year?: number | null;
}

/** حداکثر مشتری در یک رزومه — بیشتر از این، فهرست به دیوارِ اسم تبدیل می‌شود. */
export const MAX_CLIENTS = 8;

const norm = (v: string) => v.toLowerCase().replace(/[\s._-]+/g, "");

/** کشورِ هدفِ آگهی را از شهر/عنوان/شرحِ آن حدس می‌زند. */
export function inferTargetCountry(jobText: string): string | null {
  const t = jobText.toLowerCase();
  if (/\biran\b|تهران|ایران|اصفهان|مشهد|شیراز|کرج|تبریز/.test(jobText)) return "IR";
  if (/\bunited kingdom\b|\buk\b|london|بریتانیا|انگلستان/.test(t)) return "UK";
  if (/\bnetherlands\b|amsterdam|هلند/.test(t)) return "NL";
  if (/\bgermany\b|berlin|آلمان/.test(t)) return "DE";
  return null;
}

export interface ClientSelection {
  clients: ClientEntry[];
  /** کشوری که انتخاب حولِ آن انجام شد (برای شفافیت). */
  targetCountry: string | null;
}

/**
 * مرتبط‌ترین مشتریانِ واقعی را برای این آگهی انتخاب می‌کند.
 *
 * رتبه‌بندی: هم‌کشور بودن با آگهی، بعد هم‌پوشانیِ حوزه/کار با واژگانِ آگهی، بعد تازگی.
 */
export function selectClientsForJob(
  clients: readonly ClientEntry[],
  jobText: string,
  keywords: readonly string[],
  opts: { maxClients?: number; targetCountry?: string | null } = {},
): ClientSelection {
  const max = opts.maxClients ?? MAX_CLIENTS;
  const target = opts.targetCountry ?? inferTargetCountry(jobText);

  const scored = clients
    .filter((c) => c.name?.trim())
    .map((c) => {
      const hay = norm([c.domain, c.work].filter(Boolean).join(" "));
      let score = 0;
      for (const kw of keywords) {
        const k = norm(kw);
        if (k.length >= 3 && hay.includes(k)) score += 1;
      }
      // هم‌کشوری وزنِ زیادی دارد: کارفرمای ایرانی نامِ ایرانی را می‌شناسد.
      const sameCountry =
        target !== null && (c.country ?? "").toUpperCase() === target.toUpperCase();
      return { client: c, score, sameCountry };
    });

  scored.sort((a, b) => {
    if (a.sameCountry !== b.sameCountry) return a.sameCountry ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return (b.client.year ?? 0) - (a.client.year ?? 0);
  });

  return { clients: scored.slice(0, max).map((s) => s.client), targetCountry: target };
}

/** فهرستِ منتخب را برای نمایش/پرامپت به متن تبدیل می‌کند. */
export function describeClients(sel: ClientSelection): string {
  if (sel.clients.length === 0) return "";
  return sel.clients
    .map((c) => (c.work?.trim() ? `${c.name} (${c.work.trim()})` : c.name))
    .join("، ");
}

/* ─────────────────  استخراجِ فهرستِ مشتریان از رزومه‌ی خودِ کاربر  ───────────────── */

/**
 * نام‌های مشتری/کارفرما را از **متنِ رزومه‌ی خودِ کاربر** بیرون می‌کشد.
 *
 * این پاسخِ مشکلِ «نمی‌توانم ۱۰۰ تا اسم را دستی وارد کنم» است: بخشی از همان نام‌ها از
 * قبل در رزومه‌ی آپلودشده هست. منبع فقط همان متن است — هیچ نامی پیشنهاد یا کشف نمی‌شود،
 * چون نامِ کارفرما ادعایی درباره‌ی یک سازمانِ دیگر است و باید از سندِ خودِ کاربر بیاید.
 */
export async function extractClientsFromResume(
  userId: string,
  resumeText: string,
  opts: import("@/lib/billing/metering").MeteringOptions = {},
): Promise<ClientEntry[]> {
  const { meteredChatJson } = await import("@/lib/billing/metering");
  const { buildClientExtractPrompt } = await import("@/lib/ai/prompts");
  const { clientListSchema } = await import("@/lib/ai/schema");

  const out = await meteredChatJson(
    userId,
    "resume_parse",
    { messages: buildClientExtractPrompt(resumeText.slice(0, 12000)), temperature: 0, maxTokens: 2500 },
    opts,
  );
  const parsed = clientListSchema.safeParse(out.result.data);
  if (!parsed.success) return [];

  // گاردِ نهایی در کد: نامی که عیناً در متنِ رزومه نیست، بیرون می‌رود — حتی اگر مدل آورده.
  const hay = resumeText.toLowerCase();
  return parsed.data.clients.filter((c) => hay.includes(c.name.trim().toLowerCase()));
}
