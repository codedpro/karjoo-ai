"use client";

/**
 * پنلِ «اتصالِ افزونه» — یک کدِ جفت‌سازیِ یک‌بارمصرف می‌سازد تا افزونه با آن pair شود.
 *
 * قاعده‌ی CONTEXT (۵): افزونه با هندآفِ یک‌بارمصرف pair می‌شود، نه ورودِ دوم.
 * این کامپوننت POST /api/auth/extension/pair را صدا می‌زند (با کوکیِ نشستِ وب) و کدِ
 * خام را فقط همین‌جا، موقتاً، نمایش می‌دهد. کد کوتاه‌عمر است؛ شمارشِ معکوس نشان داده
 * می‌شود. هیچ رازِ سرور/توکنی اینجا hard-code نیست — همه از پاسخِ امنِ سرور می‌آید.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { IconCheck, IconPuzzle, IconShield } from "./icons";
import { Badge, Button, Card, toFaDigits } from "./ui";

interface PairResponse {
  /** کدِ جفت‌سازیِ خام برای واردکردن در افزونه (فیلدِ قراردادِ مسیرِ pair). */
  pairingCode?: string;
  /** زمانِ انقضا (ISO) — برای شمارشِ معکوس. */
  expiresAt?: string;
  error?: string;
}

function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
}

export function PairExtensionPanel() {
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // «اکنون» را هر ثانیه (داخلِ callbackِ تایمر) به‌روز می‌کنیم؛ `remaining` در زمانِ
  // رندر از روی expiresAt مشتق می‌شود. این‌طور setState همگام‌سازی‌شده در بدنه‌ی effect
  // نداریم (پرهیز از رندرِ آبشاری).
  const [nowTs, setNowTs] = useState(() => Date.now());

  // تیکِ شمارشِ معکوس — همه‌ی setStateها داخلِ callbackِ تایمر رخ می‌دهند (مجاز؛ نه در
  // بدنه‌ی effect). وقتی کد منقضی شد، همان‌جا پاکش می‌کنیم تا effectِ جداگانه‌ای که
  // setState همگام داشته باشد لازم نشود.
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => {
      const t = Date.now();
      if (secondsLeft(expiresAt, t) <= 0) {
        setCode(null);
        setExpiresAt(null);
      } else {
        setNowTs(t);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const remaining = expiresAt ? secondsLeft(expiresAt, nowTs) : 0;

  async function generate() {
    setError(null);
    setCopied(false);
    setPending(true);
    try {
      const res = await fetch("/api/auth/extension/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data: PairResponse = await res.json().catch(() => ({}));
      if (!res.ok || !data.pairingCode) {
        setError(data.error ?? "ساختِ کدِ اتصال ناموفق بود. دوباره تلاش کنید.");
        return;
      }
      setCode(data.pairingCode);
      setNowTs(Date.now());
      setExpiresAt(data.expiresAt ?? null);
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // اگر clipboard در دسترس نبود، کاربر دستی کپی می‌کند.
    }
  }

  const mm = Math.floor(remaining / 60);
  const ss = remaining % 60;
  const timeLabel = `${toFaDigits(mm)}:${toFaDigits(String(ss).padStart(2, "0"))}`;

  return (
    <Card padded>
      <div className="flex items-start gap-3">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
          aria-hidden
        >
          <IconPuzzle className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-balance text-base font-bold">اتصالِ افزونه‌ی مرورگر</h3>
          <p className="mt-1 text-pretty text-sm leading-7 text-muted">
            افزونه‌ی کارجو در مرورگرِ خودتان، با تأییدِ شما اپلای را پیش‌نویس می‌کند.
            برای اتصال، یک کدِ یک‌بارمصرف بسازید و آن را در افزونه وارد کنید — نیازی به
            ورودِ دوباره نیست.
          </p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      ) : null}

      {code ? (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-brand/40 bg-brand/5 px-4 py-3">
            <code className="ltr-nums select-all break-all text-sm font-bold tracking-wide text-foreground">
              {code}
            </code>
            <Button
              type="button"
              onClick={copy}
              variant="primary"
              size="sm"
              className="shrink-0"
            >
              {copied ? (
                <>
                  <IconCheck className="h-4 w-4" />
                  کپی شد
                </>
              ) : (
                "کپی"
              )}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            این کد یک‌بارمصرف است و تا{" "}
            <span className="ltr-nums font-medium text-foreground">{timeLabel}</span>{" "}
            دیگر معتبر است.
          </p>
        </div>
      ) : (
        <Button
          type="button"
          onClick={generate}
          disabled={pending}
          className="mt-5 w-full sm:w-auto"
        >
          {pending ? "در حالِ ساخت…" : "ساخت کدِ اتصال"}
        </Button>
      )}
    </Card>
  );
}

/* ───────────────────  قطعِ اتصالِ یک سایتِ کاریابی (client)  ─────────────────── */

/**
 * دکمه‌ی «قطع اتصال» برای یک سایتِ کاریابیِ متصل. DELETE /api/board-accounts/disconnect را با
 * { board } صدا می‌زند (کوکیِ نشستِ وب) و سپس router.refresh می‌کند تا کارتِ سرور «حساب‌های
 * متصل» با وضعیتِ تازه دوباره رندر شود. سرور بلابِ نشستِ خزانه را حذف می‌کند؛ این‌جا هیچ راز/
 * توکنی رد و بدل نمی‌شود و board همان متادیتای عمومیِ سایت است.
 */
export function DisconnectBoardButton({ board }: { board: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/board-accounts/disconnect", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "قطعِ اتصال ناموفق بود.");
        return;
      }
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        type="button"
        onClick={disconnect}
        disabled={pending}
        variant="danger"
        size="sm"
      >
        {pending ? "در حالِ قطع…" : "قطع اتصال"}
      </Button>
      {error ? (
        <span
          role="alert"
          className="max-w-32 text-pretty text-[0.7rem] leading-4 text-rose-600 dark:text-rose-400"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* ─────────────────  دستگاه‌ها و نشست‌های فعال (client)  ─────────────────── */

/** یک ردیفِ نشستِ احراز از GET /api/sessions — فقط متادیتا (هرگز توکن). */
interface AuthSessionRow {
  id: string;
  kind: "web" | "extension";
  userAgent: string | null;
  createdAt: string;
  lastSeen: string | null;
  expiresAt: string;
  revokedAt: string | null;
  current: boolean;
}

/** برچسبِ فارسیِ نوعِ نشست. */
const SESSION_KIND_LABEL: Record<string, string> = {
  web: "مرورگر (وب)",
  extension: "افزونه‌ی مرورگر",
};

/** تاریخِ ISO را به تاریخِ خوانا (شمسی) تبدیل می‌کند؛ در نبود/نامعتبری «—». */
function faDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return d.toLocaleDateString("fa-IR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * فهرستِ نشست‌های احرازِ فعالِ کاربر (وب و افزونه) با دکمه‌ی «لغوِ دسترسی» برای هرکدام.
 *
 * GET /api/sessions را روی mount می‌گیرد و DELETE /api/sessions/:id را برای ابطال صدا می‌زند
 * (هر دو با کوکیِ نشستِ وب؛ سرور همیشه به کاربرِ نشست مقید است). نشستِ جاری با نشانِ «این نشست»
 * مشخص و دکمه‌اش غیرفعال است تا کاربر به‌اشتباه خودش را بیرون نیندازد (خروج جای دیگری است).
 * هیچ توکن/رازی این‌جا نمایش داده نمی‌شود.
 */
export function ConnectedDevicesPanel() {
  const [sessions, setSessions] = useState<AuthSessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        headers: { accept: "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data as { error?: string }).error ?? "دریافتِ فهرستِ دستگاه‌ها ناموفق بود.",
        );
        setSessions([]);
        return;
      }
      setSessions((data as { sessions?: AuthSessionRow[] }).sessions ?? []);
    } catch {
      setError("اتصال به سرور برقرار نشد.");
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    if (revoking) return;
    setRevoking(id);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "لغوِ دسترسی ناموفق بود.");
        return;
      }
      await load();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setRevoking(null);
    }
  }

  // فقط نشست‌های فعال (باطل‌نشده) — این‌ها دسترسی‌های زنده‌ای‌اند که کاربر می‌تواند لغو کند.
  const active = (sessions ?? []).filter((s) => !s.revokedAt);

  return (
    <Card padded>
      <div className="flex items-start gap-3">
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand"
          aria-hidden
        >
          <IconShield className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-balance text-base font-bold">دستگاه‌ها و نشست‌های فعال</h3>
          <p className="mt-1 text-pretty text-sm leading-7 text-muted">
            هر جا که با حساب‌تان وارد شده‌اید یا افزونه را متصل کرده‌اید این‌جا فهرست می‌شود.
            هر دسترسی را که نمی‌شناسید یا دیگر لازم ندارید، «لغوِ دسترسی» کنید.
          </p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      ) : null}

      {sessions === null ? (
        <p className="mt-4 text-sm text-muted">در حالِ بارگذاری…</p>
      ) : active.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/60 px-4 py-5 text-center text-sm text-muted">
          نشستِ فعالی یافت نشد.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {active.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2.5 rounded-xl border border-border px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {SESSION_KIND_LABEL[s.kind] ?? s.kind}
                  </span>
                  {s.current ? <Badge tone="green">این نشست</Badge> : null}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  آخرین فعالیت:{" "}
                  <span className="ltr-nums">{faDate(s.lastSeen ?? s.createdAt)}</span>
                </div>
                {s.userAgent ? (
                  <div
                    className="truncate text-[0.7rem] text-muted/80"
                    dir="ltr"
                    title={s.userAgent}
                  >
                    {s.userAgent}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                onClick={() => revoke(s.id)}
                disabled={revoking === s.id || s.current}
                variant="danger"
                size="sm"
                className="shrink-0"
                title={s.current ? "این نشستِ فعلیِ شماست" : undefined}
              >
                {revoking === s.id ? "در حالِ لغو…" : "لغوِ دسترسی"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
