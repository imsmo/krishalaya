#!/usr/bin/env node
// packages/ui/verify-canon-fidelity.js · DEV-58 (Phase D-UI-Port, batch 1, 2026-08-14).
//
// THE BYTE-FIDELITY PROOF (task's own words): "the whole point is that the package's CSS IS
// canon's CSS." This script proves it mechanically, not by memory/header-comment citation:
//
//   1. Parses the LIVE canon (web-components.css + web-frame.css) into a selector -> body[] map
//      using the exact same parser `sync-from-design-system.js` uses (`lib/canonCssParser.js`)
//      — always against LIVE canon on disk, never against the possibly-stale committed
//      `src/generated/canonCss.ts`, so this check is a true independent proof, not a check
//      against itself.
//   2. For each of the 26 components' `src/components/*.tsx` files, extracts the exported
//      `export const xStyles = \`...\`;` CSS-in-JS string (regex on the source file — no import/
//      require of the .tsx needed, so this runs in plain Node with no JSX/TS transform).
//   3. Parses that string with the SAME parser, and for every rule it contains, looks up its
//      selector in the canon map. Three outcomes per rule:
//        MATCH          — canon defines this selector and at least one of its bodies equals the
//                          component's body BYTE-FOR-BYTE after the one documented whitespace
//                          transform (see lib/canonCssParser.js's normalizeCss).
//        MISMATCH       — canon defines this selector, but NONE of its recorded bodies equal the
//                          component's body. This is the real defect this check exists to catch:
//                          a hand-transcription that silently drifted from canon.
//        CANON-MISSING  — canon does not define this selector at all (e.g. a component-local
//                          modifier class, or a genuine undeclared deviation). Reported, not
//                          auto-failed — see the per-rule report for the exact list, so a human
//                          decides whether it's a known intentional addition or an undisclosed
//                          drift (Law 4: any deviation needs a filed DELTA, not a silent pass).
//
// EXIT CODE: non-zero if MISMATCH count > 0 for ANY component (byte fidelity broken). CANON-
// MISSING entries are printed but do not fail the run — they are the "modulo documented,
// justified transform" carve-out the task's own brief allows, and this batch's report lists
// every one by name rather than hiding the count inside a single pass/fail bit.
//
// USAGE: node verify-canon-fidelity.js [--json]

const fs = require('fs');
const path = require('path');
const { parseRules, rulesToMap, normalizeCss } = require('./lib/canonCssParser');

const CANON_DIR = path.join(
  __dirname, '..', '..', '..',
  'Phase-1 all screen design', 'Krishalaya_Design_System', 'system', 'web'
);
const CANON_FILES = {
  webComponents: path.join(CANON_DIR, 'web-components.css'),
  webFrame: path.join(CANON_DIR, 'web-frame.css'),
};

const COMPONENTS_DIR = path.join(__dirname, 'src', 'components');

// The 26 components ported so far (matches GlobalStyles.tsx's `allComponentStyles` array,
// which is this program's own list of record for "what packages/ui ships today" — grep-verified
// against src/GlobalStyles.tsx before writing this list). Each maps its .tsx file to the
// exported style-constant name.
const COMPONENT_STYLE_EXPORTS = {
  'Button.tsx': 'buttonStyles',
  'Input.tsx': 'inputStyles',
  'StatusPill.tsx': 'statusPillStyles',
  'AiBadge.tsx': 'aiBadgeStyles',
  'MoneyText.tsx': 'moneyTextStyles',
  'DataTable.tsx': 'dataTableStyles',
  'EmptyState.tsx': 'emptyStateStyles',
  'KpiCard.tsx': 'kpiCardStyles',
  'Callout.tsx': 'calloutStyles',
  'Chip.tsx': 'chipStyles',
  'Skeleton.tsx': 'skeletonStyles',
  'AppShell.tsx': 'appShellStyles',
  'Sidebar.tsx': 'sidebarStyles',
  'Topbar.tsx': 'topbarStyles',
  'Breadcrumbs.tsx': 'breadcrumbsStyles',
  'PageHeader.tsx': 'pageHeaderStyles',
  'Tabs.tsx': 'tabsStyles',
  'Drawer.tsx': 'drawerStyles',
  'TreeView.tsx': 'treeViewStyles',
  'DateRangePicker.tsx': 'dateRangePickerStyles',
  'Modal.tsx': 'modalStyles',
  'Toast.tsx': 'toastStyles',
  'DiffViewer.tsx': 'diffViewerStyles',
  'Wizard.tsx': 'wizardStyles',
  'FileUpload.tsx': 'fileUploadStyles',
  'Toolbar.tsx': 'toolbarStyles',
};

function loadCanonRuleMap() {
  const webComponents = fs.readFileSync(CANON_FILES.webComponents, 'utf8');
  const webFrame = fs.readFileSync(CANON_FILES.webFrame, 'utf8');
  const rules = [...parseRules(webFrame), ...parseRules(webComponents)];
  return rulesToMap(expandSelectorGroups(rules));
}

/** SECOND documented, tested transform (in addition to whitespace normalization —
 * see lib/canonCssParser.js): a comma-separated canon selector group (e.g.
 * ".kvw-btn[disabled], .kvw-btn.is-pending { opacity: 0.55; ... }") is semantically IDENTICAL,
 * per the CSS spec, to two separate rules sharing the same declaration body. Components that
 * hand-transcribed such a rule as two separate rules (found this batch: Button.tsx splits the
 * above exactly this way) are NOT a fidelity violation — they render pixel-identically. This
 * function indexes each individual selector inside a top-level comma group against the SAME
 * body, in addition to the group's own combined key, so either transcription style is
 * recognized as canon-true. (Verified safe against both canon files: no selector anywhere here
 * uses a comma INSIDE a pseudo-class argument — e.g. no `:not(a, b)` — so a plain top-level
 * split on "," never mis-parses a compound selector.) */
function expandSelectorGroups(rules) {
  const expanded = [];
  for (const rule of rules) {
    expanded.push(rule);
    if (rule.selector.includes(',') && !rule.selector.startsWith('@')) {
      const parts = rule.rawSelector.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        for (const part of parts) {
          expanded.push({ ...rule, selector: require('./lib/canonCssParser').normalizeCss(part), rawSelector: part });
        }
      }
    }
  }
  return expanded;
}

/** Extracts `export const <exportName> = \`...\`;` from a .tsx source file's raw text. Returns
 * the raw template-literal CONTENTS (between the backticks), or null if not found. */
function extractStyleString(source, exportName) {
  const re = new RegExp(
    `export const ${exportName}\\s*=\\s*\`([\\s\\S]*?)\`;`
  );
  const m = re.exec(source);
  return m ? m[1] : null;
}

function main() {
  const asJson = process.argv.includes('--json');
  const canonMap = loadCanonRuleMap();

  const report = {
    components: {},
    totals: { rulesChecked: 0, matched: 0, mismatched: 0, canonMissing: 0 },
  };

  const mismatchDetails = [];

  for (const [file, exportName] of Object.entries(COMPONENT_STYLE_EXPORTS)) {
    const filePath = path.join(COMPONENTS_DIR, file);
    const source = fs.readFileSync(filePath, 'utf8');
    const styleString = extractStyleString(source, exportName);
    if (styleString === null) {
      throw new Error(`Could not find "export const ${exportName} = \`...\`;" in ${filePath}`);
    }
    const rules = parseRules(styleString);
    const compReport = { rulesChecked: rules.length, matched: 0, mismatched: 0, canonMissing: 0, mismatches: [], canonMissingSelectors: [] };

    for (const rule of rules) {
      // THIRD documented transform, specific to @-rules (@media/@keyframes/@supports): canon
      // groups ALL rules for a breakpoint into ONE block (e.g. one `@media (max-width: 1024px)`
      // covering shell+sidebar+grid together), but several components each embed only the
      // slice of that block relevant to themselves (AppShell/Sidebar/PageHeader all found this
      // batch). Comparing the whole block verbatim would falsely flag every such component as
      // a MISMATCH even though every inner declaration it carries is byte-identical to canon.
      // So for an @-rule, fidelity is SUBSET containment of inner rules (by selector+body),
      // not whole-block equality — genuinely differing inner CSS still fails.
      if (rule.selector.startsWith('@')) {
        const canonAtRules = canonMap.get(rule.selector);
        if (!canonAtRules) {
          compReport.canonMissing++;
          compReport.canonMissingSelectors.push(rule.selector);
          continue;
        }
        const canonInner = rulesToMap(
          canonAtRules.flatMap((entry) => parseRules(entry.rawBody))
        );
        const compInner = parseRules(rule.rawBody);
        const innerMismatches = [];
        for (const inner of compInner) {
          const bodies = canonInner.get(inner.selector);
          const ok = bodies && bodies.some((b) => b.body === inner.body);
          if (!ok) innerMismatches.push(inner.selector);
        }
        if (innerMismatches.length === 0) {
          compReport.matched++;
        } else {
          compReport.mismatched++;
          compReport.mismatches.push({
            selector: rule.selector,
            componentBody: `(inner rules not found byte-identical in canon's same @-rule: ${innerMismatches.join(', ')})`,
            canonBodies: [],
          });
          mismatchDetails.push({ file, selector: rule.selector });
        }
        continue;
      }

      const canonBodies = canonMap.get(rule.selector);
      if (!canonBodies) {
        compReport.canonMissing++;
        compReport.canonMissingSelectors.push(rule.selector);
        continue;
      }
      const isMatch = canonBodies.some((canonRule) => canonRule.body === rule.body);
      if (isMatch) {
        compReport.matched++;
      } else {
        compReport.mismatched++;
        compReport.mismatches.push({
          selector: rule.selector,
          componentBody: rule.body,
          canonBodies: canonBodies.map((r) => r.body),
        });
        mismatchDetails.push({ file, selector: rule.selector });
      }
    }

    report.components[file] = compReport;
    report.totals.rulesChecked += compReport.rulesChecked;
    report.totals.matched += compReport.matched;
    report.totals.mismatched += compReport.mismatched;
    report.totals.canonMissing += compReport.canonMissing;
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('CANON BYTE-FIDELITY REPORT (packages/ui vs live design canon)');
    console.log('='.repeat(70));
    for (const [file, r] of Object.entries(report.components)) {
      const flag = r.mismatched > 0 ? '  <-- MISMATCH' : '';
      console.log(`${file.padEnd(24)} rules=${String(r.rulesChecked).padStart(3)}  matched=${String(r.matched).padStart(3)}  canon-missing=${String(r.canonMissing).padStart(2)}  mismatched=${String(r.mismatched).padStart(2)}${flag}`);
      if (r.canonMissingSelectors.length) {
        console.log(`  canon-missing selectors: ${r.canonMissingSelectors.join(', ')}`);
      }
      for (const mm of r.mismatches) {
        console.log(`  MISMATCH ${mm.selector}`);
        console.log(`    component: ${mm.componentBody}`);
        console.log(`    canon:     ${mm.canonBodies.join(' || ')}`);
      }
    }
    console.log('='.repeat(70));
    console.log(`TOTAL: ${report.totals.rulesChecked} rules checked across ${Object.keys(COMPONENT_STYLE_EXPORTS).length} components — ${report.totals.matched} MATCHED, ${report.totals.canonMissing} CANON-MISSING (reported, not failed), ${report.totals.mismatched} MISMATCHED.`);
  }

  process.exit(report.totals.mismatched > 0 ? 1 : 0);
}

main();
