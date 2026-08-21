// core/database/__tests__/seed-order-coverage.spec.ts · PC-56 TENANT-6d-7 · A SEED FILE NOTHING APPLIES.
//
// TENANT-6c-4 found `db/seeds/rules/0208_fintech_products.sql` had never been listed in `db/scripts/seed.js`'s ORDER
// array and had therefore never existed in any database — while an integration spec asked for a row from it by id and
// had been RED since it was written. The runner fails loudly on a MISSING file; a file that was never NAMED stayed
// silent, and the integration harness's `if (!fs.existsSync) continue` kept it silent there too.
//
// This wave adds a seed file of its own (`core/0016_ui_messages_dairy_notices.sql`, the words behind the dairy notices)
// and therefore has to answer the question that trap poses: what makes the list complete? Not care — a check. Every
// file under db/seeds/{core,rules,catalogue} is either APPLIED or DELIBERATELY EXCLUDED with its reason recorded here.
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '../../../../../..');
const SEEDS = path.join(ROOT, 'db', 'seeds');

/**
 * Files that are on disk and NOT applied, each with the reason. A new unexplained file fails the test below; adding it
 * here is a decision somebody has to write down, which is the whole point.
 */
const DELIBERATELY_NOT_APPLIED: Record<string, string> = {
  'rules/0209_scheme_catalogue.sql':
    'A SECOND seed for `schemes` and a corrected rewrite of 0208_schemes_starter_set: it inserts the same `pm_kisan` '
    + 'code (so applying both fails on schemes_code_key) and it uses the `scheme_category` lookup where the listed file '
    + 'stores a `tenant_type` id in `schemes.category_id`. Wiring the correction means deciding what happens to rows '
    + 'that already exist — an UPDATE and a migration in the schemes module, not an INSERT in a dairy wave. ESCALATED '
    + 'with the lookup-duplication finding (migration 0160\'s header).',
};

const listSeedFiles = (): string[] => {
  const out: string[] = [];
  for (const dir of ['core', 'rules', 'catalogue']) {
    const full = path.join(SEEDS, dir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full).sort()) if (f.endsWith('.sql')) out.push(`${dir}/${f}`);
  }
  return out;
};

describe('PC-56 TENANT-6d-7 · the seed runner applies every seed file, or says why it does not', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { ORDER } = require(path.join(ROOT, 'db', 'scripts', 'seed.js')) as { ORDER: string[] };

  it('lists every file on disk (or records the exclusion and its reason)', () => {
    const unexplained = listSeedFiles().filter((f) => !ORDER.includes(f) && !(f in DELIBERATELY_NOT_APPLIED));
    // 6c-4's finding, as a failing test rather than a discovery: `rules/0208_fintech_products.sql` would have appeared
    // here, and so would this wave's own `core/0016`.
    expect(unexplained).toEqual([]);
  });

  it('lists nothing that is not on disk — a named file that does not exist is the mirror defect', () => {
    const missing = ORDER.filter((rel) => !fs.existsSync(path.join(SEEDS, rel)));
    expect(missing).toEqual([]);
  });

  it('applies TENANT-6d-7\'s own words, in the order that puts them before nothing that needs them', () => {
    expect(ORDER).toContain('core/0016_ui_messages_dairy_notices.sql');
    // `ui_messages` has no foreign keys into anything a later seed writes, so its position only has to be inside
    // `core` — asserted so a future reshuffle does not silently drop it to the end of the file.
    expect(ORDER.indexOf('core/0016_ui_messages_dairy_notices.sql')).toBeLessThan(ORDER.indexOf('rules/0201_plans_limits_features.sql'));
  });

  it('records a REASON for every exclusion — an empty string is not an explanation', () => {
    for (const [file, why] of Object.entries(DELIBERATELY_NOT_APPLIED)) {
      expect(fs.existsSync(path.join(SEEDS, file))).toBe(true);   // an exclusion for a deleted file is stale
      expect(why.length).toBeGreaterThan(80);
    }
  });
});
