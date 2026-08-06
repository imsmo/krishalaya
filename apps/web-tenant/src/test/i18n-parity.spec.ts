import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-tenant/src/test/i18n-parity.spec.ts · the parity gate (PC-55 B8). This console had ~1,000 keys across three
// catalogues and NO gate: a key added to en alone would render as its own key-string (or fall back to English) in
// Hindi and Gujarati, and nobody would find out until a farmer did. Rule Zero — nothing ships that blocks a
// language — so the gate is the same one web-gov and web-ops already carry.
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

describe('i18n parity (en/hi/gu)', () => {
  const kEn = Object.keys(en).sort();
  it('hi mirrors en exactly', () => expect(Object.keys(hi).sort()).toEqual(kEn));
  it('gu mirrors en exactly', () => expect(Object.keys(gu).sort()).toEqual(kEn));
  it('no empty values anywhere', () => {
    // an empty string is indistinguishable from a missing translation, and an empty label is silence to a screen
    // reader — if a slot genuinely needs no text, the page should omit it rather than the catalogue carry a blank.
    for (const cat of [en, hi, gu]) for (const [k, v] of Object.entries(cat)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
      void k;
    }
  });

  // A DUPLICATE key is invisible to the set comparisons above — the later literal silently wins in every catalogue,
  // so the key sets still match while a label renders the wrong string (this happened once, to the OW-7 breach-window
  // tabs). The catalogues are therefore also read as TEXT, where a collapse is still detectable.
  it('no key is declared twice in any catalog', () => {
    for (const f of ['en', 'hi', 'gu'] as const) {
      const src = readFileSync(join(__dirname, '..', 'i18n', `${f}.ts`), 'utf8');
      const keys = [...src.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
      const seen = new Set<string>();
      const dupes = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
      expect(dupes).toEqual([]);
    }
  });

  // PC-55 B8 — the PLACEHOLDER gate. Parity proves a key exists in all three languages; it says nothing about
  // whether the string contains the {token} the caller interpolates. A page that renders
  // `t.t('cod.daysHeld', { n })` against a catalogue that says '{days} days' prints the brace literally — and it
  // does so ONLY in the languages nobody on the team reads, which is exactly the bug this repo must not ship
  // (three real mismatches were found this way, in en/hi/gu at once). So: read the app's own sources, find every
  // interpolated call, and require the token in all three catalogues.
  it('every interpolated key carries its {token} in all three languages', () => {
    const dir = join(__dirname, '..');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { if (e.name !== 'i18n' && e.name !== 'test' && e.name !== 'node_modules') walk(p); }
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(dir);

    const cats: Array<[string, Record<string, string>]> = [['en', en], ['hi', hi], ['gu', gu]];
    const problems: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const re = /t\.t\(\s*'([^']+)'\s*,\s*\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const key = m[1];
        // scan the balanced object literal that starts at the '{' the regex just consumed
        let depth = 1, i = re.lastIndex;
        while (i < src.length && depth > 0) {
          const c = src[i];
          if (c === '{') depth++;
          else if (c === '}') depth--;
          i++;
        }
        const body = src.slice(re.lastIndex, i - 1);
        // top-level `name:` pairs only (skip anything nested inside calls/objects)
        let d2 = 0;
        const names: string[] = [];
        let token = '';
        for (let j = 0; j < body.length; j++) {
          const c = body[j];
          if ('([{'.includes(c)) d2++;
          else if (')]}'.includes(c)) d2--;
          else if (d2 === 0 && c === ':') { const t = token.trim(); if (/^[A-Za-z_$][\w$]*$/.test(t)) names.push(t); token = ''; continue; }
          else if (d2 === 0 && c === ',') { token = ''; continue; }
          if (d2 === 0) token += c;
        }
        for (const [lang, cat] of cats) {
          const s = cat[key];
          if (s === undefined) { problems.push(`${key}: missing from ${lang}`); continue; }
          for (const n of names) if (!s.includes(`{${n}}`)) problems.push(`${key} (${lang}) is missing {${n}}`);
        }
      }
    }
    expect([...new Set(problems)].sort()).toEqual([]);
  });
});
