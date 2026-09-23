"use client";

/**
 * فرمِ ورود با ایمیل/گذرواژه — گذرواژه‌ی *استخرِ مشترکِ 1xai* (client component).
 *
 * تنها جزیره‌ی کلاینتیِ صفحه‌ی ورود: JSON به POST /api/auth/password می‌فرستد؛ روتِ
 * سرور اعتبار را در برابرِ 1xai می‌سنجد و همان کوکیِ نشستِ مسیرِ Google را می‌نشاند.
 * موفقیت → ناوبری به /dashboard (+ refresh تا layoutهای سرور نشستِ تازه را ببینند)؛
 * شکست → متنِ خطای برگشتی از سرور (پیامِ یکنواختِ فارسی) زیرِ فرم نمایش داده می‌شود.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

/** پیامِ خطای عمومی وقتی پاسخِ سرور بدنه‌ی قابل‌خواندن ندارد (مثلاً قطعیِ شبکه). */
const GENERIC_ERROR = "ورود ناموفق بود، دوباره تلاش کنید.";

export function PasswordLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data: { ok?: boolean; error?: string } = await res
        .json()
        .catch(() => ({}));

      if (res.ok && data.ok) {
        // کوکیِ نشست نشسته؛ ناوبری + refresh تا گاردِ سرورِ داشبورد آن را ببیند.
        router.push("/dashboard");
        router.refresh();
        return;
      }
      setError(typeof data.error === "string" && data.error ? data.error : GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3" noValidate>
      <label className="block">
        <span className="mb-1.5 block text-xs text-whisper">ایمیل</span>
        <input
          type="email"
          name="email"
          dir="ltr"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="نشانیِ ایمیل"
          className="focus-ring w-full border border-hairline-strong bg-night-900 px-3 py-2.5 text-sm text-bone placeholder:text-whisper"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs text-whisper">گذرواژه</span>
        <input
          type="password"
          name="password"
          dir="ltr"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="focus-ring w-full border border-hairline-strong bg-night-900 px-3 py-2.5 text-sm text-bone"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-rose">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !email.trim() || !password}
        className="focus-ring mt-1 w-full press bg-persimmon px-6 py-3 text-base font-medium text-night-950 transition-colors hover:bg-persimmon-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "در حال ورود…" : "ورود با گذرواژه"}
      </button>
    </form>
  );
}
