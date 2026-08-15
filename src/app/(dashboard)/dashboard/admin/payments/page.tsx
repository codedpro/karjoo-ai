/**
 * پنلِ ادمینِ بررسیِ پرداختِ کارت‌به‌کارت (Server component).
 *
 * درخواست‌های در انتظار را نشان می‌دهد و اجازه‌ی تأیید/رد می‌دهد: تأییدِ «شارژ» اعتبار را
 * واریز و تأییدِ «اشتراک» پلن را ارتقا می‌دهد.
 *
 * سه اصلاحِ مهم نسبت به نسخه‌ی قبل:
 *   ۱) **افشا نکردن**: قبلاً به کاربرِ غیرِادمین می‌گفت این بخش وجود دارد و حتی نامِ
 *      کوکی و رازِ سرور را توضیح می‌داد. حالا برای غیرِادمین ۴۰۴ است.
 *   ۲) **هویتِ انسانی**: قبلاً فقط `user <uuid>` چاپ می‌شد؛ حالا نام/ایمیلِ کاربر و
 *      لینکِ پرونده‌اش کنارِ درخواست است تا تطبیق با فیشِ بانکی ممکن باشد.
 *   ۳) **تأییدِ یک‌کلیکیِ پول**: تأیید یک عملِ مالیِ برگشت‌ناپذیر است و حالا تأییدِ صریح
 *      می‌خواهد؛ فیلدِ دلیلِ رد هم آن‌قدر پهن است که بشود نوشته را خواند.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { isDashboardAdmin } from "@/components/dashboard/admin-guard";
import { displayName } from "@/components/dashboard/admin-labels";
import { getUserIdentities } from "@/components/dashboard/admin-users-data";
import { ConfirmSubmit } from "@/components/dashboard/confirm-submit";
import {
  approvePaymentAction,
  rejectPaymentAction,
} from "@/components/dashboard/payments-admin-actions";
import { listPendingPaymentRequests } from "@/lib/billing/payments";
import { formatToman } from "@/components/dashboard/wallet-format";
import { planFor } from "@/lib/billing/plans";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  toFaDigits,
} from "@/components/dashboard/ui";

// DB + نشستِ ادمین → اجرای Node و رندرِ پویا.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "پرداخت‌ها",
  robots: { index: false, follow: false },
};

export default async function AdminPaymentsPage() {
  if (!(await isDashboardAdmin())) notFound();

  const pending = await listPendingPaymentRequests();
  const identities = await getUserIdentities(pending.map((p) => p.userId));

  return (
    <div className="space-y-8">
      <PageHeader
        title="پرداخت‌های در انتظار"
        subtitle="کدِ پیگیری را با حسابِ بانکی تطبیق بده، بعد تأیید کن. تأیید بلافاصله اعتبار یا اشتراکِ کاربر را اعمال می‌کند."
      />

      {pending.length === 0 ? (
        <EmptyState
          title="درخواستی در انتظار نیست"
          body="همه‌ی پرداخت‌های کارت‌به‌کارت بررسی شده‌اند."
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {pending.map((p) => {
            const identity = identities.get(p.userId);
            return (
              <Card key={p.id} padded className="space-y-4">
                {/* مبلغ و نوع */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={p.kind === "plan" ? "brand" : "accent"}>
                    {p.kind === "plan" ? "خریدِ اشتراک" : "شارژِ اعتبار"}
                  </Badge>
                  <span className="ltr-nums text-lg font-extrabold">
                    {toFaDigits(formatToman(p.amountToman))} تومان
                  </span>
                  {p.kind === "plan" && p.targetPlan ? (
                    <span className="text-sm text-muted">
                      → {planFor(p.targetPlan).labelFa}
                    </span>
                  ) : null}
                </div>

                {/* چه کسی؟ */}
                <div className="rounded-xl border border-border bg-surface/60 px-3.5 py-2.5">
                  <Link
                    href={`/dashboard/admin/users/${p.userId}`}
                    className="focus-ring block rounded-lg"
                  >
                    <span className="block text-sm font-semibold">
                      {identity ? displayName(identity) : "کاربرِ حذف‌شده"}
                    </span>
                    <span className="ltr-nums block text-xs text-muted">
                      {identity?.email ?? p.userId}
                    </span>
                  </Link>
                </div>

                {/* شواهدِ تطبیق */}
                <dl className="space-y-1.5 text-xs">
                  <div className="flex flex-wrap justify-between gap-2">
                    <dt className="text-muted">کدِ پیگیری</dt>
                    <dd>
                      {p.referenceCode ? (
                        <span className="ltr-nums font-mono text-foreground" dir="ltr">
                          {p.referenceCode}
                        </span>
                      ) : (
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          ثبت نشده
                        </span>
                      )}
                    </dd>
                  </div>
                  {p.payerCardLast4 ? (
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-muted">۴ رقمِ آخرِ کارت</dt>
                      <dd className="ltr-nums font-mono" dir="ltr">
                        {p.payerCardLast4}
                      </dd>
                    </div>
                  ) : null}
                  {p.note ? (
                    <div className="flex flex-wrap justify-between gap-2">
                      <dt className="text-muted">یادداشتِ کاربر</dt>
                      <dd className="text-pretty">{p.note}</dd>
                    </div>
                  ) : null}
                </dl>

                {/* تصمیم */}
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <form action={approvePaymentAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmSubmit
                      confirmText={`تأییدِ ${formatToman(p.amountToman)} تومان برای این کاربر اعمال شود؟`}
                      className="focus-ring rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-foreground transition-[filter] hover:brightness-110"
                    >
                      تأیید و اعمال
                    </ConfirmSubmit>
                  </form>

                  <form
                    action={rejectPaymentAction}
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    <input type="hidden" name="id" value={p.id} />
                    <label htmlFor={`reason-${p.id}`} className="sr-only">
                      دلیلِ رد
                    </label>
                    <input
                      id={`reason-${p.id}`}
                      name="reason"
                      placeholder="دلیلِ رد (اختیاری)"
                      className="focus-ring min-w-0 flex-1 rounded-full border border-border bg-card px-3.5 py-2 text-xs text-foreground placeholder:text-muted"
                    />
                    <ConfirmSubmit
                      confirmText="این درخواست رد شود؟"
                      className="focus-ring shrink-0 rounded-full border border-rose-500/40 px-4 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
                    >
                      رد
                    </ConfirmSubmit>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
