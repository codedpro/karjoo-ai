/**
 * apply-executor — drives a resolved APPLY_SPEC plan against a fake DOM (linkedom).
 * Proves: it attaches the tailored PDF, clicks apply+submit in order, confirms
 * success, and FAILS (never blindly submits) when required data or selectors are
 * missing. Injected upload/timers keep it instant + offline.
 */
import { describe, it, expect, vi } from "vitest";
import { parseHTML } from "linkedom";
import { executeApplyPlan } from "@ext/content/apply/apply-executor";
import { buildApplyPlan, applyValuesFor } from "@ext/lib/apply-runner";
import type { ApplyQueueItem } from "@ext/lib/types";

function doc(html: string): Document {
  return parseHTML(`<!doctype html><html><body>${html}</body></html>`).document as unknown as Document;
}

let immediateTime = 0;
const immediate = {
  sleep: async () => {},
  now: () => (immediateTime += 100),
  stepTimeoutMs: 10,
  pollMs: 1,
  uploadPdf: (input: HTMLInputElement, _dataUrl: string, fileName: string) => {
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [{ name: fileName, type: "application/pdf" }],
    });
  },
};

const TEST_PDF = "data:application/pdf;base64,JVBERi0xLjQK";

function jobinjaItem(over: Partial<ApplyQueueItem> = {}): ApplyQueueItem {
  return {
    id: "t1",
    board: "jobinja",
    jobTitle: "بک‌اند",
    jobUrl: "https://jobinja.ir/companies/acme/jobs/AbC123",
    coverLetter: over.coverLetter ?? "انگیزه‌نامه",
    matchScore: 0.9,
    resume: {
      id: "resume-1",
      title: "رزومه اختصاصی",
      downloadUrl: "/api/apply-queue/t1/resume.pdf",
      dataUrl: TEST_PDF,
      fileName: "tailored-resume.pdf",
    },
    ...over,
  };
}

/** A jobinja apply form that is already rendered (so waitFor resolves immediately). */
const JOBINJA_FORM = `
  <div class="c-slideToggle__mobileFormToggler"><button class="c-btn--primary">ارسال رزومه</button></div>
  <form id="apply-form">
    <input id="apply_choice_uploaded_cv" type="radio">
    <input name="cv_file" type="file">
    <button type="submit">ثبت</button>
  </form>
  <div class="js-flashMessageMsg">ثبت شد</div>
`;

describe("executeApplyPlan — jobinja best-effort happy path", () => {
  it("uploads the per-job tailored resume and submits", async () => {
    const d = doc(JOBINJA_FORM);
    const it = jobinjaItem({ coverLetter: "متن انگیزه" });
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });

    expect(res.ok).toBe(true);
    expect(res.ranSteps.some((s) => s.includes("#apply_choice_uploaded_cv"))).toBe(true);
    expect(res.ranSteps.some((s) => s.startsWith("upload:"))).toBe(true);
    expect((d.querySelector("input[type='file']") as HTMLInputElement).files?.[0]?.name)
      .toBe("tailored-resume.pdf");
    expect(res.ranSteps.some((s) => s.startsWith("fill:"))).toBe(false);
    expect(res.ranSteps.filter((s) => s.startsWith("click:")).length).toBeGreaterThanOrEqual(2);
  });

  it("skips the optional cover-letter step when there is no cover letter", async () => {
    const d = doc(JOBINJA_FORM);
    const it = jobinjaItem({ coverLetter: "" });
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });
    expect(res.ok).toBe(true);
    // No fill step was planned (optional, no value).
    expect(res.ranSteps.some((s) => s.startsWith("fill:"))).toBe(false);
  });

  it("does not submit when the tailored resume is missing", async () => {
    const d = doc(JOBINJA_FORM);
    const submit = d.querySelector("button[type='submit']") as HTMLButtonElement;
    const submitted = vi.fn();
    submit.addEventListener("click", submitted);
    const it = jobinjaItem({ resume: undefined });
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("resume_upload_failed: PDF bytes are missing");
    expect(submitted).not.toHaveBeenCalled();
  });
});

describe("executeApplyPlan — never blindly submits", () => {
  it("stops before touching the form on a security challenge", async () => {
    const d = doc("Checking your browser before accessing the website");
    const it = jobinjaItem();
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });
    expect(res).toEqual({
      ok: false,
      ranSteps: [],
      reason: "jobinja_security_check: security challenge is active",
    });
  });

  it("FAILS when the required apply button is missing (empty page)", async () => {
    const d = doc(`<div>nothing here</div>`);
    const it = jobinjaItem();
    const plan = buildApplyPlan(it, applyValuesFor(it))!;
    const res = await executeApplyPlan(plan, { doc: d, ...immediate });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("waitFor");
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
    const d = doc(`<textarea id="message"></textarea>`);
    const ta = d.querySelector("#message") as HTMLTextAreaElement;
    const seen: string[] = [];
    ta.addEventListener("input", () => seen.push("input"));
    ta.addEventListener("change", () => seen.push("change"));
    const plan = {
      board: "jobinja" as const,
      jobUrl: "https://jobinja.ir/companies/x/jobs/Y",
      maturity: "best-effort" as const,
      steps: [{ kind: "fill" as const, selector: "#message", value: "x" }],
    };
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
