// apps/web-ops/src/test/kiosk-form.spec.ts · OW-1 kiosk form validation.
// NAMED UPDATE (PC-56 OPS-1c · F-19, Rule Zero): the language allow-list is now the platform REGISTRY's live set (`@krishalaya/i18n`
// LANGUAGES), never a literal — pinned EQUAL to the registry (order included, so a literal ['hi','gu','en'] put back fails), an unknown or a
// not-yet-live registry code refused, and the source carries no quoted language array. The OW-1 cases are kept unchanged.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES, COMING_SOON_LANGUAGES } from '@krishalaya/i18n';
import { buildFarmer, KIOSK_LANGS, KIOSK_LANGUAGES } from '../features/kiosk/form';

describe('features/kiosk/form (OW-1)', () => {
  it('normalises phone (strips spaces/hyphens), E.164-ish 8–15 digits', () => {
    expect(buildFarmer({ phone: '+91 90990 12340', fullName: '', languageCode: '' }))
      .toEqual({ ok: true, value: { phone: '+919099012340' } });
    expect(buildFarmer({ phone: '12', fullName: '', languageCode: '' })).toEqual({ ok: false, error: 'phone' });
    expect(buildFarmer({ phone: 'abc', fullName: '', languageCode: '' })).toEqual({ ok: false, error: 'phone' });
  });
  it('optional name ≤120 + platform language only', () => {
    expect(buildFarmer({ phone: '9099012340', fullName: ' Ramesh Patel ', languageCode: 'gu' }))
      .toEqual({ ok: true, value: { phone: '9099012340', fullName: 'Ramesh Patel', languageCode: 'gu' } });
    expect(buildFarmer({ phone: '9099012340', fullName: 'x'.repeat(121), languageCode: '' })).toEqual({ ok: false, error: 'name' });
    expect(buildFarmer({ phone: '9099012340', fullName: '', languageCode: 'fr' })).toEqual({ ok: false, error: 'lang' });
    expect(KIOSK_LANGS).toContain('hi');
  });
});

describe('PC-56 OPS-1c · F-19 · the kiosk\'s languages come from the registry', () => {
  it('KIOSK_LANGS equals the registry\'s live codes exactly, in registry order; KIOSK_LANGUAGES is the registry itself', () => {
    expect([...KIOSK_LANGS]).toEqual(LANGUAGES.map((l) => l.code));
    expect(KIOSK_LANGUAGES).toBe(LANGUAGES);
  });
  it('every live registry code is accepted; an unknown code, and a registered-but-not-live code, are refused by name', () => {
    for (const l of LANGUAGES) expect([l.code, buildFarmer({ phone: '9099012340', fullName: '', languageCode: l.code }).ok]).toEqual([l.code, true]);
    for (const code of ['fr', 'xx', 'HI', 'hi-IN', '<script>', ...COMING_SOON_LANGUAGES.map((l) => l.code)]) {
      expect([code, buildFarmer({ phone: '9099012340', fullName: '', languageCode: code })]).toEqual([code, { ok: false, error: 'lang' }]);
    }
  });
  it('the source names no language list of its own (no quoted two-letter array)', () => {
    const src = readFileSync(join(__dirname, '..', 'features', 'kiosk', 'form.ts'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(/\[\s*'[a-z]{2}'\s*,/.test(src)).toBe(false);
    expect(/\[\s*'[a-z]{2}'\s*,/.test("export const KIOSK_LANGS = ['hi', 'gu', 'en'] as const;")).toBe(true);   // control
    expect(src).toMatch(/from '@krishalaya\/i18n'/);
  });
});
