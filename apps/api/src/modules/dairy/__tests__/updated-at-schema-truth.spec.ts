/**
 * DEV-49 (2026-07-29) — updated_at SCHEMA-TRUTH SWEEP (whole-repo regression guard)
 *
 * Origin: DEV-47 QA escalated `milk_collections.attachToBill()` writing
 * `updated_at=now()` against a table that deliberately has NO updated_at column
 * (partitioned daily-scale, excluded from 0001_foundation.sql's
 * add_std_columns() by design). Every bill-generation run would throw 42703 —
 * a live P0 on the dairy money-out path that no unit test caught, because the
 * repository is always mocked at the service layer.
 *
 * This spec closes the WHOLE CLASS statically, no database required:
 * it derives the set of tables that truly have updated_at (inline DDL ∪
 * add_std_columns() call sites ∪ ALTER TABLE additions) straight from
 * db/migrations/*.sql, then scans every apps/api/src TypeScript file for
 * `UPDATE <table> SET ... updated_at` and fails on any table outside that set.
 * Same philosophy as verify-rls-coverage.js: the migrations are the truth,
 * the code must match them, and the check runs in CI on every change.
 *
 * At DEV-49 close the sweep found exactly ONE offender (the milk_collections
 * line, fixed in the same batch). If this spec ever fails again, either the
 * new UPDATE is wrong, or the table genuinely gained updated_at — in which
 * case the DDL parse below will already reflect it and the test will pass.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../../../..'); // apps/api/src/modules/dairy/__tests__ -> repo root
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'db', 'migrations');
const API_SRC = path.join(REPO_ROOT, 'apps', 'api', 'src');

function readAllMigrations(): string {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('updated_at schema truth — every `UPDATE t SET … updated_at` targets a table that really has the column', () => {
  const ddl = readAllMigrations();

  // Tables that truly have updated_at:
  const hasUpdatedAt = new Set<string>();
  // (a) via the 0001_foundation.sql DRY utility
  for (const m of ddl.matchAll(/add_std_columns\('(\w+)'\)/g)) hasUpdatedAt.add(m[1]);
  // (b) inline column in CREATE TABLE (body up to the first line-anchored `)`)
  for (const m of ddl.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(([\s\S]*?)\n\)/g)) {
    if (/^\s*updated_at\s/m.test(m[2])) hasUpdatedAt.add(m[1]);
  }
  // (c) later ALTER TABLE additions
  for (const m of ddl.matchAll(/ALTER TABLE (?:ONLY )?(\w+)[^;]*ADD COLUMN (?:IF NOT EXISTS )?updated_at/g)) {
    hasUpdatedAt.add(m[1]);
  }
  const allTables = new Set<string>();
  for (const m of ddl.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)) allTables.add(m[1]);

  it('parsed a sane schema (sanity anchors, so an empty parse can never fake a pass)', () => {
    expect(allTables.size).toBeGreaterThan(150);
    expect(hasUpdatedAt.size).toBeGreaterThan(150);
    expect(hasUpdatedAt.has('users')).toBe(true); // add_std_columns path
    expect(hasUpdatedAt.has('orders')).toBe(true); // inline-DDL path (0005_commerce.sql)
    expect(allTables.has('milk_collections')).toBe(true);
    expect(hasUpdatedAt.has('milk_collections')).toBe(false); // the deliberate exclusion that caused DEV-49
  });

  it('finds ZERO code paths setting updated_at on a table without the column', () => {
    const offenders: string[] = [];
    for (const file of walk(API_SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/UPDATE (\w+)\s+SET[^`']{0,300}?updated_at/g)) {
        const table = m[1];
        if (allTables.has(table) && !hasUpdatedAt.has(table)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} -> ${table}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('regression anchor: milk_collections.attachToBill SQL no longer writes updated_at', () => {
    const repo = fs.readFileSync(
      path.join(API_SRC, 'modules', 'dairy', 'repositories', 'milk-collection.repository.ts'),
      'utf8',
    );
    // Assert on the SQL template literals themselves (comments around them may legitimately discuss updated_at — the
    // queries must not). [PC-56 TENANT-6b-1] Checks EVERY `UPDATE milk_collections` in the file rather than the first
    // one: the hold-state write this wave added is a second such statement, and a regression anchor that only ever
    // looked at whichever came first would have stopped guarding the one it was written for.
    const statements = repo.match(/UPDATE milk_collections SET[^`]*/g) ?? [];
    expect(statements.length).toBeGreaterThanOrEqual(2);
    for (const sql of statements) expect(sql).not.toContain('updated_at');
    expect(statements.some((sql) => sql.includes('SET milk_bill_id=$4 WHERE'))).toBe(true);
    expect(statements.some((sql) => sql.includes('SET hold_state=$5 WHERE'))).toBe(true);
  });
});
