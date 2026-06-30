import "server-only";

/**
 * خواندنِ داده‌ی صفحه‌ی «اپلای خودکار» مستقیم از DB (server-side، الگوی RSC).
 *
 * همه فقط-خواندنی و مقید به userId (قاعده‌ی ۴: داده‌ی هر کاربر فقط برای همان کاربر).
 * این لایه «مصرف‌کننده» است: تنظیماتِ مؤثر را از هسته‌ی Foundation (getAutoApplySettings)
 * می‌گیرد، وضعیتِ پلن/سهمیه‌ی اپلای را از plan-data، و فهرستِ کوتاهِ ردِ ممیزیِ اپلایِ
 * خودکار را مستقیم از جدولِ audit_events می‌خواند (فقط رویدادهای auto_apply_*).
 *
 * هیچ ستونِ حساسی (نشست/کلید) خوانده نمی‌شود؛ metadataِ ممیزی فقط متادیتای تصمیم است.
 */
import { cache } from "react";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { auditEvents, boardAccounts } from "@/db/schema";
import { getAutoApplySettings, type AutoApplySettings } from "@/lib/apply/auto-apply";
import { isApplySpecReady } from "@/lib/apply/apply-spec";
import { getUserPlanStatus, type ApplyUsageStatus } from "@/components/dashboard/plan-data";

/** رویدادهای ممیزیِ مربوط به اپلای خودکار (زیرمجموعه‌ی audit_event_type). */
const AUTO_APPLY_EVENTS = [
  "auto_apply_enabled",
  "auto_apply_disabled",
  "auto_apply_attempted",
  "auto_apply_skipped",
] as const;

export type AutoApplyAuditEventType = (typeof AUTO_APPLY_EVENTS)[number];

/** یک حسابِ متصل + آمادگیِ مشخصاتِ اپلای آن سایت (برای پنلِ آمادگی). */
export interface BoardReadiness {
  board: string;
  status: "connected" | "expired" | "needs_reauth";
  /** آیا APPLY_SPEC این سایت در حدِ best-effort آماده است (نه صرفاً scaffold)؟ */
  specReady: boolean;
}

/** یک ردیفِ خلاصه از ردِ ممیزیِ اپلای خودکار (برای نمایش). */
export interface AutoApplyAuditRow {
  id: string;
  eventType: AutoApplyAuditEventType;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

/** بسته‌ی کاملِ داده‌ی صفحه‌ی اپلای خودکار. */
export interface AutoApplyDashboardData {
  settings: AutoApplySettings;
  /** سقف/مصرفِ اپلای امروز (از پلن) — برای نمایشِ «امروز X از Y». */
  apply: ApplyUsageStatus;
  /** فهرستِ حساب‌های متصل + آمادگیِ spec. */
  boards: BoardReadiness[];
  /** آیا دستِ‌کم یک حسابِ متصل با specِ آماده وجود دارد؟ (پیش‌نیازِ کاربردیِ اپلای). */
  hasReadyBoard: boolean;
  /** آخرین رویدادهای ممیزیِ اپلای خودکار (تازه‌ترین اول). */
  audit: AutoApplyAuditRow[];
}

/** فهرستِ حساب‌های متصلِ کاربر + آمادگیِ spec هر سایت. مقید به userId. */
async function readBoardReadiness(userId: string): Promise<BoardReadiness[]> {
  const rows = await db
    .select({
      board: boardAccounts.board,
      status: boardAccounts.status,
    })
    .from(boardAccounts)
    .where(eq(boardAccounts.userId, userId))
    .orderBy(desc(boardAccounts.lastConnectedAt));

  return rows.map((r) => ({
    board: r.board,
    status: r.status,
    specReady: isApplySpecReady(r.board),
  }));
}

/**
 * آخرین ردیف‌های ممیزیِ اپلای خودکارِ این کاربر را می‌خواند (فقط رویدادهای auto_apply_*).
 * مقید به userId و فیلترشده روی نوعِ رویداد تا چیزی فراتر از اپلای خودکار نشت نکند.
 */
async function readAutoApplyAudit(
  userId: string,
  limit: number,
): Promise<AutoApplyAuditRow[]> {
  const rows = await db
    .select({
      id: auditEvents.id,
      eventType: auditEvents.eventType,
      metadata: auditEvents.metadata,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.userId, userId),
        inArray(auditEvents.eventType, [...AUTO_APPLY_EVENTS]),
      ),
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);

  // eventType از enum می‌آید و با فیلترِ بالا تضمیناً یکی از AUTO_APPLY_EVENTS است.
  return rows as AutoApplyAuditRow[];
}

/**
 * همه‌ی داده‌ی صفحه‌ی اپلای خودکار را می‌سازد: تنظیماتِ مؤثر، سهمیه‌ی اپلای امروز،
 * آمادگیِ حساب‌های متصل و ردِ ممیزی. همه مقید به userId (قاعده‌ی ۴). هیچ چیزی نمی‌نویسد.
 *
 * @param auditLimit بیشینه‌ی ردیف‌های ممیزیِ بازگشتی (پیش‌فرض ۲۰).
 */
export const getAutoApplyDashboardData = cache(
  async (
    userId: string,
    auditLimit = 20,
  ): Promise<AutoApplyDashboardData> => {
    const [settings, planStatus, boards, audit] = await Promise.all([
      getAutoApplySettings(userId),
      getUserPlanStatus(userId),
      readBoardReadiness(userId),
      readAutoApplyAudit(userId, auditLimit),
    ]);

    return {
      settings,
      apply: planStatus.apply,
      boards,
      hasReadyBoard: boards.some(
        (b) => b.specReady && b.status === "connected",
      ),
      audit,
    };
  },
);
