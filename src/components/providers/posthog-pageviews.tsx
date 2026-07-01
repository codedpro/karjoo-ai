"use client";

/**
 * ردیابِ pageviewِ SPA برای PostHog — روی هر ناوبریِ کلاینتِ App Router یک
 * `$pageview` می‌زند. در کامپوننتِ جداگانه است تا مرزِ suspenseِ `useSearchParams`
 * کوچک بماند (وگرنه کلِ layout به CSR بازمی‌گردد).
 */

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { trackPageview } from "@/lib/analytics/client";

export function PostHogPageviews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const qs = searchParams?.toString();
    trackPageview(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, searchParams]);

  return null;
}
