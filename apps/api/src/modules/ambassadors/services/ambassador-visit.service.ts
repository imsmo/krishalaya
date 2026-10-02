// modules/ambassadors/services/ambassador-visit.service.ts · the ambassador field-visit log.
// The ACTOR is always the caller, re-resolved to their OWN active ambassador profile from the token (anti-IDOR
// + Law 6 authz THROWS). Logging is one ACID tx (UoW) with the event drained to the outbox (Law 4). Reads are
// the caller's own visits only, keyset-paginated. No money moves here.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { encodeCursor } from '../domain/cursor';
import { AmbassadorVisit, VisitPurpose } from '../domain/ambassador-visit.entity';
import { DomainEvent } from '../domain/ambassadors.events';
import { AmbassadorVisitRepository } from '../repositories/ambassador-visit.repository';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { NotAnAmbassadorError } from '../domain/ambassadors.errors';
import { CreateVisitDto } from '../dto/create-visit.dto';

@Injectable()
export class AmbassadorVisitService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly visits: AmbassadorVisitRepository,
    private readonly profiles: AmbassadorProfileRepository,
  ) {}

  /** Log a field visit the CALLER (an active ambassador) made. */
  async log(tenantId: string, userId: string, dto: CreateVisitDto) {
    return timed(this.metrics, 'ambassadors.visit.log', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const me = await this.profiles.findByUser(tenantId, userId, tx);
        if (!me || !me.toProps().isActive) throw new NotAnAmbassadorError();
        const v = AmbassadorVisit.log({
          id: uuidv7(), tenantId, ambassadorId: me.toProps().id, visitedUserId: dto.visitedUserId ?? null,
          purpose: dto.purpose as VisitPurpose, notes: dto.notes ?? null, lat: dto.lat ?? null, lng: dto.lng ?? null,
          regionId: dto.regionId ?? null, visitedAt: new Date(),
        });
        await this.visits.insert(tx, v);
        await this.profiles.touchActivity(tx, tenantId, me.toProps().id);   // PC-56 TENANT-10a · F-15: the act is the activity
        await this.flush(tx, tenantId, v.id, v.pullEvents());
        return v.toJSON();
      }, { userId }));
  }

  /** The caller-ambassador's own visit timeline (keyset). */
  async listMine(tenantId: string, userId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    const me = await this.profiles.findByUser(tenantId, userId);
    if (!me) throw new NotAnAmbassadorError();
    const rows = await this.visits.listForAmbassador(tenantId, me.toProps().id, q);
    const items = rows.map((v) => v.toJSON());
    const last = items[items.length - 1] as any;
    // visited_at is written by this service from a JS Date (millisecond-exact by construction), so its ISO form round-trips;
    // the cursor uses the module's one strict encoding (domain/cursor.ts) so one decoder serves every list.
    const nextCursor = items.length === q.limit && last ? encodeCursor(new Date(last.visitedAt).toISOString(), last.id) : null;
    return { items, nextCursor };
  }

  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'ambassador_visit', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
