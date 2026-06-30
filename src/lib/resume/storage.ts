import "server-only";

/**
 * راهبردِ ذخیره‌سازیِ فایلِ آپلودِ رزومه (WF1) — ساده و محلی برای فعلاً.
 *
 * فایلِ خامِ PDF روی دیسکِ محلی نگه‌داری می‌شود؛ مسیرِ پایه قابلِ تنظیم با محیط است:
 *   • `KARJOO_UPLOADS_DIR` (در صورتِ تنظیم) — مسیرِ مطلق یا نسبیِ پوشه‌ی آپلود.
 *   • در غیرِ این صورت، پیش‌فرض `./uploads` در ریشه‌ی پروژه (در .gitignore است).
 *
 * جدولِ resume_files فقط `storagePath`ِ *نسبی* (نسبت به پوشه‌ی پایه) را نگه می‌دارد تا
 * جابه‌جاییِ پوشه‌ی پایه، رکوردها را نشکند. این ماژول server-only است (دسترسیِ فایل).
 *
 * تزریق‌پذیری: همه‌ی توابع یک `baseDir`ِ اختیاری می‌پذیرند (پیش‌فرض: uploadsBaseDir()).
 * این هم تست را بدونِ وابستگی به env در زمانِ بوت ممکن می‌کند و هم منطقِ امنِ مسیر را
 * خالص نگه می‌دارد.
 *
 * مهاجرتِ آینده: همین قرارداد (saveResumeFile/readResumeFile) را می‌توان پشتِ S3/مشابه
 * پیاده کرد بدونِ تغییرِ فراخواننده.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { env } from "@/lib/env";

/** پوشه‌ی پایه‌ی آپلود (مطلق‌شده). از KARJOO_UPLOADS_DIR یا پیش‌فرضِ ./uploads. */
export function uploadsBaseDir(): string {
  const configured = env.KARJOO_UPLOADS_DIR;
  const base = configured && configured.trim().length > 0 ? configured.trim() : "uploads";
  return isAbsolute(base) ? base : resolve(process.cwd(), base);
}

/** نتیجه‌ی ذخیره‌ی یک فایلِ رزومه. */
export interface SavedResumeFile {
  /** مسیرِ *نسبیِ* امن (همان چیزی که در resume_files.storagePath ذخیره می‌شود). */
  relativePath: string;
  /** مسیرِ مطلقِ روی دیسک (برای خواندنِ بعدی). */
  absolutePath: string;
}

/**
 * یک فایلِ رزومه را به‌صورتِ امن ذخیره می‌کند: زیرِ پوشه‌ی هر کاربر، با نامِ تصادفیِ
 * یکتا (تا نامِ فایلِ کاربر، traversal/برخورد ایجاد نکند). نامِ اصلیِ فایل فقط متادیتاست
 * (در DB) و در مسیرِ دیسک استفاده نمی‌شود.
 *
 * @param userId  شناسه‌ی کاربر (برای پارتیشن‌بندیِ پوشه). باید UUIDِ نشستِ کاربر باشد.
 * @param bytes   بایت‌های فایل.
 * @param baseDir پوشه‌ی پایه (پیش‌فرض: uploadsBaseDir()). برای تست تزریق‌پذیر.
 */
export async function saveResumeFile(
  userId: string,
  bytes: Uint8Array,
  baseDir: string = uploadsBaseDir(),
): Promise<SavedResumeFile> {
  const safeUser = sanitizeSegment(userId);
  const relativePath = join(safeUser, `${randomUUID()}.pdf`);
  const absolutePath = resolveWithinBase(relativePath, baseDir);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  return { relativePath, absolutePath };
}

/** یک فایلِ ذخیره‌شده را با مسیرِ نسبیِ امن می‌خواند. */
export async function readResumeFile(
  relativePath: string,
  baseDir: string = uploadsBaseDir(),
): Promise<Buffer> {
  return readFile(resolveWithinBase(relativePath, baseDir));
}

/**
 * یک مسیرِ نسبی را به مسیرِ مطلقِ درونِ پوشه‌ی پایه حل می‌کند و تضمین می‌کند از پوشه‌ی
 * پایه بیرون نمی‌زند (دفاع در برابرِ path traversal). اگر بیرون بزند خطا می‌اندازد.
 */
export function resolveWithinBase(
  relativePath: string,
  baseDir: string = uploadsBaseDir(),
): string {
  const base = isAbsolute(baseDir) ? baseDir : resolve(process.cwd(), baseDir);
  const abs = normalize(join(base, relativePath));
  const baseWithSep = base.endsWith(sep) ? base : base + sep;
  if (abs !== base && !abs.startsWith(baseWithSep)) {
    throw new Error(`مسیرِ نامعتبر: «${relativePath}» از پوشه‌ی آپلود بیرون می‌زند.`);
  }
  return abs;
}

/** یک قطعه‌ی مسیر را امن می‌کند: فقط حروف/عدد/خط‌تیره؛ بقیه حذف. */
function sanitizeSegment(segment: string): string {
  const cleaned = segment.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.length > 0 ? cleaned : "unknown";
}
