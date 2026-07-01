/**
 * نمایشِ تاریخچه‌ی کیف‌پول (دفتر) و تاریخچه‌ی مصرفِ هوش مصنوعی — اجزای ارائه‌ای
 * (بدون state، server-safe). فقط چیدمان/استایل؛ هیچ I/O یا راز.
 *
 * داده از RSC (wallet-data.ts) می‌آید و مقید به userIdِ نشست است.
 */
import { Badge, Card, EmptyState, toFaDigits } from "./ui";
import { LEDGER_KIND, USAGE_KIND, providerLabel } from "./wallet-labels";
import { formatSignedToman, formatToman } from "./wallet-format";
import type {
  DashboardLedgerEntry,
  DashboardUsageRow,
} from "./wallet-data";

/** تاریخِ کوتاهِ شمسی برای ردیف‌ها (fa-IR). امن در صورتِ تاریخِ نامعتبر. */
function faDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return "—";
  }
}

/* ─────────────────────────────  دفترِ کیف‌پول  ───────────────────────────── */

/** فهرستِ آخرین ردیف‌های دفتر (شارژ/کسر/هدیه/بازگشت). */
export function LedgerList({ entries }: { entries: DashboardLedgerEntry[] }) {
  return (
    <Card padded>
      <h3 className="text-base font-bold">تراکنش‌های کیف‌پول</h3>

      {entries.length === 0 ? (
        <p className="mt-4 text-pretty rounded-xl border border-dashed border-border bg-surface/60 px-4 py-6 text-center text-sm text-muted">
          هنوز تراکنشی ثبت نشده است.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {entries.map((e) => {
            const meta = LEDGER_KIND[e.kind] ?? LEDGER_KIND.charge;
            const positive = e.amountToman > 0;
            return (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {e.description ? (
                      <span
                        className="truncate text-sm text-foreground"
                        title={e.description}
                      >
                        {e.description}
                      </span>
                    ) : null}
                  </div>
                  <div className="ltr-nums mt-1 text-xs text-muted">
                    {toFaDigits(faDate(e.createdAt))}
                  </div>
                </div>
                <div className="shrink-0 text-end">
                  <div
                    className={
                      positive
                        ? "ltr-nums whitespace-nowrap text-sm font-bold text-emerald-600 dark:text-emerald-400"
                        : "ltr-nums whitespace-nowrap text-sm font-bold text-foreground"
                    }
                  >
                    {toFaDigits(formatSignedToman(e.amountToman))}
                  </div>
                  <div className="ltr-nums whitespace-nowrap text-xs text-muted">
                    مانده: {toFaDigits(formatToman(e.balanceAfterToman))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ───────────────────────────  تاریخچه‌ی مصرفِ AI  ──────────────────────────── */

/** جدولِ تاریخچه‌ی مصرفِ هوش مصنوعی (مدل، نوع، توکن‌ها، هزینه، تاریخ). */
export function UsageTable({ rows }: { rows: DashboardUsageRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="📊"
        title="هنوز مصرفی ثبت نشده"
        body="به‌محضِ اولین استفاده از سرویس‌های هوش مصنوعی (تطبیق، انگیزه‌نامه، پردازشِ رزومه)، هزینه‌ی هر فراخوانی این‌جا فهرست می‌شود."
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-2xl text-right text-sm">
          <thead>
            <tr className="border-b border-border bg-surface/60 text-xs text-muted">
              <th className="whitespace-nowrap px-4 py-3.5 font-medium">سرویس</th>
              <th className="whitespace-nowrap px-4 py-3.5 font-medium">مدل</th>
              <th className="whitespace-nowrap px-4 py-3.5 font-medium">
                توکن (ورودی/خروجی)
              </th>
              <th className="whitespace-nowrap px-4 py-3.5 font-medium">
                هزینه (تومان)
              </th>
              <th className="whitespace-nowrap px-4 py-3.5 font-medium">تاریخ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr
                key={r.id}
                className="transition-colors hover:bg-foreground/2"
              >
                <td className="whitespace-nowrap px-4 py-3 font-medium">
                  {USAGE_KIND[r.kind] ?? r.kind}
                </td>
                <td className="px-4 py-3">
                  <div className="ltr-nums max-w-56 truncate" title={r.modelId}>
                    {r.modelId}
                  </div>
                  <div className="text-xs text-muted">
                    {providerLabel(r.provider)}
                  </div>
                </td>
                <td className="ltr-nums whitespace-nowrap px-4 py-3 text-muted">
                  {toFaDigits(r.promptTokens)} / {toFaDigits(r.completionTokens)}
                </td>
                <td className="ltr-nums whitespace-nowrap px-4 py-3 font-bold">
                  {toFaDigits(formatToman(r.costToman))}
                </td>
                <td className="ltr-nums whitespace-nowrap px-4 py-3 text-muted">
                  {toFaDigits(faDate(r.createdAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
