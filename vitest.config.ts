/**
 * پیکربندی Vitest برای کارجو.
 *
 * قاعده‌ی پروژه: تست‌ها باید بدون شبکه و بدون دیتابیس زنده اجرا شوند (fixture +
 * گیت‌وی mock). تست‌هایی که نیاز به DB/شبکه‌ی واقعی دارند باید integration نام‌گذاری
 * و به‌صورت پیش‌فرض skip شوند.
 *
 * `passWithNoTests` روشن است تا داربست (بدون هیچ تستی) همچنان سبز بماند.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    // فقط تست‌های اپلیکیشن اصلی (src) اجرا می‌شوند؛ افزونه‌ی MV3 پکیج جداگانه با
    // پیکربندی و alias مخصوص خود (extension/vitest.config.ts) است.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // پیش از تست‌ها: بارگذاری .env.local/.env و تأمین مقدار پیش‌فرض DATABASE_URL،
    // تا ماژول‌های سمت‌سرور (که env را اجباری می‌کنند) خودبسنده و بدون DB واقعی اجرا شوند.
    setupFiles: ["./src/test/setup-env.ts"],
    // فایل‌های integration به‌صورت پیش‌فرض اجرا نمی‌شوند (نیازمند DB/شبکه).
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
  resolve: {
    alias: {
      // هم‌راستا با paths در tsconfig.json: "@/*" → "./src/*".
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // ماژول‌های server-only در محیط تست (node، بدون شرط react-server) خطا می‌دهند؛
      // اینجا به یک شیم خالی نگاشت می‌شوند تا ماژول‌های سمت‌سرور قابل تست باشند.
      // این فقط روی تست اثر دارد؛ رفتار زمان اجرای Next دست‌نخورده می‌ماند.
      "server-only": fileURLToPath(new URL("./src/test/server-only.shim.ts", import.meta.url)),
    },
  },
});
