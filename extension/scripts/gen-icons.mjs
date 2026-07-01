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
 * Karjoo badge mark (64×64 coord space, matches logo.tsx KarjooBadge) — brand
 * gradient rounded square + white "K" monogram + a cyan spark dot. Used for
 * 32/48/128 where the strokes render cleanly.
 */
function markSvg(px) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND}"/>
      <stop offset="1" stop-color="${BRAND2}"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="56" height="56" rx="18" fill="url(#brand)"/>
  <path d="M23 15V49" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round"/>
  <path d="M43.5 15 27.5 32 43.5 49" fill="none" stroke="#ffffff" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="45.5" cy="13.5" r="4.6" fill="${ACCENT}"/>
</svg>`;
}

/**
 * Simplified high-contrast mark for 16px: fuller badge, bolder "K" strokes and a
 * brighter, larger spark dot so the monogram reads at toolbar size.
 */
function markSvg16() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${BRAND}"/>
      <stop offset="1" stop-color="${BRAND2}"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#brand)"/>
  <path d="M24 14V50" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
  <path d="M44 14 28 32 44 50" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="46.5" cy="13" r="6" fill="${ACCENT2}"/>
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
