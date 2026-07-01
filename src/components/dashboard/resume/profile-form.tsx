"use client";

/**
 * فرمِ پروفایلِ جامع (Track C, client) — *همه‌ی* فیلدهایی که بردهای ایرانی می‌پرسند،
 * قابلِ ویرایش + ذخیره. کنترل‌شده از والد (ResumeWorkspace) است تا وقتی هوش مصنوعی
 * فیلدها را از رزومه پر می‌کند، همین فرم زنده به‌روز شود (AI-fill و ویرایشِ دستی یک پروفایل).
 *
 * ذخیره با PATCH /api/resume/profile (رایگان، بدونِ AI). بخش‌های آرایه‌ای (سابقه/تحصیلات/
 * زبان/لینک) ردیفِ افزودن/حذف دارند. آیکن‌ها همه lucide (بدونِ ایموجی).
 */
import type {
  ProfileEducation,
  ProfileLanguage,
  ProfileLink,
  ProfileWorkExperience,
} from "@/db/schema";
import {
  IconBuilding,
  IconDoc,
  IconEducation,
  IconLanguages,
  IconLink,
  IconMapPin,
  IconPhone,
  IconPlus,
  IconStar,
  IconTrash,
  IconUser,
} from "../icons";
import { Button, Card, toFaDigits } from "../ui";
import type { ClientProfile } from "./profile-types";
import { FieldLabel, LabeledCheckbox, LabeledInput, LabeledTextarea } from "./fields";

/** ارقامِ فارسی/عربی → لاتین (برای سال‌های سابقه). */
function toLatinDigits(raw: string): string {
  const map: Record<string, string> = {
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
    "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
    "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  };
  return raw.replace(/[۰-۹٠-٩]/g, (d) => map[d] ?? d);
}

export function ProfileForm({
  profile,
  onChange,
  onSubmit,
  busy,
  skillDraft,
  onSkillDraftChange,
  onAddSkill,
  onRemoveSkill,
}: {
  profile: ClientProfile;
  onChange: (updater: (p: ClientProfile) => ClientProfile) => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
  skillDraft: string;
  onSkillDraftChange: (v: string) => void;
  onAddSkill: () => void;
  onRemoveSkill: (skill: string) => void;
}) {
  const set = <K extends keyof ClientProfile>(key: K, value: ClientProfile[K]) =>
    onChange((p) => ({ ...p, [key]: value }));

  const yearsValue =
    typeof profile.yearsExperience === "number"
      ? toFaDigits(profile.yearsExperience)
      : "";

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* ── هویت و تماس ── */}
      <Card padded>
        <SectionTitle
          icon={<IconUser />}
          title="اطلاعاتِ پایه"
          subtitle="نام، عنوانِ حرفه‌ای و راه‌های تماس."
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <LabeledInput
            id="fullName"
            label="نام و نام‌خانوادگی"
            value={profile.fullName}
            onChange={(v) => set("fullName", v)}
            required
            icon={<IconUser />}
            autoComplete="name"
          />
          <LabeledInput
            id="headline"
            label="عنوانِ حرفه‌ای"
            value={profile.headline ?? ""}
            onChange={(v) => set("headline", v || null)}
            placeholder="مثل: توسعه‌دهنده‌ی فرانت‌اند"
          />
          <LabeledInput
            id="city"
            label="شهر"
            value={profile.city ?? ""}
            onChange={(v) => set("city", v || null)}
            icon={<IconMapPin />}
            placeholder="مثل: تهران"
          />
          <LabeledInput
            id="phone"
            label="شماره‌ی تماس"
            value={profile.phone ?? ""}
            onChange={(v) => set("phone", v || null)}
            type="tel"
            inputMode="tel"
            dir="ltr"
            icon={<IconPhone />}
            autoComplete="tel"
            placeholder="۰۹۱۲۳۴۵۶۷۸۹"
          />
          <LabeledInput
            id="yearsExperience"
            label="سال‌های سابقه"
            value={yearsValue}
            onChange={(v) => {
              const digits = toLatinDigits(v).trim();
              if (digits === "") {
                set("yearsExperience", null);
                return;
              }
              const n = Number(digits);
              if (Number.isInteger(n) && n >= 0 && n <= 60) {
                set("yearsExperience", n);
              }
            }}
            inputMode="numeric"
            dir="ltr"
            placeholder="۰"
            hint="عددی بین ۰ تا ۶۰."
          />
          <LabeledInput
            id="expectedSalary"
            label="حقوقِ درخواستی"
            value={profile.expectedSalary ?? ""}
            onChange={(v) => set("expectedSalary", v || null)}
            placeholder="مثل: توافقی یا ۳۰ تا ۴۰ میلیون"
          />
        </div>
      </Card>

      {/* ── درباره‌ی من ── */}
      <Card padded>
        <SectionTitle
          icon={<IconDoc />}
          title="درباره‌ی من"
          subtitle="یک خلاصه‌ی کوتاه از خودتان و تخصص‌تان."
        />
        <div className="mt-5">
          <LabeledTextarea
            id="summary"
            label="خلاصه"
            value={profile.summary ?? ""}
            onChange={(v) => set("summary", v || null)}
            rows={4}
            maxLength={3000}
            placeholder="مثلاً: توسعه‌دهنده‌ی فرانت‌اند با ۵ سال تجربه در React و طراحیِ رابطِ کاربری…"
          />
        </div>
      </Card>

      {/* ── مهارت‌ها ── */}
      <Card padded>
        <SectionTitle
          icon={<IconStar />}
          title="مهارت‌ها"
          subtitle="مهارت‌های کلیدی‌تان را اضافه کنید."
        />
        <div className="mt-5">
          <FieldLabel htmlFor="skill">افزودنِ مهارت</FieldLabel>
          <div className="flex gap-2">
            <input
              id="skill"
              type="text"
              value={skillDraft}
              onChange={(e) => onSkillDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddSkill();
                }
              }}
              placeholder="یک مهارت بنویسید و Enter بزنید"
              className="focus-ring w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-brand"
            />
            <button
              type="button"
              onClick={onAddSkill}
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
                    onClick={() => onRemoveSkill(skill)}
                    aria-label={`حذفِ ${skill}`}
                    className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded-full text-brand/70 transition-colors hover:bg-brand/15 hover:text-brand"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted">هنوز مهارتی اضافه نشده است.</p>
          )}
        </div>
      </Card>

      {/* ── سابقه‌ی کاری ── */}
      <ArraySection
        icon={<IconBuilding />}
        title="سابقه‌ی کاری"
        subtitle="شرکت‌ها و سمت‌هایی که داشته‌اید."
        items={profile.workExperience}
        addLabel="افزودنِ سابقه‌ی کاری"
        emptyText="هنوز سابقه‌ای اضافه نشده است."
        onAdd={() =>
          set("workExperience", [...profile.workExperience, {} as ProfileWorkExperience])
        }
        onRemove={(i) =>
          set(
            "workExperience",
            profile.workExperience.filter((_, idx) => idx !== i),
          )
        }
        renderItem={(item, i) => (
          <WorkExperienceRow
            item={item}
            onChange={(next) =>
              set(
                "workExperience",
                profile.workExperience.map((x, idx) => (idx === i ? next : x)),
              )
            }
            index={i}
          />
        )}
      />

      {/* ── تحصیلات ── */}
      <ArraySection
        icon={<IconEducation />}
        title="تحصیلات"
        subtitle="مدارک و دوره‌های تحصیلی‌تان."
        items={profile.education}
        addLabel="افزودنِ تحصیلات"
        emptyText="هنوز تحصیلاتی اضافه نشده است."
        onAdd={() => set("education", [...profile.education, {} as ProfileEducation])}
        onRemove={(i) =>
          set(
            "education",
            profile.education.filter((_, idx) => idx !== i),
          )
        }
        renderItem={(item, i) => (
          <EducationRow
            item={item}
            index={i}
            onChange={(next) =>
              set(
                "education",
                profile.education.map((x, idx) => (idx === i ? next : x)),
              )
            }
          />
        )}
      />

      {/* ── زبان‌ها ── */}
      <ArraySection
        icon={<IconLanguages />}
        title="زبان‌ها"
        subtitle="زبان‌ها و سطحِ تسلط‌تان."
        items={profile.languages}
        addLabel="افزودنِ زبان"
        emptyText="هنوز زبانی اضافه نشده است."
        onAdd={() => set("languages", [...profile.languages, { name: "" }])}
        onRemove={(i) =>
          set(
            "languages",
            profile.languages.filter((_, idx) => idx !== i),
          )
        }
        renderItem={(item, i) => (
          <LanguageRow
            item={item}
            index={i}
            onChange={(next) =>
              set(
                "languages",
                profile.languages.map((x, idx) => (idx === i ? next : x)),
              )
            }
          />
        )}
      />

      {/* ── لینک‌ها ── */}
      <ArraySection
        icon={<IconLink />}
        title="لینک‌ها"
        subtitle="وب‌سایت، لینکدین، گیت‌هاب و…"
        items={profile.links}
        addLabel="افزودنِ لینک"
        emptyText="هنوز لینکی اضافه نشده است."
        onAdd={() => set("links", [...profile.links, { url: "" }])}
        onRemove={(i) =>
          set(
            "links",
            profile.links.filter((_, idx) => idx !== i),
          )
        }
        renderItem={(item, i) => (
          <LinkRow
            item={item}
            index={i}
            onChange={(next) =>
              set(
                "links",
                profile.links.map((x, idx) => (idx === i ? next : x)),
              )
            }
          />
        )}
      />

      {/* دکمه‌ی ذخیره — تکِ CTAِ اصلیِ فرم. */}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy}>
          <IconDoc className="h-4 w-4" />
          {busy ? "در حال ذخیره…" : "ذخیره‌ی پروفایل"}
        </Button>
      </div>
    </form>
  );
}

/* ───────────────────────────  اجزای بخش/ردیف  ──────────────────────────── */

function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand [&>svg]:h-5 [&>svg]:w-5"
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-balance text-base font-bold leading-tight">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 text-pretty text-xs leading-5 text-muted">{subtitle}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * قالبِ عمومیِ یک بخشِ آرایه‌ای (سابقه/تحصیلات/زبان/لینک): سرتیتر + دکمه‌ی افزودن،
 * فهرستِ ردیف‌ها با دکمه‌ی حذفِ هر ردیف، و حالتِ خالی.
 */
function ArraySection<T>({
  icon,
  title,
  subtitle,
  items,
  addLabel,
  emptyText,
  onAdd,
  onRemove,
  renderItem,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  items: T[];
  addLabel: string;
  emptyText: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  renderItem: (item: T, index: number) => React.ReactNode;
}) {
  return (
    <Card padded>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={icon} title={title} subtitle={subtitle} />
        <button
          type="button"
          onClick={onAdd}
          className="focus-ring inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-brand active:translate-y-px"
        >
          <IconPlus className="h-4 w-4" />
          {addLabel}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-5 text-pretty rounded-xl border border-dashed border-border bg-surface/60 px-4 py-5 text-center text-xs leading-6 text-muted">
          {emptyText}
        </p>
      ) : (
        <ul className="mt-5 space-y-4">
          {items.map((item, i) => (
            <li
              key={i}
              className="rounded-2xl border border-border bg-surface/40 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">
                  ردیفِ {toFaDigits(i + 1)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-500/10 dark:text-rose-400"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                  حذف
                </button>
              </div>
              {renderItem(item, i)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function WorkExperienceRow({
  item,
  index,
  onChange,
}: {
  item: ProfileWorkExperience;
  index: number;
  onChange: (next: ProfileWorkExperience) => void;
}) {
  const p = `we-${index}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <LabeledInput
        id={`${p}-company`}
        label="شرکت/سازمان"
        value={item.company ?? ""}
        onChange={(v) => onChange({ ...item, company: v })}
      />
      <LabeledInput
        id={`${p}-title`}
        label="سمت"
        value={item.title ?? ""}
        onChange={(v) => onChange({ ...item, title: v })}
      />
      <LabeledInput
        id={`${p}-start`}
        label="تاریخِ شروع"
        value={item.startDate ?? ""}
        onChange={(v) => onChange({ ...item, startDate: v })}
        placeholder="مثل ۱۳۹۸"
      />
      <LabeledInput
        id={`${p}-end`}
        label="تاریخِ پایان"
        value={item.endDate ?? ""}
        onChange={(v) => onChange({ ...item, endDate: v })}
        placeholder="مثل ۱۴۰۱"
      />
      <div className="sm:col-span-2">
        <LabeledCheckbox
          id={`${p}-current`}
          label="هم‌اکنون در این شغل مشغولم"
          checked={Boolean(item.current)}
          onChange={(v) =>
            onChange({ ...item, current: v, ...(v ? { endDate: "" } : {}) })
          }
        />
      </div>
      <div className="sm:col-span-2">
        <LabeledTextarea
          id={`${p}-desc`}
          label="شرحِ مسئولیت‌ها"
          value={item.description ?? ""}
          onChange={(v) => onChange({ ...item, description: v })}
          rows={3}
          maxLength={2000}
        />
      </div>
    </div>
  );
}

function EducationRow({
  item,
  index,
  onChange,
}: {
  item: ProfileEducation;
  index: number;
  onChange: (next: ProfileEducation) => void;
}) {
  const p = `ed-${index}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <LabeledInput
        id={`${p}-institution`}
        label="دانشگاه/مؤسسه"
        value={item.institution ?? ""}
        onChange={(v) => onChange({ ...item, institution: v })}
      />
      <LabeledInput
        id={`${p}-degree`}
        label="مقطع/مدرک"
        value={item.degree ?? ""}
        onChange={(v) => onChange({ ...item, degree: v })}
        placeholder="مثل کارشناسی"
      />
      <LabeledInput
        id={`${p}-field`}
        label="رشته"
        value={item.field ?? ""}
        onChange={(v) => onChange({ ...item, field: v })}
      />
      <div className="grid grid-cols-2 gap-4">
        <LabeledInput
          id={`${p}-start`}
          label="سالِ شروع"
          value={item.startYear ?? ""}
          onChange={(v) => onChange({ ...item, startYear: v })}
          inputMode="numeric"
          dir="ltr"
        />
        <LabeledInput
          id={`${p}-end`}
          label="سالِ پایان"
          value={item.endYear ?? ""}
          onChange={(v) => onChange({ ...item, endYear: v })}
          inputMode="numeric"
          dir="ltr"
        />
      </div>
    </div>
  );
}

function LanguageRow({
  item,
  index,
  onChange,
}: {
  item: ProfileLanguage;
  index: number;
  onChange: (next: ProfileLanguage) => void;
}) {
  const p = `lang-${index}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <LabeledInput
        id={`${p}-name`}
        label="زبان"
        value={item.name ?? ""}
        onChange={(v) => onChange({ ...item, name: v })}
        placeholder="مثل انگلیسی"
      />
      <LabeledInput
        id={`${p}-level`}
        label="سطح"
        value={item.level ?? ""}
        onChange={(v) => onChange({ ...item, level: v })}
        placeholder="مثل مسلط"
      />
    </div>
  );
}

function LinkRow({
  item,
  index,
  onChange,
}: {
  item: ProfileLink;
  index: number;
  onChange: (next: ProfileLink) => void;
}) {
  const p = `link-${index}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <LabeledInput
        id={`${p}-label`}
        label="برچسب"
        value={item.label ?? ""}
        onChange={(v) => onChange({ ...item, label: v })}
        placeholder="مثل لینکدین"
      />
      <LabeledInput
        id={`${p}-url`}
        label="آدرس"
        value={item.url ?? ""}
        onChange={(v) => onChange({ ...item, url: v })}
        type="url"
        dir="ltr"
        icon={<IconLink />}
        placeholder="https://…"
      />
    </div>
  );
}
