import "server-only";

/**
 * پرداختِ کارت‌به‌کارت (billing) — هسته‌ی جایگزینِ استابِ خودشارژِ توسعه.
 *
 * ⚠️ *در حالِ بازنشستگی* (کیف‌پولِ واحدِ 1xAi): کارجو دیگر پول نمی‌گیرد — شارژ فقط در
 * https://1xai.ir/topup و ارتقای پلن با debitِ فوری از کیف‌پولِ واحد (POST /api/me/plan)
 * انجام می‌شود. این ماژول فقط برای *رسیدگی به درخواست‌های تاریخیِ* pending می‌ماند:
 *   • topup‌های قدیمی → تأییدِ ادمین همچنان کیف‌پولِ *محلی* را credit می‌کند (دریچه‌ی
 *     فرارِ تاریخی؛ هیچ مسیرِ جدیدی درخواستِ topup نمی‌سازد).
 *   • plan‌های قدیمی → تأییدِ ادمین فقط users.plan را ست می‌کند — *هیچ گرنتِ ماهانه‌ای*
 *     دیگر وجود ندارد (پلن = استحقاق + قیمت، نه اعتبار).
 *
 * تضمینِ ایمنی (بحرانی): هیچ اعتبار یا ارتقایی بدونِ تأییدِ *انسانیِ* ادمین انجام
 * نمی‌شود؛ پس کاربر نمی‌تواند خودش را رایگان شارژ/ارتقا دهد (رفعِ ریشه‌ایِ استابِ dev).
 * تأیید ایدمپوتنت است: قفلِ ردیف (FOR UPDATE) + گیتِ status='pending' مانعِ دوباره‌credit.
 */
import { and, desc, eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import {
  paymentRequests,
  users,
  type PaymentKind,
  type PaymentRequest,
  type Plan,
} from "@/db/schema";
import { creditPool } from "@/lib/onexai/svc";
import { ensureOnexaiLink } from "@/lib/billing/unified";

/** هندلِ کاملِ Drizzle (به transaction نیاز است). */
export type PaymentsDb = typeof defaultDb;

/** ورودیِ ساختِ درخواستِ پرداخت. */
export interface CreatePaymentInput {
  kind: PaymentKind;
  amountToman: number;
  /** فقط برای kind='plan'. */
  targetPlan?: Plan;
  referenceCode?: string | null;
  payerCardLast4?: string | null;
  note?: string | null;
}

/**
 * یک درخواستِ پرداختِ `pending` می‌سازد (هیچ اثری روی کیف‌پول/پلن ندارد تا تأییدِ ادمین).
 */
export async function createPaymentRequest(
  userId: string,
  input: CreatePaymentInput,
  db: PaymentsDb = defaultDb,
): Promise<PaymentRequest> {
  const [row] = await db
    .insert(paymentRequests)
    .values({
      userId,
      kind: input.kind,
      amountToman: Math.round(input.amountToman),
      targetPlan: input.kind === "plan" ? input.targetPlan ?? null : null,
      referenceCode: input.referenceCode ?? null,
      payerCardLast4: input.payerCardLast4 ?? null,
      note: input.note ?? null,
    })
    .returning();
  return row;
}

/** درخواست‌های پرداختِ همین کاربر (تازه‌ترین اول). */
export async function listUserPaymentRequests(
  userId: string,
  limit = 20,
  db: PaymentsDb = defaultDb,
): Promise<PaymentRequest[]> {
  return db
    .select()
    .from(paymentRequests)
    .where(eq(paymentRequests.userId, userId))
    .orderBy(desc(paymentRequests.createdAt))
    .limit(limit);
}

/** همه‌ی درخواست‌های در انتظارِ بررسی (برای پنلِ ادمین). */
export async function listPendingPaymentRequests(
  limit = 100,
  db: PaymentsDb = defaultDb,
): Promise<PaymentRequest[]> {
  return db
    .select()
    .from(paymentRequests)
    .where(eq(paymentRequests.status, "pending"))
    .orderBy(desc(paymentRequests.createdAt))
    .limit(limit);
}

/** نتیجه‌ی بررسیِ ادمین. `already` = قبلاً بررسی شده (ایدمپوتنت). */
export interface ReviewResult {
  status: "approved" | "rejected" | "already";
  request?: PaymentRequest;
}

/**
 * ادمین درخواست را *تأیید* می‌کند. اتمیک و ایدمپوتنت: ردیف را FOR UPDATE قفل می‌کند؛
 * اگر دیگر pending نبود، بدونِ اثر برمی‌گردد ({status:'already'}). در غیرِ این‌صورت اثرِ
 * پرداخت را اعمال و وضعیت را approved می‌کند — همه در یک تراکنش (اگر credit شکست بخورد،
 * تأیید هم rollback می‌شود). تأییدِ plan فقط users.plan را ست می‌کند — گرنتِ ماهانه با
 * کیف‌پولِ واحدِ 1xai حذف شده است (پلن = استحقاق + قیمت).
 */
export async function approvePaymentRequest(
  id: string,
  reviewedBy: string,
  db: PaymentsDb = defaultDb,
  now: number = Date.now(),
  deps: { creditPoolFn?: typeof creditPool; ensureLinkFn?: typeof ensureOnexaiLink } = {},
): Promise<ReviewResult> {
  const nowD = new Date(now);

  // topupهای *تاریخیِ* کارت‌به‌کارت باید به کیف‌پولِ *واحدِ 1xai* واریز شوند — کیف‌پولِ
  // محلی بازنشسته است و هیچ گیتی آن را نمی‌خواند؛ واریزِ محلی یعنی پولِ واقعیِ کاربر در
  // ردیف‌های مرده گم می‌شد. ترتیبِ امن (هم‌الگوی خریدِ پلن): اول واریزِ idempotentِ pool
  // (reference=karjoo:payment:<id> — retry بی‌اثر)، بعد تأییدِ ردیف. اگر تأیید شکست
  // بخورد، درخواست pending می‌ماند و تلاشِ بعدیِ ادمین با همان reference بی‌ضرر است.
  const readReq = async () => {
    const [r] = await db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id))
      .limit(1);
    return r;
  };
  const pre = await readReq();
  if (!pre) throw new Error("درخواستِ پرداخت یافت نشد");
  if (pre.status !== "pending") return { status: "already", request: pre };

  if (pre.kind === "topup") {
    const ensureLink = deps.ensureLinkFn ?? ensureOnexaiLink;
    const doCredit = deps.creditPoolFn ?? creditPool;
    const poolId = await ensureLink(pre.userId, { db });
    await doCredit({
      onexaiUserId: poolId,
      amountToman: pre.amountToman,
      kind: "topup",
      reference: `karjoo:payment:${pre.id}`,
    });
  }

  const outcome: ReviewResult = await db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id))
      .limit(1)
      .for("update");
    if (!req) throw new Error("درخواستِ پرداخت یافت نشد");
    // ریسِ دو ادمین: اگر بینِ واریزِ pool و این قفل، دیگری تأیید کرده باشد، واریزِ
    // idempotentِ ما already بوده و این‌جا بدونِ اثرِ دوباره برمی‌گردیم.
    if (req.status !== "pending") return { status: "already", request: req };

    if (req.kind === "plan" && req.targetPlan) {
      await tx
        .update(users)
        .set({ plan: req.targetPlan, updatedAt: nowD })
        .where(eq(users.id, req.userId));
    }

    const [updated] = await tx
      .update(paymentRequests)
      .set({
        status: "approved",
        reviewedBy,
        reviewedAt: nowD,
        // مرجعِ واریزِ pool (نه ledgerِ محلی) — برای ردگیریِ حسابرسی.
        ledgerId: req.kind === "topup" ? `karjoo:payment:${req.id}` : null,
        updatedAt: nowD,
      })
      .where(eq(paymentRequests.id, id))
      .returning();
    return { status: "approved", request: updated };
  });

  // گرنتِ ماهانه حذف شده (کیف‌پولِ واحد)؛ تأییدِ plan فقط استحقاق (users.plan) را ست می‌کند.
  return outcome;
}

/** ادمین درخواست را *رد* می‌کند (فقط اگر هنوز pending باشد). */
export async function rejectPaymentRequest(
  id: string,
  reviewedBy: string,
  reason: string | null,
  db: PaymentsDb = defaultDb,
  now: number = Date.now(),
): Promise<ReviewResult> {
  const nowD = new Date(now);
  const [updated] = await db
    .update(paymentRequests)
    .set({
      status: "rejected",
      reviewedBy,
      reviewedAt: nowD,
      rejectionReason: reason ?? null,
      updatedAt: nowD,
    })
    .where(and(eq(paymentRequests.id, id), eq(paymentRequests.status, "pending")))
    .returning();
  if (!updated) {
    const [existing] = await db
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id))
      .limit(1);
    if (!existing) throw new Error("درخواستِ پرداخت یافت نشد");
    return { status: "already", request: existing };
  }
  return { status: "rejected", request: updated };
}
