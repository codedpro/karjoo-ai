/**
 * تستِ خالصِ قالب‌بندیِ مبلغِ تومان (Track B) — بدونِ DB/شبکه.
 */
import { describe, expect, it } from "vitest";

import { formatSignedToman, formatToman } from "./wallet-format";

describe("formatToman", () => {
  it("جداکننده‌ی هزارگان می‌گذارد", () => {
    expect(formatToman(0)).toBe("0");
    expect(formatToman(1234)).toBe("1,234");
    expect(formatToman(1234567)).toBe("1,234,567");
  });

  it("علامتِ منفی را حفظ می‌کند", () => {
    expect(formatToman(-350)).toBe("-350");
    expect(formatToman(-1000000)).toBe("-1,000,000");
  });

  it("بخشِ اعشاری را حذف می‌کند (تومانِ صحیح)", () => {
    expect(formatToman(999.9)).toBe("999");
  });
});

describe("formatSignedToman", () => {
  it("مثبت را با + می‌آورد", () => {
    expect(formatSignedToman(100_000)).toBe("+100,000");
  });
  it("منفی همان − خودش", () => {
    expect(formatSignedToman(-350)).toBe("-350");
  });
  it("صفر بدونِ علامت", () => {
    expect(formatSignedToman(0)).toBe("0");
  });
});
