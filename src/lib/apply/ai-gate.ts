import "server-only";

/**
 * گیتِ «فیلترِ هوشمند (AI)» — لایه‌ی استحقاقِ پریمیوم روی مسیرِ فیلترمود (Phase 4، Track C).
 *
 * پیوُت محصول: مسیرِ پایه «فیلترمود» است — همه‌ی آگهی‌های نتیجه‌ی فیلترِ خودِ سایت بدونِ AI
 * صف می‌شوند. «فیلترِ هوشمند (AI)» یک لایه‌ی *اختیاریِ پریمیوم* روی آن است که فقط وقتی اعمال
 * می‌شود که کاربر هم‌زمان:
 *   ۱) تاگلِ `aiFilterEnabled` را روشن کرده باشد (prefs)، و
 *   ۲) واجدِ استحقاقِ AI پولی باشد — همان گیتِ موجود `assertCanUsePaidAi` (موجودی > ۰، هر پلن).
 *
 * قاعده‌ی قفل‌شده (guardrail): AI هرگز *الزامی* نیست. اگر هر کدام از دو شرط برقرار نباشد،
 * `aiFilter=false` برمی‌گردد و کاربر مسیرِ فیلترمودِ «همه‌ی شغل‌ها» را می‌گیرد (هیچ‌وقت خطا/بلاک).
 *
 * این ماژول *مصرف‌کننده‌ی* Foundation است (readApplyFilters) + گیتِ بیلینگ (assertCanUsePaidAi)؛
 * فایل‌های مالکیتیِ Foundation/Track A/B را دست نمی‌زند. دو مصرف‌کننده دارد:
 *   • مسیرِ اجرا (Track B `POST /api/apply/find-jobs`): `resolveApplyAiFilter(userId)` →
 *     `{ aiFilter }` را می‌خواند و به `runFilterApply({ userId, aiFilter })` می‌دهد.
 *   • UIِ داشبورد (Track A صفحه‌ی apply-filters، از طریقِ کامپوننتِ Track C): `getAiFilterGateState`
 *     برای تصمیمِ «تاگلِ کارآمد در برابرِ دعوت به ارتقا».
 *
 * وابستگی‌ها تزریق‌پذیرند تا تستِ بدونِ DB/کیف‌پول ممکن باشد.
 */
import type { Plan } from "@/db/schema";
import { assertCanUsePaidAi } from "@/lib/billing/entitlement";
import { InsufficientBalanceError } from "@/lib/billing/errors";
import { readApplyFilters, type FiltersDb } from "@/lib/apply/filters";

/** نتیجه‌ی بررسیِ استحقاقِ AI پولی — بدونِ throw (استحقاق را به boolean تبدیل می‌کند). */
export interface PaidAiEntitlement {
  /** آیا کاربر می‌تواند از AI پولی استفاده کند (موجودی > ۰)؟ */
  entitled: boolean;
  /** پلنِ کاربر (برای پیام/نمایش). */
  plan: Plan;
  /** موجودیِ فعلیِ کیف‌پول به تومان (برای پیام/نمایش). */
  balanceToman: number;
}

/** وابستگی‌های قابلِ‌تزریقِ گیت — برای تستِ بدونِ DB/کیف‌پول. */
export interface AiFilterGateDeps {
  /** هندلِ DB (پیش‌فرض: کلاینتِ اصلی). */
  db?: FiltersDb;
  /** خواننده‌ی تاگلِ aiFilterEnabled (پیش‌فرض: readApplyFilters). */
  readEnabled?: (userId: string) => Promise<boolean>;
  /** بررسیِ استحقاقِ AI پولی (پیش‌فرض: assertCanUsePaidAi، با تبدیلِ throw به boolean). */
  checkEntitlement?: (userId: string) => Promise<PaidAiEntitlement>;
}

/** وضعیتِ کاملِ گیت برای UI — تاگل + استحقاق + نتیجه‌ی مؤثر. */
export interface AiFilterGateState {
  /** تاگلِ ذخیره‌شده‌ی کاربر (نیتِ او). */
  enabled: boolean;
  /** آیا واجدِ استحقاقِ AI پولی است؟ */
  entitled: boolean;
  /** نتیجه‌ی مؤثر: فقط وقتی هم روشن است هم واجدِ استحقاق. */
  aiFilter: boolean;
  /** پلنِ کاربر. */
  plan: Plan;
  /** موجودیِ فعلیِ کیف‌پول (تومان). */
  balanceToman: number;
}

/** نتیجه‌ی سبکِ گیتِ مسیرِ اجرا (Track B) — فقط آنچه runFilterApply لازم دارد. */
export interface ResolvedApplyAiFilter {
  /** آیا فیلترِ هوشمندِ AI باید اعمال شود؟ (enabled && entitled) */
  aiFilter: boolean;
  /** تاگلِ ذخیره‌شده‌ی کاربر. */
  enabled: boolean;
  /** آیا واجدِ استحقاق بود؟ (فقط وقتی enabled بررسی می‌شود؛ در غیرِ این صورت false) */
  entitled: boolean;
}

/**
 * استحقاقِ AI پولی را بدونِ throw می‌سنجد: `assertCanUsePaidAi` را صدا می‌زند و
 * `InsufficientBalanceError` (موجودی ≤ ۰) را به `entitled=false` تبدیل می‌کند. هر خطای
 * دیگر (غیرمنتظره) دوباره پرتاب می‌شود تا بی‌سروصدا بلعیده نشود.
 */
async function defaultCheckEntitlement(
  userId: string,
  db?: FiltersDb,
): Promise<PaidAiEntitlement> {
  try {
    const { plan, balanceToman } = await assertCanUsePaidAi(
      userId,
      db ? { db } : {},
    );
    return { entitled: true, plan, balanceToman };
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      // نبودِ موجودی = «واجدِ استحقاق نیست» (نه خطا) — کاربر مسیرِ فیلترمودِ همه‌ی شغل‌ها را می‌گیرد.
      return { entitled: false, plan: err.plan, balanceToman: err.balanceToman };
    }
    throw err;
  }
}

/** خواننده‌ی پیش‌فرضِ تاگلِ aiFilterEnabled از prefsِ کاربر. */
function defaultReadEnabled(db?: FiltersDb): (userId: string) => Promise<boolean> {
  return async (userId: string) => (await readApplyFilters(userId, db)).aiFilterEnabled;
}

/**
 * وضعیتِ کاملِ گیت برای UI — تاگل *و* استحقاق را همیشه می‌خواند (UI به هر دو نیاز دارد تا
 * بینِ «تاگلِ کارآمد» و «دعوت به ارتقا» تصمیم بگیرد). مقید به همان userId (قاعده‌ی ۴).
 */
export async function getAiFilterGateState(
  userId: string,
  deps: AiFilterGateDeps = {},
): Promise<AiFilterGateState> {
  const readEnabled = deps.readEnabled ?? defaultReadEnabled(deps.db);
  const checkEntitlement =
    deps.checkEntitlement ?? ((id: string) => defaultCheckEntitlement(id, deps.db));

  const [enabled, entitlement] = await Promise.all([
    readEnabled(userId),
    checkEntitlement(userId),
  ]);

  return {
    enabled,
    entitled: entitlement.entitled,
    aiFilter: enabled && entitlement.entitled,
    plan: entitlement.plan,
    balanceToman: entitlement.balanceToman,
  };
}

/**
 * گیتِ مسیرِ اجرا (Track B `POST /api/apply/find-jobs`): تصمیم می‌گیرد آیا این اجرا باید
 * لایه‌ی AI را اعمال کند. اگر تاگل خاموش باشد، *بدونِ* بررسیِ استحقاق `aiFilter=false`
 * برمی‌گرداند (صرفه‌جویی در یک خواندنِ کیف‌پول). فقط اگر تاگل روشن باشد، استحقاق سنجیده
 * می‌شود. مقید به همان userId.
 *
 * مصرف در Track B:
 * ```ts
 * const { aiFilter } = await resolveApplyAiFilter(userId);
 * const report = await runFilterApply({ userId, aiFilter });
 * ```
 */
export async function resolveApplyAiFilter(
  userId: string,
  deps: AiFilterGateDeps = {},
): Promise<ResolvedApplyAiFilter> {
  const readEnabled = deps.readEnabled ?? defaultReadEnabled(deps.db);
  const enabled = await readEnabled(userId);
  if (!enabled) {
    // مسیرِ پایه: فیلترمودِ همه‌ی شغل‌ها؛ هرگز کیف‌پول را لمس نمی‌کند.
    return { aiFilter: false, enabled: false, entitled: false };
  }
  const checkEntitlement =
    deps.checkEntitlement ?? ((id: string) => defaultCheckEntitlement(id, deps.db));
  const { entitled } = await checkEntitlement(userId);
  return { aiFilter: entitled, enabled: true, entitled };
}
