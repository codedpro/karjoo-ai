"use client";

/**
 * ناوبریِ داشبورد (client) — لینکِ فعال را از `usePathname` مشتق می‌کند.
 *
 * چرا client؟ تا صفحه‌ها دیگر مجبور نباشند `active` را دستی پاس بدهند؛ ناوبری خودش
 * مسیرِ جاری را می‌فهمد و لینکِ درست را های‌لایت می‌کند. این تنها بخشِ تعاملیِ پوسته
 * است؛ بقیه‌ی پوسته (هدر/برند) استاتیک و در layout رندر می‌شود.
 *
 * دو نمای مستقل، از یک منبعِ حقیقت (`NAV_ITEMS`):
 *   • `SidebarNav`  → ستونِ عمودیِ دسکتاپ (md به بالا).
 *   • `MobileNav`   → نوارِ افقیِ اسکرول‌شونده‌ی موبایل.
 *
 * آیکن‌ها SVGِ درون‌خطیِ تمیزند (نه ایموجی) با `strokeWidth` یکسان؛ برچسب‌ها کوتاه و
 * `whitespace-nowrap` تا هرگز دو-خطی نشوند. جهتِ RTL با property‌های منطقی درست است.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "./ui";

/* ───────────────────────────────  آیکن‌ها  ──────────────────────────────── */
/* SVGِ ۲۰px، stroke=1.75، currentColor — بدونِ وابستگیِ خارجی. */

type IconProps = { className?: string };
const ICON_BASE = "h-5 w-5 shrink-0";

function IconHome({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}
function IconTarget({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}
function IconStar({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.9 6.8 20.6l1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
    </svg>
  );
}
function IconSend({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <path d="M4 12.5 20 4l-5 16-3-6-8-1.5Z" />
      <path d="m12 14 3-6" />
    </svg>
  );
}
function IconBolt({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <path d="M13 3 5 13h6l-1 8 8-11h-6l1-7Z" />
    </svg>
  );
}
function IconDoc({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </svg>
  );
}
function IconChip({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 3v2M14 3v2M10 19v2M14 19v2M3 10h2M3 14h2M19 10h2M19 14h2" />
    </svg>
  );
}
function IconWallet({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <path d="M3 7a2 2 0 0 1 2-2h12a1 1 0 0 1 1 1v2" />
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12.5h3" />
    </svg>
  );
}
function IconLayers({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={cn(ICON_BASE, className)} aria-hidden>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  );
}

/* ─────────────────────────────  فهرستِ ناوبری  ────────────────────────────── */

interface NavItem {
  href: string;
  label: string;
  icon: (p: IconProps) => ReactNode;
}

/** منبعِ حقیقتِ ناوبری — ترتیب و برچسب‌های کوتاهِ فارسی (بدونِ شکستِ دو-خطی). */
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "خانه", icon: IconHome },
  { href: "/dashboard/matches", label: "تطبیق‌ها", icon: IconTarget },
  { href: "/dashboard/interests", label: "علاقه‌مندی‌ها", icon: IconStar },
  { href: "/dashboard/applications", label: "اپلای‌ها", icon: IconSend },
  { href: "/dashboard/auto-apply", label: "اپلای خودکار", icon: IconBolt },
  { href: "/dashboard/resume", label: "رزومه", icon: IconDoc },
  { href: "/dashboard/models", label: "مدلِ هوش مصنوعی", icon: IconChip },
  { href: "/dashboard/billing", label: "کیف‌پول", icon: IconWallet },
  { href: "/dashboard/plans", label: "پلن‌ها", icon: IconLayers },
];

/** آیا این آیتم با مسیرِ جاری فعال است؟ خانه فقط با تطبیقِ دقیق (تا زیرمسیرها آن را
 *  فعال نکنند)؛ بقیه با پیشوند (تا زیرمسیرها هم های‌لایت شوند). */
function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/* ─────────────────────────────  ناوبریِ دسکتاپ  ────────────────────────────── */

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="ناوبریِ داشبورد" className="sticky top-24 space-y-1">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-brand/10 text-brand"
                : "text-muted hover:bg-foreground/5 hover:text-foreground",
            )}
          >
            {/* نشانگرِ لبه‌ی فعال (سمتِ راست در RTL) */}
            <span
              className={cn(
                "absolute inset-y-1.5 end-0 w-1 rounded-full bg-brand transition-opacity",
                active ? "opacity-100" : "opacity-0",
              )}
              aria-hidden
            />
            <Icon
              className={cn(
                "transition-transform group-hover:scale-105",
                active ? "text-brand" : "text-muted group-hover:text-foreground",
              )}
            />
            <span className="whitespace-nowrap">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ─────────────────────────────  ناوبریِ موبایل  ────────────────────────────── */

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="ناوبریِ داشبورد"
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-ring flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
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
    </nav>
  );
}
