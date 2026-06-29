import Link from "next/link";

import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/70 bg-background">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 text-lg font-bold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-2 text-white">
              ک
            </span>
            {site.name}
          </div>
          <p className="mt-3 max-w-sm text-sm leading-7 text-muted">{site.description}</p>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold">محصول</h3>
          <ul className="space-y-2 text-sm text-muted">
            <li><Link href="#features" className="hover:text-foreground">امکانات</Link></li>
            <li><Link href="#how" className="hover:text-foreground">چطور کار می‌کند</Link></li>
            <li><Link href="/blog" className="hover:text-foreground">وبلاگ</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-bold">سایت‌های کاریابی</h3>
          <ul className="space-y-2 text-sm text-muted">
            {site.boards.map((b) => (
              <li key={b.en}>{b.name}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-border/70">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-5 py-5 text-xs text-muted sm:flex-row">
          <p>
            © <span className="ltr-nums">۱۴۰۵</span> {site.name}. تمام حقوق محفوظ است.
          </p>
          <p className="ltr-nums">ساخته‌شده با هوش مصنوعی · Powered by IT Master</p>
        </div>
      </div>
    </footer>
  );
}
