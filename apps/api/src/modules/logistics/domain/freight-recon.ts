// modules/logistics/domain/freight-recon.ts · WHAT A CARRIER BILLED US VERSUS WHAT WE OWE (PC-56 TENANT-5c).
// Pure rules — no I/O, no clock of its own.
//
// W241's lead: *"What carriers bill you vs what shipments say they should — reconciled line by line. **Freight
// leakage is quiet money; this desk makes it loud.**"* W242's rule: *"pay the clean lines now, dispute the rest"*
// and *"variance ₹2,320 — exact, recon foots to the rupee ✓"*.
//
// **`freight_invoices` AND `freight_invoice_lines` HAVE HAD NO APPLICATION CODE SINCE 0070.** The migration built
// the pair carefully — header + lines so disputed lines can be isolated from clean ones, `variance_minor` as a
// GENERATED column, a full recon vocabulary, RLS, four indexes — and `grep -rl freight apps` returns three RLS
// integration specs and a mobile spending category. No entity, no repository, no service, no controller, no SDK
// method, no screen. A table with an RLS spec and no writer, for the second time in this module (5a found
// `shipment_events` with two writers and no reader; this is the mirror image).
//
// So W241 and W242 were drawings, and the canon's own backend-pending banner — "today 3PL invoices reconcile
// against `shipments.charge_minor` manually" — is still true of the software, though the table it asks for exists.
import { ShipmentStatus } from './shipment.state';

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT KIND OF DOCUMENT THIS IS                                                                             */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W241's third row is not a carrier bill at all: *"FLEET-JUN · internal cost note · fuel + wages · Own fleet ·
 * ₹41,200 · Expected — · (cost centre, not billed) · booked to ops"*.
 *
 * An own-fleet cost note has no counterparty to dispute with and nobody to pay: the money already left as fuel and
 * wages. Keeping it in the same table is right — it is freight spend and belongs on the freight desk — but every
 * rule below has to know which kind it is looking at, or the console will offer to "dispute" a diesel bill.
 */
export const SOURCE_KINDS = ['carrier_invoice', 'own_fleet_cost_note'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export function isCostNote(k: SourceKind | string): boolean { return k === 'own_fleet_cost_note'; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE RECON STATUS — 0070's OWN VOCABULARY, GIVEN A MACHINE                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/** Exactly the six values 0070's CHECK allows. The vocabulary existed; the transitions did not. */
export const RECON_STATUSES = ['pending', 'exact_match', 'variance_open', 'disputed_lines', 'reconciled', 'booked_ops'] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];

export function isReconStatus(v: string | null | undefined): v is ReconStatus {
  return !!v && (RECON_STATUSES as readonly string[]).includes(v);
}

/**
 * Legal transitions.
 *
 * `booked_ops` is where an own-fleet cost note goes and it is TERMINAL — there is nothing to reconcile against and
 * nobody to pay. `exact_match` is also terminal by W242's own empty state: *"Exact-match invoices auto-close — you
 * only ever see the variances."* An invoice with a variance stays open until somebody decides, and `reconciled` is
 * that decision recorded.
 */
export const RECON_TRANSITIONS: Record<ReconStatus, readonly ReconStatus[]> = {
  pending: ['exact_match', 'variance_open', 'disputed_lines', 'booked_ops'],
  // A recomputed pass may find new variances or clear old ones, so a run may move either way — but never back to
  // `pending`, which would erase that a recon was ever done.
  variance_open: ['disputed_lines', 'exact_match', 'reconciled'],
  disputed_lines: ['variance_open', 'exact_match', 'reconciled'],
  exact_match: [],
  reconciled: [],
  booked_ops: [],
};

export function canTransitionRecon(from: ReconStatus, to: ReconStatus): boolean {
  return (RECON_TRANSITIONS[from] ?? []).includes(to);
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE VERDICT ON ONE LINE                                                                                   */
/* --------------------------------------------------------------------------------------------------------- */

/** What we know about the shipment a carrier's line claims to be for. `null` shipment = we have no such AWB. */
export interface LineEvidence {
  shipmentId: string | null;
  awbNo: string | null;
  status: ShipmentStatus | null;
  /** `shipments.charge_minor` — what we expect this shipment to cost. NULL for practically every shipment on the
   *  platform today, because nothing writes it (see `expectedVerdict`). */
  expectedMinor: bigint | null;
  /** 5a's counter. W242's first dispute is "billed as 2 attempts — our events show ONE attempt". */
  deliveryAttempts: number;
  requiresColdChain: boolean;
}

export type LineVerdict =
  /** Billed exactly what we expected. W242: "82 lines match to the rupee". */
  | { kind: 'match'; expectedMinor: string }
  /** Billed more than we expected, and we have an expected figure to say so with. */
  | { kind: 'over'; expectedMinor: string; varianceMinor: string }
  /** Billed LESS than expected. Reported, never silently pocketed: an under-bill is usually a carrier error that
   *  arrives as a correction next cycle, and a desk that hides it is surprised twice. */
  | { kind: 'under'; expectedMinor: string; varianceMinor: string }
  /**
   * **THE ROW THE CANON DOES NOT DRAW.** No shipment of ours carries this AWB. W241 and W242 both assume every
   * billed line is a shipment we made and argue about its price; the line that matches NOTHING is the most
   * expensive kind of freight leakage there is, and it is invisible on a screen that only compares prices.
   */
  | { kind: 'unmatched' }
  /**
   * We have the shipment and NO expected figure for it, so the price cannot be checked at all. Not a match and not
   * a variance: unpriced. See `expectedVerdict` for why this is the normal case today.
   */
  | { kind: 'unpriced' };

export function lineVerdict(billedMinor: bigint, e: LineEvidence): LineVerdict {
  if (!e.shipmentId) return { kind: 'unmatched' };
  if (e.expectedMinor === null) return { kind: 'unpriced' };
  const variance = billedMinor - e.expectedMinor;
  // "Recon foots to the rupee": zero tolerance, deliberately. A tolerance band is a decision about how much
  // leakage is acceptable, and that is a founder's call to make explicitly, not a constant to bury here.
  if (variance === 0n) return { kind: 'match', expectedMinor: e.expectedMinor.toString() };
  return variance > 0n
    ? { kind: 'over', expectedMinor: e.expectedMinor.toString(), varianceMinor: variance.toString() }
    : { kind: 'under', expectedMinor: e.expectedMinor.toString(), varianceMinor: variance.toString() };
}

/** A line the desk may pay without an argument: matched to a shipment, priced, and billed what we expected. */
export function isClean(v: LineVerdict): boolean { return v.kind === 'match'; }

/* --------------------------------------------------------------------------------------------------------- */
/* WHY IT DIFFERS — W242's FOUR REASONS, AND WHICH OF THEM WE CAN ACTUALLY EVIDENCE                          */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W242's disputed-lines table has a "Why it differs" column with four entries:
 *
 *   1. "billed as 2 attempts — our events show ONE attempt, delivered first try"
 *   2. "billed inter-district — pincode is 10–30 km slab"
 *   3. "weight surcharge billed — AWB shows 48 kg, surcharge starts 50 kg"
 *   4. "full lane billed on a shipment recalled at hub (cancelled-in-transit rate)"
 *
 * And its claim: *"Every claim cites our `shipment_events` — timestamped, GPS-tagged, signed-exportable."*
 *
 * TWO of the four are evidenced by facts this platform holds — the attempt count (5a's `delivery_attempts`, which
 * before that wave counted nothing) and the shipment's own status history. TWO ARE NOT:
 *   • the DISTANCE SLAB needs a carrier rate card, and there is none: no per-carrier lane table, no slab, no
 *     negotiated rate anywhere in the schema;
 *   • the WEIGHT surcharge needs a weight, and `shipments` has no weight column at all — `capacity_kg` is a
 *     property of a VEHICLE, not of a consignment.
 *
 * So the classifier returns what it can prove and names the rest `not_evidenced`, which the console prints as a
 * reason an operator must write themselves. A dispute pack that cites evidence we do not have loses the argument
 * the first time a carrier asks to see it — and W242's whole claim is that carriers stopped arguing BECAUSE the
 * evidence is real.
 */
export const DISPUTE_REASONS = ['extra_attempt_billed', 'cancelled_in_transit', 'not_shipped', 'unpriced_line', 'not_evidenced'] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export interface DisputeClassification {
  reason: DisputeReason;
  /** The facts behind the verdict, snapshotted at dispute time — a verdict with no evidence is an assertion, and
   *  this one goes to a carrier with money attached. */
  evidence: Record<string, unknown>;
}

/** The statuses that mean the consignment never completed its lane — W242's fourth reason. */
export const RECALLED_STATUSES: readonly ShipmentStatus[] = ['cancelled', 'returned', 'failed'];

/**
 * Classify a variance, using only facts we hold.
 *
 * `billedAttempts` is what the carrier's line claims (carriers itemise attempts); when the invoice does not say,
 * the attempt check is skipped rather than guessed — an unstated attempt count is not "one".
 */
export function classifyDispute(v: LineVerdict, e: LineEvidence, billedAttempts: number | null): DisputeClassification {
  if (v.kind === 'unmatched') {
    return { reason: 'not_shipped', evidence: { awbNo: e.awbNo, note: 'no shipment of this tenant carries this AWB' } };
  }
  if (v.kind === 'unpriced') {
    return { reason: 'unpriced_line', evidence: { shipmentId: e.shipmentId, status: e.status, note: 'shipments.charge_minor is null — nothing on this platform writes it' } };
  }
  if (billedAttempts !== null && billedAttempts > Math.max(1, e.deliveryAttempts)) {
    return { reason: 'extra_attempt_billed', evidence: { shipmentId: e.shipmentId, billedAttempts, ourAttempts: e.deliveryAttempts, status: e.status } };
  }
  if (e.status && (RECALLED_STATUSES as readonly string[]).includes(e.status)) {
    return { reason: 'cancelled_in_transit', evidence: { shipmentId: e.shipmentId, status: e.status, note: 'the lane was not completed' } };
  }
  // The distance slab and the weight surcharge live here — and cannot be answered. Named, with what is missing, so
  // the operator writes the reason and the pack does not cite evidence we do not hold.
  return {
    reason: 'not_evidenced',
    evidence: { shipmentId: e.shipmentId, status: e.status, missing: ['carrier_rate_card', 'consignment_weight'] },
  };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE EXPECTED SIDE — AND WHY IT IS EMPTY                                                                   */
/* --------------------------------------------------------------------------------------------------------- */

export type ExpectedVerdict =
  | { kind: 'priced'; totalMinor: string; lines: number }
  /** Some lines have an expected figure and some do not: the sum is real but PARTIAL, and the count says how much
   *  of the invoice it covers. A partial sum printed as a total is how a 2% variance reads as 40%. */
  | { kind: 'partly_priced'; totalMinor: string; pricedLines: number; unpricedLines: number }
  /** Nothing on this invoice has an expected figure — the normal case today. */
  | { kind: 'unpriced'; unpricedLines: number };

/**
 * W241's column header is literally *"Expected (Σ charge_minor)"*.
 *
 * **NOTHING ON THIS PLATFORM WRITES `shipments.charge_minor`.** It is accepted by `CreateShipmentDto` as an
 * optional field, and the path that creates virtually every shipment in production —
 * `OrderConfirmedHandler`, which fires on `orders.order_confirmed` — calls
 * `Shipment.create({ id, tenantId, orderId })` with no charge at all. So the expected side of this desk's
 * comparison is null for every auto-created shipment, and "Expected (Σ charge_minor)" would print ₹0 against a
 * real carrier bill, making every invoice look like 100% leakage.
 *
 * This function is what stops that: a partial sum SAYS it is partial, and an empty one says so too. Making the
 * expected side real needs a carrier rate card — per carrier, per lane, per weight slab — which does not exist in
 * the schema and is a founder decision (who negotiates the rate, and at what granularity it is recorded), not
 * something a read model may invent.
 */
export function expectedVerdict(lines: readonly { expectedMinor: bigint | null }[]): ExpectedVerdict {
  let total = 0n, priced = 0, unpriced = 0;
  for (const l of lines) {
    if (l.expectedMinor === null) unpriced++;
    else { total += l.expectedMinor; priced++; }
  }
  if (priced === 0) return { kind: 'unpriced', unpricedLines: unpriced };
  if (unpriced > 0) return { kind: 'partly_priced', totalMinor: total.toString(), pricedLines: priced, unpricedLines: unpriced };
  return { kind: 'priced', totalMinor: total.toString(), lines: priced };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE HEADER'S VERDICT                                                                                      */
/* --------------------------------------------------------------------------------------------------------- */

export interface ReconTotals { billedMinor: bigint; lines: number; matched: number; over: number; under: number; unmatched: number; unpriced: number; disputed: number }

/**
 * Which of 0070's six statuses this invoice is in after a recon pass.
 *
 * An own-fleet cost note is `booked_ops` and never anything else. An invoice whose every line matches is
 * `exact_match` and auto-closes (W242: "Exact-match invoices auto-close — you only ever see the variances"). A
 * line somebody has actually disputed makes it `disputed_lines`; a variance nobody has disputed yet is
 * `variance_open`.
 *
 * **An UNMATCHED or UNPRICED line counts as a variance, not as a match.** That is the whole difference between a
 * desk that makes leakage loud and one that auto-closes an invoice it never checked.
 */
export function headerVerdict(kind: SourceKind, t: ReconTotals): ReconStatus {
  if (isCostNote(kind)) return 'booked_ops';
  if (t.disputed > 0) return 'disputed_lines';
  if (t.over > 0 || t.under > 0 || t.unmatched > 0 || t.unpriced > 0) return 'variance_open';
  return 'exact_match';
}

/** W241's badge text needs the variance's DIRECTION, not just its size: "+₹2,320 over" and "₹1,100 under" are two
 *  different conversations with a carrier. Zero is neither. */
export function varianceDirection(varianceMinor: bigint): 'over' | 'under' | 'level' {
  return varianceMinor > 0n ? 'over' : varianceMinor < 0n ? 'under' : 'level';
}

/**
 * The variance as a percentage of the bill, for W241's *"The +₹2,360 variance is 2.5% of the bill"*.
 *
 * Integer arithmetic in basis points (Law 2 — no float ever touches money), and null when the bill is zero rather
 * than dividing by it. **The canon's own two numbers disagree** — its table says "+₹2,320 over" and its prose says
 * "+₹2,360 variance … 2.5% of the bill" — so this is computed from the rows rather than transcribed: 2,320 of
 * 96,440 is 2.41%, and a screen that prints a hand-typed percentage beside a computed sum will eventually print
 * two numbers that cannot both be right.
 */
export function varianceBps(varianceMinor: bigint, billedMinor: bigint): number | null {
  if (billedMinor <= 0n) return null;
  const abs = varianceMinor < 0n ? -varianceMinor : varianceMinor;
  return Number((abs * 10_000n) / billedMinor);
}

/* --------------------------------------------------------------------------------------------------------- */
/* PAYING IT — AND THE RAIL THAT CANNOT CARRY A CARRIER                                                      */
/* --------------------------------------------------------------------------------------------------------- */

export type PaymentVerdict =
  /** An own-fleet cost note: the money left as fuel and wages. Nothing to pay, and nothing to hold. */
  | { kind: 'cost_note_booked' }
  /** Recon is not finished, so W241's "payment holds until recon closes" holds. */
  | { kind: 'held_recon_open'; cleanMinor: string; disputedMinor: string }
  /**
   * The clean lines are ready and **THE RAIL CANNOT CARRY THEM**.
   *
   * W241: *"Carrier invoices pay from the tenant wallet through the normal rails (maker-checker above ₹25,000) —
   * freight is money like all money."* Those rails cannot pay a carrier today, and the reasons are structural
   * rather than missing wiring:
   *   • `payouts.bank_account_id` is NOT NULL, and `bank_accounts` requires `user_id` OR `tenant_id` — a carrier is
   *     a `logistics_partners` row, which is neither. **There is no payee.**
   *   • `payout_purpose` is seeded with `settlement` and `wage` only, so there is no freight purpose to pay under
   *     (and `CreatePayoutSchema` accepts `commission` and `refund`, which resolve to no lookup row and are
   *     refused at runtime — a separate live defect in the payouts plane, named for its own wave).
   *   • `PayoutService.requestPayout` is a MEMBER-WITHDRAWAL path: it gates on the calling user's own per-role KYC.
   *     A tenant paying a vendor is a different act with a different actor, and running it through this path would
   *     mean a carrier's invoice being paid against a farmer's KYC.
   *
   * So the desk computes and shows what is ready, and says the rail is missing. `freight_invoices.payout_id` (0070)
   * points at a row that cannot yet exist for a carrier — recorded rather than filled with something else.
   */
  | { kind: 'ready_no_rail'; cleanMinor: string; needsChecker: boolean | null; missing: readonly string[] }
  /** Everything on this invoice is disputed: there is nothing clean to pay yet. */
  | { kind: 'nothing_clean'; disputedMinor: string };

/**
 * W241: "maker-checker above ₹25,000".
 *
 * **The threshold is not ours to hold, and this wave does not read it.** It is the tenant setting
 * `payouts.batch_checker_threshold_minor`, resolved by the payments module's own approval service and recorded per
 * batch on `payout_batches.checker_threshold_minor` (0114). Copying that read into the freight desk would put one
 * policy in two places, and reaching into the payments module's repository for it would break the module blueprint
 * ("no module imports another module's repositories — only its public service or events"), which exports no public
 * method for it.
 *
 * So the caller passes what it has, and `null` means "not read here" rather than "no checker needed" — a distinction
 * that matters because the two would print the same sentence otherwise. It is also, for now, academic: there is no
 * payee for a carrier, so nothing can be paid with or without a checker.
 */
export function needsChecker(amountMinor: bigint, thresholdMinor: bigint | null): boolean | null {
  return thresholdMinor === null ? null : amountMinor > thresholdMinor;
}

export function paymentVerdict(i: {
  kind: SourceKind; status: ReconStatus; cleanMinor: bigint; disputedMinor: bigint; thresholdMinor: bigint | null;
}): PaymentVerdict {
  if (isCostNote(i.kind)) return { kind: 'cost_note_booked' };
  if (i.status === 'pending' || i.status === 'variance_open') {
    return { kind: 'held_recon_open', cleanMinor: i.cleanMinor.toString(), disputedMinor: i.disputedMinor.toString() };
  }
  if (i.cleanMinor <= 0n) return { kind: 'nothing_clean', disputedMinor: i.disputedMinor.toString() };
  return {
    kind: 'ready_no_rail',
    cleanMinor: i.cleanMinor.toString(),
    needsChecker: needsChecker(i.cleanMinor, i.thresholdMinor),
    missing: ['carrier_payee_bank_account', 'freight_payout_purpose'],
  };
}

/**
 * W242's settlement path, step 2: *"Dispute pack (4 lines + evidence) goes to Delhivery — 7-day response window"*.
 *
 * The WINDOW is a real number and the platform has nowhere to keep it: there is no dispute-deadline column, no
 * carrier SLA table, and no job that would chase one. Rather than print a date this desk cannot honour, the pack
 * verdict states what it contains and that the seven-day clock is not kept by the platform — an operator with a
 * calendar reminder is honest; a screen showing a deadline nothing enforces is not.
 */
export const DISPUTE_RESPONSE_DAYS = 7;
export type PackVerdict = { kind: 'pack_ready'; lines: number; claimedMinor: string; windowDays: number; clockKept: false };
export function packVerdict(lines: number, claimedMinor: bigint): PackVerdict {
  return { kind: 'pack_ready', lines, claimedMinor: claimedMinor.toString(), windowDays: DISPUTE_RESPONSE_DAYS, clockKept: false };
}
