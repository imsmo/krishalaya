// modules/logistics/read-models/freight-desk.read-model.ts · W241's list and W242's recon detail
// (PC-56 TENANT-5c). A READ model: replica-only, no writes, and every judgement comes from
// `domain/freight-recon.ts` so the desk and the write path cannot disagree about what a line means.
//
// The two things this file is most careful about, because they are the ones a screen can lie about:
//   • **the expected side.** W241's column header is literally "Expected (Σ charge_minor)", and nothing on this
//     platform writes `shipments.charge_minor` — the handler that creates virtually every shipment
//     (`OrderConfirmedHandler`) passes no charge at all. So a sum is reported with the count of lines it could NOT
//     price, and a fully unpriced invoice says so rather than printing ₹0 against a real bill and calling it 100%
//     leakage;
//   • **the payment.** W241 says carrier invoices "pay from the tenant wallet through the normal rails
//     (maker-checker above ₹25,000)". Those rails have no payee for a carrier and no freight purpose, so this
//     returns what is READY and names what is missing.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FreightInvoiceRepository } from '../repositories/freight-invoice.repository';
import { FreightInvoiceService } from '../services/freight-invoice.service';
import {
  ExpectedVerdict, LineVerdict, PaymentVerdict, ReconStatus, SourceKind,
  expectedVerdict, isCostNote, packVerdict, paymentVerdict, varianceBps, varianceDirection,
} from '../domain/freight-recon';
import { FleetActor } from '../services/logistics-partner.service';
import { QueryFreightInvoiceDto } from '../dto/query-freight-invoice.dto';
import { FreightInvoiceNotFoundError } from '../domain/logistics.errors';

export interface FreightDeskRow {
  id: string; invoiceNo: string; carrierId: string; carrierName: string | null;
  /** 'tenant_fleet' for the own-fleet cost note row — the console draws that row differently because it is not a
   *  bill from anybody. */
  carrierKind: string | null;
  sourceKind: SourceKind;
  periodStart: string; periodEnd: string; shipmentCount: number;
  billedMinor: string; expectedMinor: string; varianceMinor: string;
  varianceDirection: 'over' | 'under' | 'level';
  /** In basis points, computed from the rows — never a hand-typed percentage. */
  varianceBps: number | null;
  currencyCode: string; reconStatus: ReconStatus; disputedLines: number;
  paymentHold: boolean; receivedAt: string; reconciledAt: string | null;
  /** Null for a cost note: it is a cost centre, not a bill, and "expected" has no meaning for a diesel receipt. */
  expectedApplies: boolean;
}

export interface FreightDeskPage {
  items: FreightDeskRow[];
  nextCursor: string | null;
  /** W241's footer, counted over the CYCLE rather than the page: "3 of 3 invoices (Jun cycle)". */
  cycle: { from: string; to: string; total: number; byStatus: Record<string, number> } | null;
  /** W241's "last quarter recon recovered ₹11,840" — summed from resolved lines' own evidence, ONE FIGURE PER
   *  CURRENCY. A single total would add paise to cents the first time a tenant's air-freight consolidator bills in
   *  USD, and print the sum with a rupee sign (Rule Zero: no shortcut that assumes single-currency). */
  recovered: Array<{ currencyCode: string; recoveredMinor: string }>;
}

export interface FreightReconDetail {
  invoice: FreightDeskRow;
  expected: ExpectedVerdict;
  payment: PaymentVerdict;
  /** W242's "Dispute pack (4 lines + evidence) … 7-day response window" — and the honest note that the clock is
   *  not kept by this platform. */
  pack: ReturnType<typeof packVerdict> | null;
  cleanMinor: string;
  disputedMinor: string;
  /** **The same consignment billed on another invoice.** Not a price argument and not a phantom: a real shipment,
   *  billed correctly, billed twice. Invisible to any check that reads one invoice at a time — which is what a
   *  "reconcile this invoice" screen is. Empty for a cost note (nobody billed it) and empty when there is none. */
  duplicates: Array<{ awbNo: string; otherInvoiceId: string; otherInvoiceNo: string; billedMinor: string; periodStart: string }>;
  lines: Array<{
    id: string; lineNo: number; awbNo: string | null; shipmentId: string | null;
    billedMinor: string; expectedMinor: string | null; verdict: LineVerdict;
    disputeStatus: 'none' | 'disputed' | 'resolved'; disputeReasonCode: string | null; disputeReason: string | null;
    evidence: Record<string, unknown> | null; billedAttempts: number | null;
  }>;
}

/** A quarter, for W241's recovery figure. Ninety days back from now, computed rather than stored. */
const QUARTER_DAYS = 90;

@Injectable()
export class FreightDeskReadModel {
  constructor(
    private readonly repo: FreightInvoiceRepository,
    private readonly service: FreightInvoiceService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async desk(tenantId: string, actor: FleetActor, q: Omit<QueryFreightInvoiceDto, 'cursor'> & { cursor?: { c: string; id: string }; cycleFrom?: string; cycleTo?: string }): Promise<FreightDeskPage> {
    return timed(this.metrics, 'logistics.freight_desk', { tenant: tenantId }, async () => {
      const page = await this.service.list(tenantId, actor, q);
      const since = new Date(Date.now() - QUARTER_DAYS * 86_400_000).toISOString();
      const [cycle, recovered] = await Promise.all([
        q.cycleFrom && q.cycleTo
          ? this.repo.cycleCounts(tenantId, { from: q.cycleFrom, to: q.cycleTo }).then((c) => ({ from: q.cycleFrom!, to: q.cycleTo!, ...c }))
          : Promise.resolve(null),
        this.repo.recoveredSince(tenantId, since),
      ]);
      return {
        items: page.items.map((r) => this.row(r.header, r.carrierName, r.carrierKind, r.disputedLines)),
        nextCursor: page.nextCursor,
        cycle,
        recovered,
      };
    });
  }

  /** W242: one invoice, its lines, their verdicts, what is clean, what is disputed, and what may be paid. */
  async recon(tenantId: string, actor: FleetActor, id: string): Promise<FreightReconDetail> {
    return timed(this.metrics, 'logistics.freight_recon_detail', { tenant: tenantId }, async () => {
      const inv = await this.repo.getById(tenantId, id);
      if (!inv) throw new FreightInvoiceNotFoundError(id);
      // The actor check lives in the service's own read; asking it here keeps one gate rather than two.
      await this.service.getById(tenantId, actor, id);
      const [verdicts, duplicates] = await Promise.all([
        this.service.verdictsFor(tenantId, inv),
        // Asked across invoices, because the double-bill cannot be seen from inside one.
        isCostNote(inv.sourceKind) ? Promise.resolve([]) : this.repo.duplicateAwbsFor(tenantId, id),
      ]);
      const p = inv.toProps();
      const lines = inv.toLines();
      const clean = inv.cleanMinor(verdicts);
      const disputed = inv.disputedMinor();
      // **The maker-checker threshold is deliberately NOT read here.** It is the tenant setting
      // `payouts.batch_checker_threshold_minor`, owned by the payments module, which exports no public method for it —
      // and reaching into that module's repository would break the module blueprint while re-reading the setting here
      // would put one policy in two places. `null` travels as "not read", which `needsChecker` keeps distinct from
      // "no checker needed". It is academic until a carrier can be paid at all: there is no payee.
      const threshold: bigint | null = null;
      const disputedLines = lines.filter((l) => l.disputeStatus === 'disputed');
      return {
        invoice: this.row(p, null, null, disputedLines.length),
        expected: expectedVerdict(lines.map((l) => ({ expectedMinor: l.expectedMinor }))),
        payment: paymentVerdict({ kind: p.sourceKind, status: p.reconStatus, cleanMinor: clean, disputedMinor: disputed, thresholdMinor: threshold }),
        pack: disputedLines.length > 0 ? packVerdict(disputedLines.length, disputed) : null,
        cleanMinor: clean.toString(),
        disputedMinor: disputed.toString(),
        duplicates,
        lines: lines.map((l) => ({
          id: l.id, lineNo: l.lineNo, awbNo: l.awbNo, shipmentId: l.shipmentId,
          billedMinor: l.billedMinor.toString(), expectedMinor: l.expectedMinor?.toString() ?? null,
          verdict: verdicts.get(l.id) ?? { kind: 'unmatched' },
          disputeStatus: l.disputeStatus, disputeReasonCode: l.disputeReasonCode, disputeReason: l.disputeReason,
          evidence: l.evidence, billedAttempts: l.billedAttempts,
        })),
      };
    });
  }

  private row(p: { id: string; invoiceNo: string; carrierId: string; sourceKind: SourceKind; periodStart: string; periodEnd: string; shipmentCount: number; billedMinor: bigint; expectedMinor: bigint; currencyCode: string; reconStatus: ReconStatus; paymentHold: boolean; receivedAt: Date; reconciledAt: Date | null }, carrierName: string | null, carrierKind: string | null, disputedLines: number): FreightDeskRow {
    const variance = p.billedMinor - p.expectedMinor;
    const costNote = isCostNote(p.sourceKind);
    return {
      id: p.id, invoiceNo: p.invoiceNo, carrierId: p.carrierId, carrierName, carrierKind,
      sourceKind: p.sourceKind, periodStart: p.periodStart, periodEnd: p.periodEnd, shipmentCount: p.shipmentCount,
      billedMinor: p.billedMinor.toString(),
      expectedMinor: p.expectedMinor.toString(),
      // A cost note has no expected side at all — W241 prints a dash there ("Expected —"), and a zero would read as
      // "we expected this to be free".
      varianceMinor: costNote ? '0' : variance.toString(),
      varianceDirection: costNote ? 'level' : varianceDirection(variance),
      varianceBps: costNote ? null : varianceBps(variance, p.billedMinor),
      currencyCode: p.currencyCode, reconStatus: p.reconStatus, disputedLines,
      paymentHold: p.paymentHold,
      receivedAt: p.receivedAt instanceof Date ? p.receivedAt.toISOString() : String(p.receivedAt),
      reconciledAt: p.reconciledAt ? (p.reconciledAt instanceof Date ? p.reconciledAt.toISOString() : String(p.reconciledAt)) : null,
      expectedApplies: !costNote,
    };
  }
}
