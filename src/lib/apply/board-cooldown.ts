import "server-only";

/**
 * وقتی یک سایت «نه» می‌گوید، دست نگه دار.
 *
 * چیزی که واقعاً به بن‌شدن ختم می‌شود، سرعتِ اپلای نیست — **اصرار** است: سایت تأییدِ
 * امنیتی نشان می‌دهد یا ۴۲۹ می‌دهد، و ما دقیقه‌ی بعد دوباره همان کار را می‌کنیم. تیکِ
 * ورکر هر ۶۰ ثانیه و تیکِ سرور هر ۵ دقیقه اجرا می‌شود، پس یک نشستِ سوخته یا یک
 * صفحه‌ی کپچا بدونِ این‌که کسی جلویش را بگیرد، ساعت‌ها پشتِ‌هم کوبیده می‌شود. همان
 * الگوی «تلاشِ ناموفقِ پیاپی از یک حساب» است که سیستم‌های ضدِتقلب دنبالش می‌گردند.
 *
 * پس هر ردِ معنادار، صفِ همان (کاربر، سایت) را برای مدتی عقب می‌اندازد. مکانیزمش همان
 * `tasks.run_after`ِ موجود است: کار تازه‌ای اختراع نمی‌شود، فقط زمانِ آماده‌شدنِ همان
 * وظیفه‌ها جلو می‌رود. سه خاصیتِ مهم از همین‌جا می‌آید:
 *
 *   • **ماندگار است** — در دیتابیس می‌نشیند، پس ریستارتِ ورکر یا دیپلویِ وب آن را پاک
 *     نمی‌کند (یک breakerِ درون‌حافظه‌ای با هر ریستارت دوباره شروع به کوبیدن می‌کرد).
 *   • **هر دو کانال را می‌پوشاند** — ورکرِ Playwright و رانرِ کنترل‌پلین هر دو از همین
 *     صف claim می‌کنند، پس هیچ‌کدام لازم نیست چیزی بداند.
 *   • **فقط همان کاربر و همان سایت** — رد شدنِ جابینجای یک کاربر، کاربوم را یا کاربرِ
 *     دیگری را متوقف نمی‌کند.
 *
 * §۱۰ — این **دور زدنِ تشخیص نیست، عکسِ آن است**: وقتی سایت می‌گوید «الان نه»، ما
 * گوش می‌دهیم. هیچ اثرِ انگشتی جعل نمی‌شود، هیچ کپچایی حل نمی‌شود و هیچ هویتی
 * نمی‌چرخد؛ فقط عقب می‌کشیم.
 */
import { sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";

/** چرا سایت رد کرد — هر کدام سزاوارِ مکثِ متفاوتی است. */
export type BoardRefusal = "security_check" | "rate_limited" | "session_rejected";

/**
 * مدتِ مکث برای هر نوع رد.
 *
 * تأییدِ امنیتی بلندترین است چون جدی‌ترین سیگنال است: سایت *ما* را نشانه گرفته، نه
 * درخواست را. محدودیتِ نرخ یک ساعت مکث می‌خواهد. نشستِ رد‌شده هم یک ساعت — نه چون
 * سایت عصبانی است، بلکه چون تا وقتی کاربر دوباره وصل نشده تلاشِ بیشتر فقط شمارنده‌ی
 * «ورودِ ناموفق» را بالا می‌برد؛ و اگر کاربر زودتر وصل شد، `clearBoardCooldown`
 * همان لحظه مکث را برمی‌دارد.
 */
export const BOARD_COOLDOWN_MINUTES: Record<BoardRefusal, number> = {
  security_check: 360,
  rate_limited: 60,
  session_rejected: 60,
};

/** نشانه‌ای روی `tasks.last_error` تا بعداً بتوان همین مکث‌ها را برداشت. */
export const COOLDOWN_MARKER = "board_cooldown:";

/**
 * PURE: دلیلِ گزارش‌شده‌ی یک نتیجه را به نوعِ رد نگاشت می‌کند (یا `null` اگر این
 * شکست ربطی به «سایت ما را پس زد» نداشته باشد).
 *
 * عمداً روی *دلیل* کار می‌کند نه روی وضعیت: یک آگهیِ بسته هم `skipped` است و هم یک
 * کپچا می‌تواند `failed` باشد، ولی فقط دومی باید صف را متوقف کند. رشته‌ها همان
 * چیزی‌اند که آداپتورهای سایت‌ها برمی‌گردانند.
 */
export function classifyBoardRefusal(reason: string | null | undefined): BoardRefusal | null {
  if (!reason) return null;
  const value = reason.toLowerCase();

  // تأییدِ امنیتی / کپچا — از هر سایتی که باشد.
  if (
    /security[_ -]?check|security[_ -]?challenge|captcha|کپچا|بررسی امنیتی|mosparo|من ربات نیستم/.test(
      value,
    )
  ) {
    return "security_check";
  }

  // محدودیتِ نرخ.
  if (/\b429\b|rate[_ -]?limit|too many requests|محدودیت درخواست/.test(value)) {
    return "rate_limited";
  }

  // نشست دیگر پذیرفته نمی‌شود.
  if (/login[_ -]?required|session[_ -]?expired|unauthorized|\b401\b/.test(value)) {
    return "session_rejected";
  }

  return null;
}

type Db = typeof defaultDb;

/**
 * صفِ اپلایِ این (کاربر، سایت) را به اندازه‌ی مکثِ همین نوعِ رد عقب می‌اندازد.
 * خروجی: تعداد وظیفه‌هایی که عقب افتادند.
 *
 * `greatest(...)` یعنی مکثِ بلندترِ موجود کوتاه نمی‌شود — دو ردِ پشتِ‌هم نباید مکثِ
 * شش‌ساعته را به یک‌ساعته تبدیل کند.
 */
export async function deferBoardQueue(
  userId: string,
  board: string,
  refusal: BoardRefusal,
  conn: Db = defaultDb,
): Promise<number> {
  const minutes = BOARD_COOLDOWN_MINUTES[refusal];
  const rows = (await conn.execute(sql`
    update tasks t
       set run_after  = greatest(t.run_after, now() + make_interval(mins => ${minutes})),
           last_error = ${COOLDOWN_MARKER + refusal},
           updated_at = now()
      from matches m
      join job_listings l on l.id = m.listing_id
     where t.match_id = m.id
       and m.user_id  = ${userId}
       and l.board    = ${board}
       and t.status   = 'pending'
    returning t.id
  `)) as unknown as { id: string }[];
  return rows.length;
}

/**
 * مکثِ این (کاربر، سایت) را برمی‌دارد — وقتی نشستِ تازه‌ای نشست.
 *
 * فقط وظیفه‌هایی را برمی‌گرداند که *خودِ همین مکث* عقبشان انداخته (نشانه‌ی
 * `last_error`)، تا تأخیرهای عمدیِ دیگر (مثلِ رزومه‌ی آماده‌نشده) دست‌نخورده بمانند.
 */
export async function clearBoardCooldown(
  userId: string,
  board: string,
  conn: Db = defaultDb,
): Promise<number> {
  const rows = (await conn.execute(sql`
    update tasks t
       set run_after  = now(),
           last_error = null,
           updated_at = now()
      from matches m
      join job_listings l on l.id = m.listing_id
     where t.match_id = m.id
       and m.user_id  = ${userId}
       and l.board    = ${board}
       and t.status   = 'pending'
       and t.run_after > now()
       and t.last_error like ${COOLDOWN_MARKER + "%"}
    returning t.id
  `)) as unknown as { id: string }[];
  return rows.length;
}
