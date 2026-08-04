// tools/scripts/i18n/__tests__/detect-hardcoded-strings.test.js · DEV-21. Proves the Law-3 detector actually
// catches a planted hardcoded string (not just "compiles without throwing") and correctly respects both allowlist
// mechanisms (inline `i18n-allow` comment, JSON sidecar). Run: node --test tools/scripts/i18n/__tests__/detect-hardcoded-strings.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeFile, textLooksUserFacing, hasInlineAllow } = require('../detect-hardcoded-strings');

function writeFixture(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-detect-strings-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

test('textLooksUserFacing: rejects single glyphs, numbers, and template-only placeholders; accepts real prose', () => {
  assert.equal(textLooksUserFacing('✓'), false);
  assert.equal(textLooksUserFacing('·'), false);
  assert.equal(textLooksUserFacing('42'), false);
  assert.equal(textLooksUserFacing('{{amount}}'), false);
  assert.equal(textLooksUserFacing('{count}'), false);
  assert.equal(textLooksUserFacing('Add Listing'), true);
  assert.equal(textLooksUserFacing('   Search   '), true); // trims to 'Search', len 6
});

test('hasInlineAllow: requires a non-empty reason, checks same line and the line above', () => {
  const lines = ['const x = 1; // i18n-allow: brand name, never translated', 'const y = 2;', '// i18n-allow:', 'const z = 3;'];
  assert.equal(hasInlineAllow(lines, 0), true);
  assert.equal(hasInlineAllow(lines, 1), true); // line above (index 0) carries the comment
  assert.equal(hasInlineAllow(lines, 3), false); // line 2's i18n-allow has NO reason text — not honored
});

test('catches a planted hardcoded JSX text literal', () => {
  const file = writeFixture('Planted.tsx', `
export function Planted() {
  return <button>Add Listing</button>;
}
`);
  const findings = [];
  analyzeFile(file, {}, findings);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'jsx-text');
  assert.equal(findings[0].text, 'Add Listing');
});

test('catches a planted hardcoded text-bearing attribute (aria-label)', () => {
  const file = writeFixture('PlantedAttr.tsx', `
export function PlantedAttr() {
  return <button aria-label="Close dialog" />;
}
`);
  const findings = [];
  analyzeFile(file, {}, findings);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, 'attr:aria-label');
});

test('does NOT flag a real i18n call (t(...)) or a technical attribute (testID/className)', () => {
  const file = writeFixture('Clean.tsx', `
export function Clean({ t }: { t: (k: string) => string }) {
  return <button testID="submit-btn" className="kv-btn">{t('common.submit')}</button>;
}
`);
  const findings = [];
  analyzeFile(file, {}, findings);
  assert.equal(findings.length, 0);
});

test('respects the inline i18n-allow comment allowlist (with a real reason)', () => {
  const file = writeFixture('Allowed.tsx', `
export function Allowed() {
  return <button>Krishalaya</button>; // i18n-allow: brand name, TS-003 never-translate glossary
}
`);
  const findings = [];
  analyzeFile(file, {}, findings);
  assert.equal(findings.length, 0);
});

test('analyzeFile respects an allowlist map passed directly (the JSON sidecar\'s in-memory shape)', () => {
  const file = writeFixture('JsonAllowed.tsx', `export function JsonAllowed() {
  return <button>KrishiMitra</button>;
}
`);
  const noAllow = [];
  analyzeFile(file, {}, noAllow);
  assert.equal(noAllow.length, 1);
  // Build the exact "file:line" key analyzeFile itself would use, from its own reported finding — proves the
  // allowlist mechanism keys on the real, reproducible identity a maintainer would copy into the sidecar JSON.
  const key = `${noAllow[0].file}:${noAllow[0].line}`;
  const withAllow = [];
  analyzeFile(file, { [key]: { reason: 'brand name, TS-003 never-translate glossary' } }, withAllow);
  assert.equal(withAllow.length, 0);
});

test('loadJsonAllowlist rejects a malformed entry (missing/empty reason) — real end-to-end, via a temp sidecar', () => {
  const { loadJsonAllowlist } = require('../detect-hardcoded-strings');
  const sidecarPath = path.join(__dirname, '..', 'hardcoded-strings.allowlist.json');
  const preExisted = fs.existsSync(sidecarPath);
  const backup = preExisted ? fs.readFileSync(sidecarPath, 'utf8') : null;
  try {
    fs.writeFileSync(sidecarPath, JSON.stringify({ 'some/file.tsx:5': { reason: '' } }));
    assert.throws(() => loadJsonAllowlist(), /no non-empty 'reason'/);
    fs.writeFileSync(sidecarPath, JSON.stringify({ 'some/file.tsx:5': { reason: 'real justification' } }));
    assert.doesNotThrow(() => loadJsonAllowlist());
  } finally {
    if (preExisted) fs.writeFileSync(sidecarPath, backup);
    else fs.rmSync(sidecarPath, { force: true });
  }
});
