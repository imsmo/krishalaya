// apps/mobile/src/app/__tests__/render/tsc1b-money-bugs.render-spec.tsx · PC-56 TSC-1b (brief_tsc1b.md A–C) — the three money
// bugs TSC-1 held for the founder, each proved through the REAL feature api against a mocked api client (so the field names the
// sdk really returns are exercised, not a screen-level mock that could hide them again):
//   A · (ambassador)/withdraw — founder "Wallet available balance": the shown balance AND the limit are `availableMinor`; a
//       withdrawal of exactly the available amount is allowed, one paisa above it is refused; a failed read shows the retry
//       line, never ₹0.
//   B · (dairy)/bills/[id] — founder "One total deductions row": no `deductions` lines → one "Deductions" row with
//       `deductionsMinor` (no crash); lines present → the lines; the amount in the Indian shape under en, isolated under ar.
//   C · (farmer)/auction/[id] — founder "Before live, with a reason": Stop Early only while `scheduled` (hidden when live /
//       extended); confirming without a 3+ character reason is blocked; the api call carries the reason.
import React from 'react';
import { Text } from 'react-native';
import { act } from 'react-test-renderer';
import { Button, EmptyState, Input, MoneyText } from '@krishalaya/ui-native';
import { renderScreen } from '../../../test-utils/render';
import { mockReplace, resetExpoRouterMock, searchParams } from '../../../test-utils/expo-router-mock';
import { i18n } from '../../../core/i18n/i18n';
import AmbassadorWithdraw from '../../(ambassador)/withdraw';
import BillDetail from '../../(dairy)/bills/[id]';
import YourAuction from '../../(farmer)/auction/[id]';

const mockBalance = jest.fn();
const mockBankList = jest.fn();
const mockPayout = jest.fn();
const mockGetBill = jest.fn();
const mockGetAuction = jest.fn();
const mockListBids = jest.fn();
const mockCancel = jest.fn();

jest.mock('../../../core/flags/useFlag', () => ({ useFlag: () => true }));
jest.mock('../../../core/security/screen-guard', () => ({ useSecureScreen: () => {} }));
jest.mock('../../../core/config', () => ({ config: { appVersion: '0.0.0-test' } }));
jest.mock('../../../core/auth/auth.store', () => ({
  useAuth: () => ({ state: { status: 'authenticated', profile: { id: 'seller-1', displayName: 'Asha' } }, setLanguage: jest.fn(), signOut: jest.fn() }),
}));
jest.mock('../../../core/api/client', () => ({
  apiClient: () => ({
    wallet: { balance: () => mockBalance() },
    bankAccounts: { list: () => mockBankList() },
    payouts: { request: (body: unknown, key: string) => mockPayout(body, key) },
    dairy: { getBill: (id: string) => mockGetBill(id) },
    auctions: {
      get: (id: string) => mockGetAuction(id),
      listBids: () => mockListBids(),
      cancel: (...args: unknown[]) => mockCancel(...args),
    },
  }),
}));

type R = Awaited<ReturnType<typeof renderScreen>>;
const flat = (x: unknown): string => (Array.isArray(x) ? x.map(flat).join('') : typeof x === 'string' || typeof x === 'number' ? String(x) : '');
const texts = (r: R): string[] => r.root.findAllByType(Text).map((n) => flat(n.props.children));
const moneyMinors = (r: R): string[] => r.root.findAllByType(MoneyText).map((m) => String(m.props.minor));
const buttonByTitle = (r: R, title: string) => r.root.findAllByType(Button).find((b) => b.props.title === title);
const setLang = (code: string) => act(() => { i18n.setPending(null); i18n.setLanguage(code, 'explicit'); });
const flush = async () => { await act(async () => { await new Promise((res) => setTimeout(res, 0)); }); };

beforeEach(() => {
  resetExpoRouterMock();
  for (const m of [mockBalance, mockBankList, mockPayout, mockGetBill, mockGetAuction, mockListBids, mockCancel]) m.mockReset();
  mockBankList.mockResolvedValue([{ id: 'acct-1', accountKind: 'bank', accountLast4: '4321', ifsc: 'SBIN0001234', holderName: 'Asha', isPrimary: true }]);
  mockListBids.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => setLang('en'));

// ---------------------------------------------------------------------------------------------------------------- A
describe('TSC-1b · A · ambassador withdraw reads the wallet available balance', () => {
  const balance = (availableMinor: string) => ({ availableMinor, heldMinor: '99900000', isFrozen: false, currencyCode: 'INR' });
  const typeRupees = (r: R, v: string) => act(() => { r.root.findByType(Input).props.onChangeText(v); });

  it('shows availableMinor (not the held money) as "Available to withdraw"', async () => {
    mockBalance.mockResolvedValue(balance('250000'));
    const r = await renderScreen(<AmbassadorWithdraw />);
    expect(texts(r)).toContain('Available to withdraw');
    expect(moneyMinors(r)[0]).toBe('250000');
    expect(texts(r)).toContain('₹2,500.00');
    expect(texts(r)).toContain('All ₹2,500.00');
  });

  it('a withdrawal of exactly the available amount is allowed and sent as the same minor-unit string', async () => {
    mockBalance.mockResolvedValue(balance('250000'));
    mockPayout.mockResolvedValue({ id: 'p1' });
    const r = await renderScreen(<AmbassadorWithdraw />);
    typeRupees(r, '2500');
    const submit = buttonByTitle(r, 'Withdraw ₹2,500.00')!;
    expect(submit).toBeDefined();
    expect(submit.props.disabled).toBe(false);
    await act(async () => { await submit.props.onPress(); });
    expect(mockPayout).toHaveBeenCalledTimes(1);
    expect(mockPayout.mock.calls[0][0]).toEqual({ amountMinor: '250000', bankAccountId: 'acct-1', purpose: 'wallet_withdrawal' });
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('one paisa above the available amount is refused (button disabled, no payout, the "exceeds" message)', async () => {
    mockBalance.mockResolvedValue(balance('249999'));
    const r = await renderScreen(<AmbassadorWithdraw />);
    typeRupees(r, '2500');
    const submit = buttonByTitle(r, 'Withdraw ₹2,500.00')!;
    expect(submit.props.disabled).toBe(true);
    await act(async () => { await submit.props.onPress(); });
    expect(mockPayout).not.toHaveBeenCalled();
    expect(r.root.findByType(Input).props.error).toBe(i18n.t('withdraw.exceeds'));
  });

  it('a failed balance read shows the unavailable line with Retry — never ₹0 — and Retry reads again', async () => {
    mockBalance.mockRejectedValueOnce(new Error('offline'));
    const r = await renderScreen(<AmbassadorWithdraw />);
    const empty = r.root.findByType(EmptyState);
    expect(empty.props.title).toBe(i18n.t('wallet.unavailable'));
    expect(empty.props.actionLabel).toBe('Retry');
    expect(r.root.findAllByType(MoneyText)).toHaveLength(0);
    expect(texts(r).some((s) => s.includes('₹0'))).toBe(false);
    expect(r.root.findAllByType(Button).map((b) => b.props.title)).toEqual(['Retry']); // only Retry: no withdraw footer on a failed read
    mockBalance.mockResolvedValue(balance('250000'));
    await act(async () => { await empty.props.onAction(); });
    await flush();
    expect(mockBalance).toHaveBeenCalledTimes(2);
    expect(moneyMinors(r)[0]).toBe('250000');
  });
});

// ---------------------------------------------------------------------------------------------------------------- B
describe('TSC-1b · B · milk-bill detail with and without deduction lines', () => {
  const bill = (extra: Record<string, unknown> = {}) => ({
    id: 'bill-1', membershipId: 'm1', periodStart: '2026-10-01', periodEnd: '2026-10-15', totalLitres: '120.5',
    grossMinor: '1234567', deductionsMinor: '12345650', netMinor: '1111111', status: 'generated', disputeWindowEnds: null, payoutId: null, ...extra,
  });

  it('no deductions lines: renders (no crash) and shows ONE "Deductions" row with deductionsMinor', async () => {
    searchParams.id = 'bill-1';
    mockGetBill.mockResolvedValue(bill());
    const r = await renderScreen(<BillDetail />);
    expect(texts(r)).toContain('Deductions');
    expect(texts(r).filter((s) => s === 'Deductions')).toHaveLength(1);
    expect(moneyMinors(r)).toEqual(['1234567', '12345650', '1111111']);
    expect(texts(r)).toContain('₹1,23,456.50'); // the Indian shape under en
  });

  it('with lines: each line shows, and no total row is added', async () => {
    searchParams.id = 'bill-1';
    mockGetBill.mockResolvedValue(bill({ deductions: [
      { id: 'd1', type: 'feed_credit', amountMinor: '20000', sourceType: 'member_credit', sourceId: 's1', status: 'applied' },
      { id: 'd2', type: 'loan_emi', amountMinor: '30000', sourceType: 'loan', sourceId: 's2', status: 'pending' },
    ] }));
    const r = await renderScreen(<BillDetail />);
    expect(texts(r)).toEqual(expect.arrayContaining(['− feed_credit', '− loan_emi']));
    expect(texts(r)).not.toContain('Deductions');
    expect(moneyMinors(r)).toEqual(['1234567', '20000', '30000', '1111111']);
  });

  it('under ar the total row is the Arabic label and the amount is isolated (LRI … PDI), Indian shape', async () => {
    setLang('ar');
    searchParams.id = 'bill-1';
    mockGetBill.mockResolvedValue(bill());
    const r = await renderScreen(<BillDetail />);
    expect(texts(r)).toContain(i18n.t('dairyapp.billDetail.deductions'));
    expect(i18n.t('dairyapp.billDetail.deductions')).toBe('الخصومات');
    expect(texts(r)).toContain('⁦₹1,23,456.50⁩');
  });
});

// ---------------------------------------------------------------------------------------------------------------- C
describe('TSC-1b · C · stop an auction early: before live only, with a reason', () => {
  const auction = (status: string) => ({
    id: 'auc-1', listingId: 'l1', status, kind: 'english_open', startPriceMinor: '100000', reservePriceMinor: '150000', minIncrementMinor: '1000',
    startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-02T00:00:00Z', currentPriceMinor: null,
  });
  const stopButton = (r: R) => buttonByTitle(r, 'Stop Early');

  it.each(['live', 'extended'])('hidden while the auction is %s', async (status) => {
    searchParams.id = 'auc-1';
    mockGetAuction.mockResolvedValue(auction(status));
    const r = await renderScreen(<YourAuction />);
    expect(buttonByTitle(r, 'Share Auction')).toBeDefined();
    expect(stopButton(r)).toBeUndefined();
  });

  it.each(['ended', 'awaiting_approval', 'settled', 'cancelled'])('hidden once the auction is %s', async (status) => {
    searchParams.id = 'auc-1';
    mockGetAuction.mockResolvedValue(auction(status));
    const r = await renderScreen(<YourAuction />);
    expect(stopButton(r)).toBeUndefined();
  });

  it('shown while scheduled; confirming with no reason (or under 3 characters) is blocked', async () => {
    searchParams.id = 'auc-1';
    mockGetAuction.mockResolvedValue(auction('scheduled'));
    const r = await renderScreen(<YourAuction />);
    expect(stopButton(r)).toBeDefined();
    act(() => { stopButton(r)!.props.onPress(); });
    const input = r.root.findByType(Input);
    expect(input.props.label).toBe('Reason for stopping');
    expect(input.props.maxLength).toBe(300);
    const confirm = () => buttonByTitle(r, 'Stop now')!;
    await act(async () => { await confirm().props.onPress(); });
    expect(mockCancel).not.toHaveBeenCalled();
    expect(r.root.findByType(Input).props.error).toBe('Please write a reason of at least 3 characters.');
    act(() => { r.root.findByType(Input).props.onChangeText('  ab  '); });
    await act(async () => { await confirm().props.onPress(); });
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('the api call carries the (trimmed) reason', async () => {
    searchParams.id = 'auc-1';
    mockGetAuction.mockResolvedValue(auction('scheduled'));
    mockCancel.mockResolvedValue({ auctionId: 'auc-1', status: 'cancelled', notified: 0 });
    const r = await renderScreen(<YourAuction />);
    act(() => { stopButton(r)!.props.onPress(); });
    act(() => { r.root.findByType(Input).props.onChangeText('  Buyer bought it at the farm gate  '); });
    mockGetAuction.mockResolvedValue(auction('cancelled'));
    await act(async () => { await buttonByTitle(r, 'Stop now')!.props.onPress(); });
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledWith('auc-1', 'Buyer bought it at the farm gate');
    expect(r.root.findAllByType(Input)).toHaveLength(0);
    expect(stopButton(r)).toBeUndefined();
  });
});
