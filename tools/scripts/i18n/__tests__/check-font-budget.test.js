// tools/scripts/i18n/__tests__/check-font-budget.test.js · DEV-21. Synthetic-fixture tests for the Q35 font
// budget script — proves the ≤120KB check is REAL (a file one byte over budget fails, one byte under passes),
// not a rubber stamp. Run: node --test tools/scripts/i18n/__tests__/check-font-budget.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Q35_BUDGET_BYTES, checkFile, collectWoff2, parseArgs } = require('../check-font-budget');

function tmpFile(name, bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-font-budget-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.alloc(bytes, 0x00));
  return file;
}

test('Q35_BUDGET_BYTES is exactly 120KB (122880 bytes)', () => {
  assert.equal(Q35_BUDGET_BYTES, 120 * 1024);
  assert.equal(Q35_BUDGET_BYTES, 122880);
});

test('a file exactly at the budget passes', () => {
  const f = tmpFile('exact.woff2', Q35_BUDGET_BYTES);
  const r = checkFile(f, Q35_BUDGET_BYTES);
  assert.equal(r.ok, true);
  assert.equal(r.bytes, Q35_BUDGET_BYTES);
});

test('a file one byte over the budget fails', () => {
  const f = tmpFile('over.woff2', Q35_BUDGET_BYTES + 1);
  const r = checkFile(f, Q35_BUDGET_BYTES);
  assert.equal(r.ok, false);
});

test('a file one byte under the budget passes', () => {
  const f = tmpFile('under.woff2', Q35_BUDGET_BYTES - 1);
  const r = checkFile(f, Q35_BUDGET_BYTES);
  assert.equal(r.ok, true);
});

test('a small real-world-sized subset (e.g. 45KB) passes comfortably', () => {
  const f = tmpFile('small.woff2', 45 * 1024);
  const r = checkFile(f, Q35_BUDGET_BYTES);
  assert.equal(r.ok, true);
});

test('a bloated unsubsetted font (e.g. 400KB) fails', () => {
  const f = tmpFile('bloated.woff2', 400 * 1024);
  const r = checkFile(f, Q35_BUDGET_BYTES);
  assert.equal(r.ok, false);
});

test('a non-existent file reports an error, not a silent pass', () => {
  const r = checkFile('/tmp/kv-font-budget-test-does-not-exist-12345.woff2', Q35_BUDGET_BYTES);
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('collectWoff2 finds only .woff2 files, recursively, and is empty-safe for a missing dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-font-budget-dir-'));
  fs.mkdirSync(path.join(dir, 'bn'));
  fs.writeFileSync(path.join(dir, 'bn', 'HindSiliguri-400.woff2'), Buffer.alloc(1024));
  fs.writeFileSync(path.join(dir, 'bn', 'notes.txt'), 'not a font');
  fs.writeFileSync(path.join(dir, 'root.woff2'), Buffer.alloc(2048));
  const found = collectWoff2(dir);
  assert.equal(found.length, 2);
  assert.ok(found.every((f) => f.endsWith('.woff2')));
  assert.deepEqual(collectWoff2(path.join(dir, 'does-not-exist')), []);
});

test('parseArgs handles files, --dir, and --budget override', () => {
  assert.deepEqual(parseArgs(['a.woff2', 'b.woff2']), { files: ['a.woff2', 'b.woff2'], dir: null, budget: Q35_BUDGET_BYTES });
  assert.deepEqual(parseArgs(['--dir', '/some/dir']), { files: [], dir: '/some/dir', budget: Q35_BUDGET_BYTES });
  assert.deepEqual(parseArgs(['--dir', '/some/dir', '--budget', '100000']), { files: [], dir: '/some/dir', budget: 100000 });
});
