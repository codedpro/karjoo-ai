/**
 * Build the Karjoo MV3 extension with esbuild.
 *
 * Produces a loadable dist/:
 *   dist/background.js        — service worker (module type)
 *   dist/popup.js             — popup UI controller
 *   dist/popup.html + .css    — popup markup/styles
 *   dist/content/jobinja.js   — Jobinja content script (cookie-shaped board)
 *   dist/content/jobvision.js — JobVision content script (token-shaped board)
 *   dist/manifest.json        — copied verbatim
 *   dist/icons/*              — copied verbatim
 *
 * Run: `npm run build` (one-shot) or `npm run build:watch`.
 */
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outdir = resolve(root, "dist");

const watch = process.argv.includes("--watch");

/** All bundled TS entry points → their output path under dist/. */
const entryPoints = {
  background: resolve(root, "src/background/service-worker.ts"),
  popup: resolve(root, "src/popup/popup.ts"),
  "content/jobinja": resolve(root, "src/content/jobinja.ts"),
  "content/jobvision": resolve(root, "src/content/jobvision.ts"),
  // Profile-import content scripts (one per board) — read the user's OWN profile
  // DOM and return DATA only (§10). See src/content/import/*.
  "content/import/jobinja": resolve(root, "src/content/import/jobinja.ts"),
  "content/import/jobvision": resolve(root, "src/content/import/jobvision.ts"),
  "content/import/eestekhdam": resolve(root, "src/content/import/eestekhdam.ts"),
  "content/import/irantalent": resolve(root, "src/content/import/irantalent.ts"),
  // Auto-apply content scripts (one per board) — run the APPLY_SPEC executor when
  // the background runner sends CONTENT_APPLY (toggle ON + under cap + above
  // threshold). jobinja best-effort; others scaffold (§10). See src/content/apply/*.
  "content/apply/jobinja": resolve(root, "src/content/apply/jobinja.ts"),
  "content/apply/jobvision": resolve(root, "src/content/apply/jobvision.ts"),
  "content/apply/eestekhdam": resolve(root, "src/content/apply/eestekhdam.ts"),
  "content/apply/irantalent": resolve(root, "src/content/apply/irantalent.ts"),
  // Session-storage capture probe (one shared script on every board) — captures
  // the user's OWN localStorage/sessionStorage for the LOCAL session snapshot
  // (and premium vault push). See src/content/session-probe.ts.
  "content/session-probe": resolve(root, "src/content/session-probe.ts"),
};

/** Static files copied verbatim into dist/. */
const staticCopies = [
  ["manifest.json", "manifest.json"],
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
  ["icons", "icons"],
  // Chrome requires a _locales/<default_locale> dir whenever the manifest sets
  // default_locale (even with no __MSG__ placeholders); copy it verbatim.
  ["_locales", "_locales"],
];

async function copyStatics() {
  for (const [from, to] of staticCopies) {
    const src = resolve(root, from);
    if (!existsSync(src)) continue;
    const dest = resolve(outdir, to);
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest, { recursive: true });
  }
}

/**
 * Split esbuild output format by entry path.
 *
 * Content scripts are injected via `manifest.content_scripts` and run in the page
 * as CLASSIC scripts — a top-level `export {}` is a SyntaxError there ("Unexpected
 * token 'export'"). So EVERY entry under `content/` (the per-board main scripts,
 * `apply/*`, `import/*`, and the shared `session-probe`) MUST be emitted as an
 * IIFE with all deps inlined (bundle:true, external:[]) so no top-level ESM
 * syntax survives.
 *
 * `background` and `popup` load as MODULES (manifest `background.type:"module"`,
 * and popup.html uses `<script type="module">`), so they stay `format:"esm"`.
 */
function isContentEntry(name) {
  return name === "content" || name.startsWith("content/");
}

const sharedDefine = {
  // Inline the PRODUCTION control-plane origin at build time. This is the ONLY
  // source of the API origin — the extension does NOT let the user repoint it
  // (see src/lib/config.ts + src/lib/storage.ts getApiOrigin, which is locked to
  // this compile-time constant). Override only for local dev builds via KARJOO_API.
  "process.env.KARJOO_API_DEFAULT": JSON.stringify(
    process.env.KARJOO_API ?? "https://karjoo.1xai.ir",
  ),
  // Auto-apply timing (mirrors the control-plane env defaults). Optional
  // build-time overrides; the server toggle + daily cap remain authoritative.
  "process.env.KARJOO_AUTO_APPLY_ALARM_MINUTES": JSON.stringify(
    process.env.KARJOO_AUTO_APPLY_ALARM_MINUTES ?? "15",
  ),
  "process.env.KARJOO_AUTO_APPLY_JITTER_MS_MIN": JSON.stringify(
    process.env.KARJOO_AUTO_APPLY_JITTER_MS_MIN ?? "2000",
  ),
  "process.env.KARJOO_AUTO_APPLY_JITTER_MS_MAX": JSON.stringify(
    process.env.KARJOO_AUTO_APPLY_JITTER_MS_MAX ?? "8000",
  ),
  "process.env.KARJOO_SESSION_REFRESH_MINUTES": JSON.stringify(
    process.env.KARJOO_SESSION_REFRESH_MINUTES ?? "30",
  ),
};

// Split the entry points into two groups by output format (see isContentEntry).
const contentEntries = {};
const moduleEntries = {};
for (const [name, entry] of Object.entries(entryPoints)) {
  if (isContentEntry(name)) contentEntries[name] = entry;
  else moduleEntries[name] = entry;
}

const commonOptions = {
  outdir,
  target: ["chrome110"],
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
  define: sharedDefine,
};

/** background + popup → ES modules (loaded via type:"module" / <script type=module>). */
const moduleBuildOptions = {
  ...commonOptions,
  entryPoints: moduleEntries,
  bundle: true,
  format: "esm",
};

/**
 * content/** → classic IIFE with ALL deps inlined. Injected content scripts are
 * classic scripts; a surviving top-level `export` throws at load. `external:[]`
 * forces every import to be bundled in so nothing ESM leaks to the top level.
 */
const contentBuildOptions = {
  ...commonOptions,
  entryPoints: contentEntries,
  bundle: true,
  format: "iife",
  external: [],
};

const allBuildOptions = [moduleBuildOptions, contentBuildOptions];

async function run() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  if (watch) {
    for (const opts of allBuildOptions) {
      const ctx = await context(opts);
      await ctx.watch();
    }
    await copyStatics();
    // eslint-disable-next-line no-console
    console.log("[karjoo-ext] watching for changes…");
    return;
  }

  await Promise.all(allBuildOptions.map((opts) => build(opts)));
  await copyStatics();
  // eslint-disable-next-line no-console
  console.log("[karjoo-ext] build complete → dist/");
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[karjoo-ext] build failed:", err);
  process.exit(1);
});
