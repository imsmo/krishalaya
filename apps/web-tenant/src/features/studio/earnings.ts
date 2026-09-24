// apps/web-tenant/src/features/studio/earnings.ts · PURE helpers for W418 — THE EARNINGS · PC-56 TENANT-7d-money.
//
// W418: *"Royalty is respect with a decimal point — every rupee traced to a course and a learner count."* The API sums the
// royalty LEDGER (0174's `instructor_royalty_lines`) per currency in minor units; this file turns the view into hrefs, keys
// and states, and does NO MONEY MATH — not a sum, not a percentage, not a conversion. Every figure a page prints is a string
// the API sent, formatted by `formatMoneyMinor` at the currency's own scale. Basis points become a percent TEXT by integer
// division for display only (`8000` → `80`, `7550` → `75.5`).
//
// THE RULINGS THE PAGES RELY ON
//   • ONE FIGURE PER CURRENCY. A tenant sells in its own currency; an instructor teaching in two tenants has two desks.
//     Tiles are drawn per `tile.currencyCode`, never added across currencies (6e-1).
//   • HELD IS NAMED. Until the instructor accepts the agreement on record, their leg sits in `hold` and the tile says
//     *held pending agreement* — never "available".
//   • REFUSED BY NAME: W418's *"waiting for the monthly wage-lane run"* clock (no monthly run exists — a payout rides
//     whichever batch the tenant maker prepares), refunds (no course refund path), *"last-computed figures are cached
//     and dated"* (nothing is cached — every read is a live sum) and *Retry* (a page load, 6a's ruling).
import type { EarningsView, EarningsTile, RoyaltyPayoutRefusal, RoyaltyLineState, InstructorAgreement } from '@krishalaya/sdk-js';

/* --------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export const EARNINGS_PATH = '/studio/earnings';
/** W418 — the caller's own, or the finance desk's view of an instructor by id; `cursor` pages the statement. */
export function earningsHref(q: { instructor?: string | null; cursor?: string | null } = {}): string {
  const sp = new URLSearchParams();
  if (q.instructor) sp.set('instructor', q.instructor);
  if (q.cursor) sp.set('cursor', q.cursor);
  const s = sp.toString();
  return s.length ? `${EARNINGS_PATH}?${s}` : EARNINGS_PATH;
}
export const PAYOUT_PATH = `${EARNINGS_PATH}/payout`;
export const AGREEMENT_PATH = `${EARNINGS_PATH}/agreement`;
export const RULE_PATH = `${EARNINGS_PATH}/rule`;
export const EXPORTS_PATH = `${EARNINGS_PATH}/exports`;
export function exportHref(id: string): string { return `${EXPORTS_PATH}/${encodeURIComponent(id)}`; }
export function exportDownloadHref(id: string, token: string): string { return `${exportHref(id)}/download?token=${encodeURIComponent(token)}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* W418 · THE SIX STATES                                                                                     */
/* --------------------------------------------------------------------------------------------------------- */

/** ready · empty (a desk with no paid enrollment yet) · noProfile (an author with no instructor row) · restricted (not this
 *  person's money) · notEnabled (the flag, W418's *"Flagged off — Earnings disabled"*) · error (+ Retry as a page load). */
export type EarningsState = 'ready' | 'empty' | 'noProfile' | 'restricted' | 'notEnabled' | 'error';
export function earningsState(code: string | null | undefined, status: number | undefined, view: EarningsView | null): EarningsState {
  if (view) return view.tiles.length === 0 ? 'empty' : 'ready';
  if (code === 'EARNINGS_DISABLED') return 'notEnabled';
  if (code === 'INSTRUCTOR_NOT_FOUND') return 'noProfile';
  if (code === 'FORBIDDEN' || code === 'EDUCATION_FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || code === 'FEATURE_DISABLED' || status === 404) return 'notEnabled';
  return 'error';
}
export function earningsStateKey(s: EarningsState): string { return `earnings.state.${s}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* TILES AND SHARES                                                                                          */
/* --------------------------------------------------------------------------------------------------------- */

/** W418's three tiles and the four this platform adds because the ledger holds them. */
export const EARNINGS_TILES = ['gross', 'instructor', 'tenant', 'platform', 'held', 'paidOut', 'available'] as const;
export type EarningsTileName = (typeof EARNINGS_TILES)[number];
export function tileLabelKey(t: EarningsTileName): string { return `earnings.tile.${t}`; }
/** The MINOR-unit string the API sent for a tile, over a window. Lifetime only for the three money-out tiles (a payout has no month). */
export function tileMinor(tile: EarningsTile, name: EarningsTileName, window: 'mtd' | 'lifetime'): string | null {
  if (name === 'paidOut') return window === 'lifetime' ? tile.paidOut : null;
  if (name === 'available') return window === 'lifetime' ? tile.available : null;
  const f = window === 'mtd' ? tile.mtd : tile.lifetime;
  if (!f) return '0';
  switch (name) {
    case 'gross': return f.gross;
    case 'instructor': return f.instructor;
    case 'tenant': return f.tenant;
    case 'platform': return f.platform;
    case 'held': return f.held;
  }
}
/** Basis points as percent text for a LABEL — integer arithmetic, one decimal at most, never a float: 8000 → `80`, 7550 → `75.5`. */
export function shareText(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0) return '?';
  const whole = Math.floor(bps / 100);
  const tenth = Math.floor((bps % 100) / 10);
  const rest = bps % 10;
  if (tenth === 0 && rest === 0) return String(whole);
  return rest === 0 ? `${whole}.${tenth}` : `${whole}.${String(bps % 100).padStart(2, '0')}`;
}
/** A negative available reads as a DEFECT, printed as such — never clamped to zero (the API does not clamp either). */
export function availableState(minor: string): 'positive' | 'zero' | 'negative' {
  if (/^-/.test(minor)) return 'negative';
  return /^0+$/.test(minor) ? 'zero' : 'positive';
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE STATEMENT, THE PAYOUTS, THE AGREEMENT                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

export const LINE_STATES: readonly RoyaltyLineState[] = ['paid_to_wallet', 'held_pending_agreement', 'released'];
export function lineStateKey(s: RoyaltyLineState): string { return `earnings.line.${s}`; }
/** The plane's payout statuses, as W418 reads them: queued/processing are *pending*, success *paid*, failed/reversed/cancelled by name. */
export function payoutStatusKey(status: string): string {
  return ['queued', 'processing', 'success', 'failed', 'reversed', 'cancelled'].includes(status) ? `earnings.payout.status.${status}` : 'earnings.payout.status.unknown';
}
/** A queued royalty payout is waiting for a BATCH (never claimed unbatched) — the sentence says which stage it is at. */
export function payoutStageKey(p: { status: string; batchId: string | null; batchStatus: string | null }): string {
  if (p.status !== 'queued') return payoutStatusKey(p.status);
  if (!p.batchId) return 'earnings.payout.stage.awaitingBatch';
  if (p.batchStatus === 'pending_approval') return 'earnings.payout.stage.awaitingChecker';
  if (p.batchStatus === 'approved' || p.batchStatus === 'executing') return 'earnings.payout.stage.approved';
  return 'earnings.payout.stage.batched';
}
export function agreementStatusKey(s: InstructorAgreement['status']): string { return `earnings.agreement.status.${s}`; }
export function payoutRefusalKey(r: RoyaltyPayoutRefusal | string): string { return `earnings.payout.refusal.${r}`; }
export const EARNINGS_REFUSED_BY_NAME = ['monthlyLaneClock', 'refunds', 'cachedFigures', 'retry'] as const;
export function earningsRefusedKey(n: (typeof EARNINGS_REFUSED_BY_NAME)[number]): string { return `earnings.refused.${n}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE CHAINS                                                                                                */
/* --------------------------------------------------------------------------------------------------------- */

export const PAYOUT_FIELDS = ['amountMinor', 'currencyCode', 'bankAccountId'] as const;
export const AGREEMENT_FIELDS = ['act', 'agreement', 'instructor', 'shareBps', 'termsNote'] as const;
export const RULE_FIELDS = ['act', 'rule', 'shareBps', 'note'] as const;
export const AGREEMENT_ACTS = ['accept', 'decline', 'offer', 'supersede'] as const;
export type AgreementChainAct = (typeof AGREEMENT_ACTS)[number];
export function agreementChainAct(raw: string | null | undefined): AgreementChainAct | null { return (AGREEMENT_ACTS as readonly string[]).includes(raw ?? '') ? (raw as AgreementChainAct) : null; }
export const RULE_ACTS = ['propose', 'approve', 'reject'] as const;
export type RuleChainAct = (typeof RULE_ACTS)[number];
export function ruleChainAct(raw: string | null | undefined): RuleChainAct | null { return (RULE_ACTS as readonly string[]).includes(raw ?? '') ? (raw as RuleChainAct) : null; }

/**
 * The amount as the instructor TYPES it (major units, the way a person writes money) → the minor-unit string the API
 * takes, at the currency's own scale. Digit moving, not arithmetic: `149.5` at 2 → `14950`; `5160` at 0 → `5160`;
 * `1.005` at 2 → null (not an amount in that currency). This is the ONE place the console touches a money string, and
 * it is a re-scaling the API validates again (`AMOUNT_INVALID`) — never a computed figure.
 */
export function majorToMinorText(major: string | null | undefined, minorUnits: number): string | null {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 6) return null;
  const s = (major ?? '').trim();
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > minorUnits) return null;
  const joined = `${m[1]}${frac.padEnd(minorUnits, '0')}`.replace(/^0+(?=\d)/, '');
  return /^0+$/.test(joined) ? null : joined;
}
/** Percent text a finance person types (`75` · `75.5`) → basis points. Null for anything that is not a percent in [0, 100]. */
export function percentToBps(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim();
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps > 10000 ? null : bps;
}
