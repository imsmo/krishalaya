// apps/web-tenant/src/features/disputes/console.ts · W140's queue, W141's money card, W142's returns queue and the
// refund gate — as PURE rules (PC-56 TENANT-3b). No React, no I/O, no SDK runtime: every rule here is unit- and
// mutation-tested, and the API re-enforces each one (we reflect, never grant).

export const DISPUTE_TABS = ['all', 'needs_response', 'under_review', 'escalated', 'closed'] as const;
export type DisputeTab = (typeof DISPUTE_TABS)[number];

export function isDisputeTab(v: string | undefined): v is DisputeTab {
  return v !== undefined && (DISPUTE_TABS as readonly string[]).includes(v);
}

/** A tab link NEVER carries the cursor — a keyset cursor is a position in ONE ordered set (the roster rule, held for
 *  the fourth module). */
export function disputeTabHref(tab: DisputeTab): string {
  return tab === 'all' ? '/disputes' : `/disputes?view=${tab}`;
}

/** W140's SLA cell. `null` = no clock to show: a closed dispute, an escalated one (the platform owns that clock, and
 *  W140 prints the word "platform" there), or one with no due date. A countdown nobody must meet is decoration. */
export type SlaCell = { kind: 'left'; hours: number } | { kind: 'overdue'; hours: number } | { kind: 'platform' } | null;

export function slaCell(status: string, slaDueAt: string | null, now: Date): SlaCell {
  if (status === 'escalated') return { kind: 'platform' };
  if (status === 'resolved' || status === 'rejected' || status === 'withdrawn') return null;
  if (!slaDueAt) return null;
  const ms = new Date(slaDueAt).getTime() - now.getTime();
  const hours = Math.floor(Math.abs(ms) / 3_600_000);
  return ms <= 0 ? { kind: 'overdue', hours } : { kind: 'left', hours };
}

/** W140's "Disputed value" column. **AN UNRECORDED SCOPE IS NOT ZERO AND IS NOT THE ORDER TOTAL.** 0139 never
 *  backfills the column, so rows raised before it — or raised without a figure — say so in words. */
export type DisputedValue = { kind: 'amount'; minor: string } | { kind: 'not_recorded' };

export function disputedValue(row: { disputedAmountMinor: string | null }): DisputedValue {
  const raw = row.disputedAmountMinor;
  if (raw == null || raw === '' || BigInt(raw) <= 0n) return { kind: 'not_recorded' };
  return { kind: 'amount', minor: raw };
}

/** The i18n key for W141's money-state basis. Exhaustive over the three bases the API can return, so a new basis
 *  cannot reach the screen without an explanation written for it. */
export function moneyBasisKey(basis: string): 'escrowGross' | 'settledBefore' | 'noPayment' | 'unknown' {
  if (basis === 'escrow_holds_order_gross') return 'escrowGross';
  if (basis === 'settled_to_seller_before_dispute') return 'settledBefore';
  if (basis === 'no_escrowed_payment') return 'noPayment';
  return 'unknown';
}

/** The refund gate, as the sentence the operator needs and the button they may press.
 *  `canAct` is FALSE for every state except the two where money may actually move — a button that 403s teaches an
 *  operator that permissions are decorative (the TENANT-2a/PC-55 rule). */
export interface GateView { key: string; canRefund: boolean; canPropose: boolean; canDecide: boolean }

export function gateView(gate: string): GateView {
  switch (gate) {
    case 'single_signature': return { key: 'singleSignature', canRefund: true, canPropose: false, canDecide: false };
    case 'ready':            return { key: 'ready', canRefund: true, canPropose: false, canDecide: false };
    case 'needs_proposal':   return { key: 'needsProposal', canRefund: false, canPropose: true, canDecide: false };
    case 'awaiting_checker': return { key: 'awaitingChecker', canRefund: false, canPropose: false, canDecide: true };
    case 'rejected_by_checker': return { key: 'rejectedByChecker', canRefund: false, canPropose: true, canDecide: false };
    // A signature is for an AMOUNT. Changing the figure means proposing again, not re-using the old approval.
    case 'amount_changed':   return { key: 'amountChanged', canRefund: false, canPropose: true, canDecide: false };
    case 'already_applied':  return { key: 'alreadyApplied', canRefund: false, canPropose: false, canDecide: false };
    default:                 return { key: 'unknown', canRefund: false, canPropose: false, canDecide: false };
  }
}

/** Whether the operator holding the console may be the one to sign THIS proposal. The maker may not be the checker
 *  (0139's CHECK, the service, and here — three layers for the one rule the plane exists for). */
export function canSign(proposedBy: string | null | undefined, meId: string | null | undefined, canRefundPerm: boolean): boolean {
  return canRefundPerm && !!meId && !!proposedBy && meId !== proposedBy;
}

/** W142's row actions, over the six-state return machine, with 0139's two new preconditions on the money leg:
 *  the parcel must have been inspected, and the return must carry a recorded amount. `in_transit` stays a BUYER act. */
export type ReturnAction = 'approve' | 'reject' | 'receive' | 'inspect' | 'refund';

export function returnActions(
  row: { status: string; inspectedAt: string | null; refundAmountMinor: string | null },
  perms: { canResolve: boolean; canRefund: boolean },
): ReturnAction[] {
  const out: ReturnAction[] = [];
  if (row.status === 'requested') { out.push('approve', 'reject'); return out; }
  if (row.status === 'approved') { out.push('reject'); return out; }
  if (row.status === 'in_transit') { out.push('receive'); return out; }
  if (row.status === 'received') {
    if (!row.inspectedAt) out.push('inspect');
    // The refund needs the money key AND an inspection AND an amount. Each missing piece is SAID on the row
    // (`refundBlockedBy`) rather than shown as a button that fails.
    else if (perms.canRefund && row.refundAmountMinor) out.push('refund');
  }
  return out;
}

/** Why the refund button is absent on a received return — so the row explains itself instead of looking stuck. */
export function refundBlockedBy(
  row: { status: string; inspectedAt: string | null; refundAmountMinor: string | null },
  perms: { canRefund: boolean },
): 'notReceived' | 'notInspected' | 'noAmount' | 'noPermission' | null {
  if (row.status !== 'received') return row.status === 'refunded' || row.status === 'rejected' ? null : 'notReceived';
  if (!row.inspectedAt) return 'notInspected';
  if (!row.refundAmountMinor) return 'noAmount';
  if (!perms.canRefund) return 'noPermission';
  return null;
}

/** A median of null is "nothing closed in the window", which is a different fact from "0 hours". */
export function medianText(hours: number | null): { kind: 'value'; hours: number } | { kind: 'noBasis' } {
  return hours == null ? { kind: 'noBasis' } : { kind: 'value', hours };
}
