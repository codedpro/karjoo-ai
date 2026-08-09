/**
 * انتخابِ مشتریانِ واقعی برای هر آگهی.
 *
 * ادعای اصلی: این ماژول هیچ نامی نمی‌سازد — فقط از فهرستِ واقعیِ خودِ کاربر انتخاب و
 * مرتب می‌کند، اول بر اساسِ کشورِ آگهی و بعد ربطِ حوزه.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_CLIENTS,
  describeClients,
  inferTargetCountry,
  selectClientsForJob,
  type ClientEntry,
} from "@/lib/resume/client-selection";

const CLIENTS: ClientEntry[] = [
  { name: "همراه اول", country: "IR", domain: "telecom", work: "داشبورد تحلیل داده", year: 2024 },
  { name: "اسنپ‌فود", country: "IR", domain: "ecommerce", work: "پنل سفارش", year: 2023 },
  { name: "CCTV Master", country: "UK", domain: "ecommerce", work: "storefront builder", year: 2025 },
  { name: "EuroCCTV", country: "UK", domain: "ecommerce", work: "marketplace sync", year: 2024 },
  { name: "Dutch Logistics BV", country: "NL", domain: "logistics", work: "ETL pipeline", year: 2022 },
];

describe("inferTargetCountry", () => {
  it("آگهیِ ایرانی را تشخیص می‌دهد", () => {
    expect(inferTargetCountry("استخدام برنامه‌نویس در تهران")).toBe("IR");
  });
  it("آگهیِ بریتانیا را تشخیص می‌دهد", () => {
    expect(inferTargetCountry("Senior Engineer, London, United Kingdom")).toBe("UK");
  });
  it("آگهیِ بی‌نشانه → null", () => {
    expect(inferTargetCountry("Remote engineer")).toBeNull();
  });
});

describe("selectClientsForJob", () => {
  it("برای آگهیِ ایرانی، مشتریانِ ایرانی جلو می‌آیند", () => {
    const sel = selectClientsForJob(CLIENTS, "برنامه‌نویس در تهران", []);
    expect(sel.targetCountry).toBe("IR");
    expect(sel.clients.slice(0, 2).map((c) => c.country)).toEqual(["IR", "IR"]);
  });

  it("برای آگهیِ بریتانیا، مشتریانِ UK جلو می‌آیند", () => {
    const sel = selectClientsForJob(CLIENTS, "Engineer in London, UK", []);
    expect(sel.clients.slice(0, 2).every((c) => c.country === "UK")).toBe(true);
  });

  it("در هم‌کشوری، ربطِ حوزه تعیین‌کننده است", () => {
    const sel = selectClientsForJob(CLIENTS, "تحلیل داده در تهران", ["telecom", "تحلیل داده"]);
    expect(sel.clients[0]!.name).toBe("همراه اول");
  });

  it("هیچ نامی ساخته نمی‌شود — همه از فهرستِ واقعی‌اند", () => {
    const real = new Set(CLIENTS.map((c) => c.name));
    for (const c of selectClientsForJob(CLIENTS, "anything", ["x"]).clients) {
      expect(real.has(c.name)).toBe(true);
    }
  });

  it("سقفِ تعداد رعایت می‌شود", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ name: `C${i}`, country: "IR" }));
    expect(selectClientsForJob(many, "تهران", []).clients.length).toBe(MAX_CLIENTS);
  });

  it("فهرستِ خالی → انتخابِ خالی (نه خطا)", () => {
    expect(selectClientsForJob([], "تهران", []).clients).toEqual([]);
    expect(describeClients({ clients: [], targetCountry: null })).toBe("");
  });

  it("describeClients نام و کار را کنارِ هم می‌آورد", () => {
    const sel = selectClientsForJob(CLIENTS, "تهران", ["telecom"]);
    expect(describeClients(sel)).toContain("همراه اول (داشبورد تحلیل داده)");
  });
});
