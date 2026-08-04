// Unit tests for the PURE wallet presenters + the withdrawal guard (features/wallet/txn). No React/native deps
// (SDK/ui imports are type-only). Money is bigint minor units (Law 2) — the guard must use BigInt, never float.
import { statusTone, statusLabelKey, txnTitleKey, presentPayment, presentPayout, withdrawable, withdrawErrorKind, ledgerMoneyTone, presentLedgerEntry, txnFlow } from '../../features/wallet/txn';
import type { PaymentSummary, PayoutSummary, WalletLedgerEntry } from '@krishalaya/sdk-js';

describe('statusTone / statusLabelKey', () => {
  it('maps terminal/non-terminal statuses to tone + label key', () => {
    expect(statusTone('captured')).toBe('success');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('created')).toBe('warning'); // pending
    expect(statusLabelKey('settled')).toBe('success');
    expect(statusLabelKey('cancelled')).toBe('failed');
    expect(statusLabelKey(undefined)).toBe('pending');
  });
});

describe('txnTitleKey', () => {
  it('derives the title key from kind + purpose only', () => {
    expect(txnTitleKey({ kind: 'payout' })).toBe('withdrawal');
    expect(txnTitleKey({ kind: 'payment', purpose: 'wallet_recharge' })).toBe('recharge');
    expect(txnTitleKey({ kind: 'payment', purpose: 'direct_order' })).toBe('payment');
    expect(txnTitleKey({ kind: 'payment' })).toBe('payment');
  });
});

describe('presentPayment / presentPayout', () => {
  it('a wallet recharge is a positive (credit) payment', () => {
    const p: PaymentSummary = { id: 'p1', status: 'captured', amountMinor: '500000', currencyCode: 'INR', purpose: 'wallet_recharge', createdAt: '2026-06-01T00:00:00Z' };
    const v = presentPayment(p);
    expect(v).toMatchObject({ id: 'p1', kind: 'payment', amountMinor: '500000', moneyTone: 'positive', tone: 'success' });
  });
  it('a non-recharge payment is neutral (we never assert it touched the wallet)', () => {
    const p: PaymentSummary = { id: 'p2', status: 'created', amountMinor: '100', currencyCode: 'INR', purpose: 'direct_order' };
    expect(presentPayment(p).moneyTone).toBe('default');
  });
  it('a payout is always a negative (debit) movement', () => {
    const p: PayoutSummary = { id: 'o1', status: 'processing', amountMinor: '250000', currencyCode: 'INR' };
    const v = presentPayout(p);
    expect(v).toMatchObject({ id: 'o1', kind: 'payout', moneyTone: 'negative', tone: 'warning' });
  });
  it('defaults missing amount to 0 (never undefined into MoneyText)', () => {
    expect(presentPayment({ id: 'p3', status: 'captured' } as PaymentSummary).amountMinor).toBe('0');
  });
});

describe('ledgerMoneyTone / presentLedgerEntry (server-truth signed amount + running balance)', () => {
  it('classifies credit / debit / neutral from the signed minor amount (BigInt)', () => {
    expect(ledgerMoneyTone('5000')).toBe('positive');
    expect(ledgerMoneyTone('-5000')).toBe('negative');
    expect(ledgerMoneyTone('0')).toBe('default');
    expect(ledgerMoneyTone('9007199254740993')).toBe('positive');   // > 2^53
    expect(ledgerMoneyTone('xyz')).toBe('default');
  });
  it('passes the server signed amount + running balance straight through', () => {
    const e: WalletLedgerEntry = {
      entryId: '42', txnId: 't1', txnType: 'order_settlement', accountCode: 'main',
      amountMinor: '5000', balanceAfterMinor: '125000', currencyCode: 'INR',
      referenceType: 'order', referenceId: 'o1', description: null, createdAt: '2026-06-01T00:00:00Z',
    };
    expect(presentLedgerEntry(e)).toEqual({
      id: '42', amountMinor: '5000', balanceAfterMinor: '125000', moneyTone: 'positive',
      txnType: 'order_settlement', createdAt: '2026-06-01T00:00:00Z',
    });
  });
  it('defaults a missing amount/balance to 0 (never undefined into MoneyText)', () => {
    const e = { entryId: '7', txnId: 't', txnType: null, accountCode: 'main', currencyCode: 'INR', referenceType: null, referenceId: null, description: null } as unknown as WalletLedgerEntry;
    expect(presentLedgerEntry(e)).toMatchObject({ amountMinor: '0', balanceAfterMinor: '0', moneyTone: 'default' });
  });
});

describe('txnFlow (own-wallet side + net label from tone; never fabricates the counterparty)', () => {
  it('a credit puts the wallet on the receiving (to) side, net credit', () => {
    expect(txnFlow('positive')).toEqual({ walletSide: 'to', netKey: 'netCredit' });
  });
  it('a debit puts the wallet on the sending (from) side, net debit', () => {
    expect(txnFlow('negative')).toEqual({ walletSide: 'from', netKey: 'netDebit' });
  });
  it('a neutral movement is treated as a credit-side (never inverts the wallet role)', () => {
    expect(txnFlow('default')).toEqual({ walletSide: 'to', netKey: 'netCredit' });
  });
});

describe('withdrawable (BigInt guard — Law 2)', () => {
  it('allows a positive amount up to the balance', () => {
    expect(withdrawable('100000', '100000')).toEqual({ ok: true });
    expect(withdrawable('100000', '1')).toEqual({ ok: true });
  });
  it('rejects amounts over the reconciled balance', () => {
    expect(withdrawable('100000', '100001')).toEqual({ ok: false, reason: 'exceeds' });
  });
  it('rejects zero / negative / unparseable amounts', () => {
    expect(withdrawable('100000', '0')).toEqual({ ok: false, reason: 'invalid' });
    expect(withdrawable('100000', '-5')).toEqual({ ok: false, reason: 'invalid' });
    expect(withdrawable('100000', null)).toEqual({ ok: false, reason: 'invalid' });
    expect(withdrawable('100000', 'abc')).toEqual({ ok: false, reason: 'invalid' });
  });
  it('handles very large balances without float precision loss', () => {
    const huge = '9007199254740993000'; // > 2^53
    expect(withdrawable(huge, huge)).toEqual({ ok: true });
    expect(withdrawable(huge, '9007199254740993001')).toEqual({ ok: false, reason: 'exceeds' });
  });
});

describe('withdrawErrorKind (classifies a failed POST /v1/payouts by HTTP status — server is the authority)', () => {
  it('maps 403 to the KYC gate (S3 — kyc_status must be verified)', () => {
    expect(withdrawErrorKind(403)).toBe('kyc');
  });
  it('maps 409/422 to a balance/limit conflict re-asserted server-side', () => {
    expect(withdrawErrorKind(409)).toBe('exceeds');
    expect(withdrawErrorKind(422)).toBe('exceeds');
  });
  it('maps anything else (network, 5xx, undefined) to a generic failure', () => {
    expect(withdrawErrorKind(500)).toBe('failed');
    expect(withdrawErrorKind(undefined)).toBe('failed');
    expect(withdrawErrorKind(null)).toBe('failed');
  });
});
