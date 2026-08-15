"use client";

/**
 * ویرایشِ فیلدهای اصلیِ پروفایلِ جابینجا از داخلِ کارجو (basic-data: عنوانِ شغلی + نام).
 *
 * PUT /api/boards/jobinja/profile با نشستِ vaultِ کاربر روی جابینجا می‌نویسد؛ هیچ راز/کوکی‌ای
 * از کلاینت رد نمی‌شود. پس از موفقیت `router.refresh()` می‌زنیم تا کارتِ سرورِ «پروفایلِ
 * جابینجا» با اسنپ‌شاتِ تازه دوباره رندر شود.
 *
 * چرا این فرم *فقط* دو فیلد دارد: نوشتن روی سایتِ بیرونی برگشت‌ناپذیر است، پس دامنه‌اش
 * عمداً کوچک نگه داشته شده و همین را هم صریح می‌گوییم (بقیه‌ی رزومه دست‌نخورده می‌ماند).
 *
 * این نسخه از پرایمیتیوهای مشترک (Card/Button/Callout) و توکن‌های طراحی استفاده می‌کند؛
 * پیش‌تر دکمه/پیام‌ها رنگ و اندازه‌ی دست‌ساز داشتند (`text-background`, `text-emerald-400`)
 * که با بقیه‌ی داشبورد یکدست نبود و در تمِ روشن هم درست نمی‌نشست.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { IconCheck, IconEditBox, IconWarn } from "./icons";
import { Button, Callout, Card } from "./ui";

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
        setMsg({ tone: "ok", text: "روی جابینجا ذخیره شد." });
        router.refresh();
      } else if (res.status === 409) {
        setMsg({ tone: "err", text: "ابتدا جابینجا را از افزونه وصل کنید." });
      } else {
        setMsg({ tone: "err", text: body.error ?? "ذخیره ناموفق بود." });
      }
    } catch {
      setMsg({ tone: "err", text: "اتصال به سرور برقرار نشد." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Card padded>
      <div className="flex items-start gap-3">
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand [&>svg]:h-5 [&>svg]:w-5"
          aria-hidden
        >
          <IconEditBox />
        </span>
        <div className="min-w-0">
          <h3 className="text-balance text-base font-bold">ویرایشِ پروفایلِ جابینجا</h3>
          <p className="mt-0.5 text-pretty text-xs leading-5 text-muted">
            فقط همین دو فیلد روی جابینجا نوشته می‌شود؛ بقیه‌ی رزومه دست‌نخورده می‌ماند.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field
          id="jobinja-job-title"
          label="عنوانِ شغلی"
          value={jobTitle}
          onChange={setJobTitle}
          placeholder="مثلاً Full-Stack Software Engineer"
        />
        <Field
          id="jobinja-full-name"
          label="نام و نام خانوادگی"
          value={fullName}
          onChange={setFullName}
          placeholder="نام کامل"
        />
      </div>

      <Button type="button" onClick={save} disabled={pending} className="mt-5">
        {pending ? "در حال ذخیره…" : "ذخیره روی جابینجا"}
      </Button>

      {msg ? (
        <Callout
          tone={msg.tone === "ok" ? "success" : "danger"}
          icon={msg.tone === "ok" ? <IconCheck /> : <IconWarn />}
          className="mt-4"
        >
          <span role="status">{msg.text}</span>
        </Callout>
      ) : null}
    </Card>
  );
}

/** یک فیلدِ متنی با برچسبِ واقعیِ متصل (`htmlFor`) و حلقه‌ی تمرکزِ استاندارد. */
function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        dir="auto"
        placeholder={placeholder}
        className="focus-ring w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-muted/70"
      />
    </div>
  );
}
