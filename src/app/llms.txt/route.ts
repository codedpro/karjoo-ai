import { itmaster, toKarjooHost } from "@/lib/itmaster";

/**
 * llms.txt — فهرستِ محتوا برای موتورهای جست‌وجوی هوش مصنوعی.
 *
 * از موتورِ محتوا می‌آید ولی هاست بازنویسی می‌شود: موتور همه‌ی لینک‌ها را با دامنه‌ی خودش
 * (`karjooai.itmaster.uk`) می‌نویسد، در حالی که کارجو زیرِ `karjoo.1xai.ir` سرو می‌شود.
 * بدونِ این، هر لینکی که ChatGPT/Perplexity از این فایل برمی‌دارد به ۴۰۴ می‌رسد.
 */
export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  let body = "";
  try {
    body = toKarjooHost((await itmaster.llmsTxt()) ?? "");
  } catch {
    body = "";
  }
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
