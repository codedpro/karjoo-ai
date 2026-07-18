"use client";

/**
 * دکمه‌ی «رزومه‌ی سفارشیِ این شغل» — به‌جای انگیزه‌نامه: با هوش مصنوعی یک رزومه‌ی هدف‌گیری‌شده
 * برای این آگهی می‌سازد (هزینه به کیف‌پولِ 1xAi) و پیش‌نمایش را در تبِ نو باز می‌کند. همین رزومه
 * در اپلای خودکار به‌شکلِ PDF آپلود می‌شود.
 */
import { useState } from "react";

export function TailorResumeButton({ listingId }: { listingId: string }) {
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err" | "info"; text: string } | null>(null);

  async function go() {
    if (pending) return;
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch("/api/resume/tailor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const body: { id?: string; error?: string; topupUrl?: string } = await res
        .json()
        .catch(() => ({}));
      if (res.ok && body.id) {
        setMsg({ tone: "ok", text: "رزومه‌ی سفارشی ساخته شد ✓" });
        window.open(`/api/resume/tailored?id=${encodeURIComponent(body.id)}`, "_blank", "noopener");
      } else if (res.status === 402) {
        setMsg({ tone: "err", text: "موجودیِ کیف‌پولِ 1xAi کافی نیست — شارژ کنید." });
      } else if (res.status === 404) {
        setMsg({ tone: "info", text: "ابتدا رزومه/پروفایلِ پایه را کامل کنید." });
      } else if (res.status === 401) {
        setMsg({ tone: "err", text: "نشست منقضی شده — دوباره وارد شوید." });
      } else {
        setMsg({ tone: "err", text: body.error ?? "ساختِ رزومه ناموفق بود." });
      }
    } catch {
      setMsg({ tone: "err", text: "خطای اتصال — کمی بعد دوباره امتحان کنید." });
    } finally {
      setPending(false);
    }
  }

  const toneClass =
    msg?.tone === "ok"
      ? "text-emerald-400"
      : msg?.tone === "err"
        ? "text-rose-400"
        : "text-[#8A9099]";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        aria-busy={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#FFB020]/40 bg-[#FFB020]/10 px-3 py-1.5 text-xs font-semibold text-[#FFB020] transition-colors hover:bg-[#FFB020]/20 disabled:opacity-60"
      >
        {pending ? "در حال ساخت…" : "رزومه‌ی سفارشیِ این شغل"}
      </button>
      {msg ? <span className={`text-[11px] ${toneClass}`}>{msg.text}</span> : null}
    </div>
  );
}
