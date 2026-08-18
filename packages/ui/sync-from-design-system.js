#!/usr/bin/env node
// packages/ui/sync-from-design-system.js · DEV-58 (Phase D-UI-Port, batch 1, 2026-08-14).
//
// WHAT THIS DOES (extends `packages/tokens/sync-from-design-system.js`'s generated-artifact
// pattern to `packages/ui`'s component CSS — the architecture decision recommended by
// `Development_Program/UI_PORT_PROGRAM.md` §2.1(d)): reads the canon CSS files
//   ../../../Phase-1 all screen design/Krishalaya_Design_System/system/web/web-components.css
//   ../../../Phase-1 all screen design/Krishalaya_Design_System/system/web/web-frame.css
// parses every top-level CSS rule in each (see `lib/canonCssParser.js`), and regenerates
// `src/generated/canonCss.ts` — a GENERATED, NEVER-HAND-EDITED TypeScript module exporting the
// full canon rule map (selector -> normalized body/bodies) plus a content hash of each source
// file. Same header-banner discipline as `packages/tokens`'s generator: "GENERATED ... DO NOT
// HAND-EDIT ... Regenerate: node sync-from-design-system.js".
//
// WHAT IT DOES NOT DO THIS BATCH (see spec_dev58.md §"generated vs hand-written" for the
// reasoning): it does NOT rewire the 26 existing components (`src/components/*.tsx`) to IMPORT
// this generated map instead of hand-typing their own `xStyles` CSS-in-JS string constant. That
// swap is real, useful follow-on work — but it touches 26 files' actual runtime CSS source and
// therefore carries real regression risk to the 124 existing tests and every consuming app's
// rendered output. This batch is sized S and its job is to make canon-fidelity CHECKABLE BY A
// COMMAND (Law 4), not to re-plumb the package. The swap is named as residue for the next
// `packages/ui`-internal batch (see spec_dev58.md).
//
// USAGE:
//   node sync-from-design-system.js          — regenerate src/generated/canonCss.ts
//   node sync-from-design-system.js --check  — regenerate IN MEMORY, diff against what's
//                                               committed on disk, exit 1 + print a diff summary
//                                               if they differ (drift detection — CI-runnable,
//                                               the mechanism that makes Law 4 enforceable: if
//                                               canon changes and nobody re-runs this script,
//                                               this command fails).
//
// FAILURE BEHAVIOUR IF CANON IS MISSING/MOVED (mirrors packages/tokens's own precedent — that
// generator's `loadExport()` lets `fs.readFileSync` throw its native ENOENT rather than
// swallowing it): this script does the same — if either canon CSS file is not at the expected
// path, `fs.readFileSync` throws ENOENT with the exact missing path in the message, the process
// exits non-zero, and NOTHING is written (no partial/corrupt canonCss.ts). Never silently emits
// an empty or stale map.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseRules, rulesToMap } = require('./lib/canonCssParser');

// KV_UI_CANON_DIR override exists SOLELY so the drift-check's negative test (spec_dev58.md /
// dev58_report.md) can point this generator at a disposable SCRATCH COPY of the canon directory
// instead of ever mutating the real, read-only design canon (contract §2: "the design canon...
// never edited by a Dev Program agent"). Unset (the default, every normal run) resolves to the
// real path exactly as before.
const CANON_DIR = process.env.KV_UI_CANON_DIR || path.join(
  __dirname, '..', '..', '..',
  'Phase-1 all screen design', 'Krishalaya_Design_System', 'system', 'web'
);
const CANON_FILES = {
  webComponents: path.join(CANON_DIR, 'web-components.css'),
  webFrame: path.join(CANON_DIR, 'web-frame.css'),
};

const OUT_PATH = path.join(__dirname, 'src', 'generated', 'canonCss.ts');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function loadCanon() {
  // Let fs.readFileSync throw its native ENOENT (with the exact missing path) if canon has
  // moved or been deleted — no try/catch swallow, no fallback path, no partial write. This
  // mirrors packages/tokens/sync-from-design-system.js's own loadExport() precedent exactly.
  const sources = {};
  for (const [key, filePath] of Object.entries(CANON_FILES)) {
    sources[key] = fs.readFileSync(filePath, 'utf8');
  }
  return sources;
}

/** Merges rule maps from both canon files into one `selector -> body[]` map (order-stable:
 * web-frame.css rules first, then web-components.css, matching each file's own documented load
 * order in web-frame.css's header comment: "tokens.css -> web-tokens.css -> web-frame.css ->
 * web-components.css"). */
function buildCanonRuleMap(sources) {
  const frameRules = parseRules(sources.webFrame);
  const componentRules = parseRules(sources.webComponents);
  const merged = rulesToMap([...frameRules, ...componentRules]);
  // Convert Map<string, rule[]> -> plain object of selector -> body[] for JSON/TS serialization,
  // sorted by selector so the generated file's diff is stable/reviewable (not insertion-order
  // noise) — this DOES reorder the MAP's keys for output determinism, but never reorders or
  // rewrites any individual rule's own selector/body text, so it does not affect the
  // byte-fidelity comparison (verify-canon-fidelity.js looks rules up by selector, not by
  // position).
  const out = {};
  const selectors = Array.from(merged.keys()).sort();
  for (const sel of selectors) {
    out[sel] = merged.get(sel).map((r) => r.body);
  }
  return out;
}

function tsStringArray(arr) {
  return `[${arr.map((s) => JSON.stringify(s)).join(', ')}]`;
}

function renderModule(sources, ruleMap) {
  const hashes = {
    webComponents: sha256(sources.webComponents),
    webFrame: sha256(sources.webFrame),
  };
  const ruleCount = Object.keys(ruleMap).length;

  let out = `// @krishalaya/ui/generated/canonCss · GENERATED from the design canon — DO NOT HAND-EDIT.
// Regenerate: node ../../sync-from-design-system.js (from packages/ui/), or
// "pnpm --filter @krishalaya/ui sync" (see package.json). Source:
//   Phase-1 all screen design/Krishalaya_Design_System/system/web/web-components.css
//   Phase-1 all screen design/Krishalaya_Design_System/system/web/web-frame.css
// Batch DEV-58 (2026-08-14), extending packages/tokens/sync-from-design-system.js's
// generated-artifact pattern (HAND-1) to component CSS per Development_Program/
// UI_PORT_PROGRAM.md §2.1(d). This file is the mechanical drift-detector: re-run the generator
// script with --check and diff the output against what is committed here — any difference means
// either canon changed and nobody regenerated (the drift this file exists to catch), or someone
// hand-edited this file directly (also a violation — fix by regenerating, never by hand).
//
// canonSourceHashes: sha256 of each canon source file AT GENERATION TIME. verify-canon-fidelity.js
// and the drift check both re-hash the LIVE canon file on every run and compare against these —
// this is what makes "canon changed, generated file stale" mechanically detectable rather than
// assumed. ${ruleCount} top-level CSS rules parsed across both canon files.
export const canonSourceHashes = ${JSON.stringify(hashes, null, 2)} as const;

/** selector (normalized) -> array of normalized declaration bodies, in canon file order. An
 * array because canon legitimately redefines a handful of selectors twice by design (later rule
 * wins the cascade) — e.g. \`.kvw-range-presets\` (web-components.css, HAND-2 widened it after
 * W-D1's original). A component's transcribed body is considered CANON-MATCHED if it equals ANY
 * entry for that selector. */
export const canonRules: Record<string, string[]> = {
`;
  const selectors = Object.keys(ruleMap);
  for (const sel of selectors) {
    out += `  ${JSON.stringify(sel)}: ${tsStringArray(ruleMap[sel])},\n`;
  }
  out += `};\n`;
  out += `\nexport const canonRuleCount = ${ruleCount};\n`;
  return out;
}

function main() {
  const checkMode = process.argv.includes('--check');
  const sources = loadCanon();
  const ruleMap = buildCanonRuleMap(sources);
  const rendered = renderModule(sources, ruleMap);

  if (checkMode) {
    let existing = null;
    try {
      existing = fs.readFileSync(OUT_PATH, 'utf8');
    } catch (e) {
      console.error(`DRIFT CHECK FAILED: ${OUT_PATH} does not exist yet. Run without --check first.`);
      process.exit(1);
    }
    if (existing === rendered) {
      console.log('DRIFT CHECK: PASS — src/generated/canonCss.ts matches the live canon exactly (regeneration is a no-op).');
      process.exit(0);
    } else {
      // A minimal, dependency-free line-diff summary (no external diff lib — §7 no-new-deps).
      const a = existing.split('\n');
      const b = rendered.split('\n');
      let firstDiff = -1;
      const max = Math.max(a.length, b.length);
      for (let i = 0; i < max; i++) {
        if (a[i] !== b[i]) { firstDiff = i; break; }
      }
      console.error('DRIFT CHECK: FAIL — committed src/generated/canonCss.ts does NOT match a fresh regeneration from canon.');
      console.error(`Committed file: ${a.length} lines. Fresh regeneration: ${b.length} lines.`);
      if (firstDiff >= 0) {
        console.error(`First differing line (0-indexed ${firstDiff}):`);
        console.error(`  committed: ${a[firstDiff] ?? '<EOF>'}`);
        console.error(`  fresh:     ${b[firstDiff] ?? '<EOF>'}`);
      }
      console.error('This means canon changed since the last regeneration and nobody re-ran this generator (or the file was hand-edited). Run: node sync-from-design-system.js');
      process.exit(1);
    }
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, rendered);
  console.log('Synced from', CANON_FILES.webComponents);
  console.log('Synced from', CANON_FILES.webFrame);
  console.log('Wrote', OUT_PATH, `(${Object.keys(ruleMap).length} rules)`);
}

main();
