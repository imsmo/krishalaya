// apps/worker/src/jobs/webhook-delivery.job.ts · pg-native outbound webhook delivery — PC-56 TENANT-13a (F-2, F-3, F-10, F-11).
//
// THE DEFECT THIS FILE REPLACES (F-2). The old job selected `d.created_at` through node-pg, which hands back a JS Date (milliseconds),
// and wrote every result `WHERE id = $1 AND created_at = $2` — against a MICROSECOND partition key. The UPDATE matched zero rows, every
// time: nothing was ever recorded, `attempt` never moved, parking never happened, and every due delivery was re-POSTed every 30 s,
// forever. Now: `created_at::text` (the µs text as the database prints it) is bound back as `$2::timestamptz`, the write also matches
// the state and attempt it read, and `rowCount === 1` is ASSERTED — anything else is logged and raised, never shrugged.
//
// ONE TICK
//   1. retire previous secrets whose 24 h overlap has ended (secret_enc_prev → NULL);
//   2. claim the due deliveries (state pending | retrying, next_retry_at ≤ now, endpoint active) in (next_retry_at, created_at) order —
//      a resumed endpoint's held deliveries share one next_retry_at, so they go in creation order;
//   3. per delivery: decrypt the secret(s) (core/secrets envelope; the KEK comes from the job context — no KEK, no run), run THE SAME
//      guard the registration ran (webhook-ssrf.vetWebhookTarget) with a fresh resolution of every address, sign with the current
//      secret (and the previous one inside the overlap — two v1 values), POST through the pinned transport (no redirects, 10 s,
//      64 KiB), and record: one webhook_delivery_attempts row + the delivery's new state, in ONE transaction;
//   4. the ladder (webhook-rail.state): 2xx → delivered; otherwise retry after 1m · 5m · 30m · 2h · 12h; the sixth failure exhausts the
//      delivery and PAUSES a tenant endpoint (paused_reason exhausted), holds its other queued deliveries and tells the developer
//      contact through the outbox (`webhooks.endpoint_paused`) — in the same transaction;
//   5. a guard refusal at send time (the host now resolves to a private address, …) sends NOTHING: the attempt is recorded `refused`,
//      the delivery is held and a tenant endpoint is DISABLED (paused_reason unsafe_target) with the same notice. A host that does not
//      resolve is an ordinary failure (dns:) on the ladder.
// Runs under the worker's advisory leader lock (one runner). Self-contained: the shared files in ./webhook are byte-identical copies of
// the API's (parity spec in apps/api).
import { lookup } from 'node:dns/promises';
import { PoolClient } from 'pg';
import { Job, JobCtx } from './index';
import { Resolver, vetWebhookTarget } from './webhook/webhook-ssrf';
import { openEnvelope } from './webhook/secret-envelope';
import { DELIVERY_HEADER, EVENT_HEADER, LEGACY_SIGNATURE_HEADER, PAYLOAD_VERSION_HEADER, SIGNATURE_HEADER, signatureHeader } from './webhook/webhook-signature';
import { MAX_ATTEMPTS, afterFailure, isDelivered } from './webhook/webhook-rail.state';
import { Transport, makePinnedTransport } from './webhook/pinned-transport';

export const BATCH = 200;

export interface WebhookDeliveryDeps {
  resolve: Resolver;
  transport: Transport;
  now: () => Date;
  log: (level: 'info' | 'error', msg: string, meta?: Record<string, unknown>) => void;
}

export const systemResolver: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));

interface DueRow {
  id: string; created_raw: string; tenant_id: string; endpoint_id: string; endpoint_kind: 'tenant' | 'partner'; event_type: string; body: string;
  attempt: number; retry_step: number; payload_version: number | null; url: string; secret_enc: string; secret_prev: string | null;
}

const aadFor = (kind: 'tenant' | 'partner', endpointId: string) => (kind === 'tenant' ? `webhook_endpoint:${endpointId}` : `partner_webhook_endpoint:${endpointId}`);
const clip = (s: string, n = 300) => (s.length > n ? s.slice(0, n) : s);

/** The outcome of one attempt, before it is written. */
type Outcome =
  | { kind: 'delivered'; status: number; durationMs: number; signedAt: Date; signatures: number }
  | { kind: 'failed'; status: number | null; error: string | null; durationMs: number; signedAt: Date | null; signatures: number }
  | { kind: 'refused'; error: string; durationMs: number };

export function makeWebhookDeliveryJob(deps: Partial<WebhookDeliveryDeps> = {}): Job {
  const d: WebhookDeliveryDeps = {
    resolve: deps.resolve ?? systemResolver,
    transport: deps.transport ?? makePinnedTransport(),
    now: deps.now ?? (() => new Date()),
    // eslint-disable-next-line no-console
    log: deps.log ?? ((level, msg, meta) => console[level === 'error' ? 'error' : 'log'](`[webhook-delivery] ${msg}`, meta ? JSON.stringify(meta) : '')),
  };
  return {
    name: 'webhook-delivery',
    intervalSec: 30,
    async run(ctx: JobCtx) {
      const kek = ctx.secrets?.webhookKek;
      // never a silent "disabled": a worker without the key must not look healthy (WorkerConfig refuses to boot without it in production)
      if (!kek) throw new Error('webhook-delivery: no WEBHOOK_SIGNING_KEK in the job context — refusing to run');
      const { client, metrics } = ctx;

      // a deleted endpoint is final (trigger) and its previous secret was retired with it — only live rows are touched
      await client.query(`UPDATE webhook_endpoints SET secret_enc_prev = NULL, prev_expires_at = NULL, updated_at = now() WHERE prev_expires_at <= now() AND deleted_at IS NULL`);

      const due = await client.query<DueRow>(
        `SELECT d.id, d.created_at::text AS created_raw, d.tenant_id, d.endpoint_id, d.endpoint_kind, d.event_type, d.payload::text AS body,
                d.attempt, d.retry_step, d.payload_version, t.url, t.secret_enc,
                CASE WHEN t.prev_expires_at > now() THEN t.secret_enc_prev END AS secret_prev
           FROM webhook_deliveries d
           JOIN webhook_delivery_targets t ON t.id = d.endpoint_id AND t.kind = d.endpoint_kind
          WHERE d.state IN ('pending', 'retrying') AND d.next_retry_at IS NOT NULL AND d.next_retry_at <= now()
            AND t.status = 'active' AND t.deleted_at IS NULL
          ORDER BY d.next_retry_at, d.created_at, d.id
          LIMIT $1`, [BATCH]);

      let delivered = 0, failed = 0, refused = 0, paused = 0;
      const stopped = new Set<string>();                         // endpoints paused / disabled during THIS tick
      for (const row of due.rows) {
        if (stopped.has(row.endpoint_id)) continue;              // already held by the pause below
        let secrets: string[];
        try {
          secrets = [openEnvelope(kek, row.secret_enc, aadFor(row.endpoint_kind, row.endpoint_id))];
          if (row.secret_prev) secrets.push(openEnvelope(kek, row.secret_prev, aadFor(row.endpoint_kind, row.endpoint_id)));
        } catch (e) {
          // a platform fault (wrong KEK, damaged ciphertext): nothing is sent, nothing is recorded as the receiver's failure
          metrics.inc('kv_webhook_secret_unreadable', { kind: row.endpoint_kind });
          d.log('error', 'signing secret could not be opened — delivery left due, not sent', { deliveryId: row.id, endpointId: row.endpoint_id, error: (e as Error).message });
          continue;
        }

        const outcome = await attempt(d, row, secrets);
        const r = await record(client, d, row, outcome);
        if (outcome.kind === 'delivered') delivered++; else if (outcome.kind === 'refused') refused++; else failed++;
        if (r.stoppedEndpoint) { stopped.add(row.endpoint_id); paused++; }
      }
      metrics.setGauge('kv_webhook_delivered', delivered);
      metrics.setGauge('kv_webhook_delivery_failures', failed);
      metrics.setGauge('kv_webhook_delivery_refused', refused);
      metrics.setGauge('kv_webhook_endpoints_paused', paused);
    },
  };
}

/** Guard (fresh resolution) → sign → POST (pinned, no redirects, bounded). */
async function attempt(d: WebhookDeliveryDeps, row: DueRow, secrets: string[]): Promise<Outcome> {
  const t0 = Date.now();
  const guard = await vetWebhookTarget(row.url, d.resolve);
  if (!guard.ok) {
    if (guard.reason === 'unresolvable' || guard.reason === 'no_address') {
      return { kind: 'failed', status: null, error: clip(`dns: ${guard.host ?? ''} did not resolve`), durationMs: Date.now() - t0, signedAt: null, signatures: 0 };
    }
    return { kind: 'refused', error: clip(`refused: ${guard.reason}${guard.address ? ` ${guard.address}` : ''}`), durationMs: Date.now() - t0 };
  }
  const signedAt = d.now();
  const ts = Math.floor(signedAt.getTime() / 1000);
  const sig = signatureHeader(secrets, row.body, ts);
  const res = await d.transport({ host: guard.host, port: 443, path: guard.path, pinned: guard.pinned }, row.body, {
    'content-type': 'application/json',
    [SIGNATURE_HEADER]: sig,
    [LEGACY_SIGNATURE_HEADER]: sig,
    [EVENT_HEADER]: row.event_type,
    [DELIVERY_HEADER]: row.id,
    [PAYLOAD_VERSION_HEADER]: String(row.payload_version ?? 1),
    'user-agent': 'Krishalaya-Webhooks/1',
  });
  if (res.kind === 'error') return { kind: 'failed', status: null, error: clip(res.error), durationMs: res.durationMs, signedAt, signatures: secrets.length };
  if (isDelivered(res.status)) return { kind: 'delivered', status: res.status, durationMs: res.durationMs, signedAt, signatures: secrets.length };
  const error = res.status >= 300 && res.status <= 399 ? `redirect: ${res.status} refused — the Location is never followed` : null;
  return { kind: 'failed', status: res.status >= 100 && res.status <= 599 ? res.status : null, error: error ?? (res.status >= 100 && res.status <= 599 ? null : `network: invalid status ${res.status}`), durationMs: res.durationMs, signedAt, signatures: secrets.length };
}

/** One transaction: the attempt row, the delivery's next state (µs match + rowCount asserted), and — on exhaustion / refusal — the pause. */
async function record(client: PoolClient, d: WebhookDeliveryDeps, row: DueRow, o: Outcome): Promise<{ stoppedEndpoint: boolean }> {
  const attemptNo = row.attempt + 1;
  let state: 'delivered' | 'retrying' | 'exhausted' | 'held';
  let retryStep = row.retry_step; let delaySec: number | null = null; let stop: 'exhausted' | 'unsafe_target' | null = null;
  if (o.kind === 'delivered') { state = 'delivered'; }
  else if (o.kind === 'refused') {
    // nothing was sent: a tenant endpoint is disabled and the delivery held for resume; a partner delivery cannot pause its endpoint
    // (partner onboarding is a human-run step; kv_relay holds no UPDATE there) and is exhausted
    state = row.endpoint_kind === 'tenant' ? 'held' : 'exhausted';
    stop = row.endpoint_kind === 'tenant' ? 'unsafe_target' : null;
  } else {
    retryStep = row.retry_step + 1;
    const next = afterFailure(retryStep);
    if (next.action === 'retry') { state = 'retrying'; delaySec = next.delaySec; }
    else { state = 'exhausted'; stop = row.endpoint_kind === 'tenant' ? 'exhausted' : null; }
  }
  const status = o.kind === 'refused' ? null : o.status;
  const error = o.kind === 'delivered' ? null : o.error;
  const outcome = o.kind;
  const signedAt = o.kind === 'refused' ? null : o.signedAt;
  const signatures = o.kind === 'refused' ? 0 : o.signatures;

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO webhook_delivery_attempts (tenant_id, delivery_id, delivery_created_at, endpoint_id, endpoint_kind, attempt_no, outcome, status_code, duration_ms, error, signed_at, signatures)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [row.tenant_id, row.id, row.created_raw, row.endpoint_id, row.endpoint_kind, attemptNo, outcome, status, Math.max(0, Math.round(o.durationMs)), error, signedAt, signatures]);
    const u = await client.query(
      `UPDATE webhook_deliveries
          SET attempt = $3::smallint, state = $4::text, retry_step = $5::smallint, status_code = COALESCE($6::int, status_code), succeeded = ($4::text = 'delivered'),
              next_retry_at = CASE WHEN $4::text = 'retrying' THEN now() + make_interval(secs => $7::double precision) END,
              last_error = $8::text, last_attempt_at = now(), delivered_at = CASE WHEN $4::text = 'delivered' THEN now() ELSE delivered_at END
        WHERE id = $1::uuid AND created_at = $2::timestamptz AND state IN ('pending', 'retrying') AND attempt = $9::smallint`,
      [row.id, row.created_raw, attemptNo, state, retryStep, status, delaySec ?? 0, error, row.attempt]);
    if (u.rowCount !== 1) {
      d.log('error', 'delivery result matched no row — the attempt is NOT recorded and the tick stops', { deliveryId: row.id, createdAt: row.created_raw, matched: u.rowCount });
      throw new Error(`webhook-delivery: result write for ${row.id}@${row.created_raw} matched ${u.rowCount} rows (expected 1)`);
    }
    let stopped = false;
    if (stop) stopped = await stopEndpoint(client, row, stop, status, error, attemptNo);
    await client.query('COMMIT');
    return { stoppedEndpoint: stopped };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  }
}

/** Pause (exhausted) or disable (unsafe_target) a TENANT endpoint, hold its queue, tell the developer contact, audit it. */
async function stopEndpoint(client: PoolClient, row: DueRow, reason: 'exhausted' | 'unsafe_target', status: number | null, error: string | null, attempts: number): Promise<boolean> {
  const p = await client.query<{ url: string; developer_email: string | null; created_by: string | null }>(
    `UPDATE webhook_endpoints SET status = $3::text, paused_reason = $4::text, paused_at = now(), updated_at = now()
      WHERE id = $1::uuid AND tenant_id = $2::uuid AND status = 'active' AND deleted_at IS NULL
      RETURNING url, developer_email, created_by`, [row.endpoint_id, row.tenant_id, reason === 'exhausted' ? 'paused' : 'disabled', reason]);
  if (p.rowCount !== 1) return false;                         // already stopped by a person between claim and now: nothing more to do
  const ep = p.rows[0];
  const held = await client.query(
    `UPDATE webhook_deliveries SET state = 'held', next_retry_at = NULL
      WHERE tenant_id = $1 AND endpoint_id = $2 AND endpoint_kind = 'tenant' AND state IN ('pending', 'retrying')`, [row.tenant_id, row.endpoint_id]);
  // who hears it: the developer contact when that address belongs to an active member of this tenant, and whoever added the endpoint
  const rec = await client.query<{ id: string; dev: boolean }>(
    `SELECT u.id, true AS dev FROM users u
       JOIN user_tenant_roles utr ON utr.user_id = u.id AND utr.tenant_id = $1 AND utr.is_active
      WHERE $2::text IS NOT NULL AND lower(u.email) = lower($2::text) AND u.deleted_at IS NULL
     UNION
     SELECT $3::uuid, false WHERE $3::uuid IS NOT NULL`, [row.tenant_id, ep.developer_email, ep.created_by]);
  const recipientUserIds = [...new Set(rec.rows.map((x) => x.id))];
  const host = (() => { try { return new URL(ep.url).hostname; } catch { return ''; } })();
  const lastResult = status !== null ? String(status) : String(error ?? '').split(':')[0] || 'unknown';
  await client.query(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, 'webhook_endpoint', $2, 'webhooks.endpoint_paused', $3::jsonb)`,
    [row.tenant_id, row.endpoint_id, JSON.stringify({
      v: 1, endpointId: row.endpoint_id, endpointHost: host, reason, failures: reason === 'exhausted' ? attempts : 1, maxAttempts: MAX_ATTEMPTS,
      lastResult, queuedForResume: (held.rowCount ?? 0) + 1, recipientUserIds,
      developerIsMember: rec.rows.some((x) => x.dev),
    })]);
  await client.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, actor_role, action, entity_type, entity_id, old_value, new_value, reason)
     VALUES ($1, NULL, 'system', $2, 'webhook_endpoint', $3, $4::jsonb, $5::jsonb, $6)`,
    [row.tenant_id, reason === 'exhausted' ? 'webhook.paused_by_rail' : 'webhook.disabled_by_guard', row.endpoint_id,
     JSON.stringify({ status: 'active' }), JSON.stringify({ status: reason === 'exhausted' ? 'paused' : 'disabled', pausedReason: reason, queuedForResume: (held.rowCount ?? 0) + 1, notified: recipientUserIds.length }),
     reason === 'exhausted' ? `${attempts} attempts failed (last: ${lastResult}) — the retry ladder is exhausted` : `the target guard refused the endpoint at send time (${clip(String(error ?? ''), 120)})`]);
  return true;
}

/** The registered job (KEK from the job context — main passes WorkerConfig's). */
export const webhookDeliveryJob: Job = makeWebhookDeliveryJob();
