// apps/admin-api/src/modules/ledger-correction/domain/correction.ts · W068, PURE (PC-56 ADMIN-5e).
//
// **THIS IS THE SCARIEST SCREEN ON THE PLATFORM.** A human posts a correction leg against a farmer's wallet. Every
// other money movement on Krishalaya is produced by a machine from a business event — an order settles, an escrow
// releases, a commission is taken — and is balanced by construction. This one is somebody typing numbers at 02:14
// because a webhook died, and it is the only path by which a person's balance changes for a reason that exists
// nowhere but in another person's head.
//
// W068 sets out five controls and every one of them is a refusal:
//   1. "Append-only correction transaction. History is never edited; a correction is a NEW zero-sum txn."
//   2. "Correction legs (must sum to zero) … the form will not submit unbalanced."
//   3. "Idempotency key — re-posting with this key is a no-op."
//   4. "Drafting needs `ledger.investigate`; posting needs a DIFFERENT user with `ledger.correct`."
//   5. "Corrections above ₹50,000 additionally page the founder."
//   …and the line underneath: **"There is no delete. A wrong correction is fixed by another correction — the ledger
//   tells the whole story forever."**
//
// WHAT VERIFYING FOUND, AND IT IS THE REASON THIS MODULE IS SMALL. Most of the machinery exists: `WalletAdminPort`
// already posts balanced signed legs idempotently through the wallet-service (the platform's only money writer, which
// hard-fails an unbalanced post), `recon_investigations` is already the case a correction starts from, and
// `ledger_transactions.idempotency_key` is already UNIQUE. What was missing was somewhere to keep a DRAFT — and a
// checker cannot review legs that exist only in somebody's browser.
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import { InvalidCorrectionError, CorrectionNotApprovableError } from './ledger-correction.errors';

export const DRAFT_STATUSES = ['drafting', 'awaiting_checker', 'posted', 'rejected', 'withdrawn'] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const OWNER_KINDS = ['user', 'tenant', 'platform'] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

/** W068: "Corrections above ₹50,000 additionally page the founder." Minor units, because money is never a float and
 *  never a rupee figure in code (Law 2). */
export const FOUNDER_THRESHOLD_MINOR = 5_000_000n;   // ₹50,000.00

/** The verbatim reason is the artefact an auditor reads in five years to understand why somebody moved money by
 *  hand. Twenty characters is not a high bar; it is a bar against "webhook issue". */
export const REASON_MIN = 20;

export interface DraftLeg {
  ownerKind: OwnerKind;
  ownerId: string | null;
  accountCode: string;
  /** Signed minor units as a STRING at the boundary — bigint through the domain. Never a JS number (Law 2). */
  amountMinor: bigint;
  legNote: string | null;
}

export interface CorrectionDraft {
  id: string;
  investigationId: string;
  tenantId: string | null;
  status: DraftStatus;
  currencyCode: string;
  reason: string;
  sourceDocument: string | null;
  idempotencyKey: string;
  makerId: string;
  submittedAt: string | null;
  checkerId: string | null;
  checkedAt: string | null;
  checkerNote: string | null;
  postedTxnId: string | null;
  postedAt: string | null;
  grossMinor: bigint | null;
  legs: DraftLeg[];
}

/* ------------------------------------------------------------------------------------------------ */
/* THE BALANCE                                                                                       */
/* ------------------------------------------------------------------------------------------------ */

export interface Balance {
  /** Σ of signed legs. Zero is the only submittable value. */
  sumMinor: bigint;
  balanced: boolean;
  legCount: number;
  /** Half the sum of absolute amounts — the SIZE of the correction, which is what the founder threshold reads.
   *  Half, because a balanced transfer of ₹12,450 has ₹24,900 of absolute movement and is a ₹12,450 correction. */
  grossMinor: bigint;
}

/** Compute the balance. Total function — never throws, because this drives a live "Σ = …" readout that must render
 *  on every keystroke including the states that are not submittable. */
export function balanceOf(legs: readonly DraftLeg[]): Balance {
  let sum = 0n;
  let abs = 0n;
  for (const l of legs) {
    sum += l.amountMinor;
    abs += l.amountMinor < 0n ? -l.amountMinor : l.amountMinor;
  }
  return { sumMinor: sum, balanced: sum === 0n && legs.length >= 2, legCount: legs.length, grossMinor: abs / 2n };
}

/** A single leg, validated before it can join a draft.
 *
 *  THE OWNER RULE IS NOT COSMETIC. A platform leg (a suspense account) has no owner and a user leg must have one;
 *  getting it wrong means the correction credits the platform's suspense account instead of a named farmer's wallet,
 *  which balances perfectly and is completely wrong. The wallet-service would accept it.
 */
export function assertLeg(raw: {
  ownerKind?: unknown; ownerId?: unknown; accountCode?: unknown; amountMinor?: unknown; legNote?: unknown;
}): DraftLeg {
  const ownerKind = raw.ownerKind;
  if (typeof ownerKind !== 'string' || !(OWNER_KINDS as readonly string[]).includes(ownerKind)) {
    throw new InvalidCorrectionError(`an owner kind must be one of: ${OWNER_KINDS.join(', ')}`);
  }
  const ownerId = typeof raw.ownerId === 'string' && raw.ownerId.trim() ? raw.ownerId.trim() : null;
  if (ownerKind === 'platform' && ownerId) throw new InvalidCorrectionError('a platform leg has no owner');
  if (ownerKind !== 'platform' && !ownerId) throw new InvalidCorrectionError(`a ${ownerKind} leg must name its owner`);

  const accountCode = typeof raw.accountCode === 'string' ? raw.accountCode.trim() : '';
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(accountCode)) throw new InvalidCorrectionError('an account code is required');

  const amountMinor = parseMinor(raw.amountMinor);
  if (amountMinor === 0n) {
    throw new InvalidCorrectionError('a leg amount cannot be zero — a zero leg moves nothing and the wallet-service refuses it');
  }
  const legNote = typeof raw.legNote === 'string' && raw.legNote.trim() ? raw.legNote.trim().slice(0, 300) : null;
  return { ownerKind: ownerKind as OwnerKind, ownerId, accountCode, amountMinor, legNote };
}

/** Parse a signed minor-unit amount.
 *
 *  **A STRING OR A BIGINT, NEVER A NUMBER.** Law 2 exists because IEEE-754 cannot hold every rupee: 2^53 minor units
 *  is about ₹90,071,992,547 — reachable by a platform aiming at ₹1.5 lakh crore GMV — and a float that has silently
 *  lost its last digit still LOOKS like money. A JS number is refused outright rather than coerced, because coercing
 *  it is exactly how a lossy value gets laundered into the ledger.
 */
export function parseMinor(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    throw new InvalidCorrectionError(
      'an amount must be sent as a string of minor units, not a number — a JavaScript number cannot hold every '
      + 'rupee this platform will move, and one that has lost its last digit still looks like money');
  }
  if (typeof v !== 'string' || !/^-?[0-9]{1,18}$/.test(v.trim())) {
    throw new InvalidCorrectionError('an amount must be a whole number of minor units, as a string');
  }
  return BigInt(v.trim());
}

/* ------------------------------------------------------------------------------------------------ */
/* SUBMITTING                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export type SubmitBlock =
  | { ok: true; gross: bigint; needsFounderConfirmation: boolean }
  | { ok: false; reason: 'not_drafting' }
  | { ok: false; reason: 'too_few_legs'; legCount: number }
  | { ok: false; reason: 'unbalanced'; sumMinor: bigint }
  | { ok: false; reason: 'no_reason' };

/** Whether a draft is in a state that could be submitted for approval. Read-side; the assertion below is the gate.
 *
 *  Separated so the console can render W068's "Legs do not balance — Σ = +12,450 ≠ 0" state with the real number in
 *  it, rather than a generic refusal after a round trip.
 */
export function submitState(d: Pick<CorrectionDraft, 'status' | 'reason' | 'legs'>): SubmitBlock {
  if (d.status !== 'drafting') return { ok: false, reason: 'not_drafting' };
  if (typeof d.reason !== 'string' || d.reason.trim().length < REASON_MIN) return { ok: false, reason: 'no_reason' };
  const b = balanceOf(d.legs);
  if (b.legCount < 2) return { ok: false, reason: 'too_few_legs', legCount: b.legCount };
  if (b.sumMinor !== 0n) return { ok: false, reason: 'unbalanced', sumMinor: b.sumMinor };
  return { ok: true, gross: b.grossMinor, needsFounderConfirmation: b.grossMinor >= FOUNDER_THRESHOLD_MINOR };
}

export function assertSubmittable(d: Pick<CorrectionDraft, 'status' | 'reason' | 'legs'>): { gross: bigint; needsFounderConfirmation: boolean } {
  const s = submitState(d);
  if (s.ok) return { gross: s.gross, needsFounderConfirmation: s.needsFounderConfirmation };
  if (s.reason === 'not_drafting') throw new InvalidCorrectionError('this correction is no longer a draft');
  if (s.reason === 'no_reason') {
    throw new InvalidCorrectionError(
      `a reason of at least ${REASON_MIN} characters is required, recorded verbatim — it is the only account of why `
      + 'money moved by hand');
  }
  if (s.reason === 'too_few_legs') {
    throw new InvalidCorrectionError('a correction is a transfer and needs at least two legs');
  }
  throw new InvalidCorrectionError(
    `the legs do not balance: Σ = ${s.sumMinor > 0n ? '+' : ''}${s.sumMinor} minor units, not zero. Add the `
    + 'balancing leg — an unbalanced correction creates or destroys money');
}

/* ------------------------------------------------------------------------------------------------ */
/* APPROVING — the platform's EIGHTH maker-checker site                                              */
/* ------------------------------------------------------------------------------------------------ */

export type ApproveBlock =
  | { ok: true; gross: bigint; needsFounderConfirmation: boolean }
  | { ok: false; reason: 'not_submitted' }
  | { ok: false; reason: 'unbalanced'; sumMinor: bigint }
  | { ok: false; reason: 'already_decided' };

export function approveState(d: Pick<CorrectionDraft, 'status' | 'legs' | 'checkerId'>): ApproveBlock {
  if (d.checkerId) return { ok: false, reason: 'already_decided' };
  if (d.status !== 'awaiting_checker') return { ok: false, reason: 'not_submitted' };
  // RE-CHECKED AT APPROVAL TIME, not trusted from submission. The legs are editable while a draft is being
  // assembled, and a checker approves what is in front of them now — verifying the balance again here means the
  // thing that gets posted is the thing that was balanced, not the thing that was balanced yesterday.
  const b = balanceOf(d.legs);
  if (!b.balanced) return { ok: false, reason: 'unbalanced', sumMinor: b.sumMinor };
  return { ok: true, gross: b.grossMinor, needsFounderConfirmation: b.grossMinor >= FOUNDER_THRESHOLD_MINOR };
}

/**
 * The write-side gate for approving and posting.
 *
 * `founderInformed` IS A CONSENT, NOT A NOTIFICATION. W068 says a correction above ₹50,000 pages the founder, and
 * **the platform cannot page anybody** — 0098's escalation ladder delivers in-app steps only and says so itself. A
 * `notified_founder_at` timestamp would record that we wrote a row, not that a human was woken. So the checker
 * confirms explicitly that they informed the founder out of band, and the audit row records that a person claimed
 * it. That is a weaker control than paging and it is an HONEST one; the alternative is a green tick that means
 * nothing on the largest corrections the platform makes.
 */
export function assertApprovable(
  d: Pick<CorrectionDraft, 'status' | 'legs' | 'checkerId' | 'makerId'>,
  approver: string,
  founderInformed: boolean,
): { gross: bigint } {
  const s = approveState(d);
  if (!s.ok) {
    if (s.reason === 'already_decided') throw new CorrectionNotApprovableError('this correction has already been decided');
    if (s.reason === 'not_submitted') throw new CorrectionNotApprovableError('this correction has not been submitted for approval');
    throw new CorrectionNotApprovableError(
      `the legs no longer balance: Σ = ${s.sumMinor > 0n ? '+' : ''}${s.sumMinor} minor units. They must be fixed and `
      + 're-submitted — a checker cannot approve a correction that would create money');
  }
  assertSecondPerson(
    'posting a manual ledger correction', d.makerId, approver,
    'The operator who drafted a correction cannot be the one who posts it. This is the only path on the platform by '
    + "which a person's balance changes by hand.");
  if (s.needsFounderConfirmation && !founderInformed) {
    throw new CorrectionNotApprovableError(
      `this correction is ${s.gross} minor units, at or above the ${FOUNDER_THRESHOLD_MINOR} threshold. Confirm the `
      + 'founder has been informed before posting. The platform cannot page anybody, so this confirmation is a '
      + 'person saying they did it, and it is recorded as such.');
  }
  return { gross: s.gross };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE POST                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

/** The txn type W068 names. Added to the `ledger_txn_type` lookup by 0111 — before that a post typed `correction`
 *  failed the foreign key, because the vocabulary that gates every ledger transaction had never heard of it. */
export const CORRECTION_TXN_TYPE = 'correction' as const;

/** Build the wallet-service call from a draft.
 *
 *  A pure mapping with no room for interpretation, and that is the point: the legs a checker approved are the legs
 *  that post. Anything that recomputed, reordered by amount, or merged same-account legs here would mean the posted
 *  transaction was not the reviewed one.
 */
export function buildPost(d: CorrectionDraft): {
  tenantId: string; txnType: string; idempotencyKey: string; currencyCode: string;
  referenceType: string; referenceId: string; description: string;
  legs: { ownerKind: OwnerKind; ownerId?: string; accountCode: string; amountMinor: bigint }[];
} {
  const b = balanceOf(d.legs);
  // Belt and braces at the last possible moment. The DB trigger, the submit gate and the approve gate have all
  // checked this; so does the wallet-service. A fifth check costs nothing and this is the line of code between a
  // person's intent and their money.
  if (!b.balanced) throw new InvalidCorrectionError('refusing to post an unbalanced correction');
  return {
    tenantId: d.tenantId ?? '',
    txnType: CORRECTION_TXN_TYPE,
    idempotencyKey: d.idempotencyKey,
    currencyCode: d.currencyCode,
    referenceType: 'recon_investigation',
    referenceId: d.investigationId,
    // The verbatim reason travels with the money. Somebody reading the ledger entry six months from now should not
    // have to find this console to learn why the entry exists.
    description: d.reason.slice(0, 500),
    legs: d.legs.map((l) => ({
      ownerKind: l.ownerKind,
      ...(l.ownerId ? { ownerId: l.ownerId } : {}),
      accountCode: l.accountCode,
      amountMinor: l.amountMinor,
    })),
  };
}

/** Money for display: minor units → a rupee string. Never used for arithmetic and never round-tripped.
 *
 *  Takes a bigint and returns a STRING. There is no point in this file where a money value becomes a JS number, and
 *  a formatter that accepted one would be the hole through which one arrives.
 */
export function formatMinor(minor: bigint, currency = 'INR'): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const major = abs / 100n;
  const cents = abs % 100n;
  const sym = currency === 'INR' ? '₹' : '';
  return `${neg ? '−' : ''}${sym}${major.toLocaleString('en-IN')}.${cents.toString().padStart(2, '0')}`;
}
