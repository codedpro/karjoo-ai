import "server-only";

/**
 * POST /api/resume/tailor  (وب، کوکیِ کاربر)  — body: { listingId }
 *
 * رزومه‌ی هدف‌گیری‌شده برای یک آگهی می‌سازد (AIِ مترشده، هزینه به کیف‌پولِ 1xAiِ کاربر) و
 * ذخیره می‌کند. خروجی: { id, headline, jobTitle } — پیش‌نمایش از /api/resume/tailored?id=…
 */
import { z } from "zod";

import { errorJson, HttpError, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { generateTailoredResume } from "@/lib/resume/custom-resume-service";
import { InsufficientBalanceError } from "@/lib/billing/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ listingId: z.string().uuid() }).strict();

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUser();
    if (!user) return errorJson("برای ساختِ رزومه‌ی سفارشی وارد شوید.", 401);

    let listingId: string;
    try {
      listingId = bodySchema.parse(await request.json()).listingId;
    } catch {
      return errorJson("آگهیِ نامعتبر.", 400);
    }

    try {
      // کاربر خودش این آگهی را انتخاب کرده و رزومه‌ی همین شغل را خواسته.
      const result = await generateTailoredResume(user.id, listingId, { source: "manual" });
      return json({ id: result.id, headline: result.headline, jobTitle: result.jobTitle }, 201);
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return json(
          { error: "موجودیِ کیف‌پولِ 1xAi کافی نیست — شارژ کنید.", topupUrl: "https://1xai.ir/topup" },
          402,
        );
      }
      if (err instanceof HttpError && err.status === 404) {
        return errorJson("ابتدا پروفایل/رزومه‌ی پایه را کامل کنید و آگهیِ معتبر انتخاب کنید.", 404);
      }
      throw err;
    }
  });
}
