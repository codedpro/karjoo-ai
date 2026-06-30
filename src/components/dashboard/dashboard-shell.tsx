/**
 * پوسته‌ی داشبورد — هدرِ بالایی + ناوبریِ کناری (RTL). Server component.
 *
 * استایل با لندینگِ موجود هم‌خوان است (border/card/brand، فونتِ وزیرمتن). لینکِ
 * فعال با `usePathname` مشخص نمی‌شود (تا server بماند)؛ به‌جایش هر صفحه `active` خود
 * را پاس می‌دهد. «خروج» یک فرمِ ساده با server action است (بدونِ JS هم کار می‌کند).
 */
import Link from "next/link";

import { site } from "@/lib/site";

import { signOut } from "./actions";

type NavKey =
  | "home"
  | "matches"
  | "applications"
  | "interests"
  | "resume"
  | "models"
  | "billing"
  | "plans";

const NAV: { key: NavKey; href: string; label: string; icon: string }[] = [
  { key: "home", href: "/dashboard", label: "خانه", icon: "🏠" },
  { key: "matches", href: "/dashboard/matches", label: "تطبیق‌ها", icon: "🎯" },
  {
    key: "interests",
    href: "/dashboard/interests",
    label: "علاقه‌مندی‌ها",
    icon: "⭐",
  },
  {
    key: "applications",
    href: "/dashboard/applications",
    label: "اپلای‌ها",
    icon: "📨",
  },
  { key: "resume", href: "/dashboard/resume", label: "رزومه", icon: "📄" },
  { key: "models", href: "/dashboard/models", label: "مدلِ هوش مصنوعی", icon: "🤖" },
  { key: "billing", href: "/dashboard/billing", label: "کیف‌پول", icon: "💳" },
  { key: "plans", href: "/dashboard/plans", label: "پلن‌ها", icon: "🪙" },
];

export function DashboardShell({
  active,
  children,
}: {
  active: NavKey;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full">
      {/* ───── هدرِ بالایی ───── */}
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand to-brand-2 text-white">
              ک
            </span>
            <span>{site.name}</span>
            <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-medium text-muted">
              داشبورد
            </span>
          </Link>

          <form action={signOut}>
            <button
              type="submit"
              className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
            >
              خروج
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-6 px-5 py-8">
        {/* ───── ناوبریِ کناری (دسکتاپ) ───── */}
        <aside className="hidden w-52 shrink-0 md:block">
          <nav className="sticky top-24 space-y-1">
            {NAV.map((item) => {
              const isActive = item.key === active;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-brand/10 text-brand"
                      : "text-muted hover:bg-foreground/5 hover:text-foreground"
                  }`}
                >
                  <span className="text-base">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* ───── محتوای صفحه ───── */}
        <main className="min-w-0 flex-1">
          {/* ناوبریِ موبایل */}
          <nav className="mb-6 flex gap-2 overflow-x-auto md:hidden">
            {NAV.map((item) => {
              const isActive = item.key === active;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-border bg-card text-muted"
                  }`}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {children}
        </main>
      </div>
    </div>
  );
}
