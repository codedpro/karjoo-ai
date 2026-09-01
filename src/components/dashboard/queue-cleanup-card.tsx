"use client";

/**
 * «صفِ فعلی» — دیدن و خالی‌کردنِ آگهی‌های در نوبت.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * چرا این‌جا و کنارِ فیلترها: صف با فیلترهای *همان لحظه* ساخته می‌شود. اگر دسته‌ای را
 * برداری، فقط جلوی کشفِ بعدی گرفته می‌شود؛ آگهی‌هایی که قبلاً با فیلترِ قبلی صف شده‌اند
 * همچنان اپلای می‌شوند. تا پیش از این هیچ راهی برای بیرون‌کشیدنشان نبود.
 *
 * چرا «همه‌ی این سایت» و نه «فقط این دسته»: دسته‌ی مبدأ روی خودِ آگهی ذخیره نمی‌شود،
 * پس ادعای «فقط فروش و بازاریابی را پاک کن» دروغ می‌بود. این‌جا صادقانه همان کاری را
 * پیشنهاد می‌دهیم که واقعاً می‌توانیم انجام دهیم.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useState } from "react";

import { Badge, Button, Card, cn } from "./ui";
import { boardLabel } from "./auto-apply-labels";

export interface QueueCount { board: string; pending: number }

export function QueueCleanupCard({ initial }: { initial: QueueCount[] }) {
  const [counts, setCounts] = useState(initial);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const total = counts.reduce((sum, c) => sum + c.pending, 0);

  async function purge(board: string | null) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/apply-queue/purge", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(board ? { board } : {}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        removed?: number; counts?: QueueCount[]; error?: string;
      };
      if (!res.ok) {
        setMessage(data.error ?? "پاک نشد. کمی بعد دوباره تلاش کنید.");
        return;
      }
      setCounts(data.counts ?? []);
      setMessage(`${data.removed ?? 0} آگهی از نوبت برداشته شد.`);
    } catch {
      setMessage("ارتباط برقرار نشد.");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">آگهی‌های در نوبت</h3>
        <Badge tone={total > 0 ? "muted" : "muted"}>{total.toLocaleString("fa-IR")} مورد</Badge>
      </div>

      <p className="mb-4 text-xs text-white/60">
        صف با فیلترهای همان لحظه پر شده است. اگر الان فیلتری را عوض کردید، آگهی‌های
        قبلی همچنان در نوبت می‌مانند — تا وقتی از این‌جا برشان دارید. تاریخچه و
        ارسال‌های انجام‌شده دست نمی‌خورند و کشف بعدی صف را دوباره پر می‌کند.
      </p>

      {total === 0 ? (
        <p className="text-sm text-white/60">نوبت خالی است.</p>
      ) : (
        <ul className="grid gap-2">
          {counts.filter((c) => c.pending > 0).map((c) => (
            <li
              key={c.board}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <span className="text-sm">
                {boardLabel(c.board)}
                <span className="mr-2 text-xs text-white/50">
                  {c.pending.toLocaleString("fa-IR")} آگهی
                </span>
              </span>
              {confirming === c.board ? (
                <span className="flex items-center gap-2">
                  <Button type="button" size="sm" disabled={busy} onClick={() => void purge(c.board)}>
                    مطمئنم، پاک کن
                  </Button>
                  <button
                    type="button"
                    className="text-xs text-white/60 hover:text-white"
                    onClick={() => setConfirming(null)}
                  >
                    انصراف
                  </button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirming(c.board)}
                >
                  خالی کردن نوبت
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {message ? (
        <p className={cn("mt-3 text-sm", message.includes("برداشته") ? "text-emerald-300" : "text-rose-300")}>
          {message}
        </p>
      ) : null}
    </Card>
  );
}
