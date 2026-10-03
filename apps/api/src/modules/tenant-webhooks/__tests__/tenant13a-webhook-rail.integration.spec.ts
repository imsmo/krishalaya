// modules/tenant-webhooks/__tests__/tenant13a-webhook-rail.integration.spec.ts · PC-56 TENANT-13a — LIVE proof against real Postgres + RLS
// (no infra mocks; the DNS resolver is injected so the guard's verdict is deterministic). Each block fails on HEAD c0250c1:
//   CATALOGUE  a REAL `orders.order_created` outbox row (written by the Order entity + the outbox writer, exactly as order.service flushes
//              it) fans out — on the relay connection AS kv_relay — to a projected, PII-free `order.created` delivery (F-1: before, no
//              handler was registered for any type the platform emits);
//   HELD       a paused endpoint's event is recorded `held`, not dropped; resume re-queues it in creation order;
//   REPLAY     one exhausted delivery → pending (original payload, replay counted, audited); replay-failed re-queues the failed set;
//   SECRET     shown once (the idempotency record never holds it), envelope-encrypted bound to the row, hint stored apart; rotation keeps
//              the old secret for 24 h and refuses a second rotation inside the window;
//   GUARD      a name resolving to the metadata address is refused at registration (nothing written); the review prints the verdict;
//   DELETE     soft (F-6): deleted_at + who + why, reads filter it, open deliveries cancelled; kv_app still holds no DELETE;
//   GATE       `api.manage` (tenant_admin only) on every read AND write; the controller declares it; staff with tenant.settings-era
//              permissions are refused (F-12);
//   PARTNER    a partner delivery under the same tenant_id is invisible to the tenant realm — RLS AND the join (F-19);
//   PAGING     deliveries written microseconds apart page exactly once (µs keyset);
//   WALLS      kv_app: no INSERT on deliveries, no SELECT on partner_webhook_endpoints, no UPDATE of url, developer_email required;
//              tenant_flag_context is invoker-rights (another tenant's plan is invisible);
//   LOG        the list names attempts, HTTP, the ladder step of the next retry; the diagnosis is computed from attempt rows; the
//              payload viewer masks PII.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PERMISSIONS_KEY } from '../../../core/auth/permissions.guard';
import { OutboxEvent } from '../../../core/outbox/event-envelope';
import { TxContext } from '../../../core/database/unit-of-work';
import { DEV_ONLY_KEK_HEX, openEnvelope } from '../../../core/secrets/secret-envelope';
import { uuidv7 } from '../../../core/database/uuid.util';
import { decodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { Order } from '../../orders/domain/order.entity';
import { WebhookRepository } from '../repositories/webhook.repository';
import { TenantWebhookService, WebhooksActor } from '../services/tenant-webhook.service';
import { WebhookDeliveryLogService } from '../services/webhook-delivery-log.service';
import { WebhooksController } from '../controllers/v1/webhooks.controller';
import { WebhookFanoutHandler } from '../events/handlers/webhook-fanout.handler';
import { CATALOGUE_INTERNAL_TYPES } from '../domain/webhook-catalog';
import { Resolver } from '../domain/webhook-ssrf';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const key = () => `idem-${randomUUID()}`;
const IP = '10.0.13.13';
const resolver: Resolver = async (host) => (host.endsWith('nip.io') ? [{ address: '169.254.169.254', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]);

run('PC-56 TENANT-13a · webhooks & the delivery rail (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let replica: PgReadReplicaProvider; let outbox: PgOutboxWriter;
  let svc: TenantWebhookService; let log: WebhookDeliveryLogService; let repo: WebhookRepository;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const adminU = randomUUID(); const staff = randomUUID(); const adminB = randomUUID();
  const actors: Record<string, WebhooksActor> = {};
  let E1 = ''; let E1secret = '';

  const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));
  const refusals = (p: Promise<unknown>) => p.then(() => [], (e: any) => (e?.details?.refusals ?? []).map((r: any) => `${r.field ?? '*'}:${r.code}`));
  const permsOf = async (role: string) => new Set((await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [role])).rows.map((x: { permission_code: string }) => x.permission_code));
  const addRole = async (u: string, role: string, tenant: string) => {
    const r = (await admin.query(`SELECT id FROM roles WHERE code = $1`, [role])).rows[0].id;
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [u, tenant, r]);
  };
  const deliveriesOf = async (endpointId: string) => (await admin.query(`SELECT id, state, event_type, payload, internal_type, source_event_id, endpoint_kind FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY created_at, id`, [endpointId])).rows;

  /** One relay pass for ONE outbox row, exactly as OutboxDispatcher.relayOne runs handlers — AS kv_relay, the tenant set, in one tx. */
  async function relay(outboxId: string) {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET ROLE kv_relay');
      await c.query('BEGIN');
      const row = (await c.query(`SELECT id, tenant_id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events WHERE id = $1 FOR UPDATE`, [outboxId])).rows[0];
      const event: OutboxEvent = { id: String(row.id), tenantId: row.tenant_id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, eventType: row.event_type, payload: row.payload };
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [event.tenantId ?? '']);
      const tx: TxContext = { query: (sql, params) => c.query(sql, params as any) as any, tenantId: event.tenantId ?? '', userId: 'system' };
      for (const t of CATALOGUE_INTERNAL_TYPES.filter((x) => x === event.eventType)) await new WebhookFanoutHandler(t, repo).handle(event, tx);
      await c.query(`UPDATE outbox_events SET status = 'published', published_at = now() WHERE id = $1`, [row.id]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; }
    finally { await c.query('RESET ROLE').catch(() => undefined); c.release(); }
  }

  /** A real `orders.order_created` row: the Order entity's own event, flushed by the outbox writer as order.service does. */
  async function placeOrder(tenantId: string): Promise<{ orderId: string; outboxId: string }> {
    const orderId = randomUUID();
    const o = Order.place({ id: orderId, tenantId, orderNo: `ORD-${orderId.slice(0, 8)}`, checkoutGroupId: null, buyerUserId: staff, sellerUserId: adminU, source: 'marketplace',
      currencyCode: 'INR', items: [], deliveryFeeMinor: 125000n, deliveryMethodId: null, deliveryAddressId: null, requiresPayment: false });
    const events = o.pullEvents();
    expect(events.map((e) => e.type)).toContain('orders.order_created');
    await uow.run(tenantId, async (tx) => {
      for (const e of events) await outbox.write(tx, { tenantId, aggregateType: 'order', aggregateId: orderId, eventType: e.type, payload: { v: 1, ...e.payload } });
    });
    const id = (await admin.query(`SELECT id::text FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'orders.order_created'`, [orderId])).rows[0].id;
    return { orderId, outboxId: id };
  }

  async function asApp<T>(tenantId: string, fn: (probe: (sql: string, p?: unknown[]) => Promise<string>, c: PoolClient) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_app'); await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const probe = async (sql: string, p: unknown[] = []) => {
        await c.query('SAVEPOINT p');
        try { await c.query(sql, p); await c.query('RELEASE SAVEPOINT p'); return 'ok'; } catch (e) { await c.query('ROLLBACK TO SAVEPOINT p'); return (e as { code?: string }).code ?? 'error'; }
      };
      return await fn(probe, c);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'Other FPO');
    for (const u of [adminU, staff, adminB]) await makeUser(admin, u as ReturnType<typeof randomUUID>);
    await admin.query(`UPDATE users SET email = 'dev@anandfpo.in' WHERE id = $1`, [adminU]);
    await addRole(adminU, 'tenant_admin', tenantA); await addRole(staff, 'tenant_staff', tenantA); await addRole(adminB, 'tenant_admin', tenantB);
    actors[adminU] = { userId: adminU, permissions: await permsOf('tenant_admin'), ip: IP, requestId: null };
    actors[staff] = { userId: staff, permissions: new Set([...(await permsOf('tenant_staff')), 'tenant.settings']), ip: IP, requestId: null };
    actors[adminB] = { userId: adminB, permissions: await permsOf('tenant_admin'), ip: IP, requestId: null };
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards); replica = new PgReadReplicaProvider(pools, shards); outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools); const audit = new AuditWriter(pools); const metrics = new PromMetrics();
    repo = new WebhookRepository(replica as never);
    svc = new TenantWebhookService(uow, idem, metrics, audit, repo, config, resolver);
    log = new WebhookDeliveryLogService(uow, idem, audit, repo);
  }, 120_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status = 'published', published_at = now() WHERE status = 'pending' AND tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined);
    await pools?.onModuleDestroy(); await admin?.end();
  });

  it('GATE · api.manage is tenant_admin\'s alone, declared on the controller, and judged on every read AND write', async () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, WebhooksController)).toEqual(['api.manage']);
    const holders = (await admin.query(`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'api.manage' ORDER BY 1`)).rows.map((x: any) => x.code);
    expect(holders).toEqual(['tenant_admin']);
    expect(actors[staff].permissions.has('tenant.settings')).toBe(true);           // the old gate — no longer enough
    expect(await codeOf(svc.list(tenantA, actors[staff]))).toBe('WEBHOOKS_FORBIDDEN');
    expect(await codeOf(svc.register(tenantA, actors[staff], key(), { url: 'https://erp.anandfpo.in/hooks/kv', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' }))).toBe('WEBHOOKS_FORBIDDEN');
    expect(await codeOf(log.list(tenantA, actors[staff], { filter: { status: 'all' }, limit: 25 }))).toBe('WEBHOOKS_FORBIDDEN');
  });

  it('GUARD · a name resolving to 169.254.169.254 is refused at registration and nothing is written; the review prints the verdict', async () => {
    const pv = await svc.preview(tenantA, actors[adminU], { url: 'https://169.254.169.254.nip.io/x', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' });
    expect(pv).toMatchObject({ ready: false, url: { verdict: 'refused', reason: 'private_address' } });
    expect(await refusals(svc.register(tenantA, actors[adminU], key(), { url: 'https://169.254.169.254.nip.io/x', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' }))).toEqual(['url:URL_PRIVATE_ADDRESS']);
    expect(await refusals(svc.register(tenantA, actors[adminU], key(), { url: 'https://[::ffff:127.0.0.1]/x', eventTypes: ['orders.order_created'], developerEmail: '' }))).toEqual(['url:URL_PRIVATE_ADDRESS', 'eventTypes:EVENT_UNKNOWN', 'developerEmail:EMAIL_REQUIRED']);
    expect((await admin.query(`SELECT count(*)::int AS n FROM webhook_endpoints WHERE tenant_id = $1`, [tenantA])).rows[0].n).toBe(0);
    const good = await svc.preview(tenantA, actors[adminU], { url: 'https://erp.anandfpo.in/hooks/kv', eventTypes: ['order.created', 'payout.completed'], developerEmail: 'dev@anandfpo.in' });
    expect(good).toMatchObject({ ready: true, url: { verdict: 'public', addresses: ['93.184.216.34'] }, events: [{ name: 'order.created', payloadVersion: 1 }, { name: 'payout.completed', payloadVersion: 1 }] });
  });

  it('SECRET · shown ONCE; never in the idempotency record; envelope-encrypted bound to the row; the hint stored apart; audited without it', async () => {
    const k = key();
    const r1 = await svc.register(tenantA, actors[adminU], k, { url: 'https://erp.anandfpo.in/hooks/kv', eventTypes: ['order.created', 'payout.completed'], developerEmail: 'dev@anandfpo.in' });
    expect(r1).toMatchObject({ status: 'active', secretShown: true, developerEmail: 'dev@anandfpo.in' });
    expect(r1.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    E1 = r1.id; E1secret = r1.secret!;
    expect(r1.secretHint).toBe(E1secret.slice(-3));
    const r2 = await svc.register(tenantA, actors[adminU], k, { url: 'https://erp.anandfpo.in/hooks/kv', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' });
    expect(r2).toMatchObject({ id: E1, secret: null, secretShown: false });                // the key replays; the secret is NOT shown again
    const idemRows = (await admin.query(`SELECT response_body::text AS b FROM idempotency_keys WHERE key LIKE $1`, [`%::webhooks.register::${k}`])).rows;
    expect(idemRows).toHaveLength(1);
    expect(idemRows[0].b).not.toContain(E1secret);
    const row = (await admin.query(`SELECT secret_enc, secret_hash, secret_hint, status, is_active, developer_email, created_by FROM webhook_endpoints WHERE id = $1`, [E1])).rows[0];
    expect(row).toMatchObject({ secret_hash: null, secret_hint: E1secret.slice(-3), status: 'active', is_active: true, created_by: adminU });
    expect(row.secret_enc).toMatch(/^v2\./);
    expect(row.secret_enc).not.toContain(E1secret);
    expect(openEnvelope(Buffer.from(DEV_ONLY_KEK_HEX, 'hex'), row.secret_enc, `webhook_endpoint:${E1}`)).toBe(E1secret);
    expect(() => openEnvelope(Buffer.from(DEV_ONLY_KEK_HEX, 'hex'), row.secret_enc, `webhook_endpoint:${randomUUID()}`)).toThrow();
    const au = (await admin.query(`SELECT new_value::text AS v, host(ip) AS ip FROM audit_log WHERE entity_id = $1 AND action = 'webhook.registered'`, [E1])).rows;
    expect(au).toHaveLength(1);
    expect(au[0].v).not.toContain(E1secret);
    expect(au[0].ip).toBe(IP);
    const list = await svc.list(tenantA, actors[adminU]);
    expect(list.total).toBe(1);
    expect(JSON.stringify(list)).not.toContain(row.secret_enc);
    expect(list.items[0]).toMatchObject({ id: E1, host: 'erp.anandfpo.in', status: 'active', secretHint: E1secret.slice(-3), stats: { attempts7d: 0, successBp7d: null, delivered7d: 0 } });
    expect(list.contract).toMatchObject({ ladder: ['1m', '5m', '30m', '2h', '12h'], attemptsPerCycle: 6, rotationOverlapHours: 24, retentionDays: 90, secretStorage: 'encrypted_at_rest_shown_once' });
  });

  it('CATALOGUE · a REAL orders.order_created outbox row fans out (as kv_relay) to a projected, PII-free order.created delivery', async () => {
    const { orderId, outboxId } = await placeOrder(tenantA);
    await relay(outboxId);
    const ds = await deliveriesOf(E1);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ state: 'pending', event_type: 'order.created', internal_type: 'orders.order_created', source_event_id: outboxId, endpoint_kind: 'tenant' });
    expect(ds[0].payload).toMatchObject({ id: `evt_${outboxId}_order_created`, type: 'order.created', payloadVersion: 1, data: { orderId, status: 'created', totalMinor: '125000', buyerUserId: staff, sellerUserId: adminU } });
    expect(Object.keys(ds[0].payload.data).sort()).toEqual(['buyerUserId', 'discountMinor', 'orderId', 'sellerUserId', 'status', 'totalMinor']);
    // tenant B's endpoints never hear tenant A's events
    const rb = await svc.register(tenantB, actors[adminB], key(), { url: 'https://erp.otherfpo.in/kv', eventTypes: ['order.created'], developerEmail: 'it@otherfpo.in' });
    const { outboxId: o2 } = await placeOrder(tenantA);
    await relay(o2);
    expect(await deliveriesOf(rb.id)).toHaveLength(0);
    expect(await deliveriesOf(E1)).toHaveLength(2);
  });

  it('HELD · a paused endpoint\'s event is recorded held (never dropped); resume re-queues held + exhausted in creation order', async () => {
    const pv = await svc.previewAct(tenantA, actors[adminU], E1, 'pause', 'ERP maintenance window tonight');
    expect(pv).toMatchObject({ allowed: true, effect: { holds: 2 } });
    expect(await refusals(svc.act(tenantA, actors[adminU], E1, 'pause', key(), ''))).toEqual(['reason:REASON_REQUIRED']);
    const p = await svc.act(tenantA, actors[adminU], E1, 'pause', key(), 'ERP maintenance window tonight');
    expect(p).toMatchObject({ status: 'paused', moved: 2 });
    const { outboxId } = await placeOrder(tenantA);
    await relay(outboxId);
    const ds = await deliveriesOf(E1);
    expect(ds.map((d: any) => d.state)).toEqual(['held', 'held', 'held']);
    expect((await admin.query(`SELECT next_retry_at FROM webhook_deliveries WHERE endpoint_id = $1 AND next_retry_at IS NOT NULL`, [E1])).rows).toHaveLength(0);
    const au = (await admin.query(`SELECT reason, old_value, new_value FROM audit_log WHERE entity_id = $1 AND action = 'webhook.paused'`, [E1])).rows;
    expect(au[0]).toMatchObject({ reason: 'ERP maintenance window tonight', new_value: { status: 'paused', pausedReason: 'manual', held: 2 } });
    // the worker exhausted one before the pause (simulated as the worker would leave it)
    await admin.query(`UPDATE webhook_deliveries SET state = 'exhausted', attempt = 6, retry_step = 6, status_code = 504 WHERE id = $1`, [ds[0].id]);
    const r = await svc.act(tenantA, actors[adminU], E1, 'resume', key(), 'ERP is back up');
    expect(r).toMatchObject({ status: 'active', moved: 3 });
    const after = (await admin.query(`SELECT state, retry_step, next_retry_at FROM webhook_deliveries WHERE endpoint_id = $1 ORDER BY next_retry_at, created_at, id`, [E1])).rows;
    expect(after.map((d: any) => `${d.state}:${d.retry_step}`)).toEqual(['pending:0', 'pending:0', 'pending:0']);
    expect(new Set(after.map((d: any) => d.next_retry_at.toISOString())).size).toBe(1);   // one instant → the worker's ORDER BY sends them in creation order
  });

  it('REPLAY · one exhausted delivery → pending (original payload, counted, audited); replay-failed re-queues the failed set', async () => {
    const ds = await deliveriesOf(E1);
    await admin.query(`UPDATE webhook_deliveries SET state = 'exhausted', next_retry_at = NULL, attempt = 6, retry_step = 6, status_code = 504 WHERE endpoint_id = $1`, [E1]);
    const pv = await log.previewReplay(tenantA, actors[adminU], ds[0].id, undefined);
    expect(pv).toMatchObject({ allowed: true, delivery: { state: 'exhausted', statusCode: 504 } });
    const rp = await log.replay(tenantA, actors[adminU], ds[0].id, key(), 'receiver fixed the 504');
    expect(rp).toEqual({ id: ds[0].id, state: 'pending' });
    const one = (await admin.query(`SELECT state, retry_step, replay_count, replayed_by, payload FROM webhook_deliveries WHERE id = $1`, [ds[0].id])).rows[0];
    expect(one).toMatchObject({ state: 'pending', retry_step: 0, replay_count: 1, replayed_by: adminU });
    expect(one.payload).toEqual(ds[0].payload);                                                // the ORIGINAL payload
    expect((await admin.query(`SELECT reason FROM audit_log WHERE entity_id = $1 AND action = 'webhook.delivery_replayed'`, [ds[0].id])).rows[0].reason).toBe('receiver fixed the 504');
    expect(await refusals(log.replay(tenantA, actors[adminU], ds[0].id, key(), 'again please'))).toEqual(['*:STATE_NOT_REPLAYABLE']);
    const rf = await svc.act(tenantA, actors[adminU], E1, 'replay-failed', key(), 'replay the rest');
    expect(rf.moved).toBe(2);
    expect((await deliveriesOf(E1)).every((d: any) => d.state === 'pending')).toBe(true);
  });

  it('SECRET · rotation keeps the old secret for 24 h, returns the new one once, refuses a second rotation inside the window', async () => {
    const before = (await admin.query(`SELECT secret_enc FROM webhook_endpoints WHERE id = $1`, [E1])).rows[0].secret_enc;
    const r = await svc.rotate(tenantA, actors[adminU], E1, key(), 'quarterly rotation');
    expect(r.secretShown).toBe(true);
    expect(r.secret).not.toBe(E1secret);
    const row = (await admin.query(`SELECT secret_enc, secret_enc_prev, secret_hint, extract(epoch from (prev_expires_at - now()))::int AS left FROM webhook_endpoints WHERE id = $1`, [E1])).rows[0];
    expect(row.secret_enc_prev).toBe(before);
    expect(row.secret_hint).toBe(r.secret!.slice(-3));
    expect(row.left).toBeGreaterThan(24 * 3600 - 120);
    expect(row.left).toBeLessThanOrEqual(24 * 3600);
    expect(openEnvelope(Buffer.from(DEV_ONLY_KEK_HEX, 'hex'), row.secret_enc, `webhook_endpoint:${E1}`)).toBe(r.secret);
    expect(await refusals(svc.rotate(tenantA, actors[adminU], E1, key(), 'again'))).toEqual(['*:ROTATION_OVERLAP_LIVE']);
    const au = (await admin.query(`SELECT reason, new_value::text AS v FROM audit_log WHERE entity_id = $1 AND action = 'webhook.secret_rotated'`, [E1])).rows;
    expect(au[0].reason).toBe('quarterly rotation');
    expect(au[0].v).not.toContain(r.secret!);
    const listed = (await svc.list(tenantA, actors[adminU])).items[0];
    expect(listed.previousSecretSignsUntil).not.toBeNull();
  });

  it('LOG · attempts counted, HTTP and the ladder step named; the diagnosis computed from attempt rows; the payload viewer masks PII', async () => {
    const ds = await deliveriesOf(E1);
    const c = (await admin.query(`SELECT created_at::text AS c FROM webhook_deliveries WHERE id = $1`, [ds[0].id])).rows[0].c;
    for (let n = 1; n <= 3; n++) {
      await admin.query(`INSERT INTO webhook_delivery_attempts (tenant_id, delivery_id, delivery_created_at, endpoint_id, endpoint_kind, attempt_no, outcome, status_code, duration_ms, signed_at, signatures)
        VALUES ($1, $2, $3::timestamptz, $4, 'tenant', $5, 'failed', 504, 10000, now(), 1)`, [tenantA, ds[0].id, c, E1, n]);
    }
    await admin.query(`UPDATE webhook_deliveries SET state = 'retrying', attempt = 3, retry_step = 3, status_code = 504, next_retry_at = now() + interval '30 minutes', last_attempt_at = now() WHERE id = $1`, [ds[0].id]);
    const page = await log.list(tenantA, actors[adminU], { filter: { status: 'failed', endpointId: E1 }, limit: 25 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: ds[0].id, eventType: 'order.created', attempts: 3, statusCode: 504, state: 'retrying', nextRetryStep: '30m', endpointHost: 'erp.anandfpo.in' });
    expect(page).toMatchObject({ failed: 1, retentionDays: 90 });
    expect(page.diagnosis).toMatchObject({ failures: 3, codes: [{ code: '504', count: 3 }], endpoints: [{ id: E1, host: 'erp.anandfpo.in', count: 3 }], singleCause: true });
    // a legacy-shaped payload carrying PII is masked in the viewer
    const legacy = uuidv7();                                                          // delivery ids are v7 (point lookups prune by them)
    await admin.query(`INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, endpoint_kind, event_type, payload, attempt, succeeded, state, next_retry_at)
      VALUES ($1, $2, $3, 'tenant', 'order.created', $4::jsonb, 0, false, 'held', NULL)`, [legacy, E1, tenantA, JSON.stringify({ data: { orderId: 'o9', buyer_phone: '+919811111111', farmerName: 'Ramesh Patel' } })]);
    const one = await log.get(tenantA, actors[adminU], legacy);
    expect(one.masked).toBe(true);
    expect(JSON.stringify(one.payload)).not.toContain('9811111111');
    expect(JSON.stringify(one.payload)).not.toContain('Ramesh');
    expect((one.payload as any).data.orderId).toBe('o9');
    expect((await log.get(tenantA, actors[adminU], ds[0].id)).attemptsList.map((a) => `${a.attemptNo}:${a.outcome}:${a.statusCode}`)).toEqual(['1:failed:504', '2:failed:504', '3:failed:504']);
  });

  it('PARTNER · a partner delivery under the SAME tenant_id never surfaces in the tenant realm (RLS and the join)', async () => {
    const partnerEndpoint = randomUUID(); const pd = uuidv7();
    await admin.query(`INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, endpoint_kind, event_type, payload, attempt, succeeded, state, next_retry_at)
      VALUES ($1, $2, $3, 'partner', 'fintech.loan_repaid', '{"data":{"loanId":"l1"}}'::jsonb, 0, false, 'pending', now())`, [pd, partnerEndpoint, tenantA]);
    const page = await log.list(tenantA, actors[adminU], { filter: { status: 'all' }, limit: 100 });
    expect(page.items.map((i) => i.id)).not.toContain(pd);
    expect(await codeOf(log.get(tenantA, actors[adminU], pd))).toBe('WEBHOOK_DELIVERY_NOT_FOUND');
    await asApp(tenantA, async (_probe, c) => {
      expect((await c.query(`SELECT count(*)::int AS n FROM webhook_deliveries WHERE endpoint_kind = 'partner'`)).rows[0].n).toBe(0);
      expect((await c.query(`SELECT count(*)::int AS n FROM webhook_deliveries WHERE id = $1`, [pd])).rows[0].n).toBe(0);
    });
    await admin.query(`UPDATE webhook_deliveries SET state = 'cancelled', next_retry_at = NULL WHERE id = $1`, [pd]);
  });

  it('PAGING · deliveries written microseconds apart page exactly once (µs keyset)', async () => {
    const ep = (await svc.register(tenantA, actors[adminU], key(), { url: 'https://paging.anandfpo.in/kv', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' })).id;
    const base = (await admin.query(`SELECT date_trunc('second', now()) AS t`)).rows[0].t as Date;
    const ids: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const id = uuidv7(); ids.push(id);
      await admin.query(`INSERT INTO webhook_deliveries (id, endpoint_id, tenant_id, endpoint_kind, event_type, payload, attempt, succeeded, state, next_retry_at, created_at)
        VALUES ($1, $2, $3, 'tenant', 'order.created', '{}'::jsonb, 0, false, 'held', NULL, $4::timestamptz + make_interval(secs => $5::double precision / 1000000))`, [id, ep, tenantA, base.toISOString(), 123400 + i]);
    }
    const seen: string[] = []; let cursor: string | null = null; let pages = 0;
    do {
      const p = await log.list(tenantA, actors[adminU], { filter: { endpointId: ep, status: 'all' }, cursor: decodeKeyset(cursor, UUID_RE), limit: 2 });
      seen.push(...p.items.map((i) => i.id)); cursor = p.nextCursor; pages++;
    } while (cursor && pages < 10);
    expect(seen.sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(7);
  });

  it('DELETE · soft: who and why recorded, reads filter it, open deliveries cancelled; kv_app still holds no DELETE', async () => {
    const ep = (await svc.register(tenantA, actors[adminU], key(), { url: 'https://old.anandfpo.in/kv', eventTypes: ['order.created'], developerEmail: 'dev@anandfpo.in' })).id;
    const { outboxId } = await placeOrder(tenantA);
    await relay(outboxId);
    expect((await deliveriesOf(ep)).map((d: any) => d.state)).toEqual(['pending']);
    expect((await svc.previewAct(tenantA, actors[adminU], ep, 'delete', 'decommissioned')).effect.cancels).toBe(1);
    const d = await svc.act(tenantA, actors[adminU], ep, 'delete', key(), 'old ERP decommissioned');
    expect(d).toMatchObject({ status: 'deleted', moved: 1 });
    const row = (await admin.query(`SELECT deleted_at IS NOT NULL AS gone, deleted_by, delete_reason, is_active FROM webhook_endpoints WHERE id = $1`, [ep])).rows[0];
    expect(row).toEqual({ gone: true, deleted_by: adminU, delete_reason: 'old ERP decommissioned', is_active: false });
    expect((await deliveriesOf(ep)).map((x: any) => x.state)).toEqual(['cancelled']);
    expect((await svc.list(tenantA, actors[adminU])).items.map((i) => i.id)).not.toContain(ep);
    expect(await codeOf(svc.act(tenantA, actors[adminU], ep, 'resume', key(), 'undo'))).toBe('WEBHOOK_REFUSED');
    const { outboxId: o2 } = await placeOrder(tenantA);
    await relay(o2);
    expect(await deliveriesOf(ep)).toHaveLength(1);                                   // a deleted endpoint receives nothing new
    await asApp(tenantA, async (probe) => {
      expect(await probe(`DELETE FROM webhook_endpoints WHERE id = $1`, [ep])).toBe('42501');
      expect(await probe(`UPDATE webhook_endpoints SET status = 'active' WHERE id = $1`, [ep])).toBe('23514');   // deleted is final (trigger)
    });
  });

  it('WALLS · kv_app: no INSERT on deliveries, no partner secrets, no URL edits, developer_email required; tenant_flag_context is invoker-rights', async () => {
    for (const [t, plan] of [[tenantA, 'growth'], [tenantB, 'professional']] as const) {
      await admin.query(`INSERT INTO subscriptions (tenant_id, plan_id, status, billing_cycle, price_minor, currency_code, current_period_start, current_period_end)
        SELECT $1, id, 'active', 'monthly', 0, 'INR', current_date, current_date + 30 FROM plans WHERE code = $2`, [t, plan]);
    }
    await asApp(tenantA, async (probe, c) => {
      expect(await probe(`INSERT INTO webhook_deliveries (endpoint_id, tenant_id, endpoint_kind, event_type, payload, state, next_retry_at) VALUES ($1, $2, 'tenant', 'order.created', '{}'::jsonb, 'pending', now())`, [E1, tenantA])).toBe('42501');
      expect(await probe(`SELECT secret_enc FROM partner_webhook_endpoints LIMIT 1`)).toBe('42501');
      expect(await probe(`SELECT * FROM webhook_delivery_targets LIMIT 1`)).toBe('42501');
      expect(await probe(`UPDATE webhook_endpoints SET url = 'https://evil.example.com/' WHERE id = $1`, [E1])).toBe('42501');
      expect(await probe(`INSERT INTO webhook_endpoints (tenant_id, url, secret_enc, secret_hint, event_types) VALUES ($1, 'https://x.example.com/', 'v2.00000000.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbb', 'abc', '[]')`, [tenantA])).toBe('23502');
      expect(await probe(`INSERT INTO webhook_delivery_attempts (tenant_id, delivery_id, delivery_created_at, endpoint_id, endpoint_kind, attempt_no, outcome, duration_ms, error) VALUES ($1, $2, now(), $3, 'tenant', 1, 'refused', 0, 'x')`, [tenantA, randomUUID(), E1])).toBe('42501');
      // tenant B is on `professional`; under invoker rights kv_app (in tenant A's context) can no longer read B's plan
      expect((await c.query(`SELECT plan_code FROM tenant_flag_context WHERE tenant_id = $1`, [tenantB])).rows[0]?.plan_code ?? null).toBeNull();
      expect((await c.query(`SELECT plan_code FROM tenant_flag_context WHERE tenant_id = $1`, [tenantA])).rows[0].plan_code).toBe('growth');
    });
    expect((await admin.query(`SELECT plan_code FROM tenant_flag_context WHERE tenant_id = $1`, [tenantB])).rows[0].plan_code).toBe('professional');
    const v = (await admin.query(`SELECT reloptions FROM pg_class WHERE relname = 'tenant_flag_context'`)).rows[0].reloptions;
    expect(v).toContain('security_invoker=true');
  });

  it('NOTICE · the pause notice is catalogued, mapped and templated (email + in-app × en / hi / gu)', async () => {
    expect((await admin.query(`SELECT default_channels FROM notification_events WHERE code = 'webhooks.endpoint_paused'`)).rows[0].default_channels).toEqual(['email', 'inapp']);
    const t = (await admin.query(`SELECT channel || ':' || language_code AS k FROM notification_templates WHERE event_code = 'webhooks.endpoint_paused' AND tenant_id IS NULL ORDER BY 1`)).rows.map((x: any) => x.k);
    expect(t).toEqual(['email:en', 'email:gu', 'email:hi', 'inapp:en', 'inapp:gu', 'inapp:hi']);
    const rule = (await admin.query(`SELECT active_days, action FROM data_retention_policies WHERE table_name = 'webhook_deliveries'`)).rows[0];
    expect(rule).toEqual({ active_days: 90, action: 'delete' });
  });
});
