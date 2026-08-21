// modules/dairy/services/dairy-membership.service.ts · enrol a farmer at an MCC (cooperative-admin).
// One ACID tx per write (UoW), outbox in-tx (Law 4), idempotent create (Law 3), authz THROWS (Law 6).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { DairyMembership } from '../domain/dairy-membership.entity';
import { PaymentCycle, AnimalType, DomainEvent } from '../domain/dairy.events';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { DairyMembershipRouteRepository } from '../repositories/dairy-membership-route.repository';
import { CreateMembershipDto } from '../dto/create-dairy-membership.dto';
import { MccNotFoundError, MemberCodeExistsError, MembershipNotFoundError, DairyForbiddenError } from '../domain/dairy.errors';
import { DairyActor } from './mcc-centre.service';

@Injectable()
export class DairyMembershipService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly repo: DairyMembershipRepository,
    private readonly mccs: MccCentreRepository,
    // [TENANT-6d-3] The route history. Enrolment is where a membership's first period begins.
    private readonly routes: DairyMembershipRouteRepository,
  ) {}

  /** The DATABASE's today. A card is handed over on a day in the cooperative's calendar, not on the API's clock. */
  private async today(tx: TxContext): Promise<string> {
    const r = await tx.query(`SELECT current_date::text AS d`);
    return String((r.rows[0] as { d: string }).d);
  }

  async create(tenantId: string, actor: DairyActor, idemKey: string, dto: CreateMembershipDto) {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return this.idem.remember(idemKey, actor.userId, 'dairy.membership.create', () =>
      timed(this.metrics, 'dairy.membership.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          if (!(await this.mccs.getById(tenantId, dto.mccId, tx))) throw new MccNotFoundError(dto.mccId);
          const m = DairyMembership.create({ id: uuidv7(), tenantId, farmerUserId: dto.farmerUserId, mccId: dto.mccId, memberCode: dto.memberCode,
            paymentCycle: dto.paymentCycle as PaymentCycle, defaultAnimalType: (dto.defaultAnimalType as AnimalType) ?? null });
          try { await this.repo.insert(tx, m); } catch (e: any) { if (e?.code === '23505') throw new MemberCodeExistsError(); throw e; }

          // [PC-56 TENANT-6d-3 · LIVE FINDING] **ENROLMENT OPENS THE FIRST ROUTE PERIOD.**
          //
          // Migration 0164 backfilled a route for every membership that existed when it ran, and the move writes the
          // ones after that — and NOTHING wrote the first route of a membership enrolled afterwards. Every membership
          // created from this deployment onwards would have had no route at all, so every as-of read (the register's
          // card, the quality desk's card, the counter board's roll) would have found nothing and fallen back to
          // today's values or to zero. The gap was invisible in the migration and obvious the first time a live test
          // enrolled somebody: a history table is only a history if the thing that CREATES the record writes to it.
          //
          // `valid_from` is the DATABASE's today, in the cooperative's own calendar — the day the card was handed over.
          const today = await this.today(tx);
          await this.routes.open(tx, {
            tenantId, membershipId: m.id, mccId: dto.mccId, memberCode: dto.memberCode,
            validFrom: today, movedBy: actor.userId, reason: 'enrolled at this centre',
          });

          await this.flush(tx, tenantId, m.id, m.pullEvents());
          return m.toJSON();
        }, { userId: actor.userId })));
  }

  /** A member reads their own membership; staff (dairy.manage) reads any in-tenant; else 404 (no IDOR). */
  async getById(tenantId: string, actor: DairyActor & { userId: string }, id: string) {
    const m = await this.repo.getById(tenantId, id);
    if (!m) throw new MembershipNotFoundError(id);
    if (m.farmerUserId !== actor.userId && !actor.canManage) throw new MembershipNotFoundError(id);
    return m.toJSON();
  }
  async list(tenantId: string, actor: DairyActor, q: { box: 'mine' | 'mcc' | 'all'; mccId?: string; cursor?: { c: string; id: string }; limit: number }) {
    if ((q.box === 'mcc' || q.box === 'all') && !actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    const rows = await this.repo.listFor(tenantId, { farmerUserId: q.box === 'mine' ? actor.userId : undefined, mccId: q.box === 'mcc' ? q.mccId : undefined, cursor: q.cursor, limit: q.limit });
    const items = rows.map((m) => m.toJSON());
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, events: DomainEvent[]) {
    for (const e of events) await this.outbox.write(tx, { tenantId, aggregateType: 'dairy_membership', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
