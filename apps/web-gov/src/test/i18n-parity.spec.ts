// apps/web-gov/src/test/i18n-parity.spec.ts · the parity gate (PC-30 OW-0): every key exists in all three
// catalogs, no extras, no dupes — same law as every other console.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';

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

  // ── PC-56 RTL-1f · ×4: the Arabic machine draft (founder Q1 "Draft all, opt-in only") joins the gate. Added tests only — the three above
  // are unchanged. i18n-ar-parity.spec.ts holds the Arabic-specific rules (header, order, digits, arrows, translated-not-copied).
  it('ar mirrors en exactly (RTL-1f)', () => expect(Object.keys(ar).sort()).toEqual(kEn));
  it('no empty value in ar (RTL-1f)', () => {
    expect(Object.entries(ar).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)).toEqual([]);
  });
  it('no key is declared twice in any catalogue file (RTL-1f, read as TEXT)', () => {
    for (const l of ['en', 'hi', 'gu', 'ar']) {
      const src = readFileSync(join(__dirname, '..', 'i18n', `${l}.ts`), 'utf8');
      const keys = [...src.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
      expect([l, keys.length]).toEqual([l, kEn.length]);
      expect([l, keys.filter((k, i) => keys.indexOf(k) !== i)]).toEqual([l, []]);
    }
  });
  it('every {placeholder} is equal on EVERY key in all four catalogues (RTL-1f)', () => {
    const ph = (s: string) => [...s.matchAll(/\{[^{}]+\}/g)].map((m) => m[0]).sort().join();
    for (const [name, cat] of Object.entries({ hi, gu, ar })) expect([name, kEn.filter((k) => ph(cat[k]) !== ph(en[k]))]).toEqual([name, []]);
  });
  it('the two keys RTL-1f added are in all four catalogues, each in its own language', () => {
    for (const k of ['lang.draft', 'rtl.draftBanner']) {
      const vals = [en[k], hi[k], gu[k], ar[k]];
      expect(vals.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
      expect(new Set(vals).size).toBe(4);
    }
  });
});
