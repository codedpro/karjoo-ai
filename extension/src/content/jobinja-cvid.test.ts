import { describe, expect, it } from "vitest";

import { extractCvId } from "@ext/content/jobinja-cvid";

describe("extractCvId", () => {
  it("cvId را از URLِ cv-builder می‌کشد (اولین قطعه، نه نامِ بخش)", () => {
    expect(extractCvId("https://jobinja.ir/api/v10/jobseeker-app/cv-builder/L1VB/basic-data")).toBe("L1VB");
    expect(extractCvId("/api/v10/jobseeker-app/cv-builder/Abc9/personal")).toBe("Abc9");
    expect(extractCvId("https://jobinja.ir/api/v10/jobseeker-app/cv-builder/L1VB/cv-file?x=1")).toBe("L1VB");
  });

  it("بخش‌ها یا URLِ نامرتبط → null", () => {
    expect(extractCvId("https://jobinja.ir/api/v10/notifications/employee")).toBeNull();
    expect(extractCvId("https://jobinja.ir/jobs")).toBeNull();
    expect(extractCvId("https://jobinja.ir/api/v10/jobseeker-app/cv-builder/basic-data/x")).toBeNull();
  });
});
