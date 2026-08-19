// modules/logistics/domain/freight-invoice.entity.ts · a carrier's bill, its lines, and their recon
// (PC-56 TENANT-5c). Pure TS — no I/O, no clock of its own. Money is bigint minor units + an explicit currency
// (Law 2); nothing here moves money, it decides what SHOULD move.
//
// The aggregate is header + lines together on purpose: 0070 split the tables so a disputed line can be isolated
// from a clean one without blocking payment on the whole invoice ("disputed lines never block the clean ones"), and
// that rule can only be enforced by something that can see both at once.
import { InvalidFreightInvoiceError, FreightLineNotFoundError, FreightReconClosedError } from './logistics.errors';
import type { DomainEvent } from './logistics.events';
import {
  DisputeReason, LineEvidence, LineVerdict, ReconStatus, ReconTotals, SourceKind,
  canTransitionRecon, classifyDispute, headerVerdict, isCostNote, isClean, lineVerdict,
} from './freight-recon';

const INVOICE_NO_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,59}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
const MAX_LINES = 5000;

export interface FreightLineProps {
  id: string; tenantId: string; invoiceId: string;
  /** The AWB the carrier billed under, kept even when it matches nothing — it IS the evidence for a
   *  "we never shipped this" dispute. */
  awbNo: string | null;
  shipmentId: string | null;
  billedMinor: bigint;
  /** Snapshot of `shipments.charge_minor` at match time. Null when the shipment has no charge recorded, which is
   *  every auto-created shipment on the platform (see `expectedVerdict`). */
  expectedMinor: bigint | null;
  /** What the carrier's line claims about attempts, when the invoice states it. Null = not stated, never "one". */
  billedAttempts: number | null;
  disputeStatus: 'none' | 'disputed' | 'resolved';
  disputeReasonCode: DisputeReason | null;
  disputeReason: string | null;
  evidence: Record<string, unknown> | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  lineNo: number;
}

export interface FreightInvoiceProps {
  id: string; tenantId: string; carrierId: string; invoiceNo: string; sourceKind: SourceKind;
  periodStart: string; periodEnd: string; shipmentCount: number;
  billedMinor: bigint; expectedMinor: bigint; currencyCode: string;
  reconStatus: ReconStatus; invoiceMediaId: string | null;
  receivedAt: Date; reconciledAt: Date | null; paymentHold: boolean; payoutId: string | null;
  createdAt?: Date | null;
}

function assertInvoiceNo(v: string): string {
  const s = (v ?? '').trim();
  if (!INVOICE_NO_RE.test(s)) throw new InvalidFreightInvoiceError('invoice_no must be 3–60 chars of letters, digits, . _ / -');
  return s;
}
function assertPeriod(from: string, to: string): { from: string; to: string } {
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (!DAY.test(from) || !DAY.test(to)) throw new InvalidFreightInvoiceError('period must be two YYYY-MM-DD dates');
  // 0070 carries the same rule as a CHECK; refusing here means an operator is told rather than a constraint firing.
  if (to < from) throw new InvalidFreightInvoiceError('period_end cannot precede period_start');
  return { from, to };
}
function assertMinor(v: bigint, field: string): bigint {
  if (v < 0n) throw new InvalidFreightInvoiceError(`${field} cannot be negative`);
  return v;
}

export class FreightInvoice {
  private readonly events: DomainEvent[] = [];
  private constructor(private p: FreightInvoiceProps, private lines: FreightLineProps[]) {}

  /**
   * Record a bill. `pending` until a recon pass runs — the status is a statement about work done, and no work has
   * been done at the moment of upload.
   *
   * Payment is HELD from the first instant (0070's `payment_hold` default, W241's "payment holds until recon
   * closes"), and a cost note is held too until it is booked: the difference is that booking it is the only thing
   * that will ever happen to it.
   */
  static record(input: {
    id: string; tenantId: string; carrierId: string; invoiceNo: string; sourceKind: SourceKind;
    periodStart: string; periodEnd: string; billedMinor: bigint; currencyCode: string;
    invoiceMediaId?: string | null; receivedAt?: Date;
    lines: Array<{ id: string; awbNo?: string | null; shipmentId?: string | null; billedMinor: bigint; billedAttempts?: number | null }>;
  }): FreightInvoice {
    const period = assertPeriod(input.periodStart, input.periodEnd);
    const currency = (input.currencyCode ?? 'INR').toUpperCase();
    if (!CURRENCY_RE.test(currency)) throw new InvalidFreightInvoiceError('currency_code must be a 3-letter ISO code');
    if (input.lines.length > MAX_LINES) throw new InvalidFreightInvoiceError(`an invoice may carry at most ${MAX_LINES} lines`);
    // A carrier invoice with NO lines cannot be reconciled line by line, which is the only thing this desk does.
    // A cost note legitimately has none — fuel and wages are not shipments.
    if (input.lines.length === 0 && !isCostNote(input.sourceKind)) {
      throw new InvalidFreightInvoiceError('a carrier invoice needs at least one line to reconcile');
    }
    for (const l of input.lines) {
      assertMinor(l.billedMinor, 'line billed_minor');
      // Every line must say WHICH consignment it bills, or it cannot be matched to anything and cannot be
      // disputed either — an unidentifiable line is not evidence of anything.
      if (!l.awbNo && !l.shipmentId) throw new InvalidFreightInvoiceError('each line needs an awbNo or a shipmentId');
      if (l.billedAttempts !== undefined && l.billedAttempts !== null && (!Number.isInteger(l.billedAttempts) || l.billedAttempts < 1 || l.billedAttempts > 20)) {
        throw new InvalidFreightInvoiceError('billedAttempts must be an integer 1–20 when stated');
      }
    }
    const linesSum = input.lines.reduce((a, l) => a + l.billedMinor, 0n);
    const billed = assertMinor(input.billedMinor, 'billed_minor');
    // **The invoice's own arithmetic must hold before we argue with the carrier about ours.** A header total that
    // disagrees with its lines means the upload lost a line or double-counted one, and reconciling it would produce
    // a "variance" that is our own transcription error dressed as leakage.
    if (input.lines.length > 0 && linesSum !== billed) {
      throw new InvalidFreightInvoiceError(`the lines sum to ${linesSum} and the invoice total is ${billed} — they must agree`);
    }
    const inv = new FreightInvoice({
      id: input.id, tenantId: input.tenantId, carrierId: input.carrierId,
      invoiceNo: assertInvoiceNo(input.invoiceNo), sourceKind: input.sourceKind,
      periodStart: period.from, periodEnd: period.to, shipmentCount: input.lines.length,
      billedMinor: billed, expectedMinor: 0n, currencyCode: currency,
      reconStatus: 'pending', invoiceMediaId: input.invoiceMediaId ?? null,
      receivedAt: input.receivedAt ?? new Date(), reconciledAt: null, paymentHold: true, payoutId: null,
    }, input.lines.map((l, i) => ({
      id: l.id, tenantId: input.tenantId, invoiceId: input.id, awbNo: l.awbNo?.trim() || null,
      shipmentId: l.shipmentId ?? null, billedMinor: l.billedMinor, expectedMinor: null,
      billedAttempts: l.billedAttempts ?? null, disputeStatus: 'none', disputeReasonCode: null,
      disputeReason: null, evidence: null, resolvedAt: null, resolvedBy: null, lineNo: i + 1,
    })));
    inv.events.push({ type: 'logistics.freight_invoice_recorded', payload: {
      invoiceId: input.id, tenantId: input.tenantId, carrierId: input.carrierId, invoiceNo: inv.p.invoiceNo,
      sourceKind: input.sourceKind, billedMinor: billed.toString(), currencyCode: currency, lines: input.lines.length,
    } });
    return inv;
  }

  static rehydrate(p: FreightInvoiceProps, lines: FreightLineProps[]): FreightInvoice {
    return new FreightInvoice(p, [...lines].sort((a, b) => a.lineNo - b.lineNo));
  }

  get id() { return this.p.id; }
  get status() { return this.p.reconStatus; }
  get sourceKind() { return this.p.sourceKind; }
  get currencyCode() { return this.p.currencyCode; }
  toProps(): Readonly<FreightInvoiceProps> { return Object.freeze({ ...this.p }); }
  toLines(): readonly Readonly<FreightLineProps>[] { return this.lines.map((l) => Object.freeze({ ...l })); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /**
   * Run the recon pass: attach each line's evidence, work out its verdict, roll the header up.
   *
   * `evidenceFor` is supplied by the caller (the repository read) so this stays pure. Re-runnable by design: a
   * carrier's second cycle corrects the first, and a desk that can only reconcile once is a desk that lies after
   * the first correction. What it may NOT do is re-open a closed invoice — that is `canTransitionRecon`'s job.
   */
  reconcile(evidenceFor: (line: FreightLineProps) => LineEvidence, now: Date = new Date()): {
    totals: ReconTotals; verdicts: Map<string, LineVerdict>; from: ReconStatus; to: ReconStatus;
  } {
    if (this.p.reconStatus === 'reconciled' || this.p.reconStatus === 'exact_match' || this.p.reconStatus === 'booked_ops') {
      throw new FreightReconClosedError(this.p.reconStatus);
    }
    const verdicts = new Map<string, LineVerdict>();
    const totals: ReconTotals = { billedMinor: this.p.billedMinor, lines: this.lines.length, matched: 0, over: 0, under: 0, unmatched: 0, unpriced: 0, disputed: 0 };
    let expectedSum = 0n;
    for (const l of this.lines) {
      const e = evidenceFor(l);
      l.shipmentId = e.shipmentId;
      l.expectedMinor = e.expectedMinor;
      const v = lineVerdict(l.billedMinor, e);
      verdicts.set(l.id, v);
      if (e.expectedMinor !== null) expectedSum += e.expectedMinor;
      if (v.kind === 'match') totals.matched++;
      else if (v.kind === 'over') totals.over++;
      else if (v.kind === 'under') totals.under++;
      else if (v.kind === 'unmatched') totals.unmatched++;
      else totals.unpriced++;
      if (l.disputeStatus === 'disputed') totals.disputed++;
    }
    // The header's cached `expected_minor` is a rollup of the lines that HAVE an expected figure. It is not the
    // whole invoice's expected cost when some lines are unpriced, and `expectedVerdict` is what says so — this
    // column exists because 0070 put it there, and a reader that treats it as complete will misread every invoice.
    this.p.expectedMinor = expectedSum;
    const from = this.p.reconStatus;
    const to = headerVerdict(this.p.sourceKind, totals);
    if (from !== to && !canTransitionRecon(from, to)) throw new FreightReconClosedError(from);
    this.p.reconStatus = to;
    if (to === 'exact_match') {
      // W242: "Exact-match invoices auto-close — you only ever see the variances." Closing it also releases the
      // hold, which is the only thing that makes "pay the clean lines now" possible at all.
      this.p.reconciledAt = now;
      this.p.paymentHold = false;
    }
    this.events.push({ type: 'logistics.freight_invoice_reconciled', payload: {
      invoiceId: this.p.id, tenantId: this.p.tenantId, status: to,
      billedMinor: this.p.billedMinor.toString(), expectedMinor: expectedSum.toString(),
      matched: totals.matched, over: totals.over, under: totals.under, unmatched: totals.unmatched, unpriced: totals.unpriced,
    } });
    return { totals, verdicts, from, to };
  }

  /** Dispute one line, with a coded reason and the evidence behind it. The prose reason is the operator's own
   *  sentence — required, because a dispute with no words is a number a carrier can ignore. */
  disputeLine(lineId: string, actorUserId: string, reason: string, evidenceFor: (l: FreightLineProps) => LineEvidence): DisputeReason {
    const l = this.lines.find((x) => x.id === lineId);
    if (!l) throw new FreightLineNotFoundError(lineId);
    if (isCostNote(this.p.sourceKind)) throw new InvalidFreightInvoiceError('an own-fleet cost note has no carrier to dispute with');
    if (this.p.reconStatus === 'reconciled' || this.p.reconStatus === 'exact_match') throw new FreightReconClosedError(this.p.reconStatus);
    const words = (reason ?? '').trim();
    if (words.length < 10) throw new InvalidFreightInvoiceError('a dispute needs a reason of at least 10 characters');
    const e = evidenceFor(l);
    const cls = classifyDispute(lineVerdict(l.billedMinor, e), e, l.billedAttempts);
    l.disputeStatus = 'disputed';
    l.disputeReasonCode = cls.reason;
    l.disputeReason = words.slice(0, 2000);
    l.evidence = cls.evidence;
    if (this.p.reconStatus !== 'disputed_lines') {
      if (!canTransitionRecon(this.p.reconStatus, 'disputed_lines')) throw new FreightReconClosedError(this.p.reconStatus);
      this.p.reconStatus = 'disputed_lines';
    }
    this.events.push({ type: 'logistics.freight_line_disputed', payload: {
      invoiceId: this.p.id, tenantId: this.p.tenantId, lineId, lineNo: l.lineNo,
      reasonCode: cls.reason, billedMinor: l.billedMinor.toString(),
      expectedMinor: l.expectedMinor?.toString() ?? null, evidence: cls.evidence, disputedBy: actorUserId,
    } });
    return cls.reason;
  }

  /**
   * Resolve a disputed line: the carrier agreed, or we withdrew.
   *
   * `agreedMinor` is what will actually be paid for that line. It REPLACES the billed figure, because that is what
   * an agreed dispute means, and the line keeps its dispute history so the recovery is auditable — W241's "last
   * quarter recon recovered ₹11,840" is only a number if the resolutions are recorded.
   */
  resolveLine(lineId: string, actorUserId: string, outcome: 'agreed' | 'withdrawn', agreedMinor: bigint | null, now: Date = new Date()): void {
    const l = this.lines.find((x) => x.id === lineId);
    if (!l) throw new FreightLineNotFoundError(lineId);
    if (l.disputeStatus !== 'disputed') throw new InvalidFreightInvoiceError('only a disputed line can be resolved');
    if (outcome === 'agreed') {
      if (agreedMinor === null) throw new InvalidFreightInvoiceError('an agreed resolution needs the amount that will be paid');
      assertMinor(agreedMinor, 'agreedMinor');
      if (agreedMinor > l.billedMinor) throw new InvalidFreightInvoiceError('an agreed amount cannot exceed what was billed');
      const recovered = l.billedMinor - agreedMinor;
      l.billedMinor = agreedMinor;
      this.p.billedMinor -= recovered;
      // The recovery goes into the LINE's own evidence, not only into the event: W241 quotes "last quarter recon
      // recovered ₹11,840", and a figure like that must be re-derivable from the rows a year later rather than
      // depending on an event stream nobody kept. Merged, so the dispute's original evidence survives beside it.
      l.evidence = { ...(l.evidence ?? {}), resolvedOutcome: outcome, recoveredMinor: recovered.toString(), agreedMinor: agreedMinor.toString() };
      this.events.push({ type: 'logistics.freight_line_resolved', payload: {
        invoiceId: this.p.id, tenantId: this.p.tenantId, lineId, outcome,
        recoveredMinor: recovered.toString(), agreedMinor: agreedMinor.toString(), resolvedBy: actorUserId,
      } });
    } else {
      // Withdrawn: we accept the carrier's figure. Recorded as a zero recovery rather than as nothing, so the
      // recovery rate is honest about how often we lose the argument.
      l.evidence = { ...(l.evidence ?? {}), resolvedOutcome: outcome, recoveredMinor: '0' };
      this.events.push({ type: 'logistics.freight_line_resolved', payload: {
        invoiceId: this.p.id, tenantId: this.p.tenantId, lineId, outcome, recoveredMinor: '0', resolvedBy: actorUserId,
      } });
    }
    l.disputeStatus = 'resolved';
    l.resolvedAt = now;
    l.resolvedBy = actorUserId;
  }

  /**
   * Close the recon: every line is either clean or resolved, so the invoice is settled as far as this desk goes.
   *
   * Closing RELEASES the payment hold and nothing else — it does not pay, because the rail cannot carry a carrier
   * payee (see `paymentVerdict`). What it produces is a number an operator can act on and an event a future
   * payments wave can consume.
   */
  close(actorUserId: string, now: Date = new Date()): void {
    if (isCostNote(this.p.sourceKind)) throw new InvalidFreightInvoiceError('a cost note is booked to ops, not reconciled');
    const open = this.lines.filter((l) => l.disputeStatus === 'disputed');
    if (open.length > 0) throw new InvalidFreightInvoiceError(`${open.length} line(s) are still disputed`);
    if (this.p.reconStatus === 'pending') throw new InvalidFreightInvoiceError('run a recon pass before closing');
    if (!canTransitionRecon(this.p.reconStatus, 'reconciled')) throw new FreightReconClosedError(this.p.reconStatus);
    this.p.reconStatus = 'reconciled';
    this.p.reconciledAt = now;
    this.p.paymentHold = false;
    this.events.push({ type: 'logistics.freight_recon_closed', payload: {
      invoiceId: this.p.id, tenantId: this.p.tenantId, billedMinor: this.p.billedMinor.toString(),
      expectedMinor: this.p.expectedMinor.toString(), currencyCode: this.p.currencyCode, closedBy: actorUserId,
    } });
  }

  /** Book an own-fleet cost note to ops — W241's "(cost centre, not billed) · booked to ops". Terminal. */
  bookToOps(actorUserId: string, now: Date = new Date()): void {
    if (!isCostNote(this.p.sourceKind)) throw new InvalidFreightInvoiceError('only an own-fleet cost note is booked to ops');
    if (this.p.reconStatus !== 'pending') throw new FreightReconClosedError(this.p.reconStatus);
    this.p.reconStatus = 'booked_ops';
    this.p.reconciledAt = now;
    // The hold is released because there is nothing to hold: this money left as diesel and wages before the note
    // was written. It is recorded so the freight desk's total is the real one, not just the carrier part.
    this.p.paymentHold = false;
    this.events.push({ type: 'logistics.freight_cost_note_booked', payload: {
      invoiceId: this.p.id, tenantId: this.p.tenantId, billedMinor: this.p.billedMinor.toString(),
      currencyCode: this.p.currencyCode, bookedBy: actorUserId,
    } });
  }

  /** The clean total: matched lines, plus resolved lines at their agreed amount. What "pay the clean lines now"
   *  actually means in rupees. */
  cleanMinor(verdicts: Map<string, LineVerdict>): bigint {
    let sum = 0n;
    for (const l of this.lines) {
      if (l.disputeStatus === 'disputed') continue;
      if (l.disputeStatus === 'resolved') { sum += l.billedMinor; continue; }
      const v = verdicts.get(l.id);
      if (v && isClean(v)) sum += l.billedMinor;
    }
    return sum;
  }

  /** What is still being argued about, in money. */
  disputedMinor(): bigint {
    return this.lines.filter((l) => l.disputeStatus === 'disputed').reduce((a, l) => a + l.billedMinor, 0n);
  }
}
