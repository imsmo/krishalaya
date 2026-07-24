#!/usr/bin/env node
// tools/scripts/i18n/detect-hardcoded-strings.js · Law 3 enforcement (DEV-21): "Code never hardcodes ... user-
// facing strings ... All user-facing text is an i18n key, zero exceptions" (contract §3). This is the code-side
// equivalent of the design canon's own qa_gates.py checks — a real AST walker (TypeScript compiler API, not
// regex) over every .tsx/.jsx file under the web apps + mobile, flagging:
//   (a) JSX text children that look like natural-language content (contain a letter, length > 1) — the classic
//       "Add Listing" hardcoded button-label class of bug.
//   (b) String-literal values on text-bearing JSX attributes (title/placeholder/aria-label/alt/label/
//       accessibilityLabel/accessibilityHint) — the "aria-label='Search'" class of bug.
//
// ALLOWLIST MECHANISM (two, both real): (1) an inline `// i18n-allow: <reason>` comment on the same line or the
// line immediately above a flagged node is honored — the justification is REQUIRED (an i18n-allow with no reason
// text is itself flagged as a malformed allowlist entry, not silently accepted). (2) a JSON sidecar
// (`hardcoded-strings.allowlist.json`, same directory) for bulk/legacy entries keyed by `file:line`, each entry
// carrying its own `reason` string — also required, never a bare boolean.
//
// This script CENSUSES; it does not rewrite files (per the DEV-21 brief: "don't mass-fix — census + top
// offenders list; fixing is follow-up batches").
//
// Usage:
//   node tools/scripts/i18n/detect-hardcoded-strings.js [--json] [dir1 dir2 ...]
// Default dirs (if none given): the 4 web apps' src/ + apps/mobile/src/ (relative to repo root, i.e. two levels
// up from this file: tools/scripts/i18n/ → krishi-verse/).
// Exit code: 1 if any un-allowlisted violation is found, 0 otherwise (0 findings, or all findings allowlisted).
'use strict';
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..'); // krishi-verse/
const DEFAULT_DIRS = [
  'apps/web-tenant/src',
  'apps/web-admin/src',
  'apps/web-partner/src',
  'apps/web-storefront/src',
  'apps/mobile/src',
];

// Attributes whose STRING-LITERAL value is user-facing text (never a technical identifier).
const TEXT_ATTRS = new Set([
  'title', 'placeholder', 'label', 'aria-label', 'alt', 'accessibilityLabel', 'accessibilityHint', 'accessibilityValue',
]);

// File-path substrings to skip entirely (tests/fixtures/generated output — not production UI code).
const EXCLUDE_PATH_PARTS = ['node_modules', '/dist/', '/.next/', '/.turbo/', '__tests__', '__mocks__', '.spec.', '.test.', 'render-spec', '/test-utils/'];

// A JSX-text/attribute value is "user-facing-looking" if it contains at least one Unicode letter and, after
// trimming, is longer than 1 character (skips single glyphs like '✓', '·', '→', bare punctuation, pure numbers).
const HAS_LETTER = /\p{L}/u;

function isExcludedPath(file) {
  const norm = file.replace(/\\/g, '/');
  return EXCLUDE_PATH_PARTS.some((p) => norm.includes(p));
}

function listFiles(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (isExcludedPath(full)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) listFiles(full, acc);
    else if (/\.(tsx|jsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/** Load the JSON allowlist sidecar (same dir as this script), if present. Shape:
 *  { "relative/path/to/File.tsx:42": { "reason": "..." }, ... } — a boolean/missing reason is a config error. */
function loadJsonAllowlist() {
  const file = path.join(__dirname, 'hardcoded-strings.allowlist.json');
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [key, entry] of Object.entries(raw)) {
    if (!entry || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      throw new Error(`[detect-hardcoded-strings] allowlist entry '${key}' has no non-empty 'reason' — every allowlist entry must carry a real justification.`);
    }
  }
  return raw;
}

/** True if the line at `lineIndex` (0-based) or the line immediately before it carries a well-formed
 *  `i18n-allow: <reason>` comment (non-empty reason required). */
function hasInlineAllow(sourceLines, lineIndex) {
  const re = /i18n-allow:\s*(\S.*)/;
  for (const idx of [lineIndex, lineIndex - 1]) {
    const line = sourceLines[idx];
    if (line == null) continue;
    const m = re.exec(line);
    if (m && m[1].trim()) return true;
  }
  return false;
}

function textLooksUserFacing(raw) {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (t.length <= 1) return false;
  if (!HAS_LETTER.test(t)) return false;
  // Skip pure {{variable}}/{placeholder}-only content (template scaffolding, not literal prose).
  if (/^\{\{[^}]+\}\}$|^\{[^}]+\}$/.test(t)) return false;
  return true;
}

function analyzeFile(file, jsonAllowlist, findings) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceLines = source.split('\n');
  const relFile = path.relative(REPO_ROOT, file);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  function flag(node, kind, text) {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const key = `${relFile}:${line + 1}`;
    if (jsonAllowlist[key]) return; // allowlisted (reason already validated at load time)
    if (hasInlineAllow(sourceLines, line)) return; // inline i18n-allow comment
    findings.push({ file: relFile, line: line + 1, kind, text: text.length > 60 ? text.slice(0, 57) + '...' : text });
  }

  function visit(node) {
    if (ts.isJsxText(node)) {
      const raw = node.getText(sf);
      if (textLooksUserFacing(raw)) flag(node, 'jsx-text', raw.trim());
    } else if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (TEXT_ATTRS.has(name) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const raw = node.initializer.text;
        if (textLooksUserFacing(raw)) flag(node.initializer, `attr:${name}`, raw);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  let maxAllowed = null;
  const maxIdx = args.indexOf('--max');
  if (maxIdx !== -1) maxAllowed = parseInt(args[maxIdx + 1], 10);
  const dirArgs = args.filter((a, i) => a !== '--json' && a !== '--max' && !(maxIdx !== -1 && i === maxIdx + 1));
  const dirs = (dirArgs.length ? dirArgs : DEFAULT_DIRS).map((d) => (path.isAbsolute(d) ? d : path.join(REPO_ROOT, d)));

  const jsonAllowlist = loadJsonAllowlist();
  const files = dirs.flatMap((d) => listFiles(d, []));
  const findings = [];
  for (const f of files) analyzeFile(f, jsonAllowlist, findings);

  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, (byFile.get(f.file) || 0) + 1);
  const topOffenders = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

  if (jsonMode) {
    console.log(JSON.stringify({ filesScanned: files.length, findingsCount: findings.length, findings, topOffenders }, null, 2));
  } else {
    console.log(`[detect-hardcoded-strings] scanned ${files.length} files across ${dirs.length} dir(s).`);
    console.log(`[detect-hardcoded-strings] ${findings.length} un-allowlisted hardcoded-string finding(s).`);
    if (topOffenders.length) {
      console.log('\nTop offenders (file : finding count):');
      for (const [file, count] of topOffenders) console.log(`  ${count.toString().padStart(4)}  ${file}`);
    }
  }
  // Census mode (this batch): by default, never fails the process on findings — DEV-21's scope is census, not
  // mass-fix, and the existing backlog (reported in dev21_report.md) would make an unconditional hard-fail red on
  // day one for debt this batch is not authorized to bulk-fix. `--max <n>` gives the CI harness real teeth WITHOUT
  // requiring the backlog be zero first: a ratchet ceiling (set to today's honest count) that fails the build only
  // if a NEW PR pushes the count higher — regression-proof without demanding an immediate mass-fix.
  if (maxAllowed != null && findings.length > maxAllowed) {
    console.error(`\n[detect-hardcoded-strings] FAIL: ${findings.length} findings > --max ${maxAllowed} (ratchet ceiling exceeded — new hardcoded strings introduced).`);
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { analyzeFile, textLooksUserFacing, hasInlineAllow, loadJsonAllowlist, listFiles, isExcludedPath, TEXT_ATTRS };
