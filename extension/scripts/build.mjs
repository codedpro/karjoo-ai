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

const buildOptions = {
  entryPoints,
  outdir,
  bundle: true,
  format: "esm",
  target: ["chrome110"],
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
  // Inline a build-time API origin so the bundle has a sane default; the user
  // can still override it at runtime via the popup (stored in chrome.storage).
  define: {
    "process.env.KARJOO_API_DEFAULT": JSON.stringify(
      process.env.KARJOO_API ?? "http://localhost:3000",
    ),
  },
};

async function run() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  if (watch) {
    const ctx = await context(buildOptions);
    await ctx.watch();
    await copyStatics();
    // eslint-disable-next-line no-console
    console.log("[karjoo-ext] watching for changes…");
    return;
  }

  await build(buildOptions);
  await copyStatics();
  // eslint-disable-next-line no-console
  console.log("[karjoo-ext] build complete → dist/");
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[karjoo-ext] build failed:", err);
  process.exit(1);
});
