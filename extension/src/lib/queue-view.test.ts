/**
 * Queue rendering-helper tests (pure logic, no DOM).
 */
import { describe, it, expect } from "vitest";
import {
  toPersianDigits,
  formatMatchScore,
  previewCoverLetter,
  buildSubtitle,
  boardLabel,
  toQueueCardView,
  toQueueCardViews,
} from "@ext/lib/queue-view";
import type { ApplyQueueItem } from "@ext/lib/types";

const item: ApplyQueueItem = {
  id: "app-1",
  board: "jobinja",
  jobTitle: "توسعه‌دهنده فرانت‌اند",
  company: "شرکت نمونه",
  city: "تهران",
  jobUrl: "https://jobinja.ir/companies/x/jobs/y",
  coverLetter: "با سلام، من با ۵ سال تجربه در React علاقه‌مند به این موقعیت هستم.",
  matchScore: 0.87,
  screeningAnswers: [{ question: "حقوق درخواستی؟", answer: "توافقی" }],
};

describe("toPersianDigits", () => {
  it("converts ASCII digits", () => {
    expect(toPersianDigits("87%")).toBe("۸۷%");
  });
});

describe("formatMatchScore", () => {
  it("formats a 0..1 score as Persian percent", () => {
    expect(formatMatchScore(0.87)).toBe("۸۷٪");
    expect(formatMatchScore(1)).toBe("۱۰۰٪");
    expect(formatMatchScore(0)).toBe("۰٪");
  });
  it("clamps out-of-range", () => {
    expect(formatMatchScore(1.5)).toBe("۱۰۰٪");
    expect(formatMatchScore(-1)).toBe("۰٪");
  });
  it("returns null for undefined/NaN", () => {
    expect(formatMatchScore(undefined)).toBeNull();
    expect(formatMatchScore(Number.NaN)).toBeNull();
  });
});

describe("previewCoverLetter", () => {
  it("returns short text unchanged", () => {
    expect(previewCoverLetter("سلام")).toBe("سلام");
  });
  it("truncates with an ellipsis on a word boundary", () => {
    const long = "word ".repeat(60).trim();
    const out = previewCoverLetter(long, 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
  });
});

describe("buildSubtitle", () => {
  it("joins present parts with ' · '", () => {
    expect(buildSubtitle({ company: "A", city: "B" })).toBe("A · B");
  });
  it("drops missing parts", () => {
    expect(buildSubtitle({ company: "A" })).toBe("A");
    expect(buildSubtitle({})).toBe("");
  });
});

describe("boardLabel", () => {
  it("maps to Persian display names", () => {
    expect(boardLabel("jobinja")).toBe("جابینجا");
    expect(boardLabel("jobvision")).toBe("جاب‌ویژن");
  });
});

describe("toQueueCardView", () => {
  it("projects a full card view", () => {
    const v = toQueueCardView(item);
    expect(v.id).toBe("app-1");
    expect(v.title).toBe("توسعه‌دهنده فرانت‌اند");
    expect(v.subtitle).toBe("شرکت نمونه · تهران");
    expect(v.boardLabel).toBe("جابینجا");
    expect(v.matchLabel).toBe("۸۷٪");
    expect(v.screening).toHaveLength(1);
    expect(v.canSubmit).toBe(true);
  });

  it("marks canSubmit=false when a required field is missing", () => {
    const broken = { ...item, coverLetter: "" };
    expect(toQueueCardView(broken).canSubmit).toBe(false);
  });
});

describe("toQueueCardViews", () => {
  it("drops malformed items defensively", () => {
    const views = toQueueCardViews([item, { id: "" } as ApplyQueueItem]);
    expect(views).toHaveLength(1);
    expect(views[0]!.id).toBe("app-1");
  });
});
