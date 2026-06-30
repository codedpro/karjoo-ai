import "server-only";

/**
 * GET /api/usage?kind=<...>&limit=<n>&offset=<n>
 *
 * فهرستِ صفحه‌بندی‌شده‌ی رکوردهای مصرفِ پولیِ هوش مصنوعیِ کاربرِ احرازشده را برمی‌گرداند
 * (مدل، نوع، توکن‌ها، هزینه‌ی نهایی به تومان، تاریخ). فقط-خواندنی.
 *
 * امنیت (قاعده‌ی ۴ CONTEXT — دادهٔ هر کاربر فقط برای همان کاربر): کاربرِ هدف از کوکیِ
 * نشست گرفته می‌شود، نه از کوئری؛ کوئری همیشه به همان userId مقید است. هیچ ستونِ حساسی
 * (پرامپت/خروجیِ مدل) ذخیره یا برگردانده نمی‌شود — فقط متادیتای مصرف/هزینه.
 */
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { usageRecords } from "@/db/schema";
import { errorJson, json, parseSearchParams, withErrorHandling } from "@/lib/api/http";
import { usageQuerySchema } from "@/lib/api/billing-schemas";
import { getCurrentUser } from "@/lib/auth/http";

// به DB و node API (cookies) دست می‌زند → اجرای Node و رندرِ پویا.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — userId از کوکیِ نشست (نه از کوئری).
    const user = await getCurrentUser();
    if (!user) {
      return errorJson("احراز هویت لازم است", 401);
    }

    // ۲) اعتبارسنجیِ کوئری (kind/limit/offset؛ userId از بیرون گرفته نمی‌شود).
    const { searchParams } = new URL(request.url);
    const query = parseSearchParams(searchParams, usageQuerySchema);

    // ۳) شرطِ where: همیشه userIdِ نشست؛ به‌علاوه‌ی kind در صورت وجود (قاعده‌ی ۴).
    const where = query.kind
      ? and(eq(usageRecords.userId, user.id), eq(usageRecords.kind, query.kind))
      : eq(usageRecords.userId, user.id);

    // ۴) خواندنِ صفحه — فقط ستون‌های غیرحساس (هیچ پرامپت/خروجی نگه‌داری نمی‌شود).
    const rows = await db
      .select({
        id: usageRecords.id,
        kind: usageRecords.kind,
        provider: usageRecords.provider,
        modelId: usageRecords.modelId,
        promptTokens: usageRecords.promptTokens,
        completionTokens: usageRecords.completionTokens,
        costToman: usageRecords.costToman,
        createdAt: usageRecords.createdAt,
      })
      .from(usageRecords)
      .where(where)
      .orderBy(desc(usageRecords.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    return json({
      count: rows.length,
      limit: query.limit,
      offset: query.offset,
      usage: rows,
    });
  });
}
