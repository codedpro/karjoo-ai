/**
 * apply-runner — the §10 guardrail core. These tests PROVE the runner never
 * applies when the toggle is OFF, when no boards are connected, or when the
 * daily cap is reached, and that it filters by threshold and builds an
 * APPLY_SPEC-driven plan.
 */
import { describe, it, expect } from "vitest";
import {
  decideTick,
  shouldStopForClaim,
  shouldStopForCap,
  eligibleItems,
  buildApplyPlan,
  applyValuesFor,
  type AutoApplyGate,
} from "@ext/lib/apply-runner";
import type { ApplyQueueItem } from "@ext/lib/types";

function item(over: Partial<ApplyQueueItem> = {}): ApplyQueueItem {
  return {
    id: over.id ?? "task-1",
    board: over.board ?? "jobinja",
    jobTitle: over.jobTitle ?? "بک‌اند",
    jobUrl: over.jobUrl ?? "https://jobinja.ir/companies/acme/jobs/AbC123",
    coverLetter: over.coverLetter ?? "انگیزه‌نامه‌ی نمونه",
    matchScore: over.matchScore,
    ...over,
  };
}

const ON: AutoApplyGate = { enabled: true, minScore: 0.7, boardsConnected: true };

describe("decideTick — the toggle gate (§10)", () => {
  it("NEVER runs when the toggle is OFF", () => {
    const d = decideTick({ ...ON, enabled: false });
    expect(d).toEqual({ run: false, reason: "disabled" });
  });

  it("does not run when no boards are connected", () => {
    const d = decideTick({ ...ON, boardsConnected: false });
    expect(d).toEqual({ run: false, reason: "no_boards" });
  });

  it("runs (with the effective threshold) only when ON and boards are connected", () => {
    const d = decideTick({ ...ON, minScore: 0.82 });
    expect(d).toEqual({ run: true, minScore: 0.82 });
  });
});

describe("shouldStopForClaim — cap / disabled signals from the server", () => {
  it("stops when the server says the cap is reached", () => {
    expect(shouldStopForClaim({ items: [], reason: "quota_exceeded" })).toBe(true);
  });
  it("stops when the server says the toggle is off (flipped between fetch and claim)", () => {
    expect(shouldStopForClaim({ items: [], reason: "disabled" })).toBe(true);
  });
  it("continues for a normal (ungated) claim", () => {
    expect(shouldStopForClaim({ items: [item({ matchScore: 0.9 })] })).toBe(false);
  });
});

describe("shouldStopForCap — HTTP 429 from the result endpoint = daily cap", () => {
  it("stops on 429", () => {
    expect(shouldStopForCap({ ok: false, status: 429 })).toBe(true);
  });
  it("does not stop on a normal 200", () => {
    expect(shouldStopForCap({ ok: true, status: 200 })).toBe(false);
  });
});

describe("eligibleItems — threshold defense in depth (§10)", () => {
  it("keeps only items at/above the threshold", () => {
    const items = [
      item({ id: "a", matchScore: 0.9 }),
      item({ id: "b", matchScore: 0.7 }),
      item({ id: "c", matchScore: 0.69 }),
    ];
    const keep = eligibleItems(items, 0.7).map((i) => i.id);
    expect(keep).toEqual(["a", "b"]);
  });

  it("NEVER auto-applies an item with no score", () => {
    const items = [item({ id: "noscore", matchScore: undefined })];
    expect(eligibleItems(items, 0.7)).toHaveLength(0);
  });

  it("drops items whose board has no APPLY_SPEC", () => {
    const items = [item({ id: "x", board: "unknown" as ApplyQueueItem["board"], matchScore: 0.99 })];
    expect(eligibleItems(items, 0.7)).toHaveLength(0);
  });
});

describe("buildApplyPlan — APPLY_SPEC-driven fill", () => {
  it("returns null for an unsupported board", () => {
    expect(buildApplyPlan(item({ board: "nope" as ApplyQueueItem["board"] }), {})).toBeNull();
  });

  it("resolves the cover-letter value into the jobinja fill step", () => {
    const it = item({ coverLetter: "سلام، من مناسبم." });
    const plan = buildApplyPlan(it, applyValuesFor(it));
    expect(plan).not.toBeNull();
    const fill = plan!.steps.find((s) => s.kind === "fill");
    expect(fill?.value).toBe("سلام، من مناسبم.");
    expect(plan!.maturity).toBe("best-effort");
    // The flow has a click(apply) → waitFor(form) → fill → click(submit) shape.
    const kinds = plan!.steps.map((s) => s.kind);
    expect(kinds[0]).toBe("click");
    expect(kinds).toContain("fill");
    expect(kinds.filter((k) => k === "click").length).toBeGreaterThanOrEqual(2);
  });

  it("drops the optional cover-letter step when there is no cover letter", () => {
    const it = item({ coverLetter: "" });
    const plan = buildApplyPlan(it, applyValuesFor(it));
    expect(plan!.steps.some((s) => s.kind === "fill")).toBe(false);
  });

  it("marks scaffold boards as scaffold", () => {
    const it = item({
      board: "jobvision",
      jobUrl: "https://jobvision.ir/jobs/12345",
    });
    const plan = buildApplyPlan(it, applyValuesFor(it));
    expect(plan!.maturity).toBe("scaffold");
  });
});
