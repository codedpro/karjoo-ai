/**
 * JobVision flow tests — driven against a fake page, so no browser and no network.
 *
 * The guarantees under test are the ones that decide what the USER is told:
 *   • "submitted" only on a real confirmation (the /post-apply route or the site's
 *     own success text) — never inferred from the click landing.
 *   • A captcha is a STOP with its own reason, never something to click around.
 *   • No résumé on the account → skipped, NOT an upload of some other file.
 */
import { describe, expect, it, vi } from "vitest";

import type { BrowserLocator, BrowserPage } from "./browser.js";
import { isPostApplyUrl, runJobvisionApply } from "./jobvision-flow.js";

const LISTING = "https://jobvision.ir/jobs/123456/backend-developer";
const POST_APPLY = "https://jobvision.ir/jobs/123456/post-apply";

interface FakePageOptions {
  /** Page text over time — the last entry repeats once reached. */
  texts?: string[];
  /** Page URL over time — the last entry repeats once reached. */
  urls?: string[];
  /** Selectors that currently match something. */
  present?: Set<string>;
  /** Selectors whose click should throw. */
  clickThrows?: Set<string>;
  /** Called after each click, so a test can mutate the page. */
  onClick?: (selector: string, state: { tick: number }) => void;
}

function fakePage(options: FakePageOptions = {}) {
  const state = { tick: 0 };
  const clicks: string[] = [];
  const present = options.present ?? new Set<string>();

  const at = <T,>(list: T[] | undefined, fallback: T): T =>
    list && list.length > 0 ? (list[Math.min(state.tick, list.length - 1)] as T) : fallback;

  const locator = (selector: string): BrowserLocator =>
    ({
      count: async () => {
        // The body locator is how the flow reads page text; it always exists.
        if (selector === "body") return 1;
        return present.has(selector) ? 1 : 0;
      },
      textContent: async () => (selector === "body" ? at(options.texts, "") : null),
      click: async () => {
        if (options.clickThrows?.has(selector)) throw new Error("not clickable");
        clicks.push(selector);
        options.onClick?.(selector, state);
      },
      fill: async () => undefined,
      selectOption: async () => undefined,
      setInputFiles: async () => undefined,
      waitFor: async () => undefined,
    }) as unknown as BrowserLocator;

  const page: BrowserPage = {
    goto: async () => undefined,
    url: () => at(options.urls, LISTING),
    locator,
    screenshot: async () => Buffer.from(""),
  };

  // A sleep that advances the fake clock instead of actually waiting.
  const clock = { value: 0 };
  const deps = {
    sleep: async (ms: number) => {
      clock.value += ms;
      state.tick += 1;
    },
    now: () => clock.value,
    timeoutMs: 15_000,
    pollMs: 350,
  };

  return { page, deps, clicks, present, state };
}

describe("isPostApplyUrl", () => {
  it("only matches the confirmation route", () => {
    expect(isPostApplyUrl(POST_APPLY)).toBe(true);
    expect(isPostApplyUrl(`${POST_APPLY}/`)).toBe(true);
    expect(isPostApplyUrl(LISTING)).toBe(false);
    // A listing that merely mentions the word must not read as a confirmation.
    expect(isPostApplyUrl("https://jobvision.ir/jobs/1/post-apply-guide")).toBe(false);
  });
});

describe("runJobvisionApply", () => {
  it("clicks apply and confirms on the /post-apply route", async () => {
    const { page, deps, clicks } = fakePage({
      present: new Set([".jvt-btn-send-resume, button[class*='send-resume']"]),
      urls: [LISTING, POST_APPLY],
    });
    const outcome = await runJobvisionApply(page, deps);
    expect(outcome).toMatchObject({ status: "submitted", confirmed: true });
    expect(outcome.proof).toEqual({ provider: "jobvision", signal: "post_apply_path" });
    expect(clicks).toContain(".jvt-btn-send-resume, button[class*='send-resume']");
  });

  it("picks the profile résumé when the flow asks which one", async () => {
    const applySelector = ".jvt-btn-send-resume, button[class*='send-resume']";
    const choiceSelector = "button:visible:has-text('ارسال رزومه شخصی')";
    const present = new Set([applySelector, choiceSelector]);
    const { page, deps, clicks } = fakePage({
      present,
      texts: ["", "", "رزومه شما با موفقیت ارسال شد"],
      onClick: (selector) => {
        // Choosing the résumé dismisses the chooser.
        if (selector === choiceSelector) present.delete(choiceSelector);
      },
    });
    const outcome = await runJobvisionApply(page, deps);
    expect(clicks).toContain(choiceSelector);
    expect(outcome).toMatchObject({ status: "submitted", confirmed: true });
    expect(outcome.proof).toEqual({ provider: "jobvision", signal: "submitted_text" });
  });

  it("reports already-applied without clicking anything", async () => {
    const { page, deps, clicks } = fakePage({
      texts: ["رزومه شما برای این آگهی ارسال شده است"],
      present: new Set([".jvt-btn-send-resume, button[class*='send-resume']"]),
    });
    const outcome = await runJobvisionApply(page, deps);
    expect(outcome).toMatchObject({
      status: "submitted",
      confirmed: true,
      reason: "already_applied_on_board",
    });
    expect(clicks).toHaveLength(0);
  });

  it("stops on a captcha instead of clicking around it", async () => {
    const { page, deps, clicks } = fakePage({ texts: ["لطفاً تأیید کنید انسان هستید"] });
    const outcome = await runJobvisionApply(page, deps);
    expect(outcome).toMatchObject({ status: "failed", reason: "jobvision_captcha_required" });
    expect(clicks).toHaveLength(0);
  });

  it("reports login_required when the page offers sign-in instead of apply", async () => {
    const { page, deps } = fakePage({
      present: new Set(["button:visible:has-text('ورود'), button:visible:has-text('ثبت نام')"]),
    });
    const outcome = await runJobvisionApply(page, deps);
    expect(outcome).toMatchObject({ status: "failed", reason: "jobvision_login_required" });
  });

  it("skips (not fails) a listing with no on-site apply button", async () => {
    const { page, deps } = fakePage();
    const outcome = await runJobvisionApply(page, deps);
    expect(outcome).toMatchObject({ status: "skipped", reason: "jobvision_apply_button_missing" });
  });

  it("skips when the account has no résumé — never uploads a substitute", async () => {
    const { page, deps } = fakePage({
      present: new Set([
        ".jvt-btn-send-resume, button[class*='send-resume']",
        "input[type='file']",
      ]),
    });
    const outcome = await runJobvisionApply(page, deps);
    expect(outcome).toMatchObject({
      status: "skipped",
      reason: "jobvision_resume_setup_required",
    });
  });

  it("never claims 'submitted' when nothing confirmed", async () => {
    const { page, deps } = fakePage({
      present: new Set([".jvt-btn-send-resume, button[class*='send-resume']"]),
      texts: ["در حال پردازش"],
    });
    const outcome = await runJobvisionApply(page, deps);
    expect(outcome).toMatchObject({
      status: "failed",
      confirmed: false,
      reason: "jobvision_apply_unconfirmed",
    });
  });

  it("reports a failed apply click rather than throwing", async () => {
    const applySelector = ".jvt-btn-send-resume, button[class*='send-resume']";
    const { page, deps } = fakePage({
      present: new Set([applySelector]),
      clickThrows: new Set([applySelector]),
    });
    const outcome = await runJobvisionApply(page, deps);
    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("jobvision_apply_click_failed");
  });

  it("survives a page whose text cannot be read", async () => {
    const page = {
      goto: async () => undefined,
      url: () => LISTING,
      locator: () =>
        ({
          count: async () => {
            throw new Error("detached");
          },
          textContent: async () => {
            throw new Error("detached");
          },
        }) as unknown as BrowserLocator,
      screenshot: async () => Buffer.from(""),
    } as unknown as BrowserPage;

    const outcome = await runJobvisionApply(page, { sleep: vi.fn(async () => undefined) });
    expect(outcome.status).toBe("skipped");
  });
});
