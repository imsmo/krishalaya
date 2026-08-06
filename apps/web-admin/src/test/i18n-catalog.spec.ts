import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
// apps/web-admin/src/test/i18n-catalog.spec.ts · catalogue gates for the god-mode console (PC-56 ADMIN-1).
// web-admin is EN-ONLY BY DESIGN (lib/i18n.ts: an internal staff realm, one locale, no switcher), so there is no
// three-language parity to check here — inventing hi/gu files nobody can switch to would be theatre. What DOES apply:
//   • no duplicate key (a later literal silently wins, so a label renders the wrong string while nothing looks wrong);
//   • no empty value (indistinguishable from a missing translation, and silence to a screen reader);
//   • every `t.t(key, { token })` call site in this app must find its {token} in the catalogue — three real
//     mismatches of exactly this kind were found in web-tenant, where they printed a raw brace on screen.
import { en } from '../i18n/en';

describe('admin catalogue', () => {
  it('has no empty values', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(typeof v).toBe('string');
      expect((v as string).length).toBeGreaterThan(0);
      void k;
    }
  });

  it('declares no key twice', () => {
    const src = readFileSync(join(__dirname, '..', 'i18n', 'en.ts'), 'utf8');
    const keys = [...src.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
    const seen = new Set<string>();
    const dupes = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(dupes).toEqual([]);
  });
  // The PLACEHOLDER gate (ported from web-tenant, PC-55 B8). Parity proves a key exists in all three languages; it says nothing about
  // whether the string contains the {token} the caller interpolates. A page that renders
  // `t.t('cod.daysHeld', { n })` against a catalogue that says '{days} days' prints the brace literally — and it
  // does so ONLY in the languages nobody on the team reads, which is exactly the bug this repo must not ship
  // (three real mismatches were found this way, in en/hi/gu at once). So: read the app's own sources, find every
  // interpolated call, and require the token in the catalogue.
  it('every interpolated key carries its {token}', () => {
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

    const cats: Array<[string, Record<string, string>]> = [['en', en]];
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
