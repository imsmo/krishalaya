#!/usr/bin/env node
// tools/scripts/i18n/check-rtl-logical-properties.js · gate-10 automated form (DEV-21): "keyboard-focus-visible,
// aria-label on icon-only controls, and (for RTL-scope batches) the gate-32b-equivalent logical-CSS-property
// grep" (contract §5 gate 10). Grep-based (mirrors the design canon's own `qa_gates.py` style of check — a
// dedicated CSS parser is overkill for "does this line use a PHYSICAL left/right property where a LOGICAL
// inline-start/inline-end one exists"), scanning:
//   - every `.css` file under the 4 web apps (`apps/web-*/src/styles/*.css`)
//   - every `.ts`/`.tsx` file under `packages/ui/src` and `packages/ui-native/src` (CSS-in-JS template strings /
//     StyleSheet objects can still declare a physical property as a plain object key or string)
//
// FLAGGED (physical, should be logical): margin-left/-right, padding-left/-right, left:/right: (position
// offsets), border-left/-right (as a shorthand or *-color/-width/-style), text-align: left/right, float: left/right.
// NOT FLAGGED (documented residuals, per BRAND-017/APPLY-6's own RTL-implementation canon): `transform:
// scaleX(-1)` (icon-mirroring utility), any `translateX(...)` (switch-thumb/drawer offset — direction-neutral by
// itself, the mirroring is handled by the enclosing `[dir="rtl"]` rule flipping the SIGN, not the property name),
// and `border-*-left-radius`/`border-*-right-radius` (corner-radius naming has no logical equivalent adopted by
// this codebase yet — a real, disclosed residual, not silently ignored: reported as informational, not a
// violation, since BRAND-017's own canon explicitly names this class of residual).
//
// SCOPE BOUNDARY (deliberate, stated up front): this script targets **web CSS** (contract gate 10's own wording:
// "RTL/logical-CSS-property grep") — the 4 web apps' `styles/*.css` + `packages/ui/src` (the web design-system
// port, which still emits real CSS/CSS-in-JS). `packages/ui-native` (React Native) is OUT OF SCOPE here: RN has
// no "logical CSS property" concept to grep for — its absolute-position `left`/`right`/`top`/`bottom` values are a
// DIFFERENT, direction-aware-offset problem (RN's `I18nManager.forceRTL` mirrors flex layout automatically but
// NOT literal position offsets), already partially handled by `apps/mobile/src/core/mechanisms/rtl.ts`'s own
// mechanism — a real, disclosed gap for a future RN-specific script, not silently folded into this one's exit code.
//
// ALLOWLIST: an inline `/* rtl-allow: <reason> */` (CSS) or `// rtl-allow: <reason>` (TS) comment on the same
// line suppresses a finding, reason required (same discipline as detect-hardcoded-strings.js's i18n-allow).
//
// Usage: node tools/scripts/i18n/check-rtl-logical-properties.js [--json]
// Exit code: 1 if any un-allowlisted PHYSICAL property is found, 0 otherwise. This one DOES gate (unlike the
// hardcoded-string census) — RTL logical-property discipline is a narrower, already-largely-clean surface
// (APPLY-6/BRAND-017 already converted the shipped canon + DEV-19 converted the 4 web apps' own globals.css), so
// zero-tolerance is achievable and worth enforcing immediately, not deferred to a follow-up batch.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_TARGETS = [
  'apps/web-tenant/src/styles',
  'apps/web-admin/src/styles',
  'apps/web-partner/src/styles',
  'apps/web-storefront/src/styles',
  'packages/ui/src',
];

const PHYSICAL_PATTERNS = [
  { name: 'margin-left', re: /(^|[^-\w])margin-left\s*:/ },
  { name: 'margin-right', re: /(^|[^-\w])margin-right\s*:/ },
  { name: 'padding-left', re: /(^|[^-\w])padding-left\s*:/ },
  { name: 'padding-right', re: /(^|[^-\w])padding-right\s*:/ },
  { name: 'left-offset', re: /(^|[^-\w])left\s*:\s*[-\d.]/ },      // `left: 8px` etc. — position offset
  { name: 'right-offset', re: /(^|[^-\w])right\s*:\s*[-\d.]/ },
  { name: 'border-left', re: /(^|[^-\w])border-left(?!-\w*radius)/ },
  { name: 'border-right', re: /(^|[^-\w])border-right(?!-\w*radius)/ },
  { name: 'text-align-left', re: /text-align\s*:\s*left/ },
  { name: 'text-align-right', re: /text-align\s*:\s*right/ },
  { name: 'float-left', re: /float\s*:\s*left/ },
  { name: 'float-right', re: /float\s*:\s*right/ },
];

// Residuals this codebase's own RTL canon (BRAND-017) already names and accepts — informational only, never a
// violation. Checked FIRST so a line matching both a physical pattern AND a residual pattern is not double-flagged.
const RESIDUAL_PATTERNS = [/scaleX\s*\(/, /translateX\s*\(/, /border-\w*-left-radius/, /border-\w*-right-radius/];

function isResidual(line) {
  return RESIDUAL_PATTERNS.some((re) => re.test(line));
}

function hasAllowComment(line) {
  const m = /rtl-allow:\s*([^\n]*)/.exec(line);
  if (!m) return false;
  // Strip a trailing CSS/JS comment-closer ('*/') or line-comment artifacts before judging non-emptiness, so
  // `/* rtl-allow: */` (no real reason) is correctly rejected rather than matching on the closer's own '*'.
  const reason = m[1].replace(/\*\/\s*$/, '').trim();
  return reason.length > 0;
}

function listFiles(dir, exts, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (full.includes('node_modules') || full.includes('/dist/') || full.includes('/.next/') || full.includes('/.turbo/')) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) listFiles(full, exts, acc);
    else if (exts.some((e) => entry.endsWith(e))) acc.push(full);
  }
  return acc;
}

function scanFile(file, findings) {
  const relFile = path.relative(REPO_ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    if (isResidual(line)) return;
    if (hasAllowComment(line)) return;
    for (const { name, re } of PHYSICAL_PATTERNS) {
      if (re.test(line)) {
        findings.push({ file: relFile, line: idx + 1, property: name, text: line.trim().slice(0, 100) });
      }
    }
  });
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const dirArgs = args.filter((a) => a !== '--json');
  const dirs = (dirArgs.length ? dirArgs : DEFAULT_TARGETS).map((d) => (path.isAbsolute(d) ? d : path.join(REPO_ROOT, d)));

  const files = dirs.flatMap((d) => [...listFiles(d, ['.css'], []), ...listFiles(d, ['.ts', '.tsx'], [])]);
  const findings = [];
  for (const f of files) scanFile(f, findings);

  if (jsonMode) {
    console.log(JSON.stringify({ filesScanned: files.length, findingsCount: findings.length, findings }, null, 2));
  } else {
    console.log(`[check-rtl-logical-properties] scanned ${files.length} file(s).`);
    console.log(`[check-rtl-logical-properties] ${findings.length} physical-property finding(s) (should be logical).`);
    for (const f of findings) console.log(`  ${f.file}:${f.line}  [${f.property}]  ${f.text}`);
  }
  process.exit(findings.length ? 1 : 0);
}

if (require.main === module) main();

module.exports = { scanFile, isResidual, hasAllowComment, listFiles, PHYSICAL_PATTERNS, RESIDUAL_PATTERNS };
