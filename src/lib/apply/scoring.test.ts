/**
 * تست‌های scoreAndDraft — گیت‌وی mock (بدون شبکه و بدون دیتابیس).
 *
 * fetch تزریق‌شده پاسخ مدل را شبیه‌سازی می‌کند تا کل مسیر (پرامپت → گیت‌وی → پارس →
 * اعتبارسنجی zod → خروجی دامنه) بدون شبکه تست شود.
 */
import { describe, expect, it } from "vitest";

import { scoreAndDraft, ScoringError } from "@/lib/apply/scoring";
import type { FetchLike, GatewayConfig } from "@/lib/ai/gateway";
import type { CandidateProfile, JobListing } from "@/lib/apply/types";

const CONFIG: GatewayConfig = {
  baseUrl: "https://gw.1xai.example/v1",
  apiKey: "sk-test",
  model: "gpt-test",
};

const profile: CandidateProfile = {
  fullName: "سارا احمدی",
  skills: ["React", "TypeScript"],
  yearsExperience: 4,
  city: "تهران",
};

const job: JobListing = {
  id: "jobinja:abc",
  board: "jobinja",
  externalId: "abc",
  title: "برنامه‌نویس فرانت‌اند",
  url: "https://jobinja.ir/jobs/abc",
  description: "React و TypeScript لازم است.",
};

/** fetchِ mock که یک پاسخ OpenAI-مانند با content دلخواه می‌دهد. */
function fetchReturning(content: string, opts: { ok?: boolean; status?: number } = {}): FetchLike {
  return async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    text: async () =>
      JSON.stringify({
        model: "gpt-test",
        choices: [{ message: { role: "assistant", content } }],
      }),
  });
}

describe("scoreAndDraft", () => {
  it("امتیاز و انگیزه‌نامه را از خروجی معتبر مدل برمی‌گرداند", async () => {
    const modelOutput = JSON.stringify({
      matchScore: 0.82,
      reasons: ["تسلط بر React", "هم‌شهری در تهران"],
      coverLetter: "با سلام و احترام، اینجانب سارا احمدی…",
    });
    const res = await scoreAndDraft(job, profile, {
      config: CONFIG,
      fetchImpl: fetchReturning(modelOutput),
    });

    expect(res.matchScore).toBe(0.82);
    expect(res.coverLetter).toContain("سارا احمدی");
    // دلایلِ آرایه‌ای به یک رشته‌ی reason تبدیل می‌شوند (حفظ قرارداد موجود).
    expect(res.reason).toContain("تسلط بر React");
    expect(res.reason).toContain("هم‌شهری");
  });

  it("اگر مدل reasons ندهد، reason undefined می‌ماند", async () => {
    const modelOutput = JSON.stringify({
      matchScore: 0.4,
      coverLetter: "متن انگیزه‌نامه",
    });
    const res = await scoreAndDraft(job, profile, {
      config: CONFIG,
      fetchImpl: fetchReturning(modelOutput),
    });
    expect(res.matchScore).toBe(0.4);
    expect(res.reason).toBeUndefined();
  });

  it("روی خروجیِ نامعتبرِ مدل (امتیاز خارج از بازه) ScoringError می‌دهد", async () => {
    const bad = JSON.stringify({ matchScore: 5, reasons: ["x"], coverLetter: "y" });
    const err = await scoreAndDraft(job, profile, {
      config: CONFIG,
      fetchImpl: fetchReturning(bad),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ScoringError);
  });

  it("روی خروجیِ بدون coverLetter ScoringError می‌دهد", async () => {
    const bad = JSON.stringify({ matchScore: 0.5, reasons: ["x"] });
    const err = await scoreAndDraft(job, profile, {
      config: CONFIG,
      fetchImpl: fetchReturning(bad),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ScoringError);
  });

  it("روی خطای گیت‌وی (HTTP) ScoringError با علتِ زیرین می‌دهد", async () => {
    const err = await scoreAndDraft(job, profile, {
      config: CONFIG,
      fetchImpl: fetchReturning("boom", { ok: false, status: 500 }),
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ScoringError);
    expect((err as ScoringError).cause).toBeDefined();
  });
});
