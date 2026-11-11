// apps/mobile/src/app/__tests__/render/rtl1h1-arabic.render-spec.tsx · PC-56 RTL-1h-1 (brief_rtl1h1.md §D) — the React Native half
// of the mobile Arabic plumbing. jest cannot flip RN's layout (jest-expo freezes `I18nManager.isRTL` at module load), so this proves
// the CALLS: the start-up restore, fed by the real token store over AsyncStorage's jest mock, writes allowRTL/forceRTL true ONLY for a
// saved Arabic, and false for en/hi/gu/nothing saved — also when the phone itself is set to Arabic (expo-localization mocked to
// say so; the app never asks it). Then the screens: Settings → Language offers "العربية (machine draft)" as its own row, a tap shows
// the restart notice and moves the ✓; the shell under a saved Arabic shows the banner (Arabic + English) and the drafted words, and
// no banner under en/hi/gu.
import React from 'react';
import { act } from 'react-test-renderer';
import { Text, View, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderScreen } from '../../../test-utils/render';
import { i18n } from '../../../core/i18n/i18n';
import { useTranslation } from '../../../core/i18n/useTranslation';
import { restoreSavedLanguage, chooseLanguage } from '../../../core/i18n/languageChoice';
import { MachineDraftBanner, LanguageRestartNotice } from '../../../core/i18n/LanguageShell';
import { applyRtlForDirection } from '../../../core/mechanisms/rtlBoot';
import { tokenStore } from '../../../core/auth/token-store';
import LanguageSwitcher from '../../(system)/language';

// AsyncStorage's own documented jest mock (lazy require inside the factory — see dev20-mechanisms.render-spec.tsx for why).
// eslint-disable-next-line no-restricted-syntax
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
// The phone's own language is Arabic, right-to-left — the app must not care.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'ar-AE', languageCode: 'ar', textDirection: 'rtl' }],
  locale: 'ar-AE', isRTL: true,
}), { virtual: true });
// The Settings screen's auth store: the real tap logic, saving through the real token store.
jest.mock('../../../core/auth/auth.store', () => ({
  useAuth: () => ({
    setLanguage: async (code: string) => {
      const { chooseLanguage: choose } = jest.requireActual('../../../core/i18n/languageChoice');
      const { applyRtlForDirection: apply } = jest.requireActual('../../../core/mechanisms/rtlBoot');
      const { tokenStore: store } = jest.requireActual('../../../core/auth/token-store');
      return (await choose(code, (c: string) => store.saveLanguage(c), apply)).restartRequired;
    },
  }),
}));

let allow: jest.SpyInstance; let force: jest.SpyInstance;
beforeEach(async () => {
  await AsyncStorage.clear();
  act(() => { i18n.setPending(null); i18n.setLanguage('en', 'explicit'); });
  allow = jest.spyOn(I18nManager, 'allowRTL'); force = jest.spyOn(I18nManager, 'forceRTL');
});
afterEach(() => { allow.mockRestore(); force.mockRestore(); act(() => { i18n.setPending(null); i18n.setLanguage('en', 'explicit'); }); });

/** The start-up path auth.store.tsx runs: the real `kv.lang` read, then the real RTL glue. */
async function startWithSaved(code: string | undefined) {
  if (code !== undefined) await AsyncStorage.setItem('kv.lang', code);
  let out = '';
  await act(async () => { out = await restoreSavedLanguage(() => tokenStore.readLanguage(), applyRtlForDirection); });
  return out;
}
const texts = (r: Awaited<ReturnType<typeof renderScreen>>) => r.root.findAllByType(Text).map((n) => n.props.children);

describe('1 · start-up: right-to-left only for a saved Arabic', () => {
  it('a saved "ar" → Arabic, allowRTL(true) + forceRTL(true)', async () => {
    expect(await startWithSaved('ar')).toBe('ar');
    expect(i18n.lang).toBe('ar');
    expect(allow.mock.calls).toEqual([[true]]);
    expect(force.mock.calls).toEqual([[true]]);
  });
  it.each(['en', 'hi', 'gu'])('a saved "%s" → that language, allowRTL(false) + forceRTL(false) (the leak closed)', async (code) => {
    expect(await startWithSaved(code)).toBe(code);
    expect(i18n.lang).toBe(code);
    expect(allow.mock.calls).toEqual([[false]]);
    expect(force.mock.calls).toEqual([[false]]);
  });
  it('nothing saved on a phone whose own language is Arabic → English, right-to-left locked off', async () => {
    const localization = jest.requireMock('expo-localization') as { getLocales: () => Array<{ languageCode: string }> };
    expect(localization.getLocales()[0].languageCode).toBe('ar');   // the phone says Arabic …
    expect(await startWithSaved(undefined)).toBe('en');              // … the app stays English
    expect(i18n.lang).toBe('en');
    expect(allow.mock.calls).toEqual([[false]]);
    expect(force.mock.calls).toEqual([[false]]);
  });
  it('a tap on Arabic writes the rtl flags for the next open; a tap back writes ltr', async () => {
    await act(async () => { await chooseLanguage('ar', (c) => tokenStore.saveLanguage(c), applyRtlForDirection); });
    expect(await AsyncStorage.getItem('kv.lang')).toBe('ar');
    expect(allow.mock.calls.at(-1)).toEqual([true]);
    expect(force.mock.calls.at(-1)).toEqual([true]);
    await act(async () => { await chooseLanguage('en', (c) => tokenStore.saveLanguage(c), applyRtlForDirection); });
    expect(await AsyncStorage.getItem('kv.lang')).toBe('en');
    expect(allow.mock.calls.at(-1)).toEqual([false]);
    expect(force.mock.calls.at(-1)).toEqual([false]);
  });
});

describe('2 · Settings → Language: Arabic is its own row; choosing it shows the restart notice', () => {
  const Screen = () => (<View><LanguageRestartNotice /><LanguageSwitcher /></View>);
  it('shows "العربية (machine draft)" as a selectable row, and Arabic is no longer a coming-soon row (10 left)', async () => {
    const r = await renderScreen(<Screen />);
    const row = r.root.findByProps({ testID: 'language-row-ar' });
    const rowTexts = row.findAllByType(Text).map((n) => n.props.children);
    expect(rowTexts).toEqual(expect.arrayContaining(['العربية', '(machine draft)', 'Arabic · not yet reviewed']));
    expect(texts(r).filter((c) => c === 'العربية')).toHaveLength(1);
    expect(texts(r).filter((c) => c === 'SOON')).toHaveLength(10);
    expect(r.root.findAllByProps({ testID: 'language-restart-notice' })).toHaveLength(0);
  });
  it('a tap on the Arabic row: saved, notice "Close and reopen Krishalaya to switch to Arabic.", ✓ on Arabic, words still English', async () => {
    const r = await renderScreen(<Screen />);
    await act(async () => { await r.root.findByProps({ testID: 'language-row-ar' }).props.onPress(); });
    expect(await AsyncStorage.getItem('kv.lang')).toBe('ar');
    const notice = r.root.findByProps({ testID: 'language-restart-notice' });
    expect(notice.findByType(Text).props.children).toBe('Close and reopen Krishalaya to switch to Arabic.');
    expect(r.root.findByProps({ testID: 'language-row-ar' }).findAllByType(Text).map((n) => n.props.children)).toContain('✓');
    expect(texts(r)).toContain('Choose Language');
    expect(i18n.lang).toBe('en');
  });
  it('choosing back from a saved Arabic: notice to switch to English, in Arabic', async () => {
    await startWithSaved('ar');
    const r = await renderScreen(<Screen />);
    const english = r.root.findAll((n) => n.props.accessibilityRole === 'button' && n.findAllByType(Text).some((t) => t.props.children === 'English'))[0];
    await act(async () => { await english.props.onPress(); });
    expect(await AsyncStorage.getItem('kv.lang')).toBe('en');
    expect(r.root.findByProps({ testID: 'language-restart-notice' }).findByType(Text).props.children)
      .toBe('أغلق Krishalaya وأعد فتحه للتبديل إلى ⁨English⁩.');
  });
});

describe('3 · the shell under a saved Arabic: banner + drafted words; never under en/hi/gu', () => {
  function ShellProbe() {
    const { t } = useTranslation();
    return (<View><MachineDraftBanner /><Text testID="offline">{t('common.offline')}</Text><Text testID="tab">{t('tabs.home')}</Text></View>);
  }
  it('saved "ar": the banner says machine draft in Arabic AND English; the drafted shell keys are Arabic', async () => {
    await startWithSaved('ar');
    const r = await renderScreen(<ShellProbe />);
    const banner = r.root.findByProps({ testID: 'machine-draft-banner' }).findAllByType(Text).map((n) => n.props.children);
    expect(banner).toEqual(['هذا النص العربي مسودة آلية ولم تتم مراجعته.', 'This Arabic text is a machine draft and has not been reviewed.']);
    expect(r.root.findByProps({ testID: 'offline' }).props.children).toBe('أنت غير متصل. ستتم مزامنة التغييرات عند إعادة الاتصال.');
    expect(r.root.findByProps({ testID: 'tab' }).props.children).toBe('الرئيسية');
  });
  it('saved "ar": Settings → Language itself is in Arabic', async () => {
    await startWithSaved('ar');
    const r = await renderScreen(<LanguageSwitcher />);
    expect(texts(r)).toEqual(expect.arrayContaining(['تغيير اللغة', '(مسودة آلية)']));
  });
  it.each(['en', 'hi', 'gu', undefined])('saved %s: no banner', async (code) => {
    await startWithSaved(code);
    const r = await renderScreen(<ShellProbe />);
    expect(r.root.findAllByProps({ testID: 'machine-draft-banner' })).toHaveLength(0);
  });
});
