import "server-only";

/**
 * DELETE /api/sessions/:id — ابطالِ یک نشستِ احراز (لغوِ دسترسیِ یک دستگاه/افزونه یا خروج).
 *
 * از کوکیِ نشستِ وب احراز می‌شود (getCurrentUser) — از داشبورد صدا زده می‌شود.
 *
 * قاعده‌ی ۴ + امنیت: پیش از ابطال، **مالکیتِ نشست بررسی می‌شود** — کاربر فقط نشستِ *خودش*
 * را می‌تواند باطل کند. `revokeSession` هسته به‌تنهایی userId را چک نمی‌کند، پس این چک اینجا
 * حیاتی است. نشستِ کاربرِ دیگر/ناموجود → ۴۰۴ (بدونِ فاشِ وجود). idempotent: ابطالِ نشستی که
 * قبلاً باطل شده باز هم ۲۰۰ می‌دهد (revokeSession در آن حالت false برمی‌گرداند ولی موفقیت است).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { auditEvents, authSessions } from "@/db/schema";
import { errorJson, json, withErrorHandling } from "@/lib/api/http";
import { getCurrentUser } from "@/lib/auth/http";
import { revokeSession } from "@/lib/auth/core";

// به DB دست می‌زند (+ کوکیِ نشست) → اجرای Node و رندرِ پویا لازم است.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** پارامترِ مسیرِ `:id` — باید UUIDِ معتبرِ نشست باشد (ورودیِ نامعتبر → ۴۰۰). */
const paramSchema = z.object({ id: z.string().uuid("id باید UUID معتبر باشد") });

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withErrorHandling(async () => {
    // ۱) احراز هویتِ وب — کاربر از کوکیِ نشست.
    const user = await getCurrentUser();
    if (!user) return errorJson("احراز هویت لازم است", 401);

    // ۲) اعتبارسنجیِ پارامترِ مسیر (params در Next 16 async است → await).
    const { id } = paramSchema.parse(await params);

    // ۳) مالکیت: نشست باید متعلق به همین کاربر باشد. بدونِ شرطِ revokedAt select می‌کنیم
    //    تا ابطالِ دوباره‌ی نشستِ از پیش باطل‌شده‌ی خودِ کاربر هم موفق (idempotent) بماند.
    const [row] = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(and(eq(authSessions.id, id), eq(authSessions.userId, user.id)))
      .limit(1);

    // نشستِ کاربرِ دیگر یا ناموجود → ۴۰۴ (وجود را فاش نمی‌کنیم).
    if (!row) return errorJson("نشست یافت نشد.", 404);

    // ۴) ابطال (idempotent — اگر از پیش باطل بوده false می‌دهد، ولی همچنان موفقیت است).
    await revokeSession(id);

    // ردِ ممیزی (append-only) — best-effort؛ شکستش نباید ابطال را باطل کند. هیچ توکن/راز
    // در metadata نیست، فقط شناسه‌ی نشست.
    try {
      await db.insert(auditEvents).values({
        userId: user.id,
        eventType: "session_expired",
        metadata: { action: "auth_session_revoked", sessionId: id, channel: "web" },
      });
    } catch (auditErr) {
      console.error("[session-revoke] audit write failed:", auditErr);
    }

    return json({ ok: true, id });
  });
}
