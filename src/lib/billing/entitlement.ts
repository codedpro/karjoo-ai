import "server-only";

/**
 * نگهبانِ استحقاقِ استفاده از سرویسِ پولیِ هوش مصنوعی (server-only).
 *
 * گیتِ هوش مصنوعی روی پولِ در دسترس است. گیت *پیش از* فراخوانیِ مدل انجام می‌شود
 * (هرگز بی‌سروصدا هزینه‌ی بالادست خرج نشود):
 *   • موجودی > ۰ یا اشتراکِ فعالِ 1xai → مجاز (اعتبارِ اشتراک اول مصرف می‌شود).
 *   • در غیرِ این صورت → InsufficientBalanceError (باید در 1xai شارژ شود).
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
import { db as defaultDb } from "@/db";
import type { Entitlements } from "@/lib/billing/entitlements";
import { readEntitlements } from "@/lib/billing/subscription";
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
  /** نامِ اشتراکِ 1xaiِ کاربر (نمایشی). */
  plan: string;
  balanceToman: number;
}

/** وابستگی‌های قابلِ‌تزریقِ گیت — برای تستِ بدونِ DB. */
export interface EntitlementDeps {
  db?: EntitlementDb;
  /** مزایای کاربر از اشتراکِ 1xai (پیش‌فرض readEntitlements). */
  readEntitlements?: (userId: string) => Promise<Entitlements>;
  /** خواننده‌ی موجودی (پیش‌فرض availableTomanِ کیف‌پولِ واحدِ 1xai). */
  readBalance?: (userId: string) => Promise<number>;
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
  const readSub = deps.readEntitlements ?? ((id: string) => readEntitlements(id));
  const readBalance =
    deps.readBalance ??
    (async (id: string) => (await getUnifiedBalance(id, { db })).availableToman);

  const [entitlements, balanceToman] = await Promise.all([
    readSub(userId),
    readBalance(userId),
  ]);
  const plan = entitlements.planNameFa;

  // گیتِ واحد: موجودیِ مثبت *یا* اشتراکِ فعالِ 1xai. اعتبارِ اشتراک پیش از کیف‌پول مصرف
  // می‌شود و گیت‌ویِ 1xai خودش سقفِ آن را اعمال می‌کند؛ پس مشترکی که کیف‌پولش خالی است
  // نباید این‌جا بلاک شود.
  if (balanceToman <= 0 && entitlements.status !== "active") {
    throw new InsufficientBalanceError({
      balanceToman,
      plan,
      message:
        "موجودیِ حسابِ 1xai شما برای استفاده از سرویسِ هوش مصنوعی کافی نیست. لطفاً کیف‌پولِ واحد را در 1xai.ir/topup شارژ کنید.",
    });
  }

  return { plan, balanceToman };
}
