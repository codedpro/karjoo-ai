/**
 * «راه‌اندازیِ کارجو» (Server component) — راهنمای گام‌به‌گام برای کاربرِ تازه.
 *
 * بیشترِ کاربرانِ تازه از 1xai.ir می‌آیند و هنوز نمی‌دانند کارجو چیست. پس گامِ اول فقط
 * توضیح است (کارجو چه می‌کند، با حسابِ 1xAi چه دارند، چه چیزی لازم است) و بعد سه کارِ لازم،
 * هر کدام در همین صفحه: رزومه، شغل‌های موردِ نظر، افزونه و اتصالِ سایت‌ها. گامِ آخر می‌گوید
 * ارسال چطور شروع می‌شود.
 *
 * گامِ جاری در نشانی است (`?step=`) تا بدونِ JS کار کند و قابلِ بازگشت باشد. وضعیتِ «انجام شد»
 * هر گام از داده‌ی واقعی خوانده می‌شود (`getSetupStatus`)، نه از یک پرچمِ ذخیره‌شده.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import {
  actionEstimate,
  getUserAiCostContext,
} from "@/components/dashboard/billing-data";
import {
  DownloadButton,
  InstallGuide,
} from "@/components/dashboard/extension-install-guide";
import {
  IconBolt,
  IconCheck,
  IconChevronEnd,
  IconChevronStart,
  IconDoc,
  IconPlug,
  IconSearch,
  IconSend,
  IconServer,
  IconSparkle,
  IconTarget,
  IconWallet,
} from "@/components/dashboard/icons";
import { BOARD_LABELS, boardLabel } from "@/components/dashboard/labels";
import { PairExtensionPanel } from "@/components/dashboard/pair-extension-panel";
import { ProviderTargetingSection } from "@/components/dashboard/provider-targeting-section";
import {
  getFullResumeProfile,
  getResumeFileList,
} from "@/components/dashboard/resume/profile-data";
import { getDashboardUser } from "@/components/dashboard/session";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  cn,
  PageHeader,
  Skeleton,
  toFaDigits,
} from "@/components/dashboard/ui";
import { ACTIVE_APPLY_BOARDS } from "@/lib/apply/filters";
import {
  applyQuotaOf,
  ONEXAI_PLAN_URL,
  ONEXAI_TOPUP_URL,
} from "@/lib/billing/entitlements";
import { readEntitlements } from "@/lib/billing/subscription";
import { getUnifiedBalance } from "@/lib/billing/unified";
import { getSetupStatus, type SetupStatus } from "@/lib/onboarding/setup-status";

import { finishOnboardingAction } from "./actions";
import { StartResumeUpload } from "./start-resume-upload";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "راه‌اندازیِ کارجو",
  robots: { index: false, follow: false },
};

const STEPS = [
  { id: "intro", label: "کارجو چیست؟" },
  { id: "resume", label: "رزومه" },
  { id: "jobs", label: "شغل‌های موردِ نظر" },
  { id: "connect", label: "افزونه و سایت‌ها" },
  { id: "go", label: "شروعِ ارسال" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

function stepHref(id: StepId): string {
  return `/dashboard/start?step=${id}`;
}

function isStepDone(id: StepId, status: SetupStatus): boolean {
  if (id === "resume") return status.resume;
  if (id === "jobs") return status.targeting;
  if (id === "connect") return status.connected;
  return false;
}

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, raw] = await Promise.all([getDashboardUser(), searchParams]);
  if (!user) redirect("/login");

  const requested = Array.isArray(raw.step) ? raw.step[0] : raw.step;
  const step: StepId = STEPS.find((s) => s.id === requested)?.id ?? "intro";
  const index = STEPS.findIndex((s) => s.id === step);
  const status = await getSetupStatus(user.userId);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="راه‌اندازیِ کارجو"
        subtitle={`حدودِ ۱۰ دقیقه. ${toFaDigits(status.completed)} از ${toFaDigits(status.total)} کارِ لازم انجام شده است.`}
      />

      <Stepper current={step} status={status} />

      <div className="space-y-6">
        {step === "intro" ? (
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <IntroStep userId={user.userId} />
          </Suspense>
        ) : null}
        {step === "resume" ? (
          <Suspense fallback={<Skeleton className="h-80 w-full" />}>
            <ResumeStep userId={user.userId} done={status.resume} />
          </Suspense>
        ) : null}
        {step === "jobs" ? (
          <JobsStep userId={user.userId} done={status.targeting} />
        ) : null}
        {step === "connect" ? <ConnectStep status={status} /> : null}
        {step === "go" ? (
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <GoStep userId={user.userId} status={status} />
          </Suspense>
        ) : null}
      </div>

      <StepFooter index={index} />
    </div>
  );
}

/* ─────────────────────────────  ناوبریِ گام‌ها  ───────────────────────────── */

function Stepper({ current, status }: { current: StepId; status: SetupStatus }) {
  return (
    <nav aria-label="گام‌های راه‌اندازی">
      <ol className="grid grid-cols-5 gap-1.5">
        {STEPS.map((s, i) => {
          const active = s.id === current;
          const done = isStepDone(s.id, status);
          return (
            <li key={s.id}>
              <Link
                href={stepHref(s.id)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "focus-ring flex h-full flex-col gap-1.5 border-t-2 pt-2 text-xs transition-colors",
                  active
                    ? "border-brand text-foreground"
                    : done
                      ? "border-accent text-muted hover:text-foreground"
                      : "border-border text-muted hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-1.5 font-bold">
                  {done ? (
                    <IconCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
                  ) : (
                    <span className="ltr-nums">{toFaDigits(i + 1)}</span>
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                </span>
                <span className="sm:hidden">{s.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepFooter({ index }: { index: number }) {
  const prev = STEPS[index - 1];
  const next = STEPS[index + 1];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
      <div className="flex flex-wrap gap-2">
        {prev ? (
          <ButtonLink href={stepHref(prev.id)} variant="secondary" size="sm">
            <IconChevronStart className="h-4 w-4" />
            {prev.label}
          </ButtonLink>
        ) : null}
        {next ? (
          <ButtonLink href={stepHref(next.id)} size="sm">
            {index === 0 ? "شروع کنیم" : `بعدی: ${next.label}`}
            <IconChevronEnd className="h-4 w-4" />
          </ButtonLink>
        ) : null}
      </div>
      <form action={finishOnboardingAction}>
        <button
          type="submit"
          className="focus-ring text-sm text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          {next ? "بعداً ادامه می‌دهم؛ برو به داشبورد" : "تمام شد؛ برو به داشبورد"}
        </button>
      </form>
    </div>
  );
}

function StepCard({
  icon,
  title,
  done,
  children,
}: {
  icon: ReactNode;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <Card padded className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg font-bold">
          <span className="grid h-9 w-9 place-items-center bg-brand/10 text-brand" aria-hidden>
            {icon}
          </span>
          {title}
        </h2>
        {done ? <Badge tone="green">انجام شد</Badge> : null}
      </div>
      {children}
    </Card>
  );
}

/* ─────────────────────────────  ۱) کارجو چیست؟  ───────────────────────────── */

const HOW_IT_WORKS = [
  {
    icon: <IconDoc className="h-5 w-5" />,
    title: "یک بار رزومه می‌دهی",
    body: "کارجو برای هر آگهی نسخه‌ای از رزومه‌ات می‌سازد که به همان شغل می‌خورد.",
  },
  {
    icon: <IconSearch className="h-5 w-5" />,
    title: "آگهی‌های مناسب را پیدا می‌کند",
    body: `در ${ACTIVE_APPLY_BOARDS.map((b) => BOARD_LABELS[b] ?? b).join("، ")}، با همان شرط‌هایی که خودت تعیین می‌کنی.`,
  },
  {
    icon: <IconSend className="h-5 w-5" />,
    title: "به‌جای تو درخواست می‌فرستد",
    body: "با حسابِ خودت در همان سایت‌ها ارسال می‌کند و نتیجه‌ی هر درخواست را این‌جا می‌بینی.",
  },
];

async function IntroStep({ userId }: { userId: string }) {
  const [entitlements, balance] = await Promise.all([
    readEntitlements(userId),
    getUnifiedBalance(userId).catch(() => null),
  ]);
  const quota = applyQuotaOf(entitlements);

  return (
    <>
      <StepCard icon={<IconSparkle className="h-5 w-5" />} title="کارجو به‌جای تو برای کار درخواست می‌فرستد">
        <p className="text-sm leading-7 text-muted">
          کارجو دستیارِ کاریابیِ خانواده‌ی 1xAi است. به‌جای اینکه هر روز آگهی‌ها را بگردی و
          تک‌تک فرم پر کنی، شرط‌هایت را یک بار می‌گویی و کارجو بقیه را انجام می‌دهد.
        </p>
        <ol className="grid gap-3 md:grid-cols-3">
          {HOW_IT_WORKS.map((item, i) => (
            <li key={item.title} className="border border-border bg-surface/40 p-4">
              <span className="flex items-center gap-2 text-brand">
                {item.icon}
                <span className="ltr-nums text-xs font-bold">{toFaDigits(i + 1)}</span>
              </span>
              <h3 className="mt-3 text-sm font-bold">{item.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted">{item.body}</p>
            </li>
          ))}
        </ol>
      </StepCard>

      <StepCard icon={<IconWallet className="h-5 w-5" />} title="با همان حسابِ 1xAi">
        <ul className="space-y-2.5 text-sm leading-7">
          <li className="flex gap-2">
            <IconCheck className="mt-1.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>
              <strong>حسابِ یکسان:</strong> با همان ایمیل و گذرواژه‌ی 1xAi وارد شده‌ای؛ حسابِ
              جدیدی لازم نیست.
            </span>
          </li>
          <li className="flex gap-2">
            <IconCheck className="mt-1.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>
              <strong>اشتراکِ یکسان — {entitlements.planNameFa}:</strong>{" "}
              {quota === null ? "اپلای نامحدود" : `${toFaDigits(quota)} اپلای در روز`}
              {entitlements.workerIpLimit > 0
                ? `، و ارسالِ ۲۴ ساعته از سرورهای کارجو (${toFaDigits(entitlements.workerIpLimit)} ورکر) حتی وقتی کامپیوترت خاموش است.`
                : "؛ ارسال از مرورگرِ خودت انجام می‌شود."}{" "}
              <a href={ONEXAI_PLAN_URL} className="text-brand hover:underline">
                دیدن و تغییرِ اشتراک ↗
              </a>
            </span>
          </li>
          <li className="flex gap-2">
            <IconCheck className="mt-1.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>
              <strong>کیف‌پولِ یکسان:</strong> ساختِ رزومه‌ی مخصوصِ هر آگهی با هوش مصنوعی انجام
              می‌شود و هزینه‌اش اول از اعتبارِ اشتراک و بعد از کیف‌پولِ 1xAi کم می‌شود
              {balance && !balance.unlimited
                ? ` (موجودیِ فعلی: ${toFaDigits(Math.round(balance.availableToman).toLocaleString("en-US")).replace(/,/g, "٬")} تومان).`
                : "."}{" "}
              <a
                href={ONEXAI_TOPUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                شارژِ کیف‌پول ↗
              </a>
            </span>
          </li>
        </ul>
      </StepCard>

      <Callout tone="info" icon={<IconTarget />} title="برای راه‌اندازی این‌ها را آماده کن">
        یک فایلِ PDF از رزومه‌ات، مرورگرِ Chrome یا Edge روی کامپیوتر، و حساب در دستِ‌کم یکی از
        سایت‌های کاریابی (مثلاً جابینجا).
      </Callout>
    </>
  );
}

/* ─────────────────────────────────  ۲) رزومه  ───────────────────────────────── */

async function ResumeStep({ userId, done }: { userId: string; done: boolean }) {
  const [profile, files, costCtx] = await Promise.all([
    getFullResumeProfile(userId),
    getResumeFileList(userId),
    getUserAiCostContext(userId),
  ]);

  return (
    <StepCard icon={<IconDoc className="h-5 w-5" />} title="رزومه‌ات را بده" done={done}>
      <p className="text-sm leading-7 text-muted">
        فایلِ PDFِ رزومه را آپلود کن و «استخراج با هوش مصنوعی» را بزن. کارجو نام، مهارت‌ها و
        سوابقت را از آن می‌خواند؛ بعد هر وقت خواستی می‌توانی دستی اصلاحشان کنی.
      </p>

      {profile && profile.fullName && profile.skills.length > 0 ? (
        <div className="border border-border bg-surface/40 p-4 text-sm">
          <div className="font-bold">{profile.fullName}</div>
          {profile.headline ? <div className="mt-0.5 text-muted">{profile.headline}</div> : null}
          <div className="mt-2 text-xs text-muted">
            {toFaDigits(profile.skills.length)} مهارت · {toFaDigits(profile.workExperience.length)} سابقه‌ی کاری
          </div>
          <Link href="/dashboard/profiles" className="mt-3 inline-block text-sm text-brand hover:underline">
            دیدن و ویرایشِ کاملِ پروفایل
          </Link>
        </div>
      ) : null}

      <StartResumeUpload
        files={files.map((f) => ({
          id: f.id,
          fileName: f.fileName,
          byteSize: f.byteSize,
          hasText: f.hasText,
          isParsed: f.isParsed,
          isPrimary: f.isPrimary,
          createdAt: f.createdAt.toISOString(),
        }))}
        parseCostEstimate={actionEstimate(costCtx, "resume_parse")}
        balanceToman={costCtx.balanceToman}
      />

      <p className="text-xs leading-6 text-muted">
        رزومه‌ی PDF نداری؟ بعد از نصبِ افزونه (گامِ ۴) می‌توانی پروفایلت را مستقیم از جابینجا یا
        سایت‌های دیگر وارد کنی، یا{" "}
        <Link href="/dashboard/profiles" className="text-brand hover:underline">
          پروفایل را دستی پر کنی
        </Link>
        .
      </p>
    </StepCard>
  );
}

/* ───────────────────────────  ۳) شغل‌های موردِ نظر  ─────────────────────────── */

function JobsStep({ userId, done }: { userId: string; done: boolean }) {
  return (
    <StepCard icon={<IconTarget className="h-5 w-5" />} title="دنبالِ چه شغلی هستی؟" done={done}>
      <p className="text-sm leading-7 text-muted">
        برای هر سایتی که می‌خواهی کارجو در آن بگردد، روشنش کن و زمینه‌ی کاری، شهر یا دورکاری را
        انتخاب کن، بعد «ذخیره» را بزن. کارجو فقط به آگهی‌هایی درخواست می‌دهد که با همین شرط‌ها
        بخوانند. اگر مطمئن نیستی، از جابینجا شروع کن.
      </p>
      <Suspense fallback={<Skeleton className="h-72 w-full" />}>
        <ProviderTargetingSection userId={userId} />
      </Suspense>
    </StepCard>
  );
}

/* ─────────────────────────────  ۴) افزونه و سایت‌ها  ───────────────────────────── */

function ConnectStep({ status }: { status: SetupStatus }) {
  return (
    <>
      <StepCard
        icon={<IconPlug className="h-5 w-5" />}
        title="افزونه را نصب کن و سایت‌هایت را وصل کن"
        done={status.connected}
      >
        <p className="text-sm leading-7 text-muted">
          کارجو با حسابِ خودت در سایت‌های کاریابی درخواست می‌فرستد؛ برای این کار یک افزونه‌ی
          کوچک در مرورگرت لازم است. سه کار:
        </p>
        <ol className="space-y-2 text-sm leading-7">
          <li>
            <strong>الف)</strong> افزونه را دانلود و طبقِ راهنمای پایین نصب کن.
          </li>
          <li>
            <strong>ب)</strong> «ساختِ کدِ اتصال» را بزن و کد را در افزونه (آیکنِ کارجو در
            نوارِ مرورگر) بچسبان.
          </li>
          <li>
            <strong>ج)</strong> در همان مرورگر وارد سایتِ کاریابی‌ات شو (مثلاً jobinja.ir)، بعد
            در افزونه به زبانه‌ی «اتصال سایت‌ها» برو و آن سایت را وصل کن.
          </li>
        </ol>
        <DownloadButton />
      </StepCard>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <InstallGuide />
        </div>
        <div className="space-y-6 lg:col-span-2">
          <PairExtensionPanel />
          <Card padded className="space-y-3">
            <h3 className="text-base font-bold">سایت‌های وصل‌شده</h3>
            {status.connectedBoards.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {status.connectedBoards.map((b) => (
                  <li key={b}>
                    <Badge tone="green">{boardLabel(b)}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-6 text-muted">
                هنوز سایتی وصل نشده. بعد از وصل‌کردن در افزونه، این صفحه را تازه کن.
              </p>
            )}
            <ButtonLink href={stepHref("connect")} variant="secondary" size="sm">
              تازه‌کردنِ وضعیت
            </ButtonLink>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ─────────────────────────────  ۵) شروعِ ارسال  ───────────────────────────── */

async function GoStep({ userId, status }: { userId: string; status: SetupStatus }) {
  const entitlements = await readEntitlements(userId);
  const missing = [
    !status.resume && { id: "resume" as const, label: "رزومه" },
    !status.targeting && { id: "jobs" as const, label: "شغل‌های موردِ نظر" },
    !status.connected && { id: "connect" as const, label: "اتصالِ افزونه و سایت‌ها" },
  ].filter((m): m is { id: "resume" | "jobs" | "connect"; label: string } => Boolean(m));

  return (
    <>
      {missing.length > 0 ? (
        <Callout tone="warn" title="قبل از شروع، این‌ها مانده است">
          <span className="flex flex-wrap gap-2">
            {missing.map((m) => (
              <Link key={m.id} href={stepHref(m.id)} className="text-brand hover:underline">
                {m.label}
              </Link>
            ))}
          </span>
        </Callout>
      ) : (
        <Callout tone="success" title="همه‌چیز آماده است" />
      )}

      <StepCard icon={<IconBolt className="h-5 w-5" />} title="ارسال چطور شروع می‌شود؟">
        <ol className="space-y-3 text-sm leading-7">
          <li>
            <strong>از مرورگرِ خودت:</strong> آیکنِ کارجو را باز کن، در زبانه‌ی «صف اپلای»
            دکمه‌ی «پیدا کردن شغل‌ها» را بزن. برای ارسالِ خودکار در پس‌زمینه، زبانه‌ی «اپلای
            خودکار در مرورگر» را روشن کن؛ تا مرورگر باز است، کارجو یکی‌یکی درخواست می‌فرستد.
          </li>
          <li className="flex gap-2">
            <IconServer className="mt-1.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <span>
              {entitlements.workerIpLimit > 0 ? (
                <>
                  <strong>بدونِ مرورگرِ باز:</strong> اشتراکِ {entitlements.planNameFa} ارسال
                  از سرورهای کارجو را هم دارد. در صفحه‌ی{" "}
                  <Link href="/dashboard/auto-apply" className="text-brand hover:underline">
                    اپلای خودکار
                  </Link>{" "}
                  «ارسال بدونِ مرورگرِ باز» را روشن کن.
                </>
              ) : (
                <>
                  <strong>بدونِ مرورگرِ باز:</strong> برای ارسالِ ۲۴ ساعته از سرورهای کارجو،
                  اشتراکِ 1xAi را به پیشرفته، پرو یا مکس ارتقا بده.{" "}
                  <a href={ONEXAI_PLAN_URL} className="text-brand hover:underline">
                    دیدنِ اشتراک‌ها ↗
                  </a>
                </>
              )}
            </span>
          </li>
          <li>
            <strong>دیدنِ نتیجه:</strong> هر درخواستی که فرستاده می‌شود، با متنِ آگهی و رزومه‌ای که
            برایش ساخته شد، در{" "}
            <Link href="/dashboard/interview-prep" className="text-brand hover:underline">
              وضعیتِ اپلای‌ها
            </Link>{" "}
            می‌آید تا برای مصاحبه آماده شوی.
          </li>
        </ol>
      </StepCard>
    </>
  );
}
