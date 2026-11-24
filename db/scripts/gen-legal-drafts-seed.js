#!/usr/bin/env node
// db/scripts/gen-legal-drafts-seed.js · PC-56 LEGAL-1 (migration 0242) — the four platform policy DRAFTS, from markdown to a seed.
//
//   node db/scripts/gen-legal-drafts-seed.js           # (re)write db/seeds/core/0030_platform_legal_drafts.sql from docs/legal/*.md
//   node db/scripts/gen-legal-drafts-seed.js --check   # exit 1 when the seed is not what the markdown generates (db:test runs the check)
//
// THE SOURCE OF TRUTH FOR THE FIRST DRAFTS is docs/legal/{terms,privacy,refunds,shipping}.md. Each file carries a reviewer block ("DRAFT —
// must be reviewed by a qualified lawyer before publishing", the facts the lawyer must supply) that is NEVER published: only the text between
// `<!-- BEGIN PAGE BODY -->` and `<!-- END PAGE BODY -->` is taken; its first `# ` line is the page title (removed from the body — the
// storefront prints the title itself).
//
// WHAT THE SEED DOES: for each slug, INSERTs version 1 as a platform `policy` page with status `draft`, language `en`, no author
// (created_by NULL — a loaded draft; an operator must save/adopt it in the admin console before a DIFFERENT operator can publish it, 0242) —
// ONLY WHEN THE PLATFORM HAS NO ROW FOR THAT SLUG AT ALL. So it is safe to re-run (seed.js re-applies a seed whose checksum changed), and a
// later edit of the markdown never overwrites what operators have done in the console: after the first load, the console is the editor.
// The body must pass 0177's `cms_body_is_markdown` (0242's platform guard refuses it otherwise); this script refuses it first, by name.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LEGAL = path.join(ROOT, 'docs', 'legal');
const OUT = path.join(ROOT, 'db', 'seeds', 'core', '0030_platform_legal_drafts.sql');
const SLUGS = ['terms', 'privacy', 'refunds', 'shipping'];
const BEGIN = '<!-- BEGIN PAGE BODY -->';
const END = '<!-- END PAGE BODY -->';
const DRAFT_LINE = /^> \*\*DRAFT — must be reviewed by a qualified lawyer before publishing/;
const TOKENS = new Set([
  'platform.legal.entity_name', 'platform.legal.registered_office', 'platform.grievance.officer_name', 'platform.grievance.address',
  'platform.grievance.email', 'platform.grievance.ack_hours', 'platform.grievance.resolve_days', 'platform.contact.security_email',
  'platform.contact.partners_email', 'platform.contact.press_email', 'platform.contact.general_email',
]);

/** Split one markdown file into { title, body } (pure; throws with the file name on any layout problem). */
function extract(name, md) {
  const text = md.replace(/\r\n?/g, '\n');
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error(`${name}: needs the ${BEGIN} … ${END} markers`);
  if (!DRAFT_LINE.test(text)) throw new Error(`${name}: the first line must be the "DRAFT — must be reviewed by a qualified lawyer" line`);
  const lines = text.slice(a + BEGIN.length, b).split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  const h = /^# (.+)$/.exec(lines[0] || '');
  if (!h) throw new Error(`${name}: the body must start with a "# Title" line`);
  const title = h[1].trim();
  const body = lines.slice(1).join('\n').replace(/[ \t]+$/gm, '').replace(/^\n+/, '').replace(/\s+$/, '');
  if (/DRAFT — must be reviewed/.test(body)) throw new Error(`${name}: the reviewer DRAFT line must not be inside the page body`);
  // 0177's cms_body_is_markdown, the same three patterns (apps/api cms domain/page-rules.ts).
  if (/<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?\s*>/i.test(body) || body.includes('<!--')) throw new Error(`${name}: raw HTML in the body`);
  if (/\]\(\s*<?\s*(javascript|vbscript|data)\s*:/i.test(body)) throw new Error(`${name}: an unsafe link target in the body`);
  for (const m of body.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) if (!TOKENS.has(m[1])) throw new Error(`${name}: unknown token {{${m[1]}}}`);
  if (title.length > 250) throw new Error(`${name}: title over 250 characters`);
  if (body.length === 0) throw new Error(`${name}: empty body`);
  return { title, body };
}

function dollar(tag, s) {
  const q = `$${tag}$`;
  if (s.includes(q)) throw new Error(`the text contains the quote tag ${q}`);
  return `${q}${s}${q}`;
}

function generate() {
  const parts = [
    '-- db/seeds/core/0030_platform_legal_drafts.sql · PC-56 LEGAL-1 (migration 0242) — GENERATED, DO NOT EDIT BY HAND.',
    '-- Source: docs/legal/{terms,privacy,refunds,shipping}.md (the text between the BEGIN / END PAGE BODY markers; the first "# " line is the title).',
    '-- Regenerate: node db/scripts/gen-legal-drafts-seed.js   ·   Verify: node db/scripts/gen-legal-drafts-seed.js --check (db:test runs it).',
    '-- Loads each page as a platform POLICY page, version 1, status DRAFT (never published here — the founder publishes after legal review, in',
    '-- the admin console, by a second operator), ONLY when the platform has no row for the slug at all: re-running never overwrites console work.',
    '',
  ];
  for (const slug of SLUGS) {
    const { title, body } = extract(`${slug}.md`, fs.readFileSync(path.join(LEGAL, `${slug}.md`), 'utf8'));
    parts.push(
      'INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code)',
      `SELECT NULL, '${slug}', 'policy', ${dollar('legal_title', title)},`,
      `       ${dollar(`legal_${slug}`, body)},`,
      "       1, 'draft', 'en'",
      ` WHERE NOT EXISTS (SELECT 1 FROM cms_pages WHERE tenant_id IS NULL AND slug = '${slug}');`,
      '',
    );
  }
  return parts.join('\n');
}

function main() {
  const sql = generate();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== sql) {
      console.error(`${path.relative(ROOT, OUT)} is stale — run: node db/scripts/gen-legal-drafts-seed.js`);
      process.exit(1);
    }
    console.log('legal drafts seed is in sync with docs/legal/*.md');
    return;
  }
  fs.writeFileSync(OUT, sql);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) main();
module.exports = { extract, generate, SLUGS, OUT };
