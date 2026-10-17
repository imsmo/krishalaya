// apps/web-storefront/src/test/edge-words.spec.ts · PC-56 STORE-SWEEP-b · C1 / C3 (founder D4, survey E4) — THE MIDDLEWARE'S WORDS ARE THE CATALOGUES'.
// lib/edge-words.ts carries three sentences × three languages as LITERALS (the Edge runtime cannot load lib/i18n); each must equal the catalogue's
// `sweep.edge.*` value, so a translation fixed in one place and not the other turns this red. And the page is the person's language (`kv_lang`, else
// the default), says what happened, that nothing is affected and what to do, carries the code in small print — and NO brand and NO organisation name.
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { EDGE_WORDS, EDGE_WORD_KEYS, edgeHeaders, edgeHtml, edgeLang } from '../lib/edge-words';

const CATS = { en, hi, gu } as const;

describe('STORE-SWEEP-b · the edge words', () => {
  it('three keys × three languages, each equal to the catalogue\'s sweep.edge.* value', () => {
    expect([...EDGE_WORD_KEYS]).toEqual(['lookupFailed', 'noOrganisation', 'tryAgain']);
    expect(Object.keys(EDGE_WORDS).sort()).toEqual(['en', 'gu', 'hi']);
    for (const [l, cat] of Object.entries(CATS)) for (const k of EDGE_WORD_KEYS) {
      expect([l, k, EDGE_WORDS[l as 'en'][k]]).toEqual([l, k, (cat as Record<string, string>)[`sweep.edge.${k}`]]);
    }
    expect(Object.keys(en).filter((k) => k.startsWith('sweep.edge.')).sort()).toEqual(EDGE_WORD_KEYS.map((k) => `sweep.edge.${k}`).sort());
  });
  it('the language: the kv_lang cookie, else the default; a code with no edge words falls back to English', () => {
    expect(edgeLang('hi')).toEqual({ code: 'hi', dir: 'ltr' });
    expect(edgeLang('gu')).toEqual({ code: 'gu', dir: 'ltr' });
    expect(edgeLang(undefined)).toEqual({ code: 'en', dir: 'ltr' });
    expect(edgeLang('xx')).toEqual({ code: 'en', dir: 'ltr' });
    expect(edgeLang('hi-IN').code).toBe('hi');
  });
  it.each(['en', 'hi', 'gu'] as const)('%s: the 503 and the 404 pages — lang/dir, the words, the code in small print, no brand, no organisation', (l) => {
    const u = edgeHtml('unavailable', l);
    expect(u.startsWith('<!doctype html><html lang="' + l + '" dir="ltr">')).toBe(true);
    expect(u).toContain(EDGE_WORDS[l].lookupFailed);
    expect(u).toContain(EDGE_WORDS[l].tryAgain);
    expect(u).toContain('<small>503</small>');
    const n = edgeHtml('unknown_host', l);
    expect(n).toContain(EDGE_WORDS[l].noOrganisation);
    expect(n).not.toContain(EDGE_WORDS[l].tryAgain);
    expect(n).toContain('<small>404</small>');
    for (const h of [u, n]) {
      const words = h.replace(/<[^>]+>/g, ' ');                       // the visible words (the doctype carries a "!")
      for (const lit of [PLATFORM_BRAND.name, PLATFORM_BRAND.platformStoreName, 'कृषालय', 'કૃષાલય', 'Oops', '!']) expect([lit, words.includes(lit)]).toEqual([lit, false]);
    }
  });
  it('the headers: text/html utf-8, never cached; the 503 keeps retry-after', () => {
    expect(edgeHeaders('unavailable')).toEqual({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '10' });
    expect(edgeHeaders('unknown_host')).toEqual({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  });
  it('Edge-safe: the module imports nothing from lib/i18n, server-only or next/headers', () => {
    const src = readFileSync(join(__dirname, '..', 'lib', 'edge-words.ts'), 'utf8').split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    expect(src).toMatch(/@krishalaya\/i18n/);
    expect(src).not.toMatch(/from '\.\/i18n'|from '\.\.\/lib\/i18n'|server-only|next\/headers|\.\.\/i18n\/(en|hi|gu)/);
  });
});
