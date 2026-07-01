/**
 * چیپِ کاربر در هدرِ داشبورد (Server component) — داخلِ `<Suspense>` استریم می‌شود.
 *
 * این تنها بخشِ هدر است که به DB وابسته است (راستی‌آزماییِ نشست + خواندنِ پروفایل)؛
 * پس عمداً از پوسته‌ی استاتیک جدا شده تا هدر/برند فوراً بیایند و فقط این تکه استریم شود.
 *
 * اگر نشست معتبر نبود (کوکیِ جعلی/منقضی که proxy نتوانست تشخیص دهد)، به /login می‌رود —
 * این‌جا نقطه‌ی «راستی‌آزماییِ کاملِ سمتِ سرور» است که proxyِ ارزان آن را انجام نمی‌دهد.
 */
import { redirect } from "next/navigation";

import { getDashboardUser } from "./session";
import { cn } from "./ui";

/** حروفِ اولِ نام برای آواتارِ متنی (وقتی عکسی نیست). */
function initials(name: string | null, email: string | null): string {
  const src = (name ?? email ?? "؟").trim();
  const first = src[0] ?? "؟";
  return first.toUpperCase();
}

export async function DashboardUserChip() {
  const user = await getDashboardUser();
  // راستی‌آزماییِ کامل این‌جاست: کوکیِ نامعتبر → خروج به /login.
  if (!user) redirect("/login");

  const displayName = user.fullName ?? user.name ?? "کاربر کارجو";
  const secondary = user.email ?? null;

  return (
    <div className="flex items-center gap-2.5">
      <div className="hidden min-w-0 text-end sm:block">
        <div className="max-w-[12rem] truncate text-sm font-semibold" title={displayName}>
          {displayName}
        </div>
        {secondary ? (
          <div
            className="ltr-nums max-w-[12rem] truncate text-xs text-muted"
            title={secondary}
          >
            {secondary}
          </div>
        ) : null}
      </div>

      <Avatar name={displayName} email={secondary} src={user.avatarUrl} />
    </div>
  );
}

function Avatar({
  name,
  email,
  src,
}: {
  name: string | null;
  email: string | null;
  src: string | null;
}) {
  const base =
    "grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full ring-2 ring-border";
  if (src) {
    return (
      // آواتارِ Google — منبعِ بیرونی؛ next/image لازم نیست (اندازه‌ی ثابت و کوچک).
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={36}
        height={36}
        className={cn(base, "object-cover")}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span
      className={cn(base, "bg-gradient-to-br from-brand to-brand-2 text-sm font-bold text-white")}
      aria-hidden
    >
      {initials(name, email)}
    </span>
  );
}

/** اسکلتِ چیپِ کاربر — همان اندازه/شکلِ چیپِ واقعی (fallbackِ Suspense). */
export function DashboardUserChipSkeleton() {
  return (
    <div className="flex items-center gap-2.5" aria-hidden>
      <div className="hidden space-y-1.5 sm:block">
        <div className="skeleton-shimmer h-3.5 w-24 rounded bg-foreground/[0.06]" />
        <div className="skeleton-shimmer h-3 w-32 rounded bg-foreground/[0.06]" />
      </div>
      <div className="skeleton-shimmer h-9 w-9 rounded-full bg-foreground/[0.06]" />
    </div>
  );
}
