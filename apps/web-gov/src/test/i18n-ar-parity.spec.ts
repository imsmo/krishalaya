import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-gov/src/test/i18n-ar-parity.spec.ts · PC-56 RTL-1f — the FULL Arabic parity gate for the government console (web-tenant's RTL-1b-2
// / web-ops's RTL-1e i18n-ar-parity.spec.ts, adapted).
//
// Founder Q2 ("Draft all, opt-in only"): ar.ts is a MACHINE DRAFT of EVERY en key. Key-set equality with en is also proven in i18n-parity.spec.ts;
// this spec holds the Arabic-specific rules for every key: the header, en.ts order, non-empty values, every {placeholder} equal to en, Western
// digits only (founder Q4), arrows reversed (canon lang-ar/W128), translated rather than copied — with NO verbatim exception needed (proven), and the 6 values ar shares with en NAMED —
// and it READS THE SOURCES: every key the gov console's code asks for by literal or by template family has an ar value.
import { en } from '../i18n/en';
import { ar } from '../i18n/ar';

const SRC = join(__dirname, '..');
const kEn = Object.keys(en);
const placeholders = (s: string) => [...s.matchAll(/\{[^{}]+\}/g)].map((m) => m[0]).sort();
const count = (s: string, ch: string) => s.split(ch).length - 1;

/** The keys whose ar value may equal en although the rule below would flag them: NONE in the gov console. */
export const AR_VERBATIM: readonly string[] = [];
/** Every key whose ar value equals en, NAMED (6): the dash "—", the phone placeholder "+91…", and four acronyms kept as written — the GOV
 *  mark ("GOV"), "PFMS" and "MGNREGA" (×2, the sidebar entry and the page title: the scheme's own name). None is a sentence; the rule below
 *  passes each, and this list pins the set exactly. */
export const AR_SAME: readonly string[] = ['common.dash', 'login.phonePlaceholder', 'gov1.chrome.pill', 'gov3.pfms.title', 'gov5.nav.mgnrega', 'gov5.mgnrega.title'];

/** "A sentence copied, not translated": ar === en and en (placeholders removed) holds either two words in a row (a phrase) or a word in a
 *  non-Latin script. A lone word — a brand or code such as AWB, KCC, HTTP — a symbol, units, numbers and pure templates pass. */
export function copiedSentences(enCat: Record<string, string>, arCat: Record<string, string>, verbatim: readonly string[]): string[] {
  return Object.keys(enCat).filter((k) => {
    if (verbatim.includes(k) || arCat[k] !== enCat[k]) return false;
    const text = enCat[k].replace(/\{[^{}]+\}/g, ' ');
    const words = text.match(/[\p{L}\p{M}]{2,}/gu) ?? [];
    return /[\p{L}\p{M}]{2,}\s+[\p{L}\p{M}]{2,}/u.test(text) || words.some((w) => [...w].some((ch) => /\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)));
  });
}

describe('ar (RTL-1f): the machine draft covers the WHOLE gov console', () => {
  it('the file carries the MACHINE DRAFT header, and its SCOPE says the whole gov console with review still owed', () => {
    const head = readFileSync(join(SRC, 'i18n', 'ar.ts'), 'utf8').split('\n').slice(0, 12).join('\n');
    expect(head).toContain('Arabic (ar · dir rtl · Intl ar-AE-u-nu-latn) — MACHINE DRAFT, NOT REVIEWED.');
    expect(head).toContain('has NOT been read by a native Arabic reviewer');
    expect(head).toContain("`ar` stays 'machine-draft-pending-review' in @krishalaya/i18n, is served only when a person chooses it");
    expect(head).toContain('Founder review owed — PC56_TRACKER.md row "RTL-1 · Arabic copy');
    expect(head).toContain('Never translated: organisation names, file names, codes and IDs, phone digits, {placeholders}.');
    expect(head).toContain('Arrows inside a sentence are reversed');
    expect(head).toContain('machine-translated from en.ts at PC-56 RTL-1f (2026-11-11)');
    expect(head).toContain('SCOPE (RTL-1f): the WHOLE government console (sign-in, the desk, schemes, applications, benefit payments, field visits, MGNREGA, access');
    expect(head).toContain('every key of en.ts, in en.ts key order (the lead\'s 1 drafted shard, 1,129 keys, plus lang.draft and rtl.draftBanner');
    expect(head).toContain('Founder review is still owed for all of it');
  });

  it('every en key has an ar value, and ar has no key en lacks', () => {
    expect(kEn.length).toBe(1131);   // ledger: 1,129 at aead5db3 + RTL-1f 2 (lang.draft, rtl.draftBanner)
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

  it("every {placeholder} survives for EVERY key: the ar value carries exactly the en value's tokens", () => {
    expect(kEn.filter((k) => placeholders(ar[k]).join() !== placeholders(en[k]).join())).toEqual([]);
  });

  it('numerals are Western: no Arabic-Indic or Eastern Arabic-Indic digit in any ar value (founder Q4)', () => {
    expect(Object.entries(ar).filter(([, v]) => /[٠-٩۰-۹]/.test(v)).map(([k]) => k)).toEqual([]);
  });

  it('arrows inside a sentence are reversed: every en "→" is an ar "←" and vice versa (the gov en catalogue holds ONE arrow — common.nextPage)', () => {
    expect(kEn.filter((k) => count(en[k], '→') !== count(ar[k], '←') || count(en[k], '←') !== count(ar[k], '→'))).toEqual([]);
    expect(kEn.filter((k) => /[→←]/.test(en[k]))).toEqual(['common.nextPage']);
    expect(en['common.nextPage'].endsWith('→')).toBe(true);
    expect(ar['common.nextPage'].endsWith('←')).toBe(true);
    expect(ar['common.nextPage']).not.toContain('→');
  });

  it('translated, not copied: no ar sentence equals en, and NO verbatim exception is needed', () => {
    expect(copiedSentences(en, ar, AR_VERBATIM)).toEqual([]);
    expect(copiedSentences(en, ar, [])).toEqual([]);
    // the partner4 precedent (survey G-4), on the TEXT around the placeholders: no ar value equals its en value when that text is longer than 12
    // characters (a pure template such as "{category} · {regNo}" is 3 characters of text)
    expect(kEn.filter((k) => en[k].replace(/\{[^{}]+\}/g, '').length > 12 && ar[k] === en[k])).toEqual([]);
    // the values ar shares with en are exactly the 6 named
    expect(kEn.filter((k) => ar[k] === en[k])).toEqual(AR_SAME);
    // and the rule itself flags a copied sentence while passing codes, units and pure templates
    const probe = { a: 'Save draft', b: 'AWB', c: '{title} · {qty} {unit}', d: 'KCC', e: 'વેચો →', f: '{ms} ms', g: '—' };
    expect(copiedSentences(probe, { ...probe }, [])).toEqual(['a', 'e']);
  });

  it('the two keys RTL-1f added (the switcher\'s draft tag, the banner) are Arabic — web-tenant\'s, web-partner\'s and web-ops\'s words', () => {
    expect(ar['lang.draft']).toBe('مسودة آلية');
    expect(ar['rtl.draftBanner']).toBe('هذا النص العربي مسودة آلية ولم تتم مراجعته.');
    expect(en['lang.draft']).toBe('machine draft');
    expect(en['rtl.draftBanner']).toBe('This Arabic text is a machine draft and has not been reviewed.');
  });

  it('the chrome sentence naming the three live languages is unchanged in en (Arabic is a draft, not a live language) and stays three in ar', () => {
    expect(en['gov1.chrome.language']).toBe('Each person reads this console in the language they choose: English, हिन्दी or ગુજરાતી.');
    for (const name of ['English', 'हिन्दी', 'ગુજરાતી']) expect([name, ar['gov1.chrome.language'].includes(name)]).toEqual([name, true]);
    expect(ar['gov1.chrome.language']).not.toContain('العربية');
  });
});

describe('ar: every key the gov console asks for is drafted — read from the sources', () => {
  const isTest = (p: string) => /\/(test|test-render)\//.test(p) || /\.(spec|test)\.tsx?$/.test(p);
  const walk = (d: string, out: string[] = []): string[] => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!['node_modules', '.next', 'i18n'].includes(e.name)) walk(p, out); } else if (/\.tsx?$/.test(e.name) && !isTest(p)) out.push(p);
    }
    return out;
  };
  const SOURCES = walk(SRC);

  it('every literal key (t.t / en[…] / a key: field) and every templated family (t.t(`prefix${…}`)) has an ar value', () => {
    const literal = new Set<string>(); const prefixes = new Set<string>();
    for (const f of SOURCES) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\bt\.t\(\s*'([^']+)'/g)) literal.add(m[1]);
      for (const m of src.matchAll(/\ben\['([^']+)'\]/g)) literal.add(m[1]);
      for (const m of src.matchAll(/\bkey:\s*'([^']+)'/g)) literal.add(m[1]);
      for (const m of src.matchAll(/\bt\.t\(\s*`([^`$]*)\$\{/g)) if (m[1].length > 2) prefixes.add(m[1]);
    }
    expect(SOURCES.length).toBeGreaterThan(50);
    expect(literal.size).toBeGreaterThan(400);
    expect([...literal].filter((k) => k in en && !(k in ar))).toEqual([]);
    expect(prefixes.size).toBeGreaterThan(5);
    for (const p of prefixes) expect(Object.keys(en).filter((k) => k.startsWith(p) && !(k in ar))).toEqual([]);
  });
});
