import "server-only";

/**
 * POST /api/profile/import
 *
 * کاربر دادهٔ *خودش* را از سایتی که در آن لاگین است ایمپورت می‌کند (قابلیتِ حملِ
 * داده‌ی کاربر — §10). افزونه (با نشستِ خودِ کاربر، حضورِ کاربر) صفحه‌ی پروفایل/رزومه‌ی
 * او را می‌خواند و *داده‌ی* ساخت‌یافته را به اینجا POST می‌کند. این اندپوینت داده را
 * نرمال می‌کند، روی CandidateProfile همان کاربر merge می‌کند، و یک رکوردِ ایمپورت ثبت می‌کند.
 *
 * با نشستِ افزونه (Bearer) احراز می‌شود (requireKind='extension').
 *
 * قواعدِ سختِ §10:
 *   • فقط داده، هرگز اعتبارنامه: اسکیمای zod هر کلیدِ شبیهِ کوکی/توکن/رمز/نشست را (در
 *     هر عمقی) رد می‌کند → ۴۰۰؛ و `normalizeImportedProfile` مستقل دوباره بررسی می‌کند.
 *   • داده‌ی هر کاربر فقط برای همان کاربر: userId از *نشست* می‌آید، نه از بدنه؛ merge و
 *     ثبت به همان userId مقید است.
 *
 * بدنه (JSON): { board, payload }
 */
import {
  json,
  parseJsonBody,
  withErrorHandling,
} from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { profileImportBodySchema } from "@/lib/apply/import-schemas";
import { applyProfileImport } from "@/lib/apply/import-service";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — فقط نشستِ افزونه (داده‌ی کاربر از مرورگرِ خودش می‌آید).
    const { userId } = await requireBearerSession(request, {
      requireKind: "extension",
    });

    // ۲) اعتبارسنجیِ بدنه. اسکیما هر فیلدِ شبیهِ اعتبارنامه را رد می‌کند (قاعده‌ی §10).
    const body = await parseJsonBody(request, profileImportBodySchema);

    // ۳) نرمال‌سازی + merge + ثبت — userId از نشست (نه از payload).
    const summary = await applyProfileImport(userId, body.board, body.payload);

    return json(summary, 201);
  });
}
