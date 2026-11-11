import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-ops/src/test/i18n-parity.spec.ts · the parity gate (PC-30 OW-0): every key exists in all three
// catalogs, no extras, no dupes — same law as every other console.
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

  // PC-55 B4: a DUPLICATE key is invisible to the parity checks above — the later literal silently wins in every
  // catalogue, so the sets still match while a label renders the wrong string (this happened once, to the OW-7
  // breach-window tabs). The catalogues are therefore also read as TEXT, where a collapse is still detectable.
  it('no key is declared twice in any catalog', () => {
    const files = ['en', 'hi', 'gu'] as const;
    for (const f of files) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const src = readFileSync(join(__dirname, '..', 'i18n', `${f}.ts`), 'utf8');
      const keys = [...src.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
      const seen = new Set<string>();
      const dupes = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
      expect(dupes).toEqual([]);
    }
  });

  // ── PC-56 RTL-1e · ×4: the Arabic machine draft (founder Q1 "Draft all, opt-in only") joins the gate. Added tests only — the three above
  // are unchanged. i18n-ar-parity.spec.ts holds the Arabic-specific rules (header, order, digits, arrows, translated-not-copied).
  it('ar mirrors en exactly (RTL-1e)', () => expect(Object.keys(ar).sort()).toEqual(kEn));
  it('no empty value in ar (RTL-1e)', () => {
    expect(Object.entries(ar).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)).toEqual([]);
  });
  it('no key is declared twice in ar.ts (RTL-1e, read as TEXT)', () => {
    const src = readFileSync(join(__dirname, '..', 'i18n', 'ar.ts'), 'utf8');
    const keys = [...src.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
    expect(keys.length).toBe(Object.keys(ar).length);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });
  it('every {placeholder} is equal on EVERY key in all four catalogues (RTL-1e)', () => {
    const ph = (s: string) => [...s.matchAll(/\{[^{}]+\}/g)].map((m) => m[0]).sort().join();
    for (const [name, cat] of Object.entries({ hi, gu, ar })) expect([name, kEn.filter((k) => ph(cat[k]) !== ph(en[k]))]).toEqual([name, []]);
  });
  it('the two keys RTL-1e added are in all four catalogues, each in its own language', () => {
    for (const k of ['lang.draft', 'rtl.draftBanner']) {
      const vals = [en[k], hi[k], gu[k], ar[k]];
      expect(vals.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
      expect(new Set(vals).size).toBe(4);
    }
  });
});
