// modules/payments/domain/org-wallet.ts · W143/W144's rules as PURE functions (PC-56 TENANT-4a).
// The FPO's own three accounts, what each one MEANS, what is actually verifiable about them, and what
// is not. No I/O, no Nest, no SQL — unit- and mutation-tested, and the read-model composes from here.
import type { ChainVerdict } from '../../../core/wallet/hash-chain';

/** The tenant's chart of accounts, in the order W143 draws them. Mirrors core/wallet/account-codes'
 *  `TenantAccount` — and this list is the ONLY thing a caller may name; an account code arriving from
 *  a request is refused, because the read funnel resolves accounts from the tenant context alone. */
export const TENANT_ACCOUNT_CODES = ['main', 'commission', 'hold'] as const;
export type TenantAccountCode = (typeof TENANT_ACCOUNT_CODES)[number];

export function isTenantAccountCode(v: string | undefined | null): v is TenantAccountCode {
  return !!v && (TENANT_ACCOUNT_CODES as readonly string[]).includes(v);
}

/** WHO WRITES EACH ACCOUNT — a registry in code, not a column, for the same reason 3c-2's charge
 *  surfaces are: "which code path moves this money" is a fact about the codebase, and a data column
 *  claiming it would drift the moment a new module posted a leg. `hold` names NO writer, and that is
 *  the honest answer W143's third card needs rather than a plausible number.
 *
 *  Verified 2026-08-12 by grepping every `kind: 'tenant'` AccountRef construction in apps/. */
export const TENANT_ACCOUNT_WRITERS: Record<TenantAccountCode, readonly string[]> = {
  main: ['dairy.milk_bill', 'schemes.disbursal', 'fintech.loan_disbursal', 'fintech.loan_application'],
  commission: ['orders.completed', 'disputes.resolved', 'returns.refunded'],
  hold: [],
};

export type HoldBasis = 'no_freeze_path' | 'frozen_by_ledger';

/** Why the hold card shows what it shows. A non-zero hold balance would mean somebody built a freeze
 *  path after this wave and did not update this registry — so the basis is derived from the BALANCE as
 *  well as the registry, never from the registry alone. */
export function holdBasis(holdMinor: string): HoldBasis {
  return BigInt(holdMinor) === 0n && TENANT_ACCOUNT_WRITERS.hold.length === 0 ? 'no_freeze_path' : 'frozen_by_ledger';
}

/* ------------------------------------------------------------------------------------------------
 * BALANCE TRUTH: the cached figure, the ledger sum, and the difference between them
 * ---------------------------------------------------------------------------------------------- */

export interface AccountTruth {
  code: TenantAccountCode;
  exists: boolean;              // an account row is created on first use; absent = never used
  cachedMinor: string;          // wallet_accounts.cached_balance_minor
  ledgerSumMinor: string;       // SUM(ledger_entries.amount_minor) for this account
  isFrozen: boolean;
  lastEntryHash: string | null;
}

export type BalanceVerdict =
  | { kind: 'reconciled'; minor: string }
  /** The cache and the book disagree. THE LEDGER IS THE FIGURE SHOWN — never the cache — and the
   *  drift is stated, because a balance quietly taken from a cache that is wrong is the one number on
   *  this screen nobody could later reconstruct. */
  | { kind: 'drifted'; minor: string; cachedMinor: string; driftMinor: string }
  /** No account row and no entries: this account has never been used. Zero WITH a basis, not a number
   *  standing in for "we don't know". */
  | { kind: 'never_used'; minor: '0' };

export function balanceVerdict(a: AccountTruth): BalanceVerdict {
  if (!a.exists) return { kind: 'never_used', minor: '0' };
  const cached = BigInt(a.cachedMinor);
  const sum = BigInt(a.ledgerSumMinor);
  if (cached === sum) return { kind: 'reconciled', minor: sum.toString() };
  return { kind: 'drifted', minor: sum.toString(), cachedMinor: cached.toString(), driftMinor: (cached - sum).toString() };
}

/** The figure a screen prints for an account, whatever the verdict — always the ledger's own sum. */
export function shownMinor(v: BalanceVerdict): string {
  return v.kind === 'drifted' ? v.minor : v.minor;
}

/* ------------------------------------------------------------------------------------------------
 * LEDGER HEALTH: only what a TENANT can honestly assert about its own money
 * ---------------------------------------------------------------------------------------------- */

export type HealthCheckKey = 'cached_vs_ledger' | 'own_chain' | 'platform_recon';
export type HealthState = 'ok' | 'attention' | 'unverifiable' | 'not_ours_to_assert';

export interface HealthLine { check: HealthCheckKey; state: HealthState; detail?: string }

/** W143's "Ledger health" panel, reduced to the two questions a tenant can answer about itself plus
 *  the one it cannot. The canon's third line — "Nightly reconciliation vs gateway: last run 02:10,
 *  0 breaks" — is a PLATFORM run over one shared book (reconciliation_runs is unscoped by design and
 *  lives behind admin-api, Law 11). Restating "0 breaks" in a tenant console would be this tenant
 *  vouching for every other FPO's money, so it is reported as `not_ours_to_assert` with a sentence
 *  saying who does run it. Silence would have been the other option; silence reads as "not checked". */
export function healthLines(accounts: readonly AccountTruth[], chain: ChainVerdict | null, chainHeadMatches: boolean | null): HealthLine[] {
  const used = accounts.filter((a) => a.exists);
  const drifted = used.map(balanceVerdict).filter((v) => v.kind === 'drifted');
  const cachedLine: HealthLine = used.length === 0
    ? { check: 'cached_vs_ledger', state: 'unverifiable', detail: 'no_accounts_yet' }
    : drifted.length > 0
      ? { check: 'cached_vs_ledger', state: 'attention', detail: `${drifted.length}` }
      : { check: 'cached_vs_ledger', state: 'ok', detail: `${used.length}` };

  let chainLine: HealthLine;
  if (!chain || chain.kind === 'empty') chainLine = { check: 'own_chain', state: 'unverifiable', detail: 'no_entries' };
  else if (chain.kind === 'incomplete') chainLine = { check: 'own_chain', state: 'unverifiable', detail: chain.reason };
  else if (chain.kind === 'intact') {
    // An intact walk over a truncated chain is still a pass — the head pointer is what catches it.
    chainLine = chainHeadMatches === false
      ? { check: 'own_chain', state: 'attention', detail: 'head_mismatch' }
      : { check: 'own_chain', state: 'ok', detail: `${chain.checked}` };
  } else chainLine = { check: 'own_chain', state: 'attention', detail: chain.kind };

  return [cachedLine, chainLine, { check: 'platform_recon', state: 'not_ours_to_assert' }];
}

/* ------------------------------------------------------------------------------------------------
 * ESCROW: platform-held, this tenant's share of it, computed rather than estimated
 * ---------------------------------------------------------------------------------------------- */

export interface EscrowView { heldMinor: string; orderCount: number; basis: 'ledger_net_by_tenant' }

/** W143's "Escrow (platform-held, not yours yet)". Captures credit the platform escrow account and
 *  completions/refunds debit it, with every leg carrying the tenant of the money-event — so the net
 *  of escrow entries bearing THIS tenant's id is exactly what is still held for it. Exact arithmetic
 *  off the book, and labelled with its basis so the next reader knows it is not a cached projection.
 *  A negative net cannot be shown as held money: it would mean more was released than captured, which
 *  is a reconciliation matter, not a balance — so it clamps to zero and keeps the count honest. */
export function escrowView(netMinor: string, orderCount: number): EscrowView {
  const net = BigInt(netMinor);
  return { heldMinor: (net > 0n ? net : 0n).toString(), orderCount: net > 0n ? orderCount : 0, basis: 'ledger_net_by_tenant' };
}

/* ------------------------------------------------------------------------------------------------
 * THE LEDGER VIEW (W144)
 * ---------------------------------------------------------------------------------------------- */

/** W144 defaults to "Last 30 days" and says filters are date-bounded. The window is bounded on the
 *  SERVER as well as offered as a default, because a ledger with a decade of partitions will answer an
 *  unbounded query by reading every one of them. */
export const LEDGER_WINDOW_MAX_DAYS = 366;
export const LEDGER_WINDOW_DEFAULT_DAYS = 30;

export interface LedgerWindow { fromIso: string; toIso: string; days: number; clamped: boolean }

export function resolveLedgerWindow(from: string | undefined, to: string | undefined, now: Date): LedgerWindow {
  const end = to && !Number.isNaN(Date.parse(to)) ? new Date(to) : now;
  const startRaw = from && !Number.isNaN(Date.parse(from)) ? new Date(from) : new Date(end.getTime() - LEDGER_WINDOW_DEFAULT_DAYS * 86_400_000);
  const maxMs = LEDGER_WINDOW_MAX_DAYS * 86_400_000;
  const clamped = end.getTime() - startRaw.getTime() > maxMs;
  const start = clamped ? new Date(end.getTime() - maxMs) : startRaw;
  return {
    fromIso: start.toISOString(),
    toIso: end.toISOString(),
    days: Math.round((end.getTime() - start.getTime()) / 86_400_000),
    clamped,
  };
}

/** The direction of a ledger row from the tenant's point of view. A signed amount is the truth; this
 *  is only the word beside it. `0` cannot occur (the column has CHECK amount_minor <> 0) — if one ever
 *  appears it is reported as its own case rather than silently called a credit. */
export function entryDirection(amountMinor: string): 'credit' | 'debit' | 'zero' {
  const v = BigInt(amountMinor);
  return v > 0n ? 'credit' : v < 0n ? 'debit' : 'zero';
}

/** W144: "There is no edit anywhere on this screen by design — mistakes are corrected by reversal
 *  transactions." That is enforced three layers down (0077 revoked UPDATE/DELETE from kv_app and 0077's
 *  trigger makes ledger_entries append-only), and this constant is what the screen and its test assert
 *  against, so a future edit control cannot be added without a failing test. */
export const LEDGER_IS_APPEND_ONLY = true;

/* ------------------------------------------------------------------------------------------------
 * WHAT W143 SHOWS THAT DOES NOT EXIST — named here so every surface says the same thing
 * ---------------------------------------------------------------------------------------------- */

export type OrgWalletGap = 'add_funds' | 'payout_bank_change' | 'tenant_hold_freeze';

/** GAP-BACKEND, all three, with the reason each is a refusal rather than a stub:
 *  • add_funds       — no tenant top-up product exists anywhere (payments are order payments; UPI
 *                      mandates are buyer autopay collections). A form that took an amount and had
 *                      nowhere to send it would be the worst kind of surface: one that looks like it
 *                      moved money.
 *  • payout_bank_change — W143 describes owner + checker + a 24h cooling period on changing the payout
 *                      account, "the classic fraud path, closed". There is no tenant payout instrument
 *                      table, no change request, and no cooling period. Naming it keeps the promise
 *                      out of the product until the control is real.
 *  • tenant_hold_freeze — no code path writes a tenant hold entry (TENANT-3b: escrow holds the buyer's
 *                      gross for the whole order; there is no partial freeze). */
export const ORG_WALLET_GAPS: readonly OrgWalletGap[] = ['add_funds', 'payout_bank_change', 'tenant_hold_freeze'];

export function isNamedGap(v: string): v is OrgWalletGap {
  return (ORG_WALLET_GAPS as readonly string[]).includes(v);
}
