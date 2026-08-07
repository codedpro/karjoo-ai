import "server-only";

/**
 * GET /api/applications/:id/resume — **همان رزومه‌ای که با این اپلای ارسال شد**.
 *
 * HTMLِ ذخیره‌شده‌ی همان نسخه را برمی‌گرداند (از applications.resume_id، نه «آخرین
 * رزومه») — پس اگر کاربر بعداً رزومه‌اش را عوض کند، این‌جا باز هم همان چیزی است که
 * کارفرما دریافت کرده.
 *
 * چرا HTML و نه PDF: قالبِ رزومه از پیش A4/چاپ-آماده است (`@page size:A4`) و کانتینرِ وب
 * اصلاً Chromium ندارد (رندرِ PDF فقط در ورکر انجام می‌شود). پس همان HTML را با یک نوارِ
 * کوچکِ «چاپ / ذخیره به PDF» سرو می‌کنیم؛ خروجیِ چاپِ مرورگر همان صفحه‌ی ارسال‌شده است.
 * نوار با `@media print` هنگام چاپ حذف می‌شود.
 */
import { errorJson, withErrorHandling } from "@/lib/api/http";
import { getCurrentUserOrBearer } from "@/lib/auth/http";
import { getSentResumeHtml } from "@/lib/apply/application-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** نوارِ کوچکِ اقدام که فقط روی صفحه دیده می‌شود و در چاپ حذف می‌شود. */
const PRINT_BAR = `
<style>
  .karjoo-archive-bar{position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;
    gap:12px;align-items:center;justify-content:center;padding:10px 16px;
    background:#1a1d21;color:#fff;font:13px/1.6 Tahoma,Arial,sans-serif;direction:rtl}
  .karjoo-archive-bar button{background:#FFB020;color:#1a1d21;border:0;border-radius:6px;
    padding:6px 14px;font-weight:700;cursor:pointer;font-family:inherit}
  body{padding-top:52px}
  @media print{.karjoo-archive-bar{display:none!important}body{padding-top:0}}
</style>
<div class="karjoo-archive-bar">
  <span>این دقیقاً همان رزومه‌ای است که برای این آگهی ارسال شد.</span>
  <button onclick="window.print()">چاپ / ذخیره به PDF</button>
</div>`;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    const user = await getCurrentUserOrBearer(request);
    if (!user) return errorJson("احراز هویت لازم است", 401);

    const { id } = await params;
    const found = await getSentResumeHtml(user.id, id);
    if (!found) {
      return errorJson(
        "برای این اپلای رزومه‌ی سفارشیِ ذخیره‌شده‌ای نیست (احتمالاً با رزومه‌ی پروفایلِ خودِ سایت ارسال شده).",
        404,
      );
    }

    // نوار را بلافاصله پس از <body> تزریق می‌کنیم؛ اگر الگو تغییر کرد، به ابتدای سند.
    const html = found.html.includes("<body")
      ? found.html.replace(/(<body[^>]*>)/i, `$1${PRINT_BAR}`)
      : PRINT_BAR + found.html;

    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // بایگانیِ شخصی — هرگز کش/اشتراکی نشود.
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex, nofollow",
      },
    });
  });
}
