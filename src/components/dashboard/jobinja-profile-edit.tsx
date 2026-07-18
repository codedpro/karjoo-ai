"use client";

/**
 * ویرایشِ فیلدهای اصلیِ پروفایلِ جابینجا از داخلِ کارجو (basic-data: عنوانِ شغلی + نام).
 * PUT /api/boards/jobinja/profile با نشستِ vaultِ کاربر روی جابینجا می‌نویسد.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export function JobinjaProfileEdit({
  initialJobTitle,
  initialFullName,
}: {
  initialJobTitle?: string | null;
  initialFullName?: string | null;
}) {
  const router = useRouter();
  const [jobTitle, setJobTitle] = useState(initialJobTitle ?? "");
  const [fullName, setFullName] = useState(initialFullName ?? "");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function save() {
    if (pending) return;
    setPending(true);
    setMsg(null);
    try {
      const res = await fetch("/api/boards/jobinja/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobTitle: jobTitle.trim(), fullName: fullName.trim() }),
      });
      const body: { error?: string } = await res.json().catch(() => ({}));
      if (res.ok) {
        setMsg({ tone: "ok", text: "روی جابینجا ذخیره شد ✓" });
        router.refresh();
      } else if (res.status === 409) {
        setMsg({ tone: "err", text: "ابتدا جابینجا را از افزونه وصل کنید." });
      } else {
        setMsg({ tone: "err", text: body.error ?? "ذخیره ناموفق بود." });
      }
    } catch {
      setMsg({ tone: "err", text: "خطای اتصال." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-surface/40 p-5">
      <h3 className="mb-3 text-sm font-bold">ویرایشِ پروفایلِ جابینجا</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-muted">عنوانِ شغلی</span>
          <input
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            dir="auto"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder="مثلاً Full-Stack Software Engineer"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">نام و نام خانوادگی</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            dir="auto"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
            placeholder="نام کامل"
          />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand px-4 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "در حال ذخیره…" : "ذخیره روی جابینجا"}
        </button>
        {msg ? (
          <span className={`text-[11px] ${msg.tone === "ok" ? "text-emerald-400" : "text-rose-400"}`}>
            {msg.text}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        فقط همین فیلدها روی جابینجا نوشته می‌شوند؛ سایرِ بخش‌های رزومه دست‌نخورده می‌مانند.
      </p>
    </div>
  );
}
