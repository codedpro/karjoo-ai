"use client";

/**
 * فرمِ ورود/ثبت‌نام با شماره موبایل (client component).
 *
 * دو مرحله: ۱) شماره → POST /api/auth/otp/request  ۲) کدِ OTP → POST /api/auth/otp/verify.
 * مسیرِ verify در صورتِ موفقیت کوکیِ نشست (httpOnly) را ست می‌کند؛ این کامپوننت هیچ
 * توکنی نمی‌بیند و فقط با کدِ وضعیت/پیامِ پاسخ کار می‌کند، سپس به /dashboard می‌رود.
 *
 * قاعده‌ی CONTEXT: هویتِ حساب همان phone-OTP است (یک‌بار). افزونه با هندآف pair
 * می‌شود، نه OTP دوم — این فرم فقط برای وب است.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { toFaDigits } from "./ui";

type Step = "phone" | "otp";

/** اعتبارسنجیِ سبکِ سمتِ کلاینت (سرور منبعِ حقیقت است). */
function normalizePhone(raw: string): string {
  // ارقامِ فارسی/عربی → لاتین، حذفِ فاصله/خط تیره.
  const map: Record<string, string> = {
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  return raw
    .replace(/[۰-۹٠-٩]/g, (d) => map[d] ?? d)
    .replace(/[\s-]/g, "");
}

function isValidIranMobile(phone: string): boolean {
  // 09xxxxxxxxx یا +989xxxxxxxxx
  return /^(?:0|\+98)9\d{9}$/.test(phone);
}

export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizePhone(phone);
    if (!isValidIranMobile(normalized)) {
      setError("شماره موبایل معتبر نیست. مثل ۰۹۱۲۳۴۵۶۷۸۹ وارد کنید.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });
      const data: { error?: string; message?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "ارسالِ کد ناموفق بود. کمی بعد دوباره تلاش کنید.");
        return;
      }
      setPhone(normalized);
      setStep("otp");
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanCode = normalizePhone(code); // همان نگاشتِ ارقام
    if (!/^\d{4,8}$/.test(cleanCode)) {
      setError("کدِ تأیید را کامل وارد کنید.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code: cleanCode }),
      });
      const data: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "کدِ واردشده درست نیست یا منقضی شده است.");
        return;
      }
      // کوکیِ نشست توسطِ مسیرِ verify ست شد؛ به داشبورد برو و سرور را تازه کن.
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full">
      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
        </div>
      ) : null}

      {step === "phone" ? (
        <form onSubmit={requestOtp} className="space-y-4">
          <div>
            <label htmlFor="phone" className="mb-1.5 block text-sm font-medium">
              شماره موبایل
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="۰۹۱۲۳۴۵۶۷۸۹"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="ltr-nums w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-lg tracking-widest outline-none transition-colors focus:border-brand"
              disabled={pending}
              required
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-gradient-to-l from-brand to-brand-2 px-6 py-3 text-base font-bold text-white shadow-lg shadow-brand/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {pending ? "در حال ارسال…" : "ارسال کد تأیید"}
          </button>
          <p className="text-center text-xs text-muted">
            با ادامه، یک کدِ یک‌بارمصرف به شماره‌ی شما پیامک می‌شود.
          </p>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="space-y-4">
          <p className="text-sm text-muted">
            کدِ ارسال‌شده به <span className="ltr-nums font-medium text-foreground">{toFaDigits(phone)}</span> را
            وارد کنید.
          </p>
          <div>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium">
              کد تأیید
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              placeholder="------"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="ltr-nums w-full rounded-xl border border-border bg-card px-4 py-3 text-center text-2xl tracking-[0.5em] outline-none transition-colors focus:border-brand"
              disabled={pending}
              autoFocus
              required
            />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-full bg-gradient-to-l from-brand to-brand-2 px-6 py-3 text-base font-bold text-white shadow-lg shadow-brand/30 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {pending ? "در حال بررسی…" : "ورود به داشبورد"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError(null);
            }}
            disabled={pending}
            className="w-full text-center text-sm text-muted transition-colors hover:text-foreground"
          >
            ویرایش شماره
          </button>
        </form>
      )}
    </div>
  );
}
