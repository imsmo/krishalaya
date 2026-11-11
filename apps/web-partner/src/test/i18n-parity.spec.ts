// apps/web-partner/src/test/i18n-parity.spec.ts · PC-56 RTL-1d — the partner console's FIRST app-wide catalogue parity gate (survey_rtl1 C-2:
// until now parity lived only in the per-wave key lists of partner1…6-refusals.spec). Four catalogues: en (the source of truth), hi, gu, ar.
//
// hi and gu are PARTIAL by design (their headers say so, PARTNER-0): 378 keys that predate PARTNER-0 (nav, common, notice, login, dash, fleet,
// net, ship, notif, consents) are still English-only there and fall back to en inside the shared Translator. That backfill is its own named
// wave, so this gate does NOT pretend the sets are equal: it pins the gap EXACTLY (the same 378 keys in hi and gu, counted by namespace) — a key
// that goes missing from hi/gu, or one that is backfilled, turns it red until the ledger below is updated. On every key hi/gu DO hold: it is an
// en key, it is non-empty, and its {placeholders} equal en's. ar (the RTL-1d machine draft) is FULL: it mirrors en exactly.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';

const vars = (s: string) => [...s.matchAll(/\{[^{}]+\}/g)].map((m) => m[0]).sort().join('|');
const kEn = Object.keys(en);
const CATS = { hi, gu, ar } as const;

/** The hi/gu gap at RTL-1d, per namespace (survey_rtl1 C-2) — 378 keys, identical in hi and gu. */
const PARTIAL_GAP: Readonly<Record<string, number>> = { nav: 23, common: 15, notice: 4, login: 8, dash: 1, fleet: 92, net: 117, ship: 82, notif: 22, consents: 14 };

describe('i18n parity (en · hi · gu · ar) — app-wide', () => {
  it('en has no empty value; no catalogue declares a key twice (read as text — an object literal silently keeps the last)', () => {
    expect(kEn.length).toBeGreaterThan(2200);
    expect(kEn.filter((k) => en[k].trim() === '')).toEqual([]);
    for (const code of ['en', 'hi', 'gu', 'ar']) {
      const keys = [...readFileSync(join(__dirname, '..', 'i18n', `${code}.ts`), 'utf8').matchAll(/^\s*(['"])([^'"]+)\1:/gm)].map((m) => m[2]);
      expect([code, keys.filter((k, i) => keys.indexOf(k) !== i)]).toEqual([code, []]);
    }
  });

  it('hi and gu hold no key en lacks', () => {
    for (const [code, cat] of Object.entries({ hi, gu })) expect([code, Object.keys(cat).filter((k) => !(k in en))]).toEqual([code, []]);
  });

  it('hi and gu: no empty value, and every {placeholder} equals en on EVERY key they hold', () => {
    for (const [code, cat] of Object.entries({ hi, gu })) {
      expect([code, Object.entries(cat).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)]).toEqual([code, []]);
      expect([code, Object.keys(cat).filter((k) => vars(cat[k]) !== vars(en[k]))]).toEqual([code, []]);
    }
  });

  it('hi and gu are PARTIAL by the same 378 keys, pinned by namespace (the backfill is its own wave)', () => {
    const missHi = kEn.filter((k) => !(k in hi));
    const missGu = kEn.filter((k) => !(k in gu));
    expect(missGu).toEqual(missHi);
    const by: Record<string, number> = {};
    for (const k of missHi) by[k.split('.')[0]] = (by[k.split('.')[0]] ?? 0) + 1;
    expect(by).toEqual(PARTIAL_GAP);
    expect(missHi.length).toBe(378);
    // every key added since PARTNER-0 is at parity — the gap is ONLY the pre-PARTNER-0 namespaces
    expect(kEn.filter((k) => /^(partner|partner[1-6]|lang|rtl)\./.test(k) && (!(k in hi) || !(k in gu)))).toEqual([]);
  });

  it('ar mirrors en EXACTLY: the same keys, no empty value, every {placeholder} equal', () => {
    expect(kEn.filter((k) => !(k in ar))).toEqual([]);
    expect(Object.keys(ar).filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(ar).length).toBe(kEn.length);
    expect(Object.entries(ar).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)).toEqual([]);
    expect(kEn.filter((k) => vars(ar[k]) !== vars(en[k]))).toEqual([]);
  });

  it('the gate itself fires: a planted missing / extra / renamed-placeholder key is caught', () => {
    const probeEn = { a: 'Hello {name}', b: 'Bye' };
    const bad = { a: 'Namaste {nm}', c: 'x' } as Record<string, string>;
    expect(Object.keys(probeEn).filter((k) => !(k in bad))).toEqual(['b']);
    expect(Object.keys(bad).filter((k) => !(k in probeEn))).toEqual(['c']);
    expect(vars(bad.a) === vars(probeEn.a)).toBe(false);
    expect(Object.keys(CATS)).toEqual(['hi', 'gu', 'ar']);
  });
});
