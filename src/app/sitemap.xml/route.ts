import { createSitemapRoute } from "@itmaster/sdk/next";

import { itmaster } from "@/lib/itmaster";

// نقشه‌ی سایت تولیدشده توسط موتور IT Master از روی مقالات منتشرشده.
export const GET = createSitemapRoute(itmaster);
