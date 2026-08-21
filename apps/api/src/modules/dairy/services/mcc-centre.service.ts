// modules/dairy/services/mcc-centre.service.ts · MCC infrastructure use-cases (cooperative-admin).
// One ACID tx per write (UoW), outbox in-tx (Law 4), idempotent create (Law 3), authz THROWS (Law 6).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MccCentre } from '../domain/mcc-centre.entity';
import { DomainEvent } from '../domain/dairy.events';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { MccOperatorAssignmentRepository } from '../repositories/mcc-operator-assignment.repository';
import { MilkShift, ShiftWindow } from '../domain/mcc-console';
import { CreateMccDto } from '../dto/create-mcc-centre.dto';
import { MccNotFoundError, MccCodeExistsError, DairyForbiddenError, MccOperatorNotInTenantError, MccCentreInvalidError } from '../domain/dairy.errors';

export interface DairyActor {
  userId: string;
  canManage: boolean;
  /**
   * [PC-56 TENANT-6c-3] Holds `settlement.close` — the SECOND key W169 names on preview and approve. Optional so that
   * every existing construction site still compiles, and absent therefore means FALSE: a caller that does not set it
   * cannot approve a cycle. Fail-closed is the only safe default for a key that guards 312 families' milk money.
   */
  canCloseSettlement?: boolean;
}

@Injectable()
export class MccCentreService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: MccCentreRepository,
    private readonly custody: MccOperatorAssignmentRepository,
  ) {}

  /**
   * [PC-56 TENANT-6d-2] **THE OPERATOR IS NO LONGER DEFAULTED TO WHOEVER MADE THE CENTRE.**
   *
   * This method used to write `dto.operatorUserId ?? actor.userId`, so a dairy lead who added three centres in an
   * afternoon became the recorded custodian of all three — 312 families' milk answerable to somebody who has never
   * been to any of the villages. W171 is explicit that custody is *recorded*, and a default is the opposite of a
   * record. Omitting the operator now means NOBODY HOLDS IT YET, which is a true and visible state on the board.
   *
   * When an operator IS named, the same three things happen as on a handover: their tenancy is checked, the column is
   * written, and a custody row is opened — in one transaction, so the register can never lag the column.
   */
  async create(tenantId: string, actor: DairyActor, idemKey: string, dto: CreateMccDto, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.mcc.create', () =>
      timed(this.metrics, 'dairy.mcc.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const operatorUserId = dto.operatorUserId ?? null;
          if (operatorUserId && !(await this.repo.userHoldsRoleInTenant(tx, tenantId, operatorUserId))) {
            throw new MccOperatorNotInTenantError(operatorUserId);
          }
          const mcc = MccCentre.create({ id: uuidv7(), tenantId, code: dto.code, defaultName: dto.defaultName, regionId: dto.regionId ?? null,
            lat: dto.lat ?? null, lng: dto.lng ?? null, operatorUserId,
            capacityLitresShift: dto.capacityLitresShift ?? null, analyzerModel: dto.analyzerModel ?? null, analyzerSerial: dto.analyzerSerial ?? null,
            morningOpensAt: dto.morningOpensAt ?? null, morningClosesAt: dto.morningClosesAt ?? null,
            eveningOpensAt: dto.eveningOpensAt ?? null, eveningClosesAt: dto.eveningClosesAt ?? null });
          try { await this.repo.insert(tx, mcc, actor.userId); } catch (e: any) { if (e?.code === '23505') throw new MccCodeExistsError(); throw e; }
          if (operatorUserId) {
            await this.custody.openNew(tx, { tenantId, mccId: mcc.id, operatorUserId, assignedAt: new Date(),
              assignedBy: actor.userId, reason: dto.operatorReason ?? 'custody recorded when the centre was created' });
          }
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.mcc.created', entityType: 'mcc_centre', entityId: mcc.id, newValue: { code: dto.code, operatorUserId }, ip });
          await this.flush(tx, tenantId, mcc.id, mcc.pullEvents());
          return mcc.toJSON();
        }, { userId: actor.userId })));
  }

  async setActive(tenantId: string, actor: DairyActor, id: string, isActive: boolean, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const mcc = await this.repo.getForUpdate(tx, tenantId, id);
      if (!mcc) throw new MccNotFoundError(id);
      mcc.setActive(isActive);
      await this.repo.update(tx, mcc, actor.userId);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.mcc.set_active', entityType: 'mcc_centre', entityId: id, newValue: { isActive }, ip });
      return mcc.toJSON();
    }, { userId: actor.userId });
  }

  /**
   * Custody changes hands — W171's *"operator assignment is recorded (custody of member milk)"*.
   *
   * One transaction does four things and either all of them happen or none: the incoming operator's tenancy is
   * checked, the open custody row is CLOSED at an instant, a new one is OPENED at the SAME instant, and the centre's
   * column moves. Sharing the instant matters: two clocks a millisecond apart would leave a gap in which the register
   * says nobody held the centre, and a shortfall investigation reads that gap as a fact.
   *
   * Idempotent, because a handover is exactly the kind of act a village tablet retries on a dropped connection — and
   * without a key, the retry would close a custody that had just opened and open a third one.
   */
  async assignOperator(tenantId: string, actor: DairyActor, idemKey: string, id: string, input: { operatorUserId: string; reason?: string | null }, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.mcc.assign_operator', () =>
      timed(this.metrics, 'dairy.mcc.assign_operator', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const mcc = await this.repo.getForUpdate(tx, tenantId, id);
          if (!mcc) throw new MccNotFoundError(id);
          if (!(await this.repo.userHoldsRoleInTenant(tx, tenantId, input.operatorUserId))) {
            throw new MccOperatorNotInTenantError(input.operatorUserId);
          }
          const before = mcc.operatorUserId;
          try { mcc.assignOperator(input.operatorUserId); } catch (e: any) { throw new MccCentreInvalidError(String(e?.message ?? e)); }

          const at = new Date();
          const open = await this.custody.open(tx, tenantId, id);
          if (open) await this.custody.close(tx, tenantId, open.id, actor.userId, at);
          await this.custody.openNew(tx, { tenantId, mccId: id, operatorUserId: input.operatorUserId, assignedAt: at,
            assignedBy: actor.userId, reason: input.reason ?? null });
          await this.repo.update(tx, mcc, actor.userId);

          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.mcc.operator_assigned', entityType: 'mcc_centre', entityId: id,
            oldValue: { operatorUserId: before }, newValue: { operatorUserId: input.operatorUserId, reason: input.reason ?? null }, ip });
          await this.flush(tx, tenantId, id, mcc.pullEvents());
          return mcc.toJSON();
        }, { userId: actor.userId })));
  }

  /** Nobody holds the centre. The custody row closes and none opens — a state, not an absence of one. */
  async releaseOperator(tenantId: string, actor: DairyActor, id: string, reason: string | null, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const mcc = await this.repo.getForUpdate(tx, tenantId, id);
      if (!mcc) throw new MccNotFoundError(id);
      const before = mcc.operatorUserId;
      try { mcc.releaseOperator(); } catch (e: any) { throw new MccCentreInvalidError(String(e?.message ?? e)); }
      const open = await this.custody.open(tx, tenantId, id);
      if (open) await this.custody.close(tx, tenantId, open.id, actor.userId, new Date());
      await this.repo.update(tx, mcc, actor.userId);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.mcc.operator_released', entityType: 'mcc_centre', entityId: id,
        oldValue: { operatorUserId: before }, newValue: { operatorUserId: null, reason }, ip });
      await this.flush(tx, tenantId, id, mcc.pullEvents());
      return mcc.toJSON();
    }, { userId: actor.userId });
  }

  /**
   * The hours a farmer walks to — the thing TENANT-6a named (`mcc_shift_open_at` / `mcc_shift_close_at`) and refused
   * to invent, per shift because `milk_shift` has two labels and each has its own two ends.
   *
   * Both ends or neither, enforced by the aggregate and again by `ck_mcc_shift_*`. Passing `null` for a shift CLEARS
   * it, which is a real thing a cooperative does and returns the counter board to TENANT-6a's honest refusal.
   */
  async setShiftWindow(tenantId: string, actor: DairyActor, id: string, shift: MilkShift, window: ShiftWindow | null, ip: string | null) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.uow.run(tenantId, async (tx) => {
      const mcc = await this.repo.getForUpdate(tx, tenantId, id);
      if (!mcc) throw new MccNotFoundError(id);
      const before = mcc.windows()[shift];
      try { mcc.setShiftWindow(shift, window); } catch (e: any) { throw new MccCentreInvalidError(String(e?.message ?? e)); }
      await this.repo.update(tx, mcc, actor.userId);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'dairy.mcc.shift_window_set', entityType: 'mcc_centre', entityId: id,
        oldValue: { shift, window: before }, newValue: { shift, window }, ip });
      await this.flush(tx, tenantId, id, mcc.pullEvents());
      return mcc.toJSON();
    }, { userId: actor.userId });
  }

  /** Who has held this centre, newest first. Behind `dairy.manage`: a custody register names staff and their tenure. */
  async custodyHistory(tenantId: string, actor: DairyActor, id: string, limit: number) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.custody.history(tenantId, id, limit);
  }

  async getById(tenantId: string, id: string) { const m = await this.repo.getById(tenantId, id); if (!m) throw new MccNotFoundError(id); return m.toJSON(); }
  async list(tenantId: string, q: { activeOnly: boolean; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.repo.listFor(tenantId, q);
    const items = rows.map((m) => m.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'mcc_centre', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
