// modules/fintech/domain/loan-disbursement.rules.ts · PC-55 A9 — PURE disbursement eligibility.
// A disbursement puts borrowed money into a farmer's account. Once it lands, the loan is real and the farmer
// owes it — so every gate here exists to make sure that only happens when it is genuinely allowed.
export const DISBURSEMENT_SKIP_REASONS = [
  'not_approved', 'cooling_off', 'no_approved_amount', 'no_bank_account', 'already_disbursed',
] as const;
export type DisbursementSkipReason = (typeof DISBURSEMENT_SKIP_REASONS)[number];

export interface DisbursableApplication {
  id: string; borrowerUserId: string; status: string;
  amountApprovedMinor: string | null; coolingOffUntil: string | null;   // ISO instant
  bankAccountId: string | null; alreadyDisbursed: boolean;
}
export type Eligibility =
  | { ok: true; amountMinor: string }
  | { ok: false; reason: DisbursementSkipReason; coolingOffUntil?: string };

/** THE ANTI-PREDATORY GATE (PRD §59.4): a loan may not be disbursed while its cooling-off window is open.
 *  Money in the account is not a decision a farmer can take back, so the window must fully elapse first.
 *  Boundary: the window is OPEN until the instant passes (>= is open), i.e. we never round in the lender's
 *  favour by a millisecond. */
export function coolingOffOpen(coolingOffUntil: string | null, nowMs: number): boolean {
  if (!coolingOffUntil) return false;                     // no window recorded ⇒ nothing to wait for
  const until = Date.parse(coolingOffUntil);
  return Number.isFinite(until) && nowMs < until;
}

export function eligibility(app: DisbursableApplication, nowMs: number): Eligibility {
  if (app.alreadyDisbursed) return { ok: false, reason: 'already_disbursed' };
  if (app.status !== 'approved') return { ok: false, reason: 'not_approved' };
  if (!app.amountApprovedMinor || !/^\d{1,18}$/.test(app.amountApprovedMinor) || BigInt(app.amountApprovedMinor) === 0n) {
    return { ok: false, reason: 'no_approved_amount' };
  }
  if (coolingOffOpen(app.coolingOffUntil, nowMs)) {
    return { ok: false, reason: 'cooling_off', coolingOffUntil: app.coolingOffUntil! };
  }
  // payouts.bank_account_id is NOT NULL (0006): without a verified account the money has nowhere to go.
  if (!app.bankAccountId) return { ok: false, reason: 'no_bank_account' };
  return { ok: true, amountMinor: app.amountApprovedMinor };
}

export interface Split { queued: Array<{ applicationId: string; borrowerUserId: string; amountMinor: string; bankAccountId: string }>; skipped: Array<{ applicationId: string; reason: DisbursementSkipReason; coolingOffUntil?: string }>; totalMinor: string }

/** Partition a candidate set. NOTHING is silently dropped: every application either lands in `queued` or is
 *  listed in `skipped` with the reason (and, for cooling-off, the exact instant it becomes eligible). */
export function planRun(apps: readonly DisbursableApplication[], nowMs: number): Split {
  const queued: Split['queued'] = [];
  const skipped: Split['skipped'] = [];
  for (const app of apps) {
    const e = eligibility(app, nowMs);
    if (e.ok) queued.push({ applicationId: app.id, borrowerUserId: app.borrowerUserId, amountMinor: e.amountMinor, bankAccountId: app.bankAccountId! });
    else skipped.push({ applicationId: app.id, reason: e.reason, ...(e.coolingOffUntil ? { coolingOffUntil: e.coolingOffUntil } : {}) });
  }
  return { queued, skipped, totalMinor: queued.reduce((s, q) => s + BigInt(q.amountMinor), 0n).toString() };
}

/** MAKER ≠ CHECKER: whoever prepares a disbursement run may not confirm it. */
export function canConfirmRun(preparedBy: string, confirmedBy: string): boolean { return preparedBy !== confirmedBy; }

/** The run total must equal the sum of its queued lines — checked before any row is written. */
export function totalsAgree(split: Split): boolean {
  return split.queued.reduce((s, q) => s + BigInt(q.amountMinor), 0n).toString() === split.totalMinor;
}
