// apps/web-tenant/src/test/gov2a-scheme-decisions.spec.ts · PC-56 GOV-2a (GOV-2 Q2-A) — the organisation's verify / approve / reject / close
// are refused by the API by name (SCHEME_DECISIONS_ARE_THE_AUTHORITYS); the /schemes page states that refusal in words in all three languages
// (the Server Actions already carry the SdkError code into `?error=`). Source-level: the page and actions are not unit-renderable here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const KEY = 'scm.err.SCHEME_DECISIONS_ARE_THE_AUTHORITYS';
const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('PC-56 GOV-2a · web-tenant states the authority\'s refusal ×3', () => {
  it('the sentence exists in en, hi and gu — each its own language, facts only', () => {
    const dicts = { en, hi, gu } as Record<string, Record<string, string>>;
    for (const [lang, d] of Object.entries(dicts)) expect([lang, typeof d[KEY], (d[KEY] ?? '').length > 20]).toEqual([lang, 'string', true]);
    expect((en as Record<string, string>)[KEY]).toBe('Applications are checked and decided by the government authority that runs the scheme, not by the organisation.');
    expect((hi as Record<string, string>)[KEY]).not.toBe((en as Record<string, string>)[KEY]);
    expect((gu as Record<string, string>)[KEY]).not.toBe((en as Record<string, string>)[KEY]);
  });

  it('the page maps the code to the sentence; every closed act\'s Server Action forwards the SdkError code', () => {
    const page = src('app/schemes/page.tsx');
    expect(page).toMatch(/NAMED_REFUSALS = new Set\(\['SCHEME_DECISIONS_ARE_THE_AUTHORITYS'\]\)/);
    expect(page).toMatch(/t\.t\(`scm\.err\.\$\{errorKey\}`\)/);
    const actions = src('app/schemes/actions.ts');
    expect(actions).toMatch(/e instanceof SdkError \? \(e\.code \|\| 'save'\)/);
    for (const fn of ['verifyApplicationAction', 'approveApplicationAction', 'rejectApplicationAction', 'closeApplicationAction']) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      expect([fn, /catch \(e\) \{ fail\(e, id\); \}/.test(body.slice(0, 900))]).toEqual([fn, true]);
    }
  });
});
