// apps/mobile/src/features/wallet/amount-entry.ts · PURE helpers for the money-entry screens (add-money 20,
// withdraw 70). No React/native — unit-tested. The amounts here are whole-RUPEE presets for quick-pick chips
// (display/UX only); the value actually sent to the server is always converted to paise via
// core/payments/money.rupeesToPaiseMinor (BigInt, Law 2). Grouping is for DISPLAY of the typed integer only.
import { formatNumber } from '@krishalaya/i18n';

/** Add-money quick-pick presets (whole rupees), matching the design's chip row. */
export const QUICK_ADD_RUPEES: readonly number[] = [500, 1000, 2000, 5000, 10000];

/** Add-money limits (whole rupees) — mirrors rupeesToPaiseMinor's cap; the server re-validates regardless. */
export const ADD_MIN_RUPEES = 10;
export const ADD_MAX_RUPEES = 200000;

/** Whole-rupee withdrawable ceiling from a paise balance (floor — never round up past the real balance). */
export function maxWithdrawRupees(balanceMinor: string): number {
  let v: bigint;
  try { v = BigInt(balanceMinor); } catch { return 0; }
  if (v <= 0n) return 0;
  return Number(v / 100n); // whole rupees; balance is bounded well within safe-int for display
}

/** Withdraw quick-pick chips: the standard presets that fit under the balance, plus a "Max" = full balance.
 * De-duped + ascending; empty when the balance is zero. The chip's `isMax` lets the screen label it "Max ₹X". */
export interface WithdrawChip { rupees: number; isMax: boolean }
export function withdrawChipRupees(balanceMinor: string, presets: readonly number[] = [1000, 5000, 10000]): WithdrawChip[] {
  const max = maxWithdrawRupees(balanceMinor);
  if (max <= 0) return [];
  const under = presets.filter((p) => p < max).map((rupees) => ({ rupees, isMax: false }));
  return [...under, { rupees: max, isMax: true }];
}

/** Group a typed digit string for the big amount display (e.g. "5000" → "5,000"). Locale-aware; empty stays "0".
 * Display only — NOT money math (the sent value is paise via rupeesToPaiseMinor). */
export function groupDigits(rupees: string, langCode = 'en'): string {
  const clean = (rupees ?? '').replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
  if (clean.length === 0) return formatNumber(0, langCode);
  const n = Number(clean);
  return Number.isFinite(n) ? formatNumber(n, langCode) : '0';
}
