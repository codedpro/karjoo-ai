import "server-only";

/**
 * خواندنِ داده‌ی کیف‌پول/مصرفِ داشبورد مستقیم از DB (server-side) — طبق الگوی RSC:
 * بدونِ round-trip به API (مثلِ data.ts). همه فقط-خواندنی و مقید به userId (قاعده‌ی ۴).
 *
 * موجودی از هسته‌ی بیلینگِ Foundation (`getBalance`) خوانده می‌شود (که کیف‌پول را
 * idempotent می‌سازد اگر نباشد → ۰)؛ دفتر و رکوردهای مصرف مستقیم از جدول خوانده می‌شوند
 * (فقط ستون‌های غیرحساس). هیچ debit/credit اینجا انجام نمی‌شود.
 *
 * هر تابع با `cache` پوشانده شده تا در یک رندر، چند کامپوننت بدونِ کوئریِ تکراری از آن
 * استفاده کنند.
 */
import { cache } from "react";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  users,
  usageRecords,
  walletLedger,
  type LedgerKind,
  type Plan,
  type UsageKind,
} from "@/db/schema";
import { getBalance } from "@/lib/billing/wallet";

/** یک ردیفِ دفترِ کیف‌پول برای نمایش (هم‌ساختار با خروجیِ GET /api/wallet). */
export interface DashboardLedgerEntry {
  id: string;
  kind: LedgerKind;
  amountToman: number;
  balanceAfterToman: number;
  refType: string | null;
  description: string | null;
  createdAt: Date;
}

/** خلاصه‌ی کیف‌پول: موجودی + پلن + آخرین ردیف‌های دفتر. */
export interface DashboardWallet {
  balanceToman: number;
  plan: Plan;
  ledger: DashboardLedgerEntry[];
}

/**
 * خلاصه‌ی کیف‌پولِ کاربر را برمی‌گرداند: موجودی (از هسته‌ی بیلینگ)، پلن، و آخرین
 * ردیف‌های دفتر. مقید به userId.
 */
export const getWalletForUser = cache(
  async (userId: string, ledgerLimit = 10): Promise<DashboardWallet> => {
    const [balanceToman, planRow, ledger] = await Promise.all([
      getBalance(userId),
      db
        .select({ plan: users.plan })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
      db
        .select({
          id: walletLedger.id,
          kind: walletLedger.kind,
          amountToman: walletLedger.amountToman,
          balanceAfterToman: walletLedger.balanceAfterToman,
          refType: walletLedger.refType,
          description: walletLedger.description,
          createdAt: walletLedger.createdAt,
        })
        .from(walletLedger)
        .where(eq(walletLedger.userId, userId))
        .orderBy(desc(walletLedger.createdAt))
        .limit(ledgerLimit),
    ]);

    return {
      balanceToman,
      plan: planRow[0]?.plan ?? "payg",
      ledger,
    };
  },
);

/** یک ردیفِ مصرفِ پولیِ هوش مصنوعی برای جدولِ تاریخچه (فقط متادیتای غیرحساس). */
export interface DashboardUsageRow {
  id: string;
  kind: UsageKind;
  provider: "openai" | "anthropic" | "google";
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  costToman: number;
  createdAt: Date;
}

/** فهرستِ رکوردهای مصرفِ کاربر (تازه‌ترین اول). مقید به userId. */
export const getUsageForUser = cache(
  async (userId: string, limit = 30): Promise<DashboardUsageRow[]> => {
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
      .where(eq(usageRecords.userId, userId))
      .orderBy(desc(usageRecords.createdAt))
      .limit(limit);

    return rows as DashboardUsageRow[];
  },
);
