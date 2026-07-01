/**
 * آیکن‌های درون‌خطیِ SVG برای صفحه‌های «اپلای خودکار / ناوگانِ اپلای / رزومه» — بدونِ
 * وابستگیِ خارجی، هم‌سبک با `dashboard-nav.tsx`: viewBox 24، stroke=currentColor،
 * strokeWidth=1.75، caps گِرد. هیچ ایموجی؛ رنگ از `currentColor` می‌آید تا با لحنِ
 * والد (brand/amber/rose/…) هماهنگ شود.
 *
 * server-safe (بدونِ state/`use client`)؛ در هر Server/Client component قابلِ استفاده.
 */
import type { SVGProps } from "react";

import { cn } from "./ui";

const BASE = "h-5 w-5 shrink-0";

function Svg({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(BASE, className)}
      aria-hidden
      {...props}
    />
  );
}

/** رعد/برق — اپلای خودکار. */
export function IconBolt(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M13 3 5 13h6l-1 8 8-11h-6l1-7Z" />
    </Svg>
  );
}

/** هدف — آستانه‌ی امتیازِ تطبیق. */
export function IconTarget(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </Svg>
  );
}

/** سنجه‌ی نیم‌دایره — سقفِ مصرفِ روزانه. */
export function IconGauge(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 14a5 5 0 0 1 5-5" />
      <path d="M4 18a9 9 0 1 1 16 0" />
      <path d="m12 14 3-3" />
    </Svg>
  );
}

/** سرور/دیتاسنتر — ناوگان و سرورِ اپلای. */
export function IconServer(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Svg>
  );
}

/** سپر — امنیت و مرزِ نشست. */
export function IconShield(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3 5 6v5c0 4.4 3 8.2 7 9 4-.8 7-4.6 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

/** پلاگین/افزونه — اتصالِ حساب‌ها. */
export function IconPlug(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M9 3v5M15 3v5" />
      <path d="M7 8h10v3a5 5 0 0 1-10 0V8Z" />
      <path d="M12 16v5" />
    </Svg>
  );
}

/** سند/رسید — ردِ ممیزی. */
export function IconReceipt(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6" />
    </Svg>
  );
}

/** فایل/سند — رزومه و فایل‌های آپلودشده. */
export function IconDoc(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </Svg>
  );
}

/** ابر با فلشِ بالا — آپلود. */
export function IconUpload(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8.5a3.5 3.5 0 0 1 .5 6.95" />
      <path d="M12 12v6M9.5 14.5 12 12l2.5 2.5" />
    </Svg>
  );
}

/** جرقه — پردازشِ هوش مصنوعی. */
export function IconSparkle(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4Z" />
      <path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8L15.5 17.5l1.8-.7L18 15Z" />
    </Svg>
  );
}

/** ستاره — علاقه‌مندی‌ها/دسته‌بندی‌ها. */
export function IconStar(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.9 6.8 20.6l1-5.8L3.5 9.7l5.9-.9L12 3.5Z" />
    </Svg>
  );
}

/** قفل — دسترسیِ محافظت‌شده (ادمین). */
export function IconLock(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <path d="M12 15v2" />
    </Svg>
  );
}

/** مثلثِ هشدار — پیش‌نیاز/اخطار. */
export function IconWarn(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </Svg>
  );
}

/** به‌روزرسانی/چرخش — فرمانِ update. */
export function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8" />
      <path d="M20 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.7 5.7L4 16" />
      <path d="M4 20v-4h4" />
    </Svg>
  );
}

/** پاور — فرمانِ ری‌استارت. */
export function IconPower(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 4v8" />
      <path d="M7.5 7.5a7 7 0 1 0 9 0" />
    </Svg>
  );
}

/** بستن/× — حذفِ چیپ (مهارت/تخصیص). */
export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Svg>
  );
}

/** تیک — انتخابِ فعال. */
export function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m5 12 5 5 9-11" />
    </Svg>
  );
}

/** به‌علاوه — افزودن. */
export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** هواپیمای کاغذی — اپلای/ارسالِ درخواست. */
export function IconSend(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 12.5 20 4l-5 16-3-6-8-1.5Z" />
    </Svg>
  );
}
