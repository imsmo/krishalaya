// modules/logistics/services/delivery-zone.service.ts · PC-56 TENANT-SW-a · W233 — a tenant's delivery zones, LEAD + CHECKER.
//
// Before: create / PATCH (incl. the fee's charge_definition_id) / activate were one person with logistics.manage, audited without a
// reason (F-9), the PATCH could point a zone's fee at ANY definition — side-stepping W150's own charge checker — and nothing read the
// fee at placement (F-5). Now:
//   • PROPOSE (logistics.zones.manage: tenant_admin or fpo_coordinator): create, re-point fee, deactivate, re-activate — with a reason.
//     A fee may point only at a definition that passed W150's charge_change_proposals (service + trigger).
//   • CONFIRM (a DIFFERENT active tenant_admin, within 7 days — 0196 trg_dzp_moves is the wall): applied IN the confirming transaction
//     (trg_delivery_zones_gate admits the zone write only there). "Zone changes take effect for NEW orders only" is now true: the order
//     freezes its zone and fee at placement (orders.delivery_zone_id + charge_snapshot).
//   • Name / pincodes / regions: a direct edit with a reason, audited before → after (serviceability, not money).
//   • Lists page on a MICROSECOND keyset (F-14) and carry W233's "Orders 30d" — a real count of orders.delivery_zone_id.
//   • Expiry: unconfirmed for 7 days → expired, on 13b's clock (this service is a ProposalApplier with nothing to apply).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ProposalApplier } from '../../../core/jobs/proposal-applier.registry';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { gateRefusal } from '../../../shared/errors/db-gate';
import { DeliveryZone } from '../domain/delivery-zone.entity';
import { DeliveryZoneNotFoundError, ShipmentForbiddenError, ZoneProposalNotFoundError, ZoneProposalStateError, ZoneFeeNotApprovedError, LogisticsGateError } from '../domain/logistics.errors';
import { DeliveryZoneRepository } from '../repositories/delivery-zone.repository';
import { DeliveryZoneProposalRepository, ZoneProposalRow, ZoneProposalStatus } from '../repositories/delivery-zone-proposal.repository';
import { ProposeZoneDto, UpdateDeliveryZoneDto } from '../dto/create-delivery-zone.dto';
import { QueryDeliveryZoneDto } from '../dto/query-delivery-zone.dto';
import { OrderService } from '../../orders/services/order.service';

export interface ZoneActor { userId: string; canPropose: boolean; }
export const ZONE_CHANGED_EVENT = 'logistics.delivery_zone_changed';
export const ZONE_APPLIER_NAME = 'logistics.delivery_zone_proposals';

function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new LogisticsGateError(g.code, g.message);
  throw e;
}

@Injectable()
export class DeliveryZoneService implements ProposalApplier {
  readonly name = ZONE_APPLIER_NAME;
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: DeliveryZoneRepository,
    private readonly proposals: DeliveryZoneProposalRepository,
    private readonly orders: OrderService,
  ) {}

  private assertProposer(a: ZoneActor) { if (!a.canPropose) throw new ShipmentForbiddenError('changing delivery zones requires logistics.zones.manage'); }

  /* ── PROPOSE ── */
  async propose(tenantId: string, actor: ZoneActor, idemKey: string, dto: ProposeZoneDto, ip: string | null) {
    this.assertProposer(actor);
    // validate the zone's own invariants up front (name, pincodes, regions) — the same entity the confirmation will write
    const create = dto.kind === 'create'
      ? DeliveryZone.create({ id: uuidv7(), tenantId, defaultName: dto.defaultName, pincodes: dto.pincodes, regionIds: dto.regionIds, chargeDefinitionId: dto.chargeDefinitionId ?? null }).toProps()
      : null;
    const zoneId = create ? create.id : (dto as { zoneId: string }).zoneId;
    const defId = dto.kind === 'create' ? (dto.chargeDefinitionId ?? null) : dto.kind === 'repoint_fee' ? dto.chargeDefinitionId : null;
    return this.idem.remember(idemKey, actor.userId, 'logistics.zone_propose', () =>
      timed(this.metrics, 'logistics.zone_propose', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          if (defId && !(await this.proposals.definitionApprovedTx(tx, tenantId, defId))) throw new ZoneFeeNotApprovedError(defId);
          let before: Record<string, unknown> | null = null;
          if (!create) {
            const z = await this.repo.getForUpdate(tx, tenantId, zoneId);
            if (!z) throw new DeliveryZoneNotFoundError(zoneId);
            const p = z.toProps(); before = { isActive: p.isActive, chargeDefinitionId: p.chargeDefinitionId };
          }
          const id = uuidv7();
          try {
            await this.proposals.insertTx(tx, { id, tenantId, kind: dto.kind, zoneId, defaultName: create?.defaultName ?? null, pincodes: create ? [...create.pincodes] : null,
              regionIds: create ? [...create.regionIds] : null, chargeDefinitionId: defId, reason: dto.reason, proposedBy: actor.userId });
          } catch (e) { rethrowGate(e); }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.delivery_zone_change_proposed', entityType: 'delivery_zone_proposal', entityId: id,
            oldValue: before, newValue: { kind: dto.kind, zoneId, ...(create ? { defaultName: create.defaultName, pincodes: create.pincodes.length, regionIds: create.regionIds.length } : {}), chargeDefinitionId: defId },
            reason: dto.reason, ip });
          return this.view((await this.proposals.getForUpdate(tx, tenantId, id))!, actor.userId);
        }, { userId: actor.userId })));
  }

  /* ── CONFIRM / REFUSE ── */
  async confirm(tenantId: string, actor: ZoneActor, idemKey: string, id: string, ip: string | null) {
    this.assertProposer(actor);
    if (!UUID_RE.test(id)) throw new ZoneProposalNotFoundError(id);
    return this.idem.remember(idemKey, actor.userId, 'logistics.zone_confirm', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.proposals.getForUpdate(tx, tenantId, id);
        if (!p) throw new ZoneProposalNotFoundError(id);
        if (p.status !== 'proposed') throw new ZoneProposalStateError(p.status);
        let before: Record<string, unknown> | null = null;
        if (p.kind !== 'create') {
          const z = await this.repo.getForUpdate(tx, tenantId, p.zoneId);
          if (!z) throw new DeliveryZoneNotFoundError(p.zoneId);
          const zp = z.toProps(); before = { isActive: zp.isActive, chargeDefinitionId: zp.chargeDefinitionId };
        }
        // NO maker ≠ checker check here on purpose: trg_dzp_moves (+ trg_delivery_zones_gate) IS the wall.
        try {
          await this.proposals.confirmTx(tx, tenantId, id, actor.userId);
          await tx.query(`SELECT set_config('app.zone_proposal_id', $1, true)`, [id]);
          if (p.kind === 'create') {
            await this.proposals.insertZoneTx(tx, { id: p.zoneId, tenantId, defaultName: p.defaultName!, pincodes: p.pincodes ?? [], regionIds: p.regionIds ?? [],
              chargeDefinitionId: p.chargeDefinitionId, proposalId: id, createdBy: p.proposedBy });
          } else if (p.kind === 'repoint_fee') {
            await this.proposals.repointTx(tx, tenantId, p.zoneId, p.chargeDefinitionId, id);
          } else {
            await this.proposals.setActiveTx(tx, tenantId, p.zoneId, p.kind === 'activate', id);
          }
          await tx.query(`SELECT set_config('app.zone_proposal_id', '', true)`);
        } catch (e) { rethrowGate(e); }
        const after = (await this.repo.getForUpdate(tx, tenantId, p.zoneId))!.toProps();
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `logistics.delivery_zone_${p.kind === 'create' ? 'created' : p.kind === 'repoint_fee' ? 'fee_repointed' : p.kind === 'activate' ? 'activated' : 'deactivated'}`,
          entityType: 'delivery_zone', entityId: p.zoneId,
          oldValue: before, newValue: { isActive: after.isActive, chargeDefinitionId: after.chargeDefinitionId, proposalId: id, proposedBy: p.proposedBy, confirmedBy: actor.userId },
          reason: p.reason, ip });
        await this.outbox.write(tx, { tenantId, aggregateType: 'delivery_zone', aggregateId: p.zoneId, eventType: ZONE_CHANGED_EVENT, payload: { v: 1, zoneId: p.zoneId, kind: p.kind, proposalId: id } });
        return this.view((await this.proposals.getForUpdate(tx, tenantId, id))!, actor.userId);
      }, { userId: actor.userId }));
  }

  async refuse(tenantId: string, actor: ZoneActor, idemKey: string, id: string, reason: string, ip: string | null) {
    this.assertProposer(actor);
    if (!UUID_RE.test(id)) throw new ZoneProposalNotFoundError(id);
    return this.idem.remember(idemKey, actor.userId, 'logistics.zone_refuse', () =>
      this.uow.run(tenantId, async (tx) => {
        const p = await this.proposals.getForUpdate(tx, tenantId, id);
        if (!p) throw new ZoneProposalNotFoundError(id);
        if (p.status !== 'proposed') throw new ZoneProposalStateError(p.status);
        try { await this.proposals.refuseTx(tx, tenantId, id, actor.userId, reason.trim()); } catch (e) { rethrowGate(e); }
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.delivery_zone_change_refused', entityType: 'delivery_zone_proposal', entityId: id,
          oldValue: { status: 'proposed', proposedBy: p.proposedBy }, newValue: { status: 'refused', refusedBy: actor.userId, withdrawn: p.proposedBy === actor.userId }, reason: reason.trim(), ip });
        return this.view((await this.proposals.getForUpdate(tx, tenantId, id))!, actor.userId);
      }, { userId: actor.userId }));
  }

  /* ── the direct coverage edit (name / pincodes / regions) ── */
  async update(tenantId: string, actor: ZoneActor, id: string, dto: UpdateDeliveryZoneDto, ip: string | null) {
    this.assertProposer(actor);
    return timed(this.metrics, 'logistics.zone_update', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const zone = await this.repo.getForUpdate(tx, tenantId, id);
        if (!zone) throw new DeliveryZoneNotFoundError(id);
        const diff = zone.update({ defaultName: dto.defaultName, pincodes: dto.pincodes, regionIds: dto.regionIds });
        const p = zone.toProps();
        await this.proposals.updateCoverageTx(tx, tenantId, id, { defaultName: p.defaultName, pincodes: [...p.pincodes], regionIds: [...p.regionIds] });
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.delivery_zone_updated', entityType: 'delivery_zone', entityId: id, oldValue: diff.old, newValue: diff.new, reason: dto.reason, ip });
        return this.serialize(p, 0);
      }, { userId: actor.userId }));
  }

  /* ── ProposalApplier: zone proposals apply at confirmation; the clock only expires them ── */
  async dueToApplyTx(): Promise<string[]> { return []; }
  dueToExpireTx(tx: TxContext, tenantId: string, limit: number) { return this.proposals.dueToExpireTx(tx, tenantId, limit); }
  async applyDue(): Promise<'applied' | 'skipped'> { return 'skipped'; }
  async expireDue(tenantId: string, id: string): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const p = await this.proposals.getForUpdate(tx, tenantId, id);
      if (!p || p.status !== 'proposed') return false;
      const ok = (await this.proposals.markExpiredTx(tx, tenantId, id)) > 0;
      if (ok) await this.audit.write(tx, { tenantId, actorUserId: null, action: 'logistics.delivery_zone_change_expired', entityType: 'delivery_zone_proposal', entityId: id,
        oldValue: { status: 'proposed', proposedBy: p.proposedBy }, newValue: { status: 'expired' }, reason: 'unconfirmed after 7 days' });
      return ok;
    }, { userId: undefined });
  }

  /* ── READS ── */
  async getById(tenantId: string, id: string) {
    const zone = await this.repo.getById(tenantId, id);
    if (!zone) throw new DeliveryZoneNotFoundError(id);
    const counts = await this.orders.ordersByZoneSince(tenantId, [id], 30);
    return this.serialize(zone.toProps(), counts.get(id) ?? 0);
  }

  async list(tenantId: string, q: QueryDeliveryZoneDto) {
    const rows = await this.repo.list(tenantId, { pincode: q.pincode, activeOnly: q.activeOnly, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit });
    const counts = await this.orders.ordersByZoneSince(tenantId, rows.map((r) => r.zone.id), 30);
    const items = rows.map((r) => this.serialize(r.zone.toProps(), counts.get(r.zone.id) ?? 0, r.createdUs));
    const last = rows[rows.length - 1];
    return { items, nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdUs, last.zone.id) : null };
  }

  async listProposals(tenantId: string, viewer: string, q: { status?: ZoneProposalStatus; zoneId?: string; cursor?: string; limit: number }) {
    const rows = await this.proposals.list(tenantId, { status: q.status, zoneId: q.zoneId, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit });
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.view(r, viewer)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdAt, last.id) : null };
  }
  async getProposal(tenantId: string, viewer: string, id: string) {
    if (!UUID_RE.test(id)) throw new ZoneProposalNotFoundError(id);
    const p = await this.proposals.get(tenantId, id);
    if (!p) throw new ZoneProposalNotFoundError(id);
    return this.view(p, viewer);
  }
  /** The fee definitions a zone may point at (W150-approved, this tenant's). */
  approvedFeeDefinitions(tenantId: string) { return this.proposals.approvedDefinitions(tenantId); }

  /** W233's serviceability test box: "does this pincode get delivery?" — the active zones that serve it (what checkout would offer). */
  async serviceability(tenantId: string, pincode: string) {
    const zones = await this.repo.listServiceable(tenantId, { pincode, limit: 25 });
    return { pincode, serviceable: zones.length > 0, zones: zones.map((z) => { const p = z.toProps(); return { id: p.id, defaultName: p.defaultName, chargeDefinitionId: p.chargeDefinitionId }; }) };
  }

  private view(p: ZoneProposalRow, viewer: string) {
    return { id: p.id, kind: p.kind, zoneId: p.zoneId, status: p.status, defaultName: p.defaultName, pincodes: p.pincodes, regionIds: p.regionIds,
      chargeDefinitionId: p.chargeDefinitionId, reason: p.reason, proposedBy: p.proposedBy, proposedAt: p.proposedAt, expiresAt: p.expiresAt,
      confirmedBy: p.confirmedBy, confirmedAt: p.confirmedAt, refusedBy: p.refusedBy, refusedAt: p.refusedAt, refuseReason: p.refuseReason, expiredAt: p.expiredAt,
      createdAt: p.createdAt, canConfirm: p.status === 'proposed' && p.proposedBy !== viewer, canRefuse: p.status === 'proposed', isMine: p.proposedBy === viewer };
  }
  private serialize(p: ReturnType<DeliveryZone['toProps']>, orders30d: number, createdUs?: string) {
    return { id: p.id, defaultName: p.defaultName, pincodes: p.pincodes, regionIds: p.regionIds, chargeDefinitionId: p.chargeDefinitionId, isActive: p.isActive,
      createdAt: createdUs ?? (p.createdAt ? new Date(p.createdAt).toISOString() : null), orders30d };
  }
}
