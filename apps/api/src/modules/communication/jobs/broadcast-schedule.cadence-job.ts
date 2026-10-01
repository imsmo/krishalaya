// modules/communication/jobs/broadcast-schedule.cadence-job.ts · PC-56 TENANT-8e · `scheduled_at`, HONOURED (F-21).
//
// 0073 added `tenant_broadcasts.scheduled_at` and an index for it, and NOTHING read either — a "scheduled" broadcast was
// a column with no consequence. DECIDED: keep the column and honour it, because W429 draws a Schedule field and a
// history row "scheduled 14 Jul, 08:30 · queued", and the alternative (remove it from the API) would leave the canon's
// own field refused for no reason the platform has. The send act writes `scheduled` (0179 requires the time to be in the
// future at that moment); this job, REGISTERED in `CommunicationModule.onModuleInit` (6c-1's pattern, 8b's held-release
// shape), moves each due one `scheduled → queued` and writes the same `communication.broadcast_requested` outbox event the
// send-now path writes — in ONE transaction, so a crash between the two cannot exist.
//
// THE FOUR PROPERTIES (8b's): claim-then-settle one broadcast per transaction with `FOR UPDATE SKIP LOCKED` and the due
// test re-taken inside the lock (a person's cancel and the job's claim cannot both win — the row lock orders them, and
// 0179's guard refuses `cancelled → queued`); the row is the truth; idempotent (a second tick finds it `queued`);
// bounded (at most CLAIM_LIMIT a tick, oldest first).
//
// Quiet hours are NOT this job's business: it queues at the time the person chose, and the fan-out holds each member's
// push inside THEIR window (8b) — which is what the review's estimate printed before the send.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { BroadcastRepository } from '../repositories/broadcast.repository';
import { BROADCAST_REQUESTED, BroadcastEvents } from '../services/broadcast.service';

export const BROADCAST_CLAIM_LIMIT = 50;
export const BROADCAST_SCHEDULE_TICK_MS = 60_000;
export interface ScheduleTally { examined: number; queued: number; failed: number; skipped: number; errors: number }

@Injectable()
export class BroadcastScheduleCadenceJob implements ScheduledJob {
  readonly name = 'communication-broadcast-schedule';
  readonly intervalMs = BROADCAST_SCHEDULE_TICK_MS;
  private readonly log = new Logger(BroadcastScheduleCadenceJob.name);

  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    private readonly repo: BroadcastRepository,
  ) {}

  async run(pool: Pool, now: Date = new Date()): Promise<void> { await this.tick(pool, now); }

  async tick(pool: Pool, now: Date = new Date()): Promise<ScheduleTally> {
    const t: ScheduleTally = { examined: 0, queued: 0, failed: 0, skipped: 0, errors: 0 };
    for (const d of await this.repo.due(pool, now, BROADCAST_CLAIM_LIMIT)) {
      t.examined += 1;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [d.tenantId]);
        const tx: TxContext = { query: (sql, params) => client.query(sql, params as unknown[]) as never, tenantId: d.tenantId, userId: 'system' };
        const b = await this.repo.claimDue(tx, d.tenantId, d.id, now);
        if (!b) { t.skipped += 1; await client.query('ROLLBACK'); continue; }   // cancelled, claimed by another pod, or no longer due
        // Re-asked at the due instant: a frame that stopped serving, or a role retired while it waited, FAILS the broadcast
        // with its code — once, on the broadcast — rather than queuing a send 0179 would refuse every tick for ever.
        const gaps = await this.repo.templateGaps(d.tenantId, tx);
        const role = b.toProps().audienceRoleCode;
        const reason = gaps.length > 0 ? 'no_template' as const : role !== null && !(await this.repo.roleKnown(d.tenantId, role, tx)) ? 'role_retired' as const : null;
        if (reason) {
          b.markFailed(reason, now);
          await this.repo.updateState(tx, b, null);
          await this.audit.write(tx, { tenantId: d.tenantId, actorUserId: null, action: BroadcastEvents.Failed, entityType: 'tenant_broadcast', entityId: b.id, reason,
            oldValue: { status: 'scheduled' }, newValue: { status: 'failed', failureReason: reason, gaps } });
          await this.outbox.write(tx, { tenantId: d.tenantId, aggregateType: 'tenant_broadcast', aggregateId: b.id, eventType: BroadcastEvents.Failed, payload: { v: 1, broadcastId: b.id, reason } });
          await client.query('COMMIT');
          t.failed += 1;
          continue;
        }
        b.queueScheduled(now);
        await this.repo.updateState(tx, b, null);
        await this.audit.write(tx, { tenantId: d.tenantId, actorUserId: null, action: BroadcastEvents.Queued, entityType: 'tenant_broadcast', entityId: b.id,
          oldValue: { status: 'scheduled' }, newValue: { status: 'queued', by: 'schedule' } });
        await this.outbox.write(tx, { tenantId: d.tenantId, aggregateType: 'tenant_broadcast', aggregateId: b.id, eventType: BROADCAST_REQUESTED, payload: { v: 1, broadcastId: b.id } });
        await client.query('COMMIT');
        t.queued += 1;
      } catch (e) {
        t.errors += 1;
        await client.query('ROLLBACK').catch(() => undefined);
        // The row stays scheduled and the next tick re-asks it; the error is logged, never swallowed.
        this.log.warn(`scheduled broadcast ${d.id} could not be queued: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        client.release();
      }
    }
    if (t.examined > 0) this.metrics.inc('comm.broadcast_schedule.tick', { queued: String(t.queued), errors: String(t.errors) });
    return t;
  }
}
