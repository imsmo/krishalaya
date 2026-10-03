// modules/tenant-webhooks/repositories/webhook.repository.ts · SQL for webhook_endpoints, webhook_deliveries and webhook_delivery_attempts
// (0002 + 0191) — PC-56 TENANT-13a.
//   • tenant_id in EVERY tenant query (Law 1) + RLS (0191: the tenant realm sees endpoint_kind = 'tenant' rows only, F-19) — and every
//     delivery read ALSO joins webhook_endpoints of this tenant, so a partner delivery cannot surface even if a policy regressed;
//   • the secret ciphertext is selected only inside a write transaction (rotation moves it to `secret_enc_prev`), never into a row
//     the service returns;
//   • point lookups on the partitioned deliveries table prune by the v7 id's own instant (Law 8); writes bind `created_at` as the
//     database printed it (µs text), never a JS Date — the F-2 class;
//   • keyset cursors are microsecond (`shared/pagination/us-keyset`);
//   • the fanout runs inside the relay's transaction (kv_relay) — `endpointsForEvent` + `enqueue`; kv_app holds no INSERT on deliveries.
// The worker's claim / result SQL lives in apps/worker (pg-native); the old api copies (`claimDue`, `markResult`) were dead code with the
// same µs bug and are gone (F-22).
import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '../../../core/database/uuid.util';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import type { DeliveryState, EndpointStatus, PauseReason } from '../domain/webhook-rail.state';
import type { FailureGroup } from '../domain/webhook-log';

/** Partition pruning for a point lookup on webhook_deliveries by its v7 id ($n). */
const prune = (n: number, col = 'd.created_at') => `${col} >= uuid_v7_time($${n}) - interval '1 hour' AND ${col} < uuid_v7_time($${n}) + interval '1 hour'`;

export interface EndpointRow {
  id: string; tenantId: string; url: string; eventTypes: string[]; status: EndpointStatus; pausedReason: PauseReason | null; pausedAt: string | null;
  secretHint: string | null; secretRotatedAt: string | null; prevExpiresAt: string | null; developerEmail: string | null;
  createdAt: string; createdUs: string; createdBy: string | null;
}
export interface EndpointStats { attempts7d: number; okAttempts7d: number; delivered7d: number; failedToday: number; held: number; failedOpen: number }
export interface EndpointForUpdate extends EndpointRow { secretEnc: string; deleted: boolean }

export interface DeliveryRow {
  id: string; createdAt: string; createdUs: string; endpointId: string; endpointUrl: string; endpointStatus: EndpointStatus; eventType: string;
  payloadVersion: number | null; state: DeliveryState; attempt: number; attempts: number; retryStep: number; statusCode: number | null;
  nextRetryAt: string | null; lastError: string | null; lastAttemptAt: string | null; deliveredAt: string | null; replayCount: number;
  eventRef: string | null;
}
export interface AttemptRow { attemptNo: number; outcome: 'delivered' | 'failed' | 'refused'; statusCode: number | null; durationMs: number; error: string | null; signedAt: string | null; signatures: number; createdAt: string }
export interface DeliveryFilter { endpointId?: string; status?: 'all' | 'failed' | 'delivered' | 'held' | 'pending'; since?: string }

const ENDPOINT_COLS = `e.id, e.tenant_id, e.url, e.event_types, e.status, e.paused_reason, e.paused_at, e.secret_hint, e.secret_rotated_at,
  CASE WHEN e.prev_expires_at > now() THEN e.prev_expires_at END AS prev_expires_at, e.developer_email, e.created_at, ${US_SQL('e.created_at')} AS created_us, e.created_by`;
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const toEndpoint = (x: any): EndpointRow => ({
  id: x.id, tenantId: x.tenant_id, url: x.url, eventTypes: Array.isArray(x.event_types) ? x.event_types : [], status: x.status, pausedReason: x.paused_reason ?? null,
  pausedAt: iso(x.paused_at), secretHint: x.secret_hint ?? null, secretRotatedAt: iso(x.secret_rotated_at), prevExpiresAt: iso(x.prev_expires_at),
  developerEmail: x.developer_email ?? null, createdAt: iso(x.created_at)!, createdUs: x.created_us, createdBy: x.created_by ?? null,
});

const FAILED_STATES_SQL = `('retrying','exhausted')`;
function deliveryWhere(f: DeliveryFilter, params: unknown[]): string {
  const w: string[] = [];
  if (f.endpointId) { params.push(f.endpointId); w.push(`d.endpoint_id = $${params.length}`); }
  if (f.status === 'failed') w.push(`d.state IN ${FAILED_STATES_SQL}`);
  else if (f.status === 'delivered') w.push(`d.state = 'delivered'`);
  else if (f.status === 'held') w.push(`d.state = 'held'`);
  else if (f.status === 'pending') w.push(`d.state = 'pending'`);
  if (f.since) { params.push(f.since); w.push(`d.created_at >= $${params.length}::timestamptz`); }
  return w.length ? ` AND ${w.join(' AND ')}` : '';
}

@Injectable()
export class WebhookRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private r(tenantId: string): SqlExecutor { return this.replica.forTenant(tenantId); }

  /* ----------------------------------------------------------------------------------------------------------------------- */
  /* endpoints                                                                                                               */
  /* ----------------------------------------------------------------------------------------------------------------------- */

  async listEndpoints(tenantId: string, limit = 200): Promise<{ rows: Array<EndpointRow & { stats: EndpointStats }>; total: number }> {
    const r = await this.r(tenantId).query(
      `SELECT ${ENDPOINT_COLS},
              (SELECT count(*) FROM webhook_delivery_attempts a WHERE a.tenant_id = e.tenant_id AND a.endpoint_id = e.id AND a.endpoint_kind = 'tenant' AND a.created_at >= now() - interval '7 days')::int AS attempts7d,
              (SELECT count(*) FROM webhook_delivery_attempts a WHERE a.tenant_id = e.tenant_id AND a.endpoint_id = e.id AND a.endpoint_kind = 'tenant' AND a.created_at >= now() - interval '7 days' AND a.outcome = 'delivered')::int AS ok7d,
              (SELECT count(*) FROM webhook_deliveries d WHERE d.tenant_id = e.tenant_id AND d.endpoint_id = e.id AND d.endpoint_kind = 'tenant' AND d.state = 'delivered' AND d.delivered_at >= now() - interval '7 days')::int AS delivered7d,
              (SELECT count(*) FROM webhook_delivery_attempts a WHERE a.tenant_id = e.tenant_id AND a.endpoint_id = e.id AND a.endpoint_kind = 'tenant' AND a.outcome <> 'delivered' AND a.created_at >= date_trunc('day', now()))::int AS failed_today,
              (SELECT count(*) FROM webhook_deliveries d WHERE d.tenant_id = e.tenant_id AND d.endpoint_id = e.id AND d.endpoint_kind = 'tenant' AND d.state = 'held')::int AS held,
              (SELECT count(*) FROM webhook_deliveries d WHERE d.tenant_id = e.tenant_id AND d.endpoint_id = e.id AND d.endpoint_kind = 'tenant' AND d.state IN ${FAILED_STATES_SQL})::int AS failed_open,
              count(*) OVER ()::int AS total
         FROM webhook_endpoints e
        WHERE e.tenant_id = $1 AND e.deleted_at IS NULL
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT $2`, [tenantId, limit]);
    return {
      rows: r.rows.map((x: any) => ({ ...toEndpoint(x), stats: { attempts7d: x.attempts7d, okAttempts7d: x.ok7d, delivered7d: x.delivered7d, failedToday: x.failed_today, held: x.held, failedOpen: x.failed_open } })),
      total: r.rows[0]?.total ?? 0,
    };
  }

  async getEndpoint(tenantId: string, id: string): Promise<EndpointRow | null> {
    const r = await this.r(tenantId).query(`SELECT ${ENDPOINT_COLS} FROM webhook_endpoints e WHERE e.id = $1 AND e.tenant_id = $2 AND e.deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toEndpoint(r.rows[0]) : null;
  }

  /** Lock the endpoint for an act. Deleted rows come back with `deleted: true` (the act refuses by name). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<EndpointForUpdate | null> {
    const r = await tx.query(`SELECT ${ENDPOINT_COLS}, e.secret_enc, (e.deleted_at IS NOT NULL) AS deleted FROM webhook_endpoints e WHERE e.id = $1 AND e.tenant_id = $2 FOR UPDATE`, [id, tenantId]);
    const x = r.rows[0];
    return x ? { ...toEndpoint(x), secretEnc: x.secret_enc, deleted: x.deleted === true } : null;
  }

  async insertEndpoint(tx: TxContext, e: { id: string; tenantId: string; url: string; secretEnc: string; secretHint: string; eventTypes: string[]; developerEmail: string; userId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO webhook_endpoints (id, tenant_id, url, secret_enc, secret_hint, secret_rotated_at, event_types, status, developer_email, created_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, NULL, $6::jsonb, 'active', $7, now(), $8, $8)`,
      [e.id, e.tenantId, e.url, e.secretEnc, e.secretHint, JSON.stringify(e.eventTypes), e.developerEmail, e.userId]);
  }

  async updateEvents(tx: TxContext, tenantId: string, id: string, eventTypes: string[], userId: string): Promise<number> {
    const r = await tx.query(`UPDATE webhook_endpoints SET event_types = $3::jsonb, updated_at = now(), updated_by = $4 WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, tenantId, JSON.stringify(eventTypes), userId]);
    return r.rowCount ?? 0;
  }

  /** active ↔ paused | disabled. The transition is judged by the caller (domain/webhook-rail.state); this writes it. */
  async setStatus(tx: TxContext, tenantId: string, id: string, status: EndpointStatus, reason: PauseReason | null, userId: string): Promise<number> {
    const r = await tx.query(
      `UPDATE webhook_endpoints SET status = $3::text, paused_reason = $4::text, paused_at = CASE WHEN $3::text = 'active' THEN NULL ELSE now() END, updated_at = now(), updated_by = $5
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, tenantId, status, reason, userId]);
    return r.rowCount ?? 0;
  }

  /** Rotation: the current ciphertext becomes the previous one for the overlap; the new one signs first. */
  async rotate(tx: TxContext, tenantId: string, id: string, r: { secretEnc: string; secretHint: string; prevEnc: string; prevExpiresAt: Date; userId: string }): Promise<number> {
    const q = await tx.query(
      `UPDATE webhook_endpoints SET secret_enc = $3, secret_hint = $4, secret_enc_prev = $5, prev_expires_at = $6, secret_rotated_at = now(), updated_at = now(), updated_by = $7
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, tenantId, r.secretEnc, r.secretHint, r.prevEnc, r.prevExpiresAt, r.userId]);
    return q.rowCount ?? 0;
  }

  async softDelete(tx: TxContext, tenantId: string, id: string, userId: string, reason: string): Promise<number> {
    const r = await tx.query(
      // a deleted endpoint signs nothing again: a rotated-out secret still inside its overlap is retired with it
      `UPDATE webhook_endpoints SET deleted_at = now(), deleted_by = $3, delete_reason = $4, secret_enc_prev = NULL, prev_expires_at = NULL, updated_at = now(), updated_by = $3
        WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [id, tenantId, userId, reason]);
    return r.rowCount ?? 0;
  }

  /** How many of this endpoint's deliveries are in each state (for a verdict's "N will replay"). */
  async deliveryStateCounts(ex: SqlExecutor, tenantId: string, endpointId: string): Promise<Record<DeliveryState, number>> {
    const r = await ex.query(
      `SELECT state, count(*)::int AS n FROM webhook_deliveries WHERE tenant_id = $1 AND endpoint_id = $2 AND endpoint_kind = 'tenant' GROUP BY state`, [tenantId, endpointId]);
    const out: Record<string, number> = { pending: 0, retrying: 0, delivered: 0, held: 0, exhausted: 0, cancelled: 0 };
    for (const x of r.rows as Array<{ state: string; n: number }>) out[x.state] = x.n;
    return out as Record<DeliveryState, number>;
  }
  async endpointStateCounts(tenantId: string, endpointId: string) { return this.deliveryStateCounts(this.r(tenantId), tenantId, endpointId); }

  /** Re-queue this endpoint's deliveries in `from` states: due now, a fresh cycle. All share one next_retry_at, so the worker's
   *  ORDER BY next_retry_at, created_at sends them in creation order. */
  async requeue(tx: TxContext, tenantId: string, endpointId: string, from: readonly DeliveryState[]): Promise<number> {
    const r = await tx.query(
      `UPDATE webhook_deliveries SET state = 'pending', retry_step = 0, next_retry_at = now()
        WHERE tenant_id = $1 AND endpoint_id = $2 AND endpoint_kind = 'tenant' AND state = ANY($3::text[])`, [tenantId, endpointId, [...from]]);
    return r.rowCount ?? 0;
  }
  /** A manual pause: queued deliveries are held (recorded, not sent). */
  async holdQueued(tx: TxContext, tenantId: string, endpointId: string): Promise<number> {
    const r = await tx.query(
      `UPDATE webhook_deliveries SET state = 'held', next_retry_at = NULL
        WHERE tenant_id = $1 AND endpoint_id = $2 AND endpoint_kind = 'tenant' AND state IN ('pending','retrying')`, [tenantId, endpointId]);
    return r.rowCount ?? 0;
  }
  /** A deleted endpoint's open deliveries are cancelled — never sent to a URL its owner removed. */
  async cancelOpen(tx: TxContext, tenantId: string, endpointId: string): Promise<number> {
    const r = await tx.query(
      `UPDATE webhook_deliveries SET state = 'cancelled', next_retry_at = NULL
        WHERE tenant_id = $1 AND endpoint_id = $2 AND endpoint_kind = 'tenant' AND state IN ('pending','retrying','held','exhausted')`, [tenantId, endpointId]);
    return r.rowCount ?? 0;
  }

  /* ----------------------------------------------------------------------------------------------------------------------- */
  /* fanout (the relay's transaction)                                                                                        */
  /* ----------------------------------------------------------------------------------------------------------------------- */

  /** Every live tenant endpoint subscribed to `publicName` — active, paused AND disabled (a paused endpoint's events are held). */
  async endpointsForEvent(tx: TxContext, tenantId: string, publicName: string): Promise<Array<{ id: string; status: EndpointStatus }>> {
    const r = await tx.query(
      `SELECT id, status FROM webhook_endpoints WHERE tenant_id = $1 AND deleted_at IS NULL AND event_types ? $2 ORDER BY created_at LIMIT 500`, [tenantId, publicName]);
    return r.rows.map((x: any) => ({ id: x.id, status: x.status }));
  }

  /** Enqueue one delivery. `kind` names whose endpoint it is (F-19): the partner fanout passes 'partner'. */
  async enqueue(tx: TxContext, d: { tenantId: string; endpointId: string; kind: 'tenant' | 'partner'; eventType: string; payload: unknown; state: 'pending' | 'held';
    payloadVersion?: number | null; internalType?: string | null; sourceEventId?: string | null }): Promise<string> {
    const id = uuidv7();
    await tx.query(
      `INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, endpoint_kind, event_type, payload, attempt, retry_step, succeeded, state, next_retry_at,
                                       payload_version, internal_type, source_event_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, 0, 0, false, $7::text, CASE WHEN $7::text = 'pending' THEN now() END, $8, $9, $10, now())`,
      [id, d.endpointId, d.tenantId, d.kind, d.eventType, JSON.stringify(d.payload ?? {}), d.state, d.payloadVersion ?? null, d.internalType ?? null, d.sourceEventId ?? null]);
    return id;
  }

  /* ----------------------------------------------------------------------------------------------------------------------- */
  /* the delivery log (W189)                                                                                                 */
  /* ----------------------------------------------------------------------------------------------------------------------- */

  async listDeliveries(tenantId: string, f: DeliveryFilter, cursor: KeysetCursor | undefined, limit: number): Promise<DeliveryRow[]> {
    const params: unknown[] = [tenantId];
    let where = deliveryWhere(f, params);
    if (cursor) { params.push(cursor.ts, cursor.id); where += ` AND (d.created_at, d.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`; }
    params.push(limit);
    const r = await this.r(tenantId).query(
      `SELECT d.id, d.created_at, ${US_SQL('d.created_at')} AS created_us, d.endpoint_id, e.url AS endpoint_url, e.status AS endpoint_status, d.event_type, d.payload_version,
              d.state, d.attempt, d.retry_step, d.status_code, d.next_retry_at, d.last_error, d.last_attempt_at, d.delivered_at, d.replay_count,
              (SELECT count(*) FROM webhook_delivery_attempts a WHERE a.delivery_id = d.id AND a.tenant_id = d.tenant_id)::int AS attempts,
              d.payload -> 'data' AS data
         FROM webhook_deliveries d
         JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1 AND d.endpoint_kind = 'tenant'${where}
        ORDER BY d.created_at DESC, d.id DESC
        LIMIT $${params.length}`, params);
    return r.rows.map(toDelivery);
  }

  async deliveryCounts(tenantId: string, f: DeliveryFilter): Promise<{ total: number; failed: number }> {
    const params: unknown[] = [tenantId];
    const where = deliveryWhere({ ...f, status: 'all' }, params);
    const r = await this.r(tenantId).query(
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE d.state IN ${FAILED_STATES_SQL})::int AS failed
         FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.tenant_id = d.tenant_id
        WHERE d.tenant_id = $1 AND d.endpoint_kind = 'tenant'${where}`, params);
    return { total: r.rows[0]?.total ?? 0, failed: r.rows[0]?.failed ?? 0 };
  }

  /** The failed ATTEMPTS in the window, grouped by endpoint and outcome — the diagnosis line's facts. */
  async failureGroups(tenantId: string, f: { endpointId?: string; since?: string }): Promise<FailureGroup[]> {
    const params: unknown[] = [tenantId]; const w: string[] = [];
    if (f.endpointId) { params.push(f.endpointId); w.push(`a.endpoint_id = $${params.length}`); }
    if (f.since) { params.push(f.since); w.push(`a.created_at >= $${params.length}::timestamptz`); }
    const r = await this.r(tenantId).query(
      `SELECT a.endpoint_id, e.url, COALESCE(a.status_code::text, NULLIF(split_part(a.error, ':', 1), ''), 'unknown') AS code,
              count(*)::int AS n, ${US_SQL('min(a.created_at)')} AS since
         FROM webhook_delivery_attempts a JOIN webhook_endpoints e ON e.id = a.endpoint_id AND e.tenant_id = a.tenant_id
        WHERE a.tenant_id = $1 AND a.endpoint_kind = 'tenant' AND a.outcome <> 'delivered'${w.length ? ` AND ${w.join(' AND ')}` : ''}
        GROUP BY a.endpoint_id, e.url, 3`, params);
    return r.rows.map((x: any) => ({ endpointId: x.endpoint_id, endpointHost: x.url, code: x.code, count: x.n, since: x.since }));
  }

  async getDelivery(tenantId: string, id: string): Promise<(DeliveryRow & { payload: unknown; attemptsList: AttemptRow[] }) | null> {
    const ex = this.r(tenantId);
    const r = await ex.query(
      `SELECT d.id, d.created_at, ${US_SQL('d.created_at')} AS created_us, d.endpoint_id, e.url AS endpoint_url, e.status AS endpoint_status, d.event_type, d.payload_version,
              d.state, d.attempt, d.retry_step, d.status_code, d.next_retry_at, d.last_error, d.last_attempt_at, d.delivered_at, d.replay_count, d.payload,
              (SELECT count(*) FROM webhook_delivery_attempts a WHERE a.delivery_id = d.id AND a.tenant_id = d.tenant_id)::int AS attempts,
              d.payload -> 'data' AS data
         FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.tenant_id = d.tenant_id
        WHERE d.id = $1 AND d.tenant_id = $2 AND d.endpoint_kind = 'tenant' AND ${prune(1)}`, [id, tenantId]);
    const x = r.rows[0];
    if (!x) return null;
    const a = await ex.query(
      `SELECT attempt_no, outcome, status_code, duration_ms, error, signed_at, signatures, created_at FROM webhook_delivery_attempts
        WHERE delivery_id = $1 AND tenant_id = $2 AND endpoint_kind = 'tenant' ORDER BY attempt_no`, [id, tenantId]);
    return {
      ...toDelivery(x), payload: x.payload,
      attemptsList: a.rows.map((y: any) => ({ attemptNo: y.attempt_no, outcome: y.outcome, statusCode: y.status_code ?? null, durationMs: y.duration_ms, error: y.error ?? null, signedAt: iso(y.signed_at), signatures: y.signatures, createdAt: iso(y.created_at)! })),
    };
  }

  /** Lock one delivery for a replay; returns the µs `created_at` text the write must bind. */
  async getDeliveryForUpdate(tx: TxContext, tenantId: string, id: string): Promise<{ id: string; createdRaw: string; endpointId: string; endpointStatus: EndpointStatus; endpointDeleted: boolean; state: DeliveryState; eventType: string } | null> {
    const r = await tx.query(
      `SELECT d.id, d.created_at::text AS created_raw, d.endpoint_id, e.status AS endpoint_status, (e.deleted_at IS NOT NULL) AS endpoint_deleted, d.state, d.event_type
         FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.tenant_id = d.tenant_id
        WHERE d.id = $1 AND d.tenant_id = $2 AND d.endpoint_kind = 'tenant' AND ${prune(1)}
        FOR UPDATE OF d`, [id, tenantId]);
    const x = r.rows[0];
    return x ? { id: x.id, createdRaw: x.created_raw, endpointId: x.endpoint_id, endpointStatus: x.endpoint_status, endpointDeleted: x.endpoint_deleted === true, state: x.state, eventType: x.event_type } : null;
  }

  /** Replay one delivery: the ORIGINAL payload, re-queued now, a fresh cycle (the worker signs it afresh). */
  async replayOne(tx: TxContext, tenantId: string, id: string, createdRaw: string, userId: string): Promise<number> {
    const r = await tx.query(
      `UPDATE webhook_deliveries SET state = 'pending', retry_step = 0, next_retry_at = now(), succeeded = false,
              replay_count = replay_count + 1, replayed_at = now(), replayed_by = $4
        WHERE id = $1 AND tenant_id = $2 AND created_at = $3::timestamptz AND endpoint_kind = 'tenant' AND state IN ('retrying','exhausted','delivered')`,
      [id, tenantId, createdRaw, userId]);
    return r.rowCount ?? 0;
  }
  /** Replay every failed delivery of one endpoint. */
  async replayFailed(tx: TxContext, tenantId: string, endpointId: string, userId: string): Promise<number> {
    const r = await tx.query(
      `UPDATE webhook_deliveries SET state = 'pending', retry_step = 0, next_retry_at = now(), replay_count = replay_count + 1, replayed_at = now(), replayed_by = $3
        WHERE tenant_id = $1 AND endpoint_id = $2 AND endpoint_kind = 'tenant' AND state IN ${FAILED_STATES_SQL}`, [tenantId, endpointId, userId]);
    return r.rowCount ?? 0;
  }
}

function toDelivery(x: any): DeliveryRow {
  const data = x.data && typeof x.data === 'object' ? x.data as Record<string, unknown> : {};
  const ref = ['orderId', 'paymentId', 'payoutId', 'shipmentId', 'auctionId', 'offerId', 'disputeId', 'billId'].map((k) => data[k]).find((v) => typeof v === 'string');
  return {
    id: x.id, createdAt: iso(x.created_at)!, createdUs: x.created_us, endpointId: x.endpoint_id, endpointUrl: x.endpoint_url, endpointStatus: x.endpoint_status,
    eventType: x.event_type, payloadVersion: x.payload_version ?? null, state: x.state, attempt: x.attempt, attempts: x.attempts, retryStep: x.retry_step,
    statusCode: x.status_code ?? null, nextRetryAt: iso(x.next_retry_at), lastError: x.last_error ?? null, lastAttemptAt: iso(x.last_attempt_at),
    deliveredAt: iso(x.delivered_at), replayCount: x.replay_count ?? 0, eventRef: typeof ref === 'string' ? ref : null,
  };
}
