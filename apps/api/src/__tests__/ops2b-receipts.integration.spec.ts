// apps/api/src/__tests__/ops2b-receipts.integration.spec.ts · PC-56 OPS-2b — RECEIPTS AND QUALITY, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app. Own fixtures (no
// `makeCategory` / `makeProduct` — the known two-type parameter trap; the ops1a / ops2c shape). `warehousing` and `fintech` stay OFF in the seed and
// are switched ON for THIS organisation only (an allow-list in each flag's rules — the fixture, not the product), restored in afterAll; the seeded
// OFF state of both is asserted first.
//
// THE RECEIPTS ARE SEEDED BY FIXTURE SQL, ON PURPOSE: no route can create one any more (B2 refuses eNWR issue by name), so the records this spec
// reads, releases and cancels are inserted directly as the admin role — the shape of a receipt recorded before OPS-2b.
//
// What it proves (brief §C = survey §7 `ops2b-receipts` items 1–6; founder Q3-A, Q4-A, Q5-A, Q7-A, Q11-A, Q13-A, 2026-11-06):
//   (1) B2: `POST /v1/warehousing/nwr` on a stored booking → 409 ENWR_ISSUE_NOT_ON_PLATFORM; no `nwr_receipts`, `audit_log`, `outbox_events` or
//       `idempotency_keys` row; a replay with the same key → the same refusal.
//   (2) B1: `POST …/nwr/:id/release` → 409 ENWR_RELEASE_NOT_STANDALONE, status unchanged. `…/cancel` by a tenant_admin who is NOT the operator →
//       403 WAREHOUSE_OPERATOR_ONLY; by the operator without a key → 400; without a reason → 400 ENWR_CANCEL_REASON_REQUIRED; with both →
//       `cancelled` + exactly ONE audit row (before/after + the reason); the same key again → the same response, no second row.
//   (3) Assay: record on `confirmed` → 409 BOOKING_NOT_STORED; on `stored` by the operator → 201 + ONE audit row; by a non-operator tenant_admin →
//       403 WAREHOUSE_OPERATOR_ONLY (Q11-A strict on this act); `GET …/:id/assays` by the depositor → hers; by another farmer → 404.
//   (4) Register: `GET …/nwr?box=all` by the operator → the tenant's receipts, holder and valuation PRESENT in the API body (today's truth — the
//       console drops them); by a farmer → 403; `box=mine` by the holder → hers only; tenant B sees none of tenant A's.
//   (5) B8: `POST /v1/fintech/loan-applications` with `nwrId` → 422 LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM, nothing written or remembered; without → 201.
//   (6) Absence → 404: pledge, partial release, transfer, a depositor OTP, an assay certificate PDF, a public certificate page.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser, ensureUnitCurrency } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const ISSUE = 'This platform does not issue an eNWR. No receipt is recorded here in a depositor\'s name. Nothing was recorded.';
const RELEASE = 'A receipt is never released on its own. The release of stored goods is paused, so no receipt is released here. Nothing was changed.';
const REASON = 'A reason is required to cancel a receipt. Nothing was changed.';
const OPERATOR_ONLY = 'Only this warehouse\'s named operator can do this. Nothing was changed.';
const PLEDGE = 'A loan application cannot name a warehouse receipt: pledging a warehouse receipt is not on this platform. Nothing was applied for.';

run('PC-56 OPS-2b · receipts and quality (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const A = randomUUID(); const B = randomUUID();
  let operator = ''; let otherAdmin = ''; let depositor = ''; let farmer2 = ''; let opB = ''; let depB = '';
  let warehouseId = ''; let whB = ''; let productId = ''; let loanProductId = '';
  const bk: Record<string, string> = {}; const rc: Record<string, string> = {};
  const T: Record<string, string> = {};
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const H = (token: string, tenant = A) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenant });
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const role = (userId: string, tenant: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenant, code]);
  const booking = async (tenant: string, wh: string, dep: string, status: 'confirmed' | 'stored') => {
    const id = randomUUID();
    await admin.query(`INSERT INTO storage_bookings (id, tenant_id, warehouse_id, depositor_user_id, product_id, quantity, unit_code, status, stored_at, created_by)
      VALUES ($1, $2, $3, $4, $5, 62.6, 'quintal', $6::text, $7::timestamptz, $4)`, [id, tenant, wh, dep, productId, status, status === 'stored' ? new Date(Date.now() - 5 * 86400000) : null]);
    return id;
  };
  // FIXTURE SQL (no route can create a receipt since B2): a receipt as it was recorded before OPS-2b.
  const receipt = async (tenant: string, bookingId: string, holder: string, no: string) => {
    const id = randomUUID();
    await admin.query(`INSERT INTO nwr_receipts (id, tenant_id, storage_booking_id, repository, enwr_no, holder_user_id, quantity, valuation_minor, status, issued_at, created_by)
      VALUES ($1, $2, $3, 'NERL', $4, $5, 62.6, 39062400, 'issued', now() - interval '3 days', $5)`, [id, tenant, bookingId, no, holder]);
    return id;
  };
  const status = async (id: string) => (await admin.query(`SELECT status::text s FROM nwr_receipts WHERE id = $1`, [id])).rows[0].s as string;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, A, `Ops 2b ${A.slice(0, 4)}`); await makeTenant(admin, B, `Ops 2b B ${B.slice(0, 4)}`);
    [operator, otherAdmin, depositor, farmer2, opB, depB] = await Promise.all(Array.from({ length: 6 }, () => makeUser(admin)));
    await role(operator, A, 'tenant_admin'); await role(otherAdmin, A, 'tenant_admin'); await role(depositor, A, 'farmer'); await role(farmer2, A, 'farmer');
    await role(opB, B, 'tenant_admin'); await role(depB, B, 'farmer');

    const categoryId = randomUUID(); const code = `ops2b_${A.replace(/-/g, '').slice(0, 10)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1, $2, 'Test Category', $3::ltree, 1, true)`, [categoryId, code, code]);
    productId = randomUUID();
    await ensureUnitCurrency(admin, 'quintal');
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
      VALUES ($1, $2, 'Test Product', 'quintal', NULL, true, to_tsvector('simple', 'Test Product'))`, [productId, categoryId]);
    warehouseId = randomUUID(); whB = randomUUID();
    await admin.query(`INSERT INTO warehouses (id, tenant_id, operator_user_id, default_name, rate_per_qtl_month_minor, is_active, created_by) VALUES ($1, $2, $3, 'Test warehouse', 900, true, $3)`, [warehouseId, A, operator]);
    await admin.query(`INSERT INTO warehouses (id, tenant_id, operator_user_id, default_name, rate_per_qtl_month_minor, is_active, created_by) VALUES ($1, $2, $3, 'Test warehouse B', 900, true, $3)`, [whB, B, opB]);
    bk.stored = await booking(A, warehouseId, depositor, 'stored');       // the B2 target + the assay target (no receipt on it)
    bk.confirmed = await booking(A, warehouseId, depositor, 'confirmed');
    bk.r1 = await booking(A, warehouseId, depositor, 'stored'); bk.r2 = await booking(A, warehouseId, depositor, 'stored');
    bk.other = await booking(A, warehouseId, farmer2, 'stored'); bk.b = await booking(B, whB, depB, 'stored');
    const sfx = randomUUID().slice(0, 8);
    rc.r1 = await receipt(A, bk.r1, depositor, `TEST-R1-${sfx}`); rc.r2 = await receipt(A, bk.r2, depositor, `TEST-R2-${sfx}`);
    rc.other = await receipt(A, bk.other, farmer2, `TEST-RO-${sfx}`); rc.b = await receipt(B, bk.b, depB, `TEST-RB-${sfx}`);

    // the loan product (B8)
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'crop' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const partnerId = randomUUID();
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind, regulator_ref, sla) VALUES ($1, $2, 'Ops Two B Test Bank', 'bank', 'LIC-TEST-2B01', '{}'::jsonb)`, [partnerId, `o2b_${sfx}`]);
    loanProductId = (await admin.query(`INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
      VALUES ($1, $2, 'Test crop loan', 100000, 50000000, 1100, 'harvest_aligned') RETURNING id`, [partnerId, kind])).rows[0].id;

    for (const key of ['warehousing', 'fintech']) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      expect([b?.key, b?.is_enabled]).toEqual([key, false]);   // seeded OFF
      backups.push(b);
    }
    // FIXTURE: `warehousing` ON for A and B only, `fintech` ON for A only (rules.tenant_ids), so the routes under test answer; restored in afterAll.
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $1::jsonb WHERE key = 'warehousing'`, [JSON.stringify({ tenant_ids: [A, B] })]);
    await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $1::jsonb WHERE key = 'fintech'`, [JSON.stringify({ tenant_ids: [A] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const k of ['warehousing', 'fintech']) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${A}`, `flagctx:${B}`]) await cache.del(c);

    // tenant_admin carries warehouse.manage AND booking.manage (0004) — the `booking.manage` escape this wave closes on cancel and assay record.
    T.op = mintToken(app, { userId: operator, tenantId: A, roles: ['tenant_admin'], perms: ['warehouse.manage', 'booking.manage'] });
    T.admin = mintToken(app, { userId: otherAdmin, tenantId: A, roles: ['tenant_admin'], perms: ['warehouse.manage', 'booking.manage'] });
    T.dep = mintToken(app, { userId: depositor, tenantId: A, roles: ['farmer'], perms: ['warehouse.store', 'loan.borrow'] });
    T.f2 = mintToken(app, { userId: farmer2, tenantId: A, roles: ['farmer'], perms: ['warehouse.store'] });
    T.opB = mintToken(app, { userId: opB, tenantId: B, roles: ['tenant_admin'], perms: ['warehouse.manage', 'booking.manage'] });
  }, 120_000);

  afterAll(async () => {
    for (const b of backups) {
      try { await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) B2: eNWR issue → 409 ENWR_ISSUE_NOT_ON_PLATFORM; no receipt, audit, outbox or idempotency row; a replay is refused the same', async () => {
    const key = randomUUID();
    const before = [await n(`SELECT count(*)::int n FROM nwr_receipts WHERE tenant_id = $1`, [A]),
      await n(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND action = 'warehousing.nwr.issued'`, [A]),
      await n(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id = $1 AND event_type = 'warehousing.nwr_issued'`, [A])];
    for (let i = 0; i < 2; i++) {
      const r = await request(http).post('/v1/warehousing/nwr').set({ ...H(T.op), 'idempotency-key': key })
        .send({ storageBookingId: bk.stored, repository: 'NERL', enwrNo: `TEST-ISSUE-${key.slice(0, 8)}`, valuationMinor: '39062400' });
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, 'ENWR_ISSUE_NOT_ON_PLATFORM', ISSUE]);
    }
    expect([await n(`SELECT count(*)::int n FROM nwr_receipts WHERE tenant_id = $1`, [A]),
      await n(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND action = 'warehousing.nwr.issued'`, [A]),
      await n(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id = $1 AND event_type = 'warehousing.nwr_issued'`, [A])]).toEqual(before);
    expect(await n(`SELECT count(*)::int n FROM nwr_receipts WHERE storage_booking_id = $1`, [bk.stored])).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM idempotency_keys WHERE key LIKE $1`, [`%::${key}`])).toBe(0);
  });

  it('(2) B1: standalone release refused by name; cancel — not the operator 403, no key 400, no reason 400, then one audit row and an idempotent replay', async () => {
    const rel = await request(http).post(`/v1/warehousing/nwr/${rc.r1}/release`).set({ ...H(T.op), 'idempotency-key': randomUUID() }).send({});
    expect([rel.status, rel.body.error?.code, rel.body.error?.message]).toEqual([409, 'ENWR_RELEASE_NOT_STANDALONE', RELEASE]);
    expect(await status(rc.r1)).toBe('issued');

    const audit = () => admin.query(`SELECT actor_user_id, old_value, new_value, reason FROM audit_log WHERE entity_id = $1 AND action = 'warehousing.nwr.cancelled'`, [rc.r2]);
    const cancel = (token: string, body: object, key?: string) => request(http).post(`/v1/warehousing/nwr/${rc.r2}/cancel`).set(key ? { ...H(token), 'idempotency-key': key } : H(token)).send(body);
    const notOp = await cancel(T.admin, { reason: 'test reason' }, randomUUID());
    expect([notOp.status, notOp.body.error?.code, notOp.body.error?.message]).toEqual([403, 'WAREHOUSE_OPERATOR_ONLY', OPERATOR_ONLY]);
    const noKey = await cancel(T.op, { reason: 'test reason' });
    expect(noKey.status).toBe(400);
    const noReason = await cancel(T.op, {}, randomUUID());
    expect([noReason.status, noReason.body.error?.code, noReason.body.error?.message]).toEqual([400, 'ENWR_CANCEL_REASON_REQUIRED', REASON]);
    const blank = await cancel(T.op, { reason: '   ' }, randomUUID());
    expect([blank.status, blank.body.error?.code]).toEqual([400, 'ENWR_CANCEL_REASON_REQUIRED']);
    expect([await status(rc.r2), (await audit()).rows.length]).toEqual(['issued', 0]);

    const key = randomUUID();
    const ok = await cancel(T.op, { reason: 'Recorded against the wrong booking' }, key);
    expect([ok.status, ok.body.data?.id, ok.body.data?.status]).toEqual([201, rc.r2, 'cancelled']);
    let rows = (await audit()).rows;
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({ actor_user_id: operator, old_value: { status: 'issued' }, new_value: { status: 'cancelled' }, reason: 'Recorded against the wrong booking' });
    const again = await cancel(T.op, { reason: 'Recorded against the wrong booking' }, key);
    expect([again.status, again.body.data]).toEqual([201, ok.body.data]);
    rows = (await audit()).rows;
    expect(rows.length).toBe(1);
    expect(await status(rc.r2)).toBe('cancelled');
  });

  it('(3) assay: confirmed → 409; the operator on stored → 201 + one audit row; a non-operator admin → 403 by name; reads: the depositor yes, another farmer 404', async () => {
    const rec = (token: string, id: string) => request(http).post(`/v1/warehousing/storage-bookings/${id}/assays`).set(H(token))
      .send({ storageBookingId: id, assayerName: 'Test lab', parameters: { moisture: '11.5', grade: 'FAQ' }, validUntil: '2026-12-31' });
    const auditN = () => n(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND action = 'warehousing.assay.recorded'`, [A]);
    const notStored = await rec(T.op, bk.confirmed);
    expect([notStored.status, notStored.body.error?.code]).toEqual([409, 'BOOKING_NOT_STORED']);
    const notOp = await rec(T.admin, bk.stored);
    expect([notOp.status, notOp.body.error?.code, notOp.body.error?.message]).toEqual([403, 'WAREHOUSE_OPERATOR_ONLY', OPERATOR_ONLY]);
    expect([await auditN(), await n(`SELECT count(*)::int n FROM assay_reports WHERE storage_booking_id = $1`, [bk.stored])]).toEqual([0, 0]);

    const ok = await rec(T.op, bk.stored);
    expect([ok.status, ok.body.data?.assayerName, ok.body.data?.parameters]).toEqual([201, 'Test lab', { moisture: '11.5', grade: 'FAQ' }]);
    expect(await auditN()).toBe(1);
    const row = (await admin.query(`SELECT actor_user_id, entity_id, new_value FROM audit_log WHERE tenant_id = $1 AND action = 'warehousing.assay.recorded'`, [A])).rows[0];
    expect(row).toEqual({ actor_user_id: operator, entity_id: ok.body.data.id, new_value: { storageBookingId: bk.stored, assayerName: 'Test lab', parameterNames: ['grade', 'moisture'], validUntil: '2026-12-31' } });

    const mine = await request(http).get(`/v1/warehousing/storage-bookings/${bk.stored}/assays`).set(H(T.dep));
    expect([mine.status, (mine.body.data as Array<{ id: string }>).map((a) => a.id)]).toEqual([200, [ok.body.data.id]]);
    const theirs = await request(http).get(`/v1/warehousing/storage-bookings/${bk.stored}/assays`).set(H(T.f2));
    expect(theirs.status).toBe(404);
  });

  it('(4) register: box=all by the operator (holder and valuation still in the API body); a farmer 403; box=mine the holder\'s only; tenant B sees none of A\'s', async () => {
    const all = await request(http).get('/v1/warehousing/nwr?box=all&limit=50').set(H(T.op));
    expect(all.status).toBe(200);
    const items = all.body.data as Array<Record<string, unknown>>;
    expect(items.map((r) => r.id).sort()).toEqual([rc.r1, rc.r2, rc.other].sort());
    const r1 = items.find((r) => r.id === rc.r1)!;
    expect(r1).toMatchObject({ holderUserId: depositor, valuationMinor: '39062400', quantity: '62.600', status: 'issued', repository: 'NERL' });   // today's truth: the API sends them; the console never prints them
    expect(Object.keys(all.body.meta ?? {}).sort()).toEqual(['nextCursor', 'request_id', 'timestamp']);   // no total to print

    expect((await request(http).get('/v1/warehousing/nwr?box=all').set(H(T.f2))).status).toBe(403);
    const mine = await request(http).get('/v1/warehousing/nwr?box=mine').set(H(T.dep));
    expect([mine.status, (mine.body.data as Array<{ id: string }>).map((r) => r.id).sort()]).toEqual([200, [rc.r1, rc.r2].sort()]);
    const one = await request(http).get(`/v1/warehousing/nwr/${rc.r1}`).set(H(T.op));
    expect([one.status, one.body.data?.id, one.body.data?.storageBookingId]).toEqual([200, rc.r1, bk.r1]);
    expect((await request(http).get(`/v1/warehousing/nwr/${rc.r1}`).set(H(T.f2))).status).toBe(404);   // not hers, not staff: 404, no IDOR

    const b = await request(http).get('/v1/warehousing/nwr?box=all&limit=100').set(H(T.opB, B));
    expect(b.status).toBe(200);
    expect((b.body.data as Array<{ id: string }>).map((r) => r.id)).toEqual([rc.b]);
    expect((await request(http).get(`/v1/warehousing/nwr/${rc.r1}`).set(H(T.opB, B))).status).toBe(404);
  });

  it('(5) B8: a loan application carrying nwrId → 422 by name, nothing written or remembered; without it → 201', async () => {
    const apps = () => n(`SELECT count(*)::int n FROM loan_applications WHERE applicant_user_id = $1`, [depositor]);
    const key = randomUUID();
    const refused = await request(http).post('/v1/fintech/loan-applications').set({ ...H(T.dep), 'idempotency-key': key })
      .send({ productId: loanProductId, amountRequestedMinor: '1000000', nwrId: rc.r1 });
    expect([refused.status, refused.body.error?.code, refused.body.error?.message]).toEqual([422, 'LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM', PLEDGE]);
    expect(await apps()).toBe(0);
    expect(await n(`SELECT count(*)::int n FROM idempotency_keys WHERE key LIKE $1`, [`%::${key}`])).toBe(0);
    const ok = await request(http).post('/v1/fintech/loan-applications').set({ ...H(T.dep), 'idempotency-key': randomUUID() })
      .send({ productId: loanProductId, amountRequestedMinor: '1000000' });
    expect([ok.status, ok.body.data?.status]).toEqual([201, 'submitted']);
    expect(await apps()).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM loan_applications WHERE applicant_user_id = $1 AND nwr_id IS NOT NULL`, [depositor])).toBe(0);
    expect(await status(rc.r1)).toBe('issued');   // nothing about the receipt changed
  });

  it('(6) absence → 404: pledge, partial release, transfer, a depositor OTP, a certificate PDF, a public certificate page', async () => {
    for (const [method, path] of [
      ['post', `/v1/warehousing/nwr/${rc.r1}/pledge`],
      ['post', `/v1/warehousing/nwr/${rc.r1}/partial-release`],
      ['post', `/v1/warehousing/nwr/${rc.r1}/transfer`],
      ['post', `/v1/warehousing/nwr/${rc.r1}/otp`],
      ['get', `/v1/warehousing/assays/${randomUUID()}/certificate.pdf`],
      ['get', '/c/TEST-CERT-0001'],
    ] as const) {
      const r = await (method === 'get' ? request(http).get(path).set(H(T.op)) : request(http).post(path).set({ ...H(T.op), 'idempotency-key': randomUUID() }).send({}));
      expect([path, r.status]).toEqual([path, 404]);
    }
    expect(await status(rc.r1)).toBe('issued');
  });
});
