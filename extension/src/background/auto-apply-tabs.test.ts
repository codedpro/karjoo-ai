import { describe, expect, it } from "vitest";

import {
  discoveryIsDue,
  isSessionLevelReason,
  isSkippableReason,
  shouldCloseManagedTab,
  SESSION_FAILURE_STREAK_LIMIT,
  BOARD_FAILURE_STREAK_LIMIT,
  RESUME_FAILURE_STREAK_LIMIT,
} from "@ext/background/auto-apply";

describe("discovery after filter changes", () => {
  it("forces fresh discovery even when the previous queue was deep", () => {
    expect(discoveryIsDue({
      force: true,
      queueCount: 6_000,
      lastDiscoveryAt: Date.now(),
    })).toBe(true);
  });

  it("still protects ordinary ticks from rediscovering into a deep queue", () => {
    expect(discoveryIsDue({
      force: false,
      queueCount: 6_000,
      lastDiscoveryAt: 0,
    })).toBe(false);
  });
});

describe("managed apply-tab lifecycle", () => {
  it("closes a tab created by the extension after a normal apply or failure", () => {
    expect(shouldCloseManagedTab(true, false)).toBe(true);
  });

  it("keeps the single intervention tab when login or a security check is required", () => {
    expect(shouldCloseManagedTab(true, true)).toBe(false);
  });

  it("never closes a tab that was already open before the run", () => {
    expect(shouldCloseManagedTab(false, false)).toBe(false);
    expect(shouldCloseManagedTab(false, true)).toBe(false);
  });
});

describe("non-automatable job outcomes", () => {
  it.each([
    "jobinja_login_required: sign in",
    "jobinja_security_check: challenge",
    "jobvision_captcha_required",
    "eestekhdam_form_unavailable",
    "eestekhdam_external_form_required",
    "irantalent_account_unverified",
    "irantalent_screening_questions_required",
  ])("skips %s instead of blocking the queue", (reason) => {
    expect(isSkippableReason(reason)).toBe(true);
  });

  it("keeps an ordinary transport failure visible as failed", () => {
    expect(isSkippableReason("request failed (502)")).toBe(false);
  });
});

describe("session-level failures do not burn the queue", () => {
  it.each([
    "jobinja_login_required: sign in",
    "jobvision_captcha_required",
    "jobinja_security_check: challenge",
    "irantalent_account_unverified",
    "eestekhdam_session_incomplete",
  ])("recognizes %s as a session problem, not an ad problem", (reason) => {
    expect(isSessionLevelReason(reason)).toBe(true);
  });

  it.each([
    "eestekhdam_form_unavailable",
    "eestekhdam_position_required",
    "eestekhdam_external_form_required",
    "irantalent_screening_questions_required",
    "irantalent_job_unavailable",
  ])("treats %s as this ad's problem, so the queue keeps moving", (reason) => {
    expect(isSessionLevelReason(reason)).toBe(false);
    // These stay skippable: the next ad may be perfectly fine.
    expect(isSkippableReason(reason)).toBe(true);
  });

  it("stops after a few in a row rather than skipping thousands of tasks", () => {
    // The whole point of the streak limit: skipping one logged-out job is fine,
    // skipping 6000 of them marks the entire queue used up against a dead session.
    expect(SESSION_FAILURE_STREAK_LIMIT).toBeGreaterThan(1);
    expect(SESSION_FAILURE_STREAK_LIMIT).toBeLessThanOrEqual(5);
  });

  it("leaves an ordinary transport failure alone — that is a retry, not a stop", () => {
    expect(isSessionLevelReason("request failed (502)")).toBe(false);
    expect(isSkippableReason("request failed (502)")).toBe(false);
  });
});

describe("board circuit breaker", () => {
  it("stops well before a run can pile up dozens of rejected submissions", () => {
    // This queue sent 76 consecutive failed submissions into one board before
    // anyone noticed — the fastest way to get an account restricted.
    expect(BOARD_FAILURE_STREAK_LIMIT).toBeGreaterThan(1);
    expect(BOARD_FAILURE_STREAK_LIMIT).toBeLessThanOrEqual(10);
  });
});

describe("a listing that will not tailor must not halt the queue", () => {
  it("tolerates a few failures before stopping, not the first one", () => {
    // Observed live: 530 applications had gone out, then TWO listings whose
    // resume generation failed blocked a queue of five thousand. The server
    // already delays a failed task by 30 minutes, so the next tick moves on.
    expect(RESUME_FAILURE_STREAK_LIMIT).toBeGreaterThan(1);
    expect(RESUME_FAILURE_STREAK_LIMIT).toBeLessThanOrEqual(10);
  });

  it("still stops eventually, so a systemic failure is visible", () => {
    expect(Number.isFinite(RESUME_FAILURE_STREAK_LIMIT)).toBe(true);
  });
});
