"use client";

/**
 * پرایمیتیوهای فرمِ رزومه/پروفایل (Track C, client) — ورودی/متن‌چندخطی با برچسبِ *دیدنی*،
 * متنِ راهنما و جای‌گاهِ خطا. همه RTL و روی توکن‌های داشبورد. حداقل ارتفاعِ ۴۴px برای لمس.
 *
 * چرا اجزای مشترک؟ فرمِ پروفایل ده‌ها فیلد و چند بخشِ آرایه‌ای دارد؛ این پرایمیتیوها
 * تکرار را حذف و «برچسبِ دیدنی + خطای نزدیکِ فیلد» را یکدست تضمین می‌کنند (قاعده‌ی فرم‌ها).
 */
import type { ReactNode } from "react";

import { cn } from "../ui";

const CONTROL =
  "focus-ring w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm leading-6 outline-none transition-colors placeholder:text-muted/70 focus:border-brand";

/** ورودیِ متنیِ تک‌خطی با برچسبِ دیدنی + راهنما/خطای اختیاری. */
export function LabeledInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  hint,
  type = "text",
  inputMode,
  dir,
  autoComplete,
  icon,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  hint?: string;
  type?: "text" | "tel" | "url" | "email";
  inputMode?: "numeric" | "text" | "tel" | "url" | "email";
  dir?: "ltr" | "rtl";
  autoComplete?: string;
  /** آیکنِ درون‌خطیِ سمتِ شروع (تزئینی). */
  icon?: ReactNode;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <div className="relative">
        {icon ? (
          <span
            className="pointer-events-none absolute inset-y-0 inset-s-3 grid place-items-center text-muted [&>svg]:h-4 [&>svg]:w-4"
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          inputMode={inputMode}
          dir={dir}
          autoComplete={autoComplete}
          className={cn(CONTROL, icon ? "ps-9" : "", dir === "ltr" && "ltr-nums")}
        />
      </div>
      {hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

/** متنِ چندخطی با برچسبِ دیدنی + راهنما. */
export function LabeledTextarea({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  hint,
  maxLength,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className={cn(CONTROL, "resize-y")}
      />
      {hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

/** برچسبِ فیلد — دیدنی (نه placeholder-only)، با ستاره‌ی «اجباری» در صورتِ لزوم. */
export function FieldLabel({
  htmlFor,
  required,
  children,
}: {
  htmlFor: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children}
      {required ? (
        <span className="text-rose-500" aria-hidden>
          {" "}
          *
        </span>
      ) : null}
    </label>
  );
}

/** متنِ راهنمای زیرِ فیلد — پایدار (نه فقط placeholder). */
export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-xs leading-5 text-muted">{children}</p>;
}

/** چک‌باکسِ ساده با برچسب — برای «تا کنون مشغولم». */
export function LabeledCheckbox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring h-4 w-4 rounded border-border text-brand accent-brand"
      />
      {label}
    </label>
  );
}
