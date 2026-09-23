"use client";

/**
 * Night-Shift Console — the landing hero's live "overnight activity ledger".
 *
 * The product IS an operator that applies while you sleep, so the hero shows its
 * console: a terminal-style card that streams what Karjoo did overnight (time ·
 * board · category · applied ✓ · which AI model wrote the cover letter). It uses
 * REAL board names + REAL Jobinja categories — the multi-model story shown, not
 * claimed. Respects prefers-reduced-motion (renders a full static ledger).
 *
 * Uses the shared 1xAi editorial tokens (night surfaces, bone text, hairline
 * rules, persimmon signal, jade tick), so it follows the dark/light theme.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

type Row = {
  t: string; // HH:MM (Persian digits, LTR)
  board: string; // real board (Persian name)
  cat: string; // real Jobinja category (fa)
};

// Real boards + real Jobinja categories (from /api/v10/job/categories).
const ROWS: Row[] = [
  { t: "۰۲:۰۴", board: "جابینجا", cat: "وب و برنامه‌نویسی" },
  { t: "۰۲:۱۷", board: "جاب‌ویژن", cat: "پشتیبانی و مشتریان" },
  { t: "۰۲:۳۱", board: "ایران‌تلنت", cat: "شبکه و زیرساخت" },
  { t: "۰۲:۴۸", board: "ای‌استخدام", cat: "مالی و حسابداری" },
  { t: "۰۳:۰۵", board: "کاربوم", cat: "بازاریابی و فروش" },
  { t: "۰۳:۲۲", board: "جابینجا", cat: "طراحی و گرافیک" },
  { t: "۰۳:۴۰", board: "جاب‌ویژن", cat: "منابع انسانی" },
  { t: "۰۳:۵۶", board: "ایران‌تلنت", cat: "آموزش" },
];

function LedgerRow({ r, isNew }: { r: Row; isNew?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-hairline-soft px-4 py-2.5 text-[13px] last:border-0">
      <span className="ltr-nums shrink-0 font-mono text-bone-dim" dir="ltr">
        {r.t}
      </span>
      <span className="shrink-0 bg-night-700 px-1.5 py-0.5 text-[11px] text-bone-soft" dir="rtl">
        {r.board}
      </span>
      <span className="min-w-0 flex-1 truncate text-bone-soft" dir="rtl">
        {r.cat}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-jade">
        <span aria-hidden>✓</span>
        <span className="hidden sm:inline">اپلای شد</span>
        {isNew ? <span className="ml-0.5 animate-pulse text-persimmon">▍</span> : null}
      </span>
    </div>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION).matches;
}

export function LedgerPanel() {
  // Start with 3 rows; append one every ~2.4s, keeping a 6-row window. Newest row
  // carries the amber caret. prefers-reduced-motion → render the full list static.
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
  const [tick, setTick] = useState(3);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 2400);
    return () => window.clearInterval(id);
  }, [reduced]);

  // Which rows are visible: a rolling window over ROWS.
  const count = Math.min(6, tick);
  const idx = tick % (ROWS.length + 1);
  const start = reduced ? 0 : Math.max(0, idx + 1 - count) % ROWS.length;
  const visible = reduced
    ? ROWS
    : Array.from({ length: count }, (_, i) => ROWS[(start + i) % ROWS.length]);

  return (
    <div className="overflow-hidden border border-hairline bg-night-800 shadow-md">
      {/* status bar */}
      <div className="flex items-center justify-between border-b border-hairline bg-night-950 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="dot-live" />
          <span className="text-xs text-bone-soft" dir="rtl">
            کارجو <span className="text-bone-dim">— شیفتِ شب</span>
          </span>
        </div>
        <span className="text-[11px] text-jade">
          ● متصل
        </span>
      </div>
      {/* ledger */}
      <div className="divide-y divide-hairline-soft">
        {visible.map((r, i) => (
          <LedgerRow key={r.t + i} r={r} isNew={!reduced && i === visible.length - 1} />
        ))}
      </div>
      {/* footer summary */}
      <div className="flex items-center justify-between border-t border-hairline bg-night-950 px-4 py-2.5">
        <span className="text-xs text-bone-dim">اپلای‌های امشب</span>
        <span className="ltr-nums font-mono text-sm font-bold text-persimmon" dir="ltr">
          ۲۴
        </span>
      </div>
    </div>
  );
}
