"use client";

/**
 * مدیریتِ رزومه (client component) — آپلودِ PDF → پردازشِ AI → ویرایش و ذخیره.
 *
 * سه گام (هر گام مستقل و قابلِ تکرار):
 *   ۱) آپلود: فایلِ PDF را با multipart به POST /api/resume/upload می‌فرستد؛ سرور متن
 *      را استخراج می‌کند و رکورد می‌سازد. resumeFileId برمی‌گردد.
 *   ۲) پردازش: POST /api/resume/parse با resumeFileId → فیلدهای ساخت‌یافته‌ی AI.
 *   ۳) ویرایش/ذخیره: کاربر فیلدها را تصحیح می‌کند و با PATCH /api/resume/profile ذخیره.
 *
 * این کامپوننت هیچ توکن/رازی نمی‌بیند؛ فقط با نشستِ کوکیِ httpOnly کار می‌کند (مرورگر
 * خودش کوکی را می‌فرستد). پس از ذخیره، router.refresh تا RSCها داده‌ی تازه را بخوانند.
 *
 * زبانِ بصری روی پرایمیتیوهای مشترک (Card/Button) و آیکن‌های SVG سوار است (بدونِ ایموجی)؛
 * هر گام شماره‌ی گامِ خودش را در یک نشانِ گِرد دارد تا سلسله‌مراتب روشن باشد.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Card, cn, toFaDigits } from "./ui";
import {
  IconClose,
  IconDoc,
  IconPlus,
  IconSparkle,
  IconUpload,
} from "./track-icons";
import { CostHint, FreeBadge, TopupPrompt } from "./paid-action";
import { AiMaintenanceBanner } from "./ai-maintenance-banner";
import {
  readPaidActionResponse,
  type CostEstimate,
  type TopupNeeded,
} from "@/lib/billing/ui";
import {
  detectMaintenance,
  maintenanceMessage,
  type AiStatus,
} from "@/lib/billing/guardrail-ui";

/** فیلدهای قابلِ‌ویرایشِ پروفایل (هم‌شکل با خروجیِ parse/profile API). */
export interface EditableProfile {
  fullName: string;
  headline: string;
  city: string;
  yearsExperience: string; // به‌صورتِ رشته در فرم؛ هنگامِ ذخیره به عدد تبدیل می‌شود.
  skills: string[];
}

const EMPTY_PROFILE: EditableProfile = {
  fullName: "",
  headline: "",
  city: "",
  yearsExperience: "",
  skills: [],
};

/** ارقامِ فارسی/عربی → لاتین (برای فیلدِ سال‌های سابقه). */
function toLatinDigits(raw: string): string {
  const map: Record<string, string> = {
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  return raw.replace(/[۰-۹٠-٩]/g, (d) => map[d] ?? d);
}

interface ApiProfile {
  fullName: string;
  headline: string | null;
  city: string | null;
  yearsExperience: number | null;
  skills: string[];
}

function fromApiProfile(p: ApiProfile): EditableProfile {
  return {
    fullName: p.fullName ?? "",
    headline: p.headline ?? "",
    city: p.city ?? "",
    yearsExperience:
      typeof p.yearsExperience === "number" ? String(p.yearsExperience) : "",
    skills: Array.isArray(p.skills) ? p.skills : [],
  };
}

/** نشانِ شماره‌ی گام — دایره‌ی برندی با رقمِ فارسی، برای سلسله‌مراتبِ روشنِ گام‌ها. */
function StepBadge({ n }: { n: number }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/12 text-sm font-bold text-brand"
      aria-hidden
    >
      {toFaDigits(n)}
    </span>
  );
}

export function ResumeManager({
  initialProfile,
  parseCostEstimate = null,
  balanceToman,
}: {
  initialProfile: ApiProfile | null;
  /**
   * تخمینِ هزینه‌ی «پردازشِ AIِ رزومه» (resume_parse) — کنشِ پولی. اگر کاتالوگ خالی
   * بود null می‌رسد و نشانِ هزینه نمایش داده نمی‌شود.
   */
  parseCostEstimate?: CostEstimate | null;
  /** موجودیِ فعلیِ کیف‌پول (برای نمایش در پرامپتِ شارژ). اختیاری. */
  balanceToman?: number;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<EditableProfile>(
    initialProfile ? fromApiProfile(initialProfile) : EMPTY_PROFILE,
  );
  const [resumeFileId, setResumeFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "parse" | "save">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState("");
  // پرامپتِ «نیازمندِ شارژ» — هنگامِ پاسخِ ۴۰۲ از پردازشِ پولی پر می‌شود.
  const [topup, setTopup] = useState<TopupNeeded | null>(null);
  // وضعیتِ نگه‌داریِ هوش مصنوعی — از بنر (poll /api/ai-status) می‌آید؛ در حالتِ نگه‌داری
  // دکمه‌ی پردازشِ پولی غیرفعال می‌شود (کنشِ پولی همان‌جا سمتِ سرور هم ۵۰۳ می‌گیرد).
  const [aiMaintenance, setAiMaintenance] = useState(false);

  async function handleUpload(file: File) {
    setError(null);
    setNotice(null);
    setBusy("upload");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume/upload", {
        method: "POST",
        body: form,
      });
      const data: {
        error?: string;
        resumeFile?: { id: string; hasText: boolean };
        extractedTextLength?: number;
      } = await res.json().catch(() => ({}));

      if (!res.ok || !data.resumeFile) {
        setError(data.error ?? "آپلودِ فایل ناموفق بود.");
        return;
      }

      setResumeFileId(data.resumeFile.id);
      if (!data.resumeFile.hasText) {
        setNotice(
          "فایل آپلود شد ولی متنی از آن استخراج نشد (احتمالاً PDF اسکن‌شده/تصویری است). می‌توانید فیلدها را دستی وارد کنید.",
        );
        return;
      }
      setNotice(
        `فایل آپلود و متنِ آن استخراج شد (${toFaDigits(
          data.extractedTextLength ?? 0,
        )} نویسه). حالا «پردازش با هوش مصنوعی» را بزنید.`,
      );
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(null);
    }
  }

  async function handleParse() {
    if (!resumeFileId) return;
    setError(null);
    setNotice(null);
    setTopup(null);
    setBusy("parse");
    try {
      const res = await fetch("/api/resume/parse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeFileId }),
      });

      // حالتِ نگه‌داریِ هوش مصنوعی (۵۰۳ + code=ai_maintenance): پیامِ نگه‌داری را نشان بده
      // و دکمه را غیرفعال نگه دار — این یک خطای موقتیِ سرویس است نه خطای کاربر.
      const maintBody: unknown = await res
        .clone()
        .json()
        .catch(() => null);
      const maint = detectMaintenance(res.status, maintBody);
      if (maint) {
        setAiMaintenance(true);
        setError(maintenanceMessage(maint.reason));
        return;
      }

      // پردازشِ پولی: پاسخ را با کمکِ helperِ مشترک می‌خوانیم تا ۴۰۲ (نیازمندِ شارژ)
      // به پرامپتِ شارژ تبدیل شود نه یک خطای متنیِ ساده.
      const outcome = await readPaidActionResponse<{ profile?: ApiProfile }>(res);

      if (outcome.topup) {
        setTopup(outcome.topup);
        return;
      }
      if (!outcome.ok || !outcome.data?.profile) {
        setError(outcome.error ?? "پردازشِ هوش مصنوعی ناموفق بود.");
        return;
      }

      setProfile(fromApiProfile(outcome.data.profile));
      setNotice("فیلدها استخراج شدند. آن‌ها را بررسی/ویرایش کنید و «ذخیره» بزنید.");
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const name = profile.fullName.trim();
    if (name.length === 0) {
      setError("نام را وارد کنید.");
      return;
    }

    const yearsRaw = toLatinDigits(profile.yearsExperience).trim();
    let yearsExperience: number | null = null;
    if (yearsRaw.length > 0) {
      const n = Number(yearsRaw);
      if (!Number.isInteger(n) || n < 0 || n > 60) {
        setError("سال‌های سابقه باید عددی بین ۰ تا ۶۰ باشد.");
        return;
      }
      yearsExperience = n;
    }

    setBusy("save");
    try {
      const res = await fetch("/api/resume/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: name,
          headline: profile.headline.trim() || null,
          city: profile.city.trim() || null,
          yearsExperience,
          skills: profile.skills,
        }),
      });
      const data: { error?: string; profile?: ApiProfile } = await res
        .json()
        .catch(() => ({}));

      if (!res.ok || !data.profile) {
        setError(data.error ?? "ذخیره‌ی پروفایل ناموفق بود.");
        return;
      }

      setProfile(fromApiProfile(data.profile));
      setNotice("پروفایل با موفقیت ذخیره شد.");
      router.refresh();
    } catch {
      setError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(null);
    }
  }

  function addSkill() {
    const s = skillDraft.trim();
    if (s.length === 0) return;
    if (profile.skills.some((x) => x.toLowerCase() === s.toLowerCase())) {
      setSkillDraft("");
      return;
    }
    setProfile((p) => ({ ...p, skills: [...p.skills, s].slice(0, 50) }));
    setSkillDraft("");
  }

  function removeSkill(skill: string) {
    setProfile((p) => ({ ...p, skills: p.skills.filter((s) => s !== skill) }));
  }

  const parseDisabled = busy !== null || !resumeFileId || aiMaintenance;

  return (
    <div className="space-y-6">
      {error ? (
        <div
          role="alert"
          className="text-pretty rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-600 dark:text-rose-400"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="text-pretty rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-700 dark:text-emerald-400">
          {notice}
        </div>
      ) : null}

      {/* بنرِ نگه‌داریِ هوش مصنوعی — اگر سقفِ بودجه/پرچمِ دستی فعال باشد. وضعیت را به
          state می‌دهد تا دکمه‌ی پردازشِ پولی غیرفعال شود. */}
      <AiMaintenanceBanner
        onStatus={(s: AiStatus) => setAiMaintenance(s.maintenance)}
      />

      {/* پرامپتِ «نیازمندِ شارژ» — فقط هنگامِ پاسخِ ۴۰۲ از پردازشِ پولی. */}
      {topup ? (
        <TopupPrompt
          topup={topup}
          balanceToman={balanceToman}
          topupHref="/dashboard/billing"
          onDismiss={() => setTopup(null)}
        />
      ) : null}

      {/* ───── گام ۱ و ۲: آپلود + پردازش ───── */}
      <Card padded>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2.5 text-balance text-base font-bold">
            <StepBadge n={1} />
            آپلودِ رزومه (PDF)
          </h3>
          {/* آپلود + استخراجِ متن همیشه رایگان است (CONTEXT: FREE_ACTIONS). */}
          <FreeBadge />
        </div>
        <p className="mt-2 text-pretty text-sm leading-7 text-muted">
          فایلِ PDF رزومه‌تان را انتخاب کنید (حداکثر ۵ مگابایت). متنِ آن استخراج می‌شود و
          سپس می‌توانید با هوش مصنوعی فیلدها را بسازید. آپلود و استخراجِ متن رایگان است؛
          فقط «پردازش با هوش مصنوعی» (گامِ ۲) پولی است.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy !== null}
            className="focus-ring inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-5 py-2.5 text-sm font-medium transition-colors hover:border-brand hover:text-foreground active:translate-y-px disabled:pointer-events-none disabled:opacity-60"
          >
            <IconUpload className="h-4 w-4" />
            {busy === "upload" ? "در حال آپلود…" : "انتخابِ فایلِ PDF"}
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleParse()}
              disabled={parseDisabled}
              title={
                aiMaintenance
                  ? "سرویسِ هوش مصنوعی موقتاً در دسترس نیست."
                  : !resumeFileId
                    ? "ابتدا یک فایلِ PDF آپلود کنید."
                    : undefined
              }
              className="focus-ring inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-l from-brand to-brand-2 px-5 py-2.5 text-sm font-semibold text-white shadow-brand transition-[transform,opacity] hover:-translate-y-0.5 hover:opacity-95 active:translate-y-px disabled:pointer-events-none disabled:opacity-55"
            >
              <IconSparkle className="h-4 w-4" />
              {busy === "parse" ? "در حال پردازش…" : "۲. پردازش با هوش مصنوعی"}
            </button>
            {/* تخمینِ هزینه‌ی پردازشِ پولی (پیش از کنش). */}
            <CostHint estimate={parseCostEstimate} />
          </div>
        </div>
      </Card>

      {/* ───── گام ۳: ویرایش و ذخیره ───── */}
      {/* از خودِ form به‌عنوانِ کارت استفاده می‌کنیم تا سمانتیکِ form حفظ شود (نه div تودرتو). */}
      <form
        onSubmit={handleSave}
        className="rounded-2xl border border-border bg-card p-5 shadow-xs sm:p-6"
      >
          <h3 className="flex items-center gap-2.5 text-balance text-base font-bold">
            <StepBadge n={3} />
            بررسی و ذخیره‌ی فیلدها
          </h3>
          <p className="mt-2 text-pretty text-sm leading-7 text-muted">
            فیلدهای استخراج‌شده را بررسی و در صورتِ نیاز تصحیح کنید، سپس ذخیره بزنید.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field
              id="fullName"
              label="نام و نام‌خانوادگی"
              value={profile.fullName}
              onChange={(v) => setProfile((p) => ({ ...p, fullName: v }))}
              required
            />
            <Field
              id="headline"
              label="عنوانِ حرفه‌ای"
              value={profile.headline}
              onChange={(v) => setProfile((p) => ({ ...p, headline: v }))}
              placeholder="مثل: توسعه‌دهنده‌ی فرانت‌اند"
            />
            <Field
              id="city"
              label="شهر"
              value={profile.city}
              onChange={(v) => setProfile((p) => ({ ...p, city: v }))}
            />
            <Field
              id="yearsExperience"
              label="سال‌های سابقه"
              value={profile.yearsExperience}
              onChange={(v) => setProfile((p) => ({ ...p, yearsExperience: v }))}
              inputMode="numeric"
              dir="ltr"
              placeholder="۰"
            />
          </div>

          {/* مهارت‌ها */}
          <div className="mt-5">
            <label htmlFor="skill" className="mb-1.5 block text-sm font-medium">
              مهارت‌ها
            </label>
            <div className="flex gap-2">
              <input
                id="skill"
                type="text"
                value={skillDraft}
                onChange={(e) => setSkillDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSkill();
                  }
                }}
                placeholder="یک مهارت بنویسید و Enter بزنید"
                className="focus-ring w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand"
              />
              <button
                type="button"
                onClick={addSkill}
                className="focus-ring inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:border-brand active:translate-y-px"
              >
                <IconPlus className="h-4 w-4" />
                افزودن
              </button>
            </div>

            {profile.skills.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {profile.skills.map((skill) => (
                  <li
                    key={skill}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-brand/10 py-1 pe-1.5 ps-3 text-sm text-brand ring-1 ring-inset ring-brand/15"
                  >
                    <span className="truncate" title={skill}>
                      {skill}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      aria-label={`حذفِ ${skill}`}
                      className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded-full text-brand/70 transition-colors hover:bg-brand/15 hover:text-brand"
                    >
                      <IconClose className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-xs text-muted">هنوز مهارتی اضافه نشده است.</p>
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="submit"
              disabled={busy !== null}
              className="focus-ring inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-gradient-to-l from-brand to-brand-2 px-6 py-2.5 text-sm font-semibold text-white shadow-brand transition-[transform,opacity] hover:-translate-y-0.5 hover:opacity-95 active:translate-y-px disabled:pointer-events-none disabled:opacity-55"
            >
              <IconDoc className="h-4 w-4" />
              {busy === "save" ? "در حال ذخیره…" : "ذخیره‌ی پروفایل"}
            </button>
          </div>
      </form>
    </div>
  );
}

/** فیلدِ ورودیِ متنیِ ساده با برچسب (RTL، هم‌خوان با استایلِ داشبورد). */
function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  inputMode,
  dir,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: "numeric" | "text";
  dir?: "ltr" | "rtl";
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
        {required ? (
          <span className="text-rose-500" aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        dir={dir}
        required={required}
        className={cn(
          "focus-ring w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition-colors focus:border-brand",
          dir === "ltr" && "ltr-nums",
        )}
      />
    </div>
  );
}
