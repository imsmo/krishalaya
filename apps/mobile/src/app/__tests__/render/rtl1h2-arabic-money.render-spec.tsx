// apps/mobile/src/app/__tests__/render/rtl1h2-arabic-money.render-spec.tsx · PC-56 RTL-1h-2 (brief_rtl1h2.md §D) — the React Native half
// of mobile money and arrows, through the REAL @krishalaya/ui-native build (its dist/, rebuilt with `pnpm --filter @krishalaya/ui-native
// build`):
//  1 · `<MoneyText>`: under ar the Indian shape inside LRI…PDI; under en/hi/gu byte-identical to formatMoneyMinor (amounts × currencies).
//  2 · `<Icon>`: under a right-to-left layout (`I18nManager.isRTL`) the directional glyphs are drawn mirrored; nothing else ever is.
//  3 · Screens under a saved Arabic and under English: the farmer wallet (four MoneyText amounts + the "View All" arrow) with the
//      machine-draft banner, and the PMSBY enrolment (an amount inside a `t()` sentence and a button title).
// jest cannot flip the layout; `I18nManager.isRTL` is a plain property of RN's module, set and restored here around the Icon cases.
import React from 'react';
import { act } from 'react-test-renderer';
import { Text, I18nManager } from 'react-native';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { MoneyText, Icon, type IconName } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import { i18n } from '../../../core/i18n/i18n';
import { MachineDraftBanner } from '../../../core/i18n/LanguageShell';
import WalletHome from '../../(farmer)/wallet/index';
import PmsbyEnroll from '../../(worker)/pmsby-enroll';

jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../core/security', () => ({ useSecureScreen: () => {} }));
jest.mock('../../../features/wallet/wallet.api', () => ({
  walletBalance: async () => ({ availableMinor: '12345650', heldMinor: '500000', failed: false }),
  walletEarnings: async () => ({ totalMinor: '0', byMonth: [] }),
  listPayouts: async () => ({ items: [], nextCursor: null }),
  walletLedger: async () => ({
    items: [{ entryId: 'e1', amountMinor: '-250050', currencyCode: 'INR', description: 'Seeds', createdAt: '2026-10-01T10:00:00Z', entryType: 'debit', direction: 'debit' }],
    nextCursor: null,
  }),
}));
jest.mock('../../../features/labour/labour.api', () => ({ getMyWorker: async () => ({ id: 'w1', ageVerified18: true }) }));
jest.mock('../../../features/kyc/kyc.api', () => ({
  myDocuments: async () => [{ id: 'k1', docTypeId: 'dt-aadhaar', status: 'verified' }],
  kycDocTypes: async () => [{ id: 'dt-aadhaar', code: 'aadhaar_card' }],
}));
jest.mock('../../../features/profile/profile.api', () => ({ myBankAccounts: async () => [{ id: 'b1', accountKind: 'bank' }] }));
jest.mock('../../../features/insurance/insurance.api', () => ({ findPmsbyProduct: jest.fn(), proposePmsbyPolicy: jest.fn(), payPmsbyPremium: jest.fn() }));

const LRI = '⁦'; const PDI = '⁩';
const MARKS = /[⁦-⁩]/;
const setLang = (code: string) => act(() => { i18n.setPending(null); i18n.setLanguage(code, 'explicit'); });
afterEach(() => setLang('en'));

type R = Awaited<ReturnType<typeof renderScreen>>;
/** Every string a `Text` prints, children joined (nested Texts included once each). */
const texts = (r: R): string[] => r.root.findAllByType(Text).map((n) => {
  const c = n.props.children;
  const flat = (x: unknown): string => (Array.isArray(x) ? x.map(flat).join('') : typeof x === 'string' || typeof x === 'number' ? String(x) : '');
  return flat(c);
});
const moneyTexts = (r: R) => r.root.findAllByType(MoneyText).map((m) => r.root.findAllByType(Text).find((t) => m.findAllByType(Text).includes(t))!.props.children as string);

describe('1 · <MoneyText> (ui-native dist)', () => {
  const AMOUNTS = ['12345650', '0', '-12345650', '5', '1234567890123456789', 'bad'];
  const CCY = ['INR', 'USD', 'JPY', 'BHD', 'AED'];
  it('ar: ₹1,23,456.50 inside LRI…PDI', async () => {
    const r = await renderScreen(<MoneyText minor="12345650" langCode="ar" />);
    expect(r.root.findByType(Text).props.children).toBe('⁦₹1,23,456.50⁩');
  });
  it('ar grid: LRI + formatMoneyMinor(…, en) + PDI', async () => {
    for (const a of AMOUNTS) for (const c of CCY) {
      const r = await renderScreen(<MoneyText minor={a} currencyCode={c} langCode="ar" />);
      expect(r.root.findByType(Text).props.children).toBe(`${LRI}${formatMoneyMinor(a, c, 'en')}${PDI}`);
    }
  });
  it.each(['en', 'hi', 'gu'])('%s grid: byte-identical to formatMoneyMinor(…, lang), no mark', async (lang) => {
    for (const a of AMOUNTS) for (const c of CCY) {
      const r = await renderScreen(<MoneyText minor={a} currencyCode={c} langCode={lang} />);
      const out = r.root.findByType(Text).props.children as string;
      expect(out).toBe(formatMoneyMinor(a, c, lang));
      expect(out).not.toMatch(MARKS);
    }
  });
  it('no langCode → en, unchanged', async () => {
    const r = await renderScreen(<MoneyText minor="12345650" />);
    expect(r.root.findByType(Text).props.children).toBe('₹1,23,456.50');
  });
});

describe('2 · <Icon> mirrors directional glyphs only, and only under a right-to-left layout', () => {
  const ALL: IconName[] = ['wheat', 'check', 'arrow-right', 'arrow-left', 'chevron-right', 'globe', 'camera', 'mic', 'bell', 'home', 'bag', 'wallet', 'user',
    'location', 'phone', 'search', 'plus', 'close', 'calendar', 'star', 'shield', 'sprout', 'truck', 'building', 'user-check'];
  const DIRECTIONAL = ['arrow-right', 'arrow-left', 'chevron-right'];
  const svgStyle = (r: R) => r.root.findAll((n) => n.props.viewBox === '0 0 24 24')[0].props.style;
  const original = I18nManager.isRTL;
  afterEach(() => { (I18nManager as { isRTL: boolean }).isRTL = original; });

  it('ltr (en/hi/gu, and every phone that did not choose Arabic): no icon is mirrored', async () => {
    (I18nManager as { isRTL: boolean }).isRTL = false;
    for (const name of ALL) expect(svgStyle(await renderScreen(<Icon name={name} />))).toBeUndefined();
  });
  it('rtl: arrow-left, arrow-right and chevron-right are drawn mirrored (scaleX -1); the 22 others never', async () => {
    (I18nManager as { isRTL: boolean }).isRTL = true;
    for (const name of ALL) {
      const style = svgStyle(await renderScreen(<Icon name={name} />));
      if (DIRECTIONAL.includes(name)) expect(style).toEqual({ transform: [{ scaleX: -1 }] });
      else expect(style).toBeUndefined();
    }
  });
});

describe('3 · screens under a saved Arabic and under English', () => {
  const WALLET_AMOUNTS = ['12345650', '500000', '0', '0', '250050'];   // available, in escrow, this month, pending, the ledger row
  it('wallet under ar: the banner, every amount Indian-shaped and isolated, the "View All" arrow points left', async () => {
    setLang('ar');
    const r = await renderScreen(<><MachineDraftBanner /><WalletHome /></>);
    const all = texts(r);
    expect(r.root.findAllByProps({ testID: 'machine-draft-banner' }).length).toBeGreaterThan(0);
    expect(moneyTexts(r)).toEqual(WALLET_AMOUNTS.map((m) => `${LRI}${formatMoneyMinor(m, 'INR', 'en')}${PDI}`));
    expect(moneyTexts(r)[0]).toBe('⁦₹1,23,456.50⁩');
    const viewAll = all.find((s) => s.startsWith(i18n.t('wallet.viewAll')))!;
    expect(viewAll).toBe(`${i18n.t('wallet.viewAll')} ←`);
    for (const s of all) if (s.includes('₹') && !s.includes('••')) expect(s).toMatch(/⁦[^⁩]*₹[^⁩]*⁩/);
    expect(all.join('')).not.toContain('→');
  });
  it('wallet under en: the same screen exactly as before — no banner, plain en-IN amounts, "View All →", no mark anywhere', async () => {
    const r = await renderScreen(<><MachineDraftBanner /><WalletHome /></>);
    const all = texts(r);
    expect(moneyTexts(r)).toEqual(WALLET_AMOUNTS.map((m) => formatMoneyMinor(m, 'INR', 'en')));
    expect(all).toContain('View All →');
    expect(all.join('')).not.toMatch(MARKS);
    expect(r.root.findAllByProps({ testID: 'machine-draft-banner' })).toHaveLength(0);
  });
  it('PMSBY under ar: the amount inside the sentence and the button title is isolated in the Indian shape', async () => {
    setLang('ar');
    const r = await renderScreen(<PmsbyEnroll />);
    const all = texts(r);
    const amt = `${LRI}₹20.00${PDI}`;
    expect(all.some((s) => s.includes(amt))).toBe(true);
    const titles = r.root.findAll((n) => typeof n.props.title === 'string').map((n) => n.props.title as string);
    expect(titles.some((s) => s.includes(amt))).toBe(true);
    expect(all.join('')).not.toMatch(/[^⁦]₹\d/);   // never a bare amount
  });
  it('PMSBY under en: "Just ₹20.00/year premium" exactly, no mark', async () => {
    const r = await renderScreen(<PmsbyEnroll />);
    const all = texts(r);
    expect(all).toContain('Just ₹20.00/year premium');
    expect(all.join('')).not.toMatch(MARKS);
  });
});
