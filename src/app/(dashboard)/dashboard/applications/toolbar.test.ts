/**
 * ساختِ URLِ فیلتر/مرتب‌سازی/صفحه‌بندی.
 *
 * ادعای اصلی: هر تغییرِ فیلتر صفحه را به ۱ برمی‌گرداند، ولی جابه‌جاییِ صفحه بقیه‌ی
 * وضعیت را دست نمی‌زند — وگرنه کاربر در صفحه‌ی ۷ فیلتر می‌زند و به فهرستِ خالی می‌رسد.
 */
import { describe, expect, it } from "vitest";

import { buildUrl, type ToolbarState } from "./toolbar";

const BASE: ToolbarState = {
  status: null,
  q: null,
  sort: "applied",
  dir: "desc",
  page: 1,
  pageSize: 25,
};

describe("buildUrl", () => {
  it("وضعیتِ پیش‌فرض هیچ پارامتری در URL نمی‌گذارد", () => {
    expect(buildUrl(BASE, {})).toBe("/dashboard/applications");
  });

  it("فیلترِ وضعیت را می‌گذارد", () => {
    expect(buildUrl(BASE, { status: "interview" })).toBe(
      "/dashboard/applications?status=interview",
    );
  });

  it("تغییرِ فیلتر، صفحه را به ۱ برمی‌گرداند", () => {
    const onPage7 = { ...BASE, page: 7 };
    expect(buildUrl(onPage7, { status: "review" })).toBe("/dashboard/applications?status=review");
  });

  it("تغییرِ مرتب‌سازی هم صفحه را به ۱ برمی‌گرداند", () => {
    expect(buildUrl({ ...BASE, page: 4 }, { sort: "posted" })).toBe(
      "/dashboard/applications?sort=posted",
    );
  });

  it("جابه‌جاییِ صفحه بقیه‌ی وضعیت را نگه می‌دارد", () => {
    const state: ToolbarState = { ...BASE, status: "rejected", q: "react", sort: "posted" };
    const url = buildUrl(state, { page: 3 });
    expect(url).toContain("status=rejected");
    expect(url).toContain("q=react");
    expect(url).toContain("sort=posted");
    expect(url).toContain("page=3");
  });

  it("پاک‌کردنِ جست‌وجو پارامتر را حذف می‌کند", () => {
    expect(buildUrl({ ...BASE, q: "react" }, { q: null })).toBe("/dashboard/applications");
  });

  it("عبارتِ جست‌وجو encode می‌شود", () => {
    expect(buildUrl(BASE, { q: "front end" })).toBe("/dashboard/applications?q=front+end");
  });
});
