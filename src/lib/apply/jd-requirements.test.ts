/**
 * سنجشِ پوششِ نیازمندی‌های آگهی با شواهدِ واقعیِ کاربر.
 *
 * این همان چیزی است که هدف‌گیری را دقیق می‌کند: به‌جای این‌که مدل از دلِ دو متنِ بلند حدس
 * بزند چه چیزی مرتبط است، صریح می‌گوییم «این نیازمندی‌ها شاهد دارند، همه را پوشش بده».
 * و همان خروجی به کاربر می‌گوید این آگهی چه می‌خواهد که او ندارد.
 */
import { describe, expect, it } from "vitest";

import { assessCoverage } from "@/lib/apply/jd-requirements";

const EVIDENCE = [
  "مهارت‌ها: React، Next.js، TypeScript، Node.js، PostgreSQL، Docker",
  "متنِ رزومه: Built REST APIs and deployed with Docker on AWS. Led a team of 10 engineers.",
].join("\n");

describe("assessCoverage", () => {
  it("نیازمندی‌های دارای شاهد را covered و بقیه را missing می‌کند", () => {
    const r = assessCoverage(["React", "PostgreSQL", "Supabase", "Flutter"], EVIDENCE);
    expect(r.covered).toEqual(["React", "PostgreSQL"]);
    expect(r.missing).toEqual(["Supabase", "Flutter"]);
  });

  it("درصدِ پوشش را درست حساب می‌کند", () => {
    expect(assessCoverage(["React", "Supabase"], EVIDENCE).percent).toBe(50);
    expect(assessCoverage(["React", "Docker"], EVIDENCE).percent).toBe(100);
    expect(assessCoverage(["Supabase"], EVIDENCE).percent).toBe(0);
  });

  it("نگارشِ متفاوت را یکی می‌شمارد (Next JS ≡ Next.js)", () => {
    expect(assessCoverage(["Next JS"], EVIDENCE).covered).toEqual(["Next JS"]);
    expect(assessCoverage(["next.js"], EVIDENCE).covered).toEqual(["next.js"]);
  });

  it("فهرستِ خالی → صفر بدونِ NaN", () => {
    const r = assessCoverage([], EVIDENCE);
    expect(r.percent).toBe(0);
    expect(Number.isNaN(r.percent)).toBe(false);
  });

  it("الزاماتِ غیرِفنی هم سنجیده می‌شوند (سابقه‌ی رهبریِ تیم)", () => {
    expect(assessCoverage(["Led a team"], EVIDENCE).covered).toHaveLength(1);
  });
});
