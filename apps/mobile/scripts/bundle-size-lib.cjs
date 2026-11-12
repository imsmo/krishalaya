// apps/mobile/scripts/bundle-size-lib.cjs · PC-56 BUNDLE-1a · the PURE half of the bundle-size gate (check-bundle-size.mjs),
// split out so jest can pin it with no export, no network: which export command runs (and from where), which files are
// summed, and the budget verdict. CommonJS so both the .mjs gate and the ts-jest "core" project can load it unchanged.
'use strict';
const path = require('node:path');

/** The mobile app dir, resolved from THIS file's location — never process.cwd() (CI runs the gate from the repo root,
 *  where `expo export` treats the root as the project and fails with "Unable to resolve module ../../App"). */
const APP_DIR = path.resolve(__dirname, '..');

/** Default budget, KB (1 KB = 1,024 B). The limit stays 6,000 KB (founder, BUNDLE-1); MOBILE_BUNDLE_BUDGET_KB overrides. */
const DEFAULT_BUDGET_KB = 6000;

/** The `npx` argv for the export. `--source-maps` makes hermesc emit `-output-source-map`, which moves the debug tables
 *  out of the .hbc — exactly as release builds do (@react-native/gradle-plugin ReactExtension.kt:115-117 defaults
 *  hermesFlags to ["-O", "-output-source-map"]), so the gate counts the bytecode a phone actually receives. */
function exportArgs(outDir) {
  return ['expo', 'export', '--platform', 'android', '--source-maps', '--output-dir', outDir];
}

/** Is this exported file counted? The Hermes/JS bundle only; a source map (`.map`, e.g. `entry-….hbc.map`) never is. */
function isCounted(fileName) {
  if (/\.map$/i.test(fileName)) return false;
  return /\.(hbc|js|bundle)$/.test(fileName);
}

/** Sum the sizes of the counted files. `files` is [{ name, size }] (name = base name). */
function sumCounted(files) {
  let total = 0;
  for (const f of files) if (isCounted(f.name)) total += f.size;
  return total;
}

/** The budget from an env value (blank/absent → the default). */
function budgetKb(envValue) {
  return Number(envValue || DEFAULT_BUDGET_KB);
}

/** The verdict: KB rounded (1,024 B), whether anything was found, and whether it is over budget. */
function verdict(totalBytes, budget) {
  const kb = Math.round(totalBytes / 1024);
  return { kb, empty: kb === 0, over: kb > budget, overBy: Math.max(0, kb - budget) };
}

module.exports = { APP_DIR, DEFAULT_BUDGET_KB, exportArgs, isCounted, sumCounted, budgetKb, verdict };
