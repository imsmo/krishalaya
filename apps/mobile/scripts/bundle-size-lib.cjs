// apps/mobile/scripts/bundle-size-lib.cjs · PC-56 BUNDLE-1a · the PURE half of the bundle-size gate (check-bundle-size.mjs),
// split out so jest can pin it with no export, no network: which export command runs (and from where), which files are
// summed, and the budget verdict. CommonJS so both the .mjs gate and the ts-jest "core" project can load it unchanged.
'use strict';
const path = require('node:path');

/** The mobile app dir, resolved from THIS file's location — never process.cwd() (CI runs the gate from the repo root,
 *  where `expo export` treats the root as the project and fails with "Unable to resolve module ../../App"). */
const APP_DIR = path.resolve(__dirname, '..');

/** Default budget, KB (1 KB = 1,024 B). MOBILE_BUNDLE_BUDGET_KB overrides.
 *  6,000 KB (founder, BUNDLE-1) → 6,500 KB (PC-56 MOB-SDK-1, lead as product owner): Expo SDK 51 → 58 (required for Google
 *  Play's API 36 target) grew the Hermes bundle 4,395 → 6,261 KB with NO new app code — the Hermes V1 compiler emits ~42%
 *  more bytecode for ~15% more source, and Expo Router 58 bundles its own React Navigation. 6,500 keeps ~4% headroom so the
 *  gate still catches real growth; it is a ceiling to lower again, not a target. */
// → 8,000 KB (PC-56 MOB-STORE-1, lead as product owner): crash reporting (@sentry/react-native) adds 1,468 KB of bytecode
//   and cannot be meaningfully trimmed (its sdk entry pulls feedback/replay/tracing). A production app used by millions must
//   not run blind to crashes; everything else in that wave added 23 KB. Measured 7,752 KB → ~3% headroom: still a gate.
const DEFAULT_BUDGET_KB = 8000;

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
