// apps/mobile/scripts/generate-brand-assets.mjs · PC-56 MOB-STORE-1 — renders the store/launcher PNGs from the SVG sources in
// assets/brand/src (the Krishalaya Direction-A mark). Reproducible: sharp is a PINNED devDependency (0.35.5), so the same
// sources give the same pixels. Run from anywhere:   node apps/mobile/scripts/generate-brand-assets.mjs
// `--check` renders nothing and verifies the committed PNGs instead (size, and alpha where a store forbids or requires it).
//
//   icon.png                 1024×1024, OPAQUE (App Store rejects alpha)           → expo.icon (iOS + Android legacy)
//   adaptive-foreground.png  1024×1024, transparent, glyph inside the safe zone     → android.adaptiveIcon.foregroundImage
//   adaptive-monochrome.png  1024×1024, transparent, single colour (Android 13+)    → android.adaptiveIcon.monochromeImage
//   splash.png               1024×1024, transparent                                 → expo-splash-screen plugin `image`
//   notification-icon.png    96×96, white silhouette on transparent                 → expo-notifications plugin `icon`
//   play-store-icon.png      512×512, opaque, from icon.svg                         → Google Play listing "App icon" (uploaded by hand)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const BRAND = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'brand');
const BRAND_GREEN = '#1e6f3f';

/** name → { size, opaque, src? } — opaque: true = must have NO alpha channel; false = must keep transparency; src = the SVG
 * (default: same name). */
const TARGETS = {
  icon: { size: 1024, opaque: true },
  'adaptive-foreground': { size: 1024, opaque: false },
  'adaptive-monochrome': { size: 1024, opaque: false },
  splash: { size: 1024, opaque: false },
  'notification-icon': { size: 96, opaque: false },
  'play-store-icon': { size: 512, opaque: true, src: 'icon' },
};

async function render(name, { size, opaque, src = name }) {
  const svg = readFileSync(join(BRAND, 'src', `${src}.svg`));
  let img = sharp(svg, { density: 72 * (size / 96) }).resize(size, size); // density > 72 supersamples the vector, then downscales: smooth edges at every size
  if (opaque) img = img.flatten({ background: BRAND_GREEN }).removeAlpha();
  // Strip metadata (no timestamps / tool versions in the file) so a re-run is byte-stable.
  await img.png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toFile(join(BRAND, `${name}.png`));
  console.log(`brand-assets: wrote ${name}.png (${size}×${size}${opaque ? ', opaque' : ''})`);
}

async function check(name, { size, opaque }) {
  const m = await sharp(join(BRAND, `${name}.png`)).metadata();
  const problems = [];
  if (m.width !== size || m.height !== size) problems.push(`is ${m.width}×${m.height}, expected ${size}×${size}`);
  if (opaque && m.hasAlpha) problems.push('has an alpha channel (the App Store rejects it)');
  if (!opaque && !m.hasAlpha) problems.push('has no alpha channel (it must be transparent)');
  return problems.map((p) => `${name}.png ${p}`);
}

const checkOnly = process.argv.includes('--check');
const failures = [];
for (const [name, spec] of Object.entries(TARGETS)) {
  if (checkOnly) failures.push(...(await check(name, spec)));
  else await render(name, spec);
}
if (checkOnly) {
  if (failures.length) { failures.forEach((f) => console.error(`brand-assets: ${f}`)); process.exitCode = 1; }
  else console.log(`brand-assets: ${Object.keys(TARGETS).length} PNGs OK`);
}
