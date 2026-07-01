import "server-only";

/**
 * POST /api/resume/upload — آپلودِ فایلِ PDF رزومه (نشستِ وب).
 *
 * دو شکلِ ورودی پشتیبانی می‌شود:
 *   • multipart/form-data با فیلدِ فایلِ `file` (مسیرِ اصلیِ مرورگر).
 *   • application/json با `{ fileName?, data }` که `data` همان PDF به‌صورتِ base64 است.
 *
 * جریان:
 *   ۱) احراز هویتِ نشستِ وب → userId (قاعده‌ی ۴: همه‌چیز به نشست مقید، نه به ورودیِ کلاینت).
 *   ۲) خواندنِ بایت‌ها + اعتبارسنجی (نوع/اندازه/امضای %PDF).
 *   ۳) ذخیره روی دیسک با راهبردِ Foundation (saveResumeFile؛ نامِ تصادفی، ضدِ traversal).
 *   ۴) استخراجِ متنِ خام با pdf util (مسیرِ رایگان). اگر استخراج شکست خورد، فایل ذخیره
 *      می‌ماند ولی extractedText=null (کاربر می‌تواند بعداً دوباره تلاش کند).
 *   ۵) ساختِ رکوردِ resume_files و برگرداندنِ رکورد + طولِ متنِ استخراج‌شده.
 *
 * این مسیر AI را صدا نمی‌زند؛ ساخت‌یافته‌سازی در POST /api/resume/parse انجام می‌شود.
 */
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { EVENTS, track } from "@/lib/analytics";
import { extractText, PdfExtractError } from "@/lib/resume/pdf";
import { resumeUploadJsonSchema } from "@/lib/resume/api-schemas";
import { createResumeFileRecord } from "@/lib/resume/service";
import { saveResumeFile } from "@/lib/resume/storage";
import {
  RESUME_MIME,
  decodeBase64Pdf,
  validateResumeUpload,
} from "@/lib/resume/validation";

// به DB، دیسک، و node API دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** نتیجه‌ی استخراجِ بایت‌ها از بدنه‌ی درخواست (هر دو مسیر). */
interface ExtractedUpload {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — userId از نشست، نه از بدنه.
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) خواندنِ بایت‌ها از multipart یا JSON.
    let upload: ExtractedUpload;
    try {
      upload = await readUploadBody(request);
    } catch {
      return errorJson("بدنه‌ی درخواست نامعتبر است.", 400);
    }

    // ۳) اعتبارسنجی (نوع/اندازه/امضا).
    const valid = validateResumeUpload(upload.bytes, upload.mimeType);
    if (!valid.ok) {
      return errorJson(valid.error, 400);
    }

    // ۴) ذخیره روی دیسک (نامِ تصادفی زیرِ پوشه‌ی کاربر — ضدِ traversal/برخورد).
    const saved = await saveResumeFile(user.id, upload.bytes);

    // ۵) استخراجِ متنِ خام (مسیرِ رایگان). شکستِ استخراج فایل را باطل نمی‌کند.
    let extractedText: string | null = null;
    try {
      const result = await extractText(upload.bytes);
      extractedText = result.text.length > 0 ? result.text : null;
    } catch (err) {
      if (!(err instanceof PdfExtractError)) throw err;
      // PDF خراب/تصویری/رمزگذاری‌شده → متن نداریم؛ رکورد بدونِ متن ساخته می‌شود.
      extractedText = null;
    }

    // ۶) ساختِ رکوردِ resume_files (userId از نشست).
    const row = await createResumeFileRecord(user.id, {
      fileName: upload.fileName,
      mimeType: RESUME_MIME,
      byteSize: upload.bytes.byteLength,
      storagePath: saved.relativePath,
      extractedText,
    });

    // آنالیتیکس: آپلودِ رزومه (best-effort، بی‌نام‌فایل/بی‌راز — فقط متادیتای غیرحساس).
    // fire-and-forget؛ track هرگز throw نمی‌کند و پاسخ را بلاک نمی‌کند.
    track(user.id, EVENTS.RESUME_UPLOADED, { hasText: extractedText !== null });

    return json(
      {
        resumeFile: {
          id: row.id,
          fileName: row.fileName,
          byteSize: row.byteSize,
          createdAt: row.createdAt,
          hasText: extractedText !== null,
        },
        extractedTextLength: extractedText?.length ?? 0,
      },
      201,
    );
  });
}

/**
 * بایت‌های فایل را از بدنه‌ی درخواست (multipart یا JSON) استخراج می‌کند.
 * در مسیرِ multipart فیلدِ `file` خوانده می‌شود؛ در مسیرِ JSON، `data`ی base64.
 * در صورتِ بدنه‌ی نامعتبر throw می‌کند (هندلر آن را به ۴۰۰ تبدیل می‌کند).
 */
async function readUploadBody(request: Request): Promise<ExtractedUpload> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("فیلدِ file یافت نشد.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return {
      bytes,
      fileName: sanitizeFileName(file.name || "resume.pdf"),
      mimeType: file.type || RESUME_MIME,
    };
  }

  // مسیرِ JSON/base64.
  const raw: unknown = await request.json();
  const parsed = resumeUploadJsonSchema.parse(raw);
  const bytes = decodeBase64Pdf(parsed.data);
  return {
    bytes,
    fileName: sanitizeFileName(parsed.fileName ?? "resume.pdf"),
    mimeType: RESUME_MIME,
  };
}

/** نامِ فایل را برای متادیتا امن/کوتاه می‌کند (در مسیرِ دیسک استفاده نمی‌شود). */
function sanitizeFileName(name: string): string {
  const trimmed = name.trim().slice(0, 200);
  return trimmed.length > 0 ? trimmed : "resume.pdf";
}
