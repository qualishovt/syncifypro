/**
 * scripts/brand.mjs — rasterise the brand SVGs.
 *
 * The four SVGs in public/brand are the source of truth; every PNG and the
 * .ico are derived from them. Edit an SVG, then `npm run brand`, or the
 * rasters silently keep showing the old mark — which is exactly what happened
 * when the arrows were reshaped and nothing regenerated them.
 *
 * Which source feeds which output matters:
 *   - apple-touch-icon and favicon use the SQUARE icon, not the rounded one.
 *     iOS and browsers apply their own corner masking; baking rounding in
 *     leaves dark corners showing through theirs.
 *   - the rounded SVG is what the app itself links as its browser icon, and
 *     the only rounded PNG is the 512 used for listing uploads.
 *
 * The logo SVGs contain live text in Inter. Whatever font the renderer
 * resolves is what lands in the PNG, so check the wordmark after running this
 * on a machine that may not have Inter installed.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const BRAND = "public/brand";

/** [source svg, output png, width, height (square if omitted)] */
const TARGETS = [
  ["syncifypro-icon.svg",         "syncifypro-icon-1200.png",       1200],
  ["syncifypro-icon.svg",         "syncifypro-icon-512.png",         512],
  ["syncifypro-icon-rounded.svg", "syncifypro-icon-rounded-512.png", 512],
  ["syncifypro-icon.svg",         "apple-touch-icon.png",            180],
  ["syncifypro-icon.svg",         "favicon-32.png",                   32],
  ["syncifypro-logo.svg",         "syncifypro-logo.png",            1320, 300],
  ["syncifypro-logo-dark.svg",    "syncifypro-logo-dark.png",       1320, 300],
];

// favicon.ico carries three sizes in one file; browsers pick per context.
const ICO_SIZES = [16, 32, 48];

/**
 * Render an SVG to a PNG buffer. Sharp rasterises at the SVG's own pixel size
 * first, so the small icons are downsampled from 1200px rather than drawn
 * tiny — which keeps the thin arrow strokes from breaking up.
 */
async function render(src, width, height) {
  return sharp(await readFile(path.join(BRAND, src)))
    .resize(width, height ?? width)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

for (const [src, out, w, h] of TARGETS) {
  await writeFile(path.join(BRAND, out), await render(src, w, h));
  console.log(`  ${out.padEnd(34)} ${w}x${h ?? w}`.padEnd(56) + `<- ${src}`);
}

const ico = await pngToIco(
  await Promise.all(ICO_SIZES.map((s) => render("syncifypro-icon.svg", s))),
);
await writeFile("public/favicon.ico", ico);
console.log(`  ${"favicon.ico".padEnd(34)} ${ICO_SIZES.join("/")}`.padEnd(56) + "<- syncifypro-icon.svg");
