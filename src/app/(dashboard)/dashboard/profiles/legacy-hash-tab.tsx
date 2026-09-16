"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * این صفحه قبلاً یک صفحه‌ی بلند با لنگرهای `#resume-settings`، `#providers` و `#targeting`
 * بود. هش به سرور نمی‌رسد، پس لینک‌های قدیمی را این‌جا به زبانه‌ی درست می‌فرستیم.
 */
export function LegacyHashTab({ tabs }: { tabs: { id: string; href: string }[] }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.location.hash.slice(1);
    const tab = tabs.find((t) => t.id === id);
    if (tab) router.replace(tab.href);
  }, [router, tabs]);
  return null;
}
