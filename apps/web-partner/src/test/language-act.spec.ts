// apps/web-partner/src/test/language-act.spec.ts · PC-56 PARTNER-6c · W2960–W2963 — THE LANGUAGE ACT (founder 6c-3, door Q7-A), the one REAL
// act of PARTNER-6, exercised as a function: `next/headers` and `next/navigation` are replaced by recorders (the Server Action runs outside a
// request here), so every case proves WHAT the action sets and WHERE it sends the browser:
//   • each of `@krishalaya/i18n`'s live languages sets `kv_lang` (path `/`, SameSite=Lax, one year, readable by the page) and redirects to
//     `?form=success`;
//   • an unknown / empty / missing / injected / widened ('hi-IN') / not-live ('ur', 'mr') code → `?form=error`, and NO cookie is set;
//   • a cookie that cannot be written → `?form=failure`, nothing else;
//   • the accepted list IS the package's list (identity, not a copy), and no literal language list exists in the page, the views, the act or
//     the language module (the source assertion, with its positive control). M2 (the list check dropped) and M3 (a literal list in the page)
//     kill here.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { LANGUAGES, LANGUAGE_REGISTRY } from '@krishalaya/i18n';

const mockSet = jest.fn();
jest.mock('next/headers', () => ({ cookies: () => ({ set: (...a: unknown[]) => mockSet(...a) }) }));
jest.mock('next/navigation', () => ({
  redirect: (url: string) => { const e = new Error(`REDIRECT ${url}`) as Error & { url: string }; e.url = url; throw e; },
}));
// eslint-disable-next-line import/first
import { chooseLanguageAction } from '../app/account/notifications/preferences/actions';
// eslint-disable-next-line import/first
import { LANGUAGE_CHOICES, LANG_COOKIE, ONE_YEAR_SEC, languageCookie, pickLanguage } from '../features/partner6/language';

const PAGE = '/account/notifications/preferences';
const fd = (v?: string) => { const f = new FormData(); if (v !== undefined) f.set('lang', v); return f; };
const act = async (f: FormData): Promise<string> => {
  try { await chooseLanguageAction(f); } catch (e) { return (e as { url?: string }).url ?? `THREW ${(e as Error).message}`; }
  return 'NO REDIRECT';
};

beforeEach(() => { mockSet.mockReset(); });

describe('PC-56 PARTNER-6c · the language act (Server Action)', () => {
  it('EACH of the package\'s live languages sets kv_lang — path /, SameSite=Lax, one year, not HttpOnly — and goes back with ?form=success', async () => {
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(3);
    for (const l of LANGUAGES) {
      mockSet.mockReset();
      expect([l.code, await act(fd(l.code))]).toEqual([l.code, `${PAGE}?form=success`]);
      expect(mockSet.mock.calls).toEqual([[LANG_COOKIE, l.code, { path: '/', sameSite: 'lax', maxAge: 31_536_000, httpOnly: false, secure: false }]]);
    }
    expect(LANG_COOKIE).toBe('kv_lang');
    expect(ONE_YEAR_SEC).toBe(60 * 60 * 24 * 365);
  });
  it('the cookie is Secure in production only (the storefront precedent)', () => {
    const was = process.env.NODE_ENV;
    try { (process.env as Record<string, string>).NODE_ENV = 'production'; expect(languageCookie().secure).toBe(true); }
    finally { (process.env as Record<string, string | undefined>).NODE_ENV = was; }
    expect(languageCookie().secure).toBe(false);
  });
  it('an unknown, empty, missing, injected, widened or not-live code → ?form=error and NOTHING is set', async () => {
    const notLive = LANGUAGE_REGISTRY.filter((l) => l.status !== 'live').map((l) => l.code);
    expect(notLive.length).toBeGreaterThan(0);
    for (const bad of ['', 'fr', 'EN', 'Hi', 'hi-IN', 'en ', ' gu', "en'; DROP TABLE users;--", '../en', 'en\n', 'gu;Path=/x', '%67%75', 'हिन्दी', 'x'.repeat(200), ...notLive]) {
      mockSet.mockReset();
      expect([bad, await act(fd(bad))]).toEqual([bad, `${PAGE}?form=error`]);
      expect([bad, mockSet.mock.calls.length]).toEqual([bad, 0]);
    }
    mockSet.mockReset();
    expect(await act(fd())).toBe(`${PAGE}?form=error`);
    expect(mockSet).not.toHaveBeenCalled();
    // a file posted under the name is not a code either
    const f = new FormData(); f.set('lang', new Blob(['en']), 'en');
    expect(await act(f)).toBe(`${PAGE}?form=error`);
    expect(mockSet).not.toHaveBeenCalled();
  });
  it('a cookie that cannot be written → ?form=failure (nothing changed, nothing else attempted)', async () => {
    mockSet.mockImplementation(() => { throw new Error('Cookies can only be modified in a Server Action or Route Handler'); });
    expect(await act(fd(LANGUAGES[0].code))).toBe(`${PAGE}?form=failure`);
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
  it('THE ACCEPTED LIST IS THE PACKAGE\'S LIST — identity, never a copy; pickLanguage matches exactly', () => {
    expect(LANGUAGE_CHOICES).toBe(LANGUAGES);
    expect(LANGUAGE_CHOICES.map((l) => l.code)).toEqual(LANGUAGES.map((l) => l.code));
    for (const l of LANGUAGES) expect(pickLanguage(l.code)).toBe(l);
    for (const bad of [undefined, null, 1, {}, [], 'hi-IN', 'xx']) expect(pickLanguage(bad)).toBeNull();
    // each label is the language's own name, in its own script (never an English name for Hindi or Gujarati)
    for (const l of LANGUAGES) expect([l.code, l.nameNative.length > 0]).toEqual([l.code, true]);
    const native = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.nameNative]));
    if (native.hi) expect(/[ऀ-ॿ]/.test(native.hi)).toBe(true);
    if (native.gu) expect(/[઀-૿]/.test(native.gu)).toBe(true);
  });
});

// THE SOURCE ASSERTION (founder 6c-3: "the codes read from @krishalaya/i18n's language list — never a literal list in the page"). A literal
// language code in code (a quoted 'en' / 'hi' / 'gu' or any other registered code) in the page, the views, the act or the language module is a
// list the package does not control. The positive control: the scan FIRES on the literal shapes a regression would take, and on a file that
// really carries one (lib/i18n.ts, which registers each catalogue under its literal code — `register('en', en)` — read as a control only).
const SRC = path.join(__dirname, '..');
const code = (abs: string) => fs.readFileSync(abs, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const CODES = LANGUAGE_REGISTRY.map((l) => l.code);
const LITERAL_CODE = new RegExp(`(['"\`])(${CODES.join('|')})\\1`);
const SCANNED = ['app/account/notifications/preferences/page.tsx', 'app/account/notifications/preferences/actions.ts', 'app/account/notifications/page.tsx',
  'components/partner6/AccountNotificationPrefsView.tsx', 'components/partner6/AccountChain6.tsx', 'components/partner6/AccountNotificationsView.tsx', 'features/partner6/language.ts'];

describe('PC-56 PARTNER-6c · no literal language list (the source assertion, with a positive control)', () => {
  it('positive control: the scan fires on every literal shape a list could take', () => {
    for (const planted of ["choices={LANGUAGE_CHOICES.filter((l) => ['en', 'hi', 'gu'].includes(l.code))}", 'const L = ["en","hi"];', "if (code === 'gu') x();", 'const c = `hi`;'])
      expect([planted, LITERAL_CODE.test(planted)]).toEqual([planted, true]);
    for (const fine of ["l.code === current.code", "name=\"lang\"", "lang={l.code}", "'kv_lang'"]) expect([fine, LITERAL_CODE.test(fine)]).toEqual([fine, false]);
  });
  it('positive control on a real file: lib/i18n.ts registers its catalogues under literal codes, and the scan finds them', () => {
    const control = path.join(SRC, 'lib', 'i18n.ts');
    expect(fs.existsSync(control)).toBe(true);
    expect(LITERAL_CODE.test(code(control))).toBe(true);
  });
  it.each(SCANNED.map((f) => [f]))('%s: no literal language code in code', (rel) => {
    const src = code(path.join(SRC, rel));
    expect(src.length).toBeGreaterThan(300);
    expect([rel, src.match(LITERAL_CODE)?.[0] ?? null]).toEqual([rel, null]);
  });
  it('the page hands the view THE PACKAGE\'S list; the language module takes it from @krishalaya/i18n', () => {
    expect(code(path.join(SRC, 'app/account/notifications/preferences/page.tsx'))).toMatch(/choices=\{LANGUAGE_CHOICES\}/);
    const mod = code(path.join(SRC, 'features/partner6/language.ts'));
    expect(mod).toMatch(/import \{ LANGUAGES, type LanguageDef \} from '@krishalaya\/i18n';/);
    expect(mod).toMatch(/export const LANGUAGE_CHOICES: readonly LanguageDef\[\] = LANGUAGES;/);
    // the act validates through the module (pickLanguage) — never its own list
    expect(code(path.join(SRC, 'app/account/notifications/preferences/actions.ts'))).toMatch(/const lang = pickLanguage\(raw\);\n\s*if \(!lang\) redirect\(languageHref\('error'\)\);/);
  });
});
