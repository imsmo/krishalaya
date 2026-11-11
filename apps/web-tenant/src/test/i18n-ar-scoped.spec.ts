import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-tenant/src/test/i18n-ar-scoped.spec.ts · PC-56 RTL-1b-1 — the SCOPED Arabic parity gate.
//
// Founder Q2 ("Draft all, opt-in only"), self-split per survey §4: RTL-1b-1 drafts `ar` for the console SHELL and the two
// PROOF pages (/listings, /listings/import); every other key falls back to English through the Translator. This spec is
// the "fail on a missing `ar` key" rule of the en/hi/gu parity spec, held to exactly those namespaces — it does NOT relax
// the en/hi/gu gate (test/i18n-parity.spec.ts, unchanged). RTL-1b-2 drafts the rest and replaces this with full parity ×4.
//
// It also reads the shell and proof-page SOURCES, so "every key those render" is checked against the code, not a list
// someone remembered: a new t.t('…') on one of those files outside the scope turns this red until `ar` has it.
import { en } from '../i18n/en';
import { ar } from '../i18n/ar';
import { tierKey } from '../features/notifications/inbox';
import { signalLabels } from '../features/swf/console';
import { Translator } from '@krishalaya/i18n';

/** The RTL-1b-1 scope. An entry ending in '.' is a namespace prefix; any other entry is one exact key. */
export const AR_SCOPE: readonly string[] = [
  'nav.', 'common.', 'lang.', 'rtl.',                                                                   // the shell
  'notif.title', 'notif.act.', 'notif.inapp.', 'notif.day.', 'notif.bell.', 'notif.tier.', 'swf.signal.', // topbar bell + offline banner
  'listings.', 'lc.', 'listingNew.created',                                                             // /listings
  'limport.', 'import.',                                                                                // /listings/import (+ shared import.*)
];
const inScope = (k: string) => AR_SCOPE.some((p) => (p.endsWith('.') ? k.startsWith(p) : k === p));

const SRC = join(__dirname, '..');
/** The files that draw the shell and the two proof pages (and the helpers they call that pick keys). */
const RENDERING_FILES = [
  'app/layout.tsx', 'app/error.tsx', 'app/not-found.tsx', 'app/loading.tsx',
  'components/Sidebar.tsx', 'components/ConsoleTopbar.tsx', 'components/LocaleSwitcher.tsx', 'components/OnlineGuard.tsx', 'components/ListingsTable.tsx',
  'app/listings/page.tsx', 'app/listings/loading.tsx', 'app/listings/import/page.tsx', 'features/people/import.ts',
];

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const enScoped = Object.keys(en).filter(inScope).sort();

describe('ar (RTL-1b-1 scope): the machine draft covers the shell and the two proof pages', () => {
  it('the file carries the MACHINE DRAFT header, verbatim from the survey', () => {
    const head = readFileSync(join(SRC, 'i18n', 'ar.ts'), 'utf8').split('\n').slice(0, 6).join('\n');
    expect(head).toContain("Arabic (ar · dir rtl · Intl ar-AE-u-nu-latn) — MACHINE DRAFT, NOT REVIEWED.");
    expect(head).toContain('has NOT been read by a native Arabic reviewer');
    expect(head).toContain("`ar` stays 'machine-draft-pending-review' in @krishalaya/i18n, is served only when a person chooses it");
    expect(head).toContain('Founder review owed — PC56_TRACKER.md row "RTL-1 · Arabic copy');
    expect(head).toContain('Never translated: organisation names, file names, codes and IDs, phone digits, {placeholders}.');
    expect(head).toContain('Arrows inside a sentence are reversed');
  });

  it('every en key in scope has an ar value (a missing key fails, exactly as for hi/gu)', () => {
    expect(enScoped.length).toBeGreaterThan(200);
    expect(enScoped.filter((k) => !(k in ar))).toEqual([]);
  });

  it('ar carries nothing outside en and nothing outside the scope (1b-2 widens the scope, not a stray key)', () => {
    expect(Object.keys(ar).filter((k) => !(k in en))).toEqual([]);
    expect(Object.keys(ar).filter((k) => !inScope(k))).toEqual([]);
  });

  it('no empty value; no key declared twice (read as TEXT — a duplicate is invisible to the object)', () => {
    for (const v of Object.values(ar)) { expect(typeof v).toBe('string'); expect(v.length).toBeGreaterThan(0); }
    const src = readFileSync(join(SRC, 'i18n', 'ar.ts'), 'utf8');
    const keys = [...src.matchAll(/^\s*(['"])([^'"]+)\1:/gm)].map((m) => m[2]);
    expect(keys.length).toBe(Object.keys(ar).length);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('every {placeholder} survives: the ar value carries exactly the en value\'s tokens', () => {
    const bad = enScoped.filter((k) => k in ar && placeholders(ar[k]).join() !== placeholders(en[k]).join());
    expect(bad).toEqual([]);
  });

  it('it is translated, not copied: no ar value equals its en value when the en value is longer than 12 characters', () => {
    expect(enScoped.filter((k) => en[k].length > 12 && ar[k] === en[k])).toEqual([]);
  });

  it('arrows inside a sentence are reversed (canon lang-ar/W128): no "→" in any ar value', () => {
    expect(Object.entries(ar).filter(([, v]) => v.includes('→')).map(([k]) => k)).toEqual([]);
    for (const k of enScoped.filter((x) => en[x].includes('→'))) expect(ar[k]).toContain('←');
  });

  it('numerals are Western: no Arabic-Indic or Eastern Arabic-Indic digit in any ar value', () => {
    expect(Object.entries(ar).filter(([, v]) => /[٠-٩۰-۹]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it('every key the shell and the proof pages render is in scope — read from their sources', () => {
    const literal = new Set<string>(); const prefixes = new Set<string>();
    for (const f of RENDERING_FILES) {
      const src = readFileSync(join(SRC, f), 'utf8');
      for (const m of src.matchAll(/(?:\bt\.t|\bpick)\(\s*'([^']+)'/g)) literal.add(m[1]);
      for (const m of src.matchAll(/\ben\['([^']+)'\]/g)) literal.add(m[1]);
      for (const m of src.matchAll(/\bt\.t\(\s*`([^`$]*)\$\{/g)) prefixes.add(m[1]);
    }
    expect(literal.size).toBeGreaterThan(80);
    const missing = [...literal].filter((k) => !(k in ar) && k in en);
    const outOfScope = [...literal].filter((k) => !inScope(k));
    expect({ missing, outOfScope }).toEqual({ missing: [], outOfScope: [] });
    // a templated key (`lc.tab.${s}`) draws a family: every en key in that family must be drafted
    expect(prefixes.size).toBeGreaterThan(0);
    for (const p of prefixes) expect(Object.keys(en).filter((k) => k.startsWith(p) && !(k in ar))).toEqual([]);
  });

  it('the keys the shell picks through helpers are drafted too (topbar tiers, the offline banner)', () => {
    for (const tier of ['critical', 'important', 'informational', 'promotional', null]) expect(ar[tierKey(tier)]).toBeDefined();
    const probe = new Translator('ar').register('en', en).register('ar', ar);
    const labels = signalLabels(probe);
    for (const v of [labels.banner, labels.detail, labels.needsSignal, labels.policy]) expect(Object.values(ar)).toContain(v);
  });
});
