import "server-only";

/**
 * نگهبانِ استحقاقِ استفاده از سرویسِ پولیِ هوش مصنوعی (server-only).
 *
 * قاعده‌ی قفل‌شده (WF3 بخش C): گیتِ هوش مصنوعی روی *موجودی* است، نه پلن. هر پلنی
 * (شاملِ Free) با موجودی > ۰ می‌تواند از AI استفاده کند؛ پلن صرفاً سهمیه/ورکر را
 * تعیین می‌کند (plans.ts)، نه یک بلاکِ سراسری. گیت *پیش از* فراخوانیِ مدل انجام می‌شود
 * (هرگز بی‌سروصدا هزینه‌ی بالادست خرج نشود):
 *   • موجودی > ۰  → مجاز (هر پلن).
 *   • موجودی ≤ ۰  → InsufficientBalanceError (باید در 1xai شارژ شود).
 *
 * موجودی از کیف‌پولِ *واحدِ 1xai* خوانده می‌شود (getUnifiedBalance → availableToman؛
 * «یک انسان، یک موجودی» — شارژ فقط در 1xai.ir/topup). fail-closed: اگر svcِ 1xai در
 * دسترس نباشد، OnexaiSvcUnavailableError از همین‌جا بالا می‌رود و فراخوانیِ پولی
 * *هرگز* با موجودیِ ناخوانا جلو نمی‌رود (هیچ fallback به کیف‌پولِ محلیِ بازنشسته).
 *
 * گاردریلِ بودجه‌ی سراسری (حالتِ نگه‌داری) جداست و در metering با assertAiAvailable
 * کنارِ همین گیت اعمال می‌شود (ai-budget.ts).
 *
 * db و خواننده‌ی پلن/موجودی تزریق‌پذیرند تا تستِ بدونِ DB/svc ممکن باشد.
 */
import { eq } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { users, type Plan } from "@/db/schema";
import { getUnifiedBalance } from "@/lib/billing/unified";
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
  /** خواننده‌ی موجودی (پیش‌فرض availableTomanِ کیف‌پولِ واحدِ 1xai). */
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
 * اگر svcِ 1xai در دسترس نباشد، `OnexaiSvcUnavailableError` از readBalanceِ پیش‌فرض
 * propagate می‌شود (fail-closed): فراخوانیِ پولی با موجودیِ ناخوانا *نباید* جلو برود.
 *
 * @returns پلن + موجودیِ در دسترسِ فعلی (تومان) در صورتِ مجاز بودن.
 */
export async function assertCanUsePaidAi(
  userId: string,
  deps: EntitlementDeps = {},
): Promise<Entitlement> {
  const db = deps.db ?? defaultDb;
  const readPlan = deps.readPlan ?? ((id: string) => defaultReadPlan(id, db));
  const readBalance =
    deps.readBalance ??
    (async (id: string) => (await getUnifiedBalance(id, { db })).availableToman);

  const plan = await readPlan(userId);
  const balanceToman = await readBalance(userId);

  // گیتِ واحد: موجودیِ مثبت لازم است (هر پلن). پول در کیف‌پولِ واحدِ 1xai زندگی می‌کند،
  // پس همین شرطِ «> ۰» همه‌ی پلن‌ها را پوشش می‌دهد. پلنِ free بلاکِ سخت ندارد — اگر
  // کاربر در 1xai شارژ کرده باشد، مجاز است.
  if (balanceToman <= 0) {
    throw new InsufficientBalanceError({
      balanceToman,
      plan,
      message:
        "موجودیِ حسابِ 1xai شما برای استفاده از سرویسِ هوش مصنوعی کافی نیست. لطفاً کیف‌پولِ واحد را در 1xai.ir/topup شارژ کنید.",
    });
  }

  return { plan, balanceToman };
}
