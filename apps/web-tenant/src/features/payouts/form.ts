// apps/web-tenant/src/features/payouts/form.ts · PURE validation/assembly for the payouts page. No framework, no
// I/O → unit-tested. Money is parsed float-free from a major-unit string to a bigint minor-unit STRING (Law 2).
// A payout destination is added by its gateway-tokenised `vaultRef` ONLY — raw account numbers / VPAs are
// tokenised at the gateway out-of-band and never pass through the console (Law: no PII/secrets here).
import { parseMajorToMinor } from '../listings/form';
import type { BankAccount } from '@krishalaya/sdk-js';

export type PayoutResult =
  | { ok: true; value: { amountMinor: string; bankAccountId: string; currencyCode: string } }
  | { ok: false; error: 'amount' | 'account' };

/** Validate + assemble a payout-request payload (amount in major units → minor string; a chosen bank account). */
export function buildPayoutRequest(raw: { amountMajor?: string; bankAccountId?: string }): PayoutResult {
  const bankAccountId = (raw.bankAccountId ?? '').trim();
  if (!bankAccountId) return { ok: false, error: 'account' };
  const amountMinor = parseMajorToMinor(raw.amountMajor);
  if (amountMinor === undefined || amountMinor === '0') return { ok: false, error: 'amount' };
  return { ok: true, value: { amountMinor, bankAccountId, currencyCode: 'INR' } };
}

export interface BankAddInput {
  accountKind: 'bank' | 'upi'; vaultRef: string; upiId?: string; accountLast4?: string; ifsc?: string; holderName?: string; isPrimary?: boolean;
}
export type BankResult = { ok: true; value: BankAddInput } | { ok: false; error: 'kind' | 'vaultRef' | 'upi' | 'bank' };

/** Validate + assemble a bank-account add payload. vaultRef is REQUIRED (the gateway token); UPI needs a upiId,
 *  bank needs ifsc + last-4. No raw account number is ever accepted. */
export function buildBankAccount(raw: {
  accountKind?: string; vaultRef?: string; upiId?: string; accountLast4?: string; ifsc?: string; holderName?: string; isPrimary?: string;
}): BankResult {
  const accountKind = raw.accountKind === 'bank' || raw.accountKind === 'upi' ? raw.accountKind : null;
  if (!accountKind) return { ok: false, error: 'kind' };
  const vaultRef = (raw.vaultRef ?? '').trim();
  if (!vaultRef) return { ok: false, error: 'vaultRef' };
  const holderName = (raw.holderName ?? '').trim() || undefined;
  const isPrimary = raw.isPrimary === 'on' || raw.isPrimary === 'true';

  if (accountKind === 'upi') {
    const upiId = (raw.upiId ?? '').trim();
    if (!/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upiId)) return { ok: false, error: 'upi' };
    return { ok: true, value: { accountKind, vaultRef, upiId, holderName, isPrimary } };
  }
  const ifsc = (raw.ifsc ?? '').trim().toUpperCase();
  const accountLast4 = (raw.accountLast4 ?? '').trim();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) || !/^\d{4}$/.test(accountLast4)) return { ok: false, error: 'bank' };
  return { ok: true, value: { accountKind, vaultRef, ifsc, accountLast4, holderName, isPrimary } };
}

/** Human label for a tokenised destination (masked — only the last 4 / VPA, never a full number). */
export function bankLabel(a: BankAccount): string {
  if (a.accountKind === 'upi') return a.upiId ?? 'UPI';
  return a.accountLast4 ? `••••${a.accountLast4}${a.ifsc ? ` · ${a.ifsc}` : ''}` : (a.ifsc ?? 'Bank');
}
