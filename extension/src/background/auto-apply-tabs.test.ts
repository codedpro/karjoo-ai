import { describe, expect, it } from "vitest";

import { isSkippableReason, shouldCloseManagedTab } from "@ext/background/auto-apply";

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
