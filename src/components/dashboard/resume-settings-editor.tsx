"use client";

import { useState } from "react";

import { IconPlus, IconTrash } from "@/components/dashboard/icons";
import { Badge, Button, Card, cn } from "@/components/dashboard/ui";
import type { ResumeSettings } from "@/lib/resume/settings";

interface Option { id: string; label: string }
interface TemplateOption extends Option { description: string }

export function ResumeSettingsEditor({
  initial,
  domains,
  sections,
  templates,
}: {
  initial: ResumeSettings;
  domains: Option[];
  sections: Option[];
  templates: TemplateOption[];
}) {
  const [settings, setSettings] = useState(initial);
  const [clientDraft, setClientDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function patch<K extends keyof ResumeSettings>(key: K, value: ResumeSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    setMessage(null);
  }

  function toggle(field: "declaredDomains" | "broadMatchingSections", value: string) {
    const current = settings[field] as string[];
    patch(
      field,
      (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]) as never,
    );
  }

  function addClient() {
    const name = clientDraft.trim();
    if (!name || settings.clients.some((client) => client.toLowerCase() === name.toLowerCase())) return;
    patch("clients", [...settings.clients, name]);
    setClientDraft("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/resume/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        settings?: ResumeSettings;
      };
      if (!response.ok || !body.settings) {
        setMessage({ tone: "error", text: body.error ?? "تنظیم‌ها ذخیره نشد." });
        return;
      }
      setSettings(body.settings);
      setMessage({ tone: "ok", text: "تنظیم‌های رزومه ذخیره شد." });
    } catch {
      setMessage({ tone: "error", text: "ارتباط با سرور برقرار نشد." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padded>
      <form onSubmit={save} className="space-y-7">
        <fieldset>
          <legend className="text-sm font-bold">هویت در رزومه</legend>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="جنسیت">
              <select
                value={settings.gender}
                onChange={(event) => patch("gender", event.target.value as ResumeSettings["gender"])}
                className={controlClass}
              >
                <option value="unspecified">مشخص نشده</option>
                <option value="male">مرد</option>
                <option value="female">زن</option>
              </select>
            </Field>
            <Field label="نام لاتین">
              <input
                value={settings.fullNameLatin}
                onChange={(event) => patch("fullNameLatin", event.target.value)}
                className={controlClass}
                dir="ltr"
                autoComplete="name"
              />
            </Field>
            <Field label="شماره روی رزومه">
              <input
                value={settings.resumePhone}
                onChange={(event) => patch("resumePhone", event.target.value)}
                className={controlClass}
                dir="ltr"
                inputMode="tel"
              />
            </Field>
            <Field label="زبان رزومه">
              <select
                value={settings.resumeLang}
                onChange={(event) => patch("resumeLang", event.target.value as "fa" | "en")}
                className={controlClass}
              >
                <option value="fa">فارسی</option>
                <option value="en">English</option>
              </select>
            </Field>
            <Field label="قالب رزومه">
              <select
                value={settings.resumeTemplate}
                onChange={(event) => patch("resumeTemplate", event.target.value as ResumeSettings["resumeTemplate"])}
                className={controlClass}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.label}</option>
                ))}
              </select>
            </Field>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={settings.hideLocation}
                onChange={(event) => patch("hideLocation", event.target.checked)}
              />
              پنهان کردن شهر در رزومه
            </label>
          </div>
        </fieldset>

        <fieldset className="border-t border-border pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <legend className="text-sm font-bold">دامنه‌های تخصصی</legend>
            <Badge tone="muted">{settings.declaredDomains.length.toLocaleString("fa-IR")} انتخاب</Badge>
          </div>
          <label className="mt-4 flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings.broadMatchingMode}
              onChange={(event) => patch("broadMatchingMode", event.target.checked)}
            />
            تطبیق گسترده
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {sections.map((section) => (
              <label
                key={section.id}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                  settings.broadMatchingSections.includes(section.id as never)
                    ? "border-brand/35 bg-brand/10 text-foreground"
                    : "border-border text-muted",
                )}
              >
                <input
                  type="checkbox"
                  checked={settings.broadMatchingSections.includes(section.id as never)}
                  onChange={() => toggle("broadMatchingSections", section.id)}
                />
                {section.label}
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {domains.map((domain) => (
              <label
                key={domain.id}
                className={cn(
                  "flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                  settings.declaredDomains.includes(domain.id)
                    ? "border-brand/35 bg-brand/10 text-foreground"
                    : "border-border text-muted",
                )}
              >
                <input
                  type="checkbox"
                  checked={settings.declaredDomains.includes(domain.id)}
                  onChange={() => toggle("declaredDomains", domain.id)}
                />
                <span>{domain.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="border-t border-border pt-6">
          <legend className="text-sm font-bold">شرکت‌ها و شواهد کاری</legend>
          <div className="mt-4 flex gap-2">
            <input
              value={clientDraft}
              onChange={(event) => setClientDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addClient();
                }
              }}
              className={controlClass}
              placeholder="نام شرکت یا مشتری"
            />
            <Button type="button" variant="secondary" onClick={addClient} aria-label="افزودن شرکت">
              <IconPlus className="h-4 w-4" />
              افزودن
            </Button>
          </div>
          {settings.clients.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {settings.clients.map((client) => (
                <li key={client} className="inline-flex max-w-full items-center gap-2 rounded-full bg-foreground/5 py-1 pe-1.5 ps-3 text-sm">
                  <span className="truncate">{client}</span>
                  <button
                    type="button"
                    onClick={() => patch("clients", settings.clients.filter((item) => item !== client))}
                    aria-label={`حذف ${client}`}
                    className="focus-ring grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-foreground/10 hover:text-foreground"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>

        <fieldset className="border-t border-border pt-6">
          <legend className="text-sm font-bold">دستور ساخت رزومه</legend>
          <textarea
            value={settings.resumeEmphasis}
            onChange={(event) => patch("resumeEmphasis", event.target.value)}
            rows={5}
            maxLength={3000}
            className={cn(controlClass, "mt-4 resize-y")}
          />
          <label className="mt-4 flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={settings.unlimitedApply}
              onChange={(event) => patch("unlimitedApply", event.target.checked)}
            />
            بدون سقف تعداد کشف و صف
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button type="submit" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره تنظیم‌ها"}</Button>
          {message ? (
            <span className={cn("text-sm", message.tone === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{message.text}</span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

const controlClass = "focus-ring min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}
