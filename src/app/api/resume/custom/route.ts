import "server-only";

/**
 * POST /api/resume/custom — رزومه‌ی هدف‌گیری‌شده برای آگهی‌ای که **خودِ کاربر** متنش را می‌دهد.
 *
 * چرا جدا از `/api/resume/tailor`: آن یکی `listingId` می‌خواهد، یعنی آگهی باید از پیش
 * توسطِ کرالر کشف و ذخیره شده باشد. اما بیشترِ فرصت‌های واقعی از جایی می‌آیند که کرالر
 * نمی‌بیند — کانالِ تلگرام، ایمیل، دایرکتِ لینکدین، یا حتی یک عکسِ آگهی که کاربر تایپ
 * می‌کند. این مسیر همان شکاف را می‌بندد: چند فیلدِ ساده بگیر، رزومه بده.
 *
 * پروفایل پویاست: همان پروفایلِ کاربرِ لاگین‌کرده استفاده می‌شود (قالب، زبان، نامِ لاتین و
 * تأکیدها همه از ترجیحاتِ خودش می‌آید)، پس هیچ چیزی در کد ثابت نیست.
 *
 * آگهی زیرِ بوردِ `custom` ذخیره می‌شود — نه زیرِ نامِ بوردی که از آن نیامده. کلیدِ یکتا از
 * هشِ محتوا ساخته می‌شود، پس ارسالِ دوباره‌ی همان آگهی ردیفِ تکراری نمی‌سازد و رزومه
 * به‌جای تکثیر، به‌روزرسانی می‌شود.
 *
 * body:
 *   { title, description, company?, url?, city? }
 * پرس‌وجو:
 *   ?format=pdf  →  خودِ فایلِ PDF (نیازمندِ Chromium روی همان کانتینر)
 *   پیش‌فرض      →  { id, listingId, headline, jobTitle, htmlUrl }
 *
 * هزینه: مثلِ هر ساختِ رزومه، به کیف‌پولِ 1xAiِ خودِ کاربر متر می‌شود.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { db } from "@/db";
import { jobListings } from "@/db/schema";
import { errorJson, HttpError, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import { generateTailoredResume } from "@/lib/resume/custom-resume-service";
import { renderResumePdf } from "@/lib/resume/pdf-renderer";
import { resumeFileName } from "@/lib/resume/resume-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ساختِ رزومه یک رفت‌وبرگشتِ کاملِ LLM است و بعد احتمالاً رندرِ PDF؛ ۶۰ ثانیه‌ی پیش‌فرضِ
// مسیرهای معمولی برایش کم است.
export const maxDuration = 120;

const bodySchema = z
  .object({
    title: z.string().trim().min(2, "عنوانِ شغل لازم است.").max(200),
    // ۶۰۰۰ نویسه‌ی اول به پرامپت می‌رود؛ بیشتر را می‌پذیریم تا کاربر مجبور به بریدنِ
    // دستیِ متن نباشد، ولی سقفی می‌گذاریم که بدنه‌ی بی‌انتها نگیریم.
    description: z.string().trim().min(30, "متنِ آگهی خیلی کوتاه است.").max(20000),
    company: z.string().trim().max(200).optional(),
    url: z.string().trim().url("لینکِ آگهی معتبر نیست.").max(2000).optional(),
    city: z.string().trim().max(120).optional(),
  })
  .strict();

/**
 * شناسه‌ی یکتا از رویِ محتوا: عنوان + شرح. دوبار فرستادنِ همان آگهی همان ردیف را
 * برمی‌گرداند، پس نه ردیفِ تکراری می‌ماند و نه کاربر دوباره بابتِ همان چیز پول می‌دهد
 * (رزومه upsert می‌شود).
 */
function externalIdFor(title: string, description: string): string {
  return createHash("sha256").update(`${title}\n${description}`).digest("hex").slice(0, 32);
}

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const auth = await getCurrentUserOrBearer(request);
    if (!auth) return errorJson("برای ساختِ رزومه‌ی سفارشی وارد شوید.", 401);

    let body: z.infer<typeof bodySchema>;
    try {
      body = bodySchema.parse(await request.json());
    } catch (err) {
      const first = err instanceof z.ZodError ? err.issues[0]?.message : undefined;
      return errorJson(first ?? "ورودیِ نامعتبر.", 400);
    }

    const externalId = externalIdFor(body.title, body.description);
    const canonicalId = `custom:${externalId}`;

    const [listing] = await db
      .insert(jobListings)
      .values({
        board: "custom",
        externalId,
        canonicalId,
        title: body.title,
        company: body.company ?? null,
        city: body.city ?? null,
        // آگهیِ دستی همیشه لینک ندارد؛ ولی ستون NOT NULL است، پس یک ارجاعِ داخلیِ
        // پایدار می‌گذاریم که هم یکتاست و هم معلوم است از کجا آمده.
        url: body.url ?? `karjoo://custom/${externalId}`,
        description: body.description,
        // این آگهی فرمِ اپلای ندارد؛ کاربر خودش با کارفرما تماس می‌گیرد.
        applyType: "contact",
        postedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: jobListings.canonicalId,
        set: {
          title: body.title,
          company: body.company ?? null,
          city: body.city ?? null,
          description: body.description,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning({ id: jobListings.id });

    if (!listing) return errorJson("ثبتِ آگهی ممکن نشد.", 500);

    try {
      // کاربر خودش این آگهی را آورده — یعنی صریحاً اعلام کرده واجدِ آن است. همان
      // معنایی که انتخابِ دستیِ یک آگهی در داشبورد دارد.
      const result = await generateTailoredResume(auth.id, listing.id, { source: "manual" });

      const wantsPdf = new URL(request.url).searchParams.get("format") === "pdf";
      if (!wantsPdf) {
        return json(
          {
            id: result.id,
            listingId: listing.id,
            headline: result.headline,
            jobTitle: result.jobTitle,
            fullName: result.fullName,
            htmlUrl: `/api/resume/tailored?id=${result.id}`,
            pdfUrl: `/api/resume/custom?format=pdf`,
          },
          201,
        );
      }

      const bytes = await renderResumePdf(result.html);
      const fileName = resumeFileName(result.fullName, body.company ?? body.title, {
        unique: externalId,
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
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return json(
          { error: "موجودیِ کیف‌پولِ 1xAi کافی نیست — شارژ کنید.", topupUrl: "https://1xai.ir/topup" },
          402,
        );
      }
      if (err instanceof HttpError && err.status === 404) {
        return errorJson("ابتدا پروفایل و رزومه‌ی پایه‌ی خود را کامل کنید.", 404);
      }
      throw err;
    }
  });
}
