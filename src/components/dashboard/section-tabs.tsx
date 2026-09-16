import Link from "next/link";

import { cn } from "./ui";

/**
 * نوارِ زبانه‌ی بینِ صفحه‌ها (Server component).
 *
 * چند صفحه که به *یک سؤالِ کاربر* جواب می‌دهند، به‌جای چند ورودیِ جداگانه در منو، یک
 * ورودی می‌گیرند و با این نوار بینشان جابه‌جا می‌شویم. منو از ۱۲ ورودی به ۶ رسید
 * بدونِ اینکه هیچ صفحه‌ای حذف یا هیچ قابلیتی کم شود — نشانی‌ها هم دست‌نخورده می‌مانند،
 * پس هر لینکِ قدیمی هنوز کار می‌کند.
 *
 * زبانه‌ها لینکِ ساده‌اند (نه client component): بدونِ جاوااسکریپت کار می‌کنند و هر
 * زبانه نشانیِ خودش را دارد که می‌شود بوکمارک یا هم‌رسانی کرد.
 */
export interface SectionTab {
  href: string;
  label: string;
}

export function SectionTabs({
  tabs,
  active,
  ariaLabel,
}: {
  tabs: SectionTab[];
  /** نشانیِ صفحه‌ی جاری — همان `href`ِ یکی از زبانه‌ها. */
  active: string;
  ariaLabel: string;
}) {
  return (
    <nav aria-label={ariaLabel} className="-mt-2 mb-6 overflow-x-auto">
      {/* زبانه‌های زیرخط‌دار — همان Segments در 1xAi */}
      <ul className="flex min-w-max gap-1 border-b border-hairline-soft">
        {tabs.map((tab) => {
          const isActive = tab.href === active;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "focus-ring -mb-px block border-b-2 px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "border-persimmon font-medium text-bone"
                    : "border-transparent text-bone-dim hover:text-bone",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** زبانه‌های «اپلای‌ها» — همه‌ی چیزی که دربارهٔ درخواست‌ها پرسیده می‌شود. */
export const APPLY_TABS: SectionTab[] = [
  { href: "/dashboard/jobs", label: "جست‌وجوی شغل" },
  { href: "/dashboard/interview-prep", label: "وضعیت" },
  { href: "/dashboard/matches", label: "پیشنهادها" },
  { href: "/dashboard/archive", label: "ارسال‌شده‌ها" },
  { href: "/dashboard/applications", label: "پاسخ کارفرما" },
];

/** زبانه‌های «حساب» — اشتراک، پول، و موتورِ هوش مصنوعی. */
export const ACCOUNT_TABS: SectionTab[] = [
  { href: "/dashboard/plans", label: "اشتراک" },
  { href: "/dashboard/billing", label: "اعتبار و هزینه" },
  { href: "/dashboard/models", label: "هوش مصنوعی" },
];
