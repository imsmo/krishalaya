// shared/sql/__tests__/tenant1c-enum-labels.spec.ts · PC-56 TENANT-1c.
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: EVERY STATUS LITERAL THE CODE COMPARES AN ENUM COLUMN AGAINST IS A LABEL THAT ENUM
// ACTUALLY HAS.**
//
// TENANT-1c opened by finding six occurrences across three read models I had shipped in the three previous waves comparing
// `payouts.status` to `'paid'`. `payout_status` (0006) is an ENUM whose labels are
// queued|processing|success|failed|reversed|cancelled. **There is no `paid`.**
//
// And comparing an enum column to a label it does not have is not a quiet zero — Postgres raises `invalid input value for
// enum payout_status: "paid"`. So the member roster's money column, the member detail's money tile, and the Farmer 360's
// realised income and credit evidence would every one of them have ERRORED against a real database, on screens recorded as
// closed. The wrong word came from `milk_bills.status`, a plain varchar where 'paid' IS correct.
//
// **AND ONE OF MY OWN TESTS WAS PINNING IT.** The 360 suite asserted `p.status = 'paid'` and passed, because the code said
// 'paid' too: the assertion and the defect agreed. A test can defend a bug, and the only thing that catches that is a check
// against a source neither of them wrote — here, the migrations.
import * as fs from 'node:fs';
import * as path from 'node:path';

const API_SRC = path.join(__dirname, '..', '..', '..');
const MIGRATIONS = path.join(API_SRC, '..', '..', '..', 'db', 'migrations');

/** Every `CREATE TYPE x AS ENUM (...)` in the migrations → its label set. Later `ALTER TYPE ... ADD VALUE` is folded in. */
function enumLabels(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    for (const m of sql.matchAll(/CREATE TYPE\s+(\w+)\s+AS ENUM\s*\(([^)]*)\)/gi)) {
      const labels = new Set([...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
      out.set(m[1], labels);
    }
    // A migration may widen an enum later — 0112 added `held` to `listing_status`, for instance.
    for (const m of sql.matchAll(/ALTER TYPE\s+(\w+)\s+ADD VALUE(?:\s+IF NOT EXISTS)?\s+'([^']+)'/gi)) {
      const set = out.get(m[1]);
      if (set) set.add(m[2]);
    }
  }
  return out;
}

/**
 * The columns whose type is one of those enums.
 *
 * Read from the same migrations, so the mapping is not a second list somebody has to maintain: a column declared
 * `status payout_status NOT NULL` teaches this test both the column name and its label set.
 */
function enumColumns(labels: Map<string, Set<string>>): Map<string, { type: string; table: string }> {
  const out = new Map<string, { type: string; table: string }>();
  for (const f of fs.readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
    for (const t of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\)/g)) {
      const table = t[1];
      for (const c of t[2].matchAll(/^\s*(\w+)\s+(\w+)\b/gm)) {
        const [, col, type] = c;
        if (labels.has(type)) out.set(`${table}.${col}`, { type, table });
      }
    }
  }
  return out;
}

/**
 * Every `<alias>.status = '<literal>'` in apps/api, resolved to the TABLE that alias belongs to.
 *
 * **THE ALIAS IS BOUND FROM `FROM`/`JOIN` ACROSS THE WHOLE FILE, NOT FROM THE SAME LINE — AND THE FIRST VERSION OF THIS
 * FILE FAILED TO CATCH ITS OWN MOTIVATING BUG BECAUSE OF EXACTLY THAT.** The roster's query reads `FROM payouts po` on one
 * line and `po.status = '…'` on the next, so a line-by-line scan for the word "payouts" beside the comparison saw nothing.
 * A guard that misses the defect it was written for is worse than no guard, because it reports health.
 */
/**
 * **COMMENTS ARE REMOVED BEFORE SCANNING, AND THE FOURTH REPEAT OF THIS LESSON IS THE ONE THAT ACTUALLY COST SOMETHING.**
 *
 * `tenant-dashboard.read-model.ts` EXPLAINS this very defect in its header — it contains the words `payouts.status = 'paid'`
 * as prose. So the guard flagged its own documentation, went red, and stayed red through a whole batch of mutation runs:
 * five verdicts in that batch were meaningless, because the suite was already failing for a reason unrelated to the mutant.
 *
 * The three earlier repeats only cost a fix. This one corrupted a measurement, which is worse — a red suite makes every
 * mutation look killed. Comments out, then scan.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block comments, including the JSDoc that documents the rules
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))    // line comments
    // SQL comments live INSIDE template literals, so they survive the two above and have to go too.
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

function statusComparisons(): { file: string; table: string; literal: string; snippet: string }[] {
  const found: { file: string; table: string; literal: string; snippet: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(p); continue; }
      if (!e.name.endsWith('.ts')) continue;
      const text = stripComments(fs.readFileSync(p, 'utf8'));
      const rel = path.relative(API_SRC, p);

      // alias → table, from every FROM/JOIN in the file. `FROM payouts po`, `JOIN listings l ON …`, `FROM payouts` (no alias).
      const alias = new Map<string, string>();
      for (const m of text.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)(?:\s+(?:AS\s+)?([a-z][a-z0-9_]*))?/gi)) {
        const table = m[1].toLowerCase();
        if (/^(select|lateral|values|only)$/.test(table)) continue;
        alias.set(table, table);                       // the bare table name is its own alias
        if (m[2] && !/^(on|where|as|and|or|left|right|inner|outer|group|order|limit|using)$/i.test(m[2])) {
          alias.set(m[2].toLowerCase(), table);
        }
      }

      for (const m of text.matchAll(/(?:\b([a-z][a-z0-9_]*)\.)?status\s*(?:=|<>)\s*'([a-z_]+)'/g)) {
        const a = (m[1] ?? '').toLowerCase();
        const table = alias.get(a);
        if (!table) continue;                          // an alias this file never bound: not a claim we can check
        found.push({ file: rel, table, literal: m[2], snippet: m[0] });
      }
    }
  };
  walk(API_SRC);
  return found;
}

describe('TENANT-1c · enum status literals exist', () => {
  const labels = enumLabels();
  const columns = enumColumns(labels);

  it('read the migrations at all', () => {
    // The guard against a vacuous pass: if the parse breaks, every assertion below becomes a no-op that reports health.
    expect(labels.get('payout_status')).toBeDefined();
    expect([...labels.get('payout_status')!]).toEqual(
      expect.arrayContaining(['queued', 'processing', 'success', 'failed', 'reversed', 'cancelled']));
    // The label the code used for three waves, and the reason this file exists.
    expect(labels.get('payout_status')!.has('paid')).toBe(false);
    expect(columns.get('payouts.status')?.type).toBe('payout_status');
  });

  /**
   * **THE ASSERTION THAT MATTERS.** A literal that is not a label of ANY enum in the schema is either a varchar status —
   * legitimate, several tables have one — or a bug. So the check is narrow on purpose: it fails only for a literal that
   * belongs to no enum AND collides with a name a known enum column uses, which is exactly the `payouts.status = 'paid'`
   * shape. Broadening it to every string would drown in false positives and be switched off within a month.
   */
  it('never compares a payout status to a label payout_status does not have', () => {
    const payoutLabels = labels.get('payout_status')!;
    const offenders = statusComparisons()
      .filter((c) => c.table === 'payouts')
      .filter((c) => !payoutLabels.has(c.literal))
      .map((c) => `${c.file}: ${c.snippet}`);
    expect(offenders).toEqual([]);
  });

  /**
   * And the same shape for the other enums a read model is most likely to reach for by memory. Each one is a status a
   * SCREEN prints, which is why a wrong label here is invisible until a real database refuses it.
   */
  it.each([
    ['listing_status', 'listings'],
    ['order_status', 'orders'],
    ['dispute_status', 'disputes'],
  ])('never compares a %s to a label it does not have', (typeName, table) => {
    const set = labels.get(typeName);
    expect(set).toBeDefined();
    const offenders = statusComparisons()
      .filter((c) => c.table === table)
      .filter((c) => !set!.has(c.literal))
      .map((c) => `${c.file}: ${c.snippet}`);
    expect(offenders).toEqual([]);
  });

  /**
   * **AND THE GUARD IS ITSELF GUARDED.** The alias resolver has to bind `po` to `payouts` across lines, or this whole file
   * is decoration — which is what the first version was. Asserted directly so a future simplification of the resolver
   * cannot quietly turn every check above into a no-op.
   */
  it('resolves an alias bound on a DIFFERENT line from the comparison', () => {
    const roster = statusComparisons().filter((c) => c.file.includes('member-roster.read-model'));
    expect(roster.some((c) => c.table === 'payouts')).toBe(true);
    expect(roster.find((c) => c.table === 'payouts')!.literal).toBe('success');
  });
});
