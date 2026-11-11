// apps/mobile/src/app/__tests__/render/rtl1h3-arabic-screens.render-spec.tsx · PC-56 RTL-1h-3 (brief_rtl1h3.md §D) — the whole Arabic
// catalogue on real screens. Under a saved (explicit) Arabic: the farmer home, the wallet and My Listings print Arabic words, none of
// the English strings those screens' keys would fall back to (named below, and every static `t('…')` key of the screen file whose
// English needs translating), and the machine-draft banner shows. Under English the same screens are unchanged (the named English
// strings are there, no Arabic, no banner). jest cannot flip the layout; that is the device pass owed at RTL-1h-CLOSE.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { renderScreen } from '../../../test-utils/render';
import { i18n } from '../../../core/i18n/i18n';
import { MachineDraftBanner } from '../../../core/i18n/LanguageShell';
import ar from '../../../core/i18n/locales/ar';
import en from '../../../core/i18n/locales/en.json';
import FarmerHome from '../../(farmer)/home';
import WalletHome from '../../(farmer)/wallet/index';
import MyListings from '../../(farmer)/listings/index';

jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../core/security', () => ({ useSecureScreen: () => {} }));
jest.mock('../../../core/auth/auth.store', () => ({
  useAuth: () => ({ state: { profile: null }, loadProfile: async () => {} }),
}));
jest.mock('../../../features/farmer/dashboard.api', () => ({
  loadFarmerHome: async () => ({
    listingCount: 3,
    mandi: [{ id: 'm1', commodity: 'Wheat', modalPriceMinor: '250000', changePct: 1.5 }],
    walletBalanceMinor: '12345650',
    tip: { id: 't1', title: 'Tip', body: 'Body', kind: 'crop' },
    weather: { tempC: 31, code: 'clear', place: null },
  }),
}));
jest.mock('../../../features/wallet/wallet.api', () => ({
  walletBalance: async () => ({ availableMinor: '12345650', heldMinor: '500000', failed: false }),
  walletEarnings: async () => ({ totalMinor: '0', byMonth: [] }),
  listPayouts: async () => ({ items: [], nextCursor: null }),
  walletLedger: async () => ({ items: [], nextCursor: null }),
}));
jest.mock('../../../features/listings/listings.api', () => ({
  myListings: async () => ({ items: [], nextCursor: null }),
  getListing: async () => null,
  listingAnalytics: async () => null,
}));

const E = en as Record<string, string>;
const ARABIC = /[؀-ۿ]/;
const setLang = (code: string) => act(() => { i18n.setPending(null); i18n.setLanguage(code, 'explicit'); });
afterEach(() => setLang('en'));

type R = Awaited<ReturnType<typeof renderScreen>>;
const flat = (x: unknown): string => (Array.isArray(x) ? x.map(flat).join('') : typeof x === 'string' || typeof x === 'number' ? String(x) : '');
/** Every string the screen prints: Text children, plus titles/messages/labels handed to ui-native components as props. */
const printed = (r: R): string[] => [
  ...r.root.findAllByType(Text).map((n) => flat(n.props.children)),
  ...r.root.findAll((n) => typeof n.type !== 'string').flatMap((n) => ['title', 'message', 'actionLabel', 'label', 'accessibilityLabel'].map((p) => (n.props ?? {})[p]).filter((v): v is string => typeof v === 'string')),
];
/** The static `t('key')` keys of a screen file whose English has a word to translate (3+ Latin letters outside placeholders). */
const staticKeys = (rel: string) => {
  const s = fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
  return [...new Set([...s.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1]))].filter((k) => k in E && /[A-Za-z]{3,}/.test(E[k].replace(/\{[^{}]+\}/g, '')));
};

const SCREENS = [
  { name: 'farmer home', el: () => <FarmerHome />, file: '(farmer)/home.tsx', en: ['Photo', 'Sell your crop in 60 seconds', 'Speak to Sell', 'My Listings', 'Wallet', "Today's Mandi Pulse"], keys: ['home.photo', 'home.weather.clear', 'home.sellIn60', 'home.speakToSell', 'home.myListings', 'home.wallet', 'home.mandiPulse'] },
  { name: 'wallet', el: () => <WalletHome />, file: '(farmer)/wallet/index.tsx', en: ['Add money'], keys: ['tabs.wallet', 'wallet.available', 'wallet.addMoney', 'wallet.withdraw', 'wallet.recent'] },
  { name: 'My Listings', el: () => <MyListings />, file: '(farmer)/listings/index.tsx', en: ['No listings yet', 'Create your first listing to start selling.'], keys: ['listings.title', 'listings.empty.title', 'listings.empty.message'] },
];

describe('1 · under a saved Arabic: Arabic words, no English fallback, the banner', () => {
  it.each(SCREENS)('$name', async ({ el, file, en: named, keys }) => {
    setLang('ar');
    const r = await renderScreen(<>{el()}<MachineDraftBanner /></>);
    const out = printed(r);
    const all = out.join('\n');
    for (const k of keys) expect([k, out.some((s) => s.includes(ar[k]))]).toEqual([k, true]);   // the drafted words are on screen
    for (const s of named) expect([s, out.some((o) => o.includes(s))]).toEqual([s, false]);      // named English strings absent
    for (const k of staticKeys(file)) expect([k, out.some((s) => s === E[k])]).toEqual([k, false]); // no key of this screen fell back
    expect(all).toMatch(ARABIC);
    expect(all).toContain(ar['shell.draftBanner']);                                             // the banner, Arabic line …
    expect(all).toContain(E['shell.draftBanner']);                                              // … and its English line
  });
});

describe('2 · under English: unchanged', () => {
  it.each(SCREENS)('$name', async ({ el, en: named, keys }) => {
    setLang('en');
    const r = await renderScreen(<>{el()}<MachineDraftBanner /></>);
    const out = printed(r);
    for (const k of keys) expect([k, out.some((s) => s.includes(E[k]))]).toEqual([k, true]);
    for (const s of named) expect([s, out.some((o) => o.includes(s))]).toEqual([s, true]);
    expect(out.join('\n')).not.toMatch(ARABIC);
    expect(out.join('\n')).not.toContain(E['shell.draftBanner']);                               // no banner under English
  });
});
