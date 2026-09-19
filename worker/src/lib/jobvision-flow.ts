/**
 * JOBVISION apply flow — the one board whose apply is genuinely a browser flow.
 *
 * Jobinja renders a plain form, so APPLY_SPEC (fill these selectors, click submit)
 * describes it completely. Karboom, IranTalent and e-estekhdam are HTTP
 * transactions, so they run on the control plane with no browser at all. JobVision
 * is neither: it is an Angular SPA where "ارسال رزومه" opens a client-rendered
 * flow, the confirmation is a route change (`/post-apply`) or a rendered message,
 * and the résumé is the one already on the user's JobVision profile. There is no
 * form to fill and no endpoint to POST — only the page's own buttons. So it gets a
 * flow of its own instead of a spec.
 *
 * MIRRORS extension/src/content/apply/jobvision.ts, which runs the same sequence
 * in the user's own browser. Same clicks, same confirmation signals, same refusals.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 — the user's OWN session, replayed faithfully, driving the site's OWN
 * buttons. Nothing here defeats bot-detection: a captcha or a security check is a
 * STOP with a clear reason, never something to work around. The flow only ever
 * sends the résumé JobVision already holds for this user — it never uploads a
 * different one and never fabricates profile data.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { BrowserPage } from "./browser.js";

/** The site's own "send résumé" control (class name, with a defensive fallback). */
const APPLY_SELECTOR = ".jvt-btn-send-resume, button[class*='send-resume']";
/** Inside the flow, JobVision asks WHICH résumé; this is "my own résumé". */
const PERSONAL_RESUME_SELECTOR = "button:visible:has-text('ارسال رزومه شخصی')";
/** A sign-in prompt instead of an apply button means the session did not take. */
const LOGIN_SELECTOR = "button:visible:has-text('ورود'), button:visible:has-text('ثبت نام')";
/** An upload control means the account has no résumé for us to send. */
const FILE_INPUT_SELECTOR = "input[type='file']";

const CONFIRM_TEXT = /رزومه.{0,20}(?:ارسال شد|ارسال شده|با موفقیت ارسال)/;
const ALREADY_APPLIED_TEXT = /رزومه.{0,20}(?:ارسال شد|ارسال شده)/;
const CHALLENGE_TEXT = /captcha|کپچا|من ربات نیستم|بررسی امنیتی|تأیید کنید انسان/i;

/** Matches the confirmation ROUTE the SPA navigates to after a successful send. */
const POST_APPLY_PATH = /\/post-apply(?:\/|$)/;

/** The flow's result, in the processor's vocabulary. */
export interface JobvisionOutcome {
  status: "submitted" | "skipped" | "failed";
  confirmed: boolean;
  reason?: string;
  proof?: Record<string, unknown>;
}

/** Injectable clock so tests do not actually wait. */
export interface JobvisionFlowOptions {
  /** How long to wait for the SPA to confirm (default 15s). */
  timeoutMs?: number;
  /** Poll interval while waiting (default 350ms). */
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** PURE: does this page URL mean JobVision already accepted the application? */
export function isPostApplyUrl(url: string): boolean {
  try {
    return POST_APPLY_PATH.test(new URL(url).pathname);
  } catch {
    // A relative/garbled URL still carries the segment when it is there.
    return POST_APPLY_PATH.test(url);
  }
}

/** Read the page's visible text, normalized. Never throws — absence reads as "". */
async function pageText(page: BrowserPage): Promise<string> {
  try {
    const body = page.locator("body");
    if (typeof body.textContent !== "function") return "";
    const text = await body.textContent({ timeout: 5_000 });
    return (text ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** Is at least one element matching this selector present? Never throws. */
async function present(page: BrowserPage, selector: string): Promise<boolean> {
  try {
    return (await page.locator(selector).count()) > 0;
  } catch {
    return false;
  }
}

/**
 * Wait for JobVision to say what happened, clicking the "my own résumé" choice if
 * the flow asks for it. Returns as soon as a terminal signal appears.
 */
async function waitForOutcome(
  page: BrowserPage,
  options: Required<Pick<JobvisionFlowOptions, "timeoutMs" | "pollMs" | "sleep" | "now">>,
): Promise<JobvisionOutcome> {
  const { timeoutMs, pollMs, sleep, now } = options;
  const deadline = now() + timeoutMs;

  while (now() < deadline) {
    if (isPostApplyUrl(page.url())) {
      return {
        status: "submitted",
        confirmed: true,
        proof: { provider: "jobvision", signal: "post_apply_path" },
      };
    }

    const text = await pageText(page);
    if (CONFIRM_TEXT.test(text)) {
      return {
        status: "submitted",
        confirmed: true,
        proof: { provider: "jobvision", signal: "submitted_text" },
      };
    }
    // A challenge is a full stop. We do not solve it and we do not retry around it.
    if (CHALLENGE_TEXT.test(text)) {
      return { status: "failed", confirmed: false, reason: "jobvision_captcha_required" };
    }

    // The flow asks which résumé to send; "ارسال رزومه شخصی" is the profile one.
    const personalResume = await present(page, PERSONAL_RESUME_SELECTOR);
    if (personalResume) {
      try {
        await page.locator(PERSONAL_RESUME_SELECTOR).click({ timeout: 5_000 });
      } catch {
        // The button can vanish between the check and the click as the SPA
        // re-renders; the next loop re-reads the page rather than failing here.
      }
      await sleep(800);
      continue;
    }

    // An upload box with no résumé choice means this account has no résumé on file.
    // We do NOT upload one: JobVision applications carry the profile résumé, and
    // substituting a file the user did not put there misrepresents the application.
    if (await present(page, FILE_INPUT_SELECTOR)) {
      return { status: "skipped", confirmed: false, reason: "jobvision_resume_setup_required" };
    }

    await sleep(pollMs);
  }

  // Nothing broke, but nothing confirmed either. Reporting "submitted" here would
  // tell the user their résumé went out when we do not know that.
  return { status: "failed", confirmed: false, reason: "jobvision_apply_unconfirmed" };
}

/**
 * Run the JobVision apply on a page already navigated to the listing with the
 * user's session injected. Never throws — every failure is a reported outcome.
 */
export async function runJobvisionApply(
  page: BrowserPage,
  options: JobvisionFlowOptions = {},
): Promise<JobvisionOutcome> {
  const resolved = {
    timeoutMs: options.timeoutMs ?? 15_000,
    pollMs: options.pollMs ?? 350,
    sleep: options.sleep ?? defaultSleep,
    now: options.now ?? Date.now,
  };

  const text = await pageText(page);
  if (CHALLENGE_TEXT.test(text)) {
    return { status: "failed", confirmed: false, reason: "jobvision_captcha_required" };
  }

  // Already applied — treat as success so the queue stops retrying a done job.
  if (ALREADY_APPLIED_TEXT.test(text)) {
    return {
      status: "submitted",
      confirmed: true,
      reason: "already_applied_on_board",
      proof: { provider: "jobvision", signal: "already_applied_text" },
    };
  }
  if (isPostApplyUrl(page.url())) {
    return {
      status: "submitted",
      confirmed: true,
      reason: "already_applied_on_board",
      proof: { provider: "jobvision", signal: "post_apply_path" },
    };
  }

  if (!(await present(page, APPLY_SELECTOR))) {
    // A sign-in prompt means the replayed session was not accepted.
    if (await present(page, LOGIN_SELECTOR)) {
      return { status: "failed", confirmed: false, reason: "jobvision_login_required" };
    }
    // Otherwise this listing simply has no on-site apply (external/email ad).
    return { status: "skipped", confirmed: false, reason: "jobvision_apply_button_missing" };
  }

  try {
    await page.locator(APPLY_SELECTOR).click({ timeout: 10_000 });
  } catch (err) {
    return {
      status: "failed",
      confirmed: false,
      reason: `jobvision_apply_click_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return waitForOutcome(page, resolved);
}
