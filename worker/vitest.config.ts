/**
 * Vitest config for the Karjoo worker-fleet agent.
 *
 * Rule (mirrors the root project + extension): unit tests run with NO real browser
 * and NO network. The Playwright browser is MOCKED via an injectable launcher, and
 * the control-plane API is exercised through an injectable `fetch`. We test the
 * pure logic: enroll + credential persistence, the claim→process→report flow,
 * command handling, session-never-logged, and apply-spec-driven fill.
 *
 * CRITICAL: no test may download a browser or open a socket.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
