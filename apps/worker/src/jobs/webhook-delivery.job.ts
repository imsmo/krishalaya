// apps/worker/src/jobs/webhook-delivery.job.ts · pg-native outbound webhook delivery (P1-11). Picks due
// webhook_deliveries (enqueued in-tx by the apps/api fanout handler), decrypts the endpoint's signing secret
// (AES-256-GCM, key from WEBHOOK_SIGNING_KEK), signs the body (HMAC-SHA256, Stripe-style header), and POSTs it with
// a hard timeout. Runs under the worker advisory leader-lock (single runner → no claim race). Exponential backoff on
// failure; gives up after MAX_ATTEMPTS (next_retry_at → NULL, so it's no longer due). Self-contained (no apps/api
// import), matching the worker's pg-native job model. SSRF was enforced at registration; here we also reject a
// non-https URL defensively before any request.
import { createHmac, createDecipheriv } from 'node:crypto';
import { Job, JobCtx } from './index';

const MAX_ATTEMPTS = 8;
const TIMEOUT_MS = 8000;
const BATCH = 200;

function loadKek(): Buffer | null {
  const raw = process.env.WEBHOOK_SIGNING_KEK || '';
  if (!raw) return null;
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

function openSecret(key: Buffer, token: string): string {
  const buf = Buffer.from(token, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

function backoffSeconds(attempt: number): number {
  // 1m, 5m, 15m, 30m, 1h, 2h, 4h (capped)
  const ladder = [60, 300, 900, 1800, 3600, 7200, 14400];
  return ladder[Math.min(attempt - 1, ladder.length - 1)] ?? 14400;
}

export const webhookDeliveryJob: Job = {
  name: 'webhook-delivery',
  intervalSec: 30,
  async run({ client, metrics }: JobCtx) {
    const kek = loadKek();
    if (!kek) { metrics.setGauge('kv_webhook_delivery_disabled', 1); return; } // fail-safe: no key → don't leak/crash
    metrics.setGauge('kv_webhook_delivery_disabled', 0);

    const due = await client.query<{ id: string; created_at: string; event_type: string; payload: unknown; attempt: number; url: string; secret_hash: string }>(
      `SELECT d.id, d.created_at, d.event_type, d.payload, d.attempt, e.url, e.secret_hash
         FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
        WHERE d.succeeded = false AND d.next_retry_at IS NOT NULL AND d.next_retry_at <= now() AND e.is_active = true
        ORDER BY d.next_retry_at LIMIT $1`, [BATCH]);

    let ok = 0, failed = 0;
    for (const row of due.rows) {
      const body = JSON.stringify(row.payload ?? {});
      const ts = Math.floor(Date.now() / 1000);
      let succeeded = false; let statusCode: number | null = null;
      try {
        if (!/^https:\/\//i.test(row.url)) throw new Error('non-https endpoint');
        const secret = openSecret(kek, row.secret_hash);
        const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(row.url, {
            method: 'POST', signal: ctrl.signal,
            headers: { 'content-type': 'application/json', 'X-KV-Timestamp': String(ts), 'X-KV-Signature': `t=${ts},v1=${sig}`, 'X-KV-Event': row.event_type, 'User-Agent': 'Krishalaya-Webhooks/1' },
            body,
          });
          statusCode = res.status;
          succeeded = res.status >= 200 && res.status < 300;
        } finally { clearTimeout(timer); }
      } catch { succeeded = false; }

      const nextAttempt = row.attempt + 1;
      if (succeeded) {
        await client.query(`UPDATE webhook_deliveries SET succeeded=true, status_code=$3, attempt=$4, next_retry_at=NULL WHERE id=$1 AND created_at=$2`, [row.id, row.created_at, statusCode, row.attempt]);
        ok++;
      } else if (nextAttempt > MAX_ATTEMPTS) {
        await client.query(`UPDATE webhook_deliveries SET status_code=$3, attempt=$4, next_retry_at=NULL WHERE id=$1 AND created_at=$2`, [row.id, row.created_at, statusCode, nextAttempt]);
        failed++;
      } else {
        await client.query(`UPDATE webhook_deliveries SET status_code=$3, attempt=$4, next_retry_at=now() + ($5 || ' seconds')::interval WHERE id=$1 AND created_at=$2`, [row.id, row.created_at, statusCode, nextAttempt, backoffSeconds(nextAttempt)]);
        failed++;
      }
    }
    metrics.setGauge('kv_webhook_delivered', ok);
    metrics.setGauge('kv_webhook_delivery_failures', failed);
  },
};
