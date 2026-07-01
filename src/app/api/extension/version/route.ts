import "server-only";

/**
 * GET /api/extension/version — آخرین نسخه‌ی افزونه‌ی مرورگرِ کارجو (عمومی، بدونِ احراز).
 *
 * افزونه (که «بارگذاریِ باز/unpacked» نصب می‌شود و به‌روزرسانیِ خودکارِ واقعیِ کروم ندارد)
 * نسخه‌ی نصب‌شده‌ی خود (`chrome.runtime.getManifest().version`) را با `version`ِ این پاسخ
 * مقایسه می‌کند؛ اگر سرور جدیدتر باشد، بنرِ «نسخه‌ی جدید موجود است» را نشان می‌دهد و به
 * `downloadUrl` (ZIPِ تازه) لینک می‌دهد.
 *
 * منبعِ نسخه: ثابتِ یگانه‌ی `KARJOO_EXTENSION_VERSION` که با extension/manifest.json برابر
 * است — هیچ‌جای دیگری نباید نسخه را دوباره اعلام کند.
 *
 * این مسیر عمداً عمومی است (بدونِ نشست/توکن): افزونه ممکن است هنوز جفت‌نشده باشد و باید
 * بتواند وجودِ نسخه‌ی جدید را بفهمد. هیچ داده‌ی کاربری/رازی برنمی‌گردد؛ فقط متادیتای عمومیِ
 * انتشار. کش‌پذیر است تا بارِ سرور کم بماند (نسخه به‌ندرت عوض می‌شود).
 */
import { json, withErrorHandling } from "@/lib/api/http";
import {
  KARJOO_EXTENSION_DOWNLOAD_PATH,
  KARJOO_EXTENSION_RELEASE_NOTES,
  KARJOO_EXTENSION_VERSION,
} from "@/lib/extension/version";

// فقط ثابت‌ها را می‌خواند (نه DB/نشست)، ولی Node را انتخاب می‌کنیم تا با بقیه‌ی مسیرهای
// افزونه یکدست بماند و از هر رفتارِ ناخواسته‌ی Edge دور باشیم.
export const runtime = "nodejs";

/** شکلِ پاسخِ عمومیِ نسخه — دقیقاً همان چیزی که افزونه انتظار دارد. */
export interface ExtensionVersionResponse {
  /** آخرین نسخه‌ی منتشرشده (semver). = extension/manifest.json#version */
  version: string;
  /** مسیرِ دانلودِ ZIP (نسبی به ریشه‌ی سایت). */
  downloadUrl: string;
  /** توضیحِ کوتاهِ اختیاریِ نسخه (فارسی)؛ در نبود، حذف می‌شود. */
  notes?: string;
}

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    const notes = KARJOO_EXTENSION_RELEASE_NOTES.trim();

    const body: ExtensionVersionResponse = {
      version: KARJOO_EXTENSION_VERSION,
      downloadUrl: KARJOO_EXTENSION_DOWNLOAD_PATH,
      ...(notes ? { notes } : {}),
    };

    const res = json(body);
    // نسخه به‌ندرت عوض می‌شود؛ کشِ کوتاهِ عمومی + امکانِ سروِ کهنه هنگامِ بازاعتبارسنجی،
    // تا کلاینت‌ها (و CDN) سرور را کوبه نکنند. عمومی است چون هیچ رازِ کاربری ندارد.
    res.headers.set(
      "Cache-Control",
      "public, max-age=300, s-maxage=300, stale-while-revalidate=86400",
    );
    return res;
  });
}
