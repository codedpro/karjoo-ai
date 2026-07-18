/**
 * Processor tests — the per-job apply flow with the browser MOCKED.
 *
 * Covers:
 *   • happy path: session injected (cookies + init script + UA), plan ran (the
 *     cover letter was filled), confirm detected → 'submitted' + non-secret proof;
 *   • the session is ALWAYS discarded (context + browser closed) — even on failure;
 *   • §10 scaffold guardrail: scaffold boards are NOT auto-submitted → 'skipped';
 *   • unsupported board → 'skipped'; unparseable session → 'failed';
 *   • a missing required selector → 'failed';
 *   • the decrypted session is NEVER logged (the §10 invariant at the processor).
 */
import { describe, expect, it, vi } from "vitest";

import { processJob, runPlan } from "./processor.js";
import { buildApplyPlan } from "./apply-plan.js";
import { Logger, type LogLevel } from "./logger.js";
import { makeFakeBrowser } from "../test/fake-browser.js";
import type { FleetJob } from "./types.js";

const LISTING = "https://jobinja.ir/companies/acme/jobs/AB12cd";

/** A jobinja job with a realistic (secret-bearing) session bundle. */
function jobinjaJob(over: Partial<FleetJob> = {}): FleetJob {
  const session = JSON.stringify({
    cookies: [{ name: "JOBINJA_SESSION", value: "COOKIE-SECRET-DEADBEEF", domain: ".jobinja.ir" }],
    localStorage: { pref: "fa" },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) KarjooUserUA",
  });
  return {
    taskId: "task-1",
    userId: "user-1",
    board: "jobinja",
    listingUrl: LISTING,
    coverLetter: "با سلام، من برای این موقعیت مناسبم.",
    session,
    ...over,
  };
}

function captureLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: new Logger({ write: (_l: LogLevel, line: string) => void lines.push(line) }, () => "T"),
  };
}

function baseOpts(launcher: ReturnType<typeof makeFakeBrowser>["launcher"], logger?: Logger) {
  return {
    launchBrowser: launcher,
    headless: true,
    executablePath: null,
    stepTimeoutMs: 5000,
    captureScreenshot: true,
    ...(logger ? { logger } : {}),
  };
}

describe("processJob — happy path (jobinja best-effort)", () => {
  it("injects the session, chooses the résumé, submits, and returns proof", async () => {
    const { launcher, record } = makeFakeBrowser({ finalUrl: `${LISTING}?applied=1` });
    const report = await processJob(jobinjaJob(), baseOpts(launcher));

    expect(report.status).toBe("submitted");
    expect(report.taskId).toBe("task-1");
    expect(report.userId).toBe("user-1");

    // Session injected: the user's cookie + UA + storage init script.
    expect(record.cookies).toHaveLength(1);
    expect(record.cookies[0]!.name).toBe("JOBINJA_SESSION");
    expect(record.contextOptions[0]!.userAgent).toBe("Mozilla/5.0 (X11; Linux x86_64) KarjooUserUA");
    expect(record.initScripts.length).toBe(1);

    // Navigated to the listing.
    expect(record.navigations).toContain(LISTING);

    // jobinja has NO cover-letter field; the flow chooses the Jobinja profile résumé.
    const choseResume = record.actions.some((a) => a.kind === "click" && a.selector.includes("apply_choice_jobinja_profile"));
    expect(choseResume).toBe(true);
    // No cover-letter text was filled (the only fill is an optional phone, absent here).
    expect(record.actions.some((a) => a.kind === "fill")).toBe(false);

    // Proof is non-secret: a final URL + confirmation flag + screenshot SIZE only.
    expect(report.proof?.finalUrl).toBe(`${LISTING}?applied=1`);
    expect(report.proof?.confirmed).toBe(true);
    expect(typeof report.proof?.screenshotBytes).toBe("number");
    // Proof never contains the cookie value.
    expect(JSON.stringify(report.proof)).not.toContain("COOKIE-SECRET-DEADBEEF");

    // Session ALWAYS discarded.
    expect(record.contextClosed).toBe(1);
    expect(record.browserClosed).toBe(1);
  });
});

describe("processJob — §10 scaffold guardrail", () => {
  it("does NOT launch a browser or submit on a scaffold board; records 'skipped'", async () => {
    const { launcher, record } = makeFakeBrowser();
    const report = await processJob(
      jobinjaJob({ board: "jobvision", listingUrl: "https://jobvision.ir/jobs/123" }),
      baseOpts(launcher),
    );
    expect(report.status).toBe("skipped");
    expect(report.reason).toContain("scaffold");
    // No browser launched — we refuse to blind-submit on an unverified form.
    expect(record.launched).toBe(0);
  });
});

describe("processJob — skip / fail branches", () => {
  it("skips an unsupported board", async () => {
    const { launcher } = makeFakeBrowser();
    const report = await processJob(jobinjaJob({ board: "monster" }), baseOpts(launcher));
    expect(report.status).toBe("skipped");
    expect(report.reason).toContain("no apply-spec");
  });

  it("fails (and closes the browser) when a required selector is missing", async () => {
    // Make the apply button absent → the first click step fails.
    const { launcher, record } = makeFakeBrowser({
      selectors: {
        "#apply-form input[type='submit'], #apply-form button[type='submit']": { count: 0 },
      },
    });
    const report = await processJob(jobinjaJob(), baseOpts(launcher));
    expect(report.status).toBe("failed");
    expect(report.reason).toContain("selector not found");
    // Even on failure the session is discarded.
    expect(record.contextClosed).toBe(1);
    expect(record.browserClosed).toBe(1);
  });

  it("fails on an unparseable session without launching a browser", async () => {
    const { launcher, record } = makeFakeBrowser();
    const report = await processJob(jobinjaJob({ session: "not-json{" }), baseOpts(launcher));
    expect(report.status).toBe("failed");
    expect(report.reason).toContain("unparseable");
    expect(record.launched).toBe(0);
  });

  it("never throws — a browser launch error becomes a 'failed' report", async () => {
    const launcher = vi.fn(async () => {
      throw new Error("no chromium");
    });
    const report = await processJob(jobinjaJob(), baseOpts(launcher));
    expect(report.status).toBe("failed");
    expect(report.reason).toContain("no chromium");
  });
});

describe("processJob — §10 session is NEVER logged", () => {
  it("emits no log line containing the cookie/UA/storage secret", async () => {
    const { launcher } = makeFakeBrowser();
    const { lines, logger } = captureLogger();
    await processJob(jobinjaJob(), baseOpts(launcher, logger));

    const all = lines.join("\n");
    expect(all).not.toContain("COOKIE-SECRET-DEADBEEF");
    expect(all).not.toContain("KarjooUserUA");
    expect(all).not.toContain("JOBINJA_SESSION");
    // It still logs the non-secret taskId/board.
    expect(all).toContain("task-1");
  });
});

describe("runPlan — confirm handling", () => {
  it("reports confirmed:false when the success selector is absent", async () => {
    const { launcher } = makeFakeBrowser({
      selectors: { ".js-flashMessageMsg, .c-flashMessage__message": { count: 0 } },
    });
    const browser = await launcher({ headless: true, executablePath: null });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const plan = buildApplyPlan(jobinjaJob())!;
    const outcome = await runPlan(page, plan, 5000);
    expect(outcome.status).toBe("submitted");
    expect(outcome.confirmed).toBe(false);
  });
});
