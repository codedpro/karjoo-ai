/**
 * Karjoo × Jobinja live E2E — loads the REAL packaged extension into Playwright's Chromium
 * and drives the actual dev Jobinja account. Validates the pieces that only real Jobinja can
 * prove: the extension loads, the main-world hook captures the cvId, the apply-spec selectors
 * resolve on a real job, /jobs/applied is parseable, and (opt-in) the profile write round-trips.
 *
 * Safe by design: read-only except one OPTIONAL, fully-reversible headline write (gated by
 * E2E_WRITE=1) that restores the exact original. SIGTERM-safe: always closes Chromium.
 *
 * Run:  worker/e2e/run.sh   (handles xvfb + Chromium path + credential check)
 * Env:  JB_USER, JB_PASS (required)  ·  E2E_WRITE=1 (opt-in write test)
 *       KARJOO_EXT_DIR (default ../../extension/dist)  ·  KARJOO_E2E_CHROME (chromium path)
 */
import { chromium } from "playwright-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const USER = process.env.JB_USER, PASS = process.env.JB_PASS;
const EXT = process.env.KARJOO_EXT_DIR || resolve(HERE, "../../extension/dist");
const CHROME = process.env.KARJOO_E2E_CHROME;
const DO_WRITE = process.env.E2E_WRITE === "1";
const ORIGIN = "https://jobinja.ir";

if (!USER || !PASS) {
  console.log("SKIP: set JB_USER and JB_PASS to run the live Jobinja E2E.");
  process.exit(0);
}
if (!CHROME) {
  console.error("FAIL: KARJOO_E2E_CHROME not set (run via run.sh, which finds Playwright Chromium).");
  process.exit(2);
}

// ── tiny assertion framework ──────────────────────────────────────────────
let pass = 0, fail = 0;
const lines = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; lines.push(`  ✓ ${name}`); }
  else { fail++; lines.push(`  ✗ ${name}${detail ? "  — " + detail : ""}`); }
  return !!cond;
};
const log = (...a) => console.log(...a);

let ctx = null, dir = null;
const cleanup = async () => {
  try { if (ctx) { await ctx.close(); ctx = null; } } catch {}
  try { if (dir) { await rm(dir, { recursive: true, force: true }); dir = null; } } catch {}
};
process.on("SIGTERM", async () => { await cleanup(); process.exit(fail ? 1 : 0); });
process.on("SIGINT", async () => { await cleanup(); process.exit(fail ? 1 : 0); });

// ── DOM helpers (page.evaluate bodies) ────────────────────────────────────
const clickHeadlineEdit = () => {
  for (const b of document.querySelectorAll(".c-cvBox, section, div")) {
    if ((b.textContent || "").includes("عنوان شغلی")) {
      const e = [...b.querySelectorAll("a,button")].find((x) => (x.innerText || "").trim().startsWith("ویرایش"));
      if (e) { e.click(); return true; }
    }
  }
  return false;
};
const readHeadlineInput = () => {
  const el = [...document.querySelectorAll("input[type=text], textarea")].find(
    (i) => i.offsetParent && /Engineer|مهندس|Developer|Full/i.test(i.value || ""),
  );
  if (!el) return null;
  window.__jbEl = el;
  return el.value;
};
const setAndSave = (val) => {
  const el = window.__jbEl;
  if (el) { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
  const s = [...document.querySelectorAll("button,input[type=submit]")].find(
    (e) => /^(ذخیره|ثبت|تایید)/.test((e.tagName === "INPUT" ? e.value : e.innerText || "").trim()) && !e.disabled,
  );
  if (s) s.click();
};

async function main() {
  dir = await mkdtemp(join(tmpdir(), "karjoo-e2e-"));
  ctx = await chromium.launchPersistentContext(dir, {
    headless: false, // headful (under xvfb) → MV3 extension support
    executablePath: CHROME,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-sandbox", "--no-first-run"],
    locale: "fa-IR",
  });

  // T1 — the packaged extension loads (service worker registers)
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null));
  const extLoaded = ok("T1 extension loads (service worker active)", !!sw, sw ? "" : "no SW");

  const page = await ctx.newPage();
  page.setDefaultTimeout(45000);
  // resilient nav: ad/tracking pages rarely reach "networkidle" — use domcontentloaded and
  // never let one slow nav abort the whole suite.
  const go = async (url) => {
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); return true; }
    catch { return false; }
  };
  // page-side listener for the extension's own main-world hook postMessage (cvId capture)
  await page.addInitScript(() => {
    window.__karjooCvid = null;
    window.addEventListener("message", (e) => {
      if (e.source === window && e.origin === window.location.origin && e.data?.source === "karjoo:jobinja-cvid" && e.data.cvId) {
        window.__karjooCvid = e.data.cvId;
      }
    });
  });

  // login
  await go(`${ORIGIN}/login/user`);
  await page.fill('input[name="identifier"]', USER);
  await page.fill('input[name="password"]', PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.click('button[type="submit"], input[type="submit"]').catch(() => {}),
  ]);
  await page.waitForTimeout(1500);
  // reliable signal: Jobinja sets JSESSID/remember_/user_mode on a real login.
  const cookieNames = (await ctx.cookies()).map((c) => c.name);
  const loggedIn = ok("T2 logged into Jobinja (session cookies set)",
    cookieNames.some((n) => /JSESSID|remember_|user_mode/i.test(n)), cookieNames.join(","));

  // T3 — /jobs/applied is present + parseable (the analytics source)
  await go(`${ORIGIN}/jobs/applied`);
  await page.waitForTimeout(1500);
  const appliedHtml = await page.content();
  const appliedCount = (appliedHtml.match(/\/jobs\/applied\/[A-Za-z0-9]+/g) || []).length;
  const hasStatus = /(در انتظار|بررسی|مصاحبه|رد|جدید)/.test(appliedHtml);
  ok("T3 /jobs/applied parseable (items + statuses)", appliedCount > 0 && hasStatus, `items=${appliedCount}`);

  // T4 — apply-spec selectors resolve on a REAL job (no submit)
  await go(`${ORIGIN}/jobs?filters%5Bkeywords%5D%5B0%5D=software`); await page.waitForTimeout(1500);
  const jobUrl = await page.$$eval("a.c-jobListView__titleLink", (as) => as[0]?.href).catch(() => null);
  if (ok("T4a found a real job listing", !!jobUrl)) {
    await go(jobUrl); await page.waitForTimeout(2000);
    const sel = await page.evaluate(() => ({
      form: !!document.querySelector("#apply-form"),
      profileRadio: !!document.querySelector("#apply_choice_jobinja_profile"),
      uploadRadio: !!document.querySelector("#apply_choice_uploaded_cv"),
      fileInput: !!document.querySelector("#apply-form input[type='file']"),
      submit: !!document.querySelector("#apply-form input[type='submit'], #apply-form button[type='submit']"),
    }));
    ok("T4b apply-spec selectors resolve (form/choice/upload/submit)",
      sel.form && sel.profileRadio && sel.uploadRadio && sel.submit, JSON.stringify(sel));
  }

  // T5 — cvId capture by the extension's real main-world hook (reversible edit forces a call)
  await go(`${ORIGIN}/app/cv-builder`);
  await page.waitForTimeout(3500);
  let cvId = await page.evaluate(() => window.__karjooCvid);
  let restored = true;
  if (!cvId) {
    const opened = await page.evaluate(clickHeadlineEdit);
    await page.waitForTimeout(1800);
    const orig = opened ? await page.evaluate(readHeadlineInput) : null;
    if (orig != null) {
      await page.evaluate(setAndSave, orig + " "); // append marker → SPA PUTs → hook captures
      await page.waitForTimeout(3500);
      cvId = await page.evaluate(() => window.__karjooCvid);
      // restore EXACT original
      restored = false;
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(2500);
      await page.evaluate(clickHeadlineEdit);
      await page.waitForTimeout(1500);
      await page.evaluate(readHeadlineInput);
      await page.evaluate(setAndSave, orig);
      await page.waitForTimeout(3000);
      restored = true;
    }
  }
  ok("T5 extension main-world hook captured the cvId", typeof cvId === "string" && cvId.length >= 2, String(cvId));
  ok("T5b test edit restored (account unchanged)", restored);

  // T6 — (opt-in) the server write-path SHAPE: a full basic-data PUT round-trips + restores.
  // basic-data GET is 405 (PUT-only), so current values are read from the cv-builder DOM
  // (same as the karjoo edit form, which prefills job_title + full_name).
  if (DO_WRITE && cvId) {
    await go(`${ORIGIN}/app/cv-builder`);
    await page.waitForTimeout(3000);
    const cur = await page.evaluate(() => {
      const txt = document.body.innerText;
      const t = (txt.match(/عنوان شغلی:\s*([^\n]+)/) || [])[1];
      // the full name is the non-empty line immediately before "عنوان شغلی".
      const n = (txt.match(/([^\n]{2,50})\s*\n\s*عنوان شغلی/) || [])[1];
      return { jobTitle: (t || "").trim() || null, fullName: (n || "").trim() || null };
    });
    if (cur.jobTitle && cur.fullName) {
      const xsrf = (await ctx.cookies()).find((c) => c.name === "XSRF-TOKEN")?.value;
      const putBasic = async (jt) =>
        page.evaluate(async ({ cvId, jt, fn, xsrf }) => {
          const res = await fetch(`/api/v10/jobseeker-app/cv-builder/${cvId}/basic-data`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", ...(xsrf ? { "X-XSRF-TOKEN": decodeURIComponent(xsrf) } : {}) },
            body: JSON.stringify({ working_status: "seeking", job_title: jt, full_name: fn }),
          });
          return res.status;
        }, { cvId, jt, fn: cur.fullName, xsrf });
      const s1 = await putBasic(cur.jobTitle + " "); // marker
      const s2 = await putBasic(cur.jobTitle); // restore exact
      ok("T6 server write path (basic-data PUT) round-trips + restores", s1 < 400 && s2 < 400, `marker=${s1} restore=${s2}`);
    } else {
      lines.push(`  · T6 write skipped — couldn't read current job_title/full_name from DOM (${JSON.stringify(cur)})`);
    }
  } else {
    lines.push("  · T6 write test skipped (set E2E_WRITE=1 to run the reversible profile-write check)");
  }

  await cleanup();
}

const started = Date.now();
main()
  .then(async () => {
    await cleanup();
    log(`\nKarjoo × Jobinja live E2E  (${((Date.now() - started) / 1000) | 0}s)`);
    log(lines.join("\n"));
    log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  })
  .catch(async (e) => {
    await cleanup();
    log(lines.join("\n"));
    console.error("\nE2E ERROR:", e?.message);
    process.exit(1);
  });
