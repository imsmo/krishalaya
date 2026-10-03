// apps/worker/src/__tests__/webhook-delivery.spec.ts · PC-56 TENANT-13a — the delivery rail, proven.
//
// PART 1 (pure, always runs): the contract numbers, the signature (both v1 values in the rotation window, verifiable with either
// secret), the guard's refusal of every bypass the survey listed (literal and via a mocked resolver), and the pinned transport — a 307
// is answered as itself (the Location is never requested), the socket is pinned to the vetted address with the real name as SNI, the
// response is capped at 64 KiB and the exchange at 10 s.
//
// PART 2 (real Postgres; runs when WORKER_TEST_DATABASE_URL names a superuser URL to a database built from the migrations, e.g. the
// harness's krishalaya_test or a scratch DB): the job runs AS kv_relay (SET ROLE) against real rows —
//   • one due row → exactly one POST → the row is delivered (state, attempt 1, status 200, one attempt row); a second tick POSTs nothing
//     (the F-2 defect: the old UPDATE matched 0 rows and re-POSTed forever);
//   • the ladder: five retries at 1m · 5m · 30m · 2h · 12h, the sixth failure exhausts the delivery, PAUSES the endpoint, holds its other
//     queued delivery, writes `webhooks.endpoint_paused` to the outbox with its recipients and audits the pause — all in one transaction;
//   • the guard at send time: a name resolving to 169.254.169.254 and a mapped-IPv6 literal are REFUSED — nothing POSTed, the attempt
//     recorded `refused`, the endpoint DISABLED (unsafe_target), the delivery held;
//   • a 307 to an internal host: one request, failure recorded `redirect: 307 refused`, nothing fetched at the Location;
//   • rotation: inside the 24 h overlap a delivery carries two v1 values and verifies with EITHER secret; after it, one value, the new
//     secret only, and the expired previous ciphertext is cleared.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeWebhookDeliveryJob } from '../jobs/webhook-delivery.job';
import { RequestFn, Transport, TransportResult, makePinnedTransport } from '../jobs/webhook/pinned-transport';
import { Resolver, checkWebhookUrl, vetWebhookTarget } from '../jobs/webhook/webhook-ssrf';
import { parseKek, sealEnvelope } from '../jobs/webhook/secret-envelope';
import { parseSignatureHeader, signatureHeader, verifySignature } from '../jobs/webhook/webhook-signature';
import { MAX_ATTEMPTS, RESPONSE_BODY_CAP_BYTES, RETRY_LADDER_SECONDS, SEND_TIMEOUT_MS, afterFailure } from '../jobs/webhook/webhook-rail.state';
import { WorkerMetrics } from '../metrics';

const KEK = parseKek('a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90');
const PUBLIC: Resolver = async () => [{ address: '93.184.216.34', family: 4 }];

/* ================================================================================================================================ */
/* PART 1 · pure                                                                                                                    */
/* ================================================================================================================================ */
describe('the contract numbers (W188 prints these)', () => {
  it('ladder 1m · 5m · 30m · 2h · 12h, six attempts a cycle, 10 s, 64 KiB', () => {
    expect(RETRY_LADDER_SECONDS).toEqual([60, 300, 1800, 7200, 43200]);
    expect(MAX_ATTEMPTS).toBe(6);
    expect(SEND_TIMEOUT_MS).toBe(10_000);
    expect(RESPONSE_BODY_CAP_BYTES).toBe(65_536);
    expect([1, 2, 3, 4, 5].map((n) => (afterFailure(n) as { delaySec: number }).delaySec)).toEqual([60, 300, 1800, 7200, 43200]);
    expect(afterFailure(6)).toEqual({ action: 'exhaust' });
  });
});

describe('the signature', () => {
  it('carries both v1 values inside the rotation window and verifies with either secret', () => {
    const h = signatureHeader(['whsec_new', 'whsec_old'], '{"a":1}', 1_760_000_000);
    expect(parseSignatureHeader(h).v1).toHaveLength(2);
    expect(verifySignature(h, 'whsec_new', '{"a":1}', 1_760_000_010)).toBe(true);
    expect(verifySignature(h, 'whsec_old', '{"a":1}', 1_760_000_010)).toBe(true);
    expect(verifySignature(h, 'whsec_other', '{"a":1}', 1_760_000_010)).toBe(false);
    expect(verifySignature(h, 'whsec_new', '{"a":2}', 1_760_000_010)).toBe(false);          // tampered body
    expect(verifySignature(h, 'whsec_new', '{"a":1}', 1_760_000_000 + 301)).toBe(false);    // stale replay
  });
});

describe('the guard refuses every bypass the survey listed', () => {
  const literal = ['https://[::ffff:169.254.169.254]/x', 'https://[::ffff:127.0.0.1]/x', 'https://localhost./x', 'https://[fec0::1]/x', 'https://[64:ff9b::a9fe:a9fe]/x'];
  it.each(literal)('%s', (u) => expect(checkWebhookUrl(u).ok).toBe(false));
  it('169.254.169.254.nip.io via a resolver that answers the metadata address', async () => {
    const v = await vetWebhookTarget('https://169.254.169.254.nip.io/hook', async () => [{ address: '169.254.169.254', family: 4 }]);
    expect(v).toMatchObject({ ok: false, reason: 'private_address', address: '169.254.169.254' });
  });
  it('a name with ONE private address among public ones is refused (every address is checked)', async () => {
    const v = await vetWebhookTarget('https://mixed.example.com/', async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.7', family: 4 }]);
    expect(v).toMatchObject({ ok: false, reason: 'private_address', address: '10.0.0.7' });
  });
  it('a public name is pinned to its vetted address', async () => {
    const v = await vetWebhookTarget('https://hooks.example.com/kv?x=1', PUBLIC);
    expect(v).toMatchObject({ ok: true, host: 'hooks.example.com', path: '/kv?x=1', pinned: { address: '93.184.216.34', family: 4 } });
  });
});

/** A fake https.request: records each call's options and answers with the given status/body, or never answers. */
function fakeRequest(answer: { status: number; body?: Buffer; never?: boolean; headers?: Record<string, string> }) {
  const calls: Array<Record<string, any>> = [];
  const fn: RequestFn = ((options: Record<string, any>, cb: (res: any) => void) => {
    calls.push(options);
    const req: any = new EventEmitter();
    req.destroy = (err?: Error) => { if (err) setImmediate(() => req.emit('error', err)); };
    req.end = () => {
      if (answer.never) return;
      setImmediate(() => {
        const res: any = new EventEmitter();
        res.statusCode = answer.status; res.headers = answer.headers ?? {};
        res.destroy = () => undefined;
        cb(res);
        const body = answer.body ?? Buffer.alloc(0);
        for (let i = 0; i < body.length; i += 16 * 1024) res.emit('data', body.subarray(i, i + 16 * 1024));
        res.emit('end');
      });
    };
    return req;
  }) as unknown as RequestFn;
  return { fn, calls };
}
const TARGET = { host: 'hooks.example.com', port: 443 as const, path: '/kv', pinned: { address: '93.184.216.34', family: 4 as const } };

describe('the pinned transport', () => {
  it('a 307 is answered as itself — ONE request, the Location is never requested', async () => {
    const f = fakeRequest({ status: 307, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    const r = await makePinnedTransport(f.fn)(TARGET, '{}', {});
    expect(r).toMatchObject({ kind: 'response', status: 307 });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].host).toBe('hooks.example.com');
  });
  it('pins the socket to the vetted address; SNI and Host carry the real name; port 443; POST', async () => {
    const f = fakeRequest({ status: 200 });
    await makePinnedTransport(f.fn)(TARGET, '{"a":1}', { 'x-test': '1' });
    const o = f.calls[0];
    expect(o).toMatchObject({ port: 443, method: 'POST', servername: 'hooks.example.com', path: '/kv' });
    expect(o.headers.host).toBe('hooks.example.com');
    const got = await new Promise<any>((res) => o.lookup('evil.rebound.example', {}, (_e: unknown, a: string, fam: number) => res({ a, fam })));
    expect(got).toEqual({ a: '93.184.216.34', fam: 4 });
    const all = await new Promise<any>((res) => o.lookup('evil.rebound.example', { all: true }, (_e: unknown, a: unknown) => res(a)));
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });
  it('reads at most 64 KiB of the response', async () => {
    const f = fakeRequest({ status: 200, body: Buffer.alloc(200 * 1024, 120) });
    const r = await makePinnedTransport(f.fn)(TARGET, '{}', {}) as Extract<TransportResult, { kind: 'response' }>;
    expect(r.truncated).toBe(true);
    expect(r.bodyBytes).toBe(RESPONSE_BODY_CAP_BYTES);
  });
  it('gives up at the timeout with a classified error', async () => {
    const f = fakeRequest({ status: 200, never: true });
    const r = await makePinnedTransport(f.fn, 50)(TARGET, '{}', {});
    expect(r).toMatchObject({ kind: 'error' });
    expect((r as { error: string }).error.startsWith('timeout:')).toBe(true);
  });
});

/* ================================================================================================================================ */
/* PART 2 · real Postgres                                                                                                           */
/* ================================================================================================================================ */
const DB = process.env.WORKER_TEST_DATABASE_URL;
const live = DB ? describe : describe.skip;

live('webhook-delivery job on real Postgres (as kv_relay)', () => {
  let admin: Pool; let relay: PoolClient;
  const tenant = randomUUID(); const creator = randomUUID(); const dev = randomUUID();
  const posts: Array<{ host: string; path: string; body: string; headers: Record<string, string> }> = [];
  let answer: (n: number) => TransportResult = () => ({ kind: 'response', status: 200, durationMs: 3, bodyBytes: 2, truncated: false });
  const transport: Transport = async (t, body, headers) => { posts.push({ host: t.host, path: t.path, body, headers }); return answer(posts.length); };
  const metrics = new WorkerMetrics();
  const run = (job = makeWebhookDeliveryJob({ resolve: PUBLIC, transport })) => job.run({ client: relay, metrics, secrets: { webhookKek: KEK } });

  async function endpoint(url: string, secret = 'whsec_current_secret_value_for_tests_0001', extra: { prev?: string; prevExpires?: string } = {}) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO webhook_endpoints (id, tenant_id, url, secret_enc, secret_hint, event_types, developer_email, created_by, secret_enc_prev, prev_expires_at)
       VALUES ($1, $2, $3, $4, $5, '["order.created"]', 'dev@anandfpo.in', $6, $7, $8::timestamptz)`,
      [id, tenant, url, sealEnvelope(KEK, secret, `webhook_endpoint:${id}`), secret.slice(-3), creator,
       extra.prev ? sealEnvelope(KEK, extra.prev, `webhook_endpoint:${id}`) : null, extra.prevExpires ?? null]);
    return id;
  }
  async function delivery(endpointId: string, body: Record<string, unknown> = { id: 'evt_1_order_created', type: 'order.created', payloadVersion: 1, data: { orderId: 'o1' } }) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, endpoint_kind, event_type, payload, attempt, retry_step, succeeded, state, next_retry_at, payload_version, created_at)
       VALUES ($1, $2, $3, 'tenant', 'order.created', $4::jsonb, 0, 0, false, 'pending', now(), 1, now())`, [id, endpointId, tenant, JSON.stringify(body)]);
    return id;
  }
  const row = async (id: string) => (await admin.query(`SELECT state, attempt, retry_step, status_code, succeeded, last_error, extract(epoch from (next_retry_at - last_attempt_at))::int AS wait FROM webhook_deliveries WHERE id = $1`, [id])).rows[0];
  const attempts = async (id: string) => (await admin.query(`SELECT attempt_no, outcome, status_code, error, signatures FROM webhook_delivery_attempts WHERE delivery_id = $1 ORDER BY attempt_no`, [id])).rows;
  const ep = async (id: string) => (await admin.query(`SELECT status, paused_reason, is_active, secret_enc_prev FROM webhook_endpoints WHERE id = $1`, [id])).rows[0];
  const makeDue = (id: string) => admin.query(`UPDATE webhook_deliveries SET next_retry_at = now() - interval '1 second' WHERE id = $1`, [id]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: DB });
    await admin.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status)
       SELECT $1, $2, 'Anand FPO', 'Anand FPO', lv.id, 'IN', 'active' FROM lookup_values lv WHERE lv.type_code = 'tenant_type' AND lv.code = 'fpo' AND lv.tenant_id IS NULL LIMIT 1`,
      [tenant, 't' + tenant.replace(/-/g, '').slice(0, 20)]);
    for (const [u, email] of [[creator, null], [dev, 'Dev@AnandFPO.in']] as const) {
      await admin.query(`INSERT INTO users (id, phone, full_name, email) VALUES ($1, $2, 'Test User', $3)`, [u, '+9198' + Math.floor(10000000 + Math.random() * 89999999), email]);
      const role = (await admin.query(`SELECT id FROM roles WHERE code = 'tenant_admin'`)).rows[0].id;
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1, $2, $3, true)`, [u, tenant, role]);
    }
    relay = await admin.connect();
    await relay.query('SET ROLE kv_relay');                   // the worker's own role: every grant below is proven, not assumed
  });
  afterAll(async () => {
    await relay?.query('RESET ROLE').catch(() => undefined);
    relay?.release();
    await admin?.end();
  });
  beforeEach(async () => {
    posts.length = 0;
    answer = () => ({ kind: 'response', status: 200, durationMs: 3, bodyBytes: 2, truncated: false });
    // the batch must be ours: every other live endpoint in this TEST database is parked (manual pause) before each case, so a
    // delivery another spec left due can never be POSTed through this spec's transport and miscount
    await admin.query(`UPDATE webhook_endpoints SET status = 'paused', paused_reason = 'manual', paused_at = now() WHERE status = 'active' AND deleted_at IS NULL`);
  });

  it('F-2 · one due row → ONE POST → recorded; a second tick POSTs nothing', async () => {
    const e = await endpoint('https://erp.anandfpo.in/hooks/kv');
    const d = await delivery(e);
    await run();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ host: 'erp.anandfpo.in', path: '/hooks/kv' });
    expect(JSON.parse(posts[0].body)).toMatchObject({ type: 'order.created', data: { orderId: 'o1' } });
    expect(posts[0].headers['Krishalaya-Delivery']).toBe(d);
    expect(verifySignature(posts[0].headers['Krishalaya-Signature'], 'whsec_current_secret_value_for_tests_0001', posts[0].body, Math.floor(Date.now() / 1000))).toBe(true);
    expect(await row(d)).toMatchObject({ state: 'delivered', attempt: 1, status_code: 200, succeeded: true, retry_step: 0 });
    expect(await attempts(d)).toEqual([{ attempt_no: 1, outcome: 'delivered', status_code: 200, error: null, signatures: 1 }]);
    await run();
    expect(posts).toHaveLength(1);                           // the second tick sent NOTHING
  });

  it('the ladder · 1m 5m 30m 2h 12h, then the delivery is exhausted and the ENDPOINT paused + held + notified + audited', async () => {
    const e = await endpoint('https://sheets-bridge.anandfpo.in/milk');
    const d = await delivery(e);
    answer = () => ({ kind: 'response', status: 504, durationMs: 9, bodyBytes: 0, truncated: false });
    const waits: number[] = [];
    for (let i = 1; i <= 5; i++) {
      await run();
      const r = await row(d);
      expect(r).toMatchObject({ state: 'retrying', attempt: i, retry_step: i, status_code: 504 });
      waits.push(r.wait);
      await makeDue(d);
    }
    expect(waits).toEqual([60, 300, 1800, 7200, 43200]);
    const other = await delivery(e, { id: 'evt_2_order_created', type: 'order.created', payloadVersion: 1, data: { orderId: 'o2' } });
    await admin.query(`UPDATE webhook_deliveries SET next_retry_at = now() + interval '1 hour' WHERE id = $1`, [other]);   // queued, not yet due
    await run();
    expect(await row(d)).toMatchObject({ state: 'exhausted', attempt: 6, retry_step: 6, status_code: 504, succeeded: false });
    expect((await attempts(d)).map((a: any) => `${a.attempt_no}:${a.outcome}:${a.status_code}`)).toEqual(['1:failed:504', '2:failed:504', '3:failed:504', '4:failed:504', '5:failed:504', '6:failed:504']);
    expect(await ep(e)).toMatchObject({ status: 'paused', paused_reason: 'exhausted', is_active: false });
    expect((await row(other)).state).toBe('held');
    const ob = (await admin.query(`SELECT payload FROM outbox_events WHERE event_type = 'webhooks.endpoint_paused' AND aggregate_id = $1`, [e])).rows;
    expect(ob).toHaveLength(1);
    expect(ob[0].payload).toMatchObject({ endpointHost: 'sheets-bridge.anandfpo.in', reason: 'exhausted', failures: 6, lastResult: '504', queuedForResume: 2, developerIsMember: true });
    expect([...ob[0].payload.recipientUserIds].sort()).toEqual([creator, dev].sort());
    const au = (await admin.query(`SELECT actor_role, reason, new_value FROM audit_log WHERE entity_id = $1 AND action = 'webhook.paused_by_rail'`, [e])).rows;
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_role: 'system', reason: '6 attempts failed (last: 504) — the retry ladder is exhausted' });
    posts.length = 0;
    await admin.query(`UPDATE webhook_deliveries SET next_retry_at = now() WHERE id = $1 AND state IN ('pending','retrying')`, [other]);
    await run();
    expect(posts).toHaveLength(0);                           // a paused endpoint is never sent to
  });

  it('the guard at SEND time · a name resolving to 169.254.169.254, and a mapped literal → nothing sent, refused, endpoint DISABLED, delivery held', async () => {
    const e1 = await endpoint('https://169.254.169.254.nip.io/x');
    const d1 = await delivery(e1);
    const metadata: Resolver = async (h) => (h.endsWith('nip.io') ? [{ address: '169.254.169.254', family: 4 }] : PUBLIC(h));
    await run(makeWebhookDeliveryJob({ resolve: metadata, transport }));
    expect(posts).toHaveLength(0);
    expect(await row(d1)).toMatchObject({ state: 'held', attempt: 1, succeeded: false });
    expect(await attempts(d1)).toEqual([{ attempt_no: 1, outcome: 'refused', status_code: null, error: 'refused: private_address 169.254.169.254', signatures: 0 }]);
    expect(await ep(e1)).toMatchObject({ status: 'disabled', paused_reason: 'unsafe_target', is_active: false });
    const e2 = await endpoint('https://[::ffff:127.0.0.1]/x');
    const d2 = await delivery(e2);
    await run();
    expect(posts).toHaveLength(0);
    expect((await attempts(d2))[0]).toMatchObject({ outcome: 'refused' });
    expect((await ep(e2)).status).toBe('disabled');
  });

  it('a 307 to an internal host · ONE request through the real pinned transport, failure recorded, the Location never fetched', async () => {
    const e = await endpoint('https://erp2.anandfpo.in/hooks');
    const d = await delivery(e);
    const f = fakeRequest({ status: 307, headers: { location: 'http://169.254.169.254/latest/meta-data/iam' } });
    await run(makeWebhookDeliveryJob({ resolve: PUBLIC, transport: makePinnedTransport(f.fn) }));
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].host).toBe('erp2.anandfpo.in');
    expect(await row(d)).toMatchObject({ state: 'retrying', attempt: 1, status_code: 307 });
    expect((await attempts(d))[0]).toMatchObject({ outcome: 'failed', status_code: 307, error: 'redirect: 307 refused — the Location is never followed' });
  });

  it('rotation · inside the 24 h overlap BOTH v1 values, verifiable with either secret; after it the new secret only, and the old ciphertext is cleared', async () => {
    const e = await endpoint('https://erp3.anandfpo.in/kv', 'whsec_NEW_secret_after_rotation_000000001', { prev: 'whsec_OLD_secret_before_rotation_00000001', prevExpires: new Date(Date.now() + 23 * 3600_000).toISOString() });
    const d1 = await delivery(e);
    await run();
    expect(posts).toHaveLength(1);
    const h1 = posts[0].headers['Krishalaya-Signature'];
    const now = Math.floor(Date.now() / 1000);
    expect(parseSignatureHeader(h1).v1).toHaveLength(2);
    expect(verifySignature(h1, 'whsec_NEW_secret_after_rotation_000000001', posts[0].body, now)).toBe(true);
    expect(verifySignature(h1, 'whsec_OLD_secret_before_rotation_00000001', posts[0].body, now)).toBe(true);
    expect(posts[0].headers['X-KV-Signature']).toBe(h1);
    expect((await attempts(d1))[0].signatures).toBe(2);
    // the window ends
    await admin.query(`UPDATE webhook_endpoints SET prev_expires_at = now() - interval '1 second' WHERE id = $1`, [e]);
    const d2 = await delivery(e);
    await run();
    expect(posts).toHaveLength(2);
    const h2 = posts[1].headers['Krishalaya-Signature'];
    expect(parseSignatureHeader(h2).v1).toHaveLength(1);
    expect(verifySignature(h2, 'whsec_NEW_secret_after_rotation_000000001', posts[1].body, Math.floor(Date.now() / 1000))).toBe(true);
    expect(verifySignature(h2, 'whsec_OLD_secret_before_rotation_00000001', posts[1].body, Math.floor(Date.now() / 1000))).toBe(false);
    expect((await ep(e)).secret_enc_prev).toBeNull();
    expect((await attempts(d2))[0].signatures).toBe(1);
  });

  it('kv_relay holds no DELETE on attempts and cannot delete a young delivery; attempts are append-only', async () => {
    const e = await endpoint('https://erp4.anandfpo.in/kv');
    const d = await delivery(e);
    await run();
    const code = async (sql: string, p: unknown[]) => relay.query('SAVEPOINT s').then(() => relay.query(sql, p)).then(() => relay.query('RELEASE SAVEPOINT s').then(() => 'ok'), async (err) => { await relay.query('ROLLBACK TO SAVEPOINT s'); return err.code; });
    await relay.query('BEGIN');
    try {
      expect(await code(`DELETE FROM webhook_delivery_attempts WHERE delivery_id = $1`, [d])).toBe('42501');
      expect(await code(`UPDATE webhook_delivery_attempts SET status_code = 500 WHERE delivery_id = $1`, [d])).toBe('42501');
      expect(await code(`DELETE FROM webhook_deliveries WHERE id = $1`, [d])).toBe('42501');           // younger than 90 days (trigger)
      expect(await code(`UPDATE webhook_deliveries SET payload = '{}'::jsonb WHERE id = $1`, [d])).toBe('23514');   // payload immutable
    } finally { await relay.query('ROLLBACK'); }
  });

  it('no KEK in the job context → the job refuses to run (never a silent "disabled")', async () => {
    await expect(makeWebhookDeliveryJob({ resolve: PUBLIC, transport }).run({ client: relay, metrics } as any)).rejects.toThrow(/WEBHOOK_SIGNING_KEK/);
  });
});

/* ================================================================================================================================ */
/* RETENTION · 90 days of deliveries (attempts cascade) through the EXISTING retention-enforcer job                                  */
/* ================================================================================================================================ */
import { retentionEnforcerJob, retentionWindow } from '../jobs/retention-enforcer.job';

describe('retention window', () => {
  it('days win over months; a zero window is erasure-scoped (never a time sweep)', () => {
    expect(retentionWindow({ active_months: 3, active_days: 90 })).toBe('90 days');
    expect(retentionWindow({ active_months: 6, active_days: null })).toBe('6 months');
    expect(retentionWindow({ active_months: 0, active_days: null })).toBeNull();   // 0107's users / kyc_documents rules
  });
});

live('retention-enforcer on real Postgres (as kv_relay)', () => {
  let admin: Pool; let relay: PoolClient;
  const tenant = randomUUID();
  beforeAll(async () => {
    admin = new Pool({ connectionString: DB });
    await admin.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status)
       SELECT $1, $2, 'Retention FPO', 'Retention FPO', lv.id, 'IN', 'active' FROM lookup_values lv WHERE lv.type_code = 'tenant_type' AND lv.code = 'fpo' AND lv.tenant_id IS NULL LIMIT 1`,
      [tenant, 't' + tenant.replace(/-/g, '').slice(0, 20)]);
    relay = await admin.connect();
    await relay.query('SET ROLE kv_relay');
  });
  afterAll(async () => { await relay?.query('RESET ROLE').catch(() => undefined); relay?.release(); await admin?.end(); });

  it('the 0191 rule is 90 days; a 91-day delivery and its attempts go, an 89-day one stays; users are never swept', async () => {
    const rule = (await admin.query(`SELECT active_days, action, is_active FROM data_retention_policies WHERE table_name = 'webhook_deliveries'`)).rows[0];
    expect(rule).toEqual({ active_days: 90, action: 'delete', is_active: true });
    const ep = randomUUID();
    await admin.query(`INSERT INTO webhook_endpoints (id, tenant_id, url, secret_enc, secret_hint, event_types, developer_email) VALUES ($1, $2, 'https://old.example.com/x', $3, 'abc', '["order.created"]', 'd@example.com')`,
      [ep, tenant, sealEnvelope(KEK, 'whsec_x_for_retention_tests_000000000000', `webhook_endpoint:${ep}`)]);
    const mk = async (daysAgo: number) => {
      const id = randomUUID();
      const r = await admin.query(`INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, endpoint_kind, event_type, payload, attempt, succeeded, state, next_retry_at, created_at)
        VALUES ($1, $2, $3, 'tenant', 'order.created', '{}'::jsonb, 1, true, 'delivered', NULL, now() - make_interval(days => $4)) RETURNING created_at::text AS c`, [id, ep, tenant, daysAgo]);
      await admin.query(`INSERT INTO webhook_delivery_attempts (tenant_id, delivery_id, delivery_created_at, endpoint_id, endpoint_kind, attempt_no, outcome, status_code, duration_ms, signed_at, signatures)
        VALUES ($1, $2, $3::timestamptz, $4, 'tenant', 1, 'delivered', 200, 5, now(), 1)`, [tenant, id, r.rows[0].c, ep]);
      return id;
    };
    const old = await mk(91); const young = await mk(89);
    const users = (await admin.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n;
    const metrics = new WorkerMetrics();
    await retentionEnforcerJob.run({ client: relay, metrics });
    const left = async (id: string) => (await admin.query(`SELECT (SELECT count(*)::int FROM webhook_deliveries WHERE id = $1) AS d, (SELECT count(*)::int FROM webhook_delivery_attempts WHERE delivery_id = $1) AS a`, [id])).rows[0];
    expect(await left(old)).toEqual({ d: 0, a: 0 });
    expect(await left(young)).toEqual({ d: 1, a: 1 });
    expect((await admin.query(`SELECT count(*)::int AS n FROM users`)).rows[0].n).toBe(users);
    expect(metrics.render()).toContain('kv_retention_skipped{reason="erasure_scoped",table="users"} 1');
  });
});
