/**
 * پنلِ «هزینه‌ی هوش مصنوعی» — کارتِ راهنمای سمتِ‌سرور برای صفحه‌های کنشِ پولی.
 *
 * ارائه‌ای (server-safe). نشان می‌دهد:
 *   • پلن و موجودیِ کیف‌پول،
 *   • «حدودِ هزینه»ی کنش‌های پولی (تطبیق + انگیزه‌نامه)،
 *   • و اگر کاربر اجازه‌ی فراخوانیِ پولی ندارد (پلنِ free یا موجودیِ ≤۰)، یک نوارِ
 *     «نیازمندِ شارژ» با لینکِ شارژ.
 *
 * هیچ کسری/متری نمی‌کند؛ فقط نمایش. تخمین در lib/billing/ui (خالص) محاسبه می‌شود.
 */
import { formatToman, type CostEstimate } from "@/lib/billing/ui";
import type { Plan } from "@/db/schema";

import { Card } from "./ui";

const PLAN_LABELS: Record<Plan, string> = {
  free: "رایگان",
  payg: "پرداخت‌به‌ازای‌مصرف",
  premium: "ویژه",
  pro: "حرفه‌ای",
  max: "مکس",
  maxplus: "مکس پلاس",
};

/** یک ردیفِ «نامِ کنش — حدودِ هزینه». */
function CostRow({ label, estimate }: { label: string; estimate: CostEstimate | null }) {
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="ltr-nums font-medium">
        {estimate ? `حدودِ ${formatToman(estimate.costToman)}` : "—"}
      </span>
    </li>
  );
}

export function AiCostPanel({
  plan,
  balanceToman,
  canUsePaidAi,
  matchEstimate,
  coverLetterEstimate,
  topupHref = "/dashboard/billing",
}: {
  plan: Plan;
  balanceToman: number;
  canUsePaidAi: boolean;
  matchEstimate: CostEstimate | null;
  coverLetterEstimate: CostEstimate | null;
  topupHref?: string;
}) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold">هزینه‌ی هوش مصنوعی</h3>
        <span className="rounded-full bg-foreground/5 px-2.5 py-0.5 text-xs font-medium text-muted">
          {PLAN_LABELS[plan]}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-border bg-background/40 px-4 py-3">
        <div className="text-xs text-muted">موجودیِ کیف‌پول</div>
        <div className="ltr-nums mt-0.5 text-lg font-bold">
          {formatToman(balanceToman)}
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        <CostRow label="تطبیقِ هوشمندِ هر آگهی" estimate={matchEstimate} />
        <CostRow label="نگارشِ انگیزه‌نامه" estimate={coverLetterEstimate} />
      </ul>

      <p className="mt-3 text-xs leading-6 text-muted">
        ارقام تخمینی‌اند؛ هزینه‌ی واقعی پس از هر پردازش از مصرفِ واقعیِ توکن محاسبه و از
        کیف‌پول کسر می‌شود. مشاهده‌ی آگهی و اپلای از طریقِ افزونه رایگان است.
      </p>

      {!canUsePaidAi ? (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            شارژِ حساب لازم است
          </p>
          <p className="mt-1 text-xs leading-6 text-amber-700/90 dark:text-amber-200/80">
            {plan === "free"
              ? "برای استفاده از تطبیق و انگیزه‌نامه‌ی هوشمند، به پلنِ پرداخت‌به‌ازای‌مصرف ارتقا دهید و کیف‌پول را شارژ کنید."
              : "موجودیِ کیف‌پولِ شما برای پردازشِ هوش مصنوعی کافی نیست. لطفاً شارژ کنید."}
          </p>
          <a
            href={topupHref}
            className="mt-3 inline-flex rounded-full bg-amber-500 px-5 py-2 text-sm font-bold text-white shadow-lg shadow-amber-500/25 transition-transform hover:-translate-y-0.5"
          >
            شارژِ کیف‌پول
          </a>
        </div>
      ) : null}
    </Card>
  );
}
