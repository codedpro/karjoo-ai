/**
 * «قوسِ شغلی» — نقشه‌ی پخشِ تکنولوژی‌های خواسته‌شده‌ی آگهی رویِ سوابقِ **واقعیِ** کاربر.
 *
 * مسئله: وقتی فقط فهرستی از مهارت‌ها را به مدل می‌دهیم، همه‌شان را در یکی-دو سابقه‌ی
 * اول تلنبار می‌کند و بقیه‌ی رزومه توخالی می‌ماند؛ یا همان تکنولوژی را در هر پنج شرکت
 * تکرار می‌کند. هیچ‌کدام رزومه‌ی خوبی نیست.
 *
 * این ماژول قبل از فراخوانیِ مدل، **نقشه** می‌کشد:
 *   • هر تکنولوژی به تازه‌ترین سابقه‌ای می‌رود که از نظرِ زمانی جا دارد (tech-timeline)،
 *     چون آگهی معمولاً استکِ امروز را می‌خواهد و تازه‌ترین سابقه بیشتر خوانده می‌شود.
 *   • بارِ هر سابقه سقف دارد تا فهرست بینِ همه‌ی شرکت‌ها پخش شود، نه در یکی جمع.
 *   • هیچ تکنولوژی‌ای به سابقه‌ای نمی‌رود که هنوز وجود نداشته (Claude Code در ۱۳۹۴).
 *
 * چه چیزی این‌جا **ساخته نمی‌شود**: نه شرکتِ جدید، نه بازه‌ی تازه. شرکت‌ها، عنوان‌ها و
 * تاریخ‌ها همان‌هایی می‌مانند که در پروفایلِ کاربر هست؛ فقط تصمیم می‌گیریم کدام تجربه‌ی
 * واقعی را کجای رزومه و با کدام واژگان برجسته کنیم.
 */

import { techFitsPeriod } from "@/lib/resume/tech-timeline";

export interface RoleInput {
  company?: string | null;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  current?: boolean | null;
  description?: string | null;
}

export interface PlannedRole {
  company: string;
  title: string;
  period: string;
  startYear: number | null;
  endYear: number | null;
  /** تکنولوژی‌هایی که این سابقه باید صریح نامشان ببرد. */
  technologies: string[];
}

export interface CareerArc {
  roles: PlannedRole[];
  /** تکنولوژی‌هایی که هیچ سابقه‌ای از نظرِ زمانی جا نداشت — به بخشِ مهارت‌ها می‌روند. */
  unplaced: string[];
}

/** سالِ چهاررقمی را از رشته‌های آزادِ تاریخ بیرون می‌کشد («Mar 2024» → 2024). */
export function extractYear(value: string | null | undefined): number | null {
  const m = /(\d{4})/.exec(value ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1970 && y <= 2100 ? y : null;
}

/** بازه‌ی نمایشیِ سابقه — همان چیزی که کاربر نوشته، دست‌نخورده. */
function periodLabel(role: RoleInput): string {
  const start = role.startDate?.trim() || "";
  const end = role.current ? "Present" : role.endDate?.trim() || "";
  if (start && end) return `${start} – ${end}`;
  return start || end || "";
}

/**
 * حداکثر تکنولوژی برای هر سابقه.
 *
 * چرا سقف: بدونِ آن، تازه‌ترین سابقه هر ۱۵ تکنولوژیِ آگهی را می‌بلعد و بقیه‌ی رزومه
 * بی‌ربط به‌نظر می‌رسد. با سقف، فهرست بینِ شرکت‌ها پخش می‌شود و هر سابقه دلیلی برای
 * خوانده‌شدن دارد.
 */
export const MAX_TECH_PER_ROLE = 7;

/**
 * تکنولوژی‌های خواسته‌شده‌ی آگهی را رویِ سوابقِ واقعی پخش می‌کند.
 *
 * `technologies` باید **از قبل** با شواهدِ کاربر سنجیده شده باشد (خروجیِ `assessCoverage`)
 * — این تابع دربارهٔ داشتن یا نداشتنِ مهارت تصمیم نمی‌گیرد، فقط جای‌گذاری می‌کند.
 */
export function planCareerArc(roles: RoleInput[], technologies: readonly string[]): CareerArc {
  const planned: PlannedRole[] = roles
    .filter((r) => (r.company ?? "").trim() || (r.title ?? "").trim())
    .map((r) => ({
      company: (r.company ?? "").trim(),
      title: (r.title ?? "").trim(),
      period: periodLabel(r),
      startYear: extractYear(r.startDate),
      endYear: r.current ? null : extractYear(r.endDate),
      technologies: [] as string[],
    }));

  if (planned.length === 0) return { roles: [], unplaced: [...technologies] };

  // تازه‌ترین اول: سابقه‌ی جاری (بدونِ سالِ پایان) جدیدترین است.
  const byRecency = [...planned].sort((a, b) => {
    const ae = a.endYear ?? 9999;
    const be = b.endYear ?? 9999;
    if (ae !== be) return be - ae;
    return (b.startYear ?? 0) - (a.startYear ?? 0);
  });

  const unplaced: string[] = [];
  for (const tech of technologies) {
    // اولین سابقه‌ای (از تازه به قدیم) که هم جا دارد و هم از نظرِ زمانی ممکن است.
    const target =
      byRecency.find(
        (r) => r.technologies.length < MAX_TECH_PER_ROLE && techFitsPeriod(tech, r),
      ) ??
      // همه پُر شدند → سراغِ هر سابقه‌ای که فقط از نظرِ زمانی ممکن است.
      byRecency.find((r) => techFitsPeriod(tech, r));
    if (target) target.technologies.push(tech);
    else unplaced.push(tech);
  }

  return { roles: planned, unplaced };
}

/** نقشه را به متنی تبدیل می‌کند که مستقیم داخلِ پرامپت می‌نشیند. */
export function describeArc(arc: CareerArc): string {
  if (arc.roles.length === 0) return "";
  const lines = arc.roles.map((r) => {
    const head = [r.title, r.company].filter(Boolean).join(" — ");
    const when = r.period ? ` (${r.period})` : "";
    const techs = r.technologies.length
      ? `: ${r.technologies.join("، ")}`
      : ": (تکنولوژیِ خاصی از آگهی به این سابقه نرسید — دستاوردِ واقعیِ خودش را بنویس)";
    return `• ${head}${when}${techs}`;
  });
  return lines.join("\n");
}
