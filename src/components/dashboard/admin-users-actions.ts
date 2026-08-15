"use server";

/**
 * اکشن‌های «مدیریتِ کاربران» (Server Actions) — تنها جایی که ادمین وضعیتِ کاربرِ دیگری
 * را تغییر می‌دهد.
 *
 * قواعدِ مشترکِ همه‌ی اکشن‌های این فایل:
 *   • *اولین* کارِ هر اکشن `actingAdmin()` است — قبل از هر خواندن/نوشتن. پنهان‌بودنِ
 *     دکمه در UI هیچ‌وقت به‌عنوان کنترلِ دسترسی حساب نمی‌شود.
 *   • ورودی‌ها با zod اعتبارسنجی می‌شوند (شناسه‌ی UUID، مبلغِ مثبتِ سقف‌دار، پلنِ مجاز)؛
 *     `formData` هرگز مستقیم به DB نمی‌رود.
 *   • نتیجه به‌صورتِ `{ok, message}` برمی‌گردد (نه throw) تا فرم بتواند پیامِ فارسیِ
 *     قابل‌فهم نشان دهد؛ استثناها فقط برای خطای غیرمنتظره‌اند.
 *   • هر تغییرِ حساس در `auditEvents` ثبت می‌شود، با *ایمیلِ ادمینِ عمل‌کننده* (نه رشته‌ی
 *     ثابتِ "admin")، تا بعداً معلوم باشد چه کسی چه کرد.
 *
 * چرا «تعلیق» نشست‌ها را هم باطل می‌کند؟ چون `users.isActive=false` فقط جلوی
 * *ورودِ تازه* و راستی‌آزماییِ نشست را می‌گیرد؛ برای اینکه دسترسیِ همین‌الان قطع شود
 * باید نشست‌های زنده هم بسته شوند. این دو با هم یک عملِ اتمی معنا می‌دهند.
 */
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { auditEvents, authSessions, users } from "@/db/schema";
import { creditUnified, debitUnified } from "@/lib/billing/unified";
import { normalizePlanKey, planPeriodEnd } from "@/lib/billing/plans";

import { adminLabel, getAdminUser, type AdminUser } from "./admin-guard";

/** نتیجه‌ی یکدستِ همه‌ی اکشن‌های ادمین — پیام همیشه فارسی و قابلِ نمایش است. */
export interface AdminActionResult {
  ok: boolean;
  message: string;
}

/** پیامِ یکدستِ «مجاز نیستی» — بی‌جزئیات، تا چیزی درباره‌ی سازوکار لو ندهد. */
const DENIED: AdminActionResult = {
  ok: false,
  message: "دسترسی مجاز نیست. دوباره وارد شو و امتحان کن.",
};

/**
 * ادمینِ عمل‌کننده یا `null`.
 *
 * چرا throw نمی‌کنیم؟ چون نشستِ ادمین ممکن است *وسطِ کار* منقضی شود؛ آن‌وقت throw به
 * error boundary می‌خورد و کاربر یک صفحه‌ی خطای خام می‌بیند. با برگرداندنِ null، فرم
 * یک پیامِ فارسیِ روشن نشان می‌دهد. مرزِ امنیت عوض نمی‌شود: بدونِ ادمین هیچ اکشنی ادامه
 * نمی‌یابد.
 */
async function actingAdmin(): Promise<AdminUser | null> {
  return getAdminUser();
}

const uuid = z.string().uuid("شناسه‌ی کاربر معتبر نیست.");

/** سقفِ یک تغییرِ اعتبارِ دستی — محافظ در برابرِ صفرِ اضافه‌ی تایپی. */
const MAX_ADJUSTMENT_TOMAN = 100_000_000;

/* ────────────────────────────────  پلن  ─────────────────────────────────── */

const planSchema = z.object({
  userId: uuid,
  plan: z.enum(["free", "pro", "max", "maxplus"], {
    message: "پلنِ انتخابی معتبر نیست.",
  }),
  /** «تمدید» یعنی پایانِ دوره از امروز ۳۰ روز جلو برود. */
  renew: z.boolean(),
});

/**
 * پلنِ یک کاربر را دستی تغییر می‌دهد (پشتیبانی/جبرانِ خطا).
 *
 * توجه: این مسیر *پول جابه‌جا نمی‌کند*. اگر کاربر پرداختِ کارت‌به‌کارت کرده، مسیرِ
 * درست «تأییدِ درخواستِ پرداخت» است که هم پلن را ست می‌کند هم رسیدِ مالی می‌سازد.
 */
export async function setUserPlanAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await actingAdmin();
  if (!admin) return DENIED;

  const parsed = planSchema.safeParse({
    userId: formData.get("userId"),
    plan: formData.get("plan"),
    renew: formData.get("renew") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "ورودی نامعتبر." };
  }

  const { userId, plan, renew } = parsed.data;
  const [before] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!before) return { ok: false, message: "کاربر پیدا نشد." };

  await db
    .update(users)
    .set({
      plan,
      // رایگان انقضا ندارد؛ پلنِ پولی یا تمدید می‌شود یا انقضای فعلی‌اش می‌ماند.
      planExpiresAt:
        plan === "free" ? null : renew ? planPeriodEnd() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  await recordAdminEvent(userId, "admin_plan_changed", {
    admin: adminLabel(admin),
    from: normalizePlanKey(before.plan),
    to: plan,
    renewed: renew,
  });

  revalidateAdmin(userId);
  return { ok: true, message: "پلنِ کاربر به‌روزرسانی شد." };
}

/* ──────────────────────────────  اعتبار  ────────────────────────────────── */

const creditSchema = z.object({
  userId: uuid,
  amountToman: z.coerce
    .number()
    .int("مبلغ باید عددِ صحیح باشد.")
    .positive("مبلغ باید بزرگ‌تر از صفر باشد.")
    .max(MAX_ADJUSTMENT_TOMAN, "مبلغ از سقفِ مجازِ تغییرِ دستی بیشتر است."),
  direction: z.enum(["credit", "debit"]),
  reason: z.string().trim().min(3, "دلیل را بنویس (برای ردِ ممیزی لازم است).").max(200),
});

/**
 * اعتبارِ کیف‌پولِ واحدِ کاربر را دستی کم/زیاد می‌کند.
 *
 * پول در استخرِ 1xai است، نه در دیتابیسِ کارجو؛ پس این اکشن یک فراخوانیِ *شبکه‌ای*
 * است و می‌تواند شکست بخورد. شکست را به پیامِ فارسی تبدیل می‌کنیم و هیچ چیزی در
 * کارجو ثبت نمی‌کنیم تا دو طرف از هم جدا نیفتند (ثبتِ ممیزی فقط بعد از موفقیت).
 */
export async function adjustUserCreditAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await actingAdmin();
  if (!admin) return DENIED;

  const parsed = creditSchema.safeParse({
    userId: formData.get("userId"),
    amountToman: formData.get("amountToman"),
    direction: formData.get("direction"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "ورودی نامعتبر." };
  }

  const { userId, amountToman, direction, reason } = parsed.data;
  const reference = `admin-adjust:${userId}:${Date.now()}`;

  try {
    if (direction === "credit") {
      await creditUnified(userId, amountToman, "adjustment", reference);
    } else {
      await debitUnified(userId, amountToman, reference);
    }
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.message
          ? `تغییرِ اعتبار انجام نشد: ${error.message}`
          : "تغییرِ اعتبار انجام نشد (سرویسِ کیف‌پول در دسترس نیست).",
    };
  }

  await recordAdminEvent(userId, "admin_credit_adjusted", {
    admin: adminLabel(admin),
    direction,
    amountToman,
    reason,
    reference,
  });

  revalidateAdmin(userId);
  return {
    ok: true,
    message:
      direction === "credit" ? "اعتبار به کاربر اضافه شد." : "اعتبار از کاربر کم شد.",
  };
}

/* ────────────────────────────  تعلیق / فعال‌سازی  ────────────────────────── */

const accessSchema = z.object({
  userId: uuid,
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
  reason: z.string().trim().max(200).optional(),
});

/**
 * دسترسیِ کاربر را می‌بندد یا باز می‌کند.
 *
 * بستن = `isActive=false` + باطل‌کردنِ *همه‌ی* نشست‌های زنده (وب و افزونه) در یک
 * تراکنش، تا کاربر همین حالا بیرون بیفتد نه در تمدیدِ بعدیِ نشست.
 * بازکردن = فقط `isActive=true`؛ نشست‌های باطل‌شده برنمی‌گردند و کاربر دوباره وارد می‌شود.
 */
export async function setUserAccessAction(
  formData: FormData,
): Promise<AdminActionResult> {
  const admin = await actingAdmin();
  if (!admin) return DENIED;

  const parsed = accessSchema.safeParse({
    userId: formData.get("userId"),
    active: formData.get("active"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "ورودی نامعتبر." };
  }

  const { userId, active, reason } = parsed.data;

  // ادمین نباید بتواند حسابِ خودش را ببندد و خودش را از بخشِ مدیریت بیرون کند.
  if (!active && admin.userId === userId) {
    return { ok: false, message: "نمی‌توانی دسترسیِ حسابِ خودت را ببندی." };
  }

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { ok: false, message: "کاربر پیدا نشد." };

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ isActive: active, updatedAt: now })
      .where(eq(users.id, userId));

    if (!active) {
      await tx
        .update(authSessions)
        .set({ revokedAt: now })
        .where(
          and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)),
        );
    }
  });

  await recordAdminEvent(userId, "admin_access_changed", {
    admin: adminLabel(admin),
    active,
    reason: reason ?? null,
  });

  revalidateAdmin(userId);
  return {
    ok: true,
    message: active
      ? "دسترسیِ کاربر باز شد."
      : "دسترسی بسته شد و همه‌ی نشست‌های فعالش خارج شدند.",
  };
}

/* ────────────────────────────────  کمکی‌ها  ─────────────────────────────── */

/**
 * ثبتِ رویدادِ ادمین در `audit_events` (append-only) — با نوعِ اختصاصیِ `admin_*`
 * (مهاجرتِ 0022) تا از رویدادهای خودِ کاربر تفکیک بماند.
 *
 * اگر ثبتِ ممیزی شکست بخورد، عملِ اصلی را برنمی‌گردانیم (پول/دسترسی قبلاً تغییر کرده)
 * ولی سکوت هم نمی‌کنیم — لاگِ سرور می‌خورد.
 */
async function recordAdminEvent(
  userId: string,
  eventType: "admin_plan_changed" | "admin_credit_adjusted" | "admin_access_changed",
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditEvents).values({ userId, eventType, metadata });
  } catch (error) {
    console.error("[admin] ثبتِ رویدادِ ممیزی شکست خورد", { eventType, error });
  }
}

/** صفحه‌های ادمین بعد از هر تغییر تازه‌سازی می‌شوند. */
function revalidateAdmin(userId: string): void {
  revalidatePath("/dashboard/admin/users");
  revalidatePath(`/dashboard/admin/users/${userId}`);
}
