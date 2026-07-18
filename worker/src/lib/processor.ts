/**
 * Job processor — the heart of the worker. For ONE claimed job it:
 *   1. parses the user's decrypted session bundle (in memory),
 *   2. opens an isolated Playwright context with the user's OWN UA,
 *   3. injects the user's cookies + localStorage/sessionStorage (faithful replay),
 *   4. navigates to the listing,
 *   5. runs the APPLY_SPEC plan (fill + submit) on best-effort boards; on SCAFFOLD
 *      boards it does NOT blind-submit — it records 'skipped' (TODO(real-account)),
 *   6. captures NON-SECRET proof (final URL + confirmation flag),
 *   7. ALWAYS closes the context and discards the session.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * §10 GUARDRAILS enforced here:
 *   • NO detection-evasion — the user's own session/UA, replayed faithfully.
 *   • Scaffold boards (jobvision/e-estekhdam/irantalent) are NOT auto-submitted —
 *     their authenticated form is unverified (TODO(real-account)); we skip rather
 *     than risk a wrong submit on the user's real account.
 *   • The session is in-memory only: parsed here, injected, then the context is
 *     closed in a finally. The session string is NEVER logged or persisted.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The browser is injected (BrowserLauncher) so this is fully unit-tested with a
 * fake browser — no real Chromium, no network.
 */
import type { Browser, BrowserContext, BrowserLauncher, BrowserPage } from "./browser.js";
import { buildApplyPlan, type ApplyPlan } from "./apply-plan.js";
import { prepareSession } from "./session-inject.js";
import { parseSessionBundle } from "./session-inject.js";
import type { FleetJob, FleetResultReport } from "./types.js";
import { Logger, logger as defaultLogger } from "./logger.js";

/** Options for processing one job. */
export interface ProcessOptions {
  launchBrowser: BrowserLauncher;
  headless: boolean;
  executablePath: string | null;
  stepTimeoutMs: number;
  logger?: Logger;
  /** Capture a screenshot as proof (default true; disabled in tests). */
  captureScreenshot?: boolean;
}

/**
 * Process a single job and return the result report (NEVER throws — any failure is
 * mapped to a 'failed' report so the caller can record it). The session is
 * discarded before returning.
 */
export async function processJob(
  job: FleetJob,
  opts: ProcessOptions,
): Promise<FleetResultReport> {
  const log = opts.logger ?? defaultLogger;

  // Build the plan FIRST (no browser needed) — an unsupported board is skipped.
  const plan = buildApplyPlan(job);
  if (!plan) {
    log.warn("no apply-spec for board; skipping", { board: job.board, taskId: job.taskId });
    return {
      taskId: job.taskId,
      userId: job.userId,
      status: "skipped",
      reason: `no apply-spec for board '${job.board}'`,
    };
  }

  // §10: scaffold boards are NOT auto-submitted (unverified authenticated form).
  if (plan.maturity === "scaffold") {
    log.info("scaffold board — recording skip (TODO real-account)", {
      board: job.board,
      taskId: job.taskId,
    });
    return {
      taskId: job.taskId,
      userId: job.userId,
      status: "skipped",
      reason: `board '${job.board}' apply-spec is scaffold (TODO(real-account)); not auto-submitting`,
    };
  }

  // Parse the session in memory. We log NOTHING about its contents.
  let prepared: ReturnType<typeof prepareSession>;
  try {
    const bundle = parseSessionBundle(job.session);
    prepared = prepareSession(bundle, job.listingUrl);
  } catch {
    log.warn("session bundle unparseable; failing job", { taskId: job.taskId });
    return {
      taskId: job.taskId,
      userId: job.userId,
      status: "failed",
      reason: "session bundle unparseable",
    };
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await opts.launchBrowser({
      headless: opts.headless,
      executablePath: opts.executablePath,
    });
    context = await browser.newContext(
      prepared.userAgent ? { userAgent: prepared.userAgent } : {},
    );

    if (prepared.cookies.length > 0) {
      await context.addCookies(prepared.cookies);
    }
    if (prepared.initScript) {
      await context.addInitScript(prepared.initScript);
    }

    const page = await context.newPage();
    await page.goto(job.listingUrl, { timeout: opts.stepTimeoutMs, waitUntil: "domcontentloaded" });

    const outcome = await runPlan(page, plan, opts.stepTimeoutMs);

    const proof: Record<string, unknown> = {
      finalUrl: page.url(),
      confirmed: outcome.confirmed,
      board: job.board,
    };
    if (opts.captureScreenshot !== false) {
      try {
        const shot = await page.screenshot({ type: "png" });
        // Proof carries only a SIZE descriptor, never the image bytes over our log.
        proof.screenshotBytes = shot.byteLength ?? (shot as Uint8Array).length;
      } catch {
        // Screenshot is best-effort; absence does not fail the job.
      }
    }

    if (outcome.status === "submitted") {
      log.info("job submitted", { taskId: job.taskId, board: job.board });
    } else {
      log.warn("job not submitted", { taskId: job.taskId, board: job.board, reason: outcome.reason });
    }

    return {
      taskId: job.taskId,
      userId: job.userId,
      status: outcome.status,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      proof,
    };
  } catch (err) {
    log.error("job processing error", { taskId: job.taskId, error: errMessage(err) });
    return {
      taskId: job.taskId,
      userId: job.userId,
      status: "failed",
      reason: errMessage(err),
    };
  } finally {
    // ALWAYS discard the session: close the context + browser. `prepared` (which
    // holds the cookies/UA) goes out of scope and is GC'd with the function frame.
    try {
      if (context) await context.close();
    } catch {
      /* ignore */
    }
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
  }
}

/** The result of executing a plan against a page. */
interface PlanOutcome {
  status: "submitted" | "failed";
  confirmed: boolean;
  reason?: string;
}

/**
 * Execute an APPLY_SPEC plan step-by-step. Returns 'submitted' when the flow ran
 * to completion (and, if a confirm selector exists, it appeared). A missing
 * REQUIRED selector or a thrown step fails the job.
 */
export async function runPlan(
  page: BrowserPage,
  plan: ApplyPlan,
  stepTimeoutMs: number,
): Promise<PlanOutcome> {
  for (const step of plan.steps) {
    const locator = page.locator(step.selector);

    if (step.kind === "waitFor") {
      try {
        await locator.waitFor({ timeout: stepTimeoutMs, state: "attached" });
      } catch {
        if (step.optional) continue;
        return { status: "failed", confirmed: false, reason: `waitFor missing: ${step.selector}` };
      }
      continue;
    }

    // For click/fill/select/upload: ensure the element exists.
    const count = await locator.count();
    if (count === 0) {
      if (step.optional) continue;
      return { status: "failed", confirmed: false, reason: `selector not found: ${step.selector}` };
    }

    try {
      switch (step.kind) {
        case "click":
          await locator.click({ timeout: stepTimeoutMs });
          break;
        case "fill":
          if (step.value === undefined) {
            return { status: "failed", confirmed: false, reason: `no value for required fill: ${step.selector}` };
          }
          await locator.fill(step.value, { timeout: stepTimeoutMs });
          break;
        case "select":
          if (step.value === undefined) {
            return { status: "failed", confirmed: false, reason: `no value for select: ${step.selector}` };
          }
          await locator.selectOption(step.value, { timeout: stepTimeoutMs });
          break;
        case "upload":
          if (step.value === undefined) {
            if (step.optional) continue;
            return { status: "failed", confirmed: false, reason: `no file for upload: ${step.selector}` };
          }
          await locator.setInputFiles(step.value, { timeout: stepTimeoutMs });
          break;
      }
    } catch (err) {
      // An OPTIONAL step whose action can't fire (e.g. a control that is present but
      // hidden on this viewport — the mobile-only form toggler on desktop) is skipped,
      // not fatal. Required steps still fail the job.
      if (step.optional) continue;
      return { status: "failed", confirmed: false, reason: `step '${step.kind}' failed: ${errMessage(err)}` };
    }
  }

  // Confirm the result when the spec declares a success selector.
  let confirmed = true;
  if (plan.confirmSelector) {
    const confirmLoc = page.locator(plan.confirmSelector);
    confirmed = (await confirmLoc.count()) > 0;
  }

  return { status: "submitted", confirmed };
}

/** Extract a short message from an unknown error (never includes the session). */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
