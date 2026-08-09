/**
 * پارسِ پارامترهای صفحه‌ی اپلای‌ها.
 *
 * این لایه ورودیِ **دستِ کاربر در URL** را می‌گیرد، پس باید هر چیزِ نامعتبر را بی‌سروصدا
 * به پیش‌فرضِ امن ببرد — نه خطا بدهد و نه اجازه‌ی کشیدنِ کلِ جدول را.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseApplicationQuery,
} from "@/lib/apply/applications-query";

describe("parseApplicationQuery", () => {
  it("پیش‌فرض: مرتب‌سازی بر اساسِ زمانِ ارسال، نزولی، صفحه‌ی ۱", () => {
    expect(parseApplicationQuery({})).toEqual({
      status: null,
      q: null,
      sort: "applied",
      dir: "desc",
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it("مقادیرِ معتبر را نگه می‌دارد", () => {
    const r = parseApplicationQuery({
      status: "interview",
      sort: "posted",
      dir: "asc",
      page: "3",
      q: " react ",
    });
    expect(r.status).toBe("interview");
    expect(r.sort).toBe("posted");
    expect(r.dir).toBe("asc");
    expect(r.page).toBe(3);
    expect(r.q).toBe("react");
  });

  it("وضعیت/مرتب‌سازیِ ناشناخته را به پیش‌فرض می‌برد (نه خطا)", () => {
    const r = parseApplicationQuery({ status: "'; drop table--", sort: "url", dir: "sideways" });
    expect(r.status).toBeNull();
    expect(r.sort).toBe("applied");
    expect(r.dir).toBe("desc");
  });

  it("صفحه‌ی صفر/منفی/غیرعددی → صفحه‌ی ۱", () => {
    for (const page of ["0", "-4", "abc", ""]) {
      expect(parseApplicationQuery({ page }).page).toBe(1);
    }
  });

  it("اندازه‌ی صفحه سقف و کف دارد — با pageSize=۱۰۰۰ نمی‌شود کلِ جدول را کشید", () => {
    expect(parseApplicationQuery({ pageSize: "1000" }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(parseApplicationQuery({ pageSize: "1" }).pageSize).toBe(5);
    expect(parseApplicationQuery({ pageSize: "40" }).pageSize).toBe(40);
  });

  it("عبارتِ جست‌وجوی خیلی بلند بریده می‌شود", () => {
    expect(parseApplicationQuery({ q: "x".repeat(500) }).q).toHaveLength(80);
  });

  it("جست‌وجوی فقط-فاصله یعنی بدونِ جست‌وجو", () => {
    expect(parseApplicationQuery({ q: "   " }).q).toBeNull();
  });
});
