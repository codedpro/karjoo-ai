"use server";

/**
 * اکشن‌های ادمینِ بررسیِ پرداختِ کارت‌به‌کارت (Server Actions).
 *
 * هر اکشن با نگهبانِ ادمین (`getAdminUser` — ایمیلِ نشست در allowlist، یا کوکیِ اپراتور)
 * محافظت می‌شود؛ بدونِ مجوز هیچ‌کاری نمی‌کند (fail-closed). سبکِ form-action
 * (FormData → void) تا صفحه‌ی ادمین بدونِ هیچ JSِ کلاینتی کار کند. اعتبار/پلن فقط اینجا
 * (پس از تأییدِ انسانی) تغییر می‌کند.
 *
 * تغییرِ مهم نسبت به قبل: `reviewedBy` دیگر رشته‌ی ثابتِ «admin» نیست، بلکه *ایمیلِ
 * ادمینی* است که واقعاً کلیک کرده — بدونِ آن، ردِ ممیزیِ مالی به هیچ انسانی وصل نبود.
 */
import { revalidatePath } from "next/cache";

import { adminLabel, getAdminUser } from "./admin-guard";
import {
  approvePaymentRequest,
  rejectPaymentRequest,
} from "@/lib/billing/payments";

const ADMIN_PAYMENTS_PATH = "/dashboard/admin/payments";

/** تأییدِ یک درخواستِ پرداخت (credit/ارتقا اعمال می‌شود). */
export async function approvePaymentAction(formData: FormData): Promise<void> {
  const admin = await getAdminUser();
  if (!admin) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await approvePaymentRequest(id, adminLabel(admin)).catch(() => {});
  revalidatePath(ADMIN_PAYMENTS_PATH);
}

/** ردِ یک درخواستِ پرداخت (با دلیلِ اختیاری). */
export async function rejectPaymentAction(formData: FormData): Promise<void> {
  const admin = await getAdminUser();
  if (!admin) return;
  const id = String(formData.get("id") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!id) return;
  await rejectPaymentRequest(id, adminLabel(admin), reason).catch(() => {});
  revalidatePath(ADMIN_PAYMENTS_PATH);
}
