#!/usr/bin/env node
// tools/scripts/ui-adoption-report.js · DEV-58 (Phase D-UI-Port, batch 1, 2026-08-14).
//
// PART 3 OF DEV-58: "make the adoption gap visible." `Development_Program/UI_PORT_PROGRAM.md`'s
// core finding is that `@krishalaya/ui` exists and (mostly) nobody uses it, and that every new
// batch that hand-writes another `kv-*`/`kvw-*` class string deepens the drift invisibly. This
// script is the ratchet: a cheap, repeatable, per-app count of (a) how many files actually
// import `@krishalaya/ui` and whether they render a real component or only consume a pure
// mechanism function, and (b) how many DISTINCT hand-written `kv-*`/`kvw-*` class-string
// literals still live in that app's own source. Run it before/after any future UI-port batch —
// the numbers must move the right direction (component imports up, hand-written literals down).
// Nothing here is a build/lint gate (no threshold is enforced, no exit-code failure) — this is a
// visibility instrument, not an enforcement mechanism (task's own words: "a ratchet, not a
// framework"), so it can run safely in CI as an informational step without blocking anything.
//
// USAGE: node tools/scripts/ui-adoption-report.js [--json]
//
// METHODOLOGY (grep-equivalent, pure Node fs — no new dependency, §7):
//   - Walks each apps/web-*/src tree (skips node_modules/.next/dist).
//   - "componentImportFiles": files whose `@krishalaya/ui` import list contains at least one
//     name NOT in MECHANISM_ONLY_EXPORTS (i.e. a real visual component/hook, not just a
//     theme/senior-mode/density resolver or KvUiGlobalStyles). Also separately reports
//     "mechanismOnlyImportFiles" for files that import ONLY those pure functions — this is the
//     exact split `UI_PORT_PROGRAM.md` §1.2 uses ("plumbing adopted, components not").
//     `@krishalaya/ui-native` imports are explicitly excluded (a different package — apps/mobile
//     only, not a web app).
//   - "handWrittenClassTokens": every DISTINCT `kv-[a-z]` or `kvw-[a-z]` class-name-shaped token
//     found inside a string/template-literal/className in the app's own `.tsx`/`.ts` files
//     (NOT counting occurrences inside `node_modules` or generated `dist` output). This is the
//     literal-class-string census the program's own §1.3 table reports (102/125/68/256 distinct
//     classes per app) — recomputed fresh here, not copied from that doc.
//   - "globalsCssLines": line count of the app's own `src/app/globals.css` (or equivalent), a
//     cheap proxy for "how much hand-rolled stylesheet this app still carries."

const fs = require('fs');
const path = require('path');

const APPS_DIR = path.join(__dirname, '..', '..', 'apps');

// The 4 apps UI_PORT_PROGRAM.md scopes this migration program to, plus 2 more real web apps
// found in the monorepo (web-gov, web-ops) that the program doc did not analyze — included here
// for completeness of the ratchet (a visibility script should not have a blind spot), flagged
// separately in the report so nobody mistakes "not in the program doc" for "doesn't exist."
const IN_PROGRAM_APPS = ['web-admin', 'web-tenant', 'web-partner', 'web-storefront'];
const BONUS_APPS = ['web-gov', 'web-ops'];

const MECHANISM_ONLY_EXPORTS = new Set([
  'parseThemePreference', 'resolveThemeHtmlAttrs', 'THEME_PREFERENCES',
  'isSeniorOn', 'seniorConsoleStyles', 'densityStyles',
  // type-only imports commonly paired with the above
  'ThemePreference', 'ThemeHtmlAttrs',
]);

function walk(dir, exts, skipDirs) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full, exts, skipDirs));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', '__tests__', 'test-render']);

/** Extracts the named-import list of an `@krishalaya/ui` (never `-native`) import statement. */
function extractKvUiImports(source) {
  const results = [];
  const re = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@krishalaya\/ui['"];?/g;
  let m;
  while ((m = re.exec(source))) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      // strip a per-name `type ` prefix (TS inline type-only import, e.g. `type ThemePreference`)
      // and any `as Alias` rename, so the bare exported name is what gets compared against
      // MECHANISM_ONLY_EXPORTS.
      .map((s) => s.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim());
    results.push(...names);
  }
  return results;
}

function analyzeApp(appName) {
  const appDir = path.join(APPS_DIR, appName);
  const srcDir = path.join(appDir, 'src');
  if (!fs.existsSync(srcDir)) {
    return { app: appName, present: false };
  }

  const tsxFiles = walk(srcDir, ['.tsx'], SKIP_DIRS);
  const tsFiles = walk(srcDir, ['.ts'], SKIP_DIRS);
  const allSourceFiles = [...tsxFiles, ...tsFiles];

  let componentImportFiles = 0;
  let mechanismOnlyImportFiles = 0;
  const componentImportNames = new Set();

  for (const file of allSourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('@krishalaya/ui')) continue;
    const names = extractKvUiImports(source);
    if (names.length === 0) continue; // matched the package string but not a named-import shape (e.g. a comment)
    const hasRealComponent = names.some((n) => !MECHANISM_ONLY_EXPORTS.has(n));
    if (hasRealComponent) {
      componentImportFiles++;
      names.filter((n) => !MECHANISM_ONLY_EXPORTS.has(n)).forEach((n) => componentImportNames.add(n));
    } else {
      mechanismOnlyImportFiles++;
    }
  }

  // Distinct hand-written kv-*/kvw-* class-shaped tokens across the app's OWN source (tsx + the
  // app's own globals.css/*.css). Token shape: kv- or kvw- followed by lowercase letters/digits/
  // hyphens, word-bounded — matches how these classes are actually written in this codebase
  // (grep-verified sample: "kv-shell", "kv-status-pending", "kvw-btn-primary").
  const cssFiles = walk(srcDir, ['.css'], SKIP_DIRS);
  const classTokenRe = /\bkvw?-[a-z][a-z0-9-]*/g;
  const distinctClasses = new Set();
  for (const file of [...allSourceFiles, ...cssFiles]) {
    const source = fs.readFileSync(file, 'utf8');
    const matches = source.match(classTokenRe);
    if (matches) matches.forEach((t) => distinctClasses.add(t));
  }

  const kvwOnly = [...distinctClasses].filter((c) => c.startsWith('kvw-'));
  const kvOnly = [...distinctClasses].filter((c) => c.startsWith('kv-') && !c.startsWith('kvw-'));

  // globals.css lives at src/styles/globals.css in all 4 program-scoped apps (grep-verified);
  // fall back to src/app/globals.css (the more common Next.js App Router default location) in
  // case a future app places it there instead — report null rather than guessing further.
  const globalsCssCandidates = [
    path.join(srcDir, 'styles', 'globals.css'),
    path.join(srcDir, 'app', 'globals.css'),
  ];
  let globalsCssLines = null;
  for (const candidate of globalsCssCandidates) {
    if (fs.existsSync(candidate)) {
      globalsCssLines = fs.readFileSync(candidate, 'utf8').split('\n').length;
      break;
    }
  }

  return {
    app: appName,
    present: true,
    tsxFileCount: tsxFiles.length,
    totalSourceFiles: allSourceFiles.length,
    kvUiImportFiles: { componentImportFiles, mechanismOnlyImportFiles },
    componentsActuallyImported: [...componentImportNames].sort(),
    distinctHandWrittenClasses: { total: distinctClasses.size, kvwPrefixed: kvwOnly.length, kvPrefixed: kvOnly.length },
    globalsCssLines,
  };
}

function main() {
  const asJson = process.argv.includes('--json');
  const results = [...IN_PROGRAM_APPS, ...BONUS_APPS].map(analyzeApp);

  if (asJson) {
    console.log(JSON.stringify({ generatedFrom: 'tools/scripts/ui-adoption-report.js', apps: results }, null, 2));
    return;
  }

  console.log('@krishalaya/ui ADOPTION BASELINE (per app) — DEV-58 ratchet');
  console.log('='.repeat(96));
  console.log('App'.padEnd(16), 'tsx'.padStart(5), 'ui-import(real)'.padStart(16), 'ui-import(mech-only)'.padStart(22), 'hand-written kv*/kvw* classes'.padStart(30), 'globals.css lines'.padStart(18));
  for (const r of results) {
    if (!r.present) { console.log(`${r.app.padEnd(16)}  <not found>`); continue; }
    console.log(
      r.app.padEnd(16),
      String(r.tsxFileCount).padStart(5),
      String(r.kvUiImportFiles.componentImportFiles).padStart(16),
      String(r.kvUiImportFiles.mechanismOnlyImportFiles).padStart(22),
      String(r.distinctHandWrittenClasses.total).padStart(30),
      String(r.globalsCssLines ?? '-').padStart(18)
    );
  }
  console.log('='.repeat(96));
  for (const r of results) {
    if (!r.present) continue;
    console.log(`${r.app}: components actually imported = [${r.componentsActuallyImported.join(', ') || 'none'}]; kvw-prefixed=${r.distinctHandWrittenClasses.kvwPrefixed}, kv-prefixed=${r.distinctHandWrittenClasses.kvPrefixed}`);
  }
  console.log('\nIn UI_PORT_PROGRAM.md scope: ' + IN_PROGRAM_APPS.join(', '));
  console.log('Bonus (real web apps, not yet analyzed by the program doc): ' + BONUS_APPS.join(', '));
  console.log('\nThis is a VISIBILITY ratchet, not a gate: no threshold, no exit-code failure. Re-run before/after');
  console.log('every future UI-port batch and compare — component-import counts should rise, hand-written');
  console.log('class-literal counts should fall, per app, over the life of the program.');
}

main();
