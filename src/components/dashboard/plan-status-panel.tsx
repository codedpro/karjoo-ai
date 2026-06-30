/**
 * پنلِ خلاصه‌ی وضعیتِ پلنِ کاربر (server component) — Track A.
 *
 * بالای شبکه‌ی پلن‌ها می‌نشیند و خلاصه‌ی فقط-خواندنیِ وضعیتِ فعلی را نشان می‌دهد:
 * پلنِ فعلی، موجودیِ کیف‌پول، وضعیتِ گرنتِ ماهِ جاری، و اپلای امروز نسبت به سهمیه.
 * هیچ state/کنشی ندارد (تغییرِ پلن در PlansGrid انجام می‌شود)؛ صرفاً نمایش.
 */
import { Badge, Card, toFaDigits } from "./ui";
import { formatToman } from "./wallet-format";
import { applyQuotaLabel } from "./plans-labels";
import { PLAN_BADGE } from "./wallet-labels";
import type { UserPlanStatus } from "./plan-data";
import { planFor } from "@/lib/billing/plans";

export function PlanStatusPanel({ status }: { status: UserPlanStatus }) {
  const def = planFor(status.planKey);
  const planBadge = PLAN_BADGE[status.planKey];
  const lowBalance = status.balanceToman <= 0;

  // متنِ اپلای امروز: «۳ از ۱۰۰» برای سقف‌دار، «نامحدود» برای پلن‌های پولی.
  const applyText =
    status.apply.limit === null
      ? "نامحدود"
      : `${toFaDigits(status.apply.usedToday)} از ${toFaDigits(status.apply.limit)}`;

  return (
    <Card className="p-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* پلنِ فعلی */}
        <div>
          <p className="text-xs text-muted">پلنِ فعلی</p>
          <div className="mt-1.5">
            <Badge tone={planBadge.tone}>
              <span title={planBadge.title}>{def.labelFa}</span>
            </Badge>
          </div>
        </div>

        {/* موجودیِ کیف‌پول */}
        <div>
          <p className="text-xs text-muted">موجودیِ کیف‌پول</p>
          <p
            className={`ltr-nums mt-1.5 text-lg font-extrabold ${
              lowBalance ? "text-rose-500" : "text-foreground"
            }`}
          >
            {toFaDigits(formatToman(status.balanceToman))}{" "}
            <span className="text-xs font-normal text-muted">تومان</span>
          </p>
        </div>

        {/* اعتبارِ ماهانه‌ی این ماه */}
        <div>
          <p className="text-xs text-muted">اعتبارِ ماهانه‌ی این ماه</p>
          <p className="mt-1.5 text-sm font-bold">
            {status.grant.amountToman <= 0 ? (
              "بدونِ اعتبار"
            ) : status.grant.granted ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                اعمال‌شده (
                <span className="ltr-nums">
                  {toFaDigits(formatToman(status.grant.amountToman))}
                </span>{" "}
                تومان)
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                در انتظارِ اعمال
              </span>
            )}
          </p>
        </div>

        {/* اپلای امروز */}
        <div>
          <p className="text-xs text-muted">اپلای امروز</p>
          <p className="mt-1.5 text-sm font-bold">
            {status.apply.limit === null ? (
              applyText
            ) : (
              <span className="ltr-nums">{applyText}</span>
            )}
            <span className="ms-1 text-xs font-normal text-muted">
              ({toFaDigits(applyQuotaLabel(def.applyQuotaPerDay))})
            </span>
          </p>
        </div>
      </div>
    </Card>
  );
}
