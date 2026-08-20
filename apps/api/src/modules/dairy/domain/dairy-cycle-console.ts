// modules/dairy/domain/dairy-cycle-console.ts · PC-56 TENANT-6c-6 · W169 composed, decided in one pure file.
//
// W169 is the screen the previous five waves were building the record and the acts for. TENANT-6c-1 gave the cycle a
// row, 6c-2 the preview and the member's voice, 6c-3 the second signature, 6c-4 the deduction's destination and 6c-5
// the standing instruction that fills it. **None of it was reachable from any client**: the cycle routes have existed
// since 6c-2 and the SDK had no method for one, so 312 families' fortnight could be closed, previewed, approved and
// deducted only by a curl. This file is the console's whole DECISION layer — every judgement it makes, pure and
// testable, with no I/O and no i18n (the read-model gathers; `apps/web-tenant` names).
//
// THE THREE THINGS THIS SCREEN MUST NOT DO, which is most of why it exists:
//   1. offer a button the API will refuse — every act carries its refusal REASON, resolved server-side from the flag,
//      the permission, the cycle's status and the maker-checker rule, so an operator is never told "no" by a 403 after
//      pressing on a 2G connection;
//   2. show the canon's numbers where the platform's are different — the canon draws 312 DRAFT bills mid-cycle, and
//      this platform builds a bill when the window SHUTS (0157's ruling: a money record that changes under the member
//      is worse than one that arrives late), so an open cycle reports the ACCRUAL and says no bill exists yet;
//   3. print `25%` because the canon prints it. The consent line is a tenant setting (0160) and the automatic-assembly
//      cap is a second, tighter one (0161); a screen that hardcodes either lies to any cooperative that changed it.
import { deductionConsentRequired } from './dairy-deduction';

/** Where a cycle actually is, as a REGISTER shows it — the status plus the one distinction the status cannot make. */
export const CYCLE_STAGES = ['accruing', 'closed_unbilled', 'billed', 'previewed', 'approved'] as const;
export type CycleStage = (typeof CYCLE_STAGES)[number];

/**
 * `closed_unbilled` is the distinction: a cycle whose window has shut but whose bills the cadence has not built yet.
 * The status column cannot say it (both are `closed`) and an operator must not read an empty register as "nobody
 * poured" — 312 families' bills are seconds away, or the cadence flag is off and they are not coming at all.
 */
export function cycleStage(status: string, billsExisting: number): CycleStage {
  if (status === 'open') return 'accruing';
  if (status === 'closed') return billsExisting === 0 ? 'closed_unbilled' : 'billed';
  if (status === 'previewed' || status === 'approved') return status;
  // A status this build does not know is reported as the earliest stage rather than crashing the register: a row from
  // a deployment ahead of this code must not take the screen down for the ones it does understand.
  return 'accruing';
}

export const ACT_REFUSALS = [
  'FLAG_OFF', 'NO_MANAGE', 'NO_SETTLEMENT_CLOSE', 'WRONG_STAGE', 'NOTHING_LEFT', 'MAKER_IS_CHECKER',
] as const;
export type ActRefusal = (typeof ACT_REFUSALS)[number];

export const ACT_CAUTIONS = ['BILLS_NOT_BUILT', 'DISPUTES_OPEN'] as const;
export type ActCaution = (typeof ACT_CAUTIONS)[number];

export interface ActVerdict {
  can: boolean;
  /** Exactly one reason, the FIRST that applies in the order below — a list of five would tell an operator nothing. */
  refusal: ActRefusal | null;
  /** Allowed, but with something the operator should know BEFORE 312 messages go out. */
  caution: ActCaution | null;
}

export interface ActInput {
  stage: CycleStage;
  flagOn: boolean;
  canManage: boolean;
  canCloseSettlement: boolean;
  /** Bills still awaiting this act — drafts for preview, previewed for approve. Measured, never inferred. */
  pending: number;
  /** Whether the cadence has built this cycle's bills at all (`bills_generated_at`), for the caution. */
  billsBuilt: boolean;
  /** Open disputes on this cycle's bills, for approve's caution: *"disputed pauses one bill, never the cycle."* */
  openDisputes: number;
  /** Who previewed it, and who is asking. 6c-3's rule, evaluated where the button is drawn as well as where it lands. */
  previewedBy: string | null;
  userId: string;
}

/**
 * REFUSAL ORDER, and why: *nobody can* before *you cannot* before *not yet* before *not you*.
 *
 * A cooperative whose flag is off must not be told they lack a permission (they would go and grant one), and an
 * operator who previewed the cycle must not be told "nothing to approve" when the truth is that a colleague has to
 * press it. The order is asserted in the suite, because it is the whole informational value of the verdict.
 */
export function previewAct(i: ActInput): ActVerdict {
  const verdict = (refusal: ActRefusal | null, caution: ActCaution | null = null): ActVerdict => ({ can: refusal === null, refusal, caution });
  if (!i.flagOn) return verdict('FLAG_OFF');
  if (!i.canManage) return verdict('NO_MANAGE');
  // W169: *"Preview/approve needs dairy-desk + `settlement.close` + checker"*. 6c-3 put the second key on BOTH acts —
  // telling 312 families what they are about to be paid is the act that fixes the figures.
  if (!i.canCloseSettlement) return verdict('NO_SETTLEMENT_CLOSE');
  if (i.stage === 'accruing') return verdict('WRONG_STAGE');
  if (i.stage === 'approved') return verdict('WRONG_STAGE');
  if (i.pending === 0) return verdict('NOTHING_LEFT');
  // Pressing preview on a cycle the cadence has not billed yet RECORDS a preview nobody received: the cycle moves to
  // `previewed` and `previewed_at` says a Thursday morning that never happened for any member. It is recoverable (the
  // pass is resumable and 6c-2 made bill-building depend on `closed_at`, not on the status), so this is a caution and
  // not a refusal — a cooperative that generates bills by hand must not be locked out of its own preview.
  return verdict(null, i.billsBuilt ? null : 'BILLS_NOT_BUILT');
}

export function approveAct(i: ActInput): ActVerdict {
  const verdict = (refusal: ActRefusal | null, caution: ActCaution | null = null): ActVerdict => ({ can: refusal === null, refusal, caution });
  if (!i.flagOn) return verdict('FLAG_OFF');
  if (!i.canManage) return verdict('NO_MANAGE');
  if (!i.canCloseSettlement) return verdict('NO_SETTLEMENT_CLOSE');
  // Only a previewed cycle can be approved: 0159's `ck_dairy_bill_cycle_approved_after_preview` says so in the
  // database, and the screen must agree with the constraint rather than discover it.
  if (i.stage !== 'previewed' && i.stage !== 'approved') return verdict('WRONG_STAGE');
  // 6c-3's second signature, checked HERE as well: the maker cannot be the checker, and an operator learning that from
  // a 409 after pressing is how a cooperative concludes the software is broken. Ordered before `NOTHING_LEFT` because
  // "somebody else must press this" is the more useful sentence when both are true.
  if (i.previewedBy !== null && i.previewedBy === i.userId) return verdict('MAKER_IS_CHECKER');
  if (i.pending === 0) return verdict('NOTHING_LEFT');
  return verdict(null, i.openDisputes > 0 ? 'DISPUTES_OPEN' : null);
}

/** What the platform can and cannot promise about payday — W169's second tile. */
export interface PaydayVerdict {
  /** RECORDED since 0157, from the cooperative's own setting. W167 still says "not recorded"; it is, now. */
  payday: string;
  /** The canon's *"one bank trip"* — a payout batch over a cycle. Nothing on this platform has one. */
  batchBuilt: false;
  /** Bills that have actually been paid, and by the only mechanism there is: one bill at a time. */
  paid: number;
  awaitingPayment: number;
}

export function paydayVerdict(payday: string, counts: Record<string, number>): PaydayVerdict {
  return {
    payday,
    batchBuilt: false,
    paid: counts.paid ?? 0,
    awaitingPayment: (counts.approved ?? 0),
  };
}

/**
 * THE CONSENT LINE, as this tenant set it — and the cap that keeps the automatic path below it.
 *
 * Two numbers, never one: 0160's `dairy.deduction_consent_pct` is where a human must ask, and 0161's
 * `dairy.deduction_assembly_max_pct` is where software stops. `min` of the two is what an automatically assembled bill
 * can reach (6c-5's `assemblyCapMinor` does the same thing to money), and a screen showing only the consent line would
 * leave an operator wondering why a member with ₹40,000 of debt had ₹2,000 recovered.
 */
export interface ConsentLine { consentPct: number; assemblyPct: number; automaticPct: number }
export function consentLine(consentPct: number, assemblyPct: number): ConsentLine {
  return { consentPct, assemblyPct, automaticPct: Math.min(consentPct, assemblyPct) };
}

/**
 * What the member has said about THIS bill's deductions, as the register must read it.
 *
 * `granted_stale` is a real state and not a nicety: 6c-2 made a bill voidable, rebuildable and re-previewable, so a
 * member can be shown three different sets of figures for one fortnight, and a consent to the first is not a consent
 * to the third (`consentMatchesBill`). The money path already refuses a stale consent; the register must agree.
 */
export type ConsentOnFile = 'granted_current' | 'granted_stale' | 'refused' | null;

/** One bill on the register, decided. */
export interface CycleBillVerdict {
  /**
   * This bill will REFUSE to pay until the member is asked again — above the tenant's line, with no current consent.
   *
   * [PC-56 TENANT-6c-6, found live] The first version of this asked only *"is it above the line?"*, so a bill the
   * member had already consented to went on carrying a warning while the payment sailed through, and the tile's count
   * (which does read the consent) contradicted the row beside it. A screen that disagrees with itself about whose
   * money is stuck is worse than one that says nothing.
   */
  needsFreshConsent: boolean;
  /**
   * BELOW the line, and the member said no anyway.
   *
   * 6c-4's hardest call: below the threshold a refusal does NOT block the payment (a veto whose only victim is the
   * member is not a protection), but it is logged and audited rather than discarded. This is that fact on the screen —
   * the desk can see the objection and answer it through the dispute route, which is the member's real remedy here.
   */
  memberRefusedBelowLine: boolean;
  /** Litres per day over the days this bill actually covers, in milli-litres to keep the integer discipline. */
  litresPerDayMilli: bigint | null;
  /** The member's 30-day average, when there are pours to average. Null is "not enough history", never 0. */
  avg30dMilli: bigint | null;
}

export function billVerdict(i: {
  grossMinor: bigint; deductionsMinor: bigint; consentPct: number; consentOnFile: ConsentOnFile;
  totalLitresMilli: bigint; days: number; litres30dMilli: bigint | null; days30d: number;
}): CycleBillVerdict {
  const above = deductionConsentRequired(i.grossMinor, i.deductionsMinor, i.consentPct);
  return {
    needsFreshConsent: above && i.consentOnFile !== 'granted_current',
    memberRefusedBelowLine: !above && i.consentOnFile === 'refused',
    litresPerDayMilli: i.days > 0 ? i.totalLitresMilli / BigInt(i.days) : null,
    // Averaged over the days the member actually poured, NOT over 30: a family that poured on 4 days of a month has a
    // 4-day average, and dividing their milk by 30 would print a number that makes every other row look wrong.
    avg30dMilli: i.litres30dMilli !== null && i.days30d > 0 ? i.litres30dMilli / BigInt(i.days30d) : null,
  };
}

/**
 * Days a bill's period covers, inclusive of both ends — the divisor for *"13.6 L/day this cycle"*.
 *
 * Inclusive because a cooperative's fortnight 01–15 is fifteen days of milk, not fourteen. Dates only (no clock, no
 * zone): both ends are `date` columns read through 6b-1's mapper, so this is calendar arithmetic and stays out of the
 * timezone question 0157 answered for the close INSTANT.
 */
export function periodDays(periodStart: string, periodEnd: string): number {
  const a = Date.parse(`${periodStart}T00:00:00Z`);
  const b = Date.parse(`${periodEnd}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * Days of an OPEN cycle that have actually happened — the honest divisor and the honest tile subtitle
 * (*"accrued to 13 Jul"*). A cycle running to the 15th on the 13th has thirteen days of milk in it, not fifteen.
 */
export function elapsedDays(periodStart: string, periodEnd: string, today: string): number {
  const end = today < periodEnd ? today : periodEnd;
  return periodDays(periodStart, end);
}

/** W169's fourth tile: *"Last cycle disputes 2 / 309 · both resolved before payday"*. */
export interface DisputeVerdict {
  total: number;
  open: number;
  resolvedBeforePayday: number;
  /** The denominator: bills the window produced, so "2 / 309" is a share of something real. */
  bills: number;
  /** True only when there WERE disputes and every one of them closed before the money moved. */
  allResolvedBeforePayday: boolean;
}

export function disputeVerdict(counts: { total: number; byStatus: Record<string, number>; resolvedBeforePayday: number }, bills: number): DisputeVerdict {
  const open = counts.byStatus.open ?? 0;
  return {
    total: counts.total,
    open,
    resolvedBeforePayday: counts.resolvedBeforePayday,
    bills,
    // NOT `open === 0`: a dispute resolved on the Saturday after a Friday payday was resolved after the family was
    // paid the disputed figure, which is the case the canon's *"both resolved before payday"* is quietly claiming.
    allResolvedBeforePayday: counts.total > 0 && counts.resolvedBeforePayday === counts.total,
  };
}

/**
 * Totals for the register's FOOT, summed from the rows on the page and labelled as such.
 *
 * A page total presented as a cycle total is this programme's own defect list (*"a count derived from a loop is right
 * only where the bound was never hit"*), so the read-model returns both these and the cycle-wide figures, and the
 * screen never prints one where the other belongs.
 */
export function pageTotals(rows: Array<{ grossMinor: string; deductionsMinor: string; netMinor: string; totalLitres: string }>): {
  grossMinor: string; deductionsMinor: string; netMinor: string; litres: string; rows: number;
} {
  let gross = 0n, ded = 0n, net = 0n, milli = 0n;
  for (const r of rows) {
    gross += BigInt(r.grossMinor);
    ded += BigInt(r.deductionsMinor);
    net += BigInt(r.netMinor);
    milli += milliFromLitres(r.totalLitres);
  }
  return {
    grossMinor: gross.toString(), deductionsMinor: ded.toString(), netMinor: net.toString(),
    litres: litresFromMilli(milli), rows: rows.length,
  };
}

/**
 * `"172.800"` → `172800n`, by STRING, never through a float.
 *
 * The bill projects its litres as a 3-decimal string because `core/database/pg-numeric.ts` exists for exactly this
 * reason, and `Number("172.800") * 1000` is how a cooperative's fortnight ends up 0.001 L short of its own pours.
 */
export function milliFromLitres(s: string): bigint {
  const t = s.trim();
  const neg = t.startsWith('-');
  const [whole, frac = ''] = (neg ? t.slice(1) : t).split('.');
  const milli = BigInt(whole === '' ? '0' : whole) * 1000n + BigInt(`${frac}000`.slice(0, 3));
  return neg ? -milli : milli;
}

/** `172800n` → `"172.800"`, the inverse, so a total reads exactly like the rows it came from. */
export function litresFromMilli(milli: bigint): string {
  const neg = milli < 0n;
  const abs = neg ? -milli : milli;
  return `${neg ? '-' : ''}${abs / 1000n}.${(abs % 1000n).toString().padStart(3, '0')}`;
}
