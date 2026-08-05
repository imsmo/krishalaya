// apps/web-gov/src/test/i18n-parity.spec.ts · the parity gate (PC-30 OW-0): every key exists in all three
// catalogs, no extras, no dupes — same law as every other console.
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

describe('i18n parity (en/hi/gu)', () => {
  const kEn = Object.keys(en).sort();
  it('hi mirrors en exactly', () => expect(Object.keys(hi).sort()).toEqual(kEn));
  it('gu mirrors en exactly', () => expect(Object.keys(gu).sort()).toEqual(kEn));
  it('no empty values anywhere', () => {
    for (const cat of [en, hi, gu]) for (const [k, v] of Object.entries(cat)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
      void k;
    }
  });
});
