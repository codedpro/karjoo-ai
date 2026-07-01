import "server-only";

/**
 * نگهبانِ احراز هویتِ نودِ ورکر برای مسیرهای رو-به-نود (worker-facing) — Track A.
 *
 * هر مسیرِ ناوگان که نود صدا می‌زند (heartbeat/claim/result/commands/ack) باید نود را
 * با اعتبارنامه‌ی هر-نودی‌اش احراز کند — نه با userId/nodeId از بدنه (که قابلِ جعل است).
 * این لایه‌ی نازک، اعتبارنامه‌ی خام را از هدر می‌خواند و با `verifyNodeCredential` از
 * هسته‌ی fleet راستی‌آزمایی می‌کند؛ سپس مسیرها همیشه از `node.id`ِ احرازشده استفاده
 * می‌کنند (قاعده‌ی امنیت: «سرور نود را با اعتبارنامه‌اش می‌شناسد»).
 *
 * قواعد ایمنی:
 *   • fail-closed — نبودِ هدر، اعتبارنامه‌ی نامعتبر، یا نودِ ثبت‌نام‌نشده ⇒ `HttpError(401)`؛
 *     هرگز با اعتبارنامه‌ی نامعتبر باز نمی‌ماند.
 *   • اعتبارنامه‌ی خام هرگز لاگ نمی‌شود (فقط hashش در DB است؛ این تابع آن را به verify
 *     می‌سپارد و دور می‌اندازد).
 *   • تزریق‌پذیر — `verify` قابلِ override در تست است (هسته‌ی fleet mock می‌شود) تا
 *     تست‌ها بدون DB/شبکه‌ی زنده اجرا شوند (قاعده‌ی پروژه).
 *
 * قالبِ هدر: `Authorization: Bearer <credential>` — همان قراردادِ مسیرهای دیگرِ کارجو.
 * (هدرِ سازگارِ `X-Node-Credential` هم پذیرفته می‌شود تا نودِ ساده بتواند بدونِ ساختِ
 * هدرِ Authorization هم احراز شود.)
 */
import { verifyNodeCredential as defaultVerify } from "@/lib/fleet/enroll";
import { HttpError } from "@/lib/api/http";
import type { WorkerNode } from "@/db/schema";

/** امضای تابعِ راستی‌آزماییِ اعتبارنامه‌ی نود — هم‌راستا با `verifyNodeCredential` هسته. */
export type VerifyNodeFn = (rawCredential: string) => Promise<WorkerNode | null>;

/** آپشن‌های نگهبانِ نود — تزریقِ تابعِ راستی‌آزمایی برای تست. */
export interface FleetAuthOptions {
  /** override راستی‌آزمایی (پیش‌فرض `verifyNodeCredential` هسته). فقط برای تست. */
  verify?: VerifyNodeFn;
}

/**
 * اعتبارنامه‌ی خامِ نود را از هدرِ درخواست استخراج می‌کند.
 *   • `Authorization: Bearer <credential>` (حساس به حروفِ بزرگِ کلیدواژه نیست)، یا
 *   • `X-Node-Credential: <credential>` (سازگار برای نودِ ساده).
 * در صورتِ نبود/بدشکل بودن، null برمی‌گرداند (فراخواننده fail-closed می‌کند).
 */
export function extractNodeCredential(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header) {
    const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
    if (match) return match[1];
  }
  const direct = request.headers.get("x-node-credential");
  if (direct && direct.trim()) return direct.trim();
  return null;
}

/**
 * مسیرِ رو-به-نود را احراز هویت می‌کند و ردیفِ نودِ معتبر را برمی‌گرداند، یا
 * `HttpError(401)` پرتاب می‌کند. پیامِ عمومیِ «unauthorized» نگه داشته می‌شود تا چیزی
 * درباره‌ی اعتبارنامه‌ی درست/وجودِ نود نشت ندهد.
 *
 * مسیرها باید *همیشه* از `node.id`ِ این تابع استفاده کنند (نه از بدنه‌ی درخواست) تا
 * هیچ نودی نتواند به‌جای نودِ دیگر عمل کند (قاعده‌ی امنیت).
 */
export async function requireNodeCredential(
  request: Request,
  opts: FleetAuthOptions = {},
): Promise<WorkerNode> {
  const credential = extractNodeCredential(request);
  if (!credential) {
    throw new HttpError(401, "unauthorized");
  }

  const verify = opts.verify ?? defaultVerify;
  const node = await verify(credential);
  if (!node) {
    throw new HttpError(401, "unauthorized");
  }

  return node;
}
