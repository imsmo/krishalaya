// apps/api/src/__tests__/partner1b-keys-webhooks.integration.spec.ts · PC-56 PARTNER-1b · KEYS, ENDPOINTS AND THE ROAD IN — LIVE proof (the real
// AppModule over HTTP, real Postgres + RLS, the kv_partner axis through 0227's definers, column grants and policies).
//
// Fixture (the PARTNER-0 / 1a path): TWO partners, each with an administrator and a viewer (A's administrator and B's VIEWER hold a confirmed
// TOTP — so "an administrator with a second factor" is true for A and false for B, and a member's TOTP is never mistaken for an admin's);
// keys inserted as the owner the way db/scripts/mint-partner-key.js does (A: 2 active + 1 revoked, B: 1); endpoints inserted as the owner
// for both; deliveries + attempts inserted as the owner with endpoint_kind 'partner' for both partners AND one TENANT delivery.
//   (1) GET /v1/partner/keys as A's VIEWER → A's 3 keys; B's absent; no hash / secret property anywhere in the JSON (deep keys)          [M1, M2]
//   (2) revoke as A's ADMIN with a reason → 200; the row (owner) revoked, inactive, the reason, the revoker; the audit row (reason + prefix,
//       never the hash); the pure isUsable on the re-read row is false AND, with `partner_api` switched ON for that one assertion, the
//       machine realm answers 200 with the key before and 401 after; a replay of the same Idempotency-Key → the same answer
//   (3) refused: the viewer → 403; B's key by A's admin → 404 (and B's key untouched); revoked again → 409; a 5-character reason → 422;
//       no Idempotency-Key → 400                                                                                                          [M3]
//   (4) the walls at the database: a direct UPDATE of a key as kv_app AND as kv_partner → 42501; kv_partner SELECT key_hash / secret_enc /
//       payload / a delivery's tenant_id → 42501; kv_app cannot call the revoke definer; the definers answer nothing with no partner in scope;
//       kv_partner sees exactly its own deliveries through the policy alone                                                              [M4]
//   (5) GET /v1/partner/webhooks → A's endpoints, no secret; deliveries → A's only (B's and the tenant's absent), newest first, keyset
//       pages, the state filter; the detail → its attempts, no payload; B's delivery and the tenant's by A → 404                         [M4]
//   (6) GET /v1/partner/readiness → the six facts equal the fixture (2FA-administrator true for A, false for B)                           [M5]
//   (7) POST /v1/partner/invites/lookup → the PARTNER-0 answer; GET /v1/partner/invites/<token> → 404 (D4)
//   (8) kv_admin: SELECT phone / token_hash / token_sealed FROM partner_invites → 42501 (D5, the 1a lead mutant's hole)
//   (9) OFF-as-OFF: `partner_console` off → every new route 404.
import 'reflect-metadata';
import request from 'supertest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { isUsable } from '../modules/partner-api/domain/partner-key.rules';
import { PARTNER_WEBHOOK_EVENT_TYPES } from '../modules/partner-api/domain/partner-webhook.rules';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});
const FORBIDDEN_KEY = /^(keyHash|key_hash|secret|secretEnc|secret_enc|secretHash|secret_hash|payload|tenantId|tenant_id|signature)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];

run('PC-56 PARTNER-1b · the partner\'s own keys (read + revoke), endpoints and deliveries (read), readiness, the invite lookup (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let kvApp: Pool; let kvAdmin: Pool; let cache: CacheService; let otp: OtpService;
  const T1 = randomUUID(); const PA = randomUUID(); const PB = randomUUID();
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, string> = {};
  const keys: Record<string, { id: string; prefix: string; secret: string }> = {};
  const eps: Record<string, string> = {};
  const dels: Record<string, string> = {};
  const aDeliveriesNewestFirst: string[] = [];

  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone };
  };
  const membership = (userKey: string, partnerId: string, role: string) => admin.query(
    `INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`, [people[userKey].id, partnerId, role]);
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp', 'PartnerInvitesController.lookup', 'PartnerTeamController.invite'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const signIn = async (key: string) => {
    await resetRates();
    const { code } = await otp.issue(people[key].phone);
    const r = await request(http).post('/v1/partner/auth/verify').send({ phone: people[key].phone, code });
    expect([key, r.status]).toEqual([key, 201]);
    tok[key] = r.body.data.accessToken;
  };
  const bearer = (key: string) => ({ authorization: `Bearer ${tok[key]}` });
  /** A key the way db/scripts/mint-partner-key.js writes one: prefix kv_pk_<env>_<16 hex>, SHA-256 of a 32-byte secret, scopes as jsonb. */
  const mintKey = async (name: string, partnerId: string, revoked = false) => {
    const handle = randomBytes(8).toString('hex'); const secret = randomBytes(32).toString('base64url'); const prefix = `kv_pk_test_${handle}`;
    const r = await admin.query(
      `INSERT INTO partner_api_keys (partner_id, name, key_prefix, key_hash, scopes, rate_limit_per_hour, is_active, revoked_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 1000, $6::boolean, CASE WHEN $6::boolean THEN NULL ELSE now() END) RETURNING id`,
      [partnerId, name, prefix, createHash('sha256').update(secret, 'utf8').digest('hex'), JSON.stringify(['partner:identity:read', 'lending:book:read']), !revoked]);
    keys[name] = { id: r.rows[0].id, prefix, secret };
  };
  const endpoint = async (name: string, partnerId: string, active: boolean) => {
    const r = await admin.query(`INSERT INTO partner_webhook_endpoints (partner_id, url, secret_enc, event_types, is_active) VALUES ($1, $2, 'v2.ciphertext-never-shown.x.y', $3::jsonb, $4) RETURNING id`,
      [partnerId, `https://hooks.fixture.test/${name}`, JSON.stringify(['fintech.loan_repaid', 'fintech.loan_disbursed']), active]);
    eps[name] = r.rows[0].id;
  };
  /** One delivery (owner) `agoMin` minutes old in `state`, with its attempts. */
  const delivery = async (name: string, endpointId: string, kind: 'partner' | 'tenant', state: 'delivered' | 'exhausted' | 'pending', agoMin: number, event = 'fintech.loan_repaid') => {
    const attempts = state === 'delivered' ? 2 : state === 'exhausted' ? 1 : 0;
    const r = await admin.query(
      `INSERT INTO webhook_deliveries (endpoint_id, tenant_id, event_type, payload, attempt, status_code, succeeded, next_retry_at, created_at, endpoint_kind, state, retry_step,
                                       delivered_at, last_attempt_at, last_error)
       SELECT $1::uuid, $2::uuid, $3::text, '{"v":1,"data":{"loanId":"fixture","phone":"+919800000000"}}'::jsonb, $4::smallint,
              CASE $5::text WHEN 'delivered' THEN 200 WHEN 'exhausted' THEN 503 END, $5::text = 'delivered', CASE WHEN $5::text = 'pending' THEN now() END,
              t.at, $6::text, $5::text, 0, CASE WHEN $5::text = 'delivered' THEN t.at + interval '5 seconds' END,
              CASE WHEN $5::text <> 'pending' THEN t.at + interval '5 seconds' END, CASE WHEN $5::text = 'exhausted' THEN 'http 503' END
         FROM (SELECT now() - make_interval(mins => $7::int) AS at) t
       RETURNING id, created_at::text AS created_raw`,
      [endpointId, T1, event, attempts, state, kind, agoMin]);
    const { id, created_raw: createdAt } = r.rows[0];   // µs as the database printed it — never a millisecond JS Date (the house trap)
    for (let n = 1; n <= attempts; n++) {
      const ok = state === 'delivered' && n === attempts;
      await admin.query(
        `INSERT INTO webhook_delivery_attempts (tenant_id, delivery_id, delivery_created_at, endpoint_id, endpoint_kind, attempt_no, outcome, status_code, duration_ms, error, signed_at, signatures)
         VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, 120, $9, now(), 1)`,
        [T1, id, createdAt, endpointId, kind, n, ok ? 'delivered' : 'failed', ok ? 200 : 503, ok ? null : 'http 503']);
    }
    dels[name] = id;
  };
  async function asPartnerAxis<T>(partnerId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
      if (partnerId) await c.query(`SELECT set_config('app.partner_id', $1, true)`, [partnerId]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  async function asKvApp<T>(partnerId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await kvApp.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', '', true), set_config('app.partner_id', $1, true)`, [partnerId ?? '']);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100 WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);   // before the app boots there is no cache to clear
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    admin = new Pool({ connectionString: ADMIN_URL });
    kvApp = new Pool({ connectionString: APP_URL, max: 2 });
    await admin.query(`ALTER ROLE kv_admin WITH LOGIN PASSWORD 'dev'`);
    const asRole = (role: string) => { const u = new URL(APP_URL as string); u.username = role; u.password = 'dev'; return u.toString(); };
    kvAdmin = new Pool({ connectionString: asRole('kv_admin'), max: 1 });
    expect((await kvAdmin.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_admin');

    await makeTenant(admin, T1, 'Fixture Delivery Origin Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref, sla) VALUES ($1, $2, 'Partner OneB Bank', 'bank', 'LIC-TEST-1B01', '{}'::jsonb)`, [PA, `p1ba_${sfx}`]);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref, sla) VALUES ($1, $2, 'Partner OneB Other', 'nbfc', 'LIC-TEST-1B02', '{"decision_hours": 24}'::jsonb)`, [PB, `p1bb_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'OneB admin A'], ['aViewer', 'OneB viewer A'], ['bAdmin', 'OneB admin B'], ['bViewer', 'OneB viewer B']] as const) await user(k, n);
    await membership('aAdmin', PA, 'partner_admin'); await membership('aViewer', PA, 'partner_viewer');
    await membership('bAdmin', PB, 'partner_admin'); await membership('bViewer', PB, 'partner_viewer');

    await mintKey('a1', PA); await mintKey('a2', PA); await mintKey('a3', PA, true); await mintKey('b1', PB);
    await endpoint('a1', PA, true); await endpoint('a2', PA, false); await endpoint('b1', PB, true);
    // A's five deliveries (newest first: d1 … d5), B's one, the tenant's one
    await delivery('d1', eps.a1, 'partner', 'delivered', 1); await delivery('d2', eps.a1, 'partner', 'exhausted', 2); await delivery('d3', eps.a1, 'partner', 'pending', 3);
    await delivery('d4', eps.a1, 'partner', 'delivered', 4, 'fintech.loan_disbursed'); await delivery('d5', eps.a2, 'partner', 'delivered', 5);
    await delivery('b1', eps.b1, 'partner', 'delivered', 1); await delivery('t1', randomUUID(), 'tenant', 'delivered', 1);
    aDeliveriesNewestFirst.push(dels.d1, dels.d2, dels.d3, dels.d4, dels.d5);

    await setFlag('partner_console', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of [...flagKeys('partner_console'), ...flagKeys('partner_api')]) await cache.del(k);
    for (const k of ['aAdmin', 'aViewer', 'bAdmin', 'bViewer']) await signIn(k);
    // the second factor AFTER sign-in (the sessions above are already proven): A's administrator and B's VIEWER — never B's administrator
    for (const k of ['aAdmin', 'bViewer']) {   // born unconfirmed, then confirmed (0199's trigger)
      await admin.query(`INSERT INTO user_totp (user_id, secret_enc) VALUES ($1, 'v2.0a1b2c3d.AAAA.BBBB')`, [people[k].id]);
      await admin.query(`UPDATE user_totp SET confirmed_at = now() WHERE user_id = $1`, [people[k].id]);
    }
  }, 240_000);

  afterAll(async () => {
    await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key IN ('partner_console', 'partner_api')`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await kvAdmin?.end(); await kvApp?.end(); await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) the keys read: A\'s viewer sees A\'s three keys (prefix, name, scopes, quota, last used, status); B\'s absent; no hash anywhere', async () => {
    const r = await request(http).get('/v1/partner/keys').set(bearer('aViewer'));
    expect(r.status).toBe(200);
    const ids = r.body.data.map((k: { id: string }) => k.id).sort();
    expect(ids).toEqual([keys.a1.id, keys.a2.id, keys.a3.id].sort());
    expect(ids).not.toContain(keys.b1.id);
    expect(deepKeys(r.body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    const body = JSON.stringify(r.body);
    for (const k of Object.values(keys)) { expect(body).not.toContain(k.secret); expect(body).not.toContain(createHash('sha256').update(k.secret, 'utf8').digest('hex')); }
    const a3 = r.body.data.find((k: { id: string }) => k.id === keys.a3.id);
    expect(a3).toMatchObject({ keyPrefix: keys.a3.prefix, name: 'a3', scopes: ['partner:identity:read', 'lending:book:read'], rateLimitPerHour: 1000, status: 'revoked', lastUsedAt: null });
    expect(r.body.data.find((k: { id: string }) => k.id === keys.a1.id).status).toBe('active');
    // B's own read: B's one key only
    const b = await request(http).get('/v1/partner/keys').set(bearer('bViewer'));
    expect(b.body.data.map((k: { id: string }) => k.id)).toEqual([keys.b1.id]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) the revoke: 200; the row; the audit row (reason + prefix, never the hash); isUsable false; the machine realm 200 → 401; a replay → the same answer', async () => {
    const reason = 'the key was pasted into a shared ticket by mistake';
    const machine = () => request(http).get('/v1/partner-api/me').set({ authorization: `Bearer ${keys.a1.prefix}.${keys.a1.secret}` });
    await setFlag('partner_api', true);
    let before: number; let after: number;
    try {
      before = (await machine()).status;
      const idem = randomUUID();
      const r = await request(http).post(`/v1/partner/keys/${keys.a1.id}/revoke`).set({ ...bearer('aAdmin'), 'idempotency-key': idem }).send({ reason });
      expect(r.status).toBe(200);
      expect(r.body.data).toMatchObject({ id: keys.a1.id, keyPrefix: keys.a1.prefix, status: 'revoked' });
      after = (await machine()).status;
      // the replay of the same key: the same answer, nothing revoked twice, one audit row
      const again = await request(http).post(`/v1/partner/keys/${keys.a1.id}/revoke`).set({ ...bearer('aAdmin'), 'idempotency-key': idem }).send({ reason });
      expect(again.status).toBe(200); expect(again.body.data).toEqual(r.body.data);
    } finally { await setFlag('partner_api', false); }
    expect([before, after]).toEqual([200, 401]);
    const row = (await admin.query(`SELECT revoked_at, is_active, revoked_reason, revoked_by_user_id, scopes, rate_limit_per_hour, name, key_hash FROM partner_api_keys WHERE id = $1`, [keys.a1.id])).rows[0];
    expect(row.revoked_at).not.toBeNull(); expect(row.is_active).toBe(false);
    expect(row).toMatchObject({ revoked_reason: reason, revoked_by_user_id: people.aAdmin.id, rate_limit_per_hour: 1000, name: 'a1', scopes: ['partner:identity:read', 'lending:book:read'] });
    expect(isUsable({ isActive: row.is_active, revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null })).toBe(false);
    const audit = (await admin.query(`SELECT tenant_id, actor_user_id, reason, new_value FROM audit_log WHERE action = 'partner.key.revoked' AND entity_id = $1`, [keys.a1.id])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tenant_id: null, actor_user_id: people.aAdmin.id, reason, new_value: { partnerId: PA, keyPrefix: keys.a1.prefix } });
    expect(JSON.stringify(audit[0])).not.toContain(row.key_hash);
    // the read now says revoked, with the administrator's reason
    const list = await request(http).get('/v1/partner/keys').set(bearer('aViewer'));
    expect(list.body.data.find((k: { id: string }) => k.id === keys.a1.id)).toMatchObject({ status: 'revoked', revokedReason: reason });
    // no outbox event for a revoke (named: a partner.key_revoked event would need a handler and the relay gate)
    expect((await admin.query(`SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1`, [keys.a1.id])).rows[0].n).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) refused: viewer → 403; B\'s key by A\'s admin → 404 (untouched); revoked again → 409; a 5-character reason → 422; no Idempotency-Key → 400', async () => {
    const reason = 'rotating out a credential that left the team';
    const post = (who: string, id: string, body: Record<string, unknown>, key: string | null = randomUUID()) =>
      request(http).post(`/v1/partner/keys/${id}/revoke`).set({ ...bearer(who), ...(key ? { 'idempotency-key': key } : {}) }).send(body);
    const viewer = await post('aViewer', keys.a2.id, { reason });
    expect(viewer.status).toBe(403); expect(viewer.body.error.code).toBe('PARTNER_PERMISSION_MISSING');
    const other = await post('aAdmin', keys.b1.id, { reason });
    expect(other.status).toBe(404); expect(other.body.error.code).toBe('PARTNER_KEY_NOT_FOUND');
    expect(JSON.stringify(other.body)).not.toMatch(/not yours|another partner/i);
    expect((await admin.query(`SELECT revoked_at, is_active FROM partner_api_keys WHERE id = $1`, [keys.b1.id])).rows[0]).toEqual({ revoked_at: null, is_active: true });
    const twice = await post('aAdmin', keys.a1.id, { reason });
    expect(twice.status).toBe(409); expect(twice.body.error.code).toBe('PARTNER_KEY_ALREADY_REVOKED');
    const short = await post('aAdmin', keys.a2.id, { reason: 'leak!' });
    expect(short.status).toBe(422); expect(short.body.error.code).toBe('PARTNER_KEY_REASON_REQUIRED');
    const nokey = await post('aAdmin', keys.a2.id, { reason }, null);
    expect(nokey.status).toBe(400); expect(nokey.body.error.code).toBe('PARTNER_IDEMPOTENCY_KEY_REQUIRED');
    expect((await post('aAdmin', randomUUID(), { reason })).status).toBe(404);
    expect((await admin.query(`SELECT revoked_at FROM partner_api_keys WHERE id = $1`, [keys.a2.id])).rows[0].revoked_at).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) the walls at the database: no UPDATE of a key from kv_app or kv_partner; no hash, secret, payload or tenant to kv_partner; the policy alone scopes', async () => {
    expect(await errCode(asKvApp(PA, (c) => c.query(`UPDATE partner_api_keys SET is_active = true WHERE id = $1`, [keys.a3.id])))).toBe('42501');
    expect(await errCode(asKvApp(PA, (c) => c.query(`UPDATE partner_api_keys SET revoked_at = NULL WHERE id = $1`, [keys.a3.id])))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`UPDATE partner_api_keys SET is_active = true WHERE id = $1`, [keys.a3.id])))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT key_hash FROM partner_api_keys`)))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT secret_enc FROM partner_webhook_endpoints`)))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT payload FROM webhook_deliveries`)))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT tenant_id FROM webhook_deliveries`)))).toBe('42501');
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT tenant_id FROM webhook_delivery_attempts`)))).toBe('42501');
    // the definers: EXECUTE to kv_partner only — kv_app (non-inheriting member) cannot call them without wearing the role
    expect(await errCode(asKvApp(PA, (c) => c.query(`SELECT partner_console_revoke_key($1, 'a reason long enough to pass the rule', $2)`, [keys.a2.id, people.aAdmin.id])))).toBe('42501');
    expect(await errCode(asKvApp(PA, (c) => c.query(`SELECT * FROM partner_console_keys()`)))).toBe('42501');
    // with no partner in scope the definers answer NOTHING (NULL-guarded), never everything
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_console_keys()`))).rowCount).toBe(0);
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT * FROM partner_console_endpoints()`))).rowCount).toBe(0);
    expect(await errCode(asPartnerAxis(null, (c) => c.query(`SELECT partner_console_revoke_key($1, 'a reason long enough to pass the rule', $2)`, [keys.a2.id, people.aAdmin.id])))).toBe('PARTNER_KEY_NOT_FOUND');
    // the revoke definer itself refuses a person without the permission (defence in depth behind the route guard)
    expect(await errCode(asPartnerAxis(PA, (c) => c.query(`SELECT partner_console_revoke_key($1, 'a reason long enough to pass the rule', $2)`, [keys.a2.id, people.aViewer.id])))).toBe('PARTNER_PERMISSION_MISSING');
    // the deliveries policy ALONE (no WHERE clause): A sees exactly its five, B its one; nobody sees the tenant's
    const seen = async (p: string) => (await asPartnerAxis(p, (c) => c.query(`SELECT id FROM webhook_deliveries`))).rows.map((x) => x.id).sort();
    expect(await seen(PA)).toEqual([...aDeliveriesNewestFirst].sort());
    expect(await seen(PB)).toEqual([dels.b1]);
    expect((await asPartnerAxis(PA, (c) => c.query(`SELECT count(*)::int n FROM webhook_delivery_attempts`))).rows[0].n).toBe(2 + 1 + 2 + 2);
    expect((await asPartnerAxis(null, (c) => c.query(`SELECT count(*)::int n FROM webhook_deliveries`))).rows[0].n).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) webhooks: A\'s endpoints (no secret); deliveries newest first, keyset pages, the state filter; the detail with attempts, no payload; others → 404', async () => {
    const e = await request(http).get('/v1/partner/webhooks').set(bearer('aViewer'));
    expect(e.status).toBe(200);
    expect(e.body.data.map((x: { id: string }) => x.id).sort()).toEqual([eps.a1, eps.a2].sort());
    expect(e.body.data.find((x: { id: string }) => x.id === eps.a1)).toEqual({ id: eps.a1, url: 'https://hooks.fixture.test/a1', eventTypes: ['fintech.loan_repaid', 'fintech.loan_disbursed'], active: true, createdAt: expect.any(String) });
    expect(e.body.meta).toMatchObject({ subscribableEvents: [...PARTNER_WEBHOOK_EVENT_TYPES], retentionDays: 90 });
    expect(JSON.stringify(e.body)).not.toMatch(/ciphertext|loan\.application\.submitted|consent\.granted/);
    expect(deepKeys(e.body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);

    const page = async (cursor?: string) => request(http).get('/v1/partner/webhooks/deliveries').query({ limit: 2, ...(cursor ? { cursor } : {}) }).set(bearer('aViewer'));
    const p1 = await page(); const p2 = await page(p1.body.meta.nextCursor); const p3 = await page(p2.body.meta.nextCursor);
    const got = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((x: { id: string }) => x.id);
    expect(got).toEqual(aDeliveriesNewestFirst);
    expect([p1.body.data.length, p2.body.data.length, p3.body.data.length, p3.body.meta.nextCursor]).toEqual([2, 2, 1, null]);
    for (const p of [p1, p2, p3]) expect(deepKeys(p.body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    expect(JSON.stringify([p1.body, p2.body, p3.body])).not.toMatch(/919800000000|loanId|fixture"/);
    expect(p1.body.data[0]).toMatchObject({ id: dels.d1, endpointId: eps.a1, eventType: 'fintech.loan_repaid', state: 'delivered', attempts: 2, lastStatusCode: 200 });
    const ex = await request(http).get('/v1/partner/webhooks/deliveries').query({ state: 'exhausted' }).set(bearer('aViewer'));
    expect(ex.body.data.map((x: { id: string }) => x.id)).toEqual([dels.d2]);
    const byEndpoint = await request(http).get('/v1/partner/webhooks/deliveries').query({ endpointId: eps.a2 }).set(bearer('aViewer'));
    expect(byEndpoint.body.data.map((x: { id: string }) => x.id)).toEqual([dels.d5]);
    const byEvent = await request(http).get('/v1/partner/webhooks/deliveries').query({ eventType: 'fintech.loan_disbursed' }).set(bearer('aViewer'));
    expect(byEvent.body.data.map((x: { id: string }) => x.id)).toEqual([dels.d4]);

    const d = await request(http).get(`/v1/partner/webhooks/deliveries/${dels.d1}`).set(bearer('aViewer'));
    expect(d.status).toBe(200);
    expect(d.body.data.attemptsList.map((a: { attemptNo: number; outcome: string; statusCode: number }) => [a.attemptNo, a.outcome, a.statusCode])).toEqual([[1, 'failed', 503], [2, 'delivered', 200]]);
    expect(deepKeys(d.body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    expect(JSON.stringify(d.body)).not.toMatch(/919800000000|signatures/);
    for (const id of [dels.b1, dels.t1, randomUUID()]) {
      const x = await request(http).get(`/v1/partner/webhooks/deliveries/${id}`).set(bearer('aViewer'));
      expect([id, x.status, x.body.error.code]).toEqual([id, 404, 'PARTNER_DELIVERY_NOT_FOUND']);
    }
    const all = await request(http).get('/v1/partner/webhooks/deliveries').query({ limit: 100 }).set(bearer('aViewer'));
    expect(all.body.data.map((x: { id: string }) => x.id)).not.toEqual(expect.arrayContaining([dels.b1]));
    expect(all.body.data.map((x: { id: string }) => x.id)).not.toEqual(expect.arrayContaining([dels.t1]));
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) readiness: the six facts equal the fixture — an administrator with a second factor true for A, false for B (B\'s viewer has one)', async () => {
    const a = await request(http).get('/v1/partner/readiness').set(bearer('aViewer'));
    expect([a.status, a.status === 200 ? null : a.body]).toEqual([200, null]);
    const lastA = (await admin.query(`SELECT to_char(max(delivered_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at FROM webhook_deliveries WHERE id = ANY($1::uuid[]) AND state = 'delivered'`, [aDeliveriesNewestFirst])).rows[0].at;
    expect(a.body.data).toEqual({
      computedAt: expect.any(String),
      organisation: { active: true, ready: true },
      administrators: { count: 1, withTwoFactor: 1, ready: true },
      keys: { active: 1, ready: true },                                   // a2 only: a1 was revoked in (2), a3 was born revoked
      endpoints: { active: 1, ready: true },
      deliveries: { windowDays: 90, deliveredWithinWindow: true, lastDeliveredAt: lastA, ready: true },
      sla: { published: false, decisionHours: null, ready: false },
    });
    const b = await request(http).get('/v1/partner/readiness').set(bearer('bViewer'));
    expect(b.body.data).toMatchObject({
      administrators: { count: 1, withTwoFactor: 0, ready: false },
      keys: { active: 1, ready: true }, endpoints: { active: 1, ready: true },
      deliveries: { deliveredWithinWindow: true, ready: true }, sla: { published: true, decisionHours: 24, ready: true },
    });
    expect(JSON.stringify([a.body, b.body])).not.toMatch(/OneB (admin|viewer)|\+9197/);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7)
  it('(7) the invite lookup is a POST with the token in the body; GET /v1/partner/invites/<token> → 404', async () => {
    await resetRates();
    const inv = await request(http).post('/v1/partner/team/invites').set({ ...bearer('aAdmin'), 'idempotency-key': randomUUID() }).send({ phone: phoneOf(), roleCode: 'partner_viewer' });
    expect(inv.status).toBe(201);
    const token = inv.body.data.token as string;
    const look = await request(http).post('/v1/partner/invites/lookup').send({ token });
    expect(look.status).toBe(201);
    expect(look.body.data).toMatchObject({ organisation: 'Partner OneB Bank', roleCode: 'partner_viewer', status: 'pending' });
    expect((await request(http).get(`/v1/partner/invites/${token}`)).status).toBe(404);
    expect((await request(http).post('/v1/partner/invites/lookup').send({ token: 'x'.repeat(43) })).status).toBe(404);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (8)
  it('(8) kv_admin can never read an invitee\'s phone or an invite token (D5 — the 1a lead mutant\'s hole)', async () => {
    expect(await errCode(kvAdmin.query(`SELECT phone FROM partner_invites LIMIT 1`))).toBe('42501');
    expect(await errCode(kvAdmin.query(`SELECT token_hash FROM partner_invites LIMIT 1`))).toBe('42501');
    expect(await errCode(kvAdmin.query(`SELECT token_sealed FROM partner_invites LIMIT 1`))).toBe('42501');
    expect((await kvAdmin.query(`SELECT count(*)::int n FROM partner_invites WHERE partner_id = $1`, [PA])).rows[0].n).toBeGreaterThanOrEqual(1);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (9)
  it('(9) OFF-as-OFF: partner_console off → every new route answers 404', async () => {
    await setFlag('partner_console', false);
    try {
      const routes: Array<[string, string, Record<string, unknown>?]> = [
        ['get', '/v1/partner/keys'], ['post', `/v1/partner/keys/${keys.a2.id}/revoke`, { reason: 'a reason long enough to pass the rule' }],
        ['get', '/v1/partner/webhooks'], ['get', '/v1/partner/webhooks/deliveries'], ['get', `/v1/partner/webhooks/deliveries/${dels.d1}`],
        ['get', '/v1/partner/readiness'], ['post', '/v1/partner/invites/lookup', { token: 'x'.repeat(43) }],
      ];
      for (const [m, p, body] of routes) {
        const r = await (request(http) as any)[m](p).set({ ...bearer('aAdmin'), 'idempotency-key': randomUUID() }).send(body ?? {});
        expect([m, p, r.status]).toEqual([m, p, 404]);
      }
      expect((await admin.query(`SELECT revoked_at FROM partner_api_keys WHERE id = $1`, [keys.a2.id])).rows[0].revoked_at).toBeNull();
    } finally { await setFlag('partner_console', true); }
  });
});
