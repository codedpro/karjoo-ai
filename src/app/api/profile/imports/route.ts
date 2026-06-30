import "server-only";

/**
 * GET /api/profile/imports
 *
 * تاریخچه‌ی ایمپورتِ پروفایلِ کاربرِ احرازشده را برمی‌گرداند (فقط متادیتا — نه خودِ
 * rawPayloadِ خام). با نشستِ افزونه یا وب (Bearer) قابلِ احراز است تا داشبوردِ وب هم
 * بتواند تاریخچه را نشان دهد.
 *
 * قاعده‌ی §10: فقط دادهٔ همین کاربر — کوئری به `userId`ِ نشست مقید است.
 *
 * Query (اختیاری): ?limit=1..100 (پیش‌فرض ۲۰).
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { profileImports } from "@/db/schema";
import { json, parseSearchParams, withErrorHandling } from "@/lib/api/http";
import { requireBearerSession } from "@/lib/api/bearer-auth";
import { profileImportsQuerySchema } from "@/lib/apply/import-schemas";

// به DB دست می‌زند → اجرای Node لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویت — افزونه یا وب (بدونِ requireKind).
    const { userId } = await requireBearerSession(request);

    // ۲) limitِ اختیاری از query.
    const url = new URL(request.url);
    const { limit } = parseSearchParams(url.searchParams, profileImportsQuerySchema);

    // ۳) تاریخچه‌ی همین کاربر (فقط متادیتا؛ rawPayloadِ خام برنمی‌گردد).
    const imports = await db
      .select({
        id: profileImports.id,
        board: profileImports.board,
        status: profileImports.status,
        appliedFields: profileImports.appliedFields,
        createdAt: profileImports.createdAt,
      })
      .from(profileImports)
      .where(eq(profileImports.userId, userId))
      .orderBy(desc(profileImports.createdAt))
      .limit(limit);

    return json({ count: imports.length, imports });
  });
}
