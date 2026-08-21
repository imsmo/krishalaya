// modules/dairy/services/dairy-diversion.service.ts · PC-56 TENANT-6d-6 · W170's playbook step 2.
//
// *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route notice to 87 pourers, Gujarati voice)"*, and
// *"playbook overrides are operator + dairy lead together."*
//
// THREE ACTS AND A COUNT. An operator REQUESTS a diversion with a reason; a dairy lead with `dairy.override` SIGNS it —
// a different person, enforced here and by `ck_dairy_diversion_maker_ne_checker`; either may CANCEL it while no milk
// has been recorded under it. And every step reports how many members are actually affected, counted from the route
// history as of the diverted day, because *"87 pourers"* is a number a cooperative acts on.
//
// WHAT THIS SERVICE REFUSES TO DO
//   • **It does not move a membership.** A diversion is not a transfer: the route, the card and the history are
//     untouched (TENANT-6d-3's table is never written here). The member belongs to Vanthali and pours there tomorrow.
//   • **It does not backdate.** A diversion for a day whose pours are in would retro-authorise an attribution nobody
//     agreed to at the time — and the pours it would cover were already refused at the counter, correctly.
//   • **It does not tell the members.** The count is real and the screens say plainly that nobody is notified by this
//     act. TENANT-6d-7 sends W170's *"Gujarati voice"* notice.
//   • **It does not fire itself.** The playbook SUGGESTS; two humans decide. An automatic diversion would move 87
//     families' evening on one sensor reading.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { MilkShift } from '../domain/dairy.events';
import { DairyDiversionRepository, DiversionRow } from '../repositories/dairy-diversion.repository';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { DiversionRefusedError } from '../domain/dairy.errors';
import {
  DiversionRefusal, approveVerdict, cancelVerdict, diversionState, requestVerdict,
} from '../domain/dairy-diversion';
import { DairyActor } from './mcc-centre.service';

/** The actor for this act — dairy's TWO verbs, because W170's override needs both hands. */
export interface DiversionActor extends DairyActor {
  /** `dairy.override` (0166): the dairy lead's verb, and deliberately not `settlement.close`. */
  canOverride: boolean;
}

export interface DiversionView extends DiversionRow {
  state: 'requested' | 'live' | 'cancelled';
  /** Members routed to the sending centre on that day — the *"87 pourers"* of W170's own sentence. */
  affectedMembers: number;
  /** NOT SENT by this act, and the screens say so. TENANT-6d-7 owns the notice. */
  membersNotified: false;
}

@Injectable()
export class DairyDiversionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly repo: DairyDiversionRepository,
    private readonly centres: MccCentreRepository,
  ) {}

  /** Today in the cooperative's own calendar. The DATABASE's day, never the process clock (TENANT-6c-1's ruling). */
  private async today(tx: TxContext): Promise<string> {
    const r = await tx.query(`SELECT current_date::text AS d`);
    return String((r.rows[0] as { d: string }).d);
  }

  private refuse(refusals: DiversionRefusal[]): never { throw new DiversionRefusedError(refusals); }

  /**
   * The confirm step's question, and the request's own verdict — one function, so a screen that says *"ready"* cannot
   * be followed by a refusal (TENANT-6d-4's ruling, carried into the mutate chain).
   *
   * Writes nothing. Takes no idempotency key.
   */
  async preview(tenantId: string, actor: DiversionActor, dto: {
    fromMccId: string; toMccId: string; divertedOn?: string; shift: MilkShift; reason?: string;
  }): Promise<{
    allowed: boolean; refusals: DiversionRefusal[]; affectedMembers: number; divertedOn: string;
    fromCode: string | null; fromName: string | null; toCode: string | null; toName: string | null;
    membersNotified: false;
  }> {
    return this.uow.run(tenantId, async (tx) => {
      const today = await this.today(tx);
      const on = dto.divertedOn ?? today;
      const [from, to] = await Promise.all([
        this.centres.getById(tenantId, dto.fromMccId, tx).catch(() => null),
        this.centres.getById(tenantId, dto.toMccId, tx).catch(() => null),
      ]);
      const fromProps = from?.toProps() ?? null;
      const toProps = to?.toProps() ?? null;
      const existing = fromProps ? await this.repo.pendingOrLive(tx, tenantId, fromProps.id, on, dto.shift) : null;
      const v = requestVerdict({
        canManage: actor.canManage,
        from: fromProps ? { id: fromProps.id, isActive: fromProps.isActive } : null,
        to: toProps ? { id: toProps.id, isActive: toProps.isActive } : null,
        divertedOn: on, today, alreadyDiverted: existing !== null, reason: dto.reason ?? '',
      });
      return {
        allowed: v.allowed, refusals: v.refusals, divertedOn: on,
        // The count is real even when the request is refused: *"87 pourers"* is what a dairy lead is deciding about,
        // and hiding it until the form is perfect would hide the size of the decision.
        affectedMembers: fromProps ? await this.repo.affectedMembers(tx, tenantId, fromProps.id, on) : 0,
        fromCode: fromProps?.code ?? null, fromName: fromProps?.defaultName ?? null,
        toCode: toProps?.code ?? null, toName: toProps?.defaultName ?? null,
        membersNotified: false,
      };
    }, { userId: actor.userId });
  }

  /** An operator asks for the diversion. It moves no milk until somebody else signs it. */
  async request(tenantId: string, actor: DiversionActor, idemKey: string, dto: {
    fromMccId: string; toMccId: string; divertedOn?: string; shift: MilkShift; reason: string;
  }, ip: string | null): Promise<DiversionView> {
    return this.idem.remember(idemKey, actor.userId, 'dairy.diversion.request', () =>
      timed(this.metrics, 'dairy.diversion.request', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const today = await this.today(tx);
          const on = dto.divertedOn ?? today;
          const [from, to] = await Promise.all([
            this.centres.getById(tenantId, dto.fromMccId, tx).catch(() => null),
            this.centres.getById(tenantId, dto.toMccId, tx).catch(() => null),
          ]);
          const fromProps = from?.toProps() ?? null;
          const toProps = to?.toProps() ?? null;
          const existing = fromProps ? await this.repo.pendingOrLive(tx, tenantId, fromProps.id, on, dto.shift) : null;
          const v = requestVerdict({
            canManage: actor.canManage,
            from: fromProps ? { id: fromProps.id, isActive: fromProps.isActive } : null,
            to: toProps ? { id: toProps.id, isActive: toProps.isActive } : null,
            divertedOn: on, today, alreadyDiverted: existing !== null, reason: dto.reason,
          });
          if (!v.allowed) this.refuse(v.refusals);

          const row = await this.repo.insert(tx, {
            id: uuidv7(), tenantId, fromMccId: (fromProps as { id: string }).id, toMccId: (toProps as { id: string }).id,
            divertedOn: on, shift: dto.shift, reason: dto.reason.trim(), requestedBy: actor.userId,
          });
          const affected = await this.repo.affectedMembers(tx, tenantId, row.fromMccId, on);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.diversion.requested',
            entityType: 'dairy_shift_diversion', entityId: row.id, reason: row.reason,
            newValue: { fromMccId: row.fromMccId, toMccId: row.toMccId, divertedOn: on, shift: row.shift, affectedMembers: affected },
            ip,
          });
          // The event carries the count so a consumer never has to re-derive it — TENANT-6d-7's notice will fan out
          // over exactly these members, resolved the same way.
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'dairy_shift_diversion', aggregateId: row.id,
            eventType: 'dairy.diversion_requested',
            payload: { v: 1, diversionId: row.id, fromMccId: row.fromMccId, toMccId: row.toMccId, divertedOn: on, shift: row.shift, affectedMembers: affected },
          });
          return { ...row, state: diversionState(row), affectedMembers: affected, membersNotified: false as const };
        }, { userId: actor.userId })));
  }

  /**
   * The dairy lead signs it, and only then does the counter accept a pour at the other village.
   *
   * The verdict is re-taken against rows read NOW: the request may have been cancelled, signed by somebody faster, or
   * overtaken by the shift it was about. TENANT-6d-5's ruling — a confirm step is not an authorisation token.
   */
  async approve(tenantId: string, actor: DiversionActor, idemKey: string, id: string, ip: string | null): Promise<DiversionView> {
    return this.idem.remember(idemKey, actor.userId, 'dairy.diversion.approve', () =>
      timed(this.metrics, 'dairy.diversion.approve', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const today = await this.today(tx);
          const row = await this.repo.forUpdate(tx, tenantId, id);
          const poursIn = row === null ? 0 : await this.repo.poursAt(tx, tenantId, row.fromMccId, row.divertedOn, row.shift);
          const v = approveVerdict({
            canOverride: actor.canOverride, row, actorUserId: actor.userId, today, poursAlreadyIn: poursIn,
          });
          if (!v.allowed) this.refuse(v.refusals);
          const at = new Date();
          const r = row as DiversionRow;
          await this.repo.approve(tx, tenantId, id, actor.userId, at);
          const affected = await this.repo.affectedMembers(tx, tenantId, r.fromMccId, r.divertedOn);
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.diversion.approved',
            entityType: 'dairy_shift_diversion', entityId: id, reason: r.reason,
            oldValue: { approvedBy: null },
            newValue: { approvedBy: actor.userId, requestedBy: r.requestedBy, affectedMembers: affected },
            ip,
          });
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'dairy_shift_diversion', aggregateId: id,
            eventType: 'dairy.diversion_approved',
            payload: {
              v: 1, diversionId: id, fromMccId: r.fromMccId, toMccId: r.toMccId, divertedOn: r.divertedOn,
              shift: r.shift, requestedBy: r.requestedBy, approvedBy: actor.userId, affectedMembers: affected,
            },
          });
          const signed: DiversionRow = { ...r, approvedBy: actor.userId, approvedAt: at.toISOString() };
          return { ...signed, state: diversionState(signed), affectedMembers: affected, membersNotified: false as const };
        }, { userId: actor.userId })));
  }

  /** Called off — while no milk has been taken under it. After that the honest answer is that it is too late. */
  async cancel(tenantId: string, actor: DiversionActor, idemKey: string, id: string, reason: string, ip: string | null): Promise<DiversionView> {
    return this.idem.remember(idemKey, actor.userId, 'dairy.diversion.cancel', () =>
      timed(this.metrics, 'dairy.diversion.cancel', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const row = await this.repo.forUpdate(tx, tenantId, id);
          const under = row === null ? 0 : await this.repo.poursUnder(tx, tenantId, id);
          const v = cancelVerdict({ canManage: actor.canManage, row, poursUnderIt: under, reason });
          if (!v.allowed) this.refuse(v.refusals);
          const at = new Date();
          const r = row as DiversionRow;
          await this.repo.cancel(tx, tenantId, id, actor.userId, at, reason.trim());
          await this.audit.write(tx, {
            tenantId, actorUserId: actor.userId, action: 'dairy.diversion.cancelled',
            entityType: 'dairy_shift_diversion', entityId: id, reason: reason.trim(),
            newValue: { cancelledBy: actor.userId, wasApproved: r.approvedAt !== null },
            ip,
          });
          await this.outbox.write(tx, {
            tenantId, aggregateType: 'dairy_shift_diversion', aggregateId: id,
            eventType: 'dairy.diversion_cancelled',
            payload: { v: 1, diversionId: id, fromMccId: r.fromMccId, toMccId: r.toMccId, divertedOn: r.divertedOn, shift: r.shift, cancelledBy: actor.userId },
          });
          const done: DiversionRow = { ...r, cancelledBy: actor.userId, cancelledAt: at.toISOString(), cancelReason: reason.trim() };
          return {
            ...done, state: diversionState(done),
            affectedMembers: await this.repo.affectedMembers(tx, tenantId, r.fromMccId, r.divertedOn),
            membersNotified: false as const,
          };
        }, { userId: actor.userId })));
  }

  /** The register. Read-only, and it names both villages rather than two ids. */
  async list(tenantId: string, actor: DiversionActor, q: { from?: string; to?: string; limit: number }) {
    if (!actor.canManage) this.refuse(['NO_MANAGE']);
    const rows = await this.repo.list(tenantId, q);
    return rows.map((r) => ({ ...r, state: diversionState(r), membersNotified: false as const }));
  }
}
