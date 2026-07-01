/**
 * Generate the extension toolbar / store icons from the KafSpark brand mark.
 *
 * The mark matches src/components/brand/logo.tsx (KafSparkMark): a round «ک»
 * "bowl" body filled with the brand gradient (#5b3df5 → #8b5cf6), with a cyan
 * automation "spark/bolt" (#06b6d4 → #67e8f9) rising out of it. We rasterize an
 * inline SVG with `sharp` at each size Chrome asks for.
 *
 * 16px uses a SIMPLIFIED, high-contrast variant: a solid disc + a bolder,
 * stroke-outlined spark so it stays legible as a tiny toolbar glyph.
 *
 * Run: `node scripts/gen-icons.mjs` (writes extension/icons/icon-*.png).
 */
import sharp from "sharp";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, "..", "icons");

const BRAND = "#5b3df5";
const BRAND2 = "#8b5cf6";
const ACCENT = "#06b6d4";
const ACCENT2 = "#67e8f9";

/**
 * Full-detail mark (48×48 coord space, from logo.tsx KafSparkMark) — used for
 * 32/48/128 where the thin stroke + inner cut-out render cleanly.
 */
function markSvg(px) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND}"/>
      <stop offset="1" stop-color="${BRAND2}"/>
    </linearGradient>
    <linearGradient id="bolt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ACCENT}"/>
      <stop offset="1" stop-color="${ACCENT2}"/>
    </linearGradient>
  </defs>
  <path d="M24 4C12.954 4 4 12.954 4 24s8.954 20 20 20 20-8.954 20-20a19.9 19.9 0 0 0-1.06-6.44l-7.9 5.2A11.98 11.98 0 1 1 24 12c1.61 0 3.15.32 4.56.9l4.7-6.35A19.9 19.9 0 0 0 24 4Z" fill="url(#brand)"/>
  <path d="M25 15 21 26h5l-3 9 13-15h-6l6-8-11 3Z" fill="url(#bolt)" stroke="#ffffff" stroke-width="0.75" stroke-linejoin="round"/>
</svg>`;
}

/**
 * Simplified high-contrast mark for 16px: solid brand disc (no thin ring cut),
 * bolder spark with a white outline so the bolt reads at toolbar size.
 */
function markSvg16() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND}"/>
      <stop offset="1" stop-color="${BRAND2}"/>
    </linearGradient>
    <linearGradient id="bolt" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ACCENT2}"/>
      <stop offset="1" stop-color="${ACCENT}"/>
    </linearGradient>
  </defs>
  <circle cx="24" cy="24" r="21" fill="url(#brand)"/>
  <path d="M26 12 19 27h6l-4 11 15-19h-7l7-9-14 2Z" fill="url(#bolt)" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
}

async function main() {
  await mkdir(iconsDir, { recursive: true });
  const sizes = [16, 32, 48, 128];
  for (const size of sizes) {
    const svg = size === 16 ? markSvg16() : markSvg(size);
    const out = resolve(iconsDir, `icon-${size}.png`);
    await sharp(Buffer.from(svg))
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    // eslint-disable-next-line no-console
    console.log(`[gen-icons] wrote ${out} (${size}×${size})`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[gen-icons] failed:", err);
  process.exit(1);
});
