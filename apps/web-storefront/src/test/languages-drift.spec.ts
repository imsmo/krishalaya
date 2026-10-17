// apps/web-storefront/src/test/languages-drift.spec.ts · PC-56 STORE-SWEEP-b · C3 (founder D3, survey E8 / F-11) — THE TWO LANGUAGE REGISTRIES AGREE ON
// WHAT IS LIVE. The storefront reads the CODE registry (`@krishalaya/i18n` LANGUAGE_REGISTRY, status `live`); the API reads the DB `languages` table
// (seeded by db/seeds/core/0001_languages.sql, `is_active`). Law 6 says the DB; this spec makes any drift between the two red: the live set in the
// registry's SOURCE (packages/i18n/src/languages.ts — read as text, so an edit is seen before the package is rebuilt), the live set the built package
// exports, and the seed's active rows must be the same set — en / hi / gu today. Mutant M5 (`mr` made live in the source) turns this red.
// (The registry's "coming soon" set — 11 — is wider than the seed's inactive rows — 9: `ar`, `ur` have no DB row; named, not a drift of the LIVE set.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGE_REGISTRY, LANGUAGES } from '@krishalaya/i18n';
import { liveLanguages } from '../features/sweep/languages';

const REPO = join(__dirname, '..', '..', '..', '..');
const sorted = (a: Iterable<string>) => [...a].sort();

/** The seed's rows: (code, …, is_active, …) — the 8th column of each VALUES tuple. */
function seedRows(): Array<{ code: string; active: boolean }> {
  const sql = readFileSync(join(REPO, 'db', 'seeds', 'core', '0001_languages.sql'), 'utf8');
  const rows: Array<{ code: string; active: boolean }> = [];
  for (const m of sql.matchAll(/\(\s*'([a-z]{2,3})'\s*,([^()]*)\)/g)) {
    const cols = m[2].split(',').map((c) => c.trim());
    // name_native, name_english, script, direction, font_stack, number_format, is_active, voice_stt_ready, sort_order
    rows.push({ code: m[1], active: cols[6] === 'true' });
  }
  return rows;
}
/** The registry SOURCE's entries: { code: 'xx', … status: '…' }. */
function sourceRows(): Array<{ code: string; status: string }> {
  const src = readFileSync(join(REPO, 'packages', 'i18n', 'src', 'languages.ts'), 'utf8');
  return [...src.matchAll(/\{\s*code:\s*'([a-z]{2,3})'[^}]*?status:\s*'([a-z-]+)'/g)].map((m) => ({ code: m[1], status: m[2] }));
}

describe('STORE-SWEEP-b · languages drift (code registry ↔ seed)', () => {
  it('the seed is read: 12 rows, 3 active', () => {
    const rows = seedRows();
    expect(rows).toHaveLength(12);
    expect(rows.filter((r) => r.active)).toHaveLength(3);
  });
  it('the registry source is read: 14 entries', () => {
    expect(sourceRows()).toHaveLength(14);
  });
  it('the LIVE set is the same in the registry source, the built package and the seed — en / hi / gu', () => {
    const seedActive = sorted(seedRows().filter((r) => r.active).map((r) => r.code));
    const sourceLive = sorted(sourceRows().filter((r) => r.status === 'live').map((r) => r.code));
    const builtLive = sorted(LANGUAGE_REGISTRY.filter((l) => l.status === 'live').map((l) => l.code));
    expect(sourceLive).toEqual(seedActive);
    expect(builtLive).toEqual(seedActive);
    expect(sorted(LANGUAGES.map((l) => l.code))).toEqual(seedActive);
    expect(sorted(liveLanguages().map((l) => l.code))).toEqual(seedActive);
    expect(seedActive).toEqual(['en', 'gu', 'hi']);
  });
  it('every seed row is a registry entry (no language the API knows that the storefront cannot name)', () => {
    const codes = new Set(sourceRows().map((r) => r.code));
    for (const r of seedRows()) expect([r.code, codes.has(r.code)]).toEqual([r.code, true]);
  });
});
