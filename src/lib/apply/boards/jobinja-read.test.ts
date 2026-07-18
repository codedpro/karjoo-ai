import { describe, expect, it } from "vitest";

import { normalizeApplicationStatus, parseAppliedJobs } from "@/lib/apply/boards/jobinja-read";

describe("normalizeApplicationStatus", () => {
  it("نگاشتِ متنِ فارسی به دسته", () => {
    expect(normalizeApplicationStatus("مصاحبه")).toBe("interview");
    expect(normalizeApplicationStatus("دعوت به مصاحبه")).toBe("interview");
    expect(normalizeApplicationStatus("در حال بررسی")).toBe("review");
    expect(normalizeApplicationStatus("دیده شده")).toBe("review");
    expect(normalizeApplicationStatus("در انتظار")).toBe("pending");
    expect(normalizeApplicationStatus("جدید")).toBe("pending");
    expect(normalizeApplicationStatus("رد شده")).toBe("rejected");
    expect(normalizeApplicationStatus("بایگانی شد")).toBe("rejected");
    expect(normalizeApplicationStatus("")).toBe("pending");
    expect(normalizeApplicationStatus("چیزِ ناشناخته")).toBe("other");
  });
});

describe("parseAppliedJobs", () => {
  it("آیتم‌های /jobs/applied را با dedupe و وضعیت پارس می‌کند", () => {
    const html = `
      <ul>
        <li class="c-jobListView__item">
          <a class="c-jobListView__titleLink" href="/jobs/applied/SrK2V">کارشناس نرم‌افزار</a>
          <div class="c-jobListView__meta">اسنپ</div>
          <span class="job-status job-status__active">مصاحبه</span>
        </li>
        <li class="c-jobListView__item">
          <a class="c-jobListView__titleLink" href="/jobs/applied/SrKSx">توسعه‌دهنده بک‌اند</a>
          <div class="c-jobListView__meta">دیجی‌کالا</div>
          <span class="job-status">در انتظار</span>
        </li>
        <!-- duplicate link should be deduped -->
        <a href="/jobs/applied/SrK2V#similar">x</a>
      </ul>`;
    const apps = parseAppliedJobs(html);
    expect(apps.length).toBe(2);
    const first = apps.find((a) => a.externalId === "SrK2V")!;
    expect(first.statusCategory).toBe("interview");
    expect(first.url).toBe("https://jobinja.ir/jobs/applied/SrK2V");
    const second = apps.find((a) => a.externalId === "SrKSx")!;
    expect(second.statusCategory).toBe("pending");
  });

  it("HTMLِ بی‌آیتم → آرایه‌ی خالی (تحمل‌گرا)", () => {
    expect(parseAppliedJobs("<html><body>no applications</body></html>")).toEqual([]);
  });
});
