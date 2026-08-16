import { describe, expect, it } from "vitest";

import { shouldCloseManagedTab } from "@ext/background/auto-apply";

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
