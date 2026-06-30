/**
 * تست‌های سازنده‌های پرامپت فارسی — بدون شبکه (فقط بررسی متن خروجی).
 */
import { describe, expect, it } from "vitest";

import {
  buildCoverLetterPrompt,
  buildMatchScorePrompt,
  buildScoreAndDraftPrompt,
  summarizeJob,
  summarizeProfile,
} from "@/lib/ai/prompts";
import type { CandidateProfile, JobListing } from "@/lib/apply/types";

const profile: CandidateProfile = {
  fullName: "سارا احمدی",
  headline: "توسعه‌دهنده‌ی فرانت‌اند",
  skills: ["React", "TypeScript", "Next.js"],
  yearsExperience: 4,
  city: "تهران",
  resumeText: "چهار سال تجربه‌ی توسعه‌ی رابط کاربری با React و TypeScript.",
  preferences: {
    titles: ["Frontend Developer"],
    cities: ["تهران", "دورکاری"],
    employmentTypes: ["remote", "full-time"],
  },
};

const job: JobListing = {
  id: "jobinja:abc123",
  board: "jobinja",
  externalId: "abc123",
  title: "برنامه‌نویس فرانت‌اند (React)",
  company: "شرکت نمونه",
  city: "تهران",
  url: "https://jobinja.ir/jobs/abc123",
  description: "نیازمند تسلط به React و TypeScript و تجربه‌ی کار با Next.js.",
  salary: "توافقی",
  postedAt: "1403-04-08",
};

describe("summarizeProfile", () => {
  it("فیلدهای کلیدی پروفایل را در متن می‌آورد", () => {
    const s = summarizeProfile(profile);
    expect(s).toContain("سارا احمدی");
    expect(s).toContain("React");
    expect(s).toContain("تهران");
    expect(s).toContain("4 سال");
    expect(s).toContain("Frontend Developer");
  });

  it("فیلدهای اختیاریِ نبوده را جا نمی‌اندازد/خطا نمی‌دهد", () => {
    const minimal: CandidateProfile = { fullName: "کاربر", skills: [] };
    const s = summarizeProfile(minimal);
    expect(s).toContain("کاربر");
    expect(s).not.toContain("undefined");
  });
});

describe("summarizeJob", () => {
  it("عنوان، شرکت، شهر و شرح آگهی را می‌آورد", () => {
    const s = summarizeJob(job);
    expect(s).toContain("برنامه‌نویس فرانت‌اند");
    expect(s).toContain("شرکت نمونه");
    expect(s).toContain("تهران");
    expect(s).toContain("Next.js");
  });
});

describe("buildMatchScorePrompt", () => {
  it("پیام system + user می‌سازد و به فارسیِ JSON-only اشاره می‌کند", () => {
    const msgs = buildMatchScorePrompt(job, profile);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[0].content).toContain("matchScore");
    expect(msgs[0].content).toContain("JSON");
    // متن کاربر باید هم پروفایل و هم آگهی را داشته باشد.
    expect(msgs[1].content).toContain("سارا احمدی");
    expect(msgs[1].content).toContain("برنامه‌نویس فرانت‌اند");
  });
});

describe("buildCoverLetterPrompt", () => {
  it("system نگارش انگیزه‌نامه + JSON-only، و user شامل آگهی و پروفایل", () => {
    const msgs = buildCoverLetterPrompt(job, profile);
    expect(msgs[0].content).toContain("coverLetter");
    expect(msgs[0].content).toContain("انگیزه‌نامه");
    expect(msgs[1].content).toContain("React");
  });
});

describe("buildScoreAndDraftPrompt", () => {
  it("هر سه فیلد matchScore/reasons/coverLetter را در دستور خروجی می‌خواهد", () => {
    const msgs = buildScoreAndDraftPrompt(job, profile);
    expect(msgs[0].content).toContain("matchScore");
    expect(msgs[0].content).toContain("reasons");
    expect(msgs[0].content).toContain("coverLetter");
  });
});
