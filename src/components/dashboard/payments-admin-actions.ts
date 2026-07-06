"use server";

/**
 * اکشن‌های ادمینِ بررسیِ پرداختِ کارت‌به‌کارت (Server Actions).
 *
 * هر اکشن با نگهبانِ ادمین (isFleetAdmin — مقایسه‌ی رازِ داخلیِ سرور سمتِ سرور) محافظت
 * می‌شود؛ بدونِ کوکیِ ادمینِ معتبر هیچ‌کاری نمی‌کند (fail-closed). سبکِ form-action
 * (FormData → void) تا صفحه‌ی ادمین بدونِ هیچ JSِ کلاینتی کار کند. اعتبار/پلن فقط اینجا
 * (پس از تأییدِ انسانی) تغییر می‌کند.
 */
import { revalidatePath } from "next/cache";

import { isFleetAdmin } from "./fleet-admin-guard";
import {
  approvePaymentRequest,
  rejectPaymentRequest,
} from "@/lib/billing/payments";

const ADMIN_PAYMENTS_PATH = "/dashboard/admin/payments";

/** تأییدِ یک درخواستِ پرداخت (credit/ارتقا اعمال می‌شود). */
export async function approvePaymentAction(formData: FormData): Promise<void> {
  if (!(await isFleetAdmin())) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await approvePaymentRequest(id, "admin").catch(() => {});
  revalidatePath(ADMIN_PAYMENTS_PATH);
}

/** ردِ یک درخواستِ پرداخت (با دلیلِ اختیاری). */
export async function rejectPaymentAction(formData: FormData): Promise<void> {
  if (!(await isFleetAdmin())) return;
  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!id) return;
  await rejectPaymentRequest(id, "admin", reason).catch(() => {});
  revalidatePath(ADMIN_PAYMENTS_PATH);
}
