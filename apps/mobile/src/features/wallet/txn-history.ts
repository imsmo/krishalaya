// apps/mobile/src/features/wallet/txn-history.ts · PURE presenters for the transaction-history (21) + payout-
// history (59) screens. No React/native — unit-tested. Money is bigint minor-unit strings end-to-end (Law 2):
// every sum/compare uses BigInt, never a float. Filtering/grouping is derived ONLY from server fields (signed
// amount, txnType, status, createdAt); the client invents nothing.
import type { WalletLedgerEntry, PayoutSummary } from '@krishalaya/sdk-js';
import { paymentOutcome } from '../../core/payments/money';
import { ledgerKind, currentYearMonth } from './wallet-home';

export type LedgerFilter = 'all' | 'in' | 'out' | 'escrow' | 'month';

/** Filter the ledger feed for the transactions chips. 'in' = credits, 'out' = plain debits (not holds),
 * 'escrow' = held/EMD/reserve debits, 'month' = entries in the current UTC month. Pure; `nowMs` injected. */
export function filterLedger(entries: WalletLedgerEntry[], filter: LedgerFilter, nowMs = Date.now()): WalletLedgerEntry[] {
  if (filter === 'all') return entries;
  if (filter === 'month') {
    const ym = currentYearMonth(new Date(nowMs));
    return entries.filter((e) => typeof e.createdAt === 'string' && e.createdAt.slice(0, 7) === ym);
  }
  return entries.filter((e) => {
    const kind = ledgerKind({ amountMinor: e.amountMinor, txnType: e.txnType });
    if (filter === 'in') return kind === 'in';
    if (filter === 'out') return kind === 'out';
    return kind === 'hold'; // escrow
  });
}

export interface LedgerTotals { inMinor: string; outMinor: string; netMinor: string }

/** Sum credits (in), debits-magnitude (out) and net (in − out) over the given entries. BigInt only (Law 2).
 * Holds are excluded from in/out (money parked, neither earned nor spent) — matching the design's In/Out/Net. */
export function ledgerTotals(entries: WalletLedgerEntry[]): LedgerTotals {
  let inSum = 0n, outSum = 0n;
  for (const e of entries) {
    let v: bigint;
    try { v = BigInt(e.amountMinor); } catch { continue; }
    const kind = ledgerKind({ amountMinor: e.amountMinor, txnType: e.txnType });
    if (kind === 'in' && v > 0n) inSum += v;
    else if (kind === 'out' && v < 0n) outSum += -v;
  }
  return { inMinor: inSum.toString(), outMinor: outSum.toString(), netMinor: (inSum - outSum).toString() };
}

export type DayLabel = 'today' | 'yesterday' | 'date';
export interface DayGroup { key: string; label: DayLabel; iso: string; items: WalletLedgerEntry[] }

/** Group ledger entries by calendar day (UTC), newest day first, preserving server order within a day. The label
 * marks today/yesterday vs an absolute date (the screen formats the date). Pure; `nowMs` injected for tests. */
export function groupLedgerByDay(entries: WalletLedgerEntry[], nowMs = Date.now()): DayGroup[] {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const yesterday = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
  const order: string[] = [];
  const map = new Map<string, WalletLedgerEntry[]>();
  for (const e of entries) {
    const day = typeof e.createdAt === 'string' && e.createdAt.length >= 10 ? e.createdAt.slice(0, 10) : 'unknown';
    if (!map.has(day)) { map.set(day, []); order.push(day); }
    map.get(day)!.push(e);
  }
  return order.map((day) => ({
    key: day,
    label: day === today ? 'today' : day === yesterday ? 'yesterday' : 'date',
    iso: day,
    items: map.get(day)!,
  }));
}

export type PayoutKind = 'success' | 'pending' | 'failed';
/** Map a payout's server status to its row treatment (RECEIVED / HOLD / FAILED). */
export function payoutKind(status?: string | null): PayoutKind {
  return paymentOutcome(status); // 'success' | 'failed' | 'pending'
}

export interface MonthGroup { key: string; items: PayoutSummary[] }
/** Group payouts by 'YYYY-MM' (newest first, server order within a month). The screen formats the month label. */
export function groupPayoutsByMonth(payouts: PayoutSummary[]): MonthGroup[] {
  const order: string[] = [];
  const map = new Map<string, PayoutSummary[]>();
  for (const p of payouts) {
    const m = typeof p.createdAt === 'string' && p.createdAt.length >= 7 ? p.createdAt.slice(0, 7) : 'unknown';
    if (!map.has(m)) { map.set(m, []); order.push(m); }
    map.get(m)!.push(p);
  }
  return order.map((key) => ({ key, items: map.get(key)! }));
}
