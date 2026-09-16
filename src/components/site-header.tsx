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
    <header className="sticky top-0 z-40 border-b border-hairline bg-night-900/85 backdrop-blur-xl supports-backdrop-filter:bg-night-900/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link
          href="/"
          className="focus-ring flex items-center"
          aria-label="کارجو — خانه"
        >
          <Logo size={30} title="" className="text-bone" />
        </Link>

        <nav className="hidden items-center gap-7 text-sm text-bone-soft md:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="transition-colors hover:text-persimmon">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="focus-ring hidden px-3 py-2 text-sm text-bone-soft transition-colors hover:text-bone sm:inline-block"
          >
            ورود
          </Link>
          <Link
            href="/login"
            className="focus-ring press bg-persimmon px-4 py-2 text-sm font-medium text-night-950 transition-colors hover:bg-persimmon-soft"
          >
            شروع رایگان
          </Link>
        </div>
      </div>
    </header>
  );
}
