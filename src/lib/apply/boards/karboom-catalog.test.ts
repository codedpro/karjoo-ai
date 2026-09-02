import { describe, expect, it } from "vitest";
import { parseKarboomCatalog } from "@/lib/apply/boards/karboom-catalog";

/**
 * کاربوم دسته، شهر و نوعِ همکاری را در **یک** جعبه و با یک شکلِ نشانی
 * (`/jobs/{slug}`) کنارِ هم می‌گذارد، پس آزمونِ اصلی این است که واقعاً از هم جدا
 * شوند — وگرنه «اصفهان» به‌عنوان دسته‌ی شغلی به کاربر نشان داده می‌شد.
 */
const PAGE = `
<div class="job-categories-box">
  <a href="https://karboom.io/jobs/programming-and-software">استخدام برنامه نویسی</a>
  <a href="https://karboom.io/jobs/sales-marketing">استخدام بازاریابی / تبلیغات / فروش</a>
  <a href="https://karboom.io/jobs/others">استخدام سایر</a>
  <a href="https://karboom.io/jobs/tehran">استخدام تهران</a>
  <a href="https://karboom.io/jobs/isfahan">استخدام اصفهان</a>
  <a href="https://karboom.io/jobs/full-time">استخدام تمام وقت</a>
  <a href="https://karboom.io/jobs/remote">استخدام دورکاری</a>
  <a href="https://karboom.io/jobs/programming-and-software">استخدام برنامه نویسی</a>
</div>
<div class="job-position-cards-box">
  <a href="https://karboom.io/jobs/should-not-appear">استخدام نباید بیاید</a>
</div>
<select class="js-select-city" name="address_city_id[]">
  <option value="-1"></option>
  <option value="87">تهران</option>
  <option value="130">مشهد</option>
</select>`;

describe("parseKarboomCatalog", () => {
  const catalog = parseKarboomCatalog(PAGE);

  it("دسته‌ها را از شهر و نوعِ همکاری جدا می‌کند", () => {
    expect(catalog.categories.map((c) => c.key)).toEqual([
      "programming-and-software",
      "sales-marketing",
      "others",
    ]);
    expect(catalog.employmentTypes.map((c) => c.key)).toEqual(["full-time", "remote"]);
  });

  it("پیشوندِ «استخدام» را از برچسب برمی‌دارد", () => {
    expect(catalog.categories[0]!.label).toBe("برنامه نویسی");
    expect(catalog.employmentTypes[0]!.label).toBe("تمام وقت");
  });

  it("شهرها را با شناسه‌ی عددی از فرمِ جست‌وجو می‌خواند، نه از مسیر", () => {
    // `address_city_id[]` عدد می‌خواهد؛ اسلاگِ مسیر آن‌جا بی‌اثر است.
    expect(catalog.cities).toEqual([
      { key: "87", label: "تهران", englishLabel: "87" },
      { key: "130", label: "مشهد", englishLabel: "130" },
    ]);
  });

  it("لینک‌های بیرونِ جعبه‌ی دسته‌ها را وارد کاتالوگ نمی‌کند", () => {
    expect(catalog.categories.some((c) => c.key === "should-not-appear")).toBe(false);
  });

  it("لینکِ تکراری را دوبار نمی‌آورد", () => {
    expect(catalog.categories.filter((c) => c.key === "programming-and-software")).toHaveLength(1);
  });
});
