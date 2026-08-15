"use client";

/**
 * فضای کارِ رزومه/پروفایل (Track C, client) — تکِ ورودیِ تعاملیِ صفحه‌ی رزومه.
 *
 * چرا یک والدِ مشترک؟ تا «استخراج با هوش مصنوعی» (در UploadsPanel) و «ویرایشِ دستی»
 * (در ProfileForm) *یک* حالتِ پروفایل را به‌اشتراک بگذارند: وقتی AI فیلدها را از رزومه
 * می‌سازد، فرم زنده پر می‌شود؛ کاربر ویرایش و ذخیره می‌کند. هر دو یک پروفایل می‌نویسند.
 *
 * دو زبانه: «پروفایل» (فرمِ جامع) و «فایل‌ها» (آپلود + کنش‌های هر فایل). در دسکتاپ هر دو
 * کنارِ هم‌اند؛ در موبایل با تب سوییچ می‌شوند تا صفحه شلوغ نشود.
 *
 * `initialTab` برای کاربرِ تازه است: وقتی نه پروفایلی هست و نه فایلی، صفحه‌ی «رزومه و
 * پروفایل» با تبِ «فایل‌ها» باز می‌شود تا فراخوانِ «رزومه‌ات را آپلود کن» در موبایل هم
 * پشتِ تبِ بسته پنهان نماند (در دسکتاپ هر دو ستون دیده می‌شوند و اثری ندارد).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import { IconDoc, IconUser } from "../icons";
import { cn } from "../ui";
import type { CostEstimate } from "@/lib/billing/ui";
import type { ApiFullProfile } from "@/lib/resume/profile-view";
import { ProfileForm } from "./profile-form";
import { UploadsPanel } from "./uploads-panel";
import {
  EMPTY_CLIENT_PROFILE,
  type ClientProfile,
  type ClientResumeFile,
} from "./profile-types";

/** پروفایلِ خام (ممکن است null) → حالتِ کلاینتِ کامل. */
function toClientProfile(p: ApiFullProfile | null): ClientProfile {
  if (!p) return EMPTY_CLIENT_PROFILE;
  return {
    fullName: p.fullName ?? "",
    headline: p.headline,
    summary: p.summary,
    city: p.city,
    phone: p.phone,
    avatarUrl: p.avatarUrl,
    expectedSalary: p.expectedSalary,
    yearsExperience: p.yearsExperience,
    skills: p.skills ?? [],
    workExperience: p.workExperience ?? [],
    education: p.education ?? [],
    languages: p.languages ?? [],
    links: p.links ?? [],
  };
}

type Tab = "profile" | "files";

export function ResumeWorkspace({
  initialProfile,
  files,
  parseCostEstimate,
  balanceToman,
  initialTab = "profile",
}: {
  initialProfile: ApiFullProfile | null;
  files: ClientResumeFile[];
  parseCostEstimate: CostEstimate | null;
  balanceToman?: number;
  /** تبِ بازِ اولیه در موبایل — «files» برای کاربرِ بدونِ رزومه. */
  initialTab?: Tab;
}) {
  const router = useRouter();

  const [profile, setProfile] = useState<ClientProfile>(() =>
    toClientProfile(initialProfile),
  );
  const [tab, setTab] = useState<Tab>(initialTab);
  const [skillDraft, setSkillDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  function addSkill() {
    const s = skillDraft.trim();
    if (s.length === 0) return;
    setProfile((p) =>
      p.skills.some((x) => x.toLowerCase() === s.toLowerCase())
        ? p
        : { ...p, skills: [...p.skills, s].slice(0, 50) },
    );
    setSkillDraft("");
  }

  function removeSkill(skill: string) {
    setProfile((p) => ({ ...p, skills: p.skills.filter((s) => s !== skill) }));
  }

  /** وقتی AI فیلدها را استخراج کرد، فرم را زنده پر کن و به تبِ پروفایل ببر. */
  function handleParsed(parsed: ApiFullProfile) {
    setProfile(toClientProfile(parsed));
    setFormError(null);
    setTab("profile");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setNotice(null);

    const name = profile.fullName.trim();
    if (name.length === 0) {
      setFormError("نام را وارد کنید.");
      return;
    }

    setBusy(true);
    try {
      // ردیف‌های خالیِ آرایه‌ها را پیش از ارسال حذف می‌کنیم تا یک ردیفِ تازه‌اضافه‌شده‌ی
      // بدونِ مقدار (placeholder) اعتبارسنجیِ سرور را نشکند (name/url اجباری‌اند).
      const cleanLanguages = profile.languages.filter((l) => l.name.trim().length > 0);
      const cleanLinks = profile.links.filter((l) => l.url.trim().length > 0);
      const cleanWork = profile.workExperience.filter(
        (w) =>
          Boolean(w.company?.trim()) ||
          Boolean(w.title?.trim()) ||
          Boolean(w.startDate?.trim()) ||
          Boolean(w.endDate?.trim()) ||
          Boolean(w.description?.trim()),
      );
      const cleanEdu = profile.education.filter(
        (e) =>
          Boolean(e.institution?.trim()) ||
          Boolean(e.degree?.trim()) ||
          Boolean(e.field?.trim()) ||
          Boolean(e.startYear?.trim()) ||
          Boolean(e.endYear?.trim()),
      );

      const res = await fetch("/api/resume/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: name,
          headline: profile.headline,
          summary: profile.summary,
          city: profile.city,
          phone: profile.phone,
          avatarUrl: profile.avatarUrl,
          expectedSalary: profile.expectedSalary,
          yearsExperience: profile.yearsExperience,
          skills: profile.skills,
          workExperience: cleanWork,
          education: cleanEdu,
          languages: cleanLanguages,
          links: cleanLinks,
        }),
      });
      const data: { error?: string; profile?: ApiFullProfile } = await res
        .json()
        .catch(() => ({}));

      if (!res.ok || !data.profile) {
        setFormError(data.error ?? "ذخیره‌ی پروفایل ناموفق بود.");
        return;
      }

      setProfile(toClientProfile(data.profile));
      setNotice("پروفایل با موفقیت ذخیره شد.");
      router.refresh();
    } catch {
      setFormError("اتصال به سرور برقرار نشد.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* پیامِ موفقیتِ سراسری (ذخیره/آپلود/استخراج). */}
      {notice ? (
        <div
          aria-live="polite"
          className="text-pretty rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm leading-6 text-emerald-700 dark:text-emerald-400"
        >
          {notice}
        </div>
      ) : null}

      {/* تب‌ها — فقط در موبایل؛ در دسکتاپ هر دو ستون نمایش داده می‌شوند. */}
      <div className="flex gap-2 lg:hidden" role="tablist" aria-label="نمای رزومه">
        <TabButton
          active={tab === "profile"}
          onClick={() => setTab("profile")}
          icon={<IconUser />}
          label="پروفایل"
        />
        <TabButton
          active={tab === "files"}
          onClick={() => setTab("files")}
          icon={<IconDoc />}
          label="فایل‌ها"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ستونِ پروفایل */}
        <section
          className={cn(
            "lg:col-span-3",
            tab === "profile" ? "block" : "hidden lg:block",
          )}
        >
          {formError ? (
            <div
              role="alert"
              aria-live="polite"
              className="mb-5 text-pretty rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-600 dark:text-rose-400"
            >
              {formError}
            </div>
          ) : null}
          <ProfileForm
            profile={profile}
            onChange={setProfile}
            onSubmit={handleSave}
            busy={busy}
            skillDraft={skillDraft}
            onSkillDraftChange={setSkillDraft}
            onAddSkill={addSkill}
            onRemoveSkill={removeSkill}
          />
        </section>

        {/* ستونِ فایل‌ها */}
        <aside
          className={cn(
            "lg:col-span-2",
            tab === "files" ? "block" : "hidden lg:block",
          )}
        >
          <UploadsPanel
            files={files}
            parseCostEstimate={parseCostEstimate}
            balanceToman={balanceToman}
            onParsed={handleParsed}
            onNotice={setNotice}
          />
        </aside>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "focus-ring inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-colors [&>svg]:h-4 [&>svg]:w-4",
        active
          ? "border-brand bg-brand/10 text-brand"
          : "border-border text-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
