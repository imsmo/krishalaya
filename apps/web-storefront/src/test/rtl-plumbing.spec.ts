// apps/web-storefront/src/test/rtl-plumbing.spec.ts · PC-56 RTL-1c — Arabic is reachable ONLY by a person's choice (founder Q1 "opt-in only"),
// everywhere the storefront resolves a language outside lib/i18n (which the render proof covers): `?lang=` / the language route
// (`pickChosenLang`), the account language (never PATCHed to a preview language), the client boundaries (`cookieLang` / `boundaryWords`), and
// the middleware's own Edge pages (`edgeLang` / `edgeHtml` — their Arabic literals pinned to the ar catalogue).
import { pickChosenLang, pickUrlLang } from '../lib/locale-url';
import { langRouteDecision } from '../features/store4c/preferences';
import { boundaryWords, cookieLang } from '../features/sweep/boundary-words';
import { EDGE_DRAFT_BANNER_EN, EDGE_WORDS, EDGE_WORDS_PREVIEW, EDGE_WORD_KEYS, edgeHtml, edgeLang } from '../lib/edge-words';
import { en } from '../i18n/en';
import { ar } from '../i18n/ar';

describe('the chosen language (?lang= and the language route)', () => {
  it('a live code as before; the preview `ar` because choosing it IS the explicit act; anything else null', () => {
    expect(pickChosenLang('hi')).toBe('hi');
    expect(pickChosenLang('ar')).toBe('ar');
    expect(pickChosenLang('ar-AE')).toBe('ar');
    for (const raw of ['ur', 'bn', 'xx', '', null, undefined]) expect(pickChosenLang(raw)).toBeNull();
    expect(pickUrlLang(new URL('https://s.test/anand-fpo?lang=ar'))).toBe('ar');
    expect(pickUrlLang(new URL('https://s.test/?lang=ur'))).toBeNull();
  });
  it('choosing Arabic never writes it to the account (the cookie only) — a live language still does', () => {
    expect(langRouteDecision({ lang: 'ar', signedIn: true })).toEqual({ cookie: 'ar', patchAccount: false });
    expect(langRouteDecision({ lang: 'gu', signedIn: true })).toEqual({ cookie: 'gu', patchAccount: true });
  });
});

describe('the boundaries answer in Arabic under an Arabic cookie', () => {
  it('cookieLang reads `ar` as chosen; boundaryWords prints the ar catalogue', () => {
    expect(cookieLang('a=1; kv_lang=ar')).toBe('ar');
    expect(cookieLang('kv_lang=ur')).toBe('en');
    expect(boundaryWords('not_found', null, 'ar').title).toBe(ar['sweep.err.notFound.title']);
    expect(boundaryWords('not_found', null, 'ar').title).not.toBe(en['sweep.err.notFound.title']);
  });
});

describe('the Edge pages in Arabic (the middleware\'s own words)', () => {
  it('every Arabic literal equals the ar catalogue; the English banner line equals en', () => {
    for (const k of EDGE_WORD_KEYS) expect([k, EDGE_WORDS_PREVIEW.ar[k]]).toEqual([k, ar[`sweep.edge.${k}`]]);
    expect(EDGE_WORDS_PREVIEW.ar.draftBanner).toBe(ar['rtl.draftBanner']);
    expect(EDGE_DRAFT_BANNER_EN).toBe(en['rtl.draftBanner']);
    expect(Object.keys(EDGE_WORDS).sort()).toEqual(['en', 'gu', 'hi']);   // the live set is unchanged
  });
  it('kv_lang=ar → <html lang="ar" dir="rtl">, the Arabic words, the banner in Arabic AND English; en/hi/gu carry no banner', () => {
    expect(edgeLang('ar')).toEqual({ code: 'ar', dir: 'rtl' });
    const u = edgeHtml('unavailable', 'ar');
    expect(u.startsWith('<!doctype html><html lang="ar" dir="rtl">')).toBe(true);
    expect(u).toContain(EDGE_WORDS_PREVIEW.ar.lookupFailed);
    expect(u).toContain(EDGE_WORDS_PREVIEW.ar.tryAgain);
    expect(u).toContain(`<div class="kv-md-banner" role="note" data-kv-md-banner="ar"><p lang="ar" dir="rtl">${ar['rtl.draftBanner']}</p><p lang="en" dir="ltr">${en['rtl.draftBanner']}</p></div>`);
    expect(edgeHtml('unknown_host', 'ar')).toContain(EDGE_WORDS_PREVIEW.ar.noOrganisation);
    for (const l of ['en', 'hi', 'gu', undefined]) expect(edgeHtml('unavailable', l)).not.toContain('kv-md-banner');
  });
});
