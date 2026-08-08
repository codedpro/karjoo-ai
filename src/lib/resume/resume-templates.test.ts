/**
 * قالب‌های رزومه — سه ادعای مهم:
 *   • رزومه هیچ نشانه‌ای از تولیدِ خودکار ندارد (کارفرما نباید بفهمد ابزار ساخته).
 *   • انتخابِ «تصادفی» قطعی است — رندرِ دوباره‌ی همان اپلای همان طرح را می‌دهد.
 *   • نامِ فایل «نام کامل _ نامِ شرکت» است، بدونِ نامِ ابزار.
 */
import { describe, expect, it } from "vitest";

import {
  RESUME_TEMPLATE_IDS,
  pickTemplate,
  renderResumeTemplate,
  resumeFileName,
  type ResumeTemplateData,
} from "@/lib/resume/resume-templates";

const DATA: ResumeTemplateData = {
  fullName: "Amirhossein Nouri",
  headline: "Full-Stack Engineer",
  email: "dev@example.com",
  phone: "+98 935 200 5369",
  city: "Babol",
  summary: "8+ years building web apps end to end.",
  skills: ["React", "Node.js", "PostgreSQL"],
  experience: [
    { company: "MTN Irancell", title: "Solution Architect", period: "1402 – now", bullets: ["Led AI tooling"] },
  ],
  education: [{ school: "Azad Babol", degree: "Computer Engineering", period: "1402 – 1405" }],
  highlights: ["Led 10+ engineers"],
};

describe("resume templates", () => {
  it("هیچ نشانه‌ای از «تولیدشده برای فلان شرکت» در خروجی نیست", () => {
    for (const id of RESUME_TEMPLATE_IDS) {
      const html = renderResumeTemplate(DATA, id);
      expect(html).not.toMatch(/هدف‌گیری‌شده|tailored for|generated (for|by)|karjoo/i);
    }
  });

  it("هر سه قالب محتوای واقعی را رندر می‌کنند", () => {
    for (const id of RESUME_TEMPLATE_IDS) {
      const html = renderResumeTemplate(DATA, id);
      expect(html).toContain("Amirhossein Nouri");
      expect(html).toContain("MTN Irancell");
      expect(html).toContain("+98 935 200 5369");
      expect(html).toContain("React");
    }
  });

  it("زبان جهت و عنوان‌های بخش‌ها را عوض می‌کند", () => {
    const fa = renderResumeTemplate({ ...DATA, lang: "fa" }, "classic");
    const en = renderResumeTemplate({ ...DATA, lang: "en" }, "classic");
    expect(fa).toContain('dir="rtl"');
    expect(fa).toContain("سوابق شغلی");
    expect(en).toContain('dir="ltr"');
    expect(en).toContain("Experience");
    expect(en).not.toContain("سوابق شغلی");
  });

  it("قالبِ صریح رعایت می‌شود", () => {
    expect(pickTemplate("modern", "x")).toBe("modern");
    expect(pickTemplate("compact", "x")).toBe("compact");
  });

  it("«تصادفی» قطعی است — همان seed همان قالب (بایگانی نباید عوض شود)", () => {
    const a = pickTemplate("shuffle", "listing-42");
    const b = pickTemplate("shuffle", "listing-42");
    expect(a).toBe(b);
    expect(RESUME_TEMPLATE_IDS).toContain(a);
  });

  it("seedهای مختلف قالب‌های مختلف می‌دهند (واقعاً می‌چرخد)", () => {
    const seen = new Set(
      Array.from({ length: 40 }, (_, i) => pickTemplate("shuffle", `listing-${i}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("نامِ فایل «نام _ شرکت» است و نامِ ابزار ندارد", () => {
    expect(resumeFileName("Amirhossein Nouri", "Niksam AI")).toBe("Amirhossein_Nouri_Niksam_AI.pdf");
    expect(resumeFileName("Amirhossein Nouri", null)).toBe("Amirhossein_Nouri.pdf");
    expect(resumeFileName("Amirhossein Nouri", "Niksam AI")).not.toMatch(/karjoo|resume-/i);
  });

  it("نامِ دوزبانه‌ی شرکت به یک نسخه‌ی لاتین کوتاه می‌شود", () => {
    // بوردها اغلب «وت‌پرو | VetPro» می‌دهند؛ نامِ فایل نباید هر دو را داشته باشد.
    expect(resumeFileName("Amirhossein Nouri", "وت‌پرو | VetPro")).toBe(
      "Amirhossein_Nouri_VetPro.pdf",
    );
  });

  it("نویسه‌های غیرمجازِ مسیر از نامِ فایل حذف می‌شوند", () => {
    expect(resumeFileName("A/B:C", "X*Y?")).not.toMatch(/[\\/:*?"<>|]/);
  });
});
