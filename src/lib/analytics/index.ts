/**
 * بارلِ آنالیتیکسِ سرور-پیش‌فرض. ماژولِ سرور را دوباره export می‌کند تا بیشترِ کدها
 * بتوانند فقط `import { track } from '@/lib/analytics'` بزنند.
 *
 * کامپوننت‌های کلاینت باید صریحاً از `@/lib/analytics/client` import کنند — importِ
 * این فایل از یک فایلِ 'use client' وابستگی‌های server-only را می‌کشد.
 */
export * from "./server";
export { EVENTS, TENANT } from "./types";
export type { EventName, EventProps, IdentifyProps } from "./types";
