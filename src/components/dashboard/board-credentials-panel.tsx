"use client";

/**
 * پنلِ «ورودِ خودکار» (client component) — کاربر ایمیل و رمزِ سایت کاریابی را می‌دهد تا
 * کارجو بتواند بدونِ باز بودنِ مرورگر هم برایش اپلای کند.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * این پنل عمداً صریح است، نه آرام‌بخش: کاربر باید بداند رمزش نگه داشته می‌شود. رمز فقط
 * یک‌بار به سرور می‌رود، سرور بلافاصله با آن وارد می‌شود و اگر سایت قبول نکرد چیزی ذخیره
 * نمی‌شود. هیچ‌وقت رمز به کلاینت برنمی‌گردد — فقط نامِ کاربریِ ماسک‌شده.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, Button, Callout, Card, cn } from "./ui";
import { IconShield, IconWarn } from "./icons";
import { boardLabel } from "./auto-apply-labels";

export interface CredentialStatusView {
  board: string;
  usernameHint: string;
  lastLoginAt: string | null;
  lastLoginStatus: string | null;
  failureCount: number;
  lockedUntil: string | null;
  locked: boolean;
}

interface Props {
  supportedBoards: string[];
  credentials: CredentialStatusView[];
  vaultReady: boolean;
  /** سایت‌هایی که کاربر قبلاً در افزونه متصل کرده — پیش‌شرطِ ورودِ خودکار. */
  connectedBoards: string[];
}

const STATUS_LABELS: Record<string, string> = {
  ok: "آخرین ورود موفق بود",
  invalid_credentials: "ایمیل یا رمز پذیرفته نشد",
  security_challenge: "سایت بررسی امنیتی خواست",
  rate_limited: "سایت تعداد تلاش را محدود کرد",
  account_action_required: "حساب شما در آن سایت نیاز به تکمیل دارد",
  session_unavailable: "نشست ساخته نشد",
  unavailable: "ارتباط با سایت برقرار نشد",
  provider_changed: "صفحهٔ ورود آن سایت تغییر کرده",
};

export function BoardCredentialsPanel({
  supportedBoards,
  credentials,
  vaultReady,
  connectedBoards,
}: Props) {
  const router = useRouter();
  const [board, setBoard] = useState(supportedBoards[0] ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const eligible = supportedBoards.filter((b) => connectedBoards.includes(b));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !board) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch("/api/board-accounts/credentials", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board, username, password }),
      });
      const body = (await response.json()) as { error?: string; accountLabel?: string };
      if (!response.ok) {
        setError(body.error ?? "ذخیره نشد. دوباره تلاش کنید.");
        return;
      }
      // رمز را حتی در حافظهٔ صفحه هم نگه نمی‌داریم.
      setPassword("");
      setUsername("");
      setDone(
        body.accountLabel
          ? `ورود انجام شد — حساب «${body.accountLabel}».`
          : "ورود انجام شد و ذخیره شد.",
      );
      router.refresh();
    } catch {
      setError("ارتباط برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch("/api/board-accounts/credentials", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board: target }),
      });
      if (!response.ok) {
        setError("حذف نشد. دوباره تلاش کنید.");
        return;
      }
      setDone("ورود خودکار برای این سایت خاموش شد و رمز حذف شد.");
      router.refresh();
    } catch {
      setError("ارتباط برقرار نشد. دوباره تلاش کنید.");
    } finally {
      setBusy(false);
    }
  }

  if (!vaultReady) {
    return (
      <Card>
        <Callout tone="warn" icon={<IconWarn />} title="ورود خودکار در دسترس نیست">
          خزانهٔ رمزنگاری روی این سرور پیکربندی نشده است، بنابراین رمز شما جایی برای
          ذخیرهٔ امن ندارد و این قابلیت خاموش است.
        </Callout>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">ورود خودکار (بدون نیاز به باز بودن مرورگر)</h2>
        <Badge tone="muted">اختیاری</Badge>
      </div>

      <Callout tone="warn" icon={<IconShield />} title="پیش از فعال‌سازی این را بخوانید">
        با فعال‌کردن این گزینه، <strong>رمز عبور سایت کاریابی شما</strong> رمزنگاری‌شده روی
        سرور کارجو نگهداری می‌شود تا هر وقت لازم شد، کارجو خودش وارد شود و به‌جای شما اپلای
        کند — حتی وقتی مرورگرتان بسته است. اگر همین رمز را در جای دیگری (ایمیل، بانک) هم
        استفاده می‌کنید، پیشنهاد می‌کنیم اول رمز آن سایت را عوض کنید. هر زمان بخواهید
        می‌توانید رمز را حذف کنید.
      </Callout>

      {credentials.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {credentials.map((credential) => (
            <li
              key={credential.board}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{boardLabel(credential.board)}</p>
                <p className="text-xs text-white/60">
                  {credential.usernameHint}
                  {credential.lastLoginStatus ? (
                    <>
                      {" · "}
                      <span className={cn(credential.lastLoginStatus !== "ok" && "text-amber-300")}>
                        {STATUS_LABELS[credential.lastLoginStatus] ?? credential.lastLoginStatus}
                      </span>
                    </>
                  ) : null}
                </p>
                {credential.locked ? (
                  <p className="mt-1 text-xs text-amber-300">
                    پس از چند تلاش ناموفق، ورود خودکار موقتاً متوقف شده است. رمز تازه را
                    وارد کنید تا دوباره فعال شود.
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void remove(credential.board)}
                disabled={busy}
              >
                حذف رمز
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {eligible.length === 0 ? (
        <p className="mt-4 text-sm text-white/70">
          برای فعال‌کردن ورود خودکار، اول باید همان سایت را یک‌بار از افزونه متصل کنید.
        </p>
      ) : (
        <form className="mt-4 grid gap-3" onSubmit={save}>
          <label className="grid gap-1 text-sm">
            <span className="text-white/70">سایت</span>
            <select
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
              value={board}
              onChange={(event) => setBoard(event.target.value)}
            >
              {eligible.map((option) => (
                <option key={option} value={option}>
                  {boardLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-white/70">ایمیل یا نام کاربری در آن سایت</span>
            <input
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
              type="text"
              autoComplete="off"
              dir="ltr"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-white/70">رمز عبور آن سایت</span>
            <input
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !username || !password}>
              {busy ? "در حال ورود…" : "ورود و ذخیره"}
            </Button>
            <span className="text-xs text-white/50">
              اول وارد می‌شویم؛ اگر سایت قبول نکرد، چیزی ذخیره نمی‌شود.
            </span>
          </div>
        </form>
      )}

      {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {done ? <p className="mt-3 text-sm text-emerald-300">{done}</p> : null}
    </Card>
  );
}
