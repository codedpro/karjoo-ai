/**
 * Vitest config for the Karjoo MV3 extension.
 *
 * Rule (mirrors the root project): unit tests run with NO real browser and NO
 * network. We test the pure logic only (storage helpers, the metadata-only
 * connect payload builder, queue rendering helpers). The DOM-driven UI and
 * chrome.* APIs are exercised via tiny injectable fakes, never a live browser.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
  resolve: {
    alias: {
      "@ext": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
