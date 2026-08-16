/**
 * apply-spec (extension copy) — proves the spec map mirrors Foundation's shape:
 * jobinja is best-effort, the others are scaffold, URL matching works, and the
 * step kinds are valid.
 */
import { describe, it, expect } from "vitest";
import {
  APPLY_SPEC,
  getApplySpec,
  isApplySpecReady,
  matchApplySpecByUrl,
} from "@ext/lib/apply-spec";
import { BOARD_IDS } from "@ext/lib/config";

describe("APPLY_SPEC coverage + maturity", () => {
  it("has a spec for every board id", () => {
    for (const board of BOARD_IDS) {
      expect(getApplySpec(board)).toBeTruthy();
    }
  });

  it("jobinja, jobvision, and e-estekhdam are best-effort; irantalent is scaffold", () => {
    expect(isApplySpecReady("jobinja")).toBe(true);
    expect(isApplySpecReady("jobvision")).toBe(true);
    expect(isApplySpecReady("e-estekhdam")).toBe(true);
    expect(isApplySpecReady("irantalent")).toBe(false);
  });

  it("returns undefined for an unknown board", () => {
    expect(getApplySpec("monster")).toBeUndefined();
  });

  it("every step has a valid kind and selector", () => {
    const valid = new Set(["click", "fill", "select", "upload", "waitFor"]);
    for (const spec of Object.values(APPLY_SPEC)) {
      expect(spec.steps.length).toBeGreaterThan(0);
      for (const step of spec.steps) {
        expect(valid.has(step.kind)).toBe(true);
        expect(typeof step.selector).toBe("string");
        expect(step.selector.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("matchApplySpecByUrl", () => {
  it("matches a jobinja job URL", () => {
    expect(matchApplySpecByUrl("https://jobinja.ir/companies/acme/jobs/AbC123")?.board).toBe(
      "jobinja",
    );
  });
  it("matches a jobvision job URL", () => {
    expect(matchApplySpecByUrl("https://jobvision.ir/jobs/12345")?.board).toBe("jobvision");
  });
  it("returns undefined for a non-job URL", () => {
    expect(matchApplySpecByUrl("https://example.com/")).toBeUndefined();
  });
});
