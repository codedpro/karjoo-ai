/**
 * کارتِ «نرخِ پردازش‌های هوش مصنوعی» — پاسخ به «هر کار چقدر برایم آب می‌خورد؟».
 *
 * ارائه‌ای (server-safe). فقط نمایش می‌دهد؛ هیچ کسری/متری نمی‌کند و تخمین در
 * `lib/billing/ui` (خالص) محاسبه می‌شود.
 *
 * تصمیمِ تازه: این کارت قبلاً موجودیِ کیف‌پول و دکمه‌ی شارژ را هم داشت و کنارِ صفحه‌ی
 * تطبیق‌ها می‌نشست. حالا خانه‌اش «اعتبار و هزینه» است، جایی که پنلِ کیف‌پول همان بالا
 * موجودی و مسیرِ شارژ را می‌گوید — پس تکرارِ آن‌ها فقط صفحه را شلوغ می‌کرد. این‌جا فقط
 * *نرخ* می‌ماند و اگر پردازشِ پولی ممکن نباشد، یک هشدارِ یک‌خطی.
 */
import { formatToman, type CostEstimate } from "@/lib/billing/ui";
import type { Plan } from "@/db/schema";

import { Badge, Card } from "./ui";

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
        {/* `formatToman`ِ lib/billing/ui خودش ارقامِ فارسی و واحد را می‌گذارد. */}
        {estimate ? `~ ${formatToman(estimate.costToman)}` : "—"}
      </span>
    </li>
  );
}

export function AiCostPanel({
  plan,
  canUsePaidAi,
  matchEstimate,
  coverLetterEstimate,
}: {
  plan: Plan;
  canUsePaidAi: boolean;
  matchEstimate: CostEstimate | null;
  coverLetterEstimate: CostEstimate | null;
}) {
  return (
    <Card padded>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-balance text-base font-bold">هر کار چقدر هزینه دارد</h3>
        <Badge tone="muted">{PLAN_LABELS[plan]}</Badge>
      </div>

      <ul className="mt-2 divide-y divide-border/70">
        <CostRow label="تطبیقِ هوشمندِ هر آگهی" estimate={matchEstimate} />
        <CostRow label="نگارشِ انگیزه‌نامه" estimate={coverLetterEstimate} />
      </ul>

      <p className="mt-3 text-pretty text-xs leading-6 text-muted">
        ارقام تخمینی‌اند؛ مبلغِ واقعی پس از هر پردازش حساب و کسر می‌شود. آپلودِ رزومه و
        ارسالِ درخواست رایگان است.
      </p>

      {!canUsePaidAi ? (
        <p
          role="status"
          className="mt-4 text-pretty rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-6 text-amber-700 dark:text-amber-300"
        >
          موجودی برای این پردازش‌ها کافی نیست — کیف‌پول را شارژ کنید.
        </p>
      ) : null}
    </Card>
  );
}
