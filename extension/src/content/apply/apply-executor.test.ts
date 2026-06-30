/**
 * apply-executor — drives a resolved APPLY_SPEC plan against a fake DOM (linkedom).
 * Proves: it fills the cover letter, clicks apply+submit in order, confirms
 * success, skips an absent OPTIONAL field, and FAILS (never blindly submits) when
 * a required selector is missing. Injected sleep/clock keep it instant + offline.
 */
import { describe, it, expect, vi } from "vitest";
import { parseHTML } from "linkedom";
import { executeApplyPlan } from "@ext/content/apply/apply-executor";
import { buildApplyPlan, applyValuesFor } from "@ext/lib/apply-runner";
import type { ApplyQueueItem } from "@ext/lib/types";

function doc(html: string): Document {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document as unknown as Document;
}

const immediate = { sleep: async () => {}, now: () => 0, stepTimeoutMs: 10, pollMs: 1 };

function jobinjaItem(over: Partial<ApplyQueueItem> = {}): ApplyQueueItem {
  return {
    id: "t1",
    board: "jobinja",
    jobTitle: "بک‌اند",
    jobUrl: "https://jobinja.ir/companies/acme/jobs/AbC123",
    coverLetter: over.coverLetter ?? "انگیزه‌نامه",
    matchScore: 0.9,
    ...over,
  };
}

/** A jobinja apply form that is already rendered (so waitFor resolves immediately). */
const JOBINJA_FORM = `
  <a class="c-jobView__applyButton" href="#">ارسال رزومه</a>
  <form class="c-applyForm">
    <textarea name="application[body]" class="c-applyForm__message"></textarea>
    <button type="submit" class="c-applyForm__submit">ثبت</button>
  </form>
  <div class="c-applyForm__success" hidden>ثبت شد</div>
`;

describe("executeApplyPlan — jobinja best-effort happy path", () => {
  it("clicks apply, fills the cover letter, clicks submit, confirms", async () => {
    const d = doc(JOBINJA_FORM);
    // Make the success node "appear" the moment submit is clicked.
    const submit = d.querySelector(".c-applyForm__submit") as HTMLElement;
    const success = d.querySelector(".c-applyForm__success") as HTMLElement;
    submit.addEventListener("click", () => success.removeAttribute("hidden"));

    const it = jobinjaItem({ coverLetter: "متن انگیزه" });
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });

    expect(res.ok).toBe(true);
    const ta = d.querySelector("textarea[name='application[body]']") as HTMLTextAreaElement;
    expect(ta.value).toBe("متن انگیزه");
    // Trail includes the apply click, the fill, and the submit click.
    expect(res.ranSteps.some((s) => s.startsWith("fill:"))).toBe(true);
    expect(res.ranSteps.filter((s) => s.startsWith("click:")).length).toBeGreaterThanOrEqual(2);
  });

  it("skips the optional cover-letter step when there is no cover letter", async () => {
    const d = doc(JOBINJA_FORM);
    (d.querySelector(".c-applyForm__submit") as HTMLElement).addEventListener("click", () =>
      (d.querySelector(".c-applyForm__success") as HTMLElement).removeAttribute("hidden"),
    );
    const it = jobinjaItem({ coverLetter: "" });
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });
    expect(res.ok).toBe(true);
    // No fill step was planned (optional, no value).
    expect(res.ranSteps.some((s) => s.startsWith("fill:"))).toBe(false);
  });
});

describe("executeApplyPlan — never blindly submits", () => {
  it("FAILS when the required apply button is missing (empty page)", async () => {
    const d = doc(`<div>nothing here</div>`);
    const it = jobinjaItem();
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("not found");
  });

  it("FAILS when the form never appears (waitFor times out)", async () => {
    // Apply button exists, but the form (waitFor target) never does.
    const d = doc(`<a class="c-jobView__applyButton">ارسال</a>`);
    const it = jobinjaItem();
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    // Advance the clock so the deadline passes on the first poll.
    let t = 0;
    const res = await executeApplyPlan(plan, {
      doc: d,
      sleep: async () => {},
      now: () => (t += 100),
      stepTimeoutMs: 50,
      pollMs: 10,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("waitFor");
  });
});

describe("executeApplyPlan — scaffold board with placeholder selectors", () => {
  it("does not submit on a jobvision page lacking the (placeholder) selectors", async () => {
    const d = doc(`<div class="some-spa">no data-test attrs here</div>`);
    const it: ApplyQueueItem = {
      id: "t2",
      board: "jobvision",
      jobTitle: "x",
      jobUrl: "https://jobvision.ir/jobs/777",
      coverLetter: "c",
      matchScore: 0.9,
    };
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });
    expect(res.ok).toBe(false);
  });
});

describe("executeApplyPlan — no event-spoofing / detection-evasion surface", () => {
  it("only dispatches plain input/change events on fill (no synthetic trust flags)", async () => {
    const d = doc(JOBINJA_FORM);
    (d.querySelector(".c-applyForm__submit") as HTMLElement).addEventListener("click", () =>
      (d.querySelector(".c-applyForm__success") as HTMLElement).removeAttribute("hidden"),
    );
    const ta = d.querySelector("textarea[name='application[body]']") as HTMLTextAreaElement;
    const seen: string[] = [];
    ta.addEventListener("input", () => seen.push("input"));
    ta.addEventListener("change", () => seen.push("change"));
    const it = jobinjaItem({ coverLetter: "x" });
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    await executeApplyPlan(plan, { doc: d, ...immediate });
    expect(seen).toEqual(["input", "change"]);
  });

  it("does not throw on a malformed selector (defensive find)", async () => {
    const d = doc(JOBINJA_FORM);
    const plan = {
      board: "jobinja" as const,
      jobUrl: "https://jobinja.ir/companies/x/jobs/Y",
      maturity: "best-effort" as const,
      steps: [{ kind: "click" as const, selector: "::::bad", optional: true }],
    };
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });
    // Bad selector → optional skip → overall ok (nothing else to do).
    expect(res.ok).toBe(true);
  });
});

// (vi imported to keep parity with other suites that spy; not all tests use it)
void vi;
