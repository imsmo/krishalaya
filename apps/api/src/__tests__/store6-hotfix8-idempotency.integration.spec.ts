// apps/api/src/__tests__/store6-hotfix8-idempotency.integration.spec.ts · PC-56 HOTFIX-8 · B12 — A REPLAYED KEY PAST ITS MEMORY ACTS
// DETERMINISTICALLY, LIVE. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as
// kv_app. The act is the address book's create (`POST /v1/addresses`, idempotent on an optional Idempotency-Key — the STORE-4a / HOTFIX-6
// shape: the key is hashed with the owner + the act, then scoped `<user>::identity.address.create::<hash>` by the service), so "a second
// act" is a second `addresses` row, counted by the admin pool. Own fixtures (one tenant, three people); nothing moves money.
//
//   (1) a key replayed inside 24 h → the stored body (the same id), ONE row — no second act;
//   (2) a key whose `expires_at` has passed but was not purged (UPDATEd into the past) → acts ONCE more, deterministically: a new row and a
//       new id, the idempotency row re-claimed (a fresh `expires_at` ~24 h ahead, the new answer stored); a third call → the NEW stored body,
//       no third row;
//   (3) the same key from another person → a separate act (their own row and id), never the first person's response;
//   (4) a key whose first run failed (422 ADDRESS_LABEL_UNKNOWN) → the row freed (none left), a retry with the same key acts (201);
//   (5) the metric `idempotency.reclaimed_expired` { endpoint } counted once per re-claim (not on a live replay);
//   (6) named behaviour: a claim row still "in flight" (`response_status IS NULL`) with `expires_at` past → re-claimed (the second run acts);
//       the same row with `expires_at` ahead → 409 (still in progress) as before.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID, createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { METRICS } from '../core/observability/metrics';
import type { PromMetrics } from '../core/observability/metrics.prom';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const ENDPOINT = 'identity.address.create';

run('PC-56 HOTFIX-8 · B12 · the idempotency key honours expires_at (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID();
  const U: Record<string, string> = {};
  const T: Record<string, string> = {};
  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': LIVE });
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const create = (who: string, key: string, body: Record<string, unknown> = {}) =>
    request(http).post('/v1/addresses').set({ ...H(T[who]), 'idempotency-key': key }).send({ line1: `Plot ${randomUUID().slice(0, 6)}, GIDC Vadal`, countryCode: 'in', ...body });
  /** The idempotency row's key, exactly as the address service + PgIdempotencyService scope it. */
  const scopedKey = (who: string, key: string) => `${U[who]}::${ENDPOINT}::${createHash('sha256').update(`address.create:${U[who]}:${key}`).digest('base64url')}`;
  const idemRow = async (who: string, key: string) =>
    (await admin.query(`SELECT response_status, response_body, created_at, expires_at, (expires_at - now()) > interval '23 hours' AS fresh FROM idempotency_keys WHERE key = $1`, [scopedKey(who, key)])).rows[0];
  const rows = async (who: string) => Number((await admin.query(`SELECT count(*)::int AS n FROM addresses WHERE user_id = $1`, [U[who]])).rows[0].n);
  const reclaimed = (): number => {
    const m = app.get(METRICS) as PromMetrics;
    const line = m.render().split('\n').find((l) => l.startsWith(`idempotency_reclaimed_expired{endpoint="${ENDPOINT}"} `));
    return line ? Number(line.split(' ').pop()) : 0;
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO hf8 ${LIVE.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = $1`, [LIVE]);
    for (const k of ['farmer', 'neighbour', 'retry']) U[k] = await makeUser(admin);
    for (const k of Object.keys(U)) {
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'customer' ON CONFLICT DO NOTHING`, [U[k], LIVE]);
    }
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const k of Object.keys(U)) T[k] = mintToken(app, { userId: U[k], tenantId: LIVE, roles: ['customer'], perms: [] });
  }, 240_000);
  afterAll(async () => {
    await admin?.query(`DELETE FROM idempotency_keys WHERE user_id = ANY($1::uuid[])`, [Object.values(U)]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  const KEY = `hf8:${randomUUID()}`;
  let firstId = '';
  it('(1) a key replayed inside 24 h → the stored body (the same id), ONE row — no second act; no re-claim counted', async () => {
    const before = reclaimed();
    const a = await create('farmer', KEY); const b = await create('farmer', KEY);
    expect([a.status, b.status]).toEqual([201, 201]);
    firstId = a.body.data.id;
    expect(b.body.data.id).toBe(firstId);
    expect(await rows('farmer')).toBe(1);
    const r = await idemRow('farmer', KEY);
    expect(r.response_status).toBe(200); expect(r.response_body).toEqual({ id: firstId }); expect(r.fresh).toBe(true);
    expect(reclaimed()).toBe(before);
  });

  it('(2) the key past its expires_at (not purged) → acts ONCE more, deterministically; the row re-claimed fresh; a third call → the NEW stored body', async () => {
    await admin.query(`UPDATE idempotency_keys SET expires_at = now() - interval '1 minute', created_at = now() - interval '25 hours' WHERE key = $1`, [scopedKey('farmer', KEY)]);
    const before = reclaimed();
    const c = await create('farmer', KEY);
    expect(c.status).toBe(201);
    const secondId = c.body.data.id as string;
    expect(secondId).not.toBe(firstId);                                   // a new act, not the expired answer
    expect(await rows('farmer')).toBe(2);
    const r = await idemRow('farmer', KEY);
    expect(r.fresh).toBe(true);                                           // expires_at = now() + 24 h again
    expect(r.response_status).toBe(200); expect(r.response_body).toEqual({ id: secondId });
    expect(new Date(r.created_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
    const d = await create('farmer', KEY);                                // the third call replays the NEW answer
    expect([d.status, d.body.data.id]).toEqual([201, secondId]);
    expect(await rows('farmer')).toBe(2);
    expect(reclaimed()).toBe(before + 1);                                 // (5) counted once — the replay is not a re-claim
  });

  it('(3) the same key from another person → a separate act, never the first person\'s response', async () => {
    const n = await create('neighbour', KEY);
    expect(n.status).toBe(201);
    expect(n.body.data.id).not.toBe(firstId);
    const mine = (await admin.query(`SELECT user_id FROM addresses WHERE id = $1`, [n.body.data.id])).rows[0];
    expect(mine.user_id).toBe(U.neighbour);
    expect(await rows('neighbour')).toBe(1);
    expect(await rows('farmer')).toBe(2);
    expect(scopedKey('neighbour', KEY)).not.toBe(scopedKey('farmer', KEY));
  });

  it('(4) a key whose first run failed → the row freed, a retry with the same key acts', async () => {
    const key = `hf8:${randomUUID()}`;
    expect(refusal(await create('retry', key, { labelId: randomUUID() }))).toEqual([422, 'ADDRESS_LABEL_UNKNOWN']);
    expect(await idemRow('retry', key)).toBeUndefined();                  // released — failures are never cached
    expect(await rows('retry')).toBe(0);
    const ok = await create('retry', key);
    expect(ok.status).toBe(201);
    expect(await rows('retry')).toBe(1);
    expect((await idemRow('retry', key)).response_body).toEqual({ id: ok.body.data.id });
  });

  it('(5)+(6) a claim still "in flight" past its expiry is re-claimed (the named two-runs case, counted); in flight and live → 409 as before', async () => {
    const live = `hf8:${randomUUID()}`; const stale = `hf8:${randomUUID()}`;
    await admin.query(`INSERT INTO idempotency_keys (key, user_id, endpoint, response_status, response_body, created_at, expires_at) VALUES ($1, $2, $3, NULL, NULL, now(), now() + interval '24 hours')`, [scopedKey('retry', live), U.retry, ENDPOINT]);
    await admin.query(`INSERT INTO idempotency_keys (key, user_id, endpoint, response_status, response_body, created_at, expires_at) VALUES ($1, $2, $3, NULL, NULL, now() - interval '25 hours', now() - interval '1 hour')`, [scopedKey('retry', stale), U.retry, ENDPOINT]);
    const before = reclaimed(); const n0 = await rows('retry');
    expect((await create('retry', live)).status).toBe(409);
    expect(await rows('retry')).toBe(n0);
    const s = await create('retry', stale);
    expect(s.status).toBe(201);
    expect(await rows('retry')).toBe(n0 + 1);
    expect((await idemRow('retry', stale)).response_body).toEqual({ id: s.body.data.id });
    expect(reclaimed()).toBe(before + 1);
  });
});
