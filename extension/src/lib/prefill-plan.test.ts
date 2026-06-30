/**
 * Pre-fill PLAN tests (pure data). Proves the plan contains no submit step and
 * builds field instructions from the AI-drafted content.
 */
import { describe, it, expect } from "vitest";
import { buildPrefillPlan, cssEscape } from "@ext/lib/prefill-plan";
import type { ApplyQueueItem } from "@ext/lib/types";

const base: ApplyQueueItem = {
  id: "a1",
  board: "jobinja",
  jobTitle: "بک‌اند",
  jobUrl: "https://jobinja.ir/jobs/1",
  coverLetter: "متن انگیزه‌نامه",
};

describe("buildPrefillPlan", () => {
  it("adds a cover-letter field with textarea selector candidates", () => {
    const plan = buildPrefillPlan(base);
    expect(plan.jobUrl).toBe(base.jobUrl);
    expect(plan.fields).toHaveLength(1);
    expect(plan.fields[0]!.value).toBe("متن انگیزه‌نامه");
    expect(plan.fields[0]!.selectorCandidates).toContain("textarea");
  });

  it("adds a field per screening answer", () => {
    const plan = buildPrefillPlan({
      ...base,
      screeningAnswers: [
        { question: "حقوق؟", answer: "توافقی" },
        { question: "شروع؟", answer: "فوری" },
      ],
    });
    expect(plan.fields).toHaveLength(3); // cover + 2 answers
    expect(plan.fields.map((f) => f.value)).toContain("توافقی");
  });

  it("skips empty cover letters and empty answers", () => {
    const plan = buildPrefillPlan({
      ...base,
      coverLetter: "   ",
      screeningAnswers: [{ question: "q", answer: "" }],
    });
    expect(plan.fields).toHaveLength(0);
  });

  it("never includes a submit/click instruction (RULE 2)", () => {
    const plan = buildPrefillPlan(base);
    const serialized = JSON.stringify(plan).toLowerCase();
    expect(serialized).not.toContain("submit");
    expect(serialized).not.toContain("click");
    // Plan shape is only { jobUrl, fields[] } — assert no extra action keys.
    expect(Object.keys(plan).sort()).toEqual(["fields", "jobUrl"]);
  });
});

describe("cssEscape", () => {
  it("escapes quotes and backslashes for attribute selectors", () => {
    expect(cssEscape('a"b\\c')).toBe('a\\"b\\\\c');
  });
});
