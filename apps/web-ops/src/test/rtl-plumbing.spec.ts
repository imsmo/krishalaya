// apps/web-ops/src/test/rtl-plumbing.spec.ts · PC-56 RTL-1e — Arabic is reachable ONLY by a person's choice (founder Q1 "opt-in only"),
// everywhere the ops console resolves or sets a language (brief_rtl1e.md §A):
//   • lib/i18n — the kvo_lang cookie resolves as EXPLICIT (may serve ar), Accept-Language as IMPLICIT (never ar);
//   • lib/locale-url — `?lang=` and the switcher's posted value accept a live code or the preview code, nothing else;
//   • middleware.ts — `?lang=ar` persists the cookie (the person chose it in the URL); a coming-soon code still sets nothing;
//   • app/api/lang/route.ts — the switcher's POST sets the cookie ONLY (no account or person record — the RTL-1c lesson), fail-closed to en;
//   • the kiosk's account language (a PERSON record) stays the live set — Arabic is never written onto anyone's account.
// app/error.tsx (a client boundary that reads the cookie) is proven in test-render/rtl-ar.render.test.tsx (the unit config compiles .ts only);
// the root layout's banner and <html dir> are proven there too.
const mockReq: { cookies: Record<string, string>; headers: Record<string, string> } = { cookies: {}, headers: {} };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (n in mockReq.cookies ? { name: n, value: mockReq.cookies[n] } : undefined) }),
  headers: () => new Headers(mockReq.headers),
}));
// eslint-disable-next-line import/first
import * as fs from 'node:fs';
// eslint-disable-next-line import/first
import * as path from 'node:path';
// eslint-disable-next-line import/first
import { NextRequest } from 'next/server';
// eslint-disable-next-line import/first
import { LANGUAGES, LANGUAGE_REGISTRY, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
// eslint-disable-next-line import/first
import { getLang, getLanguageDef, getTranslator, LANG_COOKIE } from '../lib/i18n';
// eslint-disable-next-line import/first
import { pickChosenLang, pickUrlLang } from '../lib/locale-url';
// eslint-disable-next-line import/first
import { middleware } from '../middleware';
// eslint-disable-next-line import/first
import { POST } from '../app/api/lang/route';
// eslint-disable-next-line import/first
import { buildFarmer, KIOSK_LANGS } from '../features/kiosk/form';
// eslint-disable-next-line import/first
import { en } from '../i18n/en';
// eslint-disable-next-line import/first
import { ar } from '../i18n/ar';

const as = (who: { cookie?: string; accept?: string }) => {
  mockReq.cookies = who.cookie ? { [LANG_COOKIE]: who.cookie } : {};
  mockReq.headers = who.accept ? { 'accept-language': who.accept } : {};
};
const COMING_SOON = LANGUAGE_REGISTRY.filter((l) => l.status !== 'live' && !PREVIEW_LANGUAGES.includes(l.code)).map((l) => l.code);
beforeEach(() => as({}));

describe('lib/i18n: the cookie is a choice, Accept-Language is not', () => {
  it('kvo_lang=ar → ar, rtl, the Western-digit Intl tag, and the Arabic catalogue', () => {
    as({ cookie: 'ar' });
    expect(getLang()).toBe('ar');
    expect(getLanguageDef()).toMatchObject({ code: 'ar', dir: 'rtl', intlLocale: 'ar-AE-u-nu-latn' });
    expect(getTranslator().t('rtl.draftBanner')).toBe(ar['rtl.draftBanner']);
    expect(getTranslator().t('nav.brand')).toBe(ar['nav.brand']);
    expect(getTranslator().t('ops1.payout.title')).toBe(ar['ops1.payout.title']);
  });
  it('an Accept-Language `ar` browser with no cookie gets ENGLISH', () => {
    for (const accept of ['ar', 'ar-AE', 'ar-AE,ar;q=0.9,en;q=0.8']) {
      as({ accept });
      expect([accept, getLang(), getLanguageDef().dir]).toEqual([accept, 'en', 'ltr']);
      expect(getTranslator().t('nav.brand')).toBe(en['nav.brand']);
    }
  });
  it('en / hi / gu unchanged from the cookie and from Accept-Language; a coming-soon code is refused', () => {
    for (const code of ['en', 'hi', 'gu']) {
      as({ cookie: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
      as({ accept: code }); expect(getLanguageDef()).toMatchObject({ code, dir: 'ltr' });
    }
    as({}); expect(getLang()).toBe('en');
    expect(COMING_SOON.length).toBeGreaterThan(3);
    for (const c of COMING_SOON) { as({ cookie: c }); expect([c, getLang()]).toEqual([c, 'en']); }
  });
});

describe('lib/locale-url: a chosen language is live or the preview — nothing else', () => {
  it('pickChosenLang: every live code as before, the preview code, and null for anything else', () => {
    for (const l of LANGUAGES) expect(pickChosenLang(l.code)).toBe(l.code);
    expect([...PREVIEW_LANGUAGES]).toEqual(['ar']);
    expect(pickChosenLang('ar')).toBe('ar');
    for (const bad of [undefined, null, '', 'xx', 'zz-ZZ', ...COMING_SOON]) expect([bad, pickChosenLang(bad)]).toEqual([bad, null]);
  });
  it('pickUrlLang reads ?lang= through the same rule', () => {
    expect(pickUrlLang(new URL('https://ops.test/payout?lang=ar'))).toBe('ar');
    expect(pickUrlLang(new URL('https://ops.test/payout?lang=hi'))).toBe('hi');
    expect(pickUrlLang(new URL('https://ops.test/payout?lang=ur'))).toBeNull();
    expect(pickUrlLang(new URL('https://ops.test/payout'))).toBeNull();
  });
});

describe('middleware: ?lang= persists the chosen language into kvo_lang', () => {
  const run = (q: string) => middleware(new NextRequest(`https://ops.test/payout${q}`)).cookies.get(LANG_COOKIE)?.value;
  it('?lang=ar sets the cookie to ar (the person chose it in the URL); ?lang=gu as before', () => {
    expect(run('?lang=ar')).toBe('ar');
    expect(run('?lang=gu')).toBe('gu');
  });
  it('no ?lang=, an unknown or a coming-soon code sets nothing', () => {
    expect(run('')).toBeUndefined();
    expect(run('?lang=xx')).toBeUndefined();
    for (const c of COMING_SOON) expect([c, run(`?lang=${c}`)]).toEqual([c, undefined]);
  });
});

describe('the /api/lang route: the switcher sets the cookie ONLY', () => {
  const post = async (lang: string, from = '/payout') => {
    const body = new FormData(); body.set('lang', lang); body.set('from', from);
    const res = await POST(new NextRequest('https://ops.test/api/lang', { method: 'POST', body }));
    return { status: res.status, location: res.headers.get('location'), cookie: res.cookies.get(LANG_COOKIE)?.value };
  };
  it('Arabic posted → kvo_lang=ar and a 303 back to the page carrying ?lang=ar', async () => {
    expect(await post('ar')).toEqual({ status: 303, location: 'https://ops.test/payout?lang=ar', cookie: 'ar' });
  });
  it('a live code as before; an unknown or coming-soon code fails closed to en', async () => {
    expect(await post('hi')).toEqual({ status: 303, location: 'https://ops.test/payout?lang=hi', cookie: 'hi' });
    for (const bad of ['xx', '', ...COMING_SOON]) expect([bad, (await post(bad)).cookie]).toEqual([bad, 'en']);
  });
  it('the route file calls no client, no SDK and no fetch: a language choice never reaches an account or person record', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'api', 'lang', 'route.ts'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(/api-client|sdk-js|fetch\(|opsClient|languageCode|PATCH/i.test(src)).toBe(false);
    expect(src).toContain('const lang = pickChosenLang(raw) ?? \'en\';');
  });
});

describe('the kiosk account language (a PERSON record) stays the live set', () => {
  it('Arabic is never offered or accepted as a new account\'s language', () => {
    expect(KIOSK_LANGS).toEqual(LANGUAGES.map((l) => l.code));
    expect(KIOSK_LANGS).not.toContain('ar');
    expect(buildFarmer({ phone: '+919812345678', fullName: '', languageCode: 'ar' })).toEqual({ ok: false, error: 'lang' });
    expect(buildFarmer({ phone: '+919812345678', fullName: '', languageCode: 'gu' })).toMatchObject({ ok: true, value: { languageCode: 'gu' } });
  });
});
