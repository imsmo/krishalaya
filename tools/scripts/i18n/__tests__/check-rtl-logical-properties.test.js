// tools/scripts/i18n/__tests__/check-rtl-logical-properties.test.js · DEV-21. Proves the gate-10 RTL grep
// catches a planted physical property, ignores documented residuals (scaleX/translateX/corner-radius), and
// respects the rtl-allow comment. Run: node --test tools/scripts/i18n/__tests__/check-rtl-logical-properties.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanFile, isResidual, hasAllowComment } = require('../check-rtl-logical-properties');

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-rtl-grep-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

test('isResidual: recognizes scaleX/translateX/corner-radius as documented residuals', () => {
  assert.equal(isResidual('.icon-mirror { transform: scaleX(-1); }'), true);
  assert.equal(isResidual('.switch-thumb { transform: translateX(20px); }'), true);
  assert.equal(isResidual('.card { border-top-left-radius: 8px; }'), true);
  assert.equal(isResidual('.card { margin-left: 8px; }'), false);
});

test('hasAllowComment: requires a non-empty reason', () => {
  assert.equal(hasAllowComment('margin-left: 8px; /* rtl-allow: vendor widget, cannot touch */'), true);
  assert.equal(hasAllowComment('margin-left: 8px; /* rtl-allow: */'), false);
  assert.equal(hasAllowComment('margin-left: 8px;'), false);
});

test('catches a planted physical property (margin-left) in a CSS file', () => {
  const file = tmpFile('planted.css', '.kv-thing { margin-left: 12px; }\n');
  const findings = [];
  scanFile(file, findings);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].property, 'margin-left');
});

test('catches text-align: right and float: left', () => {
  const file = tmpFile('planted2.css', '.a { text-align: right; }\n.b { float: left; }\n');
  const findings = [];
  scanFile(file, findings);
  assert.equal(findings.length, 2);
});

test('does NOT flag a logical property (margin-inline-start) or a residual (scaleX)', () => {
  const file = tmpFile('clean.css', '.kv-thing { margin-inline-start: 12px; }\n.icon-mirror { transform: scaleX(-1); }\n');
  const findings = [];
  scanFile(file, findings);
  assert.equal(findings.length, 0);
});

test('respects the rtl-allow comment allowlist', () => {
  const file = tmpFile('allowed.css', '.legacy { margin-left: 8px; } /* rtl-allow: vendor-widget CSS we cannot edit, tracked in DELTA-999 */\n');
  const findings = [];
  scanFile(file, findings);
  assert.equal(findings.length, 0);
});

test('does not double-flag border-*-left-radius/border-*-right-radius (residual, not a violation)', () => {
  const file = tmpFile('radius.css', '.card { border-top-left-radius: 8px; border-bottom-right-radius: 8px; }\n');
  const findings = [];
  scanFile(file, findings);
  assert.equal(findings.length, 0);
});
