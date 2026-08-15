import "server-only";

/**
 * قالب‌های رزومه — چند طرحِ چاپ‌آماده‌ی A4 که کاربر می‌تواند یکی را انتخاب کند یا
 * «تصادفی» بگذارد تا هر آگهی طرحِ متفاوتی بگیرد.
 *
 * سه اصلِ طراحی:
 *   ۱) **هیچ نشانه‌ای از تولیدِ خودکار** — رزومه نباید بگوید «هدف‌گیری‌شده برای فلان شرکت».
 *      کارفرما باید یک رزومه‌ی حرفه‌ایِ معمولی ببیند، نه خروجیِ یک ابزار.
 *   ۲) **دوزبانه** — فارسی (RTL) و انگلیسی (LTR)؛ عنوان‌های بخش‌ها و جهتِ صفحه با زبان
 *      عوض می‌شوند، نه فقط ترجمه‌ی محتوا.
 *   ۳) **پُر و کامل** — فاصله‌ها و اندازه‌ها طوری‌اند که یک سابقه‌ی واقعی معمولاً دو صفحه
 *      شود، نه یک صفحه‌ی خلوت.
 */

export type ResumeLang = "fa" | "en";
export type ResumeTemplateId = "classic" | "modern" | "compact" | "signature";

/** شناسه‌های قابلِ انتخاب + «تصادفی». */
export const RESUME_TEMPLATE_IDS: ResumeTemplateId[] = ["classic", "modern", "compact", "signature"];

export interface ResumeTemplateMeta {
  id: ResumeTemplateId;
  labelFa: string;
  labelEn: string;
  descriptionFa: string;
}

export const RESUME_TEMPLATES: ResumeTemplateMeta[] = [
  {
    id: "classic",
    labelFa: "کلاسیک",
    labelEn: "Classic",
    descriptionFa: "تک‌ستونه، تیترهای خط‌دار — بی‌سر‌و‌صدا و مناسبِ همه‌ی صنعت‌ها.",
  },
  {
    id: "modern",
    labelFa: "مدرن",
    labelEn: "Modern",
    descriptionFa: "دو‌ستونه با نوارِ کناریِ مهارت‌ها و تماس — خواناتر برای نقش‌های فنی.",
  },
  {
    id: "signature",
    labelFa: "امضا",
    labelEn: "Signature",
    descriptionFa: "طرحِ شخصیِ کاربر: نامِ دو‌رنگ، نوارِ آمار، تیترهای آبیِ خط‌دار و جدولِ مهارت‌ها.",
  },
  {
    id: "compact",
    labelFa: "فشرده",
    labelEn: "Compact",
    descriptionFa: "چگالیِ بالا برای سابقه‌ی طولانی — بیشترین محتوا در کمترین صفحه.",
  },
];

/** برچسبِ بخش‌ها به دو زبان. */
const L: Record<ResumeLang, Record<string, string>> = {
  fa: {
    summary: "خلاصه",
    highlights: "نکات برجسته",
    experience: "سوابق شغلی",
    skills: "مهارت‌ها",
    education: "تحصیلات",
    contact: "اطلاعات تماس",
    languages: "زبان‌ها",
  },
  en: {
    summary: "Summary",
    highlights: "Highlights",
    experience: "Experience",
    skills: "Skills",
    education: "Education",
    contact: "Contact",
    languages: "Languages",
  },
};

export interface ResumeTemplateData {
  fullName: string;
  headline?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  links?: { label?: string | null; url: string }[];
  summary: string;
  skills: string[];
  experience: {
    company?: string | null;
    title?: string | null;
    period?: string | null;
    /** یک جمله‌ی زمینه پیش از bulletها — کاری که کاربر در آن نقش انجام داد. */
    context?: string | null;
    bullets: string[];
  }[];
  education?: { school?: string | null; degree?: string | null; period?: string | null }[];
  highlights?: string[];
  lang?: ResumeLang;
  /** «۸+ سال تجربه · ۲۰۰+ پروژه …» — نوارِ آمارِ بالای رزومه (قالبِ signature). */
  stats?: { label: string; value: string }[];
  /** خطِ در‌دسترس‌بودن («دورکار · قراردادِ بین‌المللی …»). */
  availability?: string[];
  /** زبان‌ها (نام + سطح). */
  languages?: { name: string; level?: string | null }[];
  /** مهارت‌های دسته‌بندی‌شده — «Frontend: React, Next.js …» مثلِ رزومه‌ی خودِ کاربر. */
  skillGroups?: { label: string; items: string[] }[];
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * متنِ رزومه با **تأکیدِ کنترل‌شده**.
 *
 * یک رزومه‌ی حرفه‌ای با bold هدایت می‌شود: خواننده‌ی عجول در چند ثانیه تکنولوژی‌ها و
 * دستاوردهای کلیدی را می‌گیرد. ولی نمی‌توان HTMLِ خامِ مدل را رندر کرد (تزریق/خرابیِ
 * چیدمان). پس **اول escape** می‌کنیم و بعد فقط الگوی `**متن**` را به <strong> تبدیل
 * می‌کنیم — تنها نشانه‌گذاریِ مجاز.
 */
function rich(s: unknown): string {
  return esc(s).replace(/\*\*([^*]{1,120})\*\*/g, "<strong>$1</strong>");
}

/** پروفایل‌ها اغلب لینک را بدونِ اسکیم ذخیره می‌کنند («github.com/x») — بدونِ اصلاح، در
 *  PDF کلیک‌ناپذیر یا نسبی می‌شود. */
export function absoluteUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(u) || u.startsWith("mailto:") ? u : `https://${u}`;
}

/** متنِ نمایشیِ لینک: بدونِ اسکیم و بدونِ www و اسلشِ پایانی (مثلِ رزومه‌ی خودِ کاربر). */
function linkText(l: { label?: string | null; url: string }): string {
  const bare = l.url.replace(/^[a-z]+:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return l.label ? `${l.label} ${bare}` : bare;
}

function contactBits(d: ResumeTemplateData): string[] {
  const bits: string[] = [];
  if (d.email) bits.push(`<a class="lk" href="mailto:${esc(d.email)}">${esc(d.email)}</a>`);
  if (d.phone) bits.push(`<span dir="ltr">${esc(d.phone)}</span>`);
  if (d.city) bits.push(esc(d.city));
  for (const l of d.links ?? []) {
    if (!l?.url) continue;
    bits.push(`<a class="lk" href="${esc(absoluteUrl(l.url))}">${esc(linkText(l))}</a>`);
  }
  return bits;
}

/**
 * انتخابِ قالب. `pref` می‌تواند شناسه‌ی یک قالب یا "shuffle" باشد؛ در حالتِ shuffle از
 * `seed` (مثلاً شناسه‌ی آگهی) استفاده می‌شود تا انتخاب **قطعی** بماند — یعنی رندرِ دوباره‌ی
 * همان اپلای همان طرح را بدهد (بایگانی نباید با هر بازدید عوض شود).
 */
export function pickTemplate(pref: string | null | undefined, seed = ""): ResumeTemplateId {
  const p = (pref ?? "").trim().toLowerCase();
  if (RESUME_TEMPLATE_IDS.includes(p as ResumeTemplateId)) return p as ResumeTemplateId;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return RESUME_TEMPLATE_IDS[h % RESUME_TEMPLATE_IDS.length]!;
}

/** نامِ فایلِ رزومه: «نام کامل _ نامِ شرکت» — بدونِ هیچ نشانه‌ای از تولیدِ خودکار. */
export function resumeFileName(fullName: string, company?: string | null): string {
  // بوردها اغلب نامِ شرکت را دوزبانه می‌دهند («وت‌پرو | VetPro»). برای نامِ فایل یک نسخه
  // کافی است — لاتین را ترجیح می‌دهیم چون در همه‌ی سیستم‌عامل‌ها و ایمیل‌ها امن‌تر است.
  const pickOne = (v: string) => {
    const parts = v.split(/[|/–—]/).map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return v;
    return parts.find((x) => /^[\x00-\x7F\s.&'-]+$/.test(x)) ?? parts[0]!;
  };
  const clean = (v: string) =>
    v
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/ /g, "_");
  const name = clean(fullName || "Resume");
  const co = company ? clean(pickOne(company)) : "";
  return co ? `${name}_${co}.pdf` : `${name}.pdf`;
}

/* ──────────────────────────────  رندرها  ────────────────────────────────── */

function head(d: ResumeTemplateData, lang: ResumeLang, css: string): string {
  const dir = lang === "fa" ? "rtl" : "ltr";
  return `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8">
<title>${esc(d.fullName)}</title>
<style>${css}</style></head>`;
}

const BASE_CSS = `
  .item-ctx { color:#475569; margin:2px 0 4px; }

  @page { size: A4; margin: 14mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Vazirmatn","Segoe UI",Tahoma,Arial,sans-serif; color:#1a1d21; margin:0; font-size:11.5px; line-height:1.75; }
  a { color:inherit; text-decoration:none; }
  h1 { font-size:23px; margin:0 0 3px; letter-spacing:-.2px; }
  h2 { font-size:12.5px; text-transform:uppercase; letter-spacing:.6px; margin:16px 0 8px; }
  ul { margin:5px 0 0; padding-inline-start:17px; }
  li { margin-bottom:3px; }
  .headline { font-weight:600; font-size:13px; }
  .contact { color:#555f6a; font-size:10.5px; margin-top:6px; }
  .item { margin-bottom:11px; break-inside:avoid; }
  .item-head { display:flex; flex-wrap:wrap; gap:8px; align-items:baseline; }
  .item-title { font-weight:700; }
  .item-sub { color:#3d4650; }
  .item-period { color:#8a929b; font-size:10.5px; margin-inline-start:auto; white-space:nowrap; }
  .chips { display:flex; flex-wrap:wrap; gap:5px; }
  .chip { background:#f3f5f7; border:1px solid #e2e6ea; border-radius:999px; padding:2px 9px; font-size:10.5px; }
`;

function sectionsHtml(d: ResumeTemplateData, t: Record<string, string>, opts: { skills: boolean }): string {
  const exp = (d.experience ?? []).filter((e) => e && (e.bullets?.length || e.title || e.company));
  const edu = (d.education ?? []).filter((e) => e && (e.school || e.degree));
  const hi = (d.highlights ?? []).filter(Boolean);
  const sk = (d.skills ?? []).filter(Boolean);

  return [
    d.summary ? `<section><h2>${t.summary}</h2><p dir="auto">${rich(d.summary)}</p></section>` : "",
    hi.length
      ? `<section><h2>${t.highlights}</h2><ul>${hi.map((h) => `<li dir="auto">${rich(h)}</li>`).join("")}</ul></section>`
      : "",
    exp.length
      ? `<section><h2>${t.experience}</h2>${exp
          .map(
            (e) => `<div class="item"><div class="item-head">
        <span class="item-title" dir="auto">${esc(e.title || "")}</span>
        ${e.company ? `<span class="item-sub" dir="auto">${esc(e.company)}</span>` : ""}
        ${e.period ? `<span class="item-period" dir="auto">${esc(e.period)}</span>` : ""}
      </div>${e.context ? `<div class="item-ctx" dir="auto">${rich(e.context)}</div>` : ""}${e.bullets?.length ? `<ul>${e.bullets.map((b) => `<li dir="auto">${rich(b)}</li>`).join("")}</ul>` : ""}</div>`,
          )
          .join("")}</section>`
      : "",
    opts.skills && sk.length
      ? `<section><h2>${t.skills}</h2><div class="chips">${sk.map((s) => `<span class="chip" dir="auto">${esc(s)}</span>`).join("")}</div></section>`
      : "",
    edu.length
      ? `<section><h2>${t.education}</h2>${edu
          .map(
            (e) => `<div class="item"><div class="item-head">
        <span class="item-title" dir="auto">${esc(e.degree || "")}</span>
        ${e.school ? `<span class="item-sub" dir="auto">${esc(e.school)}</span>` : ""}
        ${e.period ? `<span class="item-period" dir="auto">${esc(e.period)}</span>` : ""}
      </div></div>`,
          )
          .join("")}</section>`
      : "",
  ].join("");
}

function renderClassic(d: ResumeTemplateData, lang: ResumeLang): string {
  const t = L[lang];
  const css = `${BASE_CSS}
  .wrap { max-width:820px; margin:0 auto; }
  header { border-bottom:2.5px solid #FFB020; padding-bottom:11px; margin-bottom:6px; }
  h2 { color:#1a1d21; border-bottom:1px solid #e4e8ec; padding-bottom:4px; }`;
  return `${head(d, lang, css)}<body><div class="wrap">
  <header>
    <h1 dir="auto">${esc(d.fullName)}</h1>
    ${d.headline ? `<div class="headline" dir="auto" style="color:#c8860d">${esc(d.headline)}</div>` : ""}
    <div class="contact">${contactBits(d).join(" · ")}</div>
  </header>
  ${sectionsHtml(d, t, { skills: true })}
</div></body></html>`;
}

function renderModern(d: ResumeTemplateData, lang: ResumeLang): string {
  const t = L[lang];
  const sk = (d.skills ?? []).filter(Boolean);
  const css = `${BASE_CSS}
  .grid { display:grid; grid-template-columns: 1fr 200px; gap:22px; max-width:840px; margin:0 auto; }
  .side { background:#f7f9fb; border:1px solid #e6eaee; border-radius:9px; padding:13px; align-self:start; }
  .side h2 { margin-top:12px; font-size:11.5px; color:#4a5560; }
  .side h2:first-child { margin-top:0; }
  .side .chip { background:#fff; }
  header { border-bottom:3px solid #1a1d21; padding-bottom:11px; margin-bottom:10px; }
  h2 { color:#1a1d21; }`;
  return `${head(d, lang, css)}<body>
  <header>
    <h1 dir="auto">${esc(d.fullName)}</h1>
    ${d.headline ? `<div class="headline" dir="auto">${esc(d.headline)}</div>` : ""}
  </header>
  <div class="grid">
    <main>${sectionsHtml(d, t, { skills: false })}</main>
    <aside class="side">
      <h2>${t.contact}</h2>
      <div class="contact" style="margin:0">${contactBits(d).join("<br>")}</div>
      ${sk.length ? `<h2>${t.skills}</h2><div class="chips">${sk.map((s) => `<span class="chip" dir="auto">${esc(s)}</span>`).join("")}</div>` : ""}
    </aside>
  </div></body></html>`;
}

function renderCompact(d: ResumeTemplateData, lang: ResumeLang): string {
  const t = L[lang];
  const css = `${BASE_CSS}
  body { font-size:10.8px; line-height:1.62; }
  .wrap { max-width:800px; margin:0 auto; }
  header { margin-bottom:4px; }
  h1 { font-size:20px; }
  h2 { margin:12px 0 6px; color:#c8860d; border-bottom:1px dotted #d9dee3; padding-bottom:3px; }
  .item { margin-bottom:8px; }`;
  return `${head(d, lang, css)}<body><div class="wrap">
  <header>
    <h1 dir="auto">${esc(d.fullName)}</h1>
    ${d.headline ? `<div class="headline" dir="auto">${esc(d.headline)}</div>` : ""}
    <div class="contact">${contactBits(d).join(" · ")}</div>
  </header>
  ${sectionsHtml(d, t, { skills: true })}
</div></body></html>`;
}


/**
 * قالبِ «امضا» — بازسازیِ طرحِ رزومه‌ی خودِ کاربر: نامِ دو‌رنگ (نامِ خانوادگی با رنگِ تأکید)،
 * نوارِ آمار، خطِ در‌دسترس‌بودن، تماسِ کلیک‌پذیر، تیترهای آبیِ حروف‌فاصله‌دار با خطِ زیر،
 * جدولِ برچسب/مقدارِ مهارت‌ها، تاریخ‌های راست‌چین در سوابق، و تحصیلات/زبان‌ها کنارِ هم.
 */
function renderSignature(d: ResumeTemplateData, lang: ResumeLang): string {
  const t = L[lang];
  const A = "#2563eb"; // آبیِ تأکید، همان طرحِ کاربر
  const css = `${BASE_CSS}
  body { font-size:11px; line-height:1.62; color:#0f172a; }
  .wrap { max-width:840px; margin:0 auto; }
  h1 { font-size:29px; font-weight:800; letter-spacing:-.6px; margin:0 0 2px; }
  h1 .last { color:${A}; }
  .role { font-weight:700; font-size:13.5px; margin-bottom:3px; }
  .pitch { color:#475569; margin-bottom:7px; }
  .stats, .avail, .contact { font-size:10.5px; margin-bottom:4px; }
  .stats b { color:#0f172a; }
  .stats span, .avail span, .contact span { color:#64748b; }
  .dot { color:#cbd5e1; padding:0 6px; }
  .avail { color:${A}; font-weight:600; }
  .lk { color:${A}; font-weight:600; }
  h2 { color:${A}; font-size:10.5px; font-weight:800; letter-spacing:1.1px;
       border-bottom:1px solid #e2e8f0; padding-bottom:3px; margin:14px 0 8px; }
  .sk { display:grid; grid-template-columns:112px 1fr; gap:2px 12px; }
  .sk dt { color:#64748b; }
  .sk dd { margin:0; }
  .item-period { color:#64748b; font-weight:600; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
  .lang b { display:inline-block; min-width:70px; }`;

  const parts = (d.fullName || "").trim().split(/\s+/);
  const last = parts.length > 1 ? parts.pop()! : "";
  const first = parts.join(" ");

  const stats = (d.stats ?? []).filter((x) => x?.value);
  const avail = (d.availability ?? []).filter(Boolean);
  const groups = (d.skillGroups ?? []).filter((g) => g?.items?.length);
  const exp = (d.experience ?? []).filter((e) => e && (e.bullets?.length || e.title || e.company));
  const edu = (d.education ?? []).filter((e) => e && (e.school || e.degree));
  const langs = (d.languages ?? []).filter((l) => l?.name);
  const hi = (d.highlights ?? []).filter(Boolean);
  const sk = (d.skills ?? []).filter(Boolean);
  const join = (xs: string[]) => xs.join('<span class="dot">·</span>');

  return `${head(d, lang, css)}<body><div class="wrap">
  <h1 dir="auto">${esc(first)}${last ? ` <span class="last">${esc(last)}</span>` : ""}</h1>
  ${d.headline ? `<div class="role" dir="auto">${esc(d.headline)}</div>` : ""}
  ${stats.length ? `<div class="stats">${join(stats.map((x) => `<b>${esc(x.value)}</b> <span>${esc(x.label)}</span>`))}</div>` : ""}
  ${avail.length ? `<div class="avail">${join(avail.map((a) => esc(a)))}</div>` : ""}
  <div class="contact">${join(contactBits(d))}</div>

  ${d.summary ? `<section><h2>${t.summary}</h2><p dir="auto">${rich(d.summary)}</p></section>` : ""}

  ${
    groups.length
      ? `<section><h2>${t.skills}</h2><dl class="sk">${groups
          .map((g) => `<dt dir="auto">${esc(g.label)}</dt><dd dir="auto">${esc(g.items.join(", "))}</dd>`)
          .join("")}</dl></section>`
      : sk.length
        ? `<section><h2>${t.skills}</h2><div class="chips">${sk.map((x) => `<span class="chip" dir="auto">${esc(x)}</span>`).join("")}</div></section>`
        : ""
  }

  ${hi.length ? `<section><h2>${t.highlights}</h2><ul>${hi.map((h) => `<li dir="auto">${rich(h)}</li>`).join("")}</ul></section>` : ""}

  ${
    exp.length
      ? `<section><h2>${t.experience}</h2>${exp
          .map(
            (e) => `<div class="item"><div class="item-head">
        <span class="item-title" dir="auto">${esc(e.title || "")}</span>
        ${e.company ? `<span class="item-sub" style="color:${A};font-weight:700" dir="auto">${esc(e.company)}</span>` : ""}
        ${e.period ? `<span class="item-period" dir="auto">${esc(e.period)}</span>` : ""}
      </div>${e.context ? `<div class="item-ctx" dir="auto">${rich(e.context)}</div>` : ""}${e.bullets?.length ? `<ul>${e.bullets.map((b) => `<li dir="auto">${rich(b)}</li>`).join("")}</ul>` : ""}</div>`,
          )
          .join("")}</section>`
      : ""
  }

  ${
    edu.length || langs.length
      ? `<div class="two">
      <div>${
        edu.length
          ? `<h2>${t.education}</h2>${edu
              .map(
                (e) => `<div class="item"><div class="item-title" dir="auto">${esc(e.degree || "")}</div>
            <div class="item-sub" dir="auto">${esc(e.school || "")}${e.period ? ` <span class="item-period">${esc(e.period)}</span>` : ""}</div></div>`,
              )
              .join("")}`
          : ""
      }</div>
      <div>${
        langs.length
          ? `<h2>${t.languages}</h2>${langs
              .map((l) => `<div class="lang" dir="auto"><b>${esc(l.name)}</b>${l.level ? ` <span style="color:#64748b">(${esc(l.level)})</span>` : ""}</div>`)
              .join("")}`
          : ""
      }</div>
    </div>`
      : ""
  }
</div></body></html>`;
}

/** رندرِ رزومه با قالب و زبانِ انتخابی. */
export function renderResumeTemplate(
  data: ResumeTemplateData,
  template: ResumeTemplateId = "classic",
): string {
  const lang: ResumeLang = data.lang === "en" ? "en" : "fa";
  switch (template) {
    case "modern":
      return renderModern(data, lang);
    case "compact":
      return renderCompact(data, lang);
    case "signature":
      return renderSignature(data, lang);
    default:
      return renderClassic(data, lang);
  }
}
