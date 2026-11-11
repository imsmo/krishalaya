// apps/mobile/src/core/__tests__/rtl1h1-plumbing.spec.ts · PC-56 RTL-1h-1 (brief_rtl1h1.md §D) — the pure half of the mobile
// Arabic plumbing, under the "core" project (node, no React Native):
//  1 · the i18n runtime serves Arabic ONLY on an explicit choice; 2 · the start-up restore reads the saved choice BEFORE it sets the
//  direction; 3 · a tap across directions is saved and held behind the restart notice (Q1 → A), a tap within ltr stays instant;
//  4 · the names and the notice text; 5 · the catalogues (the Arabic draft is a subset of English, new keys ×4);
//  6 · static pins: no device-locale read, the root layout no longer sets the direction, RTL never allowed unconditionally,
//      no picker that saves to the account (or the first-run screen, or the profile chips) offers Arabic.
// The I18nManager calls themselves are proven in src/app/__tests__/render/rtl1h1-arabic.render-spec.tsx.
import * as fs from 'fs';
import * as path from 'path';
import { LANGUAGES } from '@krishalaya/i18n';
import { i18n } from '../i18n/i18n';
import { restoreSavedLanguage, chooseLanguage, chosenLanguageName, restartNoticeText } from '../i18n/languageChoice';
import ar from '../i18n/locales/ar';
import en from '../i18n/locales/en.json';
import hi from '../i18n/locales/hi.json';
import gu from '../i18n/locales/gu.json';
import { LANGUAGE_CODES } from '../../features/labour/worker-edit';

const SRC = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
/** Source with comments removed — the static pins judge code, not the prose that explains it. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const src = (abs: string) => code(fs.readFileSync(abs, 'utf8'));
const NEW_KEYS = ['shell.draftBanner', 'system.language.draftTag', 'system.language.restart.toArabic', 'system.language.restart.toOther', 'system.language.sub.ar'];
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

function reset() { i18n.setPending(null); i18n.setLanguage('en', 'explicit'); }
beforeEach(reset);
afterAll(reset);

describe('1 · the runtime serves Arabic only on an explicit choice', () => {
  it('setLanguage("ar") with no choice kind, or an implicit one, stays English (no preview language by omission)', () => {
    i18n.setLanguage('ar');
    expect(i18n.lang).toBe('en');
    i18n.setLanguage('ar', 'implicit');
    expect(i18n.lang).toBe('en');
    i18n.setLanguage('ar-AE', 'implicit');
    expect(i18n.lang).toBe('en');
    expect(i18n.dir).toBe('ltr');
  });
  it('an explicit "ar" serves the Arabic draft, right-to-left, and falls back to English for an undrafted key', () => {
    i18n.setLanguage('ar', 'explicit');
    expect(i18n.lang).toBe('ar');
    expect(i18n.dir).toBe('rtl');
    expect(i18n.t('shell.draftBanner')).toBe(ar['shell.draftBanner']);
    expect(i18n.t('tabs.home')).toBe('الرئيسية');
    expect('home.defaultName' in ar).toBe(false);
    expect(i18n.t('home.defaultName')).toBe((en as Record<string, string>)['home.defaultName']);
    expect(i18n.english('shell.draftBanner')).toBe('This Arabic text is a machine draft and has not been reviewed.');
  });
  it('en / hi / gu resolve exactly as before, left-to-right, explicit or not; Urdu (not a preview) never serves', () => {
    for (const code of ['en', 'hi', 'gu']) {
      for (const choice of ['explicit', 'implicit'] as const) {
        i18n.setLanguage(code, choice);
        expect(i18n.lang).toBe(code);
        expect(i18n.dir).toBe('ltr');
      }
    }
    i18n.setLanguage('ur', 'explicit');
    expect(i18n.lang).toBe('en');
  });
});

describe('2 · start-up: the saved choice is restored FIRST, then the direction comes from it', () => {
  const restore = async (saved: string | undefined) => {
    const seen: Array<{ dir: string; langAtCall: string }> = [];
    const out = await restoreSavedLanguage(async () => saved, (dir) => { seen.push({ dir, langAtCall: i18n.lang }); });
    return { out, seen };
  };
  it('a saved "ar" → Arabic words and an rtl direction, applied once, after the language is on screen', async () => {
    const { out, seen } = await restore('ar');
    expect(out).toBe('ar');
    expect(i18n.lang).toBe('ar');
    expect(seen).toEqual([{ dir: 'rtl', langAtCall: 'ar' }]);
  });
  it('a saved en / hi / gu → that language and an ltr direction', async () => {
    for (const code of ['en', 'hi', 'gu']) {
      reset();
      const { out, seen } = await restore(code);
      expect(out).toBe(code);
      expect(i18n.lang).toBe(code);
      expect(seen).toEqual([{ dir: 'ltr', langAtCall: code }]);
    }
  });
  it('nothing saved → English, ltr (the phone\'s language is never consulted)', async () => {
    const { out, seen } = await restore(undefined);
    expect(out).toBe('en');
    expect(i18n.lang).toBe('en');
    expect(seen).toEqual([{ dir: 'ltr', langAtCall: 'en' }]);
  });
  it('a start clears any pending notice left in memory', async () => {
    i18n.setPending('ar');
    await restore('ar');
    expect(i18n.pending).toBeNull();
  });
});

describe('3 · a tap: saved on the phone; across directions → restart notice, within ltr → instant', () => {
  const tap = async (code: string) => {
    const saved: string[] = []; const dirs: string[] = [];
    const r = await chooseLanguage(code, async (c) => { saved.push(c); }, (d) => { dirs.push(d); });
    return { ...r, saved, dirs };
  };
  it('en → ar: saved "ar", rtl flags written for the next open, words stay English, the notice is pending', async () => {
    const r = await tap('ar');
    expect(r).toEqual({ restartRequired: true, saved: ['ar'], dirs: ['rtl'] });
    expect(i18n.lang).toBe('en');
    expect(i18n.pending).toBe('ar');
  });
  it('en → hi: instant as before, ltr flags, no notice', async () => {
    const r = await tap('hi');
    expect(r).toEqual({ restartRequired: false, saved: ['hi'], dirs: ['ltr'] });
    expect(i18n.lang).toBe('hi');
    expect(i18n.pending).toBeNull();
  });
  it('ar → en (choosing back): saved "en", ltr flags, words stay Arabic until the next open, the notice is pending', async () => {
    i18n.setLanguage('ar', 'explicit');
    const r = await tap('en');
    expect(r).toEqual({ restartRequired: true, saved: ['en'], dirs: ['ltr'] });
    expect(i18n.lang).toBe('ar');
    expect(i18n.pending).toBe('en');
  });
  it('en → ar → hi: changing your mind back within ltr is instant and clears the notice', async () => {
    await tap('ar');
    const r = await tap('hi');
    expect(r.restartRequired).toBe(false);
    expect(r.dirs).toEqual(['ltr']);
    expect(i18n.lang).toBe('hi');
    expect(i18n.pending).toBeNull();
  });
});

describe('4 · names and the notice text', () => {
  it('chosenLanguageName: live and Arabic names; anything else stays undefined exactly as the old LANGUAGES lookup', () => {
    expect(chosenLanguageName('ar')).toBe('العربية');
    for (const l of LANGUAGES) expect(chosenLanguageName(l.code)).toBe(l.nameNative);
    for (const c of ['hi-IN', 'mr', 'ur', 'xx', '', null, undefined]) expect(chosenLanguageName(c)).toBeUndefined();
  });
  it('restartNoticeText: into Arabic, and back to a named language (isolated inside an Arabic sentence)', () => {
    const t = (k: string, v?: Record<string, string | number>) => i18n.t(k, v);
    expect(restartNoticeText('ar', t)).toBe('Close and reopen Krishalaya to switch to Arabic.');
    expect(restartNoticeText('hi', t)).toBe('Close and reopen Krishalaya to switch to हिन्दी.');
    i18n.setLanguage('ar', 'explicit');
    expect(restartNoticeText('en', t)).toBe('أغلق Krishalaya وأعد فتحه للتبديل إلى ⁨English⁩.');
  });
});

describe('5 · catalogues', () => {
  const E = en as Record<string, string>, H = hi as Record<string, string>, G = gu as Record<string, string>;
  it('en / hi / gu carry the same key set, and the five new keys with the same placeholders', () => {
    const ek = Object.keys(E).sort();
    expect(Object.keys(H).sort()).toEqual(ek);
    expect(Object.keys(G).sort()).toEqual(ek);
    for (const k of NEW_KEYS) for (const c of [E, H, G, ar]) {
      expect(typeof c[k]).toBe('string');
      expect(placeholders(c[k])).toEqual(placeholders(E[k]));
    }
  });
  it('the Arabic draft is a subset of English with equal placeholders, Arabic script in every value', () => {
    for (const [k, v] of Object.entries(ar)) {
      expect(k in E).toBe(true);
      expect(placeholders(v)).toEqual(placeholders(E[k]));
      expect(v).toMatch(/[؀-ۿ]/);
    }
  });
  it('ar.ts carries the MACHINE DRAFT header', () => {
    expect(read('core/i18n/locales/ar.ts').split('\n')[0]).toContain('MACHINE DRAFT, NOT REVIEWED.');
  });
});

describe('6 · static pins', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : walk(p);
    return /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
  const files = walk(SRC);
  const rel = (p: string) => path.relative(SRC, p);

  it('no source file reads the phone\'s language (expo-localization / getLocales / getCalendars)', () => {
    const hits = files.filter((f) => /expo-localization|getLocales|getCalendars/.test(src(f))).map(rel);
    expect(hits).toEqual([]);
  });
  it('only languageChoice.ts calls i18n.setLanguage, and only it says "explicit"', () => {
    const set = files.filter((f) => /i18n\.setLanguage\(/.test(src(f))).map(rel);
    expect(set).toEqual(['core/i18n/languageChoice.ts']);
    const explicit = files.filter((f) => /'explicit'/.test(src(f))).map(rel).sort();
    expect(explicit).toEqual(['core/i18n/i18n.ts', 'core/i18n/languageChoice.ts']);
  });
  it('kv.lang is read only by the start-up restore, which goes through restoreSavedLanguage with the RTL glue', () => {
    const readers = files.filter((f) => /readLanguage\(/.test(src(f))).map(rel).sort();
    expect(readers).toEqual(['core/auth/auth.store.tsx', 'core/auth/token-store.ts']);
    const store = code(read('core/auth/auth.store.tsx'));
    expect(store).toMatch(/restoreSavedLanguage\(async \(\) => lang, applyRtlForDirection\)/);
    expect(store).toMatch(/chooseLanguage\(code, \(c\) => tokenStore\.saveLanguage\(c\), applyRtlForDirection\)/);
  });
  it('the root layout no longer sets the direction before the restore, and renders the banner + restart notice', () => {
    const layout = code(read('app/_layout.tsx'));
    expect(layout).not.toMatch(/applyRtlForDirection|resolveLanguage|I18nManager/);
    expect(layout).toContain('<MachineDraftBanner />');
    expect(layout).toContain('<LanguageRestartNotice />');
  });
  it('the RTL glue never allows right-to-left unconditionally', () => {
    const glue = code(read('core/mechanisms/rtlBoot.ts'));
    expect(glue).not.toMatch(/allowRTL\(true\)/);
    expect(glue).toMatch(/I18nManager\.allowRTL\(forced\);/);
    const callers = files.filter((f) => /applyRtlForDirection/.test(src(f))).map(rel).sort();
    expect(callers).toEqual(['core/auth/auth.store.tsx', 'core/mechanisms/rtlBoot.ts']);
  });
  it('the pickers that save to the account, the first-run screen and the profile chips never offer Arabic', () => {
    expect(LANGUAGE_CODES).toEqual(['hi', 'gu', 'en']);
    expect(LANGUAGES.map((l) => l.code)).not.toContain('ar');
    for (const f of ['app/(farmer)/profile/edit.tsx', 'app/(worker)/profile/edit.tsx', 'features/labour/worker-edit.ts',
      'app/(auth)/language.tsx', 'app/(farmer)/profile.tsx', 'app/(ambassador)/profile.tsx']) {
      const s = code(read(f));
      expect([f, /PREVIEW_LANGUAGES|LANGUAGE_REGISTRY|COMING_SOON_LANGUAGES|getRegistryEntry|resolveServable|['"]ar['"]/.test(s)]).toEqual([f, false]);
    }
  });
  it('Arabic is offered on Settings → Language, from PREVIEW_LANGUAGES', () => {
    expect(read('app/(system)/language.tsx')).toMatch(/PREVIEW_LANGUAGES\.map/);
  });
});
