// apps/mobile/src/features/wallet/wallet-home.ts · PURE presenters for the wallet HUB (screen 19). No React/native
// (SDK types are `import type` → erased), so this is unit-tested in node. Money is bigint minor-unit strings
// end-to-end (Law 2) — every sum uses BigInt, never a float. Every figure is derived ONLY from server data; the
// client invents nothing (a datum the API can't supply degrades to '—' / 'hold' in the screen, never a fake).
import type { InsightBucket, PayoutSummary, WalletLedgerEntry } from '@krishalaya/sdk-js';
import { paymentOutcome } from '../../core/payments/money';

/** Current calendar month as the read-model's bucket key ('YYYY-MM'), in the given timezone-naive `now`. Pure. */
export function currentYearMonth(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** The signed minor total for one month bucket (earnings/spending read-model keys by 'YYYY-MM'). '0' when the
 * month has no bucket yet — never fabricated. */
export function monthBucketMinor(byMonth: InsightBucket[] | undefined, ymKey: string): string {
  const hit = (byMonth ?? []).find((b) => b.key === ymKey);
  return hit?.amountMinor ?? '0';
}

/** Sum of payouts still IN FLIGHT (server status maps to 'pending' — not yet settled/failed). This is the real
 * "pending money movement" figure (withdrawals the bank hasn't confirmed). BigInt sum (Law 2). */
export function pendingPayoutMinor(payouts: PayoutSummary[]): string {
  let sum = 0n;
  for (const p of payouts) {
    if (paymentOutcome(p.status) !== 'pending') continue;
    try { sum += BigInt(p.amountMinor ?? '0'); } catch { /* skip a malformed row, never crash */ }
  }
  return sum.toString();
}

export type LedgerKind = 'in' | 'out' | 'hold';

/** Classify a ledger entry into the row's visual kind. A negative amount whose type is a reservation
 * (escrow / EMD / hold / reserve) is a HOLD (money parked, not spent); any other debit is OUT; a credit is IN.
 * Derived only from the server's signed amount + txnType — pure, BigInt sign (never float). */
export function ledgerKind(entry: { amountMinor: string; txnType: string | null }): LedgerKind {
  let v: bigint;
  try { v = BigInt(entry.amountMinor); } catch { v = 0n; }
  if (v >= 0n) return 'in';
  const t = (entry.txnType ?? '').toLowerCase();
  return /hold|escrow|emd|reserve|lock/.test(t) ? 'hold' : 'out';
}

/** The recent-transactions slice for the hub: the first `n` ledger entries (server order = newest first). Pure. */
export function recentLedger(items: WalletLedgerEntry[], n = 5): WalletLedgerEntry[] {
  return items.slice(0, Math.max(0, n));
}
