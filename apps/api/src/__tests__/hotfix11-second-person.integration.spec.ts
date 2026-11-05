// apps/api/src/__tests__/hotfix11-second-person.integration.spec.ts · PC-56 HOTFIX-11 — A SECOND PERSON ON EVERY MILK BILL, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app, migration 0233.
// `dairy`, `dairy_cycle_preview` and `dairy_cycle_approve` are seeded OFF and switched ON for THESE two organisations only (an allow-list),
// restored in afterAll. Own fixtures (no makeCategory / makeProduct).
//
// Founder H11-1 … H11-5 (2026-11-06): approver ≠ previewer and payer ≠ approver on EVERY bill (per-bill routes AND the cycle passes);
// two people suffice (A previews, B approves, A pays — Q2-A); a missing / 'system' signer is refused; no one-person exception (Q3-A);
// a disputed bill is not approvable (Q4-A); whoever rejects an objection becomes the previewer (Q5-A). Survey §7's ten cases:
//   (1) A previews, A approves → 409 APPROVER_IS_PREVIEWER, nothing written      (2) B approves → 201, stamped, one audit row
//   (3) B pays → 409 PAYER_IS_APPROVER, no ledger, balances unchanged, same-key replay = same 409
//   (4) A pays → 201, one zero-sum txn, audit actor A, a new key → 409 BILL_NOT_PAYABLE
//   (5) the cycle path, and the re-press loophole closed                         (6) the CHECKs refuse the row (23514)
//   (7) Q5-A / Q4-A: the dispute path                                            (8) E-2: unknown signers refused
//   (9) Q3-A: a one-admin cooperative needs a clerk                              (10) the migration, from empty
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../core/wallet/wallet.port';
import { platform, PlatformAccount, TenantAccount } from '../core/wallet/account-codes';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const FLAGS = ['dairy', 'dairy_cycle_preview', 'dairy_cycle_approve'] as const;
const SENTENCE_APPROVER = 'The person who showed this bill to the member cannot also approve it. A second person on your dairy desk approves it — your administrator can give a colleague the dairy key.';
const SENTENCE_PAYER = 'The person who approved this bill cannot also pay it. Another person on your dairy desk pays it.';
const NEW_COLS = ['previewed_by', 'approved_at', 'approved_by', 'paid_at', 'paid_by'];

run('PC-56 HOTFIX-11 · a second person on every milk bill (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const T1 = randomUUID(); const T2 = randomUUID();
  let A = ''; let B = ''; let C = ''; let farmer = ''; let E = ''; let D = '';
  let mccId = ''; let mcc2 = '';
  const tok: Record<string, string> = {};
  const backups: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }[] = [];

  const H = (token: string, tenant: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenant });
  const post = (token: string, path: string, body: object = {}, key: string | null = randomUUID(), tenant = T1) =>
    request(http).post(path).set(key ? { ...H(token, tenant), 'idempotency-key': key } : H(token, tenant)).send(body);
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(sql, params)).rows[0].n);
  const row = async (id: string) => (await admin.query(`SELECT status, previewed_by, approved_by, approved_at, paid_by, paid_at FROM milk_bills WHERE id = $1`, [id])).rows[0];
  const ledger = (id: string) => n(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [`milkbill:${id}`]);
  const audits = (id: string, action: string) => n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND action = $2`, [id, action]);
  const outbox = (id: string, type: string) => n(`SELECT count(*)::int n FROM outbox_events WHERE aggregate_id = $1 AND event_type = $2`, [id, type]);
  const bal = async (kind: 'tenant' | 'user', owner: string) => BigInt((await admin.query(
    kind === 'tenant'
      ? `SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='tenant' AND account_code='main' AND owner_tenant_id=$1`
      : `SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [owner])).rows[0]?.b ?? '0');
  const shutWindow = (id: string) => admin.query(`UPDATE milk_bills SET dispute_window_ends = now() - interval '1 minute' WHERE id = $1`, [id]);

  let memberSeq = 0;
  async function draftBill(tenant = T1, mcc = mccId, cycleId: string | null = null, period: [string, string] | null = null): Promise<string> {
    const mem = randomUUID(); const id = randomUUID(); memberSeq += 1;
    await admin.query(`INSERT INTO dairy_memberships (id, tenant_id, farmer_user_id, mcc_id, member_code, payment_cycle, is_active) VALUES ($1, $2, $3, $4, $5, 'weekly', true)`,
      [mem, tenant, farmer, mcc, `M-H11-${memberSeq}`]);
    if (period) {
      await admin.query(`INSERT INTO milk_bills (id, tenant_id, membership_id, cycle_id, period_start, period_end, total_litres, gross_minor, deductions_minor, net_minor, status)
        VALUES ($1, $2, $3, $4, $5::date, $6::date, 100.000, 500000, 0, 500000, 'draft')`, [id, tenant, mem, cycleId, period[0], period[1]]);
    } else {
      await admin.query(`INSERT INTO milk_bills (id, tenant_id, membership_id, cycle_id, period_start, period_end, total_litres, gross_minor, deductions_minor, net_minor, status)
        VALUES ($1, $2, $3, $4, current_date - 9, current_date, 100.000, 500000, 0, 500000, 'draft')`, [id, tenant, mem, cycleId]);
    }
    return id;
  }
  async function clearFlagCache(): Promise<void> {
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T1}`, `flagctx:${T2}`]) await cache.del(c);
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, T1, `HF11 desk ${T1.slice(0, 4)}`);
    await makeTenant(admin, T2, `HF11 one-admin ${T2.slice(0, 4)}`);
    [A, B, C, farmer, E, D] = await Promise.all(Array.from({ length: 6 }, () => makeUser(admin)));
    const role = (u: string, t: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, t, code]);
    for (const u of [A, B, C]) await role(u, T1, 'tenant_admin');
    await role(farmer, T1, 'farmer'); await role(farmer, T2, 'farmer');
    await role(E, T2, 'tenant_admin'); await role(D, T2, 'farmer');
    mccId = randomUUID(); mcc2 = randomUUID();
    await admin.query(`INSERT INTO mcc_centres (id, tenant_id, code, default_name, is_active) VALUES ($1, $2, 'C-HF11', 'Test centre', true)`, [mccId, T1]);
    await admin.query(`INSERT INTO mcc_centres (id, tenant_id, code, default_name, is_active) VALUES ($1, $2, 'C-HF11B', 'Test centre B', true)`, [mcc2, T2]);

    for (const k of FLAGS) backups.push((await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0]);
    expect(backups.map((b) => [b?.key, b?.is_enabled])).toEqual(FLAGS.map((k) => [k, false]));   // seeded OFF
    for (const k of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [k, JSON.stringify({ tenant_ids: [T1, T2] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    await clearFlagCache();
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK); const wallet = app.get<WalletPort>(WALLET_SERVICE);
    for (const t of [T1, T2]) {   // the cooperative's own wallet, funded through the wallet port (never a ledger INSERT)
      await uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
        legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: 50_000_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -50_000_000n }] }), { userId: 'system' });
    }
    const both = ['dairy.manage', 'settlement.close'];
    tok.A = mintToken(app, { userId: A, tenantId: T1, roles: ['tenant_admin'], perms: both });
    tok.B = mintToken(app, { userId: B, tenantId: T1, roles: ['tenant_admin'], perms: both });
    tok.C = mintToken(app, { userId: C, tenantId: T1, roles: ['tenant_admin'], perms: both });
    tok.farmer = mintToken(app, { userId: farmer, tenantId: T1, roles: ['farmer'], perms: [] });
    tok.E = mintToken(app, { userId: E, tenantId: T2, roles: ['tenant_admin'], perms: both });
    tok.D = mintToken(app, { userId: D, tenantId: T2, roles: ['farmer'], perms: ['dairy.manage'] });   // the clerk: the dairy key, no settlement.close
  }, 120_000);

  afterAll(async () => {
    try { for (const b of backups) if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  let bill = '';
  it('(1) A previews and A approves → 409 DAIRY_BILL_APPROVER_IS_PREVIEWER; the bill stays previewed; no approve event, no approve audit row', async () => {
    bill = await draftBill();
    const pv = await post(tok.A, `/v1/dairy/milk-bills/${bill}/preview`, {}, null);
    expect(pv.status).toBe(201);
    expect(await row(bill)).toMatchObject({ status: 'previewed', previewed_by: A, approved_by: null });
    expect(await audits(bill, 'dairy.bill.previewed')).toBe(1);
    const r = await post(tok.A, `/v1/dairy/milk-bills/${bill}/approve`, {}, null);
    expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, 'DAIRY_BILL_APPROVER_IS_PREVIEWER', SENTENCE_APPROVER]);
    expect(await row(bill)).toMatchObject({ status: 'previewed', previewed_by: A, approved_by: null, approved_at: null });
    expect(await outbox(bill, 'dairy.bill_approved')).toBe(0);
    expect(await audits(bill, 'dairy.bill.approved')).toBe(0);
  });

  it('(2) B approves → 201; approved_by = B, approved_at set; one `dairy.bill.approved` audit row, actor B', async () => {
    const r = await post(tok.B, `/v1/dairy/milk-bills/${bill}/approve`, {}, null);
    expect([r.status, r.body.data?.status]).toEqual([201, 'approved']);
    const b = await row(bill);
    expect(b).toMatchObject({ status: 'approved', previewed_by: A, approved_by: B });
    expect(b.approved_at).toBeInstanceOf(Date);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND action = 'dairy.bill.approved' AND actor_user_id = $2`, [bill, B])).toBe(1);
    expect(await outbox(bill, 'dairy.bill_approved')).toBe(1);
  });

  it('(3) B pays (window shut) → 409 DAIRY_BILL_PAYER_IS_APPROVER; no ledger txn; balances unchanged; a same-key replay → the same 409', async () => {
    await shutWindow(bill);
    const tBefore = await bal('tenant', T1); const fBefore = await bal('user', farmer);
    const key = randomUUID();
    for (let i = 0; i < 2; i++) {
      const r = await post(tok.B, `/v1/dairy/milk-bills/${bill}/pay`, {}, key);
      expect([r.status, r.body.error?.code, r.body.error?.message]).toEqual([409, 'DAIRY_BILL_PAYER_IS_APPROVER', SENTENCE_PAYER]);
    }
    expect(await ledger(bill)).toBe(0);
    expect([await bal('tenant', T1), await bal('user', farmer)]).toEqual([tBefore, fBefore]);
    expect(await row(bill)).toMatchObject({ status: 'approved', paid_by: null, paid_at: null });
    expect(await audits(bill, 'dairy.bill.paid')).toBe(0);
  });

  it('(4) A — the previewer — pays → 201 paid; paid_by = A; exactly one zero-sum txn; farmer +gross; audit actor A; a new key → 409 BILL_NOT_PAYABLE', async () => {
    const fBefore = await bal('user', farmer);
    const r = await post(tok.A, `/v1/dairy/milk-bills/${bill}/pay`);
    expect([r.status, r.body.data?.status]).toEqual([201, 'paid']);
    const b = await row(bill);
    expect(b).toMatchObject({ status: 'paid', previewed_by: A, approved_by: B, paid_by: A });
    expect(b.paid_at).toBeInstanceOf(Date);
    expect(await ledger(bill)).toBe(1);
    expect(await n(`SELECT COALESCE(sum(e.amount_minor),0)::bigint n FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.txn_id WHERE t.idempotency_key = $1`, [`milkbill:${bill}`])).toBe(0);
    expect(await bal('user', farmer) - fBefore).toBe(500000n);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE entity_id = $1 AND action = 'dairy.bill.paid' AND actor_user_id = $2`, [bill, A])).toBe(1);
    const again = await post(tok.C, `/v1/dairy/milk-bills/${bill}/pay`);
    expect([again.status, again.body.error?.code]).toEqual([409, 'BILL_NOT_PAYABLE']);
    expect(await ledger(bill)).toBe(1);
  });

  it('(5) the cycle path: A previews the cycle, B approves it → bills approved_by = B; B pays → 409, A pays → 201; A re-presses approve with a late bill A previewed → {approved: 0, failed: 1}', async () => {
    const c = await admin.query(`INSERT INTO dairy_bill_cycles (tenant_id, payment_cycle, period_start, period_end, closes_at, payday, status, closed_at)
      VALUES ($1, 'weekly', current_date - 30, current_date - 24, now(), current_date - 22, 'closed', now()) RETURNING id, period_start::text ps, period_end::text pe`, [T1]);
    const cycle = c.rows[0].id as string; const period: [string, string] = [c.rows[0].ps, c.rows[0].pe];
    const b1 = await draftBill(T1, mccId, cycle, period); const b2 = await draftBill(T1, mccId, cycle, period);
    const pv = await post(tok.A, `/v1/dairy/bill-cycles/${cycle}/preview`);
    expect([pv.status, pv.body.data?.previewed, pv.body.data?.failed]).toEqual([201, 2, 0]);
    const self = await post(tok.A, `/v1/dairy/bill-cycles/${cycle}/approve`);              // the cycle's own maker-checker (0159), unchanged
    expect([self.status, self.body.error?.code]).toEqual([409, 'DAIRY_CYCLE_CHECKER_IS_PREVIEWER']);
    const ap = await post(tok.B, `/v1/dairy/bill-cycles/${cycle}/approve`);
    expect([ap.status, ap.body.data?.approved, ap.body.data?.failed]).toEqual([201, 2, 0]);
    for (const id of [b1, b2]) expect(await row(id)).toMatchObject({ status: 'approved', previewed_by: A, approved_by: B });
    await shutWindow(b1);
    const byChecker = await post(tok.B, `/v1/dairy/milk-bills/${b1}/pay`);                    // the cycle's checker cannot pay what he approved (Q1-A)
    expect([byChecker.status, byChecker.body.error?.code]).toEqual([409, 'DAIRY_BILL_PAYER_IS_APPROVER']);
    expect(await ledger(b1)).toBe(0);
    const byMaker = await post(tok.A, `/v1/dairy/milk-bills/${b1}/pay`);
    expect([byMaker.status, byMaker.body.data?.status]).toEqual([201, 'paid']);
    expect(await ledger(b1)).toBe(1);
    // THE RE-PRESS LOOPHOLE (survey C-4): a late bill, previewed by A, and A — the cycle's previewer — re-presses approve.
    const late = await draftBill(T1, mccId, cycle, period);
    expect((await post(tok.A, `/v1/dairy/milk-bills/${late}/preview`, {}, null)).status).toBe(201);
    const re = await post(tok.A, `/v1/dairy/bill-cycles/${cycle}/approve`);
    expect([re.status, re.body.data?.approved, re.body.data?.failed]).toEqual([201, 0, 1]);
    expect(await row(late)).toMatchObject({ status: 'previewed', previewed_by: A, approved_by: null });
    const re2 = await post(tok.C, `/v1/dairy/bill-cycles/${cycle}/approve`);                  // a different person finishes it
    expect([re2.status, re2.body.data?.approved, re2.body.data?.failed]).toEqual([201, 1, 0]);
    expect(await row(late)).toMatchObject({ status: 'approved', approved_by: C });
  });

  it('(6) the database fact: approver = previewer, payer = approver and half-written stamps are refused by the CHECKs (23514), whatever wrote them', async () => {
    const pb = await draftBill();
    expect((await post(tok.A, `/v1/dairy/milk-bills/${pb}/preview`, {}, null)).status).toBe(201);
    const refused = async (sql: string, params: unknown[], constraint: string) => {
      const e = await admin.query(sql, params).then(() => null, (x) => x);
      expect([e?.code, e?.constraint]).toEqual(['23514', constraint]);
    };
    await refused(`UPDATE milk_bills SET approved_by = previewed_by, approved_at = now(), status = 'approved' WHERE id = $1`, [pb], 'ck_milk_bill_approver_ne_previewer');
    await refused(`UPDATE milk_bills SET approved_at = now() WHERE id = $1`, [pb], 'ck_milk_bill_approve_stamp');
    await refused(`UPDATE milk_bills SET paid_by = $2 WHERE id = $1`, [pb, B], 'ck_milk_bill_paid_stamp');
    const db = await draftBill();
    await refused(`UPDATE milk_bills SET previewed_by = $2 WHERE id = $1`, [db, A], 'ck_milk_bill_preview_by_needs_at');
    expect((await post(tok.B, `/v1/dairy/milk-bills/${pb}/approve`, {}, null)).status).toBe(201);
    await refused(`UPDATE milk_bills SET paid_by = approved_by, paid_at = now(), status = 'paid' WHERE id = $1`, [pb], 'ck_milk_bill_payer_ne_approver');
    expect(await row(pb)).toMatchObject({ status: 'approved', approved_by: B, paid_by: null });
    // …and the previewer as payer is a legal row (two people suffice — Q2-A)
    await admin.query(`UPDATE milk_bills SET paid_by = previewed_by, paid_at = now() WHERE id = $1`, [pb]);
    await admin.query(`UPDATE milk_bills SET paid_by = NULL, paid_at = NULL WHERE id = $1`, [pb]);
  });

  it('(7) Q4-A: approving a DISPUTED bill → 409 DAIRY_BILL_DISPUTE_UNANSWERED; Q5-A: C rejects the objection → previewed_by = C; C approves → 409; A approves → 201', async () => {
    const db = await draftBill();
    expect((await post(tok.A, `/v1/dairy/milk-bills/${db}/preview`, {}, null)).status).toBe(201);
    const raised = await post(tok.farmer, `/v1/dairy/milk-bills/${db}/dispute`, { reason: 'my litres are short by about four' });
    expect(raised.status).toBe(201);
    const disputeId = raised.body.data.id as string;
    expect((await row(db)).status).toBe('disputed');
    for (const t of [tok.A, tok.B]) {
      const r = await post(t, `/v1/dairy/milk-bills/${db}/approve`, {}, null);
      expect([r.status, r.body.error?.code]).toEqual([409, 'DAIRY_BILL_DISPUTE_UNANSWERED']);
    }
    expect(await row(db)).toMatchObject({ status: 'disputed', approved_by: null });
    const res = await post(tok.C, `/v1/dairy/bill-disputes/${disputeId}/resolve`, { outcome: 'rejected', note: 'The litres match the counter slips.', voidBill: false }, null);
    expect(res.status).toBe(201);
    expect(await row(db)).toMatchObject({ status: 'previewed', previewed_by: C });
    const byC = await post(tok.C, `/v1/dairy/milk-bills/${db}/approve`, {}, null);
    expect([byC.status, byC.body.error?.code]).toEqual([409, 'DAIRY_BILL_APPROVER_IS_PREVIEWER']);
    const byA = await post(tok.A, `/v1/dairy/milk-bills/${db}/approve`, {}, null);
    expect(byA.status).toBe(201);
    expect(await row(db)).toMatchObject({ status: 'approved', previewed_by: C, approved_by: A });
  });

  it('(8) E-2: a bill previewed with no previewer recorded → approve 409 PREVIEWER_UNKNOWN; approved with no approver → pay 409 APPROVER_UNKNOWN, ledger 0', async () => {
    const p = await draftBill();
    await admin.query(`UPDATE milk_bills SET status = 'previewed', previewed_at = now() - interval '2 days', dispute_window_ends = now() - interval '1 day' WHERE id = $1`, [p]);
    const r1 = await post(tok.B, `/v1/dairy/milk-bills/${p}/approve`, {}, null);
    expect([r1.status, r1.body.error?.code]).toEqual([409, 'DAIRY_BILL_PREVIEWER_UNKNOWN']);
    expect((await row(p)).status).toBe('previewed');
    const q = await draftBill();
    await admin.query(`UPDATE milk_bills SET status = 'approved', previewed_at = now() - interval '2 days', dispute_window_ends = now() - interval '1 day' WHERE id = $1`, [q]);
    const r2 = await post(tok.A, `/v1/dairy/milk-bills/${q}/pay`);
    expect([r2.status, r2.body.error?.code]).toEqual([409, 'DAIRY_BILL_APPROVER_UNKNOWN']);
    expect(await ledger(q)).toBe(0);
    expect((await row(q)).status).toBe('approved');
  });

  it('(9) Q3-A: a cooperative with ONE administrator cannot get a bill to paid alone; with a clerk holding the dairy key it can (D previews, E approves, D pays)', async () => {
    const solo = await draftBill(T2, mcc2);
    expect((await post(tok.E, `/v1/dairy/milk-bills/${solo}/preview`, {}, null, T2)).status).toBe(201);
    const r = await post(tok.E, `/v1/dairy/milk-bills/${solo}/approve`, {}, null, T2);
    expect([r.status, r.body.error?.code]).toEqual([409, 'DAIRY_BILL_APPROVER_IS_PREVIEWER']);
    expect((await row(solo)).status).toBe('previewed');
    const two = await draftBill(T2, mcc2);
    expect((await post(tok.D, `/v1/dairy/milk-bills/${two}/preview`, {}, null, T2)).status).toBe(201);
    expect((await post(tok.D, `/v1/dairy/milk-bills/${two}/approve`, {}, null, T2)).status).toBe(403);   // the clerk holds no settlement.close
    expect((await post(tok.E, `/v1/dairy/milk-bills/${two}/approve`, {}, null, T2)).status).toBe(201);
    await shutWindow(two);
    const byE = await post(tok.E, `/v1/dairy/milk-bills/${two}/pay`, {}, randomUUID(), T2);
    expect([byE.status, byE.body.error?.code]).toEqual([409, 'DAIRY_BILL_PAYER_IS_APPROVER']);
    const byD = await post(tok.D, `/v1/dairy/milk-bills/${two}/pay`, {}, randomUUID(), T2);
    expect([byD.status, byD.body.data?.status]).toEqual([201, 'paid']);
    expect(await row(two)).toMatchObject({ previewed_by: D, approved_by: E, paid_by: D });
    expect(await ledger(two)).toBe(1);
  });

  it('(10) the migration from empty: 0233 is recorded; five columns, five CHECKs (exact text), five comments; no column ACL; no new policy on milk_bills', async () => {
    // The integration harness builds its database by applying every migration file itself (no `schema_migrations` table there); the
    // runner's record of 0233 is proven on the from-empty scratch build instead. Where the table exists, 0233 must be in it.
    if ((await admin.query(`SELECT to_regclass('public.schema_migrations') r`)).rows[0].r) {
      expect(await n(`SELECT count(*)::int n FROM schema_migrations WHERE version = '0233_hotfix11_milk_bill_second_person'`)).toBe(1);
    }
    const cols = (await admin.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'milk_bills' AND column_name = ANY($1) ORDER BY column_name`, [NEW_COLS])).rows;
    expect(cols).toEqual([
      { column_name: 'approved_at', data_type: 'timestamp with time zone' }, { column_name: 'approved_by', data_type: 'uuid' },
      { column_name: 'paid_at', data_type: 'timestamp with time zone' }, { column_name: 'paid_by', data_type: 'uuid' },
      { column_name: 'previewed_by', data_type: 'uuid' },
    ]);
    const cks = Object.fromEntries((await admin.query(`SELECT conname, pg_get_constraintdef(oid) d FROM pg_constraint WHERE conrelid = 'milk_bills'::regclass AND conname = ANY($1)`,
      [['ck_milk_bill_approve_stamp', 'ck_milk_bill_paid_stamp', 'ck_milk_bill_preview_by_needs_at', 'ck_milk_bill_approver_ne_previewer', 'ck_milk_bill_payer_ne_approver']])).rows.map((r) => [r.conname, r.d]));
    expect(cks).toEqual({
      ck_milk_bill_approve_stamp: 'CHECK (((approved_at IS NULL) = (approved_by IS NULL)))',
      ck_milk_bill_paid_stamp: 'CHECK (((paid_at IS NULL) = (paid_by IS NULL)))',
      ck_milk_bill_preview_by_needs_at: 'CHECK (((previewed_by IS NULL) OR (previewed_at IS NOT NULL)))',
      ck_milk_bill_approver_ne_previewer: 'CHECK (((approved_by IS NULL) OR (previewed_by IS NULL) OR (approved_by <> previewed_by)))',
      ck_milk_bill_payer_ne_approver: 'CHECK (((paid_by IS NULL) OR (approved_by IS NULL) OR (paid_by <> approved_by)))',
    });
    const fks = await n(`SELECT count(*)::int n FROM pg_constraint c WHERE c.conrelid = 'milk_bills'::regclass AND c.contype = 'f' AND c.confrelid = 'users'::regclass
      AND (SELECT attname FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = c.conkey[1]) = ANY($1)`, [['previewed_by', 'approved_by', 'paid_by']]);
    expect(fks).toBe(3);
    const comments = (await admin.query(`SELECT a.attname, col_description(a.attrelid, a.attnum) c, a.attacl FROM pg_attribute a WHERE a.attrelid = 'milk_bills'::regclass AND a.attname = ANY($1) ORDER BY a.attname`, [NEW_COLS])).rows;
    expect(comments).toHaveLength(5);
    for (const r of comments) { expect(r.c).toMatch(/^PC-56 HOTFIX-11 \(0233/); expect(r.attacl).toBeNull(); }   // no column grant — 0079's table-level UPDATE covers them
    expect((await admin.query(`SELECT has_table_privilege('kv_app', 'milk_bills', 'UPDATE') u`)).rows[0].u).toBe(true);
    const pol = (await admin.query(`SELECT policyname, qual FROM pg_policies WHERE tablename = 'milk_bills'`)).rows;
    for (const p of pol) for (const c of NEW_COLS) expect(String(p.qual ?? '')).not.toContain(c);
  });
});
