// db/scripts/__tests__/legal-drafts-seed.test.js · PC-56 LEGAL-1 — the platform policy drafts seed is GENERATED from docs/legal/*.md.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { extract, generate, SLUGS, OUT } = require('../gen-legal-drafts-seed');
const { ORDER } = require('../seed');

test('the committed seed is exactly what the markdown generates (run gen-legal-drafts-seed.js after editing docs/legal)', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), generate());
});

test('the seed is listed in seed.js ORDER', () => {
  assert.ok(ORDER.includes('core/0030_platform_legal_drafts.sql'));
});

test('the four slugs, each loaded as a DRAFT and only when the slug has no platform row', () => {
  assert.deepEqual(SLUGS, ['terms', 'privacy', 'refunds', 'shipping']);
  const sql = generate();
  for (const s of SLUGS) assert.match(sql, new RegExp(`WHERE NOT EXISTS \\(SELECT 1 FROM cms_pages WHERE tenant_id IS NULL AND slug = '${s}'\\)`));
  assert.doesNotMatch(sql, /'published'/);
  assert.equal((sql.match(/1, 'draft', 'en'/g) || []).length, 4);
});

test('the reviewer block (DRAFT line, notes) never reaches the page body; the title is lifted out', () => {
  const md = '> **DRAFT — must be reviewed by a qualified lawyer before publishing.**\n\n## Reviewer notes\n- secret note\n\n'
    + '<!-- BEGIN PAGE BODY -->\n# Terms of Use\n\n## 1. Hello\n\nWrite to {{platform.grievance.email}}.\n<!-- END PAGE BODY -->\n';
  const { title, body } = extract('x.md', md);
  assert.equal(title, 'Terms of Use');
  assert.equal(body, '## 1. Hello\n\nWrite to {{platform.grievance.email}}.');
  assert.doesNotMatch(body, /DRAFT|secret note|<!--/);
});

test('refuses raw HTML, unsafe links, unknown tokens, a missing DRAFT line', () => {
  const wrap = (b, draft = true) => `${draft ? '> **DRAFT — must be reviewed by a qualified lawyer before publishing.**\n' : ''}<!-- BEGIN PAGE BODY -->\n# T\n\n${b}\n<!-- END PAGE BODY -->`;
  assert.throws(() => extract('a.md', wrap('<script>x</script>')), /raw HTML/);
  assert.throws(() => extract('a.md', wrap('[x](javascript:alert(1))')), /unsafe link/);
  assert.throws(() => extract('a.md', wrap('{{platform.evil}}')), /unknown token/);
  assert.throws(() => extract('a.md', wrap('ok', false)), /DRAFT/);
});
