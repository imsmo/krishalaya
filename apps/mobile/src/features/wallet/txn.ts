// apps/mobile/src/features/wallet/txn.ts · PURE presenters + guards for the wallet vertical (transactions,
// payout history, withdraw). No React, no native imports (SDK/ui types are `import type` → erased), so this is
// unit-tested under ts-jest. Money is bigint minor-unit strings end-to-end (Law 2) — comparisons use BigInt,
// never a float. Direction/tone are derived ONLY from server fields (status/purpose); the client invents nothing.
import type { PaymentSummary, PayoutSummary, WalletLedgerEntry } from '@krishalaya/sdk-js';
import type { PillTone } from '@krishalaya/ui-native';
import { paymentOutcome } from '../../core/payments/money';

export type TxnKind = 'payment' | 'payout';
export type MoneyTone = 'positive' | 'negative' | 'default';

/** A unified, presentational view of one money movement (a payment or a payout). */
export interface TxnView {
  id: string;
  kind: TxnKind;
  amountMinor: string;
  status: string;
  /** Semantic chip color for the status. */
  tone: PillTone;
  /** Sign/color of the amount: credit (+, green), debit (−, red), or neutral. */
  moneyTone: MoneyTone;
  purpose?: string;
  createdAt?: string;
}

/** Map a server money-status to a status-chip tone (terminal-success/failed/pending). */
export function statusTone(status?: string | null): PillTone {
  const o = paymentOutcome(status);
  return o === 'success' ? 'success' : o === 'failed' ? 'danger' : 'warning';
}

/** i18n key SUFFIX for the status label — the screen renders t(`wallet.status.${suffix}`). */
export function statusLabelKey(status?: string | null): 'success' | 'failed' | 'pending' {
  return paymentOutcome(status); // 'success' | 'failed' | 'pending'
}

/** i18n key SUFFIX for a transaction's title — screen renders t(`wallet.txnTitle.${suffix}`). Derived only from
 * server fields (kind + purpose); unknown purposes fall back to the generic per-kind label. */
export function txnTitleKey(txn: { kind: TxnKind; purpose?: string }): string {
  if (txn.kind === 'payout') return 'withdrawal';
  if (txn.purpose === 'wallet_recharge') return 'recharge';
  return 'payment';
}

/** A payment is money the user paid IN via the gateway. A wallet recharge credits the wallet (positive); any
 * other purpose (e.g. a direct order payment) is shown neutral — we never assert it touched the wallet balance. */
export function presentPayment(p: PaymentSummary): TxnView {
  return {
    id: p.id, kind: 'payment', amountMinor: p.amountMinor ?? '0', status: p.status ?? 'pending',
    tone: statusTone(p.status), moneyTone: p.purpose === 'wallet_recharge' ? 'positive' : 'default',
    purpose: p.purpose, createdAt: p.createdAt,
  };
}

/** A payout is always money OUT of the wallet (a withdrawal/settlement to a bank account) → debit (negative). */
export function presentPayout(p: PayoutSummary): TxnView {
  return {
    id: p.id, kind: 'payout', amountMinor: p.amountMinor ?? '0', status: p.status ?? 'pending',
    tone: statusTone(p.status), moneyTone: 'negative', purpose: p.purpose, createdAt: p.createdAt,
  };
}

/** A presentational view of one wallet LEDGER entry. The signed amount + running balance are server-truth (the
 * client never computes a balance — Law 2/11); we only classify the sign for display. */
export interface LedgerView {
  id: string;
  amountMinor: string;        // SIGNED: +credit / −debit (exactly as the server sent it)
  balanceAfterMinor: string;  // running balance after this entry (server-computed)
  moneyTone: MoneyTone;       // credit (+) / debit (−) / neutral
  txnType: string | null;
  createdAt?: string;
}

/** Classify a signed ledger amount's tone (BigInt, never float). Non-numeric/zero → neutral. */
export function ledgerMoneyTone(amountMinor: string): MoneyTone {
  let v: bigint;
  try { v = BigInt(amountMinor); } catch { return 'default'; }
  return v > 0n ? 'positive' : v < 0n ? 'negative' : 'default';
}

/** Present a ledger entry for the statement screen. Pure — signed amount + running balance pass straight through. */
export function presentLedgerEntry(e: WalletLedgerEntry): LedgerView {
  return {
    id: e.entryId,
    amountMinor: e.amountMinor ?? '0',
    balanceAfterMinor: e.balanceAfterMinor ?? '0',
    moneyTone: ledgerMoneyTone(e.amountMinor ?? '0'),
    txnType: e.txnType ?? null,
    createdAt: e.createdAt,
  };
}

/** Which side of the money-flow the user's OWN wallet sits on, and the net-amount label — derived ONLY from the
 * amount's tone (credit → money came INTO the wallet, so the wallet is the "to"; debit → it left, wallet is the
 * "from"). §13: the COUNTERPARTY (payer/payee name, VPA) is NOT in the payment/payout read-model, so this only
 * ever names the user's own wallet side — it never fabricates who the other party is. Pure. */
export function txnFlow(moneyTone: MoneyTone): { walletSide: 'to' | 'from'; netKey: 'netCredit' | 'netDebit' } {
  return moneyTone === 'negative'
    ? { walletSide: 'from', netKey: 'netDebit' }
    : { walletSide: 'to', netKey: 'netCredit' };
}

export interface WithdrawCheck { ok: boolean; reason?: 'invalid' | 'exceeds' }

/** Client-side pre-check for a withdrawal (UX only — the SERVER re-validates balance, KYC, limits, and is the
 * authority). `amountMinor` may be null when the typed rupee value didn't parse. Pure BigInt math (Law 2):
 * amount must be a positive integer ≤ the reconciled balance. */
export function withdrawable(balanceMinor: string, amountMinor: string | null): WithdrawCheck {
  if (!amountMinor) return { ok: false, reason: 'invalid' };
  let amt: bigint, bal: bigint;
  try { amt = BigInt(amountMinor); bal = BigInt(balanceMinor); } catch { return { ok: false, reason: 'invalid' }; }
  if (amt <= 0n) return { ok: false, reason: 'invalid' };
  if (amt > bal) return { ok: false, reason: 'exceeds' };
  return { ok: true };
}

export type WithdrawErrorKind = 'kyc' | 'exceeds' | 'failed';

/** Classify a failed POST /v1/payouts request by its HTTP status — pure, no message text (the screen owns i18n).
 * The SERVER is the sole authority on WHY a payout was refused (Law 11): 403 is the KYC gate (S3 — `kyc_status`
 * must be 'verified'), 409/422 is a balance/limit conflict re-asserted at request time, anything else is a
 * generic failure (network, 5xx). Never guesses a status the server didn't send. */
export function withdrawErrorKind(status: number | undefined | null): WithdrawErrorKind {
  if (status === 403) return 'kyc';
  if (status === 409 || status === 422) return 'exceeds';
  return 'failed';
}
