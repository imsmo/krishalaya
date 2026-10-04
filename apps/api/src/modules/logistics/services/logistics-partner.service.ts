// modules/logistics/services/logistics-partner.service.ts · register/manage a tenant's carriers (3PL link,
// own fleet, rider). Every write: one ACID tx (UoW), outbox event in the SAME tx (Law 4), audit row for the
// state-changing action, idempotency on create. Authorization THROWS (logistics.manage). Reads on the replica,
// keyset-paginated, always bounded. Platform 3PLs (tenant_id NULL) are read-only here — written by admin-api (Law 11).
//
// PC-56 TENANT-SW-e · W228 + W2378–W2384. The list is W228's table: kind · capability (vehicles, capacity, reefer, cold chain)
// · "Shipments 30d" (a real count) · "On-time" REFUSED BY NAME (no promised delivery time is recorded) · status (+ the reason
// of the last (de)activation). A rider row adds the rider's KYC on the delivery-partner role (9a), wage protection (their own
// payout terms, or the organisation's default — said which) and "insured through the platform" REFUSED BY NAME. Contacts are
// printed masked (1b). A rider carrier is a person holding the delivery-partner role (here AND in 0201's trigger).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { gateRefusal } from '../../../shared/errors/db-gate';
import { LogisticsPartner } from '../domain/logistics-partner.entity';
import { DomainEvent } from '../domain/logistics.events';
import { LogisticsOpsRefusedError, PartnerNotFoundError, ShipmentForbiddenError } from '../domain/logistics.errors';
import { onTimeVerdict, riderFacts, RiderKyc } from '../domain/logistics-ops';
import { CarrierFacts, LogisticsPartnerRepository } from '../repositories/logistics-partner.repository';
import { CreateLogisticsPartnerDto, UpdateLogisticsPartnerDto } from '../dto/create-logistics-partner.dto';
import { QueryLogisticsPartnerDto } from '../dto/query-logistics-partner.dto';
import { maskPhone, shortName } from '../../labour/domain/display';

export interface FleetActor { userId: string; canManage: boolean; }

/**
 * Shared keyset cursor codec for the fleet read models (instant|id, base64).
 *
 * PC-56 TENANT-SW-e · F-14 — MICROSECOND-EXACT. This used to take a JS `Date` (milliseconds) of a microsecond column, so rows
 * written inside one millisecond across a page boundary were skipped (8b/9a class). It now takes the instant AS THE DATABASE
 * PRINTED IT (`to_char(… 'US')`, six fractional digits — `US_SQL`) and refuses anything else; the repositories compare the
 * decoded text as `timestamptz`, so it never passes through a Date. The base64 / `c|id` shape is unchanged for the controllers.
 */
const FLEET_US = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export function encodeFleetCursor(instantUs: string | null | undefined, id: string): string {
  if (typeof instantUs !== 'string' || !FLEET_US.test(instantUs)) throw new Error(`fleet cursor: '${String(instantUs)}' is not a microsecond instant`);
  return Buffer.from(`${instantUs}|${id}`).toString('base64');
}

function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new LogisticsOpsRefusedError(g.code, g.message, 409);
  if ((e as { code?: string })?.code === '23505' && /vehicles_partner_id_reg_no_key/.test(String((e as Error)?.message))) {
    throw new LogisticsOpsRefusedError('VEHICLE_REG_EXISTS', 'A vehicle with this registration is already on this carrier', 409);
  }
  throw e;
}

@Injectable()
export class LogisticsPartnerService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: LogisticsPartnerRepository,
  ) {}

  private assertManager(a: FleetActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }

  async create(tenantId: string, actor: FleetActor, idemKey: string, dto: CreateLogisticsPartnerDto, ip: string | null) {
    this.assertManager(actor);
    return this.idem.remember(idemKey, actor.userId, 'logistics.partner_create', () =>
      timed(this.metrics, 'logistics.partner_create', { tenant: tenantId }, async () => {
        const partner = LogisticsPartner.create({
          id: uuidv7(), tenantId, partnerKind: dto.partnerKind, providerCode: dto.providerCode ?? null,
          defaultName: dto.defaultName, riderUserId: dto.riderUserId ?? null, supportsColdChain: dto.supportsColdChain,
          contactPhone: dto.contactPhone ?? null,
        });
        return this.uow.run(tenantId, async (tx) => {
          // W2378: a rider is a person with the delivery-partner role — named here, enforced again by trg_lp_rider
          if (dto.partnerKind === 'rider' && dto.riderUserId && !(await this.repo.isDeliveryPartner(tx, tenantId, dto.riderUserId))) {
            throw new LogisticsOpsRefusedError('RIDER_NOT_DELIVERY_PARTNER', 'A rider carrier is a person holding the delivery-partner role in this organisation', 422);
          }
          try {
            await this.repo.insert(tx, partner);
            const p = partner.toProps();
            let vehicleId: string | null = null;
            if (dto.vehicle) vehicleId = await this.repo.insertVehicle(tx, { tenantId, partnerId: p.id, regNo: dto.vehicle.regNo.toUpperCase().replace(/\s+/g, ''), capacityKg: dto.vehicle.capacityKg ?? null, isRefrigerated: dto.vehicle.isRefrigerated });
            await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.partner_registered', entityType: 'logistics_partner', entityId: p.id,
              newValue: { partnerKind: p.partnerKind, defaultName: p.defaultName, contactPhoneTail: p.contactPhone ? p.contactPhone.slice(-4) : null, riderUserId: p.riderUserId, vehicleId }, ip });
            await this.flush(tx, tenantId, p.id, partner.pullEvents());
            return { ...this.serialize(p), vehicleId };
          } catch (e) { rethrowGate(e); }
        }, { userId: actor.userId });
      }));
  }

  async update(tenantId: string, actor: FleetActor, id: string, dto: UpdateLogisticsPartnerDto, ip: string | null) {
    this.assertManager(actor);
    return timed(this.metrics, 'logistics.partner_update', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const partner = await this.repo.getForUpdate(tx, tenantId, id);
        if (!partner) throw new PartnerNotFoundError(id);
        const diff = partner.update({ defaultName: dto.defaultName, providerCode: dto.providerCode, supportsColdChain: dto.supportsColdChain, contactPhone: dto.contactPhone });
        await this.repo.update(tx, partner);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'logistics.partner_updated', entityType: 'logistics_partner', entityId: id, oldValue: diff.old, newValue: diff.new, ip });
        return this.serialize(partner.toProps());
      }, { userId: actor.userId }));
  }

  /** W2382–W2384: activate / deactivate WITH A REASON (≥ 10), audited with it; the reason is shown on W228's status cell. */
  async setActive(tenantId: string, actor: FleetActor, id: string, isActive: boolean, ip: string | null, reason?: string) {
    this.assertManager(actor);
    const why = (reason ?? '').trim();
    if (why.length < 10) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A reason of at least 10 characters is recorded with a carrier (de)activation', 422);
    return timed(this.metrics, 'logistics.partner_set_active', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const partner = await this.repo.getForUpdate(tx, tenantId, id);
        if (!partner) throw new PartnerNotFoundError(id);
        const diff = partner.setActive(isActive, why);
        await this.repo.update(tx, partner);
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: `logistics.partner_${diff.action}`, entityType: 'logistics_partner', entityId: id, oldValue: diff.old, newValue: diff.new, reason: why, ip });
        return this.serialize(partner.toProps());
      }, { userId: actor.userId }));
  }

  async getById(tenantId: string, id: string) {
    const partner = await this.repo.getById(tenantId, id);
    if (!partner) throw new PartnerNotFoundError(id);
    const facts = await this.repo.carrierFacts(tenantId, [id]);
    return this.carrierRow(partner.toProps(), facts.get(id));
  }

  async list(tenantId: string, q: Omit<QueryLogisticsPartnerDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const rows = await this.repo.list(tenantId, { partnerKind: q.partnerKind, activeOnly: q.activeOnly, includePlatform: q.includePlatform, cursor: q.cursor, limit: q.limit });
    const facts = await this.repo.carrierFacts(tenantId, rows.map((r) => r.id));
    const items = rows.map((e) => this.carrierRow(e.toProps(), facts.get(e.id)));
    const last = rows[rows.length - 1];
    const nextCursor = rows.length === q.limit && last ? encodeFleetCursor(last.toProps().createdUs, last.id) : null;
    return { items, nextCursor, onTime: onTimeVerdict() };
  }

  private serialize(p: ReturnType<LogisticsPartner['toProps']>) {
    return { id: p.id, scope: p.tenantId == null ? 'platform' : 'tenant', partnerKind: p.partnerKind, providerCode: p.providerCode,
      defaultName: p.defaultName, riderUserId: p.riderUserId, supportsColdChain: p.supportsColdChain, isActive: p.isActive, createdAt: p.createdAt ?? null,
      contactMasked: p.contactPhone ? maskPhone(p.contactPhone) : null, statusReason: p.statusReason ?? null };
  }

  /** W228's row: the carrier + its facts. Every figure is read; On-time and rider insurance are refused by name. */
  private carrierRow(p: ReturnType<LogisticsPartner['toProps']>, f: CarrierFacts | undefined) {
    const base = this.serialize(p);
    const rider = p.partnerKind === 'rider'
      ? { name: shortName(f?.riderName ?? null), phoneMasked: f?.riderPhone ? maskPhone(f.riderPhone) : null,
          ...riderFacts({ kyc: ((f?.riderKyc ?? 'no_role') as RiderKyc), riderTerms: !!f?.riderTerms, defaultTerms: !!f?.defaultTerms }) }
      : null;
    return {
      ...base,
      contactMasked: p.partnerKind === 'rider' ? (rider?.phoneMasked ?? null) : base.contactMasked,
      capability: { vehicles: f?.vehicles ?? 0, capacityKg: f?.capacityKg ?? '0', reefer: !!f?.reefer, coldChain: p.supportsColdChain },
      shipments30d: f?.shipments30d ?? 0,
      onTime: onTimeVerdict(),
      rider,
    };
  }
  private async flush(tx: TxContext, tenantId: string, aggregateId: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'logistics_partner', aggregateId, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
