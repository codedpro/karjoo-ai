import "server-only";

/**
 * بازبینی و ترمیمِ رزومه‌ی تولیدشده.
 *
 * چرا لازم است: پرامپت هرچقدر هم دقیق باشد، مدل در یک پاسِ واحد چند قاعده را هم‌زمان
 * نگه نمی‌دارد. عملاً دیده شد که با همان پرامپت، چند اصطلاحِ خواسته‌شده‌ی آگهی جا می‌ماند
 * و طولِ رزومه از هدف کوتاه‌تر می‌شود — نه چون منعی هست، فقط چون مدل حواسش جای دیگری بود.
 *
 * پس به‌جای بزرگ‌تر کردنِ پرامپت (که خودش باعثِ افت شد — دستورهای فارسیِ اضافه یک‌بار کلِ
 * خروجی را به فارسی برد)، یک گامِ دوم می‌گذاریم: **در کد** بررسی می‌کنیم چه چیزی جا مانده
 * و فقط همان را به مدل برمی‌گردانیم. سنجش قطعی است، پیامِ ترمیم کوتاه و مشخص است، و
 * هزینه‌اش فقط وقتی پرداخت می‌شود که واقعاً شکافی باشد.
 *
 * این گام محتوا نمی‌سازد و ادعای تازه اضافه نمی‌کند: فقط می‌گوید «این اصطلاح‌ها را که
 * آگهی خواسته و مجازند، جایی در همین متن بیاور» و «سابقه‌ها را کامل‌تر بنویس».
 */

import type { ResumeTailorOutput } from "@/lib/ai/schema";

/** هدفِ حداقلی برای «دو صفحه‌ی کاملِ A4» — سقف در مرحله‌ی fit، حدود سه صفحه است. */
export const TARGET_MIN_CHARS = 5200;

/** زیرِ این حد یعنی رزومه واقعاً کوتاه است و ترمیم می‌ارزد. */
export const REPAIR_CHAR_FLOOR = 4600;

export interface ResumeGaps {
  /** اصطلاح‌هایی که آگهی خواسته، مجازند، ولی در متن نیامده‌اند. */
  missingTerms: string[];
  /** درصدهایی که در سابقه‌ی واقعیِ کاربر نیستند — یعنی مدل از خودش ساخته. */
  ungroundedFigures: string[];
  /** طولِ متنِ خالصِ فعلی. */
  chars: number;
  /** تعدادِ مهارت‌های فعلی — ترمیم نباید کمترش کند. */
  skillCount: number;
  /** آیا از حداقلِ دو صفحه کوتاه‌تر است؟ */
  tooShort: boolean;
}

/** متنِ خالصِ قابلِ‌سنجش از خروجیِ مدل (بدونِ HTML — این‌جا هنوز HTML نداریم). */
export function tailoredPlainText(t: ResumeTailorOutput): string {
  const parts: string[] = [t.headline, t.summary, ...(t.skills ?? [])];
  for (const e of t.experience ?? []) {
    parts.push(e.company ?? "", e.title ?? "", e.context ?? "", ...(e.bullets ?? []));
  }
  parts.push(...(t.highlights ?? []));
  return parts.filter(Boolean).join(" ");
}

const norm = (v: string) => v.toLowerCase().replace(/[\s._\-/]+/g, "");

/**
 * درصدها را از متن بیرون می‌کشد.
 *
 * چرا فقط درصد: عددِ ساختگی خطرناک‌ترین جای رزومه است و درصد الگویِ غالبش —
 * «۳۰٪ بهبود»، «۱۵٪ سریع‌تر». مقیاس‌های دیگر (۲M مشترک، ۲۰۰+ پروژه) معمولاً مستقیم از
 * سابقه می‌آیند و الگویشان هم آن‌قدر متنوع است که تطبیقِ خودکارشان بیشتر مثبتِ کاذب می‌سازد.
 */
function percentages(text: string): string[] {
  return [...text.matchAll(/\b\d{1,3}(?:[.,]\d+)?\s*%/g)].map((m) => m[0].replace(/\s+/g, ""));
}

/**
 * شکاف‌ها را **در کد** پیدا می‌کند — نه با پرسیدن از مدل.
 *
 * `required` همان اصطلاح‌های مجازِ آگهی است (تکنولوژی‌ها + مفاهیم). چیزی که مجاز نیست
 * اصلاً به این‌جا نمی‌رسد، پس این تابع هیچ‌وقت ادعای بی‌پشتوانه را مطالبه نمی‌کند.
 *
 * `evidence` سابقه‌ی واقعیِ کاربر است؛ هر درصدی که آن‌جا نباشد ساختگی است.
 */
export function findResumeGaps(
  tailored: ResumeTailorOutput,
  required: readonly string[],
  evidence = "",
): ResumeGaps {
  const text = tailoredPlainText(tailored);
  const hay = norm(text);
  const missingTerms = required.filter((t) => {
    const k = norm(t);
    return k.length >= 2 && !hay.includes(k);
  });
  const known = new Set(percentages(evidence));
  const ungroundedFigures = [...new Set(percentages(text))].filter((f) => !known.has(f));
  return {
    missingTerms,
    ungroundedFigures: evidence ? ungroundedFigures : [],
    chars: text.length,
    skillCount: (tailored.skills ?? []).length,
    tooShort: text.length < REPAIR_CHAR_FLOOR,
  };
}

/** آیا اصلاً ترمیمی لازم است؟ */
export function needsRepair(gaps: ResumeGaps): boolean {
  return gaps.missingTerms.length > 0 || gaps.tooShort || gaps.ungroundedFigures.length > 0;
}

/**
 * پیامِ ترمیم — عمداً کوتاه: فقط شکاف‌ها، نه تکرارِ کلِ قواعد.
 *
 * درسِ گران‌قیمتِ این پرونده: هر دستورِ اضافه‌ای که به پرامپتِ اصلی سنجاق شد، چیزِ دیگری
 * را خراب کرد. این‌جا پیام حداقلی است و مدل کلِ رزومه‌ی قبلی را جلوی چشمش دارد.
 */
export function buildRepairInstruction(gaps: ResumeGaps, lang: "fa" | "en"): string {
  const lines: string[] = [];
  if (gaps.missingTerms.length) {
    lines.push(
      `این اصطلاح‌ها را آگهی خواسته و کاربر مجاز به نام‌بردنشان است، ولی در رزومه نیامده‌اند. هرکدام را **داخلِ یکی از bulletهای موجود** و در متنِ کارِ واقعی بیاور (نه به‌صورتِ فهرست، نه در بخشِ جدید): ${gaps.missingTerms.join("، ")}`,
    );
  }
  if (gaps.ungroundedFigures.length) {
    lines.push(
      `این درصدها در سابقه‌ی واقعیِ کاربر **نیستند** و مدل از خودش ساخته: ${gaps.ungroundedFigures.join("، ")}. هرکدام را یا با عددِ واقعیِ همان سابقه جایگزین کن، یا عدد را بردار و دستاورد را کیفی بنویس («به‌طورِ محسوس»، «چند برابر»). عددِ ساختگی اولین چیزی است که در مصاحبه پرسیده می‌شود.`,
    );
  }
  if (gaps.tooShort) {
    lines.push(
      `رزومه ${gaps.chars} نویسه است و باید حدودِ ${TARGET_MIN_CHARS}+ باشد (حداقل دو صفحه، با سقف کلی سه صفحه). هر سابقه را به ۵ تا ۶ bulletِ محتوادار برسان: جزئیاتِ فنیِ بیشتر، تصمیمِ معماری و دلیلش، مسئله‌ای که حل شد و چطور. **هیچ عددِ تازه‌ای نساز** — فقط از اعدادی استفاده کن که همین حالا در همین رزومه یا سابقه‌ی کاربر هست.`,
    );
  }
  lines.push(
    lang === "en"
      ? "زبانِ خروجی انگلیسی است — همه‌ی متن انگلیسی بماند."
      : "زبانِ خروجی فارسی است — همه‌ی متن فارسی بماند.",
  );
  // بدونِ این بند، ترمیم رزومه را **کوچک‌تر** می‌کند: مدل موقعِ بازنویسی محافظه‌کار می‌شود،
  // bulletها را کوتاه می‌کند و نصفِ مهارت‌ها را می‌اندازد. زنده دیده شد: ۶۱۴۱ → ۴۸۶۶ نویسه
  // و ۱۵ → ۹ مهارت، فقط برای اصلاحِ دو عدد.
  lines.push(
    `این یک **اصلاحِ نقطه‌ای** است، نه بازنویسی: هیچ bullet، مهارت یا جمله‌ای را حذف یا کوتاه نکن. تعدادِ مهارت‌ها (${gaps.skillCount}) و طولِ متن (${gaps.chars} نویسه) باید دستِ‌کم همین‌قدر بماند یا بیشتر شود. فقط همان موردهای بالا را عوض کن.`,
  );
  lines.push(
    "شرکت‌ها و بازه‌های زمانی **دقیقاً** همان‌هایی که هست بماند. عنوانِ هر سابقه می‌تواند JD-shaped بماند یا بهتر شود، ولی شرکت و period عوض نشود. همان ساختارِ JSON را برگردان.",
  );
  return lines.join("\n");
}
