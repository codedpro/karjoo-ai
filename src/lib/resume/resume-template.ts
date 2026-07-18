import "server-only";

/**
 * قالبِ رزومه‌ی خودبسنده (HTML + CSSِ درون‌خط) — چاپ/PDF-پسند (A4). خروجی همان چیزی است که
 * ورکر با Playwright به PDF تبدیل و در مسیرِ آپلودِ اپلای می‌فرستد، و کاربر در داشبورد پیش‌نمایش
 * می‌بیند. `dir="auto"` تا فارسی و انگلیسی هر دو درست بنشینند.
 */

export interface ResumeRenderData {
  fullName: string;
  headline?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  links?: { label?: string | null; url: string }[];
  summary: string;
  skills: string[];
  experience: { company?: string | null; title?: string | null; period?: string | null; bullets: string[] }[];
  education?: { school?: string | null; degree?: string | null; period?: string | null }[];
  highlights?: string[];
  /** برچسبِ آگهیِ هدف (برای نمایشِ «هدف‌گیری‌شده برای …»). */
  targetLabel?: string | null;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function contactBits(d: ResumeRenderData): string {
  const bits: string[] = [];
  if (d.email) bits.push(esc(d.email));
  if (d.phone) bits.push(`<span dir="ltr">${esc(d.phone)}</span>`);
  if (d.city) bits.push(esc(d.city));
  for (const l of d.links ?? []) if (l?.url) bits.push(`<a href="${esc(l.url)}">${esc(l.label || l.url)}</a>`);
  return bits.join(" · ");
}

export function renderResumeHtml(d: ResumeRenderData): string {
  const skills = (d.skills ?? []).filter(Boolean);
  const exp = (d.experience ?? []).filter((e) => e && (e.bullets?.length || e.title || e.company));
  const edu = (d.education ?? []).filter((e) => e && (e.school || e.degree));
  const highlights = (d.highlights ?? []).filter(Boolean);

  const skillsHtml = skills.length
    ? `<section><h2>مهارت‌ها</h2><div class="chips">${skills
        .map((s) => `<span class="chip" dir="auto">${esc(s)}</span>`)
        .join("")}</div></section>`
    : "";

  const highlightsHtml = highlights.length
    ? `<section><h2>نکات برجسته</h2><ul>${highlights.map((h) => `<li dir="auto">${esc(h)}</li>`).join("")}</ul></section>`
    : "";

  const expHtml = exp.length
    ? `<section><h2>سوابق شغلی</h2>${exp
        .map(
          (e) => `
      <div class="item">
        <div class="item-head">
          <span class="item-title" dir="auto">${esc(e.title || "")}</span>
          ${e.company ? `<span class="item-sub" dir="auto">${esc(e.company)}</span>` : ""}
          ${e.period ? `<span class="item-period" dir="auto">${esc(e.period)}</span>` : ""}
        </div>
        ${e.bullets?.length ? `<ul>${e.bullets.map((b) => `<li dir="auto">${esc(b)}</li>`).join("")}</ul>` : ""}
      </div>`,
        )
        .join("")}</section>`
    : "";

  const eduHtml = edu.length
    ? `<section><h2>تحصیلات</h2>${edu
        .map(
          (e) => `<div class="item"><div class="item-head">
        <span class="item-title" dir="auto">${esc(e.degree || "")}</span>
        ${e.school ? `<span class="item-sub" dir="auto">${esc(e.school)}</span>` : ""}
        ${e.period ? `<span class="item-period" dir="auto">${esc(e.period)}</span>` : ""}
      </div></div>`,
        )
        .join("")}</section>`
    : "";

  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<title>${esc(d.fullName)} — رزومه</title>
<style>
  @page { size: A4; margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Vazirmatn", "Segoe UI", Tahoma, Arial, sans-serif; color: #1a1d21; margin: 0; font-size: 12px; line-height: 1.6; }
  .resume { max-width: 800px; margin: 0 auto; padding: 8px; }
  header { border-bottom: 2px solid #FFB020; padding-bottom: 10px; margin-bottom: 14px; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  .headline { color: #FFB020; font-weight: 600; font-size: 13px; }
  .contact { color: #556; font-size: 11px; margin-top: 6px; }
  .contact a { color: #556; text-decoration: none; }
  h2 { font-size: 13px; color: #1a1d21; border-bottom: 1px solid #e3e6ea; padding-bottom: 3px; margin: 16px 0 8px; }
  section { margin-bottom: 4px; }
  p.summary { margin: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { background: #f4f6f8; border: 1px solid #e3e6ea; border-radius: 999px; padding: 2px 10px; font-size: 11px; }
  .item { margin-bottom: 10px; }
  .item-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
  .item-title { font-weight: 700; }
  .item-sub { color: #445; }
  .item-period { color: #889; font-size: 11px; margin-inline-start: auto; }
  ul { margin: 4px 0 0; padding-inline-start: 18px; }
  li { margin-bottom: 2px; }
  .target { color: #889; font-size: 10px; margin-top: 4px; }
</style></head>
<body><div class="resume">
  <header>
    <h1 dir="auto">${esc(d.fullName)}</h1>
    ${d.headline ? `<div class="headline" dir="auto">${esc(d.headline)}</div>` : ""}
    <div class="contact">${contactBits(d)}</div>
    ${d.targetLabel ? `<div class="target">هدف‌گیری‌شده برای: ${esc(d.targetLabel)}</div>` : ""}
  </header>
  ${d.summary ? `<section><h2>خلاصه</h2><p class="summary" dir="auto">${esc(d.summary)}</p></section>` : ""}
  ${highlightsHtml}
  ${expHtml}
  ${skillsHtml}
  ${eduHtml}
</div></body></html>`;
}
