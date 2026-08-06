import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-ops/src/test/i18n-parity.spec.ts · the parity gate (PC-30 OW-0): every key exists in all three
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
});
