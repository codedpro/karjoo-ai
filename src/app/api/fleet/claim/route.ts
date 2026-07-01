import "server-only";

/**
 * POST /api/fleet/claim
 *
 * یک نودِ ورکرِ احرازشده کارهای آماده‌ی اپلای را claim می‌کند (Track A، قاعده‌ی ۳ — قلبِ
 * امنیتیِ ناوگان). برای *فقط* کاربرانی که به همین نود تخصیص یافته‌اند و گیتِ اپلای
 * خودکارشان می‌گذرد، و فقط آیتم‌های بالای آستانه. برای هر کار، نشستِ *خودِ همان کاربر* در
 * سمتِ سرور رمزگشایی شده و در بدنه‌ی پاسخ — *فقط به همین نودِ احرازشده‌ی مجاز* — برمی‌گردد.
 *
 * مرزهای سختِ ایمنی:
 *   • نودِ هدف *همیشه* از اعتبارنامه می‌آید (requireNodeCredential) — هرگز از بدنه. پس
 *     هیچ نودی نمی‌تواند کارهای نودِ دیگر را claim کند (claimFleetJobs خودش با همان nodeId
 *     فقط کاربرانِ تخصیص‌یافته‌ی همان نود را می‌بیند).
 *   • کلیدِ خزانه هرگز اینجا/کنترل‌پلین را ترک نمی‌کند؛ فقط نشستِ رمزگشایی‌شده‌ی هر-کار می‌رود.
 *   • نشستِ رمزگشایی‌شده *هرگز لاگ نمی‌شود* — این مسیر هیچ‌چیز از بدنه‌ی پاسخ را console
 *     نمی‌کند (و withErrorHandling هم فقط خطا را لاگ می‌کند، نه پاسخ).
 *
 * بدنه (JSON، اختیاری): { limit?: 1..25 }  (پیش‌فرض ۵)
 * پاسخ: { count, jobs: [{ taskId, userId, board, listingUrl, coverLetter, session }] }
 */
import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { requireNodeCredential } from "@/lib/api/fleet-auth";
import { fleetClaimBodySchema } from "@/lib/api/fleet-schemas";
import { claimFleetJobs } from "@/lib/fleet/dispatch";

// به DB + خزانه (رمزگشایی) دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ نود (۴۰۱ اگر اعتبارنامه نامعتبر).
    const node = await requireNodeCredential(request);

    // ۲) بدنه‌ی اختیاری (limit). بدنه‌ی خالی → پیش‌فرضِ اسکیما (limit=5).
    const { limit } = await parseOptionalBody(request);

    // ۳) claim — همیشه با node.id احرازشده. هسته خودش تخصیص + گیت + آستانه را اعمال
    //    می‌کند و نشستِ هر-کار را در سمتِ سرور رمزگشایی می‌کند.
    const jobs = await claimFleetJobs(node.id, limit);

    // ۴) پاسخ شاملِ نشستِ رمزگشایی‌شده — فقط به همین نودِ مجاز. هرگز لاگ نشود.
    return json({ count: jobs.length, jobs });
  });
}

/** بدنه‌ی claim را امن می‌خواند: بدنه‌ی خالی → پیش‌فرض (limit=5)؛ نامعتبر → ۴۰۰. */
async function parseOptionalBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) {
    return fleetClaimBodySchema.parse({});
  }
  const fakeRequest = new Request(request.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  return parseJsonBody(fakeRequest, fleetClaimBodySchema);
}
