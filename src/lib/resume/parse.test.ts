/**
 * تست‌های ساخت‌یافته‌سازیِ رزومه با AI — گیت‌وی mock (بدونِ شبکه/DB).
 *
 * fetch تزریق‌شده پاسخِ مدل را شبیه‌سازی می‌کند تا کلِ مسیر (پرامپت → گیت‌وی → پارس →
 * اعتبارسنجیِ zod → ParsedResume) بدونِ شبکه تست شود. روی مرزها تمرکز داریم:
 *   • خروجیِ معتبر → فیلدهای ساخت‌یافته (با نرمال‌سازیِ مهارت).
 *   • فیلدهای غایب → اختیاری/آرایه‌ی خالی (بدونِ توهم).
 *   • خروجیِ نامعتبرِ مدل (عددِ خارج‌ازبازه/شکلِ بد) → ResumeParseError.
 *   • متنِ خالیِ ورودی → ResumeParseError (بدونِ فراخوانیِ گیت‌وی).
 */
import { describe, expect, it } from "vitest";

import { parseResumeText, ResumeParseError } from "@/lib/resume/parse";
import { GatewayError, type FetchLike, type GatewayConfig } from "@/lib/ai/gateway";

const CONFIG: GatewayConfig = {
  baseUrl: "https://gw.1xai.example/v1",
  apiKey: "sk-test",
  model: "gpt-test",
};

/** fetchِ mock که یک پاسخِ OpenAI-مانند با content دلخواه می‌دهد. */
function fetchReturning(
  content: string,
  opts: { ok?: boolean; status?: number } = {},
): FetchLike {
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

const RESUME_TEXT = "سارا احمدی\nتوسعه‌دهنده‌ی فرانت‌اند\nمهارت‌ها: React, TypeScript";

describe("parseResumeText", () => {
  it("از خروجیِ معتبرِ مدل فیلدهای ساخت‌یافته را برمی‌گرداند", async () => {
    const modelOutput = JSON.stringify({
      fullName: "سارا احمدی",
      headline: "توسعه‌دهنده‌ی فرانت‌اند",
      city: "تهران",
      yearsExperience: 4,
      skills: ["React", "TypeScript", "React"], // تکراری عمدی
      experience: [
        { title: "فرانت‌اند", company: "شرکت الف", period: "۱۳۹۸-۱۴۰۱" },
      ],
      education: [{ degree: "کارشناسی", field: "کامپیوتر" }],
    });

    const res = await parseResumeText(RESUME_TEXT, {
      config: CONFIG,
      fetchImpl: fetchReturning(modelOutput),
    });

    expect(res.fullName).toBe("سارا احمدی");
    expect(res.headline).toBe("توسعه‌دهنده‌ی فرانت‌اند");
    expect(res.city).toBe("تهران");
    expect(res.yearsExperience).toBe(4);
    // مهارت‌ها یکتا می‌شوند (React تکراری حذف).
    expect(res.skills).toEqual(["React", "TypeScript"]);
    expect(res.experience).toHaveLength(1);
    expect(res.experience[0].company).toBe("شرکت الف");
    expect(res.education[0].degree).toBe("کارشناسی");
  });

  it("فیلدهای غایب را اختیاری/آرایه‌ی خالی می‌گذارد (بدونِ توهم)", async () => {
    const modelOutput = JSON.stringify({ skills: ["Excel"] });

    const res = await parseResumeText(RESUME_TEXT, {
      config: CONFIG,
      fetchImpl: fetchReturning(modelOutput),
    });

    expect(res.fullName).toBeUndefined();
    expect(res.yearsExperience).toBeUndefined();
    expect(res.skills).toEqual(["Excel"]);
    expect(res.experience).toEqual([]);
    expect(res.education).toEqual([]);
  });

  it("خروجیِ نامعتبرِ مدل (سال‌های سابقه‌ی منفی) → ResumeParseError", async () => {
    const modelOutput = JSON.stringify({ yearsExperience: -3, skills: [] });

    await expect(
      parseResumeText(RESUME_TEXT, {
        config: CONFIG,
        fetchImpl: fetchReturning(modelOutput),
      }),
    ).rejects.toBeInstanceOf(ResumeParseError);
  });

  it("متنِ خالیِ ورودی → ResumeParseError بدونِ فراخوانیِ گیت‌وی", async () => {
    let called = false;
    const spyFetch: FetchLike = async () => {
      called = true;
      return { ok: true, status: 200, text: async () => "{}" };
    };

    await expect(
      parseResumeText("   ", { config: CONFIG, fetchImpl: spyFetch }),
    ).rejects.toBeInstanceOf(ResumeParseError);
    expect(called).toBe(false);
  });

  it("خطای HTTP گیت‌وی در ResumeParseError بسته‌بندی می‌شود (با cause از GatewayError)", async () => {
    try {
      await parseResumeText(RESUME_TEXT, {
        config: CONFIG,
        fetchImpl: fetchReturning("boom", { ok: false, status: 500 }),
      });
      expect.unreachable("باید خطا می‌داد");
    } catch (err) {
      expect(err).toBeInstanceOf(ResumeParseError);
      expect((err as ResumeParseError).cause).toBeInstanceOf(GatewayError);
    }
  });

  it("JSON نامعتبرِ مدل → ResumeParseError", async () => {
    await expect(
      parseResumeText(RESUME_TEXT, {
        config: CONFIG,
        fetchImpl: fetchReturning("این JSON نیست"),
      }),
    ).rejects.toBeInstanceOf(ResumeParseError);
  });
});
