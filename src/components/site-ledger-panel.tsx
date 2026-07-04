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
 * Self-contained fixed "ink + amber" palette (does NOT use the app theme tokens,
 * so it looks identical in light/dark): ink #0C0D10, panel #14161B, hairline
 * #242832, text #E8E9EC, muted #8A9099, signal amber #FFB020, tick #37C08A.
 */
import { useEffect, useRef, useState } from "react";

type Row = {
  t: string; // HH:MM (Persian digits, LTR)
  board: string; // real board slug
  cat: string; // real Jobinja category (fa)
  model: string; // which model wrote the cover letter
};

// Real boards + real Jobinja categories (from /api/v10/job/categories).
const ROWS: Row[] = [
  { t: "۰۲:۰۴", board: "jobinja", cat: "وب و برنامه‌نویسی", model: "gpt-4o" },
  { t: "۰۲:۱۷", board: "jobvision", cat: "پشتیبانی و مشتریان", model: "claude" },
  { t: "۰۲:۳۱", board: "jobinja", cat: "IT / DevOps / Server", model: "gpt-4o" },
  { t: "۰۲:۴۸", board: "e-estekhdam", cat: "مالی و حسابداری", model: "gemini" },
  { t: "۰۳:۰۵", board: "karboom", cat: "بازاریابی و فروش", model: "claude" },
  { t: "۰۳:۲۲", board: "jobinja", cat: "طراحی و گرافیک", model: "gpt-4o" },
  { t: "۰۳:۴۰", board: "jobvision", cat: "منابع انسانی", model: "gemini" },
  { t: "۰۳:۵۶", board: "jobinja", cat: "آموزش", model: "claude" },
];

function LedgerRow({ r, isNew }: { r: Row; isNew?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-[#1c1f27] px-4 py-2.5 text-[13px] last:border-0">
      <span className="ltr-nums shrink-0 font-mono text-[#8A9099]" dir="ltr">
        {r.t}
      </span>
      <span
        className="ltr-nums shrink-0 rounded bg-[#1c1f27] px-1.5 py-0.5 font-mono text-[11px] text-[#c9cdd4]"
        dir="ltr"
      >
        {r.board}
      </span>
      <span className="min-w-0 flex-1 truncate text-[#c9cdd4]">{r.cat}</span>
      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-[#37C08A]">
        <span aria-hidden>✓</span>
        <span className="hidden sm:inline">اپلای شد</span>
      </span>
      <span
        className="ltr-nums hidden shrink-0 rounded-full border border-[#2a2f3a] px-2 py-0.5 font-mono text-[10px] text-[#8A9099] md:inline"
        dir="ltr"
        title="cover letter model"
      >
        {r.model}
        {isNew ? <span className="ml-0.5 animate-pulse text-[#FFB020]">▍</span> : null}
      </span>
    </div>
  );
}

export function LedgerPanel() {
  // Start with 3 rows; append one every ~2.4s, keeping a 6-row window. Newest row
  // carries the amber caret. prefers-reduced-motion → render the full list static.
  const [count, setCount] = useState(3);
  const [reduced, setReduced] = useState(false);
  const idx = useRef(3);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mq.matches) {
      setReduced(true);
      setCount(ROWS.length);
      return;
    }
    const id = window.setInterval(() => {
      idx.current = (idx.current + 1) % (ROWS.length + 1);
      setCount((c) => (c >= 6 ? 6 : c + 1));
    }, 2400);
    return () => window.clearInterval(id);
  }, []);

  // Which rows are visible: a rolling window over ROWS.
  const start = reduced ? 0 : Math.max(0, idx.current + 1 - count) % ROWS.length;
  const visible = reduced
    ? ROWS
    : Array.from({ length: count }, (_, i) => ROWS[(start + i) % ROWS.length]);

  return (
    <div className="overflow-hidden rounded-lg border border-[#242832] bg-[#14161B] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)]">
      {/* status bar */}
      <div className="flex items-center justify-between border-b border-[#242832] bg-[#101217] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#FFB020] shadow-[0_0_0_3px_rgba(255,176,32,0.15)]" />
          <span className="font-mono text-xs text-[#c9cdd4]" dir="ltr">
            karjoo <span className="text-[#8A9099]">— night shift</span>
          </span>
        </div>
        <span className="ltr-nums font-mono text-[11px] text-[#8A9099]" dir="ltr">
          ● متصل
        </span>
      </div>
      {/* ledger */}
      <div className="divide-y divide-[#1c1f27]">
        {visible.map((r, i) => (
          <LedgerRow key={r.t + i} r={r} isNew={!reduced && i === visible.length - 1} />
        ))}
      </div>
      {/* footer summary */}
      <div className="flex items-center justify-between border-t border-[#242832] bg-[#101217] px-4 py-2.5">
        <span className="text-xs text-[#8A9099]">اپلای‌های امشب</span>
        <span className="ltr-nums font-mono text-sm font-bold text-[#FFB020]" dir="ltr">
          ۲۴
        </span>
      </div>
    </div>
  );
}
