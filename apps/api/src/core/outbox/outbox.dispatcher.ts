// core/outbox/outbox.dispatcher.ts
// The transactional-outbox RELAY (Law 4: events flow ONLY through the outbox). Turns same-tx
// outbox rows into cross-module handler calls, in order, exactly-once-ish:
//   • claims ONE pending event at a time with FOR UPDATE SKIP LOCKED (many relay workers are safe);
//   • sets app.tenant_id to the event's tenant, then runs every registered handler for its type
//     INSIDE the same tx (handler writes + marking the event 'published' commit atomically);
//   • a handler throwing rolls the tx back and marks the event 'failed' (a DLQ/requeue job retries);
//   • handlers MUST be idempotent (at-least-once delivery).
// Runs on a privileged connection (kv_relay, BYPASSRLS — see migration 0018) so it can see every
// tenant's pending events; the request tier (kv_app) is RLS-scoped and never relays.
import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { Metrics } from '../observability/metrics';
import { TxContext } from '../database/unit-of-work';
import { OutboxEvent, OutboxHandler } from './event-envelope';

/** Registry of consumers, keyed by event_type. Modules register their handlers at init. */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly byType = new Map<string, OutboxHandler[]>();
  register(handler: OutboxHandler): void {
    const list = this.byType.get(handler.eventType) ?? [];
    list.push(handler);
    this.byType.set(handler.eventType, list);
  }
  handlersFor(eventType: string): OutboxHandler[] { return this.byType.get(eventType) ?? []; }
  get size(): number { return this.byType.size; }
  /** PC-56 HOTFIX-2 · every registered (eventType, handler) pair, in registration order per type — read-only, so the
   *  relay-as-kv_relay gate (`__tests__/relay-handlers-as-kv-relay.integration.spec.ts`) can enumerate what boot wired. */
  entries(): ReadonlyArray<{ eventType: string; handler: OutboxHandler }> {
    const out: { eventType: string; handler: OutboxHandler }[] = [];
    for (const [eventType, list] of this.byType) for (const handler of list) out.push({ eventType, handler });
    return out;
  }
}

/** What one relay attempt did. `not_pending` = nothing to claim (queue drained, or the named event is not pending). */
export type RelayOutcome =
  | { status: 'not_pending' }
  | { status: 'published'; eventId: string }
  | { status: 'failed'; eventId: string; error: unknown };

export class OutboxDispatcher {
  constructor(private readonly relayPool: Pool, private readonly registry: OutboxHandlerRegistry, private readonly metrics: Metrics) {}

  /** Relay up to `max` pending events. Returns how many were processed (published or failed). */
  async relayBatch(max = 100): Promise<number> {
    let n = 0;
    for (let i = 0; i < max; i++) {
      const processed = await this.relayOne();
      if (!processed) break;     // queue drained
      n++;
    }
    return n;
  }

  /** Process exactly one pending event in its own transaction. Returns false when none remain. */
  async relayOne(): Promise<boolean> {
    const outcome = await this.claimAndProcess(
      `SELECT id, tenant_id, aggregate_type, aggregate_id, event_type, payload
         FROM outbox_events WHERE status='pending' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1`, []);
    return outcome.status !== 'not_pending';
  }

  /** PC-56 HOTFIX-2 · relay ONE named event (still `pending`), through exactly the same claim → tenant context → handlers →
   *  publish/quarantine path as relayOne. For a targeted replay (an operator re-driving one quarantined event after it is
   *  re-queued) and for the relay-as-kv_relay gate, which must dispatch ITS event without draining anyone else's queue.
   *  Returns what happened, including the handler error when the event was quarantined. */
  async relayById(eventId: string): Promise<RelayOutcome> {
    return this.claimAndProcess(
      `SELECT id, tenant_id, aggregate_type, aggregate_id, event_type, payload
         FROM outbox_events WHERE id=$1 AND status='pending' FOR UPDATE SKIP LOCKED`, [eventId]);
  }

  private async claimAndProcess(claimSql: string, claimParams: unknown[]): Promise<RelayOutcome> {
    const client = await this.relayPool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(claimSql, claimParams as any[]);
      if (r.rowCount === 0) { await client.query('ROLLBACK'); return { status: 'not_pending' }; }
      const row = r.rows[0];
      const event: OutboxEvent = { id: String(row.id), tenantId: row.tenant_id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, eventType: row.event_type, payload: row.payload };

      try {
        // tenant context for any current_tenant_id() usage inside handlers (defense-in-depth)
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [event.tenantId ?? '']);
        const tx: TxContext = { query: (sql, params) => client.query(sql, params as any) as any, tenantId: event.tenantId ?? '', userId: 'system' };
        for (const h of this.registry.handlersFor(event.eventType)) await h.handle(event, tx);
        await client.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE id=$1`, [row.id]);
        await client.query('COMMIT');
        this.metrics.inc('outbox.published', { type: event.eventType });
        return { status: 'published', eventId: event.id };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        // mark failed in a fresh statement (the event tx rolled back); DLQ/requeue handles it
        await this.relayPool.query(`UPDATE outbox_events SET status='failed' WHERE id=$1`, [row.id]).catch(() => undefined);
        this.metrics.inc('outbox.failed', { type: event.eventType });
        // Surface WHY: a swallowed handler error here means a money/settlement event was quarantined
        // silently (e.g. a farmer never got paid). Log to stderr so operators and the pilot relay
        // tick can see the cause instead of a bare "failed" count.
        // eslint-disable-next-line no-console
        console.error(`[outbox] handler FAILED for event ${row.id} type=${event.eventType} aggregate=${event.aggregateId}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
        return { status: 'failed', eventId: event.id, error: err };   // we did process (and quarantined) one event
      }
    } finally {
      client.release();
    }
  }
}
