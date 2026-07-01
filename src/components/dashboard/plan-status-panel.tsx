/**
 * پنلِ خلاصه‌ی وضعیتِ پلنِ کاربر (server component).
 *
 * بالای شبکه‌ی پلن‌ها می‌نشیند و خلاصه‌ی فقط-خواندنیِ وضعیتِ فعلی را نشان می‌دهد:
 * پلنِ فعلی، موجودیِ کیف‌پول، وضعیتِ گرنتِ ماهِ جاری، و اپلای امروز نسبت به سهمیه.
 * هیچ state/کنشی ندارد (تغییرِ پلن در PlansGrid انجام می‌شود)؛ صرفاً نمایش.
 */
import { Badge, Card, cn, toFaDigits } from "./ui";
import { formatToman } from "./wallet-format";
import { applyQuotaLabel } from "./plans-labels";
import { PLAN_BADGE } from "./wallet-labels";
import type { UserPlanStatus } from "./plan-data";
import { planFor } from "@/lib/billing/plans";

/** یک ستونِ متری (برچسبِ کوچک + مقدار) — چیدمانِ یکدستِ چهار خانه‌ی وضعیت. */
function StatCell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

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
    <Card padded>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* پلنِ فعلی */}
        <StatCell label="پلنِ فعلی">
          <Badge tone={planBadge.tone} title={planBadge.title}>
            {def.labelFa}
          </Badge>
        </StatCell>

        {/* موجودیِ کیف‌پول */}
        <StatCell label="موجودیِ کیف‌پول">
          <p
            className={cn(
              "ltr-nums whitespace-nowrap text-lg font-extrabold",
              lowBalance ? "text-rose-500" : "text-foreground",
            )}
          >
            {toFaDigits(formatToman(status.balanceToman))}{" "}
            <span className="text-xs font-normal text-muted">تومان</span>
          </p>
        </StatCell>

        {/* اعتبارِ ماهانه‌ی این ماه */}
        <StatCell label="اعتبارِ ماهانه‌ی این ماه">
          <p className="text-sm font-bold">
            {status.grant.amountToman <= 0 ? (
              <span className="text-muted">بدونِ اعتبار</span>
            ) : status.grant.granted ? (
              <span className="text-emerald-600 dark:text-emerald-400">
                اعمال‌شده (
                <span className="ltr-nums whitespace-nowrap">
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
        </StatCell>

        {/* اپلای امروز */}
        <StatCell label="اپلای امروز">
          <p className="text-sm font-bold">
            <span className={status.apply.limit === null ? "" : "ltr-nums"}>
              {applyText}
            </span>
            <span className="ms-1 whitespace-nowrap text-xs font-normal text-muted">
              ({toFaDigits(applyQuotaLabel(def.applyQuotaPerDay))})
            </span>
          </p>
        </StatCell>
      </div>
    </Card>
  );
}
