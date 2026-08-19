// modules/logistics/services/freight-invoice.service.ts · the freight desk's writes (PC-56 TENANT-5c).
// Every write: one ACID tx (UoW), outbox events in the SAME tx (Law 4), an audit row for every money-adjacent
// decision, idempotency on the two acts that create or change money (Law 3). Authorization THROWS.
//
// **NOTHING HERE MOVES MONEY.** `freight_invoices.payout_id` (0070) exists for the day a carrier can be paid, and
// this service never fills it: `payouts.bank_account_id` is NOT NULL and a carrier is a `logistics_partners` row,
// which can own no bank account — so there is no payee, and `PayoutService.requestPayout` is a member-withdrawal
// path gated on the CALLING USER's per-role KYC, which is the wrong actor entirely. The desk computes what is ready
// to pay and says the rail is missing (see `domain/freight-recon.ts`'s `paymentVerdict`). Wiring a payout here would
// mean paying a carrier's bill against a farmer's KYC.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { FreightInvoice, FreightLineProps } from '../domain/freight-invoice.entity';
import { DomainEvent } from '../domain/logistics.events';
import { FreightInvoiceNotFoundError, ShipmentForbiddenError } from '../domain/logistics.errors';
import { FreightInvoiceRepository, ShipmentEvidenceRow } from '../repositories/freight-invoice.repository';
import { LogisticsPartnerRepository } from '../repositories/logistics-partner.repository';
import { PartnerNotFoundError } from '../domain/logistics.errors';
import { LineEvidence, LineVerdict, isCostNote, lineVerdict } from '../domain/freight-recon';
import { CreateFreightInvoiceDto, DisputeFreightLineDto, ResolveFreightLineDto } from '../dto/create-freight-invoice.dto';
import { QueryFreightInvoiceDto } from '../dto/query-freight-invoice.dto';
import { FleetActor, encodeFleetCursor } from './logistics-partner.service';
import { ShipmentStatus } from '../domain/shipment.state';

/** `logistics_freight_recon` (Law 10). OFF ships the pre-wave behaviour: the desk does not exist. */
export const FREIGHT_RECON_FLAG = 'logistics_freight_recon';

@Injectable()
export class FreightInvoiceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: FreightInvoiceRepository,
    private readonly partners: LogisticsPartnerRepository,
    private readonly flags: FlagsService,
  ) {}

  /** W241's restricted state: "Logistics + finance dual scope; payment approval is maker-checker." The reads and the
   *  recon need `logistics.manage`; the PAYMENT would need the finance checker, and that half does not exist yet. */
  private assertManager(a: FleetActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }

  /**
   * Record a carrier invoice (or an own-fleet cost note) with its lines.
   *
   * The carrier must be a partner this tenant can see — including its OWN fleet, which is a `logistics_partners` row
   * with `partner_kind = 'tenant_fleet'`, exactly as 0070's comment says. Nothing is matched yet: recording is one
   * act and reconciling is another, because an operator uploading a bill at 09:00 has not decided anything about it.
   */
  async record(tenantId: string, actor: FleetActor, idemKey: string, dto: CreateFreightInvoiceDto, ip: string | null) {
    this.assertManager(actor);
    const partner = await this.partners.getById(tenantId, dto.carrierId);
    if (!partner) throw new PartnerNotFoundError(dto.carrierId);
    return this.idem.remember(idemKey, actor.userId, 'logistics.freight_invoice_record', () =>
      timed(this.metrics, 'logistics.freight_invoice_record', { tenant: tenantId }, async () => {
        const inv = FreightInvoice.record({
          id: uuidv7(), tenantId, carrierId: dto.carrierId, invoiceNo: dto.invoiceNo,
          sourceKind: dto.sourceKind, periodStart: dto.periodStart, periodEnd: dto.periodEnd,
          billedMinor: BigInt(dto.billedMinor), currencyCode: dto.currencyCode,
          invoiceMediaId: dto.invoiceMediaId ?? null,
          lines: (dto.lines ?? []).map((l) => ({
            id: uuidv7(), awbNo: l.awbNo ?? null, shipmentId: l.shipmentId ?? null,
            billedMinor: BigInt(l.billedMinor), billedAttempts: l.billedAttempts ?? null,
          })),
        });
        return this.uow.run(tenantId, async (tx) => {
          await this.repo.insert(tx, inv);
          const p = inv.toProps();
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.freight_invoice_recorded',
            entityType: 'freight_invoice', entityId: p.id,
            newValue: { invoiceNo: p.invoiceNo, carrierId: p.carrierId, sourceKind: p.sourceKind, billedMinor: p.billedMinor.toString(), currencyCode: p.currencyCode, lines: inv.toLines().length }, ip });
          await this.flush(tx, tenantId, p.id, inv.pullEvents());
          return this.serialize(inv);
        }, { userId: actor.userId });
      }));
  }

  /**
   * Run the recon pass: match every line to a shipment, snapshot what we expected, and roll the header up.
   *
   * Re-runnable (a carrier's correction arrives next cycle) but never on a closed invoice. Idempotent per key so a
   * double-tap does not write two audit rows for one decision — the STATE would be the same either way, and an
   * audit trail that says a person decided twice is a false record of who decided what.
   */
  async reconcile(tenantId: string, actor: FleetActor, idemKey: string, id: string, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'logistics.freight_reconcile', () =>
      timed(this.metrics, 'logistics.freight_reconcile', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const inv = await this.repo.getForUpdate(tx, tenantId, id);
          if (!inv) throw new FreightInvoiceNotFoundError(id);
          const ev = await this.evidenceMap(tenantId, inv);
          const out = inv.reconcile((l) => ev(l));
          await this.repo.updateHeader(tx, inv);
          await this.repo.updateLines(tx, inv.toLines());
          const p = inv.toProps();
          this.metrics.inc('logistics.freight_recon_pass', { status: p.reconStatus });
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.freight_reconciled',
            entityType: 'freight_invoice', entityId: id, oldValue: { status: out.from },
            newValue: { status: out.to, matched: out.totals.matched, over: out.totals.over, under: out.totals.under,
              unmatched: out.totals.unmatched, unpriced: out.totals.unpriced, expectedMinor: p.expectedMinor.toString() }, ip });
          await this.flush(tx, tenantId, id, inv.pullEvents());
          return { ...this.serialize(inv), recon: { ...out.totals, billedMinor: out.totals.billedMinor.toString() } };
        }, { userId: actor.userId })));
  }

  /** Dispute one line, in the operator's own words, with the evidence attached by the domain. */
  async disputeLine(tenantId: string, actor: FleetActor, id: string, lineId: string, dto: DisputeFreightLineDto, ip: string | null) {
    this.assertManager(actor);
    return timed(this.metrics, 'logistics.freight_dispute', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const inv = await this.repo.getForUpdate(tx, tenantId, id);
        if (!inv) throw new FreightInvoiceNotFoundError(id);
        const ev = await this.evidenceMap(tenantId, inv);
        const reasonCode = inv.disputeLine(lineId, actor.userId, dto.reason, (l) => ev(l));
        await this.repo.updateHeader(tx, inv);
        await this.repo.updateLines(tx, inv.toLines());
        this.metrics.inc('logistics.freight_line_disputed', { reason: reasonCode });
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.freight_line_disputed',
          entityType: 'freight_invoice_line', entityId: lineId,
          newValue: { invoiceId: id, reasonCode, reason: dto.reason }, ip });
        await this.flush(tx, tenantId, id, inv.pullEvents());
        return this.serialize(inv);
      }, { userId: actor.userId }));
  }

  /** Resolve a disputed line — agreed at an amount, or withdrawn. Idempotency-Key required: this one changes the
   *  invoice's total, which is money. */
  async resolveLine(tenantId: string, actor: FleetActor, idemKey: string, id: string, lineId: string, dto: ResolveFreightLineDto, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'logistics.freight_resolve', () =>
      timed(this.metrics, 'logistics.freight_resolve', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const inv = await this.repo.getForUpdate(tx, tenantId, id);
          if (!inv) throw new FreightInvoiceNotFoundError(id);
          const before = inv.toProps().billedMinor.toString();
          inv.resolveLine(lineId, actor.userId, dto.outcome, dto.agreedMinor === undefined ? null : BigInt(dto.agreedMinor));
          await this.repo.updateHeader(tx, inv);
          await this.repo.updateLines(tx, inv.toLines());
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.freight_line_resolved',
            entityType: 'freight_invoice_line', entityId: lineId,
            oldValue: { invoiceBilledMinor: before },
            newValue: { invoiceId: id, outcome: dto.outcome, agreedMinor: dto.agreedMinor ?? null, invoiceBilledMinor: inv.toProps().billedMinor.toString() }, ip });
          await this.flush(tx, tenantId, id, inv.pullEvents());
          return this.serialize(inv);
        }, { userId: actor.userId })));
  }

  /**
   * Close the recon (or book a cost note to ops). This is the act W241's "payment holds until recon closes" waits
   * for — it releases the hold and emits the settled total. It does NOT pay: there is no rail (see the file header).
   */
  async close(tenantId: string, actor: FleetActor, idemKey: string, id: string, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'logistics.freight_close', () =>
      timed(this.metrics, 'logistics.freight_close', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const inv = await this.repo.getForUpdate(tx, tenantId, id);
          if (!inv) throw new FreightInvoiceNotFoundError(id);
          const from = inv.status;
          if (isCostNote(inv.sourceKind)) inv.bookToOps(actor.userId); else inv.close(actor.userId);
          await this.repo.updateHeader(tx, inv);
          const p = inv.toProps();
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId,
            action: isCostNote(p.sourceKind) ? 'logistics.freight_cost_note_booked' : 'logistics.freight_recon_closed',
            entityType: 'freight_invoice', entityId: id, oldValue: { status: from, paymentHold: true },
            newValue: { status: p.reconStatus, paymentHold: p.paymentHold, billedMinor: p.billedMinor.toString() }, ip });
          await this.flush(tx, tenantId, id, inv.pullEvents());
          return this.serialize(inv);
        }, { userId: actor.userId })));
  }

  async getById(tenantId: string, actor: FleetActor, id: string) {
    this.assertManager(actor);
    const inv = await this.repo.getById(tenantId, id);
    if (!inv) throw new FreightInvoiceNotFoundError(id);
    return this.serialize(inv);
  }

  async list(tenantId: string, actor: FleetActor, q: Omit<QueryFreightInvoiceDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    this.assertManager(actor);
    const rows = await this.repo.list(tenantId, { reconStatus: q.reconStatus, carrierId: q.carrierId, sourceKind: q.sourceKind, cursor: q.cursor, limit: q.limit });
    const last = rows[rows.length - 1];
    return {
      items: rows,
      nextCursor: rows.length === q.limit && last ? encodeFleetCursor(last.header.receivedAt, last.header.id) : null,
    };
  }

  async isEnabled(tenantId: string): Promise<boolean> {
    return this.flags.isEnabled(FREIGHT_RECON_FLAG, { tenantId }).catch(() => false);
  }

  /**
   * Build the line → evidence lookup for one invoice.
   *
   * Matched on AWB first, shipment id second — a carrier bills under its own AWB and has never heard of our uuid.
   * A line that matches nothing gets an evidence row with `shipmentId: null`, which the domain reads as `unmatched`:
   * **we were billed for a consignment we have no record of shipping**, which is the leakage class neither W241 nor
   * W242 draws and the most expensive one there is.
   */
  private async evidenceMap(tenantId: string, inv: FreightInvoice): Promise<(l: Readonly<FreightLineProps>) => LineEvidence> {
    const p = inv.toProps();
    const lines = inv.toLines();
    const rows = await this.repo.evidenceFor(tenantId, {
      awbNos: lines.map((l) => l.awbNo).filter((x): x is string => !!x),
      shipmentIds: lines.map((l) => l.shipmentId).filter((x): x is string => !!x),
    }, { from: p.periodStart, to: p.periodEnd });
    const byAwb = new Map<string, ShipmentEvidenceRow>();
    const byId = new Map<string, ShipmentEvidenceRow>();
    for (const r of rows) { if (r.awbNo) byAwb.set(r.awbNo, r); byId.set(r.id, r); }
    return (l) => {
      const hit = (l.awbNo ? byAwb.get(l.awbNo) : undefined) ?? (l.shipmentId ? byId.get(l.shipmentId) : undefined);
      return {
        shipmentId: hit?.id ?? null,
        awbNo: l.awbNo,
        status: (hit?.status as ShipmentStatus | undefined) ?? null,
        expectedMinor: hit?.chargeMinor ?? null,
        deliveryAttempts: hit?.deliveryAttempts ?? 0,
        requiresColdChain: hit?.requiresColdChain ?? false,
      };
    };
  }

  /** The verdicts for a read (no writes) — the recon detail screen needs them without running a pass. */
  async verdictsFor(tenantId: string, inv: FreightInvoice): Promise<Map<string, LineVerdict>> {
    const ev = await this.evidenceMap(tenantId, inv);
    const out = new Map<string, LineVerdict>();
    for (const l of inv.toLines()) out.set(l.id, lineVerdict(l.billedMinor, ev(l)));
    return out;
  }

  private serialize(inv: FreightInvoice) {
    const p = inv.toProps();
    return {
      id: p.id, carrierId: p.carrierId, invoiceNo: p.invoiceNo, sourceKind: p.sourceKind,
      periodStart: p.periodStart, periodEnd: p.periodEnd, shipmentCount: p.shipmentCount,
      billedMinor: p.billedMinor.toString(), expectedMinor: p.expectedMinor.toString(),
      varianceMinor: (p.billedMinor - p.expectedMinor).toString(), currencyCode: p.currencyCode,
      reconStatus: p.reconStatus, invoiceMediaId: p.invoiceMediaId,
      receivedAt: p.receivedAt, reconciledAt: p.reconciledAt, paymentHold: p.paymentHold,
      // Kept on the wire as the null it is: 0070 created the column for a payout that cannot exist for a carrier,
      // and a consumer must be able to see that it is empty rather than assume the payment happened elsewhere.
      payoutId: p.payoutId,
      lines: inv.toLines().map((l) => ({
        id: l.id, lineNo: l.lineNo, awbNo: l.awbNo, shipmentId: l.shipmentId,
        billedMinor: l.billedMinor.toString(), expectedMinor: l.expectedMinor?.toString() ?? null,
        billedAttempts: l.billedAttempts, disputeStatus: l.disputeStatus, disputeReasonCode: l.disputeReasonCode,
        disputeReason: l.disputeReason, evidence: l.evidence, resolvedAt: l.resolvedAt,
      })),
    };
  }
  private async flush(tx: TxContext, tenantId: string, aggregateId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'freight_invoice', aggregateId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
