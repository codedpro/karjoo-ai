import { describe, expect, it } from "vitest";

import {
  normalizeApplicationStatus,
  parseAppliedJobs,
  parseAppliedFromInitState,
} from "@/lib/apply/boards/jobinja-read";

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

/**
 * دو باگی که قیف و زمان‌ها را غلط نشان می‌داد:
 *   • جابینجا برای بخشِ بزرگی از درخواست‌ها `machine_status: "others"` می‌فرستد در حالی که
 *     متنِ نمایشی دقیقاً «بررسی‌شده»/«رد‌شده» است — اعتمادِ کورکورانه به کلیدِ ماشین ۲۹۸
 *     درخواست را در «سایر» می‌ریخت.
 *   • `created_at` (تاریخِ شمسی) اصلاً خوانده نمی‌شد، پس `applied_at` خالی می‌ماند و
 *     داشبورد زمانِ همگام‌سازی را نشان می‌داد — همه‌ی درخواست‌ها «امروز».
 */
describe("normalizeApplicationStatus — اولویتِ ماشین در برابرِ متن", () => {
  it("«others» یعنی نامشخص، پس متنِ فارسی تصمیم می‌گیرد", () => {
    expect(normalizeApplicationStatus("others", "بررسی‌شده")).toBe("review");
    expect(normalizeApplicationStatus("others", "رد‌شده")).toBe("rejected");
    expect(normalizeApplicationStatus("others", "تأیید برای مصاحبه")).toBe("interview");
  });

  it("کلیدِ ماشینِ مشخص بر متن مقدم است", () => {
    expect(normalizeApplicationStatus("interview_accepted", "بررسی‌شده")).toBe("interview");
    expect(normalizeApplicationStatus("hired", "رد‌شده")).toBe("hired");
  });

  it("نیم‌فاصله در متنِ فارسی مانعِ تشخیص نمی‌شود", () => {
    expect(normalizeApplicationStatus(null, "رد\u200cشده")).toBe("rejected");
    expect(normalizeApplicationStatus(null, "بررسی\u200cشده")).toBe("review");
  });

  it("هیچ سیگنالی نبود → در انتظار", () => {
    expect(normalizeApplicationStatus(null, null)).toBe("pending");
  });
});

describe("parseAppliedFromInitState — تاریخِ ارسال", () => {
  const state = {
    applications: {
      data: [
        {
          short_id: "abc123",
          status: "بررسی‌شده",
          machine_status: "others",
          created_at: "۱۷ امرداد ۱۴۰۵",
          job_link: "https://jobinja.ir/companies/x/jobs/t1/y",
          job: {
            title: "Front-End Developer",
            company: { persian_name: "ایکس", english_name: "X Co" },
          },
        },
      ],
    },
  };
  const html = `<div init-state="${JSON.stringify(state).replace(/"/g, "&quot;")}"></div>`;

  it("تاریخِ شمسیِ created_at را به Date تبدیل می‌کند", () => {
    const [row] = parseAppliedFromInitState(html);
    expect(row?.appliedAt).toBeInstanceOf(Date);
    expect(row!.appliedAt!.getUTCFullYear()).toBe(2026);
  });

  it("وضعیت را از متنِ فارسی می‌گیرد، نه از «others»", () => {
    expect(parseAppliedFromInitState(html)[0]?.statusCategory).toBe("review");
  });
});

describe("parseAppliedFromInitState — نامِ شرکت", () => {
  const build = (company: Record<string, string>) => {
    const state = {
      applications: {
        data: [{ short_id: "id1", machine_status: "pending", job: { title: "t", company } }],
      },
    };
    return `<div init-state="${JSON.stringify(state).replace(/"/g, "&quot;")}"></div>`;
  };

  it("نامِ فارسی را ترجیح می‌دهد", () => {
    expect(
      parseAppliedFromInitState(build({ persian_name: "گپلی", english_name: "Gaply" }))[0]?.company,
    ).toBe("گپلی");
  });

  it("اگر فارسی نبود، انگلیسی را می‌گیرد", () => {
    expect(parseAppliedFromInitState(build({ english_name: "Gaply" }))[0]?.company).toBe("Gaply");
  });

  it("شکلِ قدیمیِ `name` هم پشتیبانی می‌شود", () => {
    expect(parseAppliedFromInitState(build({ name: "ایکس" }))[0]?.company).toBe("ایکس");
  });
});
