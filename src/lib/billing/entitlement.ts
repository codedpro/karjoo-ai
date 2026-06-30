import "server-only";

/**
 * نگهبانِ استحقاقِ استفاده از سرویسِ پولیِ هوش مصنوعی (server-only).
 *
 * قاعده‌ی قفل‌شده (CONTEXT): یک فراخوانیِ پولی نیازمندِ «موجودیِ کیف‌پول > ۰» است و
 * گیت *پیش از* فراخوانیِ مدل انجام می‌شود (هرگز بی‌سروصدا هزینه‌ی بالادست خرج نشود).
 *   • پلنِ free  → هرگز اجازه‌ی فراخوانیِ پولی ندارد.
 *   • پلنِ payg  → اگر موجودی > ۰ باشد مجاز است.
 *   • پلنِ premium → با اعتبارِ هدیه/موجودی > ۰ مجاز است (همان شرطِ موجودی).
 *
 * db و خواننده‌ی پلن/موجودی تزریق‌پذیرند تا تستِ بدونِ DB ممکن باشد.
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { users, type Plan } from "@/db/schema";
import { getBalance, type WalletDb } from "@/lib/billing/wallet";
import { InsufficientBalanceError } from "@/lib/billing/errors";

/** هندلِ کمینه‌ی DB که این لایه نیاز دارد (خواندنِ پلن + موجودی). */
export type EntitlementDb = typeof defaultDb;

/**
 * کنش‌های «همیشه رایگان» که هرگز مترِ نمی‌شوند (CONTEXT):
 *   • resume_upload — آپلودِ PDF + استخراجِ متنِ خام (بدونِ AI).
 *   • apply         — اپلای از طریقِ افزونه.
 * این فهرست منبعِ حقیقتِ «رایگان بودن» است؛ هر کنشِ بیرونِ آن که هوش مصنوعی صدا
 * بزند پولی است و باید از metering عبور کند.
 */
export const FREE_ACTIONS = ["resume_upload", "apply"] as const;
export type FreeAction = (typeof FREE_ACTIONS)[number];

/** آیا این کنش «همیشه رایگان» است؟ (آپلود/استخراجِ متن، اپلای). */
export function isFreeAction(action: string): action is FreeAction {
  return (FREE_ACTIONS as readonly string[]).includes(action);
}

/** نتیجه‌ی موفقِ گیت — پلن و موجودیِ فعلی (برای فراخواننده/لاگ). */
export interface Entitlement {
  plan: Plan;
  balanceToman: number;
}

/** وابستگی‌های قابلِ‌تزریقِ گیت — برای تستِ بدونِ DB. */
export interface EntitlementDeps {
  db?: EntitlementDb;
  /** خواننده‌ی پلنِ کاربر (پیش‌فرض از جدولِ users). */
  readPlan?: (userId: string) => Promise<Plan>;
  /** خواننده‌ی موجودی (پیش‌فرض getBalance از کیف‌پول). */
  readBalance?: (userId: string) => Promise<number>;
}

/** پلنِ کاربر را از جدولِ users می‌خواند (پیش‌فرضِ readPlan). */
async function defaultReadPlan(userId: string, db: EntitlementDb): Promise<Plan> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // اگر کاربر یافت نشد، محتاطانه free فرض می‌کنیم (fail-closed → باید شارژ/پلن داشته باشد).
  return row?.plan ?? "free";
}

/**
 * تأیید می‌کند کاربر اجازه‌ی یک فراخوانیِ پولیِ هوش مصنوعی را دارد، وگرنه
 * `InsufficientBalanceError` (typed) پرتاب می‌کند. این را *پیش از* فراخوانیِ گیت‌وی
 * صدا بزنید.
 *
 * @returns پلن + موجودیِ فعلی در صورتِ مجاز بودن.
 */
export async function assertCanUsePaidAi(
  userId: string,
  deps: EntitlementDeps = {},
): Promise<Entitlement> {
  const db = deps.db ?? defaultDb;
  const readPlan = deps.readPlan ?? ((id: string) => defaultReadPlan(id, db));
  const readBalance =
    deps.readBalance ?? ((id: string) => getBalance(id, db as unknown as WalletDb));

  const plan = await readPlan(userId);
  const balanceToman = await readBalance(userId);

  // پلنِ free هرگز اجازه‌ی فراخوانیِ پولی ندارد.
  if (plan === "free") {
    throw new InsufficientBalanceError({ balanceToman, plan });
  }
  // payg/premium: نیازمندِ موجودیِ مثبت (اعتبارِ هدیه‌ی premium هم به‌صورتِ credit در
  // همان کیف‌پول می‌نشیند، پس همین شرطِ «> ۰» هر دو را پوشش می‌دهد).
  if (balanceToman <= 0) {
    throw new InsufficientBalanceError({ balanceToman, plan });
  }

  return { plan, balanceToman };
}
