import "server-only";

/**
 * ارسالِ پیامکِ OTP (server-only) — env-driven با fallbackِ توسعه.
 *
 * فلسفه (بخش CONTEXT، قاعده‌ی ۶): اپ باید بدون هیچ credentialِ واقعیِ SMS بوت و کار
 * کند. پس اگر هیچ providerی پیکربندی نشده باشد، این تابع کد را در کنسول لاگ می‌کند
 * (حالتِ توسعه) و یک نشانه‌ی typed `dev_mode` برمی‌گرداند — هرگز throw نمی‌کند.
 *
 * هنگام پیکربندی، Kavenegar (ارائه‌دهنده‌ی ایرانی، با verify-lookup) ترجیح دارد؛
 * در نبودش از providerِ عمومی (SMS_API_KEY/SMS_SENDER) استفاده می‌شود. fetch قابلِ
 * تزریق است تا تست بدونِ شبکه باشد.
 */
import { getSmsConfig, type SmsConfig } from "@/lib/env";

/** نتیجه‌ی typed ارسالِ OTP — همیشه `ok` دارد و هرگز throw نمی‌شود. */
export type SendOtpResult =
  | { ok: true; mode: "sent"; provider: SmsConfig["provider"] }
  | { ok: true; mode: "dev_mode" } // هیچ providerی نبود → کد در کنسول لاگ شد
  | { ok: false; mode: "error"; provider: SmsConfig["provider"]; error: string };

/** آپشن‌های قابل‌تزریق (تست). */
export interface SendOtpOptions {
  /** override fetch (تست/شبکه‌ی شبیه‌سازی‌شده). پیش‌فرض: fetch سراسری. */
  fetchImpl?: typeof fetch;
  /** override پیکربندیِ SMS (تست). پیش‌فرض: getSmsConfig() از env. */
  config?: SmsConfig | null;
  /** override لاگر (تست). پیش‌فرض: console.log. */
  logger?: (message: string) => void;
}

const KAVENEGAR_BASE = "https://api.kavenegar.com/v1";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * یک کدِ OTP را به شماره‌ی داده‌شده می‌فرستد. هرگز throw نمی‌کند:
 *   • providerِ پیکربندی‌شده موفق → `{ ok: true, mode: "sent" }`
 *   • هیچ providerی نبود → کد را لاگ می‌کند → `{ ok: true, mode: "dev_mode" }`
 *   • providerِ پیکربندی‌شده شکست خورد → `{ ok: false, mode: "error" }`
 */
export async function sendOtpSms(
  phone: string,
  code: string,
  opts: SendOtpOptions = {},
): Promise<SendOtpResult> {
  const config = opts.config !== undefined ? opts.config : getSmsConfig();
  const log = opts.logger ?? ((m: string) => console.log(m));

  // ── حالتِ توسعه: هیچ providerی پیکربندی نشده ─────────────────────────────
  if (!config) {
    log(`[sms:dev] OTP برای ${phone}: ${code} (هیچ providerِ SMS پیکربندی نشده — ارسال نشد)`);
    return { ok: true, mode: "dev_mode" };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;

  try {
    if (config.provider === "kavenegar") {
      await sendViaKavenegar(fetchImpl, config, phone, code);
    } else {
      await sendViaGeneric(fetchImpl, config, phone, code);
    }
    return { ok: true, mode: "sent", provider: config.provider };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // لاگِ سرور برای دیباگ؛ پیامِ خام به فراخواننده برنمی‌گردد جز در فیلدِ error.
    console.error(`[sms] ارسال OTP با ${config.provider} شکست خورد:`, error);
    return { ok: false, mode: "error", provider: config.provider, error };
  }
}

/* ──────────────────────────────  Kavenegar  ─────────────────────────────── */

async function sendViaKavenegar(
  fetchImpl: typeof fetch,
  config: Extract<SmsConfig, { provider: "kavenegar" }>,
  phone: string,
  code: string,
): Promise<void> {
  // اگر template ست باشد از verify-lookup استفاده می‌کنیم (روشِ توصیه‌شده‌ی OTP)؛
  // وگرنه از ارسالِ ساده (sms/send). شماره به قالبِ محلیِ موردِ انتظارِ Kavenegar نرمال می‌شود.
  const receptor = toLocalIranPhone(phone);
  const url = config.template
    ? `${KAVENEGAR_BASE}/${config.apiKey}/verify/lookup.json?` +
      new URLSearchParams({ receptor, token: code, template: config.template }).toString()
    : `${KAVENEGAR_BASE}/${config.apiKey}/sms/send.json?` +
      new URLSearchParams({ receptor, message: `کد ورود کارجو: ${code}` }).toString();

  await postWithTimeout(fetchImpl, url);
}

/* ───────────────────────────────  عمومی  ───────────────────────────────── */

async function sendViaGeneric(
  fetchImpl: typeof fetch,
  config: Extract<SmsConfig, { provider: "generic" }>,
  phone: string,
  code: string,
): Promise<void> {
  // قراردادِ providerِ عمومی عمداً ساده است (POST JSON با Bearer). آداپتورِ واقعیِ
  // SMS.ir/… در لایه‌ی بالاتر قابلِ جایگزینی است؛ این یک پیاده‌سازیِ پیش‌فرضِ معقول است.
  const res = await withTimeout((signal) =>
    fetchImpl("https://sms-provider.invalid/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        to: phone,
        ...(config.sender ? { from: config.sender } : {}),
        text: `کد ورود کارجو: ${code}`,
      }),
      signal,
    }),
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

/* ───────────────────────────────  کمک‌ها  ──────────────────────────────── */

/** درخواستِ GET با مهلت (Kavenegar از GET استفاده می‌کند). خطا روی !ok. */
async function postWithTimeout(fetchImpl: typeof fetch, url: string): Promise<void> {
  const res = await withTimeout((signal) =>
    fetchImpl(url, { method: "GET", signal }),
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
}

/** اجرای یک fetch با AbortController و مهلتِ ثابت. */
async function withTimeout(run: (signal: AbortSignal) => Promise<Response>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * شماره را به قالبِ محلیِ ایران (`09xxxxxxxxx`) نرمال می‌کند — قالبی که Kavenegar
 * انتظار دارد. ورودی‌های `+98…` و `0098…` و `9xxxxxxxxx` پشتیبانی می‌شوند.
 */
export function toLocalIranPhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("0098")) return "0" + digits.slice(4);
  if (digits.startsWith("98") && digits.length === 12) return "0" + digits.slice(2);
  if (digits.startsWith("0")) return digits;
  if (digits.length === 10 && digits.startsWith("9")) return "0" + digits;
  return digits;
}
