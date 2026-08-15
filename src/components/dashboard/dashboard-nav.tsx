"use client";

/**
 * ناوبریِ داشبورد (client) — لینکِ فعال را از `usePathname` مشتق می‌کند.
 *
 * چرا client؟ تا صفحه‌ها دیگر مجبور نباشند `active` را دستی پاس بدهند؛ ناوبری خودش
 * مسیرِ جاری را می‌فهمد و لینکِ درست را های‌لایت می‌کند.
 *
 * ساختارِ اطلاعات (مهم‌ترین تصمیمِ این فایل): به‌جای یک فهرستِ تختِ بلند، آیتم‌ها در
 * چند **گروهِ کاری** دسته شده‌اند و ترتیبشان همان ترتیبی است که یک کاربرِ تازه‌وارد
 * کارها را انجام می‌دهد: اول «کارِ روزانه»، بعد «سوابق»، بعد «رزومه و پروفایل»، آخر
 * «حساب». هر آیتم یک `hint` یک‌خطیِ فارسیِ ساده دارد که در دسکتاپ زیرِ برچسب دیده
 * می‌شود — تا کسی که نمی‌داند «ناوگان» یعنی چه، از روی همین جمله بفهمد.
 *
 * سه نما، از یک منبعِ حقیقت (`NAV_GROUPS`):
 *   • `SidebarNav`  → ستونِ عمودیِ دسکتاپ (lg به بالا)، با تیترِ گروه‌ها.
 *   • `MobileNav`   → چیپ‌های مسیرهای اصلی + دکمه‌ی «همه‌ی بخش‌ها» که کشوی کامل را باز
 *                     می‌کند (به‌جای نوارِ افقیِ ۱۶ چیپی که کسی تا آخرش اسکرول نمی‌کند).
 *   • `NavGroup`    → یک گروهِ تنها؛ برای گروهِ «مدیریت» که فقط به ادمین‌ها نشان داده
 *                     می‌شود و از سرور (admin-nav.tsx) استریم می‌شود.
 *
 * آیکن‌ها از ماژولِ مرکزیِ `./icons` (lucide) می‌آیند — نه SVGِ دست‌ساز، نه ایموجی.
 * جهتِ RTL با property‌های منطقی (start/end) درست است.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  IconArchive,
  IconBolt,
  IconCard,
  IconChart,
  IconChevronEnd,
  IconClose,
  IconDoc,
  IconHeart,
  IconHome,
  IconPlan,
  IconPuzzle,
  IconSend,
  IconServer,
  IconSparkle,
  IconTarget,
  IconUsers,
  IconWallet,
  type IconComponent,
} from "./icons";
import { cn } from "./ui";

/* ─────────────────────────────  فهرستِ ناوبری  ────────────────────────────── */

export interface NavItem {
  href: string;
  /** برچسبِ کوتاه — همیشه تک‌خطی. */
  label: string;
  /** یک جمله‌ی ساده: این صفحه به چه دردی می‌خورد؟ (دسکتاپ + کشوی موبایل) */
  hint: string;
  icon: IconComponent;
}

export interface NavGroupDef {
  /** تیترِ گروه — کوتاه و غیرفنی. */
  title: string;
  items: NavItem[];
}

/**
 * منبعِ حقیقتِ ناوبری. قواعدِ نام‌گذاری:
 *   • هیچ واژه‌ی لاتین یا اصطلاحِ داخلی (fleet/queue/threshold) در برچسب‌ها نیست.
 *   • برچسب‌ها «کاری» است نه «فنی»: «وضعیتِ اپلای‌ها» نه «صفِ تسک‌ها».
 *   • سه صفحه‌ی تاریخچه با *سؤالی که جواب می‌دهند* از هم جدا شده‌اند:
 *     وضعیت (الان چه خبر است؟) / بایگانی (چه فرستادیم؟) / جابینجا (آن‌ها چه دیدند؟).
 */
export const NAV_GROUPS: NavGroupDef[] = [
  {
    title: "کارِ روزانه",
    items: [
      {
        href: "/dashboard",
        label: "نمای کلی",
        hint: "خلاصه‌ی امروز و کارهای نیمه‌تمام",
        icon: IconHome,
      },
      {
        href: "/dashboard/auto-apply",
        label: "اپلای خودکار",
        hint: "روشن/خاموش کردن و تنظیمِ شرط‌ها",
        icon: IconBolt,
      },
      {
        href: "/dashboard/matches",
        label: "فرصت‌های شغلی",
        hint: "آگهی‌هایی که به تو می‌خورد",
        icon: IconTarget,
      },
      {
        href: "/dashboard/interview-prep",
        label: "وضعیتِ اپلای‌ها",
        hint: "همین حالا چه چیزی در حالِ ارسال است",
        icon: IconSend,
      },
    ],
  },
  {
    title: "سوابق",
    items: [
      {
        href: "/dashboard/archive",
        label: "بایگانیِ ارسال‌ها",
        hint: "چه فرستادیم و با کدام رزومه",
        icon: IconArchive,
      },
      {
        href: "/dashboard/applications",
        label: "پرونده‌ی جابینجا",
        hint: "کارفرماها درخواستت را در چه مرحله‌ای دیده‌اند",
        icon: IconChart,
      },
    ],
  },
  {
    title: "رزومه و پروفایل",
    items: [
      {
        href: "/dashboard/profiles",
        label: "رزومه و پروفایل",
        hint: "اطلاعاتی که برای کارفرما فرستاده می‌شود",
        icon: IconDoc,
      },
      {
        href: "/dashboard/interests",
        label: "زمینه‌های شغلی",
        hint: "دنبالِ چه نوع کاری هستی",
        icon: IconHeart,
      },
      {
        href: "/dashboard/extension",
        label: "افزونه‌ی مرورگر",
        hint: "نصب و اتصالِ افزونه به حساب",
        icon: IconPuzzle,
      },
    ],
  },
  {
    title: "حساب",
    items: [
      {
        href: "/dashboard/plans",
        label: "اشتراک",
        hint: "پلنِ فعلی و ارتقا",
        icon: IconPlan,
      },
      {
        href: "/dashboard/billing",
        label: "اعتبار و هزینه",
        hint: "موجودی، شارژ و ریزِ مصرف",
        icon: IconWallet,
      },
      {
        href: "/dashboard/models",
        label: "هوش مصنوعی",
        hint: "انتخابِ مدل (پیش‌فرض برای اغلبِ کاربران مناسب است)",
        icon: IconSparkle,
      },
    ],
  },
];

/**
 * آیتم‌های بخشِ «مدیریت» — عمداً *در همین ماژولِ کلاینت* تعریف شده‌اند.
 *
 * چرا این‌جا و نه در `admin-nav.tsx` (که سروری است)؟ چون `icon` یک *تابعِ* کامپوننت
 * است و توابع از مرزِ Server→Client رد نمی‌شوند؛ پاس‌دادنشان به `NavGroup` رندرِ کلِ
 * layout را می‌شکست («Functions cannot be passed directly to Client Components»).
 * حالا هیچ propی از آن مرز عبور نمی‌کند: سرور فقط *تصمیم می‌گیرد* که این بخش رندر
 * شود یا نه، و خودِ داده این‌طرفِ مرز می‌ماند.
 */
const ADMIN_ITEMS: NavItem[] = [
  {
    href: "/dashboard/admin/users",
    label: "کاربران",
    hint: "جست‌وجو، اشتراک، اعتبار و دسترسیِ هر کاربر",
    icon: IconUsers,
  },
  {
    href: "/dashboard/admin/payments",
    label: "پرداخت‌ها",
    hint: "تأیید یا ردِ کارت‌به‌کارت‌های در انتظار",
    icon: IconCard,
  },
  {
    href: "/dashboard/fleet",
    label: "سرورها",
    hint: "سلامت و تخصیصِ نودهای اپلای",
    icon: IconServer,
  },
];

/**
 * گروهِ «مدیریت» — بدونِ هیچ propی، تا از سرور فقط «رندر شو» صادر شود.
 * تنها فراخوانِ مجازش `AdminNavGroup` در `admin-nav.tsx` است که اول ادمین‌بودن را
 * سمتِ سرور چک می‌کند.
 */
export function AdminNavSection() {
  return <NavGroup title="مدیریت" items={ADMIN_ITEMS} />;
}

/** مسیرهایی که در موبایل به‌صورتِ چیپ (بدونِ بازکردنِ کشو) در دسترس‌اند. */
const MOBILE_PRIMARY = [
  "/dashboard",
  "/dashboard/auto-apply",
  "/dashboard/matches",
  "/dashboard/interview-prep",
];

/** آیا این آیتم با مسیرِ جاری فعال است؟ خانه فقط با تطبیقِ دقیق (تا زیرمسیرها آن را
 *  فعال نکنند)؛ بقیه با پیشوند (تا زیرمسیرها هم های‌لایت شوند). */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ─────────────────────────────  ناوبریِ دسکتاپ  ────────────────────────────── */

/**
 * یک گروهِ ناوبری. `children` برای گروه‌های استریم‌شونده‌ی سرور (گروهِ «مدیریت») نیست —
 * آن گروه خودش این کامپوننت را با آیتم‌های خودش صدا می‌زند.
 */
export function NavGroup({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  /** در کشوی موبایل: بعد از کلیک، کشو بسته شود. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div>
      <h2 className="px-3 pb-1.5 pt-4 text-[0.7rem] font-bold uppercase tracking-wide text-muted/70">
        {title}
      </h2>
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring group relative flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors",
                  active
                    ? "bg-brand/10 text-brand"
                    : "text-muted hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                {/* نشانگرِ لبه‌ی فعال (سمتِ راست در RTL) */}
                <span
                  className={cn(
                    "absolute inset-y-2 end-0 w-1 rounded-full bg-brand transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />
                <Icon
                  className={cn(
                    "mt-0.5 h-5 w-5 transition-transform group-hover:scale-105",
                    active ? "text-brand" : "text-muted group-hover:text-foreground",
                  )}
                />
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-sm font-medium">
                    {item.label}
                  </span>
                  {/* راهنمای یک‌خطی — روی صفحه‌های باریک‌تر پنهان تا ستون شلوغ نشود. */}
                  <span
                    className={cn(
                      "mt-0.5 hidden text-pretty text-xs leading-5 xl:block",
                      active ? "text-brand/70" : "text-muted/70",
                    )}
                  >
                    {item.hint}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * ستونِ ناوبریِ دسکتاپ. `children` جای گروه‌های استریم‌شونده‌ی سرور است (گروهِ
 * «مدیریت» که فقط ادمین‌ها می‌بینند و در `<Suspense>` می‌آید).
 */
export function SidebarNav({ children }: { children?: React.ReactNode }) {
  return (
    <nav aria-label="ناوبریِ داشبورد" className="sticky top-20 pb-8">
      {NAV_GROUPS.map((group) => (
        <NavGroup key={group.title} title={group.title} items={group.items} />
      ))}
      {children}
    </nav>
  );
}

/* ─────────────────────────────  ناوبریِ موبایل  ────────────────────────────── */

/**
 * موبایل: چیپ‌های مسیرهای اصلی + دکمه‌ی «همه‌ی بخش‌ها».
 *
 * چرا کشو به‌جای نوارِ افقیِ بلند؟ چون در نوارِ اسکرولیِ ۱۶ آیتمی، هرچه بعد از چیپِ
 * چهارم باشد عملاً نامرئی است. کشو همان گروه‌بندیِ دسکتاپ را نشان می‌دهد، پس کاربر
 * *همه‌ی* بخش‌ها را با تیترِ گروه می‌بیند.
 */
export function MobileNav({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();

  /*
   * به‌جای «باز/بسته» یک بولین، *مسیری* را نگه می‌داریم که کشو رویش باز شده.
   * پس کشو فقط تا وقتی باز است که مسیر عوض نشده باشد — با هر ناوبری (کلیک روی لینک،
   * یا back/forward مرورگر) خودبه‌خود بسته می‌شود، بدونِ effect و بدونِ رندرِ آبشاری.
   */
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const close = () => setOpenedOn(null);

  // وقتی کشو باز است، پس‌زمینه اسکرول نشود.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const primary = NAV_GROUPS.flatMap((g) => g.items).filter((i) =>
    MOBILE_PRIMARY.includes(i.href),
  );

  return (
    <>
      <nav
        aria-label="ناوبریِ داشبورد"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-ring flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "border-border bg-card text-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={() => setOpenedOn(pathname)}
          aria-expanded={open}
          className="focus-ring flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          <span className="whitespace-nowrap">همه‌ی بخش‌ها</span>
          <IconChevronEnd className="h-4 w-4" />
        </button>
      </nav>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="بستنِ فهرست"
            onClick={close}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 end-0 flex w-[min(20rem,88vw)] flex-col border-s border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-bold">همه‌ی بخش‌ها</span>
              <button
                type="button"
                onClick={close}
                className="focus-ring rounded-full p-1.5 text-muted hover:bg-foreground/5 hover:text-foreground"
                aria-label="بستن"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6">
              {NAV_GROUPS.map((group) => (
                <NavGroup
                  key={group.title}
                  title={group.title}
                  items={group.items}
                  onNavigate={close}
                />
              ))}
              {children}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
