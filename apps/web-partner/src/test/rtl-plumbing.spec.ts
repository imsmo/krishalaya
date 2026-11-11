// apps/web-partner/src/test/rtl-plumbing.spec.ts · PC-56 RTL-1d — Arabic is reachable ONLY by a person's choice (founder Q1 "opt-in only"),
// everywhere the partner console resolves or sets a language: lib/i18n (the kv_lang cookie is explicit, Accept-Language implicit), the language
// module (the preview list is the package's, kept apart from the live list), and the PREVIEW act (sets the cookie ONLY — no API, no account
// record). The partner console has no middleware, no language route and no client boundary that reads the cookie (app/error.tsx reads the en
// catalogue only — unchanged); the render proof (test-render/rtl-ar.render.test.tsx) covers the root layout.
const mockReq: { cookies: Record<string, string>; headers: Record<string, string> } = { cookies: {}, headers: {} };
const mockSet = jest.fn();
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n in mockReq.cookies ? { name: n, value: mockReq.cookies[n] } : undefined), set: (...a: unknown[]) => mockSet(...a) }),
  headers: () => new Headers(mockReq.headers),
}));
jest.mock('next/navigation', () => ({
  redirect: (url: string) => { const e = new Error(`REDIRECT ${url}`) as Error & { url: string }; e.url = url; throw e; },
}));
// eslint-disable-next-line import/first
import * as fs from 'node:fs';
// eslint-disable-next-line import/first
import * as path from 'node:path';
// eslint-disable-next-line import/first
import { LANGUAGES, PREVIEW_LANGUAGES, LANGUAGE_REGISTRY } from '@krishalaya/i18n';
// eslint-disable-next-line import/first
import { getLang, getLanguageDef, getTranslator } from '../lib/i18n';
// eslint-disable-next-line import/first
import { LANGUAGE_CHOICES, PREVIEW_CHOICES, isPreviewLanguage, pickLanguage, pickPreviewLanguage, LANG_COOKIE } from '../features/partner6/language';
// eslint-disable-next-line import/first
import { chooseLanguageAction, choosePreviewLanguageAction } from '../app/account/notifications/preferences/actions';
// eslint-disable-next-line import/first
import { en } from '../i18n/en';
// eslint-disable-next-line import/first
import { ar } from '../i18n/ar';

const as = (who: { cookie?: string; accept?: string }) => {
  mockReq.cookies = who.cookie ? { [LANG_COOKIE]: who.cookie } : {};
  mockReq.headers = who.accept ? { 'accept-language': who.accept } : {};
};
const fd = (v?: string) => { const f = new FormData(); if (v !== undefined) f.set('lang', v); return f; };
const run = async (a: (f: FormData) => Promise<void>, f: FormData): Promise<string> => {
  try { await a(f); } catch (e) { return (e as { url?: string }).url ?? `THREW ${(e as Error).message}`; }
  return 'NO REDIRECT';
};
const PAGE = '/account/notifications/preferences';
beforeEach(() => { mockSet.mockReset(); as({}); });

describe('lib/i18n: the cookie is a choice, Accept-Language is not', () => {
  it('kv_lang=ar → ar, rtl, the Western-digit Intl tag, and the Arabic catalogue', () => {
    as({ cookie: 'ar' });
    expect(getLang()).toBe('ar');
    expect(getLanguageDef()).toMatchObject({ code: 'ar', dir: 'rtl', intlLocale: 'ar-AE-u-nu-latn' });
    expect(getTranslator().t('rtl.draftBanner')).toBe(ar['rtl.draftBanner']);
    expect(getTranslator().t('nav.brand')).toBe(ar['nav.brand']);
  });
  it('an Accept-Language `ar` browser with no cookie gets ENGLISH', () => {
    for (const accept of ['ar', 'ar-AE', 'ar-AE,ar;q=0.9,en;q=0.8']) {
      as({ accept });
      expect([accept, getLang(), getLanguageDef().dir]).toEqual([accept, 'en', 'ltr']);
      expect(getTranslator().t('nav.brand')).toBe(en['nav.brand']);
    }
  });
  it('en / hi / gu unchanged from the cookie and from Accept-Language; a not-live, not-preview code is refused', () => {
    for (const code of ['en', 'hi', 'gu']) {
      as({ cookie: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
      as({ accept: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
    }
    as({}); expect(getLang()).toBe('en');
    as({ cookie: 'ur' }); expect(getLang()).toBe('en');
  });
});

describe('the language module: the preview list is the package\'s, apart from the live list', () => {
  it('PREVIEW_CHOICES = the package\'s PREVIEW_LANGUAGES, served as an explicit choice; the live list is untouched', () => {
    expect(PREVIEW_CHOICES.map((l) => l.code)).toEqual([...PREVIEW_LANGUAGES]);
    expect(PREVIEW_CHOICES.every((l) => l.dir === 'rtl')).toBe(true);
    expect(LANGUAGE_CHOICES).toBe(LANGUAGES);
    expect(LANGUAGE_CHOICES.some((l) => PREVIEW_LANGUAGES.includes(l.code))).toBe(false);
    for (const l of PREVIEW_CHOICES) expect(isPreviewLanguage(l)).toBe(true);
    for (const l of LANGUAGES) expect(isPreviewLanguage(l)).toBe(false);
  });
  it('pickLanguage still accepts only live codes; pickPreviewLanguage only preview codes, exactly', () => {
    for (const l of PREVIEW_CHOICES) { expect(pickLanguage(l.code)).toBeNull(); expect(pickPreviewLanguage(l.code)).toBe(l); }
    for (const l of LANGUAGES) expect(pickPreviewLanguage(l.code)).toBeNull();
    const notPreview = LANGUAGE_REGISTRY.filter((l) => l.status !== 'live' && !PREVIEW_LANGUAGES.includes(l.code)).map((l) => l.code);
    for (const bad of [undefined, null, 1, {}, '', 'ar-AE', 'AR', ' ar', 'x'.repeat(200), ...notPreview]) expect(pickPreviewLanguage(bad)).toBeNull();
  });
});

describe('the PREVIEW act: the cookie only — never an account or API record', () => {
  it('Arabic sets kv_lang (the same attributes as the live act) and comes back with ?form=success', async () => {
    expect(await run(choosePreviewLanguageAction, fd('ar'))).toBe(`${PAGE}?form=success`);
    expect(mockSet.mock.calls).toEqual([[LANG_COOKIE, 'ar', { path: '/', sameSite: 'lax', maxAge: 31_536_000, httpOnly: false, secure: false }]]);
  });
  it('a live, unknown or widened code → ?form=error, nothing set; the LIVE act still refuses Arabic', async () => {
    for (const bad of ['en', 'hi', 'gu', 'ur', 'ar-AE', '', 'xx']) {
      mockSet.mockReset();
      expect([bad, await run(choosePreviewLanguageAction, fd(bad))]).toEqual([bad, `${PAGE}?form=error`]);
      expect(mockSet).not.toHaveBeenCalled();
    }
    expect(await run(chooseLanguageAction, fd('ar'))).toBe(`${PAGE}?form=error`);
    expect(mockSet).not.toHaveBeenCalled();
  });
  it('the act file imports no client, no SDK and no fetch: a language choice can never reach an account / languages row', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'account', 'notifications', 'preferences', 'actions.ts'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(/api-client|sdk-js|fetch\(|serverClient|partnerClient|languageCode|PATCH/i.test(src)).toBe(false);
    expect(src).toMatch(/const preview = pickPreviewLanguage\(raw\);\n\s*if \(!preview\) redirect\(languageHref\('error'\)\);/);
  });
});
