import "server-only";

/**
 * GET /api/sessions — فهرستِ نشست‌های احرازِ خودِ کاربر (وب و افزونه/دستگاه‌ها).
 *
 * از کوکیِ نشستِ وب احراز می‌شود (getCurrentUser) — این نما از داشبورد صدا زده می‌شود.
 *
 * قاعده‌ی ۴: کوئری به همان userIdِ نشست مقید است — کاربر فقط نشست‌های خودش را می‌بیند.
 * **هرگز توکن/هشِ توکن برنمی‌گردد** (این ستون‌ها اصلاً select نمی‌شوند) — فقط متادیتای
 * غیرحساس. نشستِ جاری (همین درخواست) با پرچمِ `current` مشخص می‌شود تا UI بتواند دکمه‌ی
 * «لغوِ دسترسی» را برای آن غیرفعال/متمایز کند (کاربر به‌اشتباه خودش را بیرون نیندازد).
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { authSessions } from "@/db/schema";
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser, readSessionToken } from "@/lib/auth/http";
import { verifySessionToken } from "@/lib/auth/core";

// به DB دست می‌زند (+ کوکیِ نشست) → اجرای Node و رندرِ پویا لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — کاربرِ فعال از کوکیِ نشست.
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // ۲) نشستِ جاری را از کوکی تشخیص بده تا در فهرست علامت بخورد (بدونِ افشای توکن).
    let currentSessionId: string | null = null;
    const token = await readSessionToken();
    if (token) {
      const verified = await verifySessionToken(token);
      currentSessionId = verified?.session.id ?? null;
    }

    // ۳) نشست‌های همین کاربر — فقط متادیتا (توکن/هش هرگز select نمی‌شود).
    const rows = await db
      .select({
        id: authSessions.id,
        kind: authSessions.kind,
        userAgent: authSessions.userAgent,
        createdAt: authSessions.createdAt,
        lastSeen: authSessions.lastUsedAt,
        expiresAt: authSessions.expiresAt,
        revokedAt: authSessions.revokedAt,
      })
      .from(authSessions)
      .where(eq(authSessions.userId, user.id))
      .orderBy(desc(authSessions.createdAt));

    const sessions = rows.map((r) => ({ ...r, current: r.id === currentSessionId }));

    return json({ count: sessions.length, sessions });
  });
}
