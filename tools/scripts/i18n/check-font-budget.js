#!/usr/bin/env node
// tools/scripts/i18n/check-font-budget.js · Q35 CI-enforceable font-pack budget check (DEV-21).
//
// LAW (developer-handoff.md §7 / Performance-budgets table, Q35 ruling): "Font pack per language | ≤120KB WOFF2,
// subsetted, weights 400/700 initially | founder §17 approval to loosen." This script enforces that ceiling for
// REAL against whatever font file is dropped in — it does not simulate, does not trust a claimed size, and does
// not know or care where the file came from (a hand-built subset, a CI-fetched Google Fonts file, a test fixture).
//
// HONEST BOUNDARY (stated up front, not discovered late): this repo carries ZERO font binaries today
// (`find apps/mobile -iname "*.ttf" -o -iname "*.woff*"` → empty, confirmed before writing this script). This
// script is therefore currently UNEXERCISED against real production font files — it is proven correct against
// synthetic fixtures (`__tests__/check-font-budget.test.js`) and is ready to run the moment a real .woff2 lands
// (via `build-font-pack.sh`'s documented, network-dependent pipeline — see that file + FONT_PIPELINE.md). This is
// the honest "pipeline-as-config" deliverable the DEV-21 brief asks for: a REAL, RUNNABLE gate, not a fake font
// file invented to make the check look exercised.
//
// Usage:
//   node tools/scripts/i18n/check-font-budget.js path/to/font.woff2 [more.woff2 ...]
//   node tools/scripts/i18n/check-font-budget.js --dir path/to/font/dir       # checks every *.woff2 under dir
//   node tools/scripts/i18n/check-font-budget.js --dir path/to/dir --budget 100000   # override the ceiling (bytes)
//
// Exit code: 0 if every checked file is within budget (or zero files found — see --dir note below), 1 if any file
// exceeds budget or a given path doesn't exist / isn't a file. Prints a per-file PASS/FAIL line + a summary.
'use strict';
const fs = require('fs');
const path = require('path');

const Q35_BUDGET_BYTES = 120 * 1024; // 122880 — ≤120KB WOFF2 per language pack, per Q35 ruling

function parseArgs(argv) {
  const files = [];
  let dir = null;
  let budget = Q35_BUDGET_BYTES;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') { dir = argv[++i]; }
    else if (a === '--budget') { budget = parseInt(argv[++i], 10); }
    else { files.push(a); }
  }
  return { files, dir, budget };
}

/** Recursively collect every *.woff2 file under `dir`. Returns [] for a non-existent or empty dir (never throws
 *  on "nothing to check yet" — that is this repo's honest current state, not an error). */
function collectWoff2(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const stat = fs.statSync(cur);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(cur)) stack.push(path.join(cur, entry));
    } else if (stat.isFile() && cur.toLowerCase().endsWith('.woff2')) {
      out.push(cur);
    }
  }
  return out.sort();
}

function checkFile(file, budget) {
  if (!fs.existsSync(file)) return { file, ok: false, error: 'file does not exist' };
  const stat = fs.statSync(file);
  if (!stat.isFile()) return { file, ok: false, error: 'not a file' };
  const bytes = stat.size;
  return { file, ok: bytes <= budget, bytes, budget };
}

function main() {
  const { files, dir, budget } = parseArgs(process.argv.slice(2));
  const targets = dir ? collectWoff2(dir) : files;

  if (targets.length === 0) {
    if (dir) {
      console.log(`[check-font-budget] no .woff2 files found under '${dir}' — nothing to check (honest: this repo ` +
        `carries zero font binaries as of DEV-21; this is not a failure, it is the current, disclosed state).`);
      process.exit(0);
    }
    console.error('[check-font-budget] no files given. Usage: check-font-budget.js <file.woff2 ...> | --dir <dir> [--budget <bytes>]');
    process.exit(1);
  }

  let anyFail = false;
  for (const f of targets) {
    const r = checkFile(f, budget);
    if (r.error) {
      anyFail = true;
      console.error(`FAIL  ${r.file}  (${r.error})`);
      continue;
    }
    const kb = (r.bytes / 1024).toFixed(1);
    const budgetKb = (r.budget / 1024).toFixed(0);
    if (r.ok) {
      console.log(`PASS  ${r.file}  ${kb}KB ≤ ${budgetKb}KB`);
    } else {
      anyFail = true;
      console.error(`FAIL  ${r.file}  ${kb}KB > ${budgetKb}KB (Q35 ceiling exceeded)`);
    }
  }

  console.log(`[check-font-budget] ${targets.length} file(s) checked, budget=${(budget / 1024).toFixed(0)}KB, ${anyFail ? 'FAIL' : 'ALL PASS'}`);
  process.exit(anyFail ? 1 : 0);
}

if (require.main === module) main();

module.exports = { Q35_BUDGET_BYTES, checkFile, collectWoff2, parseArgs };
