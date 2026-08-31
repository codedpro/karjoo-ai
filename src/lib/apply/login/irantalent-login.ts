import "server-only";

/**
 * ورودِ خودکارِ ایران‌تلنت از سمتِ سرور.
 *
 * ایران‌تلنت یک SPAِ Angular است که با OAuth password-grant وارد می‌شود:
 * `POST /api/v1/auth/api-token` با client_id/client_secretِ عمومیِ خودِ سایت (که در
 * باندلِ جاوااسکریپتش منتشر شده) و نام کاربری/رمزِ کاربر. پاسخ access_token و
 * refresh_token می‌دهد؛ سایت همان‌ها را در کوکیِ first-partyِ
 * `auth_token_irantalent_new` می‌گذارد و هدرِ Authorization را از آن می‌سازد.
 *
 * ما همان پاکت را می‌سازیم و به‌عنوان کوکی در نشست ذخیره می‌کنیم، تا هم ورکر (که نشست
 * را در مرورگر replay می‌کند) و هم مسیرِ HTTPیِ اپلای بتوانند از آن استفاده کنند.
 *
 * §10: اعتبارنامه‌ی خودِ کاربر، با درخواستِ صریحِ خودش. اگر سایت کپچا/محدودیت اعمال کند
 * fail-closed می‌شویم؛ هیچ دور زدنی در کار نیست.
 */
import type { BoardLoginDriver, LoginResult } from "@/lib/apply/login/types";

const API_ROOT = "https://api.irantalent.com/api/v1";
const SITE_ORIGIN = "https://www.irantalent.com";
const AUTH_COOKIE = "auth_token_irantalent_new";
/** شناسه‌ی کلاینتِ عمومیِ خودِ وب‌اپِ ایران‌تلنت (از باندلِ منتشرشده‌اش). */
const CLIENT_ID = 3;
const CLIENT_SECRET = "vVBjRWg9sS4uv4ZCJe3qMfoJyPB3yGMIJYMyeOVL";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** PURE: پاسخِ خطای ایران‌تلنت را به دلیلِ استاندارد نگاشت می‌کند. */
export function classifyAuthFailure(status: number, body: unknown): LoginResult {
  const message = text(record(body).response_description) ?? text(record(body).message) ?? "";
  if (status === 429) return { ok: false, reason: "rate_limited", detail: message };
  if (/captcha|کپچا|robot/i.test(message)) return { ok: false, reason: "security_challenge", detail: message };
  if (status === 401 || status === 400) return { ok: false, reason: "invalid_credentials", detail: message };
  if (status === 403) {
    // 403 covers both "no such account" and "account needs action".
    return /register|حساب|account/i.test(message)
      ? { ok: false, reason: "invalid_credentials", detail: message }
      : { ok: false, reason: "account_action_required", detail: message };
  }
  if (status >= 500) return { ok: false, reason: "unavailable", detail: message };
  return { ok: false, reason: "provider_changed", detail: `auth ${status}` };
}

/** PURE: پاکتِ توکن را دقیقاً به همان شکلی می‌سازد که خودِ سایت در کوکی می‌گذارد. */
export function buildTokenEnvelope(payload: unknown, now: number): {
  envelope: string;
  expiresAt: Date | null;
  authorization: string;
} | null {
  const data = record(record(payload).data ?? payload);
  const tokenType = text(data.token_type) ?? "Bearer";
  const accessToken = text(data.access_token);
  if (!accessToken) return null;
  const expiresIn = Number(data.expires_in ?? 0);
  const envelope = {
    token_type: tokenType,
    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 0,
    access_token: accessToken,
    refresh_token: text(data.refresh_token) ?? "",
    created_at: now,
    token_user: "candidate",
    status: "active",
  };
  return {
    envelope: JSON.stringify(envelope),
    expiresAt: envelope.expires_in > 0 ? new Date(now + envelope.expires_in * 1000) : null,
    authorization: `${tokenType} ${accessToken}`,
  };
}

/** PURE: برچسبِ غیرِ محرمانه‌ی حساب از پاسخِ پروفایل. */
export function accountLabelFromProfile(payload: unknown): string | undefined {
  const data = record(record(payload).data ?? payload);
  const user = record(data.user ?? data);
  const name = [text(user.first_name), text(user.surname)].filter(Boolean).join(" ").trim();
  return name || text(user.email) || undefined;
}

export const irantalentLoginDriver: BoardLoginDriver = {
  board: "irantalent",

  async login(credential, fetchImpl: typeof fetch = fetch): Promise<LoginResult> {
    try {
      const response = await fetchImpl(`${API_ROOT}/auth/api-token`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          origin: SITE_ORIGIN,
          referer: `${SITE_ORIGIN}/`,
          "user-agent": USER_AGENT,
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "password",
          user_type: "candidate",
          username: credential.username,
          password: credential.password,
        }),
      });
      const raw = await response.text();
      let body: unknown = {};
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }
      if (!response.ok) return classifyAuthFailure(response.status, body);

      const token = buildTokenEnvelope(body, Date.now());
      if (!token) return { ok: false, reason: "provider_changed", detail: "no access_token in response" };

      // اعتبارسنجیِ واقعی: توکن باید پروفایلِ همین کاربر را باز کند.
      const profile = await fetchImpl(`${API_ROOT}/candidate/profile`, {
        headers: {
          accept: "application/json",
          authorization: token.authorization,
          "user-agent": USER_AGENT,
        },
      });
      if (profile.status === 401 || profile.status === 403) {
        return { ok: false, reason: "session_unavailable", detail: "token rejected by profile" };
      }
      if (!profile.ok) return { ok: false, reason: "unavailable", detail: `profile ${profile.status}` };
      const profileBody = await profile.json();
      if (typeof record(record(profileBody).data ?? profileBody).cv !== "object") {
        return { ok: false, reason: "account_action_required", detail: "no candidate cv on account" };
      }
      const label = accountLabelFromProfile(profileBody);

      return {
        ok: true,
        sessionShape: "cookie",
        session: JSON.stringify({
          cookies: [{
            name: AUTH_COOKIE,
            value: encodeURIComponent(token.envelope),
            domain: ".irantalent.com",
            path: "/",
            secure: true,
            ...(token.expiresAt
              ? { expirationDate: Math.floor(token.expiresAt.getTime() / 1000) }
              : {}),
          }],
          userAgent: USER_AGENT,
        }),
        expiresAt: token.expiresAt,
        ...(label ? { accountLabel: label } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        reason: "unavailable",
        detail: error instanceof Error ? error.message : "network error",
      };
    }
  },
};
