// apps/web-tenant/src/test/gov3a-dbt-closed.spec.ts · PC-56 GOV-3a (GOV-3 Q2-A, lead-applied; the founder may reopen) — the API refuses the
// organisation's DBT credit record by name (DBT_IS_NOT_RECORDED_HERE); the /schemes page states that refusal in words in all three languages
// (the Server Action already carries the SdkError code into `?error=`). web-tenant calls no other closed DBT method (no monitor, recent,
// export or returned-payment call). Source-level: the page and actions are not unit-renderable here.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const KEY = 'scm.err.DBT_IS_NOT_RECORDED_HERE';
const SRC = join(__dirname, '..');
const src = (p: string) => readFileSync(join(SRC, p), 'utf8');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []; });

describe('PC-56 GOV-3a · web-tenant states the DBT refusal ×3', () => {
  it('the sentence exists in en, hi and gu — each its own language; the English is the API\'s', () => {
    expect((en as Record<string, string>)[KEY]).toBe('Payments and returned payments are not recorded on this platform. Benefits are paid by PFMS and the banks, outside this platform.');
    for (const d of [hi, gu] as Array<Record<string, string>>) { expect(typeof d[KEY]).toBe('string'); expect(d[KEY]).not.toBe((en as Record<string, string>)[KEY]); expect(d[KEY]).toMatch(/PFMS/); }
  });
  it('the page maps the code to the sentence; the record action forwards the SdkError code', () => {
    expect(src('app/schemes/page.tsx')).toMatch(/NAMED_REFUSALS = new Set\(\[[^\]]*'DBT_IS_NOT_RECORDED_HERE'[^\]]*\]\)/);
    const actions = src('app/schemes/actions.ts');
    const body = actions.slice(actions.indexOf('export async function recordDbtAction'));
    expect(/catch \(e\) \{ fail\(e, id\); \}/.test(body.slice(0, 900))).toBe(true);
  });
  it('no web-tenant source calls a closed DBT method other than the record (which shows the refusal)', () => {
    const hits = walk(SRC).filter((f) => !f.includes(`${join('src', 'test')}`)).filter((f) => /\.(dbtMonitor|dbtRecent|exportReport|recordDbtBounce|resolveDbtBounce|dbtBounces|dbtBounceDesk|applicationDbtBounces)\(/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
