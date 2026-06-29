import { createLlmsRoute } from "@itmaster/sdk/next";

import { itmaster } from "@/lib/itmaster";

// llms.txt برای موتورهای جست‌وجوی هوش مصنوعی.
export const GET = createLlmsRoute(itmaster);
