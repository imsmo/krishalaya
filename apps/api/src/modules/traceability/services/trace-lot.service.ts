// modules/traceability/services/trace-lot.service.ts · open lots + append the tamper-evident journey.
// create needs trace.manage; appendEvent (manual or via the auto-fanout) chains each event off the previous
// hash (sha256) for tamper-evidence. One ACID tx per write, outbox in-tx (Law 4). Reads are owner-or-manager
// (404 for a stranger — no IDOR). qr_token is a 32-char unguessable capability.
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { TraceLot } from '../domain/trace-lot.entity';
import { TraceEvent } from '../domain/trace-event.entity';
import { DomainEvent, TraceEventType, TraceStep } from '../domain/traceability.events';
import { TraceLotRepository } from '../repositories/trace-lot.repository';
import { TraceEventRepository } from '../repositories/trace-event.repository';
import { CreateTraceLotDto } from '../dto/create-trace-lot.dto';
import { TraceLotNotFoundError, TraceForbiddenError } from '../domain/traceability.errors';
import { encodeKeyset } from '../../../shared/pagination/us-keyset';

export interface TraceActor { userId: string; canManage: boolean; }
const qrToken = () => randomBytes(15).toString('base64url').slice(0, 20).toUpperCase();   // unguessable, ≤40 chars

@Injectable()
export class TraceLotService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly lots: TraceLotRepository,
    private readonly eventsRepo: TraceEventRepository,
  ) {}

  async create(tenantId: string, actor: TraceActor, idemKey: string, dto: CreateTraceLotDto) {
    if (!actor.canManage) throw new TraceForbiddenError('requires trace.manage');
    return this.idem.remember(idemKey, actor.userId, 'trace.lot.create', () =>
      timed(this.metrics, 'trace.lot.create', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const lot = TraceLot.create({ id: uuidv7(), tenantId, listingId: dto.listingId ?? null, qrToken: qrToken(), farmerUserId: actor.userId,
            parcelId: dto.parcelId ?? null, cropSeasonId: dto.cropSeasonId ?? null, declaredInputs: dto.declaredInputs, certificateIds: dto.certificateIds });
          await this.lots.insert(tx, lot);
          // PC-56 STORE-5b · D1 / B19: the lot's certificates are the ONE link table (this organisation's certificates only; the jsonb
          // column is still written for the record and no longer read)
          await this.lots.linkCertificates(tx, tenantId, lot.id, dto.certificateIds);
          await this.flush(tx, tenantId, lot.id, lot.pullEvents());
          // seed the chain with a 'harvested'/'listed' genesis event (chains off the lot id)
          await this.appendInTx(tx, tenantId, lot.id, dto.listingId ? 'listed' : 'harvested', {});
          return lot.toJSON();
        }, { userId: actor.userId })));
  }

  async appendEvent(tenantId: string, actor: TraceActor, lotId: string, eventCode: TraceStep, meta: Record<string, unknown>) {
    if (!actor.canManage) throw new TraceForbiddenError('requires trace.manage');
    return this.uow.run(tenantId, async (tx) => {
      const lot = await this.lots.getForUpdate(tx, tenantId, lotId);   // locks the lot so the chain head is stable
      if (!lot) throw new TraceLotNotFoundError(lotId);
      const ev = await this.appendInTx(tx, tenantId, lotId, eventCode, meta);
      return ev.toJSON();
    }, { userId: actor.userId });
  }

  /** Append one chained event in the caller's tx (used by create, manual append, and the fanout handlers). */
  async appendInTx(tx: TxContext, tenantId: string, lotId: string, eventCode: TraceStep, meta: Record<string, unknown>, now: Date = new Date()): Promise<TraceEvent> {
    const head = await this.eventsRepo.lastHead(tx, tenantId, lotId);
    const prev = head?.hash ?? lotId;   // genesis chains off the lot id
    // PC-56 STORE-5b · B11: hash VERSION 2 over the instant the row is stored with — never before the head (a pod's clock behind the last
    // event's would otherwise put the new event first in the chain the verify read walks)
    const createdAt = head && head.atMs >= now.getTime() ? new Date(head.atMs + 1) : now;
    const ev = TraceEvent.append({ traceLotId: lotId, tenantId, eventCode, meta, prevHash: prev, createdAt });
    await this.eventsRepo.insert(tx, ev);
    await this.outbox.write(tx, { tenantId, aggregateType: 'trace_lot', aggregateId: lotId, eventType: TraceEventType.EventAppended, payload: { v: 1, lotId, eventCode, eventHash: ev.eventHash } });
    return ev;
  }

  /** Idempotent auto-append from another module's event (skip if the code already exists for the lot). */
  async appendForListing(tx: TxContext, tenantId: string, listingId: string, eventCode: TraceStep, meta: Record<string, unknown>): Promise<void> {
    const lot = await this.lots.findByListing(tx, tenantId, listingId);
    if (!lot) return;                                              // no trace lot for this listing → nothing to do
    if (await this.eventsRepo.hasCode(tx, tenantId, lot.id, eventCode)) return;   // idempotent
    await this.appendInTx(tx, tenantId, lot.id, eventCode, meta);
  }

  async getById(tenantId: string, actor: TraceActor, id: string) {
    const lot = await this.lots.getById(tenantId, id);
    if (!lot || (lot.farmerUserId !== actor.userId && !actor.canManage)) throw new TraceLotNotFoundError(id);   // 404, no IDOR
    return lot.toJSON();
  }
  async listEvents(tenantId: string, actor: TraceActor, lotId: string, q: { cursor?: { c: string; id: string }; limit: number }) {
    await this.getById(tenantId, actor, lotId);   // ownership gate (throws 404)
    const rows = await this.eventsRepo.listForLot(tenantId, lotId, q);
    const items = rows.map((e) => e.toJSON());
    // PC-56 HOTFIX-7 · F-13 / B24: the cursor is (created_at µs, the event's bigserial id) — it used to carry the event HASH, which the repository
    // compared to the bigint id (page 2 errored)
    const last = rows[rows.length - 1]?.toProps();
    const nextCursor = rows.length === q.limit && last?.createdAtUs && last.id ? encodeKeyset(last.createdAtUs, last.id) : null;
    return { items, nextCursor };
  }
  async list(tenantId: string, actor: TraceActor, q: { box: 'mine' | 'all'; listingId?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all' && !actor.canManage) throw new TraceForbiddenError('requires trace.manage');
    const rows = await this.lots.listFor(tenantId, { box: q.box, farmerUserId: q.box === 'mine' ? actor.userId : undefined, listingId: q.listingId, cursor: q.cursor, limit: q.limit });
    const items = rows.map((l) => l.toJSON());
    const last = rows[rows.length - 1]?.toProps();
    const nextCursor = rows.length === q.limit && last?.createdAtUs ? encodeKeyset(last.createdAtUs, last.id) : null;   // PC-56 HOTFIX-7 · B24: the µs keyset
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, id: string, evts: DomainEvent[]): Promise<void> {
    for (const e of evts) await this.outbox.write(tx, { tenantId, aggregateType: 'trace_lot', aggregateId: id, eventType: e.type, payload: { v: 1, ...e.payload } });
  }
}
