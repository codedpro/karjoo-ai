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
 * از پرایمیتیوهای مشترک (`Card`/`Badge`/`ButtonLink`) استفاده می‌کند تا با بقیه‌ی
 * داشبورد یکدست بماند؛ برچسبِ پلن `whitespace-nowrap` است تا در چیپ دو-خطی نشود.
 */
import { formatToman, type CostEstimate } from "@/lib/billing/ui";
import type { Plan } from "@/db/schema";

import { Badge, ButtonLink, Card } from "./ui";

/** برچسبِ کوتاهِ پلن — عمداً موجز تا در نشان یک-خطی بماند (payg قبلاً می‌شکست). */
const PLAN_LABELS: Record<Plan, string> = {
  free: "رایگان",
  payg: "به‌ازای‌مصرف",
  premium: "ویژه",
  pro: "حرفه‌ای",
  max: "مکس",
  maxplus: "مکس پلاس",
};

/** یک ردیفِ «نامِ کنش — حدودِ هزینه». عدد `ltr-nums` و برچسب `text-pretty`. */
function CostRow({ label, estimate }: { label: string; estimate: CostEstimate | null }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-pretty text-muted">{label}</span>
      <span className="ltr-nums shrink-0 whitespace-nowrap font-semibold tabular-nums">
        {estimate ? `~ ${formatToman(estimate.costToman)}` : "—"}
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
    <Card padded>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-balance text-base font-bold">هزینه‌ی هوش مصنوعی</h3>
        <Badge tone="muted">{PLAN_LABELS[plan]}</Badge>
      </div>

      {/* موجودیِ کیف‌پول — کارتِ برجسته با عددِ درشت */}
      <div className="mt-4 rounded-xl border border-border bg-surface/70 px-4 py-3">
        <div className="text-xs text-muted">موجودیِ کیف‌پول</div>
        <div className="ltr-nums mt-0.5 text-lg font-extrabold tabular-nums">
          {formatToman(balanceToman)}
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border/70">
        <CostRow label="تطبیقِ هوشمندِ هر آگهی" estimate={matchEstimate} />
        <CostRow label="نگارشِ انگیزه‌نامه" estimate={coverLetterEstimate} />
      </ul>

      <p className="mt-3 text-pretty text-xs leading-6 text-muted">
        ارقام تخمینی‌اند؛ هزینه‌ی واقعی پس از هر پردازش از مصرفِ واقعیِ توکن محاسبه و از
        کیف‌پول کسر می‌شود. مشاهده‌ی آگهی و اپلای از طریقِ افزونه رایگان است.
      </p>

      {!canUsePaidAi ? (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="text-balance text-sm font-semibold text-amber-800 dark:text-amber-300">
            شارژِ حساب لازم است
          </p>
          <p className="mt-1 text-pretty text-xs leading-6 text-amber-700/90 dark:text-amber-200/80">
            {plan === "free"
              ? "برای استفاده از تطبیق و انگیزه‌نامه‌ی هوشمند، به پلنِ پرداخت‌به‌ازای‌مصرف ارتقا دهید و کیف‌پول را شارژ کنید."
              : "موجودیِ کیف‌پولِ شما برای پردازشِ هوش مصنوعی کافی نیست. لطفاً شارژ کنید."}
          </p>
          <ButtonLink href={topupHref} size="sm" className="mt-3">
            شارژِ کیف‌پول
          </ButtonLink>
        </div>
      ) : null}
    </Card>
  );
}
