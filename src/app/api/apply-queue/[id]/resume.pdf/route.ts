import "server-only";

import { errorJson, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { taskIdParamSchema } from "@/lib/api/extension-schemas";
import { getTaskTailoredResume } from "@/lib/apply/extension-queue";
import { renderResumePdf } from "@/lib/resume/pdf-renderer";
import { resumeFileName } from "@/lib/resume/resume-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    const { userId } = await requireBearerSession(request, { requireKind: "extension" });
    const { id } = taskIdParamSchema.parse(await params);
    const resume = await getTaskTailoredResume(userId, id);
    if (!resume) return errorJson("رزومهٔ اختصاصی این آگهی آماده نیست.", 404);

    const bytes = await renderResumePdf(resume.html);
    // نامِ فایل حالا خودش ASCII و یکتاست، پس هر دو هدر یکی‌اند و افزونه هرچه بردارد
    // همان نامِ امن است. پیش‌تر نسخه‌ی ASCII هر حرفِ فارسی را `_` می‌کرد و نتیجه‌اش
    // ۲۸ خط‌تیره پشتِ‌هم بود — برای دو نامِ هم‌طول یکسان.
    const fileName = resumeFileName(resume.fullName, resume.company, {
      latinName: resume.latinName,
      unique: resume.externalId,
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
