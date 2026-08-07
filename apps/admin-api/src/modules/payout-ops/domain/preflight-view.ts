// apps/admin-api/src/modules/payout-ops/domain/preflight-view.ts · W067's preflight panel, PURE (PC-56 ADMIN-6b).
//
// ---------------------------------------------------------------------------
// WHY THIS LIVES IN admin-api ALONE, AND NOT ALSO IN apps/api
// ---------------------------------------------------------------------------
// I first wrote this file in apps/api's payments module, on the reasoning that the executor should re-check preflight
// before disbursing. That would have made it the SECOND copy of a money rule in two services — the exact defect ADMIN-6
// spent a page of its migration on (three copies of the hash preimage, where a verifier disagreeing with a writer pages
// P0 over a healthy ledger). A preflight that disagreed between the approver and the executor would either strand an
// approved batch for ever or wave through a payout the checker was told was blocked.
//
// So the chain is split by MECHANISM rather than duplicated:
//   • APPROVAL (here, admin-api) — the preflight runs, blocks, and is recorded on the batch. A payout that fails it
//     cannot be inside an approved batch, because `assertApprovable` refuses the batch as a whole.
//   • EXECUTION (apps/api + 0114) — the gate is "is this payout's batch approved", expressed once in SQL and once as a
//     BEFORE UPDATE trigger. No preflight logic, nothing to disagree with.
// Those compose: money can only leave an approved batch, and a batch can only be approved when every payout in it
// passed. THE RESIDUAL GAP IS REAL AND NAMED: a KYC that lapses BETWEEN approval and execution is not caught, because
// nothing re-checks. `preflightDrift` below is what makes it VISIBLE on the batch screen, and an execute-time re-check
// is ADMIN-6b-Q3 — it needs a decision about what happens to the money (a payout refused at execution has already been
// debited from the farmer's wallet), which is a founder-level call and not a thing to infer inside a repository.
//
// ---------------------------------------------------------------------------
// THE DEFECT: FOUR CLAIMS ON THE SCREEN, NONE OF THEM CHECKED AT EXECUTION
// ---------------------------------------------------------------------------
// W067 prints "Preflight PASS · no frozen accounts · no KYC gaps" and "214 · all bank-verified accounts", directly
// above the button that sends the money. `PayoutService.execute` re-checks none of the three:
//
//   1. KYC. `requestPayout` asserts `kyc_status='verified'` on an active role (the S3 review fix) and nothing looks
//      again. A farmer verified in March whose status lapsed to 'expired' in July is paid in August. For a
//      once-off self-serve withdrawal the gap is small; for a BATCH assembled on Monday and approved on Thursday it
//      is the ordinary case.
//   2. `bank_accounts.penny_verified_at`. Never read on the payout path at all. `loan-disbursement.repository.ts`
//      and `coop-payout.repository.ts` both require it before disbursing; payouts do not. "All bank-verified
//      accounts" was a sentence about a column this flow ignores.
//   3. `wallet_accounts.is_frozen`. It blocks a NEGATIVE leg inside wallet-service — but a payout's success legs are
//      `platform payouts −amount` and `platform gateway +amount`. The farmer's own account was debited at REQUEST
//      time. **So freezing a farmer's wallet after they requested a payout does not stop the payout.** The recon
//      console's freeze control and the money leaving are today unconnected, which is worth stating plainly because
//      freezing an account is precisely what an operator does when they suspect the money should not move.
//
// ---------------------------------------------------------------------------
// WHY IT BLOCKS AT APPROVAL RATHER THAN REFUSING AT EXECUTION
// ---------------------------------------------------------------------------
// The reason is where the money already is: `requestPayout` DEBITED THE FARMER'S WALLET when the payout was queued. A
// payout refused at execution and then left alone is money that has left a farmer's visible balance and reached nobody.
// Refusing at the moment of approval costs nothing and is the only moment a human is present.
//
// The checker is a person being shown a figure and asked to sign it. Telling them afterwards that 3 of the 214 could
// not go is telling them after they signed — so a batch containing a blocked payout cannot be approved AT ALL, rather
// than being approved and partially disbursed. A batch approves as a whole because that is what the signature means.
// Who eventually cancels a payout that can never pass, and returns the funds to the wallet, is ADMIN-6b-Q2.
//
// The one thing this module must never do is report `pass` when it does not know. Every unknown is a FAILURE here,
// which is the opposite of the `unknown ≠ zero` rule's usual direction and for the same underlying reason: on the
// read side an unknown must not be printed as a number, and on a money gate an unknown must not be printed as a
// clearance.

/** One payout as the preflight needs to see it. Deliberately narrow: a batch review is not a reason to project 214
 *  farmers' account numbers into an admin process. `bankLast4` is the most the console ever receives. */
export interface PreflightSubject {
  payoutId: string;
  userId: string | null;
  amountMinor: bigint;
  /** From `bank_accounts.penny_verified_at IS NOT NULL` — projected as a boolean by the repository so the timestamp
   *  never crosses into the console. */
  bankVerified: boolean;
  bankLast4: string | null;
  /** `user_tenant_roles.kyc_status` on the most permissive ACTIVE role. Null when the user has no active role at
   *  all, which is a distinct condition from 'rejected' and is reported as such. */
  kycStatus: string | null;
  /** `wallet_accounts.is_frozen` on the payee's main account. */
  walletFrozen: boolean;
  /** The payout's own status. A batch may legitimately contain payouts that have moved on since it was assembled. */
  status: string;
}

export const PREFLIGHT_FAILURES = [
  'no_payee',            // the payout names no user — nothing to verify and nobody to pay
  'kyc_not_verified',    // lapsed, pending, rejected, or never done
  'kyc_unknown',         // no active role in this tenant at all — not the same as a failed check
  'bank_unverified',     // penny_verified_at is NULL
  'wallet_frozen',       // an operator froze this account; the freeze must reach the money door
  'not_payable',         // the payout is no longer queued (already sent, cancelled, reversed)
  'zero_or_negative',    // defensive: the DB CHECK forbids it, and a preflight that trusts a CHECK it did not write
                         // is a preflight that stops being true the day the CHECK is relaxed
] as const;
export type PreflightFailure = (typeof PREFLIGHT_FAILURES)[number];

export interface PreflightLine {
  payoutId: string;
  ok: boolean;
  failures: PreflightFailure[];
  bankLast4: string | null;
}

export interface PreflightResult {
  /** PASS only when every subject passes. W067's panel is a single verdict above 214 rows, and a panel that said
   *  PASS over a set containing one blocked payout would be the most misleading state it could be in. */
  pass: boolean;
  checked: number;
  blocked: number;
  /** Σ of the payouts that CAN go, and Σ of the whole set, kept apart. A checker approving a batch is signing for a
   *  figure; if 3 payouts are blocked, the figure that will actually leave is not the one on the header. */
  payableMinor: bigint;
  totalMinor: bigint;
  /** Every failure code present, with counts — so the panel can say "2 expired KYC, 1 unverified bank" rather than
   *  "3 problems". */
  byFailure: Record<string, number>;
  lines: PreflightLine[];
}

/** KYC values that clear the gate. Exactly one, and it is written as an allow-list rather than a deny-list of the
 *  four failing values: a new `kyc_status` added in a future migration must default to BLOCKED, not to payable. */
const KYC_PASSING = Object.freeze(new Set(['verified']));

/** Check one payout. Returns every failure rather than the first, because a checker fixing a batch needs the whole
 *  list — reporting one at a time turns a review into a loop. */
export function preflightOne(s: PreflightSubject): PreflightLine {
  const failures: PreflightFailure[] = [];

  if (s.status !== 'queued') failures.push('not_payable');
  if (s.amountMinor <= 0n) failures.push('zero_or_negative');

  if (!s.userId) {
    // No payee at all. Reported alone: the KYC and wallet checks are ABOUT a user, and running them against nobody
    // would produce 'kyc_unknown' and 'wallet_frozen: false' — two answers where there is no question.
    failures.push('no_payee');
    return { payoutId: s.payoutId, ok: false, failures, bankLast4: s.bankLast4 };
  }

  if (s.kycStatus === null) failures.push('kyc_unknown');
  else if (!KYC_PASSING.has(s.kycStatus)) failures.push('kyc_not_verified');

  if (!s.bankVerified) failures.push('bank_unverified');
  if (s.walletFrozen) failures.push('wallet_frozen');

  return { payoutId: s.payoutId, ok: failures.length === 0, failures, bankLast4: s.bankLast4 };
}

/** Check a batch. */
export function preflight(subjects: readonly PreflightSubject[]): PreflightResult {
  const lines = subjects.map(preflightOne);
  const byFailure: Record<string, number> = {};
  let payableMinor = 0n;
  let totalMinor = 0n;
  let blocked = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    totalMinor += subjects[i].amountMinor;
    if (l.ok) payableMinor += subjects[i].amountMinor;
    else {
      blocked += 1;
      for (const f of l.failures) byFailure[f] = (byFailure[f] ?? 0) + 1;
    }
  }

  return {
    // AN EMPTY SET DOES NOT PASS. W067 has a state for it — "Batch empty — batches build from settlement/wage runs,
    // an empty batch cannot be approved" — and `lines.every(ok)` over nothing is `true`, which would let a checker
    // approve a run that will disburse nothing and mark it executed.
    pass: lines.length > 0 && blocked === 0,
    checked: lines.length,
    blocked,
    payableMinor,
    totalMinor,
    byFailure,
    lines,
  };
}

/** The stored form. `preflight` is written to `payout_batches.preflight` at approval time so a later disagreement is
 *  visible rather than absorbed — the same reasoning as 0112 keeping a listing's hold-time value beside the
 *  recomputed one. bigints become STRINGS: jsonb has no bigint, and `JSON.stringify` throws on one rather than
 *  quietly losing it, which is the one helpful thing it does with money. */
export function preflightForStorage(r: PreflightResult): Record<string, unknown> {
  return {
    v: 1,
    pass: r.pass,
    checked: r.checked,
    blocked: r.blocked,
    payableMinor: r.payableMinor.toString(),
    totalMinor: r.totalMinor.toString(),
    byFailure: r.byFailure,
    // The blocked payout IDS only. Storing all 214 lines would put a copy of the batch inside the batch row, and the
    // ones that passed are recoverable from the payouts themselves; the ones that were blocked are the finding.
    blockedPayoutIds: r.lines.filter((l) => !l.ok).map((l) => l.payoutId),
  };
}

/** Did the recorded preflight and a fresh one reach the same verdict on the same money?
 *
 *  Called when rendering an APPROVED batch: between approval and execution a payout can be cancelled, a wallet can be
 *  frozen, a KYC can lapse. A console that only ever showed the live figure would silently redraw what the checker
 *  signed; one that only ever showed the stored figure would hide a freeze applied five minutes ago. Both, with the
 *  disagreement named.
 */
export function preflightDrift(
  stored: { payableMinor?: unknown; blocked?: unknown } | null | undefined,
  fresh: PreflightResult,
): { drifted: boolean; reason?: 'payable_changed' | 'blocked_changed' | 'no_record' } {
  if (!stored) return { drifted: true, reason: 'no_record' };
  const storedPayable = typeof stored.payableMinor === 'string' ? stored.payableMinor : null;
  // A stored record whose shape we cannot read is treated as no record. Guessing at it would be a claim about what a
  // human approved, which is the one thing here that must not be inferred.
  if (storedPayable === null) return { drifted: true, reason: 'no_record' };
  if (storedPayable !== fresh.payableMinor.toString()) return { drifted: true, reason: 'payable_changed' };
  if (typeof stored.blocked === 'number' && stored.blocked !== fresh.blocked) {
    return { drifted: true, reason: 'blocked_changed' };
  }
  return { drifted: false };
}
