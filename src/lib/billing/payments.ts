import "server-only";

/**
 * پرداختِ کارت‌به‌کارت (billing) — هسته‌ی جایگزینِ استابِ خودشارژِ توسعه.
 *
 * جریان:
 *   ۱) کاربر مبلغ را به کارتِ مقصد منتقل و کدِ پیگیری را ثبت می‌کند →
 *      `createPaymentRequest` یک ردیفِ `pending` می‌سازد (هیچ اعتبار/پلنی تغییر نمی‌کند).
 *   ۲) ادمین در پنل بررسی و *تأیید* می‌کند → `approvePaymentRequest`:
 *        • topup → `credit(...)` کیف‌پول (اتمیک، با refِ همان درخواست).
 *        • plan  → `users.plan` ست و گرنتِ ماهانه اعمال می‌شود.
 *      یا *رد* می‌کند → `rejectPaymentRequest`.
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
import { credit } from "@/lib/billing/wallet";
import { grantMonthlyCredits } from "@/lib/billing/grants";

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
 * تأیید هم rollback می‌شود). گرنتِ ماهانه‌ی پلن پس از commit (ایدمپوتنت) اجرا می‌شود.
 */
export async function approvePaymentRequest(
  id: string,
  reviewedBy: string,
  db: PaymentsDb = defaultDb,
  now: number = Date.now(),
): Promise<ReviewResult> {
  const nowD = new Date(now);

  const outcome: ReviewResult = await db.transaction(async (tx) => {
    const [req] = await tx
      .select()
      .from(paymentRequests)
      .where(eq(paymentRequests.id, id))
      .limit(1)
      .for("update");
    if (!req) throw new Error("درخواستِ پرداخت یافت نشد");
    if (req.status !== "pending") return { status: "already", request: req };

    let ledgerId: string | null = null;
    if (req.kind === "topup") {
      const res = await credit(
        req.userId,
        "topup",
        req.amountToman,
        { refType: "card_transfer", refId: req.id, description: "شارژِ کارت‌به‌کارت (تأییدشده)" },
        // tx یک PgTransaction است و ساختاری با WalletDb سازگار است (insert/update/
        // transaction برای savepoint)؛ credit درونش به‌صورتِ nested-tx اجرا می‌شود.
        tx as unknown as PaymentsDb,
      );
      ledgerId = res.ledgerId;
    } else if (req.kind === "plan" && req.targetPlan) {
      await tx
        .update(users)
        .set({ plan: req.targetPlan, updatedAt: nowD })
        .where(eq(users.id, req.userId));
    }

    const [updated] = await tx
      .update(paymentRequests)
      .set({ status: "approved", reviewedBy, reviewedAt: nowD, ledgerId, updatedAt: nowD })
      .where(eq(paymentRequests.id, id))
      .returning();
    return { status: "approved", request: updated };
  });

  // گرنتِ ماهانه‌ی پلن پس از commit — ایدمپوتنت per (کاربر، ماه)؛ خطایش تأیید را برنمی‌گرداند.
  if (outcome.status === "approved" && outcome.request?.kind === "plan" && outcome.request.targetPlan) {
    await grantMonthlyCredits(outcome.request.userId, { plan: outcome.request.targetPlan }).catch(
      () => {},
    );
  }
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
