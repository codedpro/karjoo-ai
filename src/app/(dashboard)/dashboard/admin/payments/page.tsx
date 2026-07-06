import type { Metadata } from "next";

import {
  approvePaymentAction,
  rejectPaymentAction,
} from "@/components/dashboard/payments-admin-actions";
import { isFleetAdmin } from "@/components/dashboard/fleet-admin-guard";
import { listPendingPaymentRequests } from "@/lib/billing/payments";
import { formatToman } from "@/components/dashboard/wallet-format";
import { planFor } from "@/lib/billing/plans";
import { Badge, Card, EmptyState, PageHeader, toFaDigits } from "@/components/dashboard/ui";

// DB + کوکیِ ادمین → اجرای Node و رندرِ پویا.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "بررسیِ پرداخت‌ها",
  robots: { index: false, follow: false },
};

/**
 * پنلِ ادمینِ بررسیِ پرداختِ کارت‌به‌کارت — درخواست‌های در انتظار را نشان می‌دهد و اجازه‌ی
 * تأیید/رد می‌دهد. تأییدِ topup کیف‌پول را credit و تأییدِ plan پلن را ارتقا می‌دهد.
 * با کوکیِ ادمین (karjoo_admin == INTERNAL_API_SECRET) محافظت می‌شود.
 */
export default async function AdminPaymentsPage() {
  if (!(await isFleetAdmin())) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="بررسیِ پرداخت‌ها"
          subtitle="این بخش ادمینی است و نیاز به دسترسیِ ادمین دارد."
        />
        <Card padded>
          <p className="text-sm leading-7 text-muted">
            برای دسترسی، کوکیِ <span className="font-mono">karjoo_admin</span> (برابرِ رازِ
            داخلیِ سرور) باید ست شده باشد.
          </p>
        </Card>
      </div>
    );
  }

  const pending = await listPendingPaymentRequests();

  return (
    <div className="space-y-8">
      <PageHeader
        title="بررسیِ پرداخت‌های کارت‌به‌کارت"
        subtitle={`${toFaDigits(pending.length)} درخواستِ در انتظارِ تأیید — کدِ پیگیری را با حسابِ بانکی تطبیق دهید، سپس تأیید کنید.`}
      />

      {pending.length === 0 ? (
        <EmptyState
          title="درخواستی در انتظار نیست"
          body="همه‌ی پرداخت‌های کارت‌به‌کارت بررسی شده‌اند."
        />
      ) : (
        <div className="space-y-3">
          {pending.map((p) => (
            <Card key={p.id} padded>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={p.kind === "plan" ? "brand" : "accent"}>
                      {p.kind === "plan" ? "ارتقای پلن" : "شارژِ کیف‌پول"}
                    </Badge>
                    <span className="ltr-nums text-lg font-extrabold">
                      {toFaDigits(formatToman(p.amountToman))} تومان
                    </span>
                  </div>
                  {p.kind === "plan" && p.targetPlan ? (
                    <div className="text-xs text-muted">
                      پلنِ مقصد: <strong className="text-foreground">{planFor(p.targetPlan).labelFa}</strong>
                    </div>
                  ) : null}
                  {p.referenceCode ? (
                    <div className="text-xs">
                      کدِ پیگیری:{" "}
                      <span className="ltr-nums font-mono text-foreground" dir="ltr">
                        {p.referenceCode}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs font-medium text-amber-500">بدونِ کدِ پیگیری</div>
                  )}
                  {p.payerCardLast4 ? (
                    <div className="text-xs text-muted">
                      ۴ رقمِ آخرِ کارت:{" "}
                      <span className="ltr-nums font-mono" dir="ltr">
                        {p.payerCardLast4}
                      </span>
                    </div>
                  ) : null}
                  {p.note ? <div className="text-xs text-muted">یادداشت: {p.note}</div> : null}
                  <div className="ltr-nums font-mono text-[11px] text-muted" dir="ltr">
                    user {p.userId}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-stretch gap-2">
                  <form action={approvePaymentAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="focus-ring w-full rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground transition-[filter] hover:brightness-110"
                    >
                      تأیید و اعمال
                    </button>
                  </form>
                  <form action={rejectPaymentAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      name="reason"
                      placeholder="دلیلِ رد (اختیاری)"
                      className="focus-ring w-36 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground placeholder:text-muted"
                    />
                    <button
                      type="submit"
                      className="focus-ring shrink-0 rounded-full border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-500 transition-colors hover:bg-rose-500/10"
                    >
                      رد
                    </button>
                  </form>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
