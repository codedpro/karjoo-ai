/**
 * Capture a fresh Jobinja session for vault provisioning (owner-authorized).
 * Logs in with the dev account and writes the cookie bundle to OUT/session.json
 * in the exact shape sessionBundleSchema expects. SIGTERM-safe.
 */
import { chromium } from "playwright-core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const USER = process.env.JB_USER, PASS = process.env.JB_PASS;
const CHROME = process.env.KARJOO_E2E_CHROME;
const OUT = process.env.OUT || "/tmp";
const ORIGIN = "https://jobinja.ir";
if (!USER || !PASS || !CHROME) { console.error("need JB_USER/JB_PASS/KARJOO_E2E_CHROME"); process.exit(2); }

let ctx = null, dir = null;
const cleanup = async () => { try { if (ctx) await ctx.close(); } catch {} try { if (dir) await rm(dir, { recursive: true, force: true }); } catch {} };
process.on("SIGTERM", async () => { await cleanup(); process.exit(1); });
process.on("SIGINT", async () => { await cleanup(); process.exit(1); });

async function main() {
  dir = await mkdtemp(join(tmpdir(), "karjoo-prov-"));
  ctx = await chromium.launchPersistentContext(dir, {
    headless: false, executablePath: CHROME, args: ["--no-sandbox", "--no-first-run"], locale: "fa-IR",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  const go = async (u) => { try { await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 }); return true; } catch { return false; } };

  await go(`${ORIGIN}/login/user`);
  await page.fill('input[name="identifier"]', USER);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click('button[type="submit"], input[type="submit"]').catch(() => {}),
  ]);
  await page.waitForTimeout(2000);

  const cookies = await ctx.cookies();
  const names = cookies.map((c) => c.name);
  if (!names.some((n) => /JSESSID|remember_|user_mode/i.test(n))) {
    throw new Error("login failed — no session cookie. got: " + names.join(","));
  }

  // Confirm the session is genuinely authenticated (not just cookies present).
  await go(`${ORIGIN}/jobs/applied`);
  await page.waitForTimeout(1500);
  const authed = await page.evaluate(() => !/ورود|login/i.test(document.title) && document.body.innerText.length > 200);

  const userAgent = await page.evaluate(() => navigator.userAgent);

  const bundle = {
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      ...(typeof c.expires === "number" && c.expires > 0 ? { expirationDate: c.expires } : {}),
    })),
    userAgent,
    capturedAt: new Date().toISOString(),
  };

  await writeFile(join(OUT, "session.json"), JSON.stringify(bundle, null, 2));
  console.log(`· captured ${bundle.cookies.length} cookies (authenticated=${authed})`);
  console.log(`· session cookie names: ${names.filter((n) => /JSESSID|remember_|user_mode|XSRF/i.test(n)).join(", ")}`);
  await cleanup();
}
main().then(async () => { await cleanup(); process.exit(0); }).catch(async (e) => { await cleanup(); console.error("CAPTURE ERROR:", e?.message); process.exit(1); });
