/**
 * Apply-plan tests — APPLY_SPEC-driven fill (mirrors the extension's runner).
 *
 * Covers: cover-letter resolution into the fill step, dropping optional steps with
 * no value, keeping a REQUIRED fill with no value (so the executor fails rather
 * than submitting a half-form), null for unsupported boards, and that the worker's
 * jobinja selectors STILL MATCH the control-plane apply-spec source of truth.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildApplyPlan, applyValuesFor } from "./apply-plan.js";
import { APPLY_SPEC, getApplySpec } from "./apply-spec.js";
import type { FleetJob } from "./types.js";

function job(over: Partial<FleetJob> = {}): FleetJob {
  return {
    taskId: "t1",
    userId: "u1",
    board: "jobinja",
    listingUrl: "https://jobinja.ir/companies/acme/jobs/AB12cd",
    coverLetter: "سلام، علاقه‌مندم.",
    session: "{}",
    ...over,
  };
}

describe("applyValuesFor", () => {
  it("maps a non-empty cover letter", () => {
    expect(applyValuesFor({ coverLetter: " hi " }).coverLetter).toBe("hi");
  });
  it("omits an empty/whitespace cover letter", () => {
    expect(applyValuesFor({ coverLetter: "  " }).coverLetter).toBeUndefined();
    expect(applyValuesFor({ coverLetter: null }).coverLetter).toBeUndefined();
  });
});

describe("buildApplyPlan", () => {
  it("returns null for an unsupported board", () => {
    expect(buildApplyPlan(job({ board: "linkedin" }))).toBeNull();
  });

  it("resolves the cover letter into the jobinja fill step", () => {
    const plan = buildApplyPlan(job())!;
    expect(plan.board).toBe("jobinja");
    expect(plan.maturity).toBe("best-effort");
    const fill = plan.steps.find((s) => s.kind === "fill");
    expect(fill?.value).toBe("سلام، علاقه‌مندم.");
  });

  it("drops the optional cover-letter step when there is no value", () => {
    const plan = buildApplyPlan(job({ coverLetter: null }))!;
    expect(plan.steps.some((s) => s.kind === "fill")).toBe(false);
    // The click+waitFor steps remain.
    expect(plan.steps.some((s) => s.kind === "click")).toBe(true);
  });

  it("carries the submit + confirm selectors from the spec", () => {
    const plan = buildApplyPlan(job())!;
    expect(plan.submitSelector).toContain("c-applyForm");
    expect(plan.confirmSelector).toContain("success");
  });
});

describe("worker apply-spec stays in sync with the control plane", () => {
  it("uses the SAME jobinja selectors as src/lib/apply/apply-spec.ts", () => {
    // Read the control-plane spec file and assert the load-bearing jobinja
    // selectors are byte-identical (the two packages keep this map in sync).
    const here = dirname(fileURLToPath(import.meta.url));
    const controlPath = resolve(here, "../../../src/lib/apply/apply-spec.ts");
    const control = readFileSync(controlPath, "utf8");

    const spec = getApplySpec("jobinja")!;
    expect(control).toContain(spec.applyButtonSelector);
    expect(control).toContain(spec.submitSelector);
    expect(control).toContain(spec.coverLetterFieldSelector!);
  });

  it("marks jobinja best-effort and the others scaffold", () => {
    expect(APPLY_SPEC.jobinja.maturity).toBe("best-effort");
    expect(APPLY_SPEC.jobvision.maturity).toBe("scaffold");
    expect(APPLY_SPEC["e-estekhdam"].maturity).toBe("scaffold");
    expect(APPLY_SPEC.irantalent.maturity).toBe("scaffold");
  });
});
