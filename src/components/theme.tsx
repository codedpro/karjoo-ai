"use client";

/**
 * تمِ کارجو — همان پیکربندیِ 1xAi (web/components/theme.tsx).
 *
 * • پیش‌فرض تیره است و «سیستم» دنبال نمی‌شود (`enableSystem={false}`)؛ سایت همان‌طور که
 *   طراحی شده دیده می‌شود مگر کاربر خودش «روشن» را بخواهد.
 * • `attribute="class"`: next-themes کلاسِ `dark`/`light` را روی <html> عوض می‌کند. HTMLِ
 *   سرور همیشه `class="dark"` دارد؛ اسکریپتِ پیش از رنگ‌آمیزیِ next-themes مقدارِ
 *   ذخیره‌شده در localStorage را قبل از اولین paint اعمال می‌کند.
 * • رنگ‌ها این‌جا نیستند: هر دو تم بازتعریفِ توکن‌ها در `globals.css` است
 *   (`html.light { --color-night-900: … }`). این فایل فقط کلاس را انتخاب می‌کند.
 */
import * as React from "react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/components/dashboard/ui";

/** دو تم، به ترتیبِ نمایش در سوییچ. */
const THEMES = ["dark", "light"] as const;
type ThemeName = (typeof THEMES)[number];

/**
 * رنگِ نوارِ وضعیتِ موبایل. `viewport.themeColor` در layout مقدارِ ثابتِ تیره است؛
 * ThemeMeta آن را با تمِ واقعی هم‌گام می‌کند.
 */
const THEME_COLOR: Record<ThemeName, string> = {
  dark: "#0d0a07", // --color-night-900
  light: "#faf6ee", // --color-night-900 در تمِ روشن
};

/* ───────────────────────────── provider ───────────────────────────── */

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      themes={[...THEMES]}
      defaultTheme="dark"
      enableSystem={false}
      enableColorScheme
      // بدونِ این، هر transition-colors جداگانه انیمیت می‌شود و جابه‌جاییِ تم «لک» می‌شود.
      disableTransitionOnChange
    >
      <ThemeMeta />
      {children}
    </NextThemeProvider>
  );
}

/** چیزی رندر نمی‌کند؛ <meta name="theme-color"> را با تمِ فعال هم‌گام نگه می‌دارد. */
function ThemeMeta(): null {
  const { resolvedTheme } = useTheme();
  React.useEffect(() => {
    const color = THEME_COLOR[resolvedTheme === "light" ? "light" : "dark"];
    const apply = () => {
      document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
        if (meta.getAttribute("content") !== color) meta.setAttribute("content", color);
      });
    };
    apply();
    // Next 16 متادیتای viewport را استریم می‌کند؛ تگ ممکن است بعد از این effect به <head>
    // اضافه (یا دوباره رندر) شود. پس تغییراتِ head را می‌پاییم و دوباره اعمال می‌کنیم.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["content"],
    });
    return () => observer.disconnect();
  }, [resolvedTheme]);
  return null;
}

/* ───────────────────────────── switcher ───────────────────────────── */

export interface ThemeSwitchProps {
  /**
   * "inline" — فقط جفتِ دکمه‌ها (فوتر).
   * "row"    — ردیفِ برچسب‌دار (آیکن · «حالت نمایش» · جفتِ دکمه‌ها) برای منو/ستونِ کناری.
   */
  variant?: "inline" | "row";
  className?: string;
}

const LABELS = { group: "حالت نمایش", dark: "تیره", light: "روشن" } as const;

/** مقدارِ «mounted» بدونِ setState در effect — سرور false، کلاینت true. */
const subscribeNoop = () => () => {};

export function ThemeSwitch({ variant = "inline", className }: ThemeSwitchProps) {
  const { theme, setTheme } = useTheme();

  // سرور همیشه «تیره» رندر می‌کند؛ مقدارِ واقعی فقط پس از hydrate خوانده می‌شود تا
  // درختِ کلاینت با HTMLِ سرور یکی بماند.
  const mounted = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const active: ThemeName = mounted && theme === "light" ? "light" : "dark";

  const control = (
    <div
      role="group"
      aria-label={LABELS.group}
      className={cn(
        "inline-flex shrink-0 items-center border rule-soft",
        variant === "inline" && className,
      )}
    >
      {THEMES.map((name, i) => {
        const on = active === name;
        const Icon = name === "dark" ? Moon : Sun;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(name)}
            className={cn(
              "focus-ring press inline-flex items-center gap-1.5 px-3 py-1.5",
              "text-xs font-semibold leading-[1.6] transition-colors",
              i > 0 && "border-s rule-soft",
              on ? "bg-bone/10 text-bone" : "text-bone-dim hover:text-bone",
            )}
          >
            <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            {name === "dark" ? LABELS.dark : LABELS.light}
          </button>
        );
      })}
    </div>
  );

  if (variant === "inline") return control;

  return (
    <div
      className={cn(
        "flex items-center gap-3 text-sm leading-snug text-bone-soft",
        className,
      )}
    >
      <Monitor className="size-4 shrink-0 text-bone-dim" strokeWidth={1.75} aria-hidden />
      <span className="min-w-0 flex-1 text-start">{LABELS.group}</span>
      {control}
    </div>
  );
}
