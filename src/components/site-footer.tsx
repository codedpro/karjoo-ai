import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { ThemeSwitch } from "@/components/theme";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-hairline">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo size={30} className="text-bone" />
          <p className="mt-3 max-w-sm text-sm leading-7 text-bone-dim">{site.description}</p>
        </div>

        <div>
          <h3 className="tracker-fa mb-3 text-whisper">محصول</h3>
          <ul className="space-y-2 text-sm text-bone-soft">
            <li><Link href="/jobs" className="hover:text-persimmon">کاریاب</Link></li>
            <li><Link href="/#caps" className="hover:text-persimmon">امکانات</Link></li>
            <li><Link href="/#how" className="hover:text-persimmon">چطور کار می‌کند</Link></li>
            <li><Link href="/blog" className="hover:text-persimmon">وبلاگ</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="tracker-fa mb-3 text-whisper">سایت‌های کاریابی</h3>
          <ul className="space-y-2 text-sm text-bone-soft">
            {site.boards.map((b) => (
              <li key={b.id}>{b.name}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-hairline-soft">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-5 text-xs text-bone-dim sm:flex-row">
          <p>
            © <span className="ltr-nums">۱۴۰۵</span> {site.name}. تمام حقوق محفوظ است. ·{" "}
            <a
              href="https://1xai.ir"
              target="_blank"
              rel="noopener"
              className="hover:text-persimmon"
            >
              از خانواده‌ی 1xAi ↗
            </a>
          </p>
          <ThemeSwitch />
          <p>ساخته‌ی تیمِ آی‌تی مستر</p>
        </div>
      </div>
    </footer>
  );
}
