import "server-only";

/**
 * POST /api/fleet/enroll
 *
 * یک نودِ ورکرِ جدید را ثبت‌نام می‌کند (Track A، قاعده‌ی ۱). نود یک ENROLLMENT TOKENِ
 * یک‌بارمصرف (از env کنترل‌پلین) ارائه می‌دهد؛ سرور آن را طول‌ثابت راستی‌آزمایی و یک
 * اعتبارنامه‌ی هر-نودی صادر می‌کند و *فقط یک‌بار* در این پاسخ برمی‌گرداند (فقط hashش در
 * DB می‌ماند). نود از آن پس هر فراخوانی را با همین اعتبارنامه احراز می‌کند.
 *
 * این تنها مسیرِ رو-به-نود است که اعتبارنامه ندارد (هنوز صادر نشده) — احرازش رازِ
 * ثبت‌نام است، نه اعتبارنامه. اگر KARJOO_FLEET_ENROLLMENT_TOKEN تنظیم نشده باشد، ثبت‌نام
 * بسته است → ۵۰۳ (fail-closed؛ هیچ نودی بدونِ آن راز ثبت‌نام نمی‌شود).
 *
 * بدنه (JSON): { enrollmentToken, nodeKey, region?, agentVersion?, ipAddress? }
 * پاسخ: { credential, node } — `credential` فقط همین‌جا و یک‌بار.
 */
import { json, parseJsonBody, withErrorHandling } from "@/lib/api/http";
import { fleetEnrollBodySchema } from "@/lib/api/fleet-schemas";
import {
  enrollNode,
  FleetEnrollmentClosedError,
  FleetEnrollmentTokenError,
} from "@/lib/fleet/enroll";
import { publicNode } from "@/lib/api/fleet-node-view";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
// همیشه پویا — ثبت‌نام نوشتنی است و هرگز کش نمی‌شود.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) اعتبارسنجیِ بدنه (strict — فیلدِ ناشناخته رد).
    const body = await parseJsonBody(request, fleetEnrollBodySchema);

    // ۲) ثبت‌نام. خطاهای typedِ هسته را به کدِ وضعیتِ درست نگاشت می‌کنیم.
    try {
      const { credential, node } = await enrollNode(body.enrollmentToken, {
        nodeKey: body.nodeKey,
        region: body.region ?? null,
        agentVersion: body.agentVersion ?? null,
        ipAddress: body.ipAddress ?? null,
      });

      // اعتبارنامه‌ی خام فقط همین‌جا و یک‌بار برمی‌گردد. نود را بدونِ hashها برمی‌گردانیم.
      return json({ credential, node: publicNode(node) }, 201);
    } catch (err) {
      // ثبت‌نام بسته (راز env تنظیم نشده) → ۵۰۳ (سرویس فعلاً ثبت‌نام نمی‌پذیرد).
      if (err instanceof FleetEnrollmentClosedError) {
        return json({ error: "fleet enrollment closed" }, 503);
      }
      // توکنِ نادرست → ۴۰۱ (پیامِ عمومی؛ چیزی درباره‌ی توکنِ درست نشت نمی‌دهیم).
      if (err instanceof FleetEnrollmentTokenError) {
        return json({ error: "unauthorized" }, 401);
      }
      throw err;
    }
  });
}
