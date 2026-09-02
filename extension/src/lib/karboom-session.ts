/**
 * Karboom authenticated identity probe (background side).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LEGITIMACY (§10 / RULE 1): این ماژول هیچ کوکی‌ای را نمی‌خواند، لاگ نمی‌کند و
 * جایی نمی‌فرستد. کاربوم سمتِ سرور رندر می‌شود، پس تنها کارِ لازم این است که
 * صفحه‌ی پروفایلِ خودِ کاربر را با کوکی‌های خودِ مرورگر بخواهیم و ببینیم سایت او را
 * می‌شناسد یا به صفحه‌ی ورود می‌فرستد. خروجی فقط یک بولین و یک نامِ نمایشیِ
 * غیرمحرمانه است.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { ProbeSessionResult } from "@ext/lib/messages";

const ORIGIN = "https://karboom.io";
/** صفحه‌ای که فقط برای کاربرِ واردشده رندر می‌شود (تأییدشده‌ی زنده). */
const PROFILE_PATH = "/profile";

/**
 * PURE: پاسخِ کاربوم به `/profile` → آیا کاربر واقعاً وارد شده است؟
 *
 * کاربوم برای مهمان‌ها ۳۰۲ به `/account?_back=…` می‌زند و برای کاربرِ واردشده صفحه
 * را ۲۰۰ می‌دهد. همین تغییرِ مسیر، سیگنالِ قطعی است — برخلافِ حدس زدن از روی
 * HTML، که یک‌بار با کوکیِ `JSESSID` جابینجا به «ورودِ» کاذب انجامید.
 */
export function karboomLoggedInFromResponse(status: number, location: string | null): boolean {
  if (status >= 300 && status < 400) {
    // هر تغییرِ مسیری به صفحه‌ی حساب/ورود یعنی نشست نیست.
    return !/\/(account|auth\/(signin|signup|login))\b/.test(location ?? "");
  }
  return status >= 200 && status < 300;
}

/** PURE: نامِ نمایشیِ غیرمحرمانه از صفحه‌ی پروفایل، اگر پیدا شد. */
export function karboomAccountLabel(html: string): string | undefined {
  const match =
    /class="[^"]*\b(?:user-name|js-user-name|profile-name|user-full-name)\b[^"]*"[^>]*>\s*([^<]{2,60})/
      .exec(html);
  return match?.[1]?.replace(/\s+/g, " ").trim() || undefined;
}

export async function probeKarboomIdentity(
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeSessionResult> {
  try {
    const response = await fetchImpl(`${ORIGIN}${PROFILE_PATH}`, {
      credentials: "include",
      // دستی، تا خودِ ۳۰۲ را ببینیم؛ دنبال‌کردنِ آن، «ورود» و «صفحه‌ی حساب» را
      // هر دو ۲۰۰ نشان می‌داد و تفکیک‌ناپذیر می‌کرد.
      redirect: "manual",
      headers: { accept: "text/html" },
    });
    if (response.status === 429) return { loggedIn: false, reason: "security_challenge" };
    if (!karboomLoggedInFromResponse(response.status, response.headers.get("location"))) {
      return { loggedIn: false, reason: "logged_out" };
    }
    if (response.status < 200 || response.status >= 300) return { loggedIn: true };
    const label = karboomAccountLabel(await response.text());
    return label ? { loggedIn: true, accountLabelHint: label } : { loggedIn: true };
  } catch {
    return { loggedIn: false, reason: "probe_unavailable" };
  }
}
