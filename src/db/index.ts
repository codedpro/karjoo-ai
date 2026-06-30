import "server-only";

/**
 * کلاینت Drizzle روی درایور `postgres` (server-only).
 *
 * اتصال از DATABASE_URL خوانده می‌شود (با اعتبارسنجی در src/lib/env.ts).
 * در Next.js توسعه (HMR) ممکن است این ماژول چندبار ارزیابی شود؛ برای جلوگیری از
 * نشت اتصال، نمونه‌ی postgres را روی globalThis کش می‌کنیم.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/lib/env";
import * as schema from "@/db/schema";

const globalForDb = globalThis as unknown as {
  __karjooPg?: ReturnType<typeof postgres>;
};

/** اتصال خام postgres — یک‌بار در فرایند ساخته می‌شود. */
const client =
  globalForDb.__karjooPg ?? postgres(env.DATABASE_URL, { max: 10 });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__karjooPg = client;
}

/** کلاینت Drizzle با کل اسکیما — این را در کد کنترل‌پلین import کنید. */
export const db = drizzle(client, { schema });

export { schema };
export type Database = typeof db;
