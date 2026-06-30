/**
 * پیکربندی drizzle-kit — برای `npm run db:generate` و introspection.
 * بیرون از Next اجرا می‌شود؛ پس متغیرها را خودش از .env.local / .env می‌خواند.
 */
import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // برای generate لازم نیست؛ برای push/introspect استفاده می‌شود.
    url:
      process.env.DATABASE_URL ??
      "postgres://karjoo:karjoo@localhost:5432/karjoo",
  },
  verbose: true,
  strict: true,
});
