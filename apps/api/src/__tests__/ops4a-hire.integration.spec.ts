// apps/api/src/__tests__/ops4a-hire.integration.spec.ts · PC-56 OPS-4a · THE HIRE, LIVE. The real AppModule over HTTP (supertest — listening
// ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. No migration (238).
// FLAG: `equipment` is seeded OFF and switched ON for THIS organisation only (an allow-list fixture, `rules.tenant_ids`), restored in
// afterAll — every equipment route answers 404 otherwise, and the rules under test live behind it.
//
// Survey §7 `ops4a-hire` items, verbatim: `GET rentals?box=owner` returns only hires on the caller's machines; `GET /:id/rates?assetId=` 200
// (the SDK call pinned); `setRate` → one `audit_log` row with before/after; overwrite of a snapshotted rate → `RATE_ALREADY_PRICED_A_HIRE`;
// `quote` and `cancel` audited, cancel without a key → 400; today's truths pinned: two hires of one machine for one hour both accepted (F-9)
// — so B12 turns it red; a rate effective tomorrow-in-IST and a 23:30-IST `scheduledAt` resolve the IST day (E14); absence → 404:
// `POST /rentals/:id/dispute`, `GET /equipment/assets/:id/calendar`, `GET /equipment/insights`.
// Plus (brief §C): cancel with a key and a reason → one audit row.
// THE NO-RENTER-APP FACT, API side: `POST /rentals/:id/confirm-usage` exists and is the renter's alone — pinned live in
// hotfix13-her-money.integration.spec.ts (1) ("the owner calling confirm-usage → refused") and NOT duplicated here. The client side (no web
// or mobile source calls `confirmRentalUsage`) is a source assertion in apps/web-ops/src/test/ops4a-pages.spec.ts.
//
// E14, the IST/UTC pair: the organisation is in India (`makeTenant` → country 'IN' → Asia/Kolkata). A hire at 19:00 UTC on day D is 00:30 on
// D+1 in India: it must take the line that starts on D+1. A hire at 18:00 UTC on D (23:30 on D in India) takes the line of D. The process
// zone is irrelevant (the conversion is SQL); the wave runs this file under TZ=Asia/Kolkata and under TZ=UTC.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;

run('PC-56 OPS-4a · the hire (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const T1 = randomUUID();
  let O = ''; let O2 = ''; let R = ''; let R2 = '';
  let asset1 = ''; let asset2 = ''; let asset3 = '';
  const tok: Record<string, string> = {};
  let backup: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown } | undefined;
  const D = '2027-03-10'; const D1 = '2027-03-11';

  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': T1 });
  const post = (token: string, path: string, body: object = {}, key: string | null = randomUUID()) =>
    request(http).post(path).set(key ? { ...H(token), 'idempotency-key': key } : H(token)).send(body);
  const get = (token: string, path: string) => request(http).get(path).set(H(token));
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const audits = (id: string, action: string) => admin.query(`SELECT old_value, new_value, reason FROM audit_log WHERE entity_id = $1 AND action = $2 ORDER BY created_at`, [id, action]).then((r) => r.rows);
  const hire = (renterTok: string, assetId: string, scheduledAt: string, est = '4.00') =>
    post(renterTok, '/v1/equipment/rentals', { assetId, rateBasis: 'per_hour', estQuantity: est, scheduledAt });

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, T1, `OPS4A ${T1.slice(0, 4)}`);
    [O, O2, R, R2] = await Promise.all(Array.from({ length: 4 }, () => makeUser(admin)));
    const role = (u: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, T1, code]);
    await role(O, 'equipment_owner'); await role(O2, 'equipment_owner'); await role(R, 'farmer'); await role(R2, 'farmer');

    backup = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = 'equipment'`)).rows[0];
    expect([backup?.key, backup?.is_enabled]).toEqual(['equipment', false]);   // seeded OFF
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $1::jsonb WHERE key = 'equipment'`, [JSON.stringify({ tenant_ids: [T1] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const c of ['flag:equipment', 'flagstale:equipment', 'flags:all', `flagctx:${T1}`]) await cache.del(c);

    tok.O = mintToken(app, { userId: O, tenantId: T1, roles: ['equipment_owner'], perms: ['equipment.manage'] });
    tok.O2 = mintToken(app, { userId: O2, tenantId: T1, roles: ['equipment_owner'], perms: ['equipment.manage'] });
    tok.R = mintToken(app, { userId: R, tenantId: T1, roles: ['farmer'], perms: ['equipment.rent'] });
    tok.R2 = mintToken(app, { userId: R2, tenantId: T1, roles: ['farmer'], perms: ['equipment.rent'] });

    const categoryId = (await admin.query(`SELECT id FROM categories ORDER BY id LIMIT 1`)).rows[0].id;
    const mk = async (t: string) => { const a = await post(t, '/v1/equipment/assets', { categoryId, hpRating: 45 }); expect(a.status).toBe(201); return a.body.data.id as string; };
    asset1 = await mk(tok.O); asset2 = await mk(tok.O2); asset3 = await mk(tok.O);
    // asset1: one line from long ago, ₹150/h; asset2 (another owner's): the same.
    for (const [t, a] of [[tok.O, asset1], [tok.O2, asset2]] as const)
      expect((await post(t, `/v1/equipment/assets/${a}/rates`, { rateBasis: 'per_hour', rateMinor: '15000', includesOperator: true, includesFuel: false, effectiveFrom: '2026-01-01' }, null)).status).toBe(201);
  }, 180_000);

  afterAll(async () => {
    try { if (backup) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [backup.key, backup.is_enabled, backup.rollout_pct, JSON.stringify(backup.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('GET rentals?box=owner returns only hires on the caller\'s machines (and box is what the SDK must send: the default is the renter list)', async () => {
    const h1 = await hire(tok.R, asset1, '2027-02-01T05:00:00.000Z'); const h2 = await hire(tok.R, asset2, '2027-02-01T05:00:00.000Z');
    expect([h1.status, h2.status]).toEqual([201, 201]);
    const mine = await get(tok.O, '/v1/equipment/rentals?box=owner&limit=100');
    expect(mine.status).toBe(200);
    const ids = (mine.body.data as { id: string; assetId: string }[]);
    expect(ids.map((x) => x.id)).toContain(h1.body.data.id);
    expect(ids.map((x) => x.id)).not.toContain(h2.body.data.id);
    expect(ids.every((x) => x.assetId === asset1 || x.assetId === asset3)).toBe(true);
    // today's truth the SDK fix answers: no box → the caller's OWN hires as a renter (the owner has none)
    expect((await get(tok.O, '/v1/equipment/rentals')).body.data).toEqual([]);
  });

  it('GET /:id/rates?assetId= → 200 with the lines (the SDK call pinned); without assetId → 422 (the strict query refuses it: why the old SDK always failed)', async () => {
    const ok = await get(tok.R, `/v1/equipment/assets/${asset1}/rates?assetId=${asset1}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.map((l: { rateMinor: string; effectiveFrom: string }) => [l.rateMinor, l.effectiveFrom])).toEqual([['15000', '2026-01-01']]);
    expect((await get(tok.R, `/v1/equipment/assets/${asset1}/rates`)).status).toBe(422);
  });

  it('setRate → ONE audit_log row with before (null) and after; overwriting an unused line → one more row with before / after', async () => {
    const a = await post(tok.O, `/v1/equipment/assets/${asset3}/rates`, { rateBasis: 'per_hour', rateMinor: '20000', includesOperator: true, includesFuel: false, effectiveFrom: D }, null);
    expect(a.status).toBe(201);
    const id = a.body.data.id as string;
    let rows = await audits(id, 'equipment.rate.set');
    expect(rows.length).toBe(1); expect(rows[0].old_value).toBeNull(); expect([rows[0].new_value.rateMinor, rows[0].new_value.effectiveFrom]).toEqual(['20000', D]);
    const b = await post(tok.O, `/v1/equipment/assets/${asset3}/rates`, { rateBasis: 'per_hour', rateMinor: '10000', includesOperator: true, includesFuel: false, effectiveFrom: D }, null);
    expect([b.status, b.body.data.id]).toEqual([201, id]);
    rows = await audits(id, 'equipment.rate.set');
    expect(rows.length).toBe(2); expect([rows[1].old_value.rateMinor, rows[1].new_value.rateMinor]).toEqual(['20000', '10000']);
    expect([rows[1].old_value.effectiveFrom, rows[1].new_value.effectiveFrom]).toEqual([D, D]);   // the line's day read back is its own day, in any process zone
  });

  it('E14 · the IST/UTC pair: a hire at 00:30 IST on D+1 (19:00 UTC on D) takes the line starting D+1; one at 23:30 IST on D takes D\'s', async () => {
    expect((await post(tok.O, `/v1/equipment/assets/${asset3}/rates`, { rateBasis: 'per_hour', rateMinor: '25000', includesOperator: true, includesFuel: false, effectiveFrom: D1 }, null)).status).toBe(201);
    const late = await hire(tok.R, asset3, `${D}T19:00:00.000Z`);
    expect(late.status).toBe(201); expect(late.body.data.rateMinor).toBe('25000');   // the UTC slice would have given D's 10000
    const before = await hire(tok.R, asset3, `${D}T18:00:00.000Z`);
    expect(before.status).toBe(201); expect(before.body.data.rateMinor).toBe('10000');
  });

  it('overwriting a line that has priced a hire → 409 RATE_ALREADY_PRICED_A_HIRE; the line and the audit log unchanged', async () => {
    const line = (await admin.query(`SELECT id, rate_minor::text r FROM equipment_rates WHERE asset_id = $1 AND effective_from = $2::date`, [asset3, D])).rows[0];
    const n0 = (await audits(line.id, 'equipment.rate.set')).length;
    const r = await post(tok.O, `/v1/equipment/assets/${asset3}/rates`, { rateBasis: 'per_hour', rateMinor: '99900', includesOperator: true, includesFuel: false, effectiveFrom: D }, null);
    expect([r.status, r.body.error?.code]).toEqual([409, 'RATE_ALREADY_PRICED_A_HIRE']);
    expect((await admin.query(`SELECT rate_minor::text r FROM equipment_rates WHERE id = $1`, [line.id])).rows[0].r).toBe(line.r);
    expect((await audits(line.id, 'equipment.rate.set')).length).toBe(n0);
    // the line of D+1 priced the 00:30-IST hire too; a line of a day NO hire is on can still be set
    expect((await post(tok.O, `/v1/equipment/assets/${asset3}/rates`, { rateBasis: 'per_hour', rateMinor: '1', includesOperator: true, includesFuel: false, effectiveFrom: D1 }, null)).body.error?.code).toBe('RATE_ALREADY_PRICED_A_HIRE');
    expect((await post(tok.O, `/v1/equipment/assets/${asset3}/rates`, { rateBasis: 'per_hour', rateMinor: '26000', includesOperator: true, includesFuel: false, effectiveFrom: '2027-06-01' }, null)).status).toBe(201);
  });

  it('quote → one audit row with the deposit before and after', async () => {
    const h = await hire(tok.R2, asset1, '2027-02-02T05:00:00.000Z');
    const id = h.body.data.id as string;
    expect((await post(tok.O, `/v1/equipment/rentals/${id}/quote`, { advanceMinor: '30000' }, null)).status).toBe(201);
    const rows = await audits(id, 'equipment.booking.quoted');
    expect(rows.length).toBe(1);
    expect([rows[0].old_value, rows[0].new_value]).toEqual([{ status: 'requested', advanceMinor: '0' }, { status: 'quoted', advanceMinor: '30000' }]);
  });

  it('cancel without an Idempotency-Key → 400, nothing changes; with a key and a reason → cancelled, ONE audit row; a stray field → refused', async () => {
    const h = await hire(tok.R2, asset1, '2027-02-03T05:00:00.000Z');
    const id = h.body.data.id as string;
    const nokey = await post(tok.R2, `/v1/equipment/rentals/${id}/cancel`, { reason: 'rain' }, null);
    expect(nokey.status).toBe(400);
    expect((await admin.query(`SELECT status FROM equipment_bookings WHERE id = $1`, [id])).rows[0].status).toBe('requested');
    expect((await post(tok.R2, `/v1/equipment/rentals/${id}/cancel`, { reason: 'rain', refundMinor: '1' })).status).toBe(422);
    expect((await post(tok.R, `/v1/equipment/rentals/${id}/cancel`, { reason: 'rain' })).status).toBe(403);   // not a party
    const key = randomUUID();
    const ok = await post(tok.R2, `/v1/equipment/rentals/${id}/cancel`, { reason: 'rain' }, key);
    expect([ok.status, ok.body.data.status]).toEqual([201, 'cancelled']);
    expect((await post(tok.R2, `/v1/equipment/rentals/${id}/cancel`, { reason: 'rain' }, key)).status).toBe(201);   // a replay, the same answer
    const rows = await audits(id, 'equipment.booking.cancelled');
    expect(rows.length).toBe(1);
    expect([rows[0].old_value, rows[0].new_value]).toEqual([{ status: 'requested' }, { status: 'cancelled', refundMinor: '0', reason: 'rain' }]);
  });

  it('TODAY\'S TRUTH (F-9): two hires of ONE machine for the SAME hour are both accepted — the booking-integrity wave (B12) turns this red', async () => {
    const at = '2027-02-05T04:30:00.000Z';
    const a = await hire(tok.R, asset1, at); const b = await hire(tok.R2, asset1, at);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(await n(`SELECT count(*)::int n FROM equipment_bookings WHERE asset_id = $1 AND scheduled_at = $2::timestamptz AND status = 'requested'`, [asset1, at])).toBe(2);
  });

  it('absence → 404: a dispute, a machine calendar, equipment insights (none exists on the platform)', async () => {
    const h = await hire(tok.R, asset1, '2027-02-06T05:00:00.000Z');
    expect((await post(tok.R, `/v1/equipment/rentals/${h.body.data.id}/dispute`, { reason: 'x' })).status).toBe(404);
    expect((await get(tok.O, `/v1/equipment/assets/${asset1}/calendar`)).status).toBe(404);
    expect((await get(tok.O, '/v1/equipment/insights')).status).toBe(404);
  });
});
