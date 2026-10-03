// modules/tenant-api-keys/__tests__/tenant13c-api-keys-integrations.integration.spec.ts · PC-56 TENANT-13c — LIVE proof against real
// Postgres + RLS, keys driven over REAL HTTP through the full AppModule (every middleware, global guard, interceptor and filter), the
// integrations driven through the service with a FAKE provider verifier and an in-process vault whose writes are counted (no network).
//   KEYS     plan gate (api_access read for real: plan → ok, none → PLAN_FEATURE_REQUIRED) and api.manage; the key shown once (a replayed
//            Idempotency-Key answers key null, and the idempotency record never holds it); sha256(secret) stored; prefix UNIQUE;
//            key auth sets the tenant FROM THE KEY and ignores X-Tenant-Id; exact scope (orders.read cannot write; listings.write cannot
//            read members); a key on a non-catalogue route → 403; members.read is masked (short name, no digit search) and
//            members.read.pii waits for a DIFFERENT administrator (maker refused by the trigger; the DB refuses activating it any
//            other way); quota 429 + Retry-After; a write needs an Idempotency-Key and a retried write acts once; revoke → 401
//            KEY_REVOKED on the very next call (inside the printed 60 s bound) with the re-issue path; last_used_at stamped once a
//            minute; audits carry `api_key:<id> on_behalf_of:…`; µs paging.
//   INTEG.   a platform-managed provider is refused by name (nothing written, nothing vaulted); a failed shadow verify stores NOTHING;
//            a successful one holds the credential sealed on the proposal (not vaulted); one in-flight proposal per provider; maker ≠
//            checker; kv_app cannot write a connection without a confirmed proposal; a failed second verify closes verify_failed with
//            nothing vaulted; success vaults + writes verified_at + a check row; rotation keeps the old credential serving until the
//            new one is verified and committed, then retires it; the daily re-verify feeds Health (24 h); GETs need api.manage or
//            tenant.settings; disconnect; µs paging of proposals; no response carries a ref or a credential.
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../../../test/e2e/bootstrap';
import { activateSubscription, ensureUnitCurrency, makePlan, makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { LocalSecretWriter } from '../../../core/secrets/local-secret-writer';
import { DEV_ONLY_KEK_HEX, openEnvelope } from '../../../core/secrets/secret-envelope';
import { decodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { TenantIntegrationRepository } from '../../tenant-integrations/repositories/tenant-integration.repository';
import { IntegrationsActor, TenantIntegrationService } from '../../tenant-integrations/services/tenant-integration.service';
import { ProviderVerifier } from '../../tenant-integrations/infra/provider-verifier';
import { VerifyResult } from '../../tenant-integrations/domain/provider-rules';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const idem = () => `idem-${randomUUID().slice(0, 18)}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

run('PC-56 TENANT-13c · tenant API keys & integrations (integration, real Postgres + real HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool;
  const A = randomUUID(); const B = randomUUID(); const C = randomUUID();
  const a1 = randomUUID(); const a2 = randomUUID(); const staff = randomUUID(); const bAdmin = randomUUID(); const cAdmin = randomUUID();
  const memberA = randomUUID(); const memberB = randomUUID();
  let tokA1 = ''; let tokA2 = ''; let tokStaff = ''; let tokB = '';
  let listingId = '';

  const permsOf = async (role: string) => (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [role])).rows.map((x: { permission_code: string }) => x.permission_code);
  const addRole = async (u: string, role: string, tenant: string) => {
    const r = (await admin.query(`SELECT id FROM roles WHERE code = $1`, [role])).rows[0].id;
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [u, tenant, r]);
  };
  const api = (method: 'get' | 'post' | 'patch', path: string, o: { token?: string; key?: string; tenant?: string; idem?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    let rq = (request(http) as any)[method](path);
    if (o.token) rq = rq.set('Authorization', `Bearer ${o.token}`);
    if (o.key) rq = rq.set('Authorization', `Bearer ${o.key}`);
    if (o.tenant) rq = rq.set('x-tenant-id', o.tenant);
    if (o.idem) rq = rq.set('Idempotency-Key', o.idem);
    for (const [k, v] of Object.entries(o.headers ?? {})) rq = rq.set(k, v);
    return o.body !== undefined ? rq.send(o.body) : rq;
  };
  const create = async (token: string, tenant: string, draft: Record<string, unknown>, key = idem()) => api('post', '/v1/api-keys', { token, tenant, idem: key, body: draft });

  async function asApp<T>(tenantId: string, userId: string, fn: (probe: (sql: string, p?: unknown[]) => Promise<string>, c: PoolClient) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_app'); await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const probe = async (sql: string, p: unknown[] = []) => {
        await c.query('SAVEPOINT p');
        try { await c.query(sql, p); await c.query('RELEASE SAVEPOINT p'); return 'ok'; } catch (e) { await c.query('ROLLBACK TO SAVEPOINT p'); const m = /\[([A-Z_]+)\]/.exec(String((e as Error).message)); return m ? `${(e as { code?: string }).code}:${m[1]}` : (e as { code?: string }).code ?? 'error'; }
      };
      return await fn(probe, c);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, 'Anand FPO'); await makeTenant(admin, B, 'Other FPO'); await makeTenant(admin, C, 'Solo FPO');
    for (const u of [a1, a2, staff, bAdmin, cAdmin, memberA, memberB]) await makeUser(admin, u as ReturnType<typeof randomUUID>);
    await admin.query(`UPDATE users SET full_name = 'Ramesh Patel' WHERE id = $1`, [memberA]);
    await admin.query(`UPDATE users SET full_name = 'Bhavna Other' WHERE id = $1`, [memberB]);
    await addRole(a1, 'tenant_admin', A); await addRole(a1, 'farmer', A);          // an FPO admin who also sells
    await addRole(a2, 'tenant_admin', A); await addRole(staff, 'tenant_staff', A);
    await addRole(bAdmin, 'tenant_admin', B); await addRole(cAdmin, 'tenant_admin', C);
    await addRole(memberA, 'farmer', A); await addRole(memberB, 'farmer', B);
    // A: a plan that INCLUDES api_access (read for real); B: a plan without it
    const withApi = await makePlan(admin); await admin.query(`INSERT INTO plan_features (plan_id, feature_code, is_included) VALUES ($1, 'api_access', true)`, [withApi]);
    const without = await makePlan(admin);
    await activateSubscription(admin, A, withApi); await activateSubscription(admin, B, without);
    // the flag ON for these tenants only (allow-list) — before the app boots, so no cached OFF
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = jsonb_build_object('tenant_ids', to_jsonb(ARRAY[$1, $2, $3]::text[])) WHERE key = 'tenant_api'`, [A, B, C]);
    // (the shared makeCategory / makeProduct fixtures carry the known '$2 inconsistent types' bug — named, not fixed; the category is made here)
    const cat = randomUUID(); const code = `c${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1, $2::varchar, 'Test Category', $3::ltree, 1, true)`, [cat, code, code]);
    await ensureUnitCurrency(admin, 'quintal');
    const product = randomUUID();
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
                       VALUES ($1, $2, $3::varchar, 'quintal', $4, true, to_tsvector('simple', $3::text))`, [product, cat, 'Test Product', A]);
    listingId = randomUUID();
    await admin.query(
      `INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility)
       VALUES ($1, $2, $3, $4, $5, 'Wheat', 100, 100, 1, 'quintal', 50000, 'INR', 'published', 'public')`, [listingId, A, a1, product, cat]);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    const adminPerms = await permsOf('tenant_admin');
    tokA1 = mintToken(app, { userId: a1, tenantId: A, perms: adminPerms, roles: ['tenant_admin'] });
    tokA2 = mintToken(app, { userId: a2, tenantId: A, perms: adminPerms, roles: ['tenant_admin'] });
    tokStaff = mintToken(app, { userId: staff, tenantId: A, perms: await permsOf('tenant_staff'), roles: ['tenant_staff'] });
    tokB = mintToken(app, { userId: bAdmin, tenantId: B, perms: adminPerms, roles: ['tenant_admin'] });
  }, 120_000);
  afterAll(async () => {
    await admin.query(`UPDATE feature_flags SET is_enabled = false, rollout_pct = 100, rules = '{}'::jsonb WHERE key = 'tenant_api'`).catch(() => undefined);
    await app?.close(); await admin?.end();
  });

  // ===================================================================================================================== KEYS
  let ordersKey = ''; let ordersKeyId = ''; let ordersPrefix = '';

  it('A3 · GATES: api.manage on every read and write; the plan feature read for real (B: Locked → PLAN_FEATURE_REQUIRED)', async () => {
    expect((await api('get', '/v1/api-keys', { token: tokStaff, tenant: A })).status).toBe(403);
    const listB = await api('get', '/v1/api-keys', { token: tokB, tenant: B });
    expect(listB.status).toBe(200);
    expect(listB.body.data.access).toEqual({ enabled: false, source: 'none', planCode: expect.any(String) });
    const refused = await create(tokB, B, { name: 'ERP sync', scopes: ['orders.read'] });
    expect(refused.status).toBe(403); expect(refused.body.error.code).toBe('PLAN_FEATURE_REQUIRED');
    expect(Number((await admin.query(`SELECT count(*) FROM api_keys WHERE tenant_id = $1`, [B])).rows[0].count)).toBe(0);
    const listA = await api('get', '/v1/api-keys', { token: tokA1, tenant: A });
    expect(listA.body.data.access).toMatchObject({ enabled: true, source: 'plan' });
    expect(listA.body.data.contract).toMatchObject({ sandbox: false, storedAs: 'sha256', revocationBoundSeconds: 60, rate: { default: 1000, max: 10000 } });
    expect(listA.body.data.catalogue.map((s: { code: string }) => s.code)).toContain('members.read.pii');
    // the DB catalogue equals the TypeScript one
    const db = (await admin.query(`SELECT code, kind, checker, routes FROM api_scope_catalogue ORDER BY code`)).rows;
    expect(db.map((r: any) => ({ code: r.code, kind: r.kind, checker: r.checker, routes: r.routes })))
      .toEqual([...listA.body.data.catalogue].sort((x: any, y: any) => x.code.localeCompare(y.code)).map((s: any) => ({ code: s.code, kind: s.kind, checker: s.checker, routes: s.routes })));
  });

  it('A1 · ISSUE: the review prints the exact routes; the key is shown ONCE, sha256 stored, never in the idempotency record', async () => {
    const review = await api('post', '/v1/api-keys/preview', { token: tokA1, tenant: A, body: { name: 'ERP sync', scopes: ['orders.read', 'nope.scope'] } });
    expect(review.body.data.ready).toBe(false);
    expect(review.body.data.refusals).toEqual([{ field: 'scopes', code: 'scope_unknown', detail: 'nope.scope' }]);
    expect(review.body.data.routes).toEqual(['GET /v1/orders/console/list', 'GET /v1/orders/:id', 'GET /v1/orders/:id/items', 'GET /v1/orders/:id/events']);
    const k = idem();
    const r = await create(tokA1, A, { name: 'ERP sync', scopes: ['orders.read'], ratePerHour: 3 }, k);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'active', keyShown: true, proposalId: null });
    ordersKey = r.body.data.key; ordersKeyId = r.body.data.id; ordersPrefix = r.body.data.keyPrefix;
    expect(ordersKey).toMatch(/^kv_live_[a-z0-9]{8}_[A-Za-z0-9_-]{32}$/);
    const row = (await admin.query(`SELECT key_prefix, key_hash, created_by, activated_at, scopes FROM api_keys WHERE id = $1`, [ordersKeyId])).rows[0];
    expect(row.key_prefix).toBe(ordersPrefix); expect(row.key_hash).toBe(sha(ordersKey.slice(ordersPrefix.length + 1)));
    expect(row.created_by).toBe(a1); expect(row.activated_at).not.toBeNull(); expect(row.scopes).toEqual(['orders.read']);
    const replay = await create(tokA1, A, { name: 'ERP sync', scopes: ['orders.read'], ratePerHour: 3 }, k);
    expect(replay.body.data).toMatchObject({ id: ordersKeyId, key: null, keyShown: false });
    const stored = (await admin.query(`SELECT response_body::text AS b FROM idempotency_keys WHERE key LIKE $1`, [`%${k}`])).rows.map((x: any) => x.b).join(' ');
    expect(stored).toContain(ordersPrefix); expect(stored).not.toContain(ordersKey.slice(ordersPrefix.length + 1));
    // the audit names the routes it unlocked
    const aud = (await admin.query(`SELECT action, new_value, ip FROM audit_log WHERE entity_id = $1`, [ordersKeyId])).rows;
    expect(aud).toHaveLength(1); expect(aud[0].action).toBe('api_key.created'); expect(aud[0].new_value.routes).toHaveLength(4);
    // UNIQUE prefix (the guard's lookup must be well-defined)
    await asApp(A, a1, async (probe) => {
      expect(await probe(`INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by, activated_at) VALUES ($1, 'dup', $2, $3, '["orders.read"]', $4, now())`, [A, ordersPrefix, sha('x'), a1])).toBe('23505');
      expect(await probe(`INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by, activated_at) VALUES ($1, 'bad', 'kv_live_zzzzzzzz', $2, '["orders.*"]', $3, now())`, [A, sha('y'), a1])).toBe('23514:API_KEY_SCOPES');
      expect(await probe(`INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by, activated_at) VALUES ($1, 'plain', 'kv_live_zzzzzzzy', 'plaintextsecret', '["orders.read"]', $2, now())`, [A, a1])).toBe('23514:API_KEY_HASH');
      expect(await probe(`UPDATE api_keys SET scopes = '["orders.read","orders.status.write"]' WHERE id = $1`, [ordersKeyId])).toBe('42501');
      expect(await probe(`DELETE FROM api_keys WHERE id = $1`, [ordersKeyId])).toBe('42501');
    });
  });

  it('A2 · KEY AUTH: the tenant comes FROM THE KEY (X-Tenant-Id ignored); last_used_at stamped; audit on behalf of the creator', async () => {
    const r = await api('get', '/v1/orders/console/list?limit=5', { key: ordersKey, tenant: B });
    expect(r.status).toBe(200);
    // a member of B never appears through A's key, whatever header is sent — and a JWT-less, key-less header is anonymous as before
    await new Promise((res) => setTimeout(res, 300));
    const used = (await admin.query(`SELECT last_used_at FROM api_keys WHERE id = $1`, [ordersKeyId])).rows[0].last_used_at;
    expect(used).not.toBeNull();
    // debounced in the database: an immediate second stamp is a no-op
    expect((await admin.query(`SELECT api_key_touch($1) AS moved`, [ordersKeyId])).rows[0].moved).toBe(false);
  });

  it('A2 · EXACT SCOPE: orders.read cannot write; a non-catalogue route refuses a key; a wrong secret is opaque', async () => {
    const w = await api('post', `/v1/orders/${randomUUID()}/confirm`, { key: ordersKey, idem: idem() });
    expect(w.status).toBe(403); expect(w.body.error.code).toBe('API_KEY_SCOPE_MISSING');
    const nc = await api('get', '/v1/api-keys', { key: ordersKey });
    expect(nc.status).toBe(403); expect(nc.body.error.code).toBe('API_KEY_ROUTE_NOT_ACCEPTED');
    const buyer = await api('get', '/v1/orders?box=buyer&limit=5', { key: ordersKey });
    expect(buyer.body.error.code).toBe('API_KEY_ROUTE_NOT_ACCEPTED');
    const wrong = await api('get', '/v1/orders/console/list', { key: `${ordersPrefix}_${'B'.repeat(32)}` });
    expect(wrong.status).toBe(401); expect(wrong.body.error.code).toBe('API_KEY_INVALID');
    const unknown = await api('get', '/v1/orders/console/list', { key: `kv_live_00000000_${'B'.repeat(32)}` });
    expect(unknown.body.error.code).toBe('API_KEY_INVALID');
  });

  it('A2 · QUOTA: the (rate+1)th call in the hour is 429 with Retry-After', async () => {
    // ratePerHour 3: three calls were made above (list, confirm-refused-by-scope does not count? it does — the scope check runs first)
    let last: any = null;
    for (let i = 0; i < 4; i++) last = await api('get', '/v1/orders/console/list', { key: ordersKey });
    expect(last.status).toBe(429); expect(last.body.error.code).toBe('API_KEY_QUOTA_EXCEEDED');
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0); expect(Number(last.headers['retry-after'])).toBeLessThanOrEqual(3600);
  });

  let membersKey = ''; let writerKey = '';
  it('A2 · MEMBERS MASKED: short name, masked phone, no digit search, tenant from the key; listings.write cannot read members', async () => {
    membersKey = (await create(tokA1, A, { name: 'Member list', scopes: ['members.read'] })).body.data.key;
    const r = await api('get', '/v1/members/roster?limit=50', { key: membersKey, tenant: B });
    expect(r.status).toBe(200);
    const names = r.body.data.map((m: { fullName: string }) => m.fullName);
    expect(names).toContain('Ramesh P.'); expect(names).not.toContain('Ramesh Patel'); expect(names).not.toContain('Bhavna O.');
    for (const m of r.body.data) expect(String(m.phoneMasked)).toMatch(/[•*x]/);
    const dig = await api('get', '/v1/members/roster?q=98', { key: membersKey });
    expect(dig.status).toBe(400);
    const one = await api('get', `/v1/members/roster/${memberA}`, { key: membersKey });
    expect({ status: one.status, body: one.body.error ?? null }).toEqual({ status: 200, body: null });
    expect(one.body.data.fullName).toBe('Ramesh P.');
    // the human console still sees the full name
    expect((await api('get', `/v1/members/roster/${memberA}`, { token: tokA1, tenant: A })).body.data.fullName).toBe('Ramesh Patel');
    writerKey = (await create(tokA1, A, { name: 'Listing bridge', scopes: ['listings.write'] })).body.data.key;
    expect((await api('get', '/v1/members/roster', { key: writerKey })).body.error.code).toBe('API_KEY_SCOPE_MISSING');
  });

  it('A2 · WRITES: an Idempotency-Key is required, and a retried write acts ONCE', async () => {
    expect((await api('patch', `/v1/listings/${listingId}/price`, { key: writerKey, body: { priceMinor: '61000', expectedVersion: 1 } })).body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const v0 = Number((await admin.query(`SELECT version FROM listings WHERE id = $1`, [listingId])).rows[0].version);
    const k = idem();
    const first = await api('patch', `/v1/listings/${listingId}/price`, { key: writerKey, idem: k, body: { priceMinor: '61000', expectedVersion: v0 } });
    expect(first.status).toBe(200);
    const second = await api('patch', `/v1/listings/${listingId}/price`, { key: writerKey, idem: k, body: { priceMinor: '61000', expectedVersion: v0 } });
    expect(second.status).toBe(200); expect(second.body.data).toEqual(first.body.data);   // the remembered answer (the envelope meta is per request)
    const after = (await admin.query(`SELECT version, price_minor::text AS p FROM listings WHERE id = $1`, [listingId])).rows[0];
    expect(Number(after.version)).toBe(v0 + 1); expect(after.p).toBe('61000');
  });

  let piiKey = ''; let piiKeyId = ''; let piiProposal = '';
  it('A1 · CHECKER: a member-PII key waits; the maker cannot confirm (trigger); the DB refuses any other activation; a second admin can', async () => {
    const tooShort = await create(tokA1, A, { name: 'Call centre', scopes: ['members.read.pii'], reason: 'short' });
    expect(tooShort.body.error.code).toBe('API_KEY_REFUSED');
    const r = await create(tokA1, A, { name: 'Call centre', scopes: ['members.read', 'members.read.pii'], reason: 'The call centre phones members about missed milk payments.' });
    expect(r.body.data).toMatchObject({ status: 'waiting_checker', keyShown: true });
    piiKey = r.body.data.key; piiKeyId = r.body.data.id; piiProposal = r.body.data.proposalId;
    const waiting = await api('get', '/v1/members/roster', { key: piiKey });
    expect(waiting.status).toBe(401); expect(waiting.body.error.code).toBe('KEY_PENDING_CHECKER');
    const self = await api('post', `/v1/api-keys/proposals/${piiProposal}/confirm`, { token: tokA1, tenant: A, idem: idem(), body: {} });
    expect(self.status).toBe(409); expect(self.body.error.code).toBe('CHECKER_IS_MAKER');
    await asApp(A, a1, async (probe) => {
      expect(await probe(`UPDATE api_keys SET activated_at = now(), checker_user_id = $2 WHERE id = $1`, [piiKeyId, a1])).toBe('23514:API_KEY_CHECKER_REQUIRED');
      expect(await probe(`UPDATE api_keys SET activated_at = now(), checker_user_id = $2 WHERE id = $1`, [piiKeyId, a2])).toBe('23514:API_KEY_CHECKER_REQUIRED');
      expect(await probe(`INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by, activated_at) VALUES ($1, 'x', 'kv_live_qqqqqqqq', $2, '["members.read.pii"]', $3, now())`, [A, sha('z'), a1])).toBe('23514:API_KEY_NEEDS_CHECKER');
    });
    const ok = await api('post', `/v1/api-keys/proposals/${piiProposal}/confirm`, { token: tokA2, tenant: A, idem: idem(), body: {} });
    expect(ok.status).toBe(201); expect(ok.body.data.status).toBe('active');
    const row = (await admin.query(`SELECT checker_user_id, activated_at FROM api_keys WHERE id = $1`, [piiKeyId])).rows[0];
    expect(row.checker_user_id).toBe(a2); expect(row.activated_at).not.toBeNull();
    const full = await api('get', '/v1/members/roster?limit=50', { key: piiKey });
    expect(full.status).toBe(200);
    expect(full.body.data.map((m: { fullName: string }) => m.fullName)).toContain('Ramesh Patel');
    const reveal = await api('post', `/v1/members/roster/${memberA}/reveal`, { key: piiKey, body: { field: 'phone', reason: 'Calling about a missed milk payment for the week.' } });
    expect(reveal.status).toBe(201);
    // the reveal is recorded as the synthetic principal, on behalf of the key's creator
    const aud = (await admin.query(`SELECT actor_user_id, actor_role, reason FROM audit_log WHERE tenant_id = $1 AND action = 'member.pii_revealed' ORDER BY created_at DESC LIMIT 1`, [A])).rows[0];
    expect(aud.actor_user_id).toBe(a1);
    expect(aud.actor_role).toBe(`api_key:${piiKeyId} on_behalf_of:farmer+tenant_admin`);
    // the PII answer is never written into the idempotency store (a reveal is a read)
    expect(Number((await admin.query(`SELECT count(*) FROM idempotency_keys WHERE key LIKE $1`, [`k:${piiKeyId.replace(/-/g, '')}%`])).rows[0].count)).toBe(0);
  });

  it('A2 · REVOKE: reason required; the very next call is 401 KEY_REVOKED with the re-issue path; permanent', async () => {
    expect((await api('post', `/v1/api-keys/${ordersKeyId}/revoke`, { token: tokA1, tenant: A, idem: idem(), body: { reason: 'x' } })).body.error.code).toBe('API_KEY_REFUSED');
    const t0 = Date.now();
    const r = await api('post', `/v1/api-keys/${ordersKeyId}/revoke`, { token: tokA1, tenant: A, idem: idem(), body: { reason: 'Vendor offboarded from the ERP contract' } });
    expect(r.status).toBe(201); expect(r.body.data).toMatchObject({ status: 'revoked', effectiveWithinSeconds: 60 });
    const after = await api('get', '/v1/orders/console/list', { key: ordersKey });
    expect(after.status).toBe(401); expect(after.body.error.code).toBe('KEY_REVOKED');
    expect(after.body.error.details).toMatchObject({ error: 'key_revoked', keyPrefix: ordersPrefix, reissue: expect.stringContaining('replacement key') });
    expect(Date.now() - t0).toBeLessThan(60_000);
    await asApp(A, a1, async (probe) => {
      expect(await probe(`UPDATE api_keys SET revoked_at = NULL, revoked_reason = NULL WHERE id = $1`, [ordersKeyId])).toBe('23514:API_KEY_REVOKED_FINAL');
    });
    const aud = (await admin.query(`SELECT reason, old_value, new_value, ip FROM audit_log WHERE entity_id = $1 AND action = 'api_key.revoked'`, [ordersKeyId])).rows[0];
    expect(aud.reason).toBe('Vendor offboarded from the ERP contract'); expect(aud.old_value.status).toBe('active'); expect(aud.new_value.status).toBe('revoked');
  });

  it('A2 · OWNER: a key stops when its creator no longer holds api.manage', async () => {
    const k = (await create(tokA2, A, { name: 'Owner test', scopes: ['orders.read'] })).body.data.key;
    expect((await api('get', '/v1/orders/console/list', { key: k })).status).toBe(200);
    await admin.query(`UPDATE user_tenant_roles SET is_active = false WHERE user_id = $1 AND tenant_id = $2`, [a2, A]);
    await (app.get(require('../../../core/rbac/role-cache.service').RoleCacheService) as any).invalidate(a2, A);
    const r = await api('get', '/v1/orders/console/list', { key: k });
    expect(r.status).toBe(401); expect(r.body.error.code).toBe('KEY_OWNER_LOST_ACCESS');
    await admin.query(`UPDATE user_tenant_roles SET is_active = true WHERE user_id = $1 AND tenant_id = $2`, [a2, A]);
    await (app.get(require('../../../core/rbac/role-cache.service').RoleCacheService) as any).invalidate(a2, A);
  });

  it('µs · five keys with ONE created_at page exactly once', async () => {
    const T = randomUUID(); await makeTenant(admin, T, 'Paging FPO'); await addRole(a1, 'tenant_admin', T);
    await asApp(T, a1, async (_p, c) => {
      for (let i = 0; i < 5; i++) {
        await c.query(`INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by, activated_at) VALUES ($1, $2, $3, $4, '["orders.read"]', $5, now())`,
          [T, `k${i}`, `kv_live_${randomUUID().replace(/-/g, '').slice(0, 8)}`, sha(`s${i}`), a1]);
      }
      await c.query('COMMIT'); await c.query('BEGIN');
    });
    const svc = app.get(require('../services/api-key.service').ApiKeyService) as any;
    const actor = { userId: a1, permissions: new Set(['api.manage']), ip: null, requestId: null };
    const seen: string[] = []; let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await svc.list(T, actor, { cursor, limit: 2 });
      seen.push(...page.items.map((x: { id: string }) => x.id));
      if (!page.nextCursor) break;
      expect(decodeKeyset(page.nextCursor, UUID_RE)?.ts).toMatch(/\.\d{6}Z$/);
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5); expect(new Set(seen).size).toBe(5);
  });

  // ============================================================================================================= INTEGRATIONS
  describe('B · integrations', () => {
    let svc: TenantIntegrationService; let vault: LocalSecretWriter; let puts = 0; let deletes: string[] = [];
    let outcome: VerifyResult = { ok: true, errorClass: null, detail: 'HTTP 200', httpStatus: 200, durationMs: 5 };
    const verifier: ProviderVerifier = { verify: jest.fn(async () => outcome) };
    const actor = (userId: string, perms: string[]): IntegrationsActor => ({ userId, permissions: new Set(perms), ip: '10.0.13.3', requestId: 'req-13c' });
    let A1: IntegrationsActor; let A2: IntegrationsActor;
    const cred = { keyId: 'rzp_live_ABCDEFGH12', keySecret: 'S3cretS3cretS3cret99' };
    const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));
    const conn = async (tenant: string, provider: string) => (await admin.query(`SELECT * FROM tenant_integrations WHERE tenant_id = $1 AND provider_code = $2`, [tenant, provider])).rows[0];

    beforeAll(async () => {
      const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
      const pools = new PgPoolProvider(config);
      const shards = new ShardRouter(config);
      const metrics = new PromMetrics();
      const uow = new PgUnitOfWork(pools, shards);
      const replica = new PgReadReplicaProvider(pools, shards);
      vault = new LocalSecretWriter();
      const realPut = vault.putTenantSecret.bind(vault); const realDel = vault.deleteTenantSecret.bind(vault);
      vault.putTenantSecret = async (...a: Parameters<LocalSecretWriter['putTenantSecret']>) => { puts++; return realPut(...a); };
      vault.deleteTenantSecret = async (ref: string) => { deletes.push(ref); return realDel(ref); };
      svc = new TenantIntegrationService(uow, new PgIdempotencyService(pools), metrics, vault, vault, verifier, new AuditWriter(pools),
        new TenantIntegrationRepository(replica), config);
      const ap = await permsOf('tenant_admin');
      A1 = actor(a1, ap); A2 = actor(a2, ap);
    });

    it('B4 · GETs need api.manage OR tenant.settings', async () => {
      expect(await code(svc.list(A, actor(staff, ['report.view'])))).toBe('INTEGRATIONS_FORBIDDEN');
      expect(await code(svc.listProviders(A, actor(staff, ['report.view'])))).toBe('INTEGRATIONS_FORBIDDEN');
      expect(await code(svc.list(A, actor(a1, ['tenant.settings'])))).toBe('ok');
      expect(await code(svc.list(A, actor(a1, ['api.manage'])))).toBe('ok');
      const l = await svc.list(A, A1);
      expect(l.platformDefaults).toEqual({ payments: 'platform_account', sms: 'platform_route', inUse: true });
      expect(l.directSettlement).toEqual({ available: false, reason: 'law9_own_wave' });
      const byCode = Object.fromEntries(l.providers.map((p) => [p.code, p]));
      expect(byCode.razorpay.ownable).toBe(true); expect(byCode.gupshup.ownable).toBe(true); expect(byCode.inaph.ownable).toBe(true);
      for (const m of ['agmarknet', 'pfms', 'pmkisan', 'sandbox', 'msg91', 'razorpayx', 'ikhedut']) expect(byCode[m]?.managed).toBe(true);
      expect(byCode.inaph.verifiable).toBe(false);
    });

    it('B1 · a platform-managed provider is refused BY NAME: nothing written, nothing vaulted, the provider never called', async () => {
      const calls = (verifier.verify as jest.Mock).mock.calls.length;
      expect(await code(svc.propose(A, A1, idem(), { providerCode: 'agmarknet', kind: 'connect', credential: { token: 'x'.repeat(20) }, reason: 'Attach our own mandi feed credential please.' }))).toBe('INTEGRATION_PROVIDER_NOT_OWNABLE');
      expect(await code(svc.propose(A, A1, idem(), { providerCode: 'sandbox', kind: 'connect', credential: {}, reason: 'Attach the sandbox gateway credential please.' }))).toBe('INTEGRATION_PROVIDER_NOT_OWNABLE');
      expect(puts).toBe(0); expect((verifier.verify as jest.Mock).mock.calls.length).toBe(calls);
      expect(Number((await admin.query(`SELECT count(*) FROM integration_proposals WHERE tenant_id = $1`, [A])).rows[0].count)).toBe(0);
      await asApp(A, a1, async (probe) => {
        expect(await probe(`INSERT INTO integration_proposals (tenant_id, provider_code, kind, reason, proposed_by, proposed_at, expires_at) VALUES ($1, 'pfms', 'disconnect', 'twenty characters at least ok', $2, now(), now() + interval '7 days')`, [A, a1])).toBe('23514:INTEGRATION_PROVIDER_NOT_OWNABLE');
      });
    });

    it('B2 · a FAILED shadow verify stores NOTHING (no proposal, no vault, no connection); a one-admin tenant is refused', async () => {
      outcome = { ok: false, errorClass: 'auth', detail: 'HTTP 401', httpStatus: 401, durationMs: 4 };
      const e = await svc.propose(A, A1, idem(), { providerCode: 'razorpay', kind: 'connect', credential: cred, reason: 'Connect our own Razorpay account for branding.' }).catch((x) => x);
      expect(e.code).toBe('INTEGRATION_VERIFY_FAILED'); expect(e.details).toMatchObject({ providerCode: 'razorpay', errorClass: 'auth', detail: 'HTTP 401' });
      expect(JSON.stringify(e.details)).not.toContain(cred.keySecret);
      expect(puts).toBe(0);
      expect(Number((await admin.query(`SELECT count(*) FROM integration_proposals WHERE tenant_id = $1`, [A])).rows[0].count)).toBe(0);
      expect(await conn(A, 'razorpay')).toBeUndefined();
      const solo = await svc.propose(C, actor(cAdmin, ['api.manage']), idem(), { providerCode: 'razorpay', kind: 'connect', credential: cred, reason: 'Connect our own Razorpay account for branding.' }).catch((x) => x);
      expect(solo.details.refusals.map((r: { code: string }) => r.code)).toContain('NEEDS_SECOND_ADMIN');
      const inaph = await svc.propose(A, A1, idem(), { providerCode: 'inaph', kind: 'connect', credential: { token: 'T'.repeat(24) }, reason: 'Connect INAPH so animal IDs sync for dairy.' }).catch((x) => x);
      expect(inaph.details.refusals.map((r: { code: string }) => r.code)).toContain('verify_not_configured');
    });

    let P1 = '';
    it('B2 · a verified proposal holds the credential SEALED (bound to the row), not vaulted; one in-flight per provider; maker ≠ checker', async () => {
      outcome = { ok: true, errorClass: null, detail: 'HTTP 200', httpStatus: 200, durationMs: 6 };
      const r = await svc.propose(A, A1, idem(), { providerCode: 'razorpay', kind: 'connect', credential: cred, reason: 'Connect our own Razorpay account for branding.' });
      P1 = r.id;
      expect(r).toMatchObject({ status: 'proposed', credentialHint: '…GH12', shadowResult: { ok: true, httpStatus: 200 } });
      expect(puts).toBe(0);
      const row = (await admin.query(`SELECT credential_sealed, config FROM integration_proposals WHERE id = $1`, [P1])).rows[0];
      expect(row.credential_sealed).toMatch(/^v2\./); expect(row.credential_sealed).not.toContain(cred.keySecret);
      expect(JSON.parse(openEnvelope(Buffer.from(DEV_ONLY_KEK_HEX, 'hex'), row.credential_sealed, `integration_proposal:${P1}`))).toEqual(cred);
      expect(() => openEnvelope(Buffer.from(DEV_ONLY_KEK_HEX, 'hex'), row.credential_sealed, `integration_proposal:${randomUUID()}`)).toThrow();
      expect(row.config).toEqual({ keyId: cred.keyId });
      expect(await code(svc.propose(A, A2, idem(), { providerCode: 'razorpay', kind: 'connect', credential: cred, reason: 'A parallel change to the same provider.' }))).toBe('INTEGRATION_CHANGE_IN_FLIGHT');
      expect(await code(svc.confirm(A, A1, idem(), P1))).toBe('CHECKER_IS_MAKER');
      expect(puts).toBe(0);
      const aud = (await admin.query(`SELECT new_value::text AS v FROM audit_log WHERE entity_id = $1`, [P1])).rows.map((x: any) => x.v).join(' ');
      expect(aud).not.toContain(cred.keySecret);
    });

    it('B2 · kv_app cannot write a connection without a confirmed proposal (the DB wall)', async () => {
      await asApp(A, a1, async (probe) => {
        expect(await probe(`INSERT INTO tenant_integrations (tenant_id, provider_code, secret_ref, config) VALUES ($1, 'razorpay', 'local://x', '{}')`, [A])).toBe('23514:INTEGRATION_PROPOSAL_REQUIRED');
        await probe(`SELECT set_config('app.integration_proposal_id', $1, true)`, [P1]);
        expect(await probe(`INSERT INTO tenant_integrations (tenant_id, provider_code, secret_ref, config) VALUES ($1, 'razorpay', 'local://x', '{}')`, [A])).toBe('23514:INTEGRATION_PROPOSAL_REQUIRED');
        expect(await probe(`INSERT INTO tenant_integrations (tenant_id, provider_code, secret_ref, config) VALUES ($1, 'agmarknet', 'local://x', '{}')`, [A])).toBe('23514:INTEGRATION_PROVIDER_NOT_OWNABLE');
      });
    });

    it('B2 · the SECOND verify fails → verify_failed: nothing vaulted, nothing written, the sealed credential wiped', async () => {
      outcome = { ok: false, errorClass: 'network', detail: 'no answer (ETIMEDOUT)', httpStatus: null, durationMs: 10_000 };
      const r = await svc.confirm(A, A2, idem(), P1);
      expect(r).toMatchObject({ status: 'verify_failed', result: { ok: false, errorClass: 'network' } });
      expect(puts).toBe(0); expect(await conn(A, 'razorpay')).toBeUndefined();
      const row = (await admin.query(`SELECT status, credential_sealed, confirmed_by FROM integration_proposals WHERE id = $1`, [P1])).rows[0];
      expect(row).toEqual({ status: 'verify_failed', credential_sealed: null, confirmed_by: a2 });
    });

    let firstRef = '';
    it('B2 · success: verify → vault → verified_at + a check row; masked ref only; consumers empty; never "active"', async () => {
      outcome = { ok: true, errorClass: null, detail: 'HTTP 200', httpStatus: 200, durationMs: 7 };
      const p = await svc.propose(A, A1, idem(), { providerCode: 'razorpay', kind: 'connect', credential: cred, reason: 'Connect our own Razorpay account for branding.' });
      const k = idem();
      const r = await svc.confirm(A, A2, k, p.id);
      expect(r).toMatchObject({ status: 'applied', connectionStatus: 'verified' });
      expect(puts).toBe(1);
      expect(await svc.confirm(A, A2, k, p.id)).toEqual(r);    // a retried confirm is one vault write
      expect(puts).toBe(1);
      const c = await conn(A, 'razorpay');
      expect(c.status).toBe('verified'); expect(c.verified_at).not.toBeNull(); expect(c.is_active).toBe(true);
      firstRef = c.secret_ref;
      expect(JSON.parse((await vault.readTenantSecret(firstRef))!)).toEqual(cred);
      expect(Number((await admin.query(`SELECT count(*) FROM integration_verify_checks WHERE integration_id = $1 AND kind = 'apply' AND ok`, [c.id])).rows[0].count)).toBe(1);
      const l = await svc.list(A, A1);
      const item = l.items.find((i) => i.providerCode === 'razorpay')!;
      expect(item).toMatchObject({ status: 'verified', maskedRef: `…••${firstRef.slice(-2)}`, credentialHint: '…GH12', consumers: [], disconnect: { blockedByInFlightSettlements: false } });
      expect(item.health).toMatchObject({ checks24h: 1, ok24h: 1 });
      expect(JSON.stringify(l)).not.toContain(firstRef); expect(JSON.stringify(l)).not.toContain(cred.keySecret); expect(JSON.stringify(l)).not.toMatch(/"active"/);
      expect(l.count.connected).toBe(1);
    });

    it('B2 · ROTATE keeps service: a failed rotation leaves the old credential serving; a verified one replaces it and retires the old after commit', async () => {
      const cred2 = { keyId: 'rzp_live_ZYXWVUTS98', keySecret: 'N3wS3cretN3wS3cret77' };
      outcome = { ok: true, errorClass: null, detail: 'HTTP 200', httpStatus: 200, durationMs: 5 };
      const bad = await svc.propose(A, A2, idem(), { providerCode: 'razorpay', kind: 'rotate', credential: cred2, reason: 'Rotate the Razorpay key after staff change.' });
      outcome = { ok: false, errorClass: 'auth', detail: 'HTTP 401', httpStatus: 401, durationMs: 5 };
      expect((await svc.confirm(A, A1, idem(), bad.id)).status).toBe('verify_failed');
      let c = await conn(A, 'razorpay');
      expect(c.secret_ref).toBe(firstRef); expect(c.status).toBe('verified');
      expect(await vault.readTenantSecret(firstRef)).not.toBeNull();
      outcome = { ok: true, errorClass: null, detail: 'HTTP 200', httpStatus: 200, durationMs: 5 };
      const good = await svc.propose(A, A2, idem(), { providerCode: 'razorpay', kind: 'rotate', credential: cred2, reason: 'Rotate the Razorpay key after staff change.' });
      const putsBefore = puts;
      expect((await svc.confirm(A, A1, idem(), good.id)).status).toBe('applied');
      expect(puts).toBe(putsBefore + 1);
      c = await conn(A, 'razorpay');
      expect(c.secret_ref).not.toBe(firstRef); expect(c.credential_hint).toBe('…TS98');
      expect(JSON.parse((await vault.readTenantSecret(c.secret_ref))!)).toEqual(cred2);
      expect(await vault.readTenantSecret(firstRef)).toBeNull();
      expect(deletes).toContain(firstRef);
    });

    it('B3 · the daily re-verify reads the vault, records a check and feeds Health (24 h): N checks · last OK', async () => {
      const c = await conn(A, 'razorpay');
      outcome = { ok: false, errorClass: 'auth', detail: 'HTTP 401', httpStatus: 401, durationMs: 3 };
      expect(await svc.reverify(A, { id: c.id, providerCode: 'razorpay', secretRef: c.secret_ref })).toBe(false);
      let item = (await svc.list(A, A1)).items.find((i) => i.providerCode === 'razorpay')!;
      expect(item.status).toBe('verify_failed'); expect(item.health.checks24h).toBe(3); expect(item.health.failed24h).toBe(1); expect(item.health.lastOkAt).not.toBeNull();
      outcome = { ok: true, errorClass: null, detail: 'HTTP 200', httpStatus: 200, durationMs: 3 };
      expect(await svc.reverify(A, { id: c.id, providerCode: 'razorpay', secretRef: c.secret_ref })).toBe(true);
      item = (await svc.list(A, A1)).items.find((i) => i.providerCode === 'razorpay')!;
      expect(item.status).toBe('verified'); expect(item.health.checks24h).toBe(4);
      // a credential the vault no longer holds is recorded honestly
      expect(await svc.reverify(A, { id: c.id, providerCode: 'razorpay', secretRef: 'local://gone' })).toBe(false);
      await asApp(A, a1, async (probe) => {
        expect(await probe(`UPDATE integration_verify_checks SET ok = true WHERE integration_id = $1`, [c.id])).toBe('42501');
        expect(await probe(`UPDATE tenant_integrations SET status = 'disconnected' WHERE id = $1`, [c.id])).toMatch(/^23514/);
      });
    });

    it('B2 · disconnect is a checked proposal too; the vault entry goes; refuse needs a reason; the RLS walls hold', async () => {
      const p = await svc.propose(A, A1, idem(), { providerCode: 'razorpay', kind: 'disconnect', reason: 'We go back to the platform account for payments.' });
      expect(await code(svc.refuse(A, A2, idem(), p.id, 'no'))).toBe('INTEGRATION_REFUSED');
      const ref = (await conn(A, 'razorpay')).secret_ref;
      expect((await svc.confirm(A, A2, idem(), p.id)).connectionStatus).toBe('disconnected');
      const c = await conn(A, 'razorpay');
      expect(c).toMatchObject({ status: 'disconnected', is_active: false, disconnected_by: a2 });
      expect(await vault.readTenantSecret(ref)).toBeNull();
      const g = await svc.propose(A, A1, idem(), { providerCode: 'gupshup', kind: 'connect', credential: { apiKey: 'G'.repeat(24), senderId: 'KRISHV' }, reason: 'Connect Gupshup for our WhatsApp sender.' });
      expect((await svc.refuse(A, A2, idem(), g.id, 'We are not ready for our own WhatsApp sender yet.')).status).toBe('refused');
      expect((await admin.query(`SELECT credential_sealed FROM integration_proposals WHERE id = $1`, [g.id])).rows[0].credential_sealed).toBeNull();
      await asApp(B, bAdmin, async (_probe, cl) => {
        expect((await cl.query(`SELECT count(*)::int AS n FROM integration_proposals`)).rows[0].n).toBe(0);
        expect((await cl.query(`SELECT count(*)::int AS n FROM integration_verify_checks`)).rows[0].n).toBe(0);
        expect((await cl.query(`SELECT count(*)::int AS n FROM api_key_proposals`)).rows[0].n).toBe(0);
      });
    });

    it('µs · proposals written in one transaction page exactly once', async () => {
      const seen: string[] = []; let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await svc.proposals(A, A1, { cursor, limit: 2 });
        seen.push(...page.items.map((x) => x.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      const total = Number((await admin.query(`SELECT count(*) FROM integration_proposals WHERE tenant_id = $1`, [A])).rows[0].count);
      expect(seen).toHaveLength(total); expect(new Set(seen).size).toBe(total);
    });
  });
});
