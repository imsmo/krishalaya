import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-tenant/src/test/i18n-ar-parity.spec.ts · PC-56 RTL-1b-2 — the FULL Arabic parity gate (replaces RTL-1b-1's
// i18n-ar-scoped.spec.ts, which held `ar` to the shell and the two proof pages).
//
// Founder Q2 ("Draft all, opt-in only"): ar.ts is now a MACHINE DRAFT of EVERY en key. The four key sets are proven equal in
// i18n-parity.spec.ts (en/hi/gu/ar); this spec holds the Arabic-specific rules for every key: the header, non-empty values,
// every {placeholder} equal to en, Western digits only (founder Q4), arrows reversed (canon lang-ar/W128), translated rather
// than copied — with exactly two VERBATIM keys (the branding preview's Gujarati sample card, a left-to-right script).
// It still READS THE SOURCES: every key the console's code asks for by literal, template family or helper has an ar value.
import { en } from '../i18n/en';
import { ar } from '../i18n/ar';
import { tierKey } from '../features/notifications/inbox';
import { signalLabels } from '../features/swf/console';
import { Translator } from '@krishalaya/i18n';

const SRC = join(__dirname, '..');
const kEn = Object.keys(en);
const placeholders = (s: string) => [...s.matchAll(/\{[^{}]+\}/g)].map((m) => m[0]).sort();
const count = (s: string, ch: string) => s.split(ch).length - 1;

/** The ONLY keys whose ar value may equal en: the branding preview's Gujarati sample card (lead's call, brief §A). */
export const AR_VERBATIM: readonly string[] = ['br.preview.sample.gu', 'br.preview.sample.cta.gu'];

/** "A sentence copied, not translated": ar === en and en (placeholders removed) holds either two words in a row (a
 *  phrase, "Save draft") or a word in a non-Latin script (Gujarati, Devanagari … — copy that is not English and not
 *  Arabic). A lone word — a brand or code such as WhatsApp, Aadhaar, KYC — a symbol (Σ = 0), units, numbers and pure
 *  templates pass. */
export function copiedSentences(enCat: Record<string, string>, arCat: Record<string, string>, verbatim: readonly string[]): string[] {
  return Object.keys(enCat).filter((k) => {
    if (verbatim.includes(k) || arCat[k] !== enCat[k]) return false;
    const text = enCat[k].replace(/\{[^{}]+\}/g, ' ');
    const words = text.match(/[\p{L}\p{M}]{2,}/gu) ?? [];
    return /[\p{L}\p{M}]{2,}\s+[\p{L}\p{M}]{2,}/u.test(text) || words.some((w) => [...w].some((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)));
  });
}

describe('ar (RTL-1b-2): the machine draft covers the WHOLE console', () => {
  it('the file carries the MACHINE DRAFT header, and its SCOPE says the whole console with review still owed', () => {
    const head = readFileSync(join(SRC, 'i18n', 'ar.ts'), 'utf8').split('\n').slice(0, 14).join('\n');
    expect(head).toContain('Arabic (ar · dir rtl · Intl ar-AE-u-nu-latn) — MACHINE DRAFT, NOT REVIEWED.');
    expect(head).toContain('has NOT been read by a native Arabic reviewer');
    expect(head).toContain("`ar` stays 'machine-draft-pending-review' in @krishalaya/i18n, is served only when a person chooses it");
    expect(head).toContain('Founder review owed — PC56_TRACKER.md row "RTL-1 · Arabic copy');
    expect(head).toContain('Never translated: organisation names, file names, codes and IDs, phone digits, {placeholders}.');
    expect(head).toContain('Arrows inside a sentence are reversed');
    expect(head).toContain('SCOPE (RTL-1b-2): the WHOLE tenant console — every key of en.ts');
    expect(head).toContain('Founder review is still owed for all of it — tracker row "RTL-1 · Arabic copy review"');
  });

  it('every en key has an ar value, and ar has no key en lacks', () => {
    expect(kEn.length).toBeGreaterThan(13000);
    expect(kEn.filter((k) => !(k in ar))).toEqual([]);
    expect(Object.keys(ar).filter((k) => !(k in en))).toEqual([]);
  });

  it('ar.ts is in en.ts key order, one key per line, none declared twice (read as TEXT)', () => {
    const src = readFileSync(join(SRC, 'i18n', 'ar.ts'), 'utf8');
    const keys = [...src.matchAll(/^\s*(['"])([^'"]+)\1:/gm)].map((m) => m[2]);
    expect(keys.length).toBe(Object.keys(ar).length);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect(keys).toEqual(kEn);
  });

  it('no empty value', () => {
    expect(Object.entries(ar).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => k)).toEqual([]);
  });

  it('every {placeholder} survives for EVERY key: the ar value carries exactly the en value\'s tokens', () => {
    expect(kEn.filter((k) => placeholders(ar[k]).join() !== placeholders(en[k]).join())).toEqual([]);
    // the 4 rich() templates (React nodes interpolated, so the t.t(k, {…}) scan cannot see them) are named explicitly
    for (const k of ['limport.hash', 'limport.issueRow', 'limport.issueSuggestion', 'limport.templateNote']) {
      expect({ k, ar: placeholders(ar[k]) }).toEqual({ k, ar: placeholders(en[k]) });
    }
  });

  it('numerals are Western: no Arabic-Indic or Eastern Arabic-Indic digit in any ar value (founder Q4)', () => {
    expect(Object.entries(ar).filter(([, v]) => /[٠-٩۰-۹]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it('arrows inside a sentence are reversed: every en "→" is an ar "←" and vice versa (verbatim keys excepted)', () => {
    const bad = kEn.filter((k) => !AR_VERBATIM.includes(k) && (count(en[k], '→') !== count(ar[k], '←') || count(en[k], '←') !== count(ar[k], '→')));
    expect(bad).toEqual([]);
    expect(ar['rtl.span']).toBe('{from} ← {to}');
  });

  it('translated, not copied: no ar sentence equals en, except EXACTLY the two VERBATIM Gujarati sample keys', () => {
    expect(copiedSentences(en, ar, AR_VERBATIM)).toEqual([]);
    for (const k of AR_VERBATIM) expect({ k, v: ar[k] }).toEqual({ k, v: en[k] });   // kept exactly, arrow NOT reversed
    // the allowance is load-bearing and no wider: without it, the rule flags those two and nothing else
    expect(copiedSentences(en, ar, []).sort()).toEqual([...AR_VERBATIM].sort());
    // and the rule itself flags a copied sentence while passing codes, units and pure templates
    const probe = { a: 'Save draft', b: 'KYC: {status}', c: '{pct}% ({bps} bps)', d: 'WhatsApp', e: 'વેચો →', f: 'v{v} — {state}', g: 'Σ ≠ 0' };
    expect(copiedSentences(probe, { ...probe }, [])).toEqual(['a', 'e']);
  });
});

describe('ar: every key the console code asks for is drafted — read from the sources', () => {
  const isTest = (p: string) => /\/(test|test-render)\//.test(p) || /\.(spec|test)\.tsx?$/.test(p);
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', '.next', 'i18n'].includes(e.name)) walk(p, out); } else if (/\.tsx?$/.test(e.name) && !isTest(p)) out.push(p);
    }
    return out;
  };
  const SOURCES = walk(SRC);

  it('every literal key (t.t / pick / L / en[…]) and every templated family (t.t(`prefix${…}`)) has an ar value', () => {
    const literal = new Set<string>(); const prefixes = new Set<string>();
    for (const f of SOURCES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:\bt\.t|\bpick|\bL)\(\s*'([^']+)'/g)) literal.add(m[1]);
      for (const m of src.matchAll(/\ben\['([^']+)'\]/g)) literal.add(m[1]);
      for (const m of src.matchAll(/\bt\.t\(\s*`([^`$]*)\$\{/g)) if (m[1].length > 2) prefixes.add(m[1]);
    }
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(literal.size).toBeGreaterThan(3000);
    expect([...literal].filter((k) => k in en && !(k in ar))).toEqual([]);
    expect(prefixes.size).toBeGreaterThan(50);
    for (const p of prefixes) expect(Object.keys(en).filter((k) => k.startsWith(p) && !(k in ar))).toEqual([]);
  });

  it('the keys the shell picks through helpers are drafted and render Arabic (topbar tiers, the offline banner)', () => {
    for (const tier of ['critical', 'important', 'informational', 'promotional', null]) expect(ar[tierKey(tier)]).toBeDefined();
    const probe = new Translator('ar').register('en', en).register('ar', ar);
    const labels = signalLabels(probe);
    for (const v of [labels.banner, labels.detail, labels.needsSignal, labels.policy]) expect(Object.values(ar)).toContain(v);
  });
});
