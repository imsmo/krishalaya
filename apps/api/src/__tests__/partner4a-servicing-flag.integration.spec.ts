// apps/api/src/__tests__/partner4a-servicing-flag.integration.spec.ts · PC-56 PARTNER-4a · P4-B0 — THE SWITCH THAT DID NOT SWITCH OFF: LIVE
// proof (the real AppModule over HTTP, real Postgres) that `fintech/servicing` is now behind the `fintech` flag and that its four
// money-adjacent writes require an Idempotency-Key.
//
// What this closes (survey_partner4.md F-1 / F-11, named at PARTNER-1 as B13 and left open two waves): `ServicingController` carried
// `@UseGuards(AuthGuard, PermissionsGuard)` and NO feature flag while its three siblings all carried one, and there is no global guard — so
// with lending switched OFF for a tenant its banker could still queue a disbursement batch into the MONEY PLANE (`payout_batches` + one
// `payouts` row per borrower, status `queued`, provider `razorpayx`), write drawl entries against a farmer's KCC balance, restructure a loan
// and write one off. Nothing executed, but the rows were real and the kill-switch did not reach them.
//
//   (1) `fintech` OFF, a tenant_admin holding `loan.manage`: each of the THIRTEEN servicing routes answers 404 (the FeatureFlagGuard shape —
//       invisible, not forbidden), and NO `payouts`, `payout_batches`, `loan_disbursement_runs`, `loan_disbursement_run_items`,
//       `kcc_drawl_ledger` or `loan_restructures` row is written; `loans.status` is unchanged.                              [M1, M2]
//   (2) `fintech` ON: the same thirteen behave exactly as they do today — the preview, the maker-checker refusal, a run with a DISTINCT
//       `confirmedBy`, a KCC entry, the ledger read, a restructure, its list, a transition, the runs list, and a write-off. **UPDATED BY
//       PARTNER-4b (founder 4b-1): the run with a distinct `confirmedBy` used to pin the write-ordering defect this spec found (a 23503 and
//       a 500 on every database); 4b fixed the ordering, so the run now SUCCEEDS and its queued money-plane rows are asserted. Read the
//       comment at the assertion.**
//   (3) a missing `Idempotency-Key` on the four writes (KCC entry, restructure, transition, write-off) → 400; and the SAME key replayed
//       writes exactly ONE row (a second drawl of ₹1 on the same key leaves `balance_after_minor` unchanged).
//   (4) the other three fintech controllers are unaffected: they 404 with the flag off and answer with it on, as they always did.
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
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];

run('PC-56 PARTNER-4a · the lending servicing plane is behind the `fintech` flag, and its four writes are idempotent (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;
  const T = randomUUID();
  const P = randomUUID();
  let banker = ''; let checker = ''; let borrower = '';
  let token = '';
  let productId = ''; let activeLoan = ''; let overdueLoan = ''; let approvedApp = ''; let restructureId = '';
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};

  const H = () => ({ authorization: `Bearer ${token}`, 'x-tenant-id': T });
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    for (const k of flagKeys(key)) await cache.del(k);
  };
  const n = async (table: string) => Number((await admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
  const loanStatus = async (id: string) => (await admin.query(`SELECT status::text AS s FROM loans WHERE id = $1`, [id])).rows[0].s as string;
  const kccBalance = async (id: string) => (await admin.query(
    `SELECT balance_after_minor::text AS b FROM kcc_drawl_ledger WHERE loan_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [id])).rows[0]?.b ?? null;

  /** Every route of `fintech/servicing`, as a thunk, so each can be fired with the flag off and again with it on. */
  const ROUTES = () => [
    ['GET dpd', () => request(http).get('/v1/fintech/servicing/dpd').set(H())],
    ['GET collections', () => request(http).get('/v1/fintech/servicing/collections').set(H())],
    ['POST kcc entry', () => request(http).post(`/v1/fintech/servicing/loans/${activeLoan}/kcc/entries`).set(H()).set('idempotency-key', randomUUID())
      .send({ entryKind: 'drawl', amountMinor: '100000', narrative: 'a fixture drawl' })],
    ['GET kcc ledger', () => request(http).get(`/v1/fintech/servicing/loans/${activeLoan}/kcc/ledger`).set(H())],
    ['POST restructure', () => request(http).post(`/v1/fintech/servicing/loans/${activeLoan}/restructures`).set(H()).set('idempotency-key', randomUUID())
      .send({ reasonCode: 'weather_distress', oldInstalmentMinor: '100000', newInstalmentMinor: '80000', oldTenorMonths: 12, newTenorMonths: 18, rateAprBps: 1100, totalInterestDeltaMinor: '5000' })],
    ['GET restructures', () => request(http).get(`/v1/fintech/servicing/loans/${activeLoan}/restructures`).set(H())],
    ['POST transition', () => request(http).post(`/v1/fintech/servicing/restructures/${restructureId || randomUUID()}/transition`).set(H()).set('idempotency-key', randomUUID()).send({ to: 'mediation' })],
    ['GET disbursement-preview', () => request(http).get('/v1/fintech/servicing/disbursement-preview').set(H())],
    ['POST disbursement-batches', () => request(http).post('/v1/fintech/servicing/disbursement-batches').set(H()).set('idempotency-key', randomUUID()).send({ confirmedBy: checker })],
    ['GET disbursement-batches', () => request(http).get('/v1/fintech/servicing/disbursement-batches').set(H())],
    ['GET disbursement-batches/:id', () => request(http).get(`/v1/fintech/servicing/disbursement-batches/${randomUUID()}`).set(H())],
    ['POST execute', () => request(http).post(`/v1/fintech/servicing/disbursement-batches/${randomUUID()}/execute`).set(H()).set('idempotency-key', randomUUID()).send({})],
    ['POST write-off', () => request(http).post(`/v1/fintech/servicing/loans/${overdueLoan}/write-off`).set(H()).set('idempotency-key', randomUUID()).send({ reason: 'a fixture reason' })],
  ] as const;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['fintech']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T, 'Servicing Flag Collective');
    banker = await makeUser(admin); checker = await makeUser(admin); borrower = await makeUser(admin);
    for (const u of [banker, checker]) {
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [u, T]);
    }
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture Flag Lender', 'bank')`, [P, `p4af_${sfx}`]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'kcc' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    productId = (await admin.query(
      `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
       VALUES ($1, $2, 'Fixture flag KCC', 100000, 50000000, 700, 'harvest_aligned') RETURNING id`, [P, kind])).rows[0].id;
    const mkLoan = async (status: string) => {
      const appId = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status)
         VALUES ($1, $2, $3, 22000000, 22000000, 'disbursed') RETURNING id`, [T, borrower, productId])).rows[0].id;
      return (await admin.query(
        `INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status, outstanding_minor)
         VALUES ($1, $2, $3, $4, 22000000, 700, CURRENT_DATE - 30, $5::loan_status, 22000000) RETURNING id`, [appId, T, borrower, P, status])).rows[0].id;
    };
    activeLoan = await mkLoan('active'); overdueLoan = await mkLoan('overdue');
    // an APPROVED application with a penny-verified primary bank account — the one candidate a disbursement run can claim
    approvedApp = (await admin.query(
      `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status, cooling_off_until)
       VALUES ($1, $2, $3, 5000000, 5000000, 'approved', now() - interval '1 day') RETURNING id`, [T, borrower, productId])).rows[0].id;
    // no silent catch: without this row the run has no eligible candidate and the non-regression case below is meaningless
    await admin.query(
      `INSERT INTO bank_accounts (tenant_id, user_id, account_kind, account_last4, ifsc, holder_name, vault_ref, is_primary, penny_verified_at)
       VALUES ($1, $2, 'bank', '0001', 'HDFC0000001', 'Fixture Holder', 'vault:fixture', true, now())`, [T, borrower]);

    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE);
    token = mintToken(app, { userId: banker, tenantId: T, roles: ['tenant_admin'], perms: ['loan.manage', 'loan.borrow'] });
    for (const k of flagKeys('fintech')) await cache.del(k);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) with `fintech` OFF every servicing route answers 404 and NOTHING is written into the money plane', async () => {
    await setFlag('fintech', false);
    const before = {
      payouts: await n('payouts'), batches: await n('payout_batches'), runs: await n('loan_disbursement_runs'),
      items: await n('loan_disbursement_run_items'), kcc: await n('kcc_drawl_ledger'), restructures: await n('loan_restructures'),
    };
    const beforeStatus = { active: await loanStatus(activeLoan), overdue: await loanStatus(overdueLoan) };

    for (const [name, fire] of ROUTES()) {
      const r = await fire();
      // 404 — INVISIBLE, not forbidden. A 403 here would tell a caller the feature exists.
      expect([name, r.status]).toEqual([name, 404]);
    }

    expect({
      payouts: await n('payouts'), batches: await n('payout_batches'), runs: await n('loan_disbursement_runs'),
      items: await n('loan_disbursement_run_items'), kcc: await n('kcc_drawl_ledger'), restructures: await n('loan_restructures'),
    }).toEqual(before);
    expect({ active: await loanStatus(activeLoan), overdue: await loanStatus(overdueLoan) }).toEqual(beforeStatus);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) with `fintech` ON the same routes behave exactly as they do today — the non-regression, including a run with a distinct confirmedBy', async () => {
    await setFlag('fintech', true);
    for (const [name, path] of [['dpd', '/v1/fintech/servicing/dpd'], ['collections', '/v1/fintech/servicing/collections'],
      ['preview', '/v1/fintech/servicing/disbursement-preview'], ['runs', '/v1/fintech/servicing/disbursement-batches']] as const) {
      const r = await request(http).get(path).set(H());
      expect([name, r.status]).toEqual([name, 200]);
    }
    // a KCC entry is written, and the running balance is computed by the server under the loan's own lock
    const kcc = await request(http).post(`/v1/fintech/servicing/loans/${activeLoan}/kcc/entries`).set(H()).set('idempotency-key', randomUUID())
      .send({ entryKind: 'drawl', amountMinor: '100000', narrative: 'the first fixture drawl' });
    expect([kcc.status, kcc.body?.data?.balanceAfterMinor]).toEqual([201, '100000']);
    expect((await request(http).get(`/v1/fintech/servicing/loans/${activeLoan}/kcc/ledger`).set(H())).status).toBe(200);

    // a restructure, its list, and a transition — the one REAL maker-checker in the module
    const prop = await request(http).post(`/v1/fintech/servicing/loans/${activeLoan}/restructures`).set(H()).set('idempotency-key', randomUUID())
      .send({ reasonCode: 'weather_distress', oldInstalmentMinor: '100000', newInstalmentMinor: '80000', oldTenorMonths: 12, newTenorMonths: 18, rateAprBps: 700, totalInterestDeltaMinor: '5000' });
    expect([prop.status, prop.body?.data?.status]).toEqual([201, 'draft']);
    restructureId = prop.body.data.id;
    expect((await request(http).get(`/v1/fintech/servicing/loans/${activeLoan}/restructures`).set(H())).status).toBe(200);
    const trans = await request(http).post(`/v1/fintech/servicing/restructures/${restructureId}/transition`).set(H()).set('idempotency-key', randomUUID()).send({ to: 'mediation' });
    expect([trans.status, trans.body?.data?.status]).toEqual([201, 'mediation']);

    // A disbursement run with a DISTINCT confirmedBy — the route that writes into the MONEY PLANE, which is exactly why the flag had to
    // reach it. The maker-checker guard is proven first (the preparer cannot confirm his own run), and then the run is fired for real.
    //
    // *** UPDATED BY PC-56 PARTNER-4b (founder 4b-1, 2026-10-28): THIS ROUTE NOW WORKS FOR THE FIRST TIME. ***
    // PARTNER-4a's build found that `LoanDisbursementService.run` wrote the run's CHILDREN before their PARENT (insertPayout +
    // insertItem inside the per-application loop; insertRun after it) against `loan_disbursement_run_items.run_id`, which is
    // `NOT NULL REFERENCES loan_disbursement_runs(id)` and NOT DEFERRABLE (0089:58) — so the FIRST item insert always raised
    // `23503 loan_disbursement_run_items_run_id_fkey` and the whole transaction rolled back. The route had NEVER completed on any
    // database, and this spec pinned that truth so the fix would turn it red. PARTNER-4b fixes the ordering (the batch, then the
    // RUN as a shell of zeros, then its payouts and items, then `finalizeRun` with the WRITTEN figures), and this assertion is
    // updated with it: the run now SUCCEEDS and its rows are real — one `payout_batches` row and one `payouts` row per borrower, both
    // at status `queued`, nothing executed. See `partner4b-disbursal-refusal.integration.spec.ts` case (3) for the full proof
    // (the written total, `totalsAgree`, `uq_loan_disb_item_once`, the retried batch) and the Law 9 note in the wave report.
    // every count here is THIS TENANT's: the group run shares one database with PARTNER-4b's own money spec, and an absolute count would
    // then be asserting that spec's fixture as well as this one's
    const mine = async (table: string) => Number((await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`, [T])).rows[0].n);
    const payoutsBefore = await mine('payouts'); const runsBefore = await mine('loan_disbursement_runs');
    const itemsBefore = await mine('loan_disbursement_run_items'); const batchesBefore = await mine('payout_batches');
    const sameMan = await request(http).post('/v1/fintech/servicing/disbursement-batches').set(H()).set('idempotency-key', randomUUID()).send({ confirmedBy: banker });
    expect([sameMan.status, JSON.stringify(sameMan.body)]).toEqual([403, JSON.stringify(sameMan.body)]);
    const runR = await request(http).post('/v1/fintech/servicing/disbursement-batches').set(H()).set('idempotency-key', randomUUID()).send({ confirmedBy: checker });
    expect([runR.status, runR.body?.error?.code ?? null]).toEqual([201, null]);
    expect(runR.body?.data?.queuedCount).toBeGreaterThanOrEqual(1);
    expect(runR.body?.data?.execution?.executed).toBe(false);
    // the parent run exists, its items exist, and the money-plane rows are real and `queued` — this is the first time they ever were
    const queued = Number(runR.body.data.queuedCount);
    expect([await mine('payouts'), await mine('loan_disbursement_runs'), await mine('loan_disbursement_run_items'), await mine('payout_batches')])
      .toEqual([payoutsBefore + queued, runsBefore + 1, itemsBefore + queued, batchesBefore + 1]);
    expect((await admin.query(`SELECT count(*)::int AS n FROM payouts WHERE tenant_id = $1 AND status <> 'queued'`, [T])).rows[0].n).toBe(0);
    // and the run records what was WRITTEN, with its items' parent present (the FK that used to break it)
    const runRow = (await admin.query(
      `SELECT r.total_minor::text AS t, r.loan_count AS c, (SELECT count(*)::int FROM loan_disbursement_run_items i WHERE i.run_id = r.id) AS items
         FROM loan_disbursement_runs r WHERE r.id = $1`, [runR.body.data.id])).rows[0];
    expect([runRow.c, runRow.items, runRow.t]).toEqual([queued, queued, String(runR.body.data.queuedTotalMinor)]);
    // the listing and the single-run read still answer (the run that does not exist is a 404, not a 500)
    expect((await request(http).get('/v1/fintech/servicing/disbursement-batches').set(H())).status).toBe(200);
    expect((await request(http).get(`/v1/fintech/servicing/disbursement-batches/${randomUUID()}`).set(H())).status).toBe(404);
    // a write-off from `overdue`, with a reason
    const wo = await request(http).post(`/v1/fintech/servicing/loans/${overdueLoan}/write-off`).set(H()).set('idempotency-key', randomUUID()).send({ reason: 'the fixture reason' });
    expect([wo.status, wo.body?.data?.status]).toEqual([201, 'written_off']);
    expect(await loanStatus(overdueLoan)).toBe('written_off');
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) the four writes REQUIRE an Idempotency-Key (400 without one), and a replayed key writes exactly ONE row', async () => {
    await setFlag('fintech', true);
    const without = [
      ['kcc entry', () => request(http).post(`/v1/fintech/servicing/loans/${activeLoan}/kcc/entries`).set(H()).send({ entryKind: 'drawl', amountMinor: '1', narrative: 'no key here' })],
      ['restructure', () => request(http).post(`/v1/fintech/servicing/loans/${activeLoan}/restructures`).set(H())
        .send({ reasonCode: 'other', oldInstalmentMinor: '1', newInstalmentMinor: '1', oldTenorMonths: 1, newTenorMonths: 2, rateAprBps: 1, totalInterestDeltaMinor: '0' })],
      ['transition', () => request(http).post(`/v1/fintech/servicing/restructures/${restructureId}/transition`).set(H()).send({ to: 'accepted' })],
      ['write-off', () => request(http).post(`/v1/fintech/servicing/loans/${overdueLoan}/write-off`).set(H()).send({ reason: 'no key here either' })],
    ] as const;
    const kccBefore = await n('kcc_drawl_ledger'); const reBefore = await n('loan_restructures');
    for (const [name, fire] of without) {
      const r = await fire();
      expect([name, r.status]).toEqual([name, 400]);
    }
    // and nothing was written by any of the four refusals
    expect([await n('kcc_drawl_ledger'), await n('loan_restructures')]).toEqual([kccBefore, reBefore]);

    // the replay: the SAME key, twice, writes ONE entry and leaves the running balance alone
    const key = randomUUID();
    const balanceBefore = await kccBalance(activeLoan);
    const first = await request(http).post(`/v1/fintech/servicing/loans/${activeLoan}/kcc/entries`).set(H()).set('idempotency-key', key)
      .send({ entryKind: 'drawl', amountMinor: '1', narrative: 'the replayed drawl' });
    expect(first.status).toBe(201);
    const afterFirst = await kccBalance(activeLoan);
    const rows = await n('kcc_drawl_ledger');
    const second = await request(http).post(`/v1/fintech/servicing/loans/${activeLoan}/kcc/entries`).set(H()).set('idempotency-key', key)
      .send({ entryKind: 'drawl', amountMinor: '1', narrative: 'the replayed drawl' });
    expect(second.status).toBe(201);
    expect(second.body.data).toEqual(first.body.data);          // the FIRST result, replayed
    expect(await n('kcc_drawl_ledger')).toBe(rows);             // exactly one row, not two
    expect(await kccBalance(activeLoan)).toBe(afterFirst);      // the farmer's drawn balance is not doubled
    expect(afterFirst).not.toBe(balanceBefore);                 // (and the first call did write)
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) the other three fintech controllers are unaffected: 404 with the flag off, answering with it on', async () => {
    await setFlag('fintech', false);
    for (const [name, fire] of [
      ['GET loans', () => request(http).get('/v1/fintech/loans').set(H())],
      ['GET loan', () => request(http).get(`/v1/fintech/loans/${activeLoan}`).set(H())],
      ['GET loan-applications', () => request(http).get('/v1/fintech/loan-applications').set(H())],
      ['GET partners', () => request(http).get('/v1/fintech/partners').set(H())],
    ] as const) {
      expect([name, (await fire()).status]).toEqual([name, 404]);
    }
    await setFlag('fintech', true);
    for (const [name, fire] of [
      ['GET loans', () => request(http).get('/v1/fintech/loans').set(H())],
      ['GET loan', () => request(http).get(`/v1/fintech/loans/${activeLoan}`).set(H())],
      ['GET loan-applications', () => request(http).get('/v1/fintech/loan-applications').set(H())],
    ] as const) {
      expect([name, (await fire()).status]).toEqual([name, 200]);
    }
  }, 120_000);
});
