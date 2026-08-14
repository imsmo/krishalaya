// apps/web-tenant/src/features/wallet/org-console.ts · W143's cards and W144's ledger view as PURE rules
// (PC-56 TENANT-4a). No React, no I/O, no SDK runtime — unit- and mutation-tested, and the API re-enforces
// every one of them.

/** The three accounts, in the order W143 draws them. */
export const ORG_ACCOUNTS = ['main', 'commission', 'hold'] as const;
export type OrgAccount = (typeof ORG_ACCOUNTS)[number];

/** THE FIGURE A CARD PRINTS is always the ledger's own sum — never the cached balance, even when the two
 *  agree. If they disagree the card still prints the ledger and says so; a money screen that silently
 *  preferred a cache would show a number nobody could reconstruct from the book. */
export type BalanceVerdict =
  | { kind: 'reconciled'; minor: string }
  | { kind: 'drifted'; minor: string; cachedMinor: string; driftMinor: string }
  | { kind: 'never_used'; minor: '0' };

export function cardMinor(v: BalanceVerdict): string {
  return v.kind === 'never_used' ? '0' : v.minor;
}

/** The one-word state under each card. `never_used` is NOT "₹0" with no explanation: an account row is
 *  created on first use, so its absence means this kind of money has never moved for this tenant. */
export type CardState = 'reconciled' | 'drifted' | 'never_used';
export function cardState(v: BalanceVerdict): CardState { return v.kind; }

/** Does this card need a warning banner? Drift is the only state that does — and it is deliberately not
 *  styled as an error either, because a stale cache is a reconciliation matter, not lost money. */
export function needsDriftNotice(v: BalanceVerdict): boolean { return v.kind === 'drifted'; }

/** W143's hold card. `no_freeze_path` is the sentence the screen prints instead of a plausible number:
 *  no code path anywhere freezes tenant money (TENANT-3b — escrow holds the buyer's gross for the whole
 *  order, and there is no partial freeze). */
export type HoldBasis = 'no_freeze_path' | 'frozen_by_ledger';
export function holdNoteKey(basis: HoldBasis): 'wal.holdNoFreezePath' | 'wal.holdFrozen' {
  return basis === 'no_freeze_path' ? 'wal.holdNoFreezePath' : 'wal.holdFrozen';
}

/** W143's ledger-health panel. Three checks, three vocabularies:
 *   ok / attention        — a tenant-checkable fact about the tenant's own book;
 *   unverifiable          — we looked and could not conclude (no entries, or a window with no anchor).
 *                           This must NEVER render as a tick: "not checked" and "intact" are different
 *                           sentences and only one of them is true;
 *   not_ours_to_assert    — platform-wide reconciliation over one shared ledger. The platform runs it;
 *                           restating "0 breaks" here would be this FPO vouching for every other one. */
export type HealthCheck = 'cached_vs_ledger' | 'own_chain' | 'platform_recon';
export type HealthState = 'ok' | 'attention' | 'unverifiable' | 'not_ours_to_assert';

export function healthIcon(state: HealthState): '✓' | '!' | '?' | '·' {
  if (state === 'ok') return '✓';
  if (state === 'attention') return '!';
  if (state === 'unverifiable') return '?';
  return '·';
}

export function healthLabelKey(check: HealthCheck): string { return `wal.health.${check}`; }

/** The chain verdict, as the phrase beside it. An `incomplete` walk is its own word — the canon's
 *  "Hash chain intact" is only printable when the walk was anchored AND the account's head pointer
 *  agrees with the last entry we saw (a truncation attack passes the walk and fails only there). */
export type ChainVerdictKind = 'intact' | 'hash_mismatch' | 'chain_break' | 'incomplete' | 'empty';
export function chainPhraseKey(kind: ChainVerdictKind, headMatches: boolean | null): string {
  if (kind === 'intact') return headMatches === false ? 'wal.chain.headMismatch' : 'wal.chain.intact';
  return `wal.chain.${kind === 'hash_mismatch' ? 'hashMismatch' : kind === 'chain_break' ? 'chainBreak' : kind}`;
}

/** W143's escrow card. Zero is shown WITH its basis, never omitted: "no buyer money is currently held for
 *  you" is information an FPO wants on the day it is true. */
export function escrowNoteKey(heldMinor: string): 'wal.escrowHeld' | 'wal.escrowNone' {
  return BigInt(heldMinor || '0') > 0n ? 'wal.escrowHeld' : 'wal.escrowNone';
}

/* ------------------------------------------------------------------------------------------------
 * W144: the ledger view
 * ---------------------------------------------------------------------------------------------- */

/** The account filter accepts only the three known codes; anything else means "all accounts" rather
 *  than an error page, so a hand-edited URL degrades instead of failing. */
export function accountFilter(v: string | undefined | null): OrgAccount | null {
  return v && (ORG_ACCOUNTS as readonly string[]).includes(v) ? (v as OrgAccount) : null;
}

/** The default window W144 names ("Last 30 days"), computed here so the screen and the export agree. */
export function defaultWindow(now: Date): { from: string; to: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function isIsoDate(v: string | undefined | null): boolean {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

/** A window a caller asked for, bounded. The server clamps too (and reports the clamp on the export
 *  receipt) — this is the screen refusing to ASK for a decade of partitions, not the only guard. */
export const WINDOW_MAX_DAYS = 366;
export function windowDays(from: string, to: string): number | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
export function isAllowedWindow(from: string, to: string): boolean {
  const d = windowDays(from, to);
  return d !== null && d >= 0 && d <= WINDOW_MAX_DAYS;
}

/** The direction word beside a signed amount. `zero` cannot occur (the column has CHECK amount <> 0) and
 *  is still its own case rather than being folded into 'credit'. */
export function direction(amountMinor: string): 'credit' | 'debit' | 'zero' {
  const v = BigInt(amountMinor);
  return v > 0n ? 'credit' : v < 0n ? 'debit' : 'zero';
}

/** A reference, as a link the console can actually open — or as plain text when there is no built route
 *  for that reference type. A row that linked to a 404 would be worse than a row that did not link. */
export const REFERENCE_ROUTES: Record<string, string> = {
  order: '/orders',
  payout: '/payouts',
  payment: '/orders',
  dispute: '/disputes',
  return: '/returns',
  invoice: '/invoices',
};

export function referenceHref(referenceType: string | null, referenceId: string | null): string | null {
  if (!referenceType || !referenceId) return null;
  const base = REFERENCE_ROUTES[referenceType];
  return base ? `${base}/${encodeURIComponent(referenceId)}` : null;
}

/** W144: "There is no edit anywhere on this screen by design — mistakes are corrected by reversal
 *  transactions." The ledger is append-only three layers down (0077 revoked writes from kv_app and made
 *  the table append-only by trigger); this constant is what the spec asserts so a future edit control
 *  cannot be added quietly. */
export const LEDGER_HAS_NO_EDIT = true;

/** Every W143 affordance with no backend, and the sentence the screen shows in its place. Named by code
 *  so the API payload, this file and the page can never drift into three different explanations. */
export type OrgWalletGap = 'add_funds' | 'payout_bank_change' | 'tenant_hold_freeze';
export function gapNoteKey(gap: OrgWalletGap): string { return `wal.gap.${gap}`; }
export function isGapNamed(gaps: readonly string[], gap: OrgWalletGap): boolean { return gaps.includes(gap); }

/** The export button's precondition. Withholding it (rather than letting the API refuse) keeps an operator
 *  from learning that a control is decorative — and the row says which precondition is missing. */
export function exportBlockedBy(
  state: { rowsInView: number; window: { from: string; to: string } },
  perms: { canView: boolean },
): 'noPermission' | 'windowTooWide' | 'nothingToExport' | null {
  if (!perms.canView) return 'noPermission';
  if (!isAllowedWindow(state.window.from, state.window.to)) return 'windowTooWide';
  if (state.rowsInView === 0) return 'nothingToExport';
  return null;
}

/** The refusal names the API can return on export, translated by NAME on the screen. */
export function exportRefusalKey(code: string): string {
  return code === 'WALLET_EXPORT_TOO_LARGE' ? 'wal.err.exportTooLarge' : 'wal.err.exportFailed';
}
