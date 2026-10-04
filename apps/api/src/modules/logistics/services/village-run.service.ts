// modules/logistics/services/village-run.service.ts · PC-56 TENANT-SW-e · W232 + W2814–W2820 — the Saturday Village Run.
//
// FOUNDER DECISION: DROP POINTS + OTP HANDOVER + THE AMBASSADOR'S PER-PARCEL FEE (MONEY, Law 9).
//   • a ROUTE has DROP POINTS — a village of the route, a sequence, a window, and the AMBASSADOR who keeps it (0201 trigger: the
//     keeper holds the ambassador role and an active ambassador profile here);
//   • a RUN is the route on its run day: a loading plan (parcels → drop points) DRAFTED by one person and CONFIRMED BY ANOTHER
//     (0201's trg_rr_moves is the wall — RUN_CHECKER_IS_DRAFTER), then loaded, departed, completed — or cancelled with a reason;
//   • a HANDOVER: the driver hands a parcel to the keeper against the code sent to the KEEPER's phone; the member collects it from
//     the keeper against the code sent to the MEMBER's phone (the existing OTP service; scoped keys; no code is ever stored,
//     logged or returned);
//   • the FEE: when a handover becomes collected with both codes verified, the database writes ONE 10a earning `parcel_handover`
//     for the keeper at the cooperative's fee raised to the platform floor (₹5) — kv_accrue_parcel_handover_fee, guarded on
//     ambassador_earnings by trg_ae_parcel_handover (PARCEL_FEE_ONCE). It is PAID by SW-b's weekly run from the tenant Main under
//     SW-b's checker. NOTHING HERE MOVES MONEY.
// W232's figures: "Parcels consolidated N / M" (both real counts); the run's freight AS BILLED on freight invoice lines, else refused;
// "₹31 vs ₹96 ad-hoc" REFUSED BY NAME; "Out (returns/samples)" REFUSED BY NAME; the ambassador economics = accrued / paid fees.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { encodeKeyset, KeysetCursor } from '../../../shared/pagination/us-keyset';
import { gateRefusal } from '../../../shared/errors/db-gate';
import {
  DeliveryRouteNotFoundError, DropPointNotFoundError, HandoverNotFoundError, LogisticsOpsRefusedError, RouteRunNotFoundError, ShipmentForbiddenError,
} from '../domain/logistics.errors';
import { REFUSED_BY_NAME, consolidation, istDay, runWeek } from '../domain/logistics-ops';
import { RUN_REASON_MIN, RunAct, RunStatus, runActsFor, runMove } from '../domain/route-run.state';
import { PlanLine, RunRow, VillageRunRepository } from '../repositories/village-run.repository';
import { OpsOtpService } from './ops-otp.service';
import { maskPhone, shortName } from '../../labour/domain/display';

export const VILLAGE_RUN_FLAG = 'logistics_village_run';
export interface RunActor { userId: string; canManage: boolean; ip?: string | null }

function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new LogisticsOpsRefusedError(g.code, g.message, 409);
  if ((e as { code?: string })?.code === '23505' && /uq_rr_route_date/.test(String((e as Error)?.message))) {
    throw new LogisticsOpsRefusedError('RUN_ALREADY_PLANNED', 'This route already has a run planned for that day', 409);
  }
  if ((e as { code?: string })?.code === '23505' && /uq_rdp_route_sequence/.test(String((e as Error)?.message))) {
    throw new LogisticsOpsRefusedError('DROP_POINT_SEQUENCE_TAKEN', 'Another active drop point already has that stop number', 409);
  }
  if ((e as { code?: string })?.code === '23505' && /uq_ph_run_shipment/.test(String((e as Error)?.message))) {
    throw new LogisticsOpsRefusedError('HANDOVER_EXISTS', 'This parcel was already handed over on this run', 409);
  }
  throw e;
}
/** IST midnight of a calendar day, as an instant. */
const istMidnight = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) - 330 * 60_000).toISOString();

@Injectable()
export class VillageRunService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    private readonly audit: AuditWriter,
    private readonly flags: FlagsService,
    private readonly repo: VillageRunRepository,
    private readonly otp: OpsOtpService,
  ) {}

  private assertManager(a: RunActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }
  private async assertFlag(tenantId: string) {
    if (!(await this.flags.isEnabled(VILLAGE_RUN_FLAG, { tenantId }).catch(() => false))) {
      throw new LogisticsOpsRefusedError('VILLAGE_RUN_OFF', 'The Village Run is not switched on for this organisation', 404);
    }
  }

  /* ───────────── W232 · the route page ───────────── */
  async detail(tenantId: string, a: RunActor, routeId: string) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    const route = await this.repo.route(tenantId, routeId);
    if (!route) throw new DeliveryRouteNotFoundError(routeId);
    const [names, points, runs, economics, fee] = await Promise.all([
      this.repo.regionNames(tenantId, route.villageRegionIds), this.repo.dropPoints(tenantId, routeId), this.repo.runs(tenantId, routeId, { limit: 12 }),
      this.repo.economics(tenantId, routeId), this.repo.feeInForce(tenantId),
    ]);
    const current = runs.find((r) => !['completed', 'cancelled'].includes(r.status)) ?? runs[0] ?? null;
    let figures: Awaited<ReturnType<VillageRunService['runFigures']>> | null = null;
    if (current) figures = await this.runFigures(tenantId, routeId, current, points.filter((p) => p.active).length);
    return {
      route: { id: route.id, name: route.name, runWeekday: route.runWeekday, status: route.status, currencyCode: route.currencyCode,
        villages: route.villageRegionIds.map((id) => ({ id, name: names.get(id) ?? null })) },
      dropPoints: points.map((p) => ({ id: p.id, sequence: p.sequence, regionId: p.regionId, regionName: p.regionName, name: p.name,
        keeper: { userId: p.ambassadorUserId, name: shortName(p.keeperName), phoneMasked: p.keeperPhone ? maskPhone(p.keeperPhone) : null },
        window: p.windowStart ? { start: p.windowStart, end: p.windowEnd } : null, active: p.active, deactivateReason: p.deactivateReason,
        parcelsIn: current ? current.loadingPlan.filter((l) => l.dropPointId === p.id).length : 0 })),
      runs: runs.map((r) => this.runWire(r, a)),
      current: current ? { ...this.runWire(current, a), ...figures } : null,
      economics: { feeInForceMinor: fee.feeMinor, platformFloorMinor: fee.floorMinor, cooperativeValueMinor: fee.tenantValueMinor, currencyCode: route.currencyCode,
        keepers: economics.map((e) => ({ userId: e.ambassadorUserId, name: shortName(e.name), phoneMasked: e.phone ? maskPhone(e.phone) : null,
          parcels: e.parcels, accruedMinor: e.accruedMinor, paidMinor: e.paidMinor, unpaidMinor: (BigInt(e.accruedMinor) - BigInt(e.paidMinor)).toString() })),
        method: 'per-parcel fees accrued when a member collected a parcel with both OTPs verified (parcel_handover_fees); paid = the share SW-b\'s weekly ambassador run has paid' },
      refused: { freightVsAdHoc: REFUSED_BY_NAME.freightVsAdHoc, returnLeg: REFUSED_BY_NAME.returnLeg },
    };
  }

  private async runFigures(tenantId: string, routeId: string, run: RunRow, activeStops: number) {
    const planned = run.loadingPlan.map((l) => l.shipmentId);
    const week = runWeek(run.runDate);
    const [c, freight] = await Promise.all([
      this.repo.consolidation(tenantId, routeId, istMidnight(week.from), istMidnight(new Date(Date.parse(`${week.to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)), planned),
      this.repo.runFreight(tenantId, planned),
    ]);
    return {
      consolidation: { ...consolidation(planned.length, c.bound), plannedFromWeek: c.onRunOfBound, week,
        method: 'parcels on this run\'s loading plan ÷ parcels (not cancelled) bound for the route\'s villages, created in the 7 IST days ending on the run day' },
      stops: activeStops,
      freight: freight.length ? { kind: 'billed' as const, byCurrency: freight, method: 'freight invoice lines (5c) whose parcel is on this run' }
        : { kind: 'refused' as const, code: 'NO_FREIGHT_BILLED_FOR_RUN' },
    };
  }
  private runWire(r: RunRow, a: RunActor) {
    return { id: r.id, runDate: r.runDate, status: r.status, parcels: r.loadingPlan.length, partnerId: r.partnerId, vehicleId: r.vehicleId,
      draftedBy: r.draftedBy, draftedAt: r.draftedAt, draftReason: r.draftReason, confirmedBy: r.confirmedBy, confirmedAt: r.confirmedAt,
      loadingAt: r.loadingAt, departedAt: r.departedAt, completedAt: r.completedAt, cancelledAt: r.cancelledAt, cancelReason: r.cancelReason,
      acts: runActsFor(r.status as RunStatus, { isDrafter: r.draftedBy === a.userId }), youDrafted: r.draftedBy === a.userId };
  }

  async runs(tenantId: string, a: RunActor, routeId: string, q: { cursor?: KeysetCursor; limit: number }) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    const rows = await this.repo.runs(tenantId, routeId, q);
    const last = rows[rows.length - 1];
    return { items: rows.map((r) => this.runWire(r, a)), nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdUs, last.id) : null };
  }
  async run(tenantId: string, a: RunActor, runId: string) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    const r = await this.repo.run(tenantId, runId);
    if (!r) throw new RouteRunNotFoundError(runId);
    const [points, handovers] = await Promise.all([this.repo.dropPoints(tenantId, r.routeId), this.repo.handovers(tenantId, runId)]);
    const byId = new Map(points.map((p) => [p.id, p]));
    return {
      ...this.runWire(r, a), routeId: r.routeId,
      plan: r.loadingPlan.map((l) => ({ ...l, dropPoint: byId.get(l.dropPointId)?.name ?? null, sequence: byId.get(l.dropPointId)?.sequence ?? null,
        handover: handovers.find((h) => h.shipmentId === l.shipmentId)?.status ?? null })),
      handovers: handovers.map((h) => ({ id: h.id, shipmentId: h.shipmentId, dropPointId: h.dropPointId, dropPoint: byId.get(h.dropPointId)?.name ?? null,
        status: h.status, keeperOtpConfirmedAt: h.otpVerifiedAt, memberOtpConfirmedAt: h.recipientOtpVerifiedAt, collectedAt: h.collectedAt,
        returnedAt: h.returnedAt, returnReason: h.returnReason, feeMinor: h.feeMinor, feeSource: h.feeSource })),
    };
  }
  /** W2814's parcel picker: open parcels bound for the route's villages. */
  async candidates(tenantId: string, a: RunActor, routeId: string) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    return { items: await this.repo.candidateParcels(tenantId, routeId) };
  }

  /* ───────────── drop points ───────────── */
  async addDropPoint(tenantId: string, a: RunActor, routeId: string, key: string, dto: { sequence: number; regionId: string; name: string; ambassadorUserId: string; windowStart?: string | null; windowEnd?: string | null }) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    return this.idem.remember(key, a.userId, 'logistics.drop_point_add', () => this.uow.run(tenantId, async (tx) => {
      const id = uuidv7();
      try {
        await this.repo.insertDropPoint(tx, { id, tenantId, routeId, sequence: dto.sequence, regionId: dto.regionId, name: dto.name.trim(), ambassadorUserId: dto.ambassadorUserId,
          windowStart: dto.windowStart ?? null, windowEnd: dto.windowEnd ?? null, createdBy: a.userId });
      } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.drop_point_added', entityType: 'route_drop_point', entityId: id,
        newValue: { routeId, sequence: dto.sequence, regionId: dto.regionId, name: dto.name.trim(), ambassadorUserId: dto.ambassadorUserId }, ip: a.ip ?? null });
      return { id, routeId };
    }, { userId: a.userId }));
  }
  async deactivateDropPoint(tenantId: string, a: RunActor, id: string, key: string, reasonRaw: string) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < RUN_REASON_MIN) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A reason of at least 10 characters is recorded', 422);
    return this.idem.remember(key, a.userId, 'logistics.drop_point_deactivate', () => this.uow.run(tenantId, async (tx) => {
      const p = await this.repo.dropPoint(tx, tenantId, id);
      if (!p) throw new DropPointNotFoundError(id);
      let n = 0;
      try { n = await this.repo.deactivateDropPoint(tx, tenantId, id, a.userId, reason); } catch (e) { rethrowGate(e); }
      if (n === 0) throw new LogisticsOpsRefusedError('DROP_POINT_ALREADY_INACTIVE', 'This drop point is already deactivated', 409);
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.drop_point_deactivated', entityType: 'route_drop_point', entityId: id,
        oldValue: { active: true }, newValue: { active: false }, reason, ip: a.ip ?? null });
      return { id, active: false };
    }, { userId: a.userId }));
  }

  /* ───────────── W2814–W2817 · draft the loading plan ───────────── */
  async draft(tenantId: string, a: RunActor, routeId: string, key: string, dto: { runDate: string; plan: PlanLine[]; partnerId?: string | null; vehicleId?: string | null; reason: string }) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    const reason = (dto.reason ?? '').trim();
    if (reason.length < RUN_REASON_MIN) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A reason of at least 10 characters travels with the plan', 422);
    return this.idem.remember(key, a.userId, 'logistics.run_draft', () => this.uow.run(tenantId, async (tx) => {
      const route = await this.repo.route(tenantId, routeId, tx);
      if (!route) throw new DeliveryRouteNotFoundError(routeId);
      const id = uuidv7();
      try {
        await this.repo.insertRun(tx, { id, tenantId, routeId, runDate: dto.runDate, plan: dto.plan, partnerId: dto.partnerId ?? null, vehicleId: dto.vehicleId ?? null, draftedBy: a.userId, reason });
      } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.run_drafted', entityType: 'route_run', entityId: id,
        newValue: { routeId, runDate: dto.runDate, parcels: dto.plan.length, partnerId: dto.partnerId ?? null, vehicleId: dto.vehicleId ?? null }, reason, ip: a.ip ?? null });
      return { id, status: 'draft' as const, runDate: dto.runDate, parcels: dto.plan.length };
    }, { userId: a.userId }));
  }

  /* ───────────── W2818–W2820 · confirm (a second person) · start loading · depart · complete · cancel ───────────── */
  async act(tenantId: string, a: RunActor, runId: string, act: RunAct, key: string, reasonRaw?: string | null) {
    this.assertManager(a);
    await this.assertFlag(tenantId);
    const reason = (reasonRaw ?? '').trim() || null;
    if (act === 'cancel' && (!reason || reason.length < RUN_REASON_MIN)) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A cancellation records a reason of at least 10 characters', 422);
    return this.idem.remember(key, a.userId, `logistics.run_${act}`, () => this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.run(tenantId, runId, tx, true);
      if (!r) throw new RouteRunNotFoundError(runId);
      const to = runMove(r.status as RunStatus, act);
      if (!to) throw new LogisticsOpsRefusedError('RUN_MOVE', `A ${r.status} run cannot be moved by '${act}'`, 409);
      // NO TypeScript maker check: the database is the wall (RUN_CHECKER_IS_DRAFTER), and the spec pins it.
      try { await this.repo.move(tx, tenantId, runId, to, a.userId, reason); } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: `logistics.run_${to}`, entityType: 'route_run', entityId: runId,
        oldValue: { status: r.status }, newValue: { status: to }, reason, ip: a.ip ?? null });
      return { id: runId, status: to };
    }, { userId: a.userId }));
  }

  /* ───────────── the drop point: driver → keeper (keeper's OTP) ───────────── */
  private async assertDriver(tx: Parameters<VillageRunRepository['runRider']>[0], tenantId: string, a: RunActor, r: RunRow) {
    if (a.canManage) return;
    const rider = await this.repo.runRider(tx, tenantId, r.partnerId);
    if (!rider || rider !== a.userId) throw new ShipmentForbiddenError('only the run\'s driver or a logistics manager hands parcels over');
  }
  /** The driver at the drop point asks for the keeper's code: it is sent to the KEEPER's own phone. */
  async sendKeeperCode(tenantId: string, a: RunActor, runId: string, shipmentId: string) {
    await this.assertFlag(tenantId);
    const { keeper } = await this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.run(tenantId, runId, tx);
      if (!r) throw new RouteRunNotFoundError(runId);
      await this.assertDriver(tx, tenantId, a, r);
      const line = r.loadingPlan.find((l) => l.shipmentId === shipmentId);
      if (!line) throw new LogisticsOpsRefusedError('HANDOVER_NOT_PLANNED', 'This parcel is not on this run\'s plan', 422);
      const dp = await this.repo.dropPoint(tx, tenantId, line.dropPointId);
      if (!dp) throw new DropPointNotFoundError(line.dropPointId);
      const phone = await this.repo.userPhone(tx, dp.ambassadorUserId);
      if (!phone) throw new DropPointNotFoundError(line.dropPointId);
      return { keeper: phone };
    }, { userId: a.userId });
    const { ttlSec } = await this.otp.send('parcel_handover', `${runId}:${shipmentId}`, keeper.phone, keeper.language);
    return { sent: true as const, to: 'keeper' as const, phoneMasked: maskPhone(keeper.phone), ttlSec };
  }
  async recordHandover(tenantId: string, a: RunActor, runId: string, key: string, dto: { shipmentId: string; code: string }) {
    await this.assertFlag(tenantId);
    return this.idem.remember(key, a.userId, 'logistics.handover_record', () => this.uow.run(tenantId, async (tx) => {
      const r = await this.repo.run(tenantId, runId, tx, true);
      if (!r) throw new RouteRunNotFoundError(runId);
      await this.assertDriver(tx, tenantId, a, r);
      const line = r.loadingPlan.find((l) => l.shipmentId === dto.shipmentId);
      if (!line) throw new LogisticsOpsRefusedError('HANDOVER_NOT_PLANNED', 'This parcel is not on this run\'s plan', 422);
      const dp = await this.repo.dropPoint(tx, tenantId, line.dropPointId);
      const keeperPhone = dp ? await this.repo.userPhone(tx, dp.ambassadorUserId) : null;
      const recipient = await this.repo.parcelRecipient(tx, tenantId, dto.shipmentId);
      if (!dp || !keeperPhone || !recipient) throw new LogisticsOpsRefusedError('HANDOVER_NOT_PLANNED', 'This parcel cannot be handed over here', 422);
      if (!(await this.otp.verify('parcel_handover', `${runId}:${dto.shipmentId}`, keeperPhone.phone, dto.code))) {
        throw new LogisticsOpsRefusedError('HANDOVER_OTP_INVALID', 'The keeper\'s code is not right, or it expired', 401);
      }
      const id = uuidv7();
      try {
        await this.repo.insertHandover(tx, { id, tenantId, runId, shipmentId: dto.shipmentId, dropPointId: dp.id, handedBy: a.userId, receivedBy: dp.ambassadorUserId, recipientUserId: recipient.buyerUserId });
      } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.parcel_handed_over', entityType: 'parcel_handover', entityId: id,
        newValue: { runId, shipmentId: dto.shipmentId, dropPointId: dp.id, keeper: dp.ambassadorUserId, keeperOtp: 'verified' }, ip: a.ip ?? null });
      return { id, status: 'at_drop_point' as const };
    }, { userId: a.userId }));
  }

  /* ───────────── the drop point: keeper → member (member's OTP) → the fee (database) ───────────── */
  private async keeperHandover(tx: Parameters<VillageRunRepository['handover']>[0], tenantId: string, a: RunActor, id: string) {
    const h = await this.repo.handover(tx, tenantId, id, true);
    if (!h) throw new HandoverNotFoundError(id);
    if (h.receivedBy !== a.userId) throw new ShipmentForbiddenError('the drop point\'s own ambassador records the member\'s collection');
    return h;
  }
  async sendCollectCode(tenantId: string, a: RunActor, handoverId: string) {
    await this.assertFlag(tenantId);
    const member = await this.uow.run(tenantId, async (tx) => {
      const h = await this.keeperHandover(tx, tenantId, a, handoverId);
      if (h.status !== 'at_drop_point') throw new LogisticsOpsRefusedError('HANDOVER_CLOSED', `This handover is already ${h.status}`, 409);
      const m = await this.repo.userPhone(tx, h.recipientUserId);
      if (!m) throw new HandoverNotFoundError(handoverId);
      return m;
    }, { userId: a.userId });
    const { ttlSec } = await this.otp.send('parcel_collect', handoverId, member.phone, member.language);
    return { sent: true as const, to: 'member' as const, phoneMasked: maskPhone(member.phone), ttlSec };
  }
  async collect(tenantId: string, a: RunActor, handoverId: string, key: string, code: string) {
    await this.assertFlag(tenantId);
    return this.idem.remember(key, a.userId, 'logistics.handover_collect', () => this.uow.run(tenantId, async (tx) => {
      const h = await this.keeperHandover(tx, tenantId, a, handoverId);
      if (h.status !== 'at_drop_point') throw new LogisticsOpsRefusedError('HANDOVER_CLOSED', `This handover is already ${h.status}`, 409);
      const m = await this.repo.userPhone(tx, h.recipientUserId);
      if (!m || !(await this.otp.verify('parcel_collect', handoverId, m.phone, code))) {
        throw new LogisticsOpsRefusedError('COLLECT_OTP_INVALID', 'The member\'s code is not right, or it expired', 401);
      }
      try { await this.repo.collect(tx, tenantId, handoverId); } catch (e) { rethrowGate(e); }
      // the database has just written the fee (trg_ph_after → kv_accrue_parcel_handover_fee) — read it back for the receipt
      const after = await this.repo.handover(tx, tenantId, handoverId);
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.parcel_collected', entityType: 'parcel_handover', entityId: handoverId,
        oldValue: { status: 'at_drop_point' }, newValue: { status: 'collected', memberOtp: 'verified', feeMinor: after?.feeMinor ?? null, feeSource: after?.feeSource ?? null }, ip: a.ip ?? null });
      return { id: handoverId, status: 'collected' as const, feeMinor: after?.feeMinor ?? null, feeSource: after?.feeSource ?? null };
    }, { userId: a.userId }));
  }
  async returnParcel(tenantId: string, a: RunActor, handoverId: string, key: string, reasonRaw: string) {
    await this.assertFlag(tenantId);
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < RUN_REASON_MIN) throw new LogisticsOpsRefusedError('REASON_REQUIRED', 'A return records a reason of at least 10 characters', 422);
    return this.idem.remember(key, a.userId, 'logistics.handover_return', () => this.uow.run(tenantId, async (tx) => {
      const h = await this.keeperHandover(tx, tenantId, a, handoverId);
      try { await this.repo.returnParcel(tx, tenantId, handoverId, reason); } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.parcel_returned', entityType: 'parcel_handover', entityId: handoverId,
        oldValue: { status: h.status }, newValue: { status: 'returned' }, reason, ip: a.ip ?? null });
      return { id: handoverId, status: 'returned' as const };
    }, { userId: a.userId }));
  }

  /** The keeper's own list (their app): handovers waiting at their drop points. */
  async keeperQueue(tenantId: string, userId: string) {
    await this.assertFlag(tenantId);
    return this.uow.run(tenantId, async (tx) => {
      const r = await tx.query(
        `SELECT h.id, h.run_id, h.shipment_id, h.status, h.created_at, d.name FROM parcel_handovers h JOIN route_drop_points d ON d.id = h.drop_point_id
          WHERE h.tenant_id=$1 AND h.received_by=$2 AND h.status = 'at_drop_point' ORDER BY h.created_at DESC LIMIT 100`, [tenantId, userId]);
      return { items: (r.rows as any[]).map((x) => ({ id: x.id, runId: x.run_id, shipmentId: x.shipment_id, status: x.status, dropPoint: x.name, at: new Date(x.created_at).toISOString() })),
        today: istDay(new Date()).ymd };
    }, { userId });
  }
}
