import Link from "next/link";

import { Logo } from "@/components/brand/logo";

const nav = [
  { href: "#features", label: "امکانات" },
  { href: "#how", label: "چطور کار می‌کند" },
  { href: "#boards", label: "سایت‌های پشتیبانی‌شده" },
  { href: "/blog", label: "وبلاگ" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link
          href="/"
          className="focus-ring flex items-center rounded-lg"
          aria-label="کارجو — خانه"
        >
          <Logo size={34} title="" className="text-foreground" />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-muted md:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-foreground">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-full px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-foreground/5 sm:inline-block"
          >
            ورود
          </Link>
          <Link
            href="/login"
            className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground shadow-xs transition-transform hover:-translate-y-0.5 hover:brightness-110"
          >
            شروع رایگان
          </Link>
        </div>
      </div>
    </header>
  );
}
