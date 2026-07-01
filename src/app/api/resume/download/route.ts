import "server-only";

/**
 * GET /api/resume/download?id=<uuid> — دانلودِ فایلِ PDF رزومه‌ی خودِ کاربر (نشستِ وب).
 *
 * جریان:
 *   ۱) احراز هویتِ وب → userId.
 *   ۲) اعتبارسنجیِ پارامترِ id (UUID).
 *   ۳) خواندنِ متادیتای فایل *فقط اگر متعلق به همین کاربر باشد* (قاعده‌ی ۴).
 *   ۴) خواندنِ بایت‌ها از دیسک (مسیرِ امن، ضدِ traversal) و stream با هدرِ دانلود.
 *
 * رایگان است. هیچ فایلی جز فایلِ خودِ کاربر قابلِ دانلود نیست (id + userId).
 */
import { errorJson, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { getResumeFileForDownload } from "@/lib/resume/profile-service";
import { readResumeFile } from "@/lib/resume/storage";

// به DB و دیسک دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!UUID_RE.test(id)) {
      return errorJson("شناسه‌ی نامعتبر است.", 400);
    }

    const meta = await getResumeFileForDownload(user.id, id);
    if (!meta) {
      return errorJson("رزومه یافت نشد.", 404);
    }

    let bytes: Buffer;
    try {
      bytes = await readResumeFile(meta.storagePath);
    } catch {
      return errorJson("فایلِ رزومه در دسترس نیست.", 404);
    }

    // نامِ فایل را برای هدرِ Content-Disposition امن می‌کنیم (ASCII + filename* برای یونیکد).
    const asciiName = meta.fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
    const utf8Name = encodeURIComponent(meta.fileName);

    // بدنه را از یک نمای تازه‌ی ArrayBuffer می‌سازیم تا نوعِ BodyInit دقیق باشد.
    const body = new Uint8Array(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": meta.mimeType || "application/pdf",
        "content-length": String(meta.byteSize),
        "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        "cache-control": "private, no-store",
      },
    });
  });
}
