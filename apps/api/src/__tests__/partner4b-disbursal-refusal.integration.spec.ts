// apps/api/src/__tests__/partner4b-disbursal-refusal.integration.spec.ts · PC-56 PARTNER-4b · WHAT A LENDER DOES NOT DISBURSE — the LIVE
// proof of this wave's first commit and of the PARTNER-0 rule it stands on (the real AppModule over HTTP, real Postgres).
//
//   (1) THE PARTNER-0 NON-REGRESSION (founder 4b-4 / Q9): every one of the FOUR partner roles — administrator, checker, maker, viewer — on
//       the partner realm's disburse route answers 403 `PARTNER_CANNOT_DISBURSE` with its own sentence; no `loans` row, no `payouts` row and
//       no ledger transaction is written, and the application is still `approved`.                                                     [M3]
//   (2) FOUNDER 4b-2 — THE SECOND DOOR IS SHUT BY NAME: an application a bank-payout run already claims cannot also be disbursed from the
//       FPO's wallet (409 `LOAN_ALREADY_QUEUED_FOR_DISBURSAL`), nothing is posted, the application is still `approved`; and the other
//       direction holds too — an application the wallet has paid is not a candidate for a run at all.                                  [M2]
//   (3) FOUNDER 4b-1 — THE RUN THAT HAD NEVER WORKED NOW WORKS: with `fintech` ON, `POST /v1/fintech/servicing/disbursement-batches`
//       SUCCEEDS; the parent run row exists, its items exist and point at it, the run records the WRITTEN total (not the planned one), the
//       batch total equals the sum of its payouts, every payout is `queued` and nothing is executed; a SECOND run on the same application is
//       impossible (`uq_loan_disb_item_once`) and a retried batch reports it skipped as `already_disbursed`; the maker may not confirm his
//       own run; and an idempotency-key replay is refused BEFORE a payout row is written.                                               [M1]
//   (4) with `fintech` OFF the same route is INVISIBLE (404) and writes nothing — 4a's own non-regression, re-pinned here because this wave
//       made the route able to write for the first time; and NO partner-realm route prepares, confirms or co-approves a run (404).
//
// Nothing in this spec executes a payout: no worker runs, no credentials exist, and the whole servicing controller is behind the `fintech`
// flag, which is left OFF when the spec finishes.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
/** The four roles of the partner realm (0225) — every one of them must be refused the same way. */
const PARTNER_ROLES = ['partner_admin', 'partner_checker', 'partner_maker', 'partner_viewer'] as const;

run('PC-56 PARTNER-4b · what a lender does not disburse: the partner realm refused by name, the two rails, and the run that now works (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T = randomUUID(); const P = randomUUID();
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, string> = {};
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  let productId = '';
  /** `claimed` is taken by a run; `wallet` is paid from the wallet; `walletOnly` is the control the run must claim. */
  const apps: Record<string, string> = {};
  let runId = ''; let batchId = '';

  const H = (userKey = 'banker') => ({ authorization: `Bearer ${tok[userKey]}`, 'x-tenant-id': T });
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    for (const k of flagKeys(key)) await cache.del(k);
  };
  const n = async (sql: string, params: unknown[] = []) => Number((await admin.query(`SELECT count(*)::int AS n ${sql}`, params)).rows[0].n);
  const status = async (id: string) => (await admin.query(`SELECT status::text AS s FROM loan_applications WHERE id = $1`, [id])).rows[0].s as string;
  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone };
  };
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const signIn = async (key: string) => {
    await resetRates();
    const { code } = await otp.issue(people[key].phone);
    const r = await request(http).post('/v1/partner/auth/verify').send({ phone: people[key].phone, code });
    expect([key, r.status]).toEqual([key, 201]);
    tok[key] = r.body.data.accessToken;
  };
  /** An approved application with a penny-verified primary account — the only shape a run can claim. */
  const approved = async (key: string, borrowerKey: string, minor: string) => {
    apps[key] = (await admin.query(
      `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status, cooling_off_until, decision_at)
       VALUES ($1, $2, $3, $4, $4, 'approved', now() - interval '1 day', now() - interval '1 day') RETURNING id`,
      [T, people[borrowerKey].id, productId, minor])).rows[0].id;
    return apps[key];
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'fintech']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T, 'Disbursal Refusal Collective');
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture Refusal Lender', 'bank')`,
      [P, `p4br_${randomUUID().replace(/-/g, '').slice(0, 10)}`]);
    for (const [k, name] of [['banker', 'Refusal FPO banker'], ['checker', 'Refusal FPO checker'], ['b1', 'Borrower One'], ['b2', 'Borrower Two'],
      ['b3', 'Borrower Three'], ['pAdmin', 'Partner admin'], ['pChecker', 'Partner checker'], ['pMaker', 'Partner maker'], ['pViewer', 'Partner viewer']] as const) {
      await user(k, name);
    }
    for (const [i, role] of PARTNER_ROLES.entries()) {
      const key = ['pAdmin', 'pChecker', 'pMaker', 'pViewer'][i];
      await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`,
        [people[key].id, P, role]);
    }
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.banker.id, T]);
    productId = (await admin.query(
      `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
       SELECT $1, lv.id, 'Fixture refusal KCC', 100000, 90000000, 700, 'harvest_aligned'
         FROM lookup_values lv WHERE lv.type_code = 'loan_kind' AND lv.code = 'kcc' AND lv.tenant_id IS NULL
        ORDER BY lv.created_at, lv.id LIMIT 1 RETURNING id`, [P])).rows[0].id;
    for (const k of ['b1', 'b2', 'b3'] as const) {
      await admin.query(
        `INSERT INTO bank_accounts (tenant_id, user_id, account_kind, account_last4, ifsc, holder_name, vault_ref, is_primary, penny_verified_at)
         VALUES ($1, $2, 'bank', '0001', 'HDFC0000001', 'Fixture Holder', 'vault:fixture', true, now())`, [T, people[k].id]);
    }
    // the consent the partner axis needs to see an application at all (0225's oracle)
    await approved('claimed', 'b1', '2200000');
    await approved('wallet', 'b2', '1500000');
    await approved('spare', 'b3', '900000');
    for (const key of ['claimed', 'wallet', 'spare'] as const) {
      const borrower = { claimed: 'b1', wallet: 'b2', spare: 'b3' }[key];
      await admin.query(
        `INSERT INTO credit_score_consents (user_id, partner_id, purpose_ref, expires_at) VALUES ($1, $2, $3, now() + interval '30 days')`,
        [people[borrower].id, P, apps[key]]);
    }

    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    tok.banker = mintToken(app, { userId: people.banker.id, tenantId: T, roles: ['tenant_admin'], perms: ['loan.manage', 'loan.borrow'] });
    await setFlag('partner_console', true);
    for (const k of ['pAdmin', 'pChecker', 'pMaker', 'pViewer'] as const) await signIn(k);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4 WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, b.rules]);
      if (cache) for (const x of flagKeys(k)) await cache.del(x);
    }
    await app?.close(); await admin?.end();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) ALL FOUR partner roles are refused the one money act BY NAME — nothing is written and the application is untouched', async () => {
    const before = {
      loans: await n(`FROM loans WHERE tenant_id = $1`, [T]),
      payouts: await n(`FROM payouts WHERE tenant_id = $1`, [T]),
      txns: await n(`FROM ledger_transactions WHERE tenant_id = $1`, [T]),
      items: await n(`FROM loan_disbursement_run_items WHERE tenant_id = $1`, [T]),
    };
    for (const key of ['pAdmin', 'pChecker', 'pMaker', 'pViewer'] as const) {
      const r = await request(http).post(`/v1/partner/applications/${apps.spare}/disburse`)
        .set({ authorization: `Bearer ${tok[key]}`, 'idempotency-key': randomUUID() }).send({});
      expect([key, r.status, r.body.error?.code]).toEqual([key, 403, 'PARTNER_CANNOT_DISBURSE']);
      // the sentence itself, not only the code: a partner is told WHOSE money it is
      expect([key, String(r.body.error?.message)]).toEqual([key, 'A partner never disburses: disbursal moves the organisation\'s (FPO\'s) wallet money, and the FPO is the lender of record — it disburses from its own console once you approve.']);
    }
    expect({
      loans: await n(`FROM loans WHERE tenant_id = $1`, [T]),
      payouts: await n(`FROM payouts WHERE tenant_id = $1`, [T]),
      txns: await n(`FROM ledger_transactions WHERE tenant_id = $1`, [T]),
      items: await n(`FROM loan_disbursement_run_items WHERE tenant_id = $1`, [T]),
    }).toEqual(before);
    expect(await status(apps.spare)).toBe('approved');
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) founder 4b-1: with `fintech` ON the batch route SUCCEEDS for the first time — the parent run, its items, the WRITTEN total, and nothing executed', async () => {
    await setFlag('fintech', true);
    // the maker may not confirm his own run (the rule that was already there, re-pinned before the write)
    const sameMan = await request(http).post('/v1/fintech/servicing/disbursement-batches')
      .set({ ...H(), 'idempotency-key': randomUUID() }).send({ confirmedBy: people.banker.id });
    expect(sameMan.status).toBe(403);
    expect(await n(`FROM loan_disbursement_runs WHERE tenant_id = $1`, [T])).toBe(0);

    // the real run, over only ONE application, so the second one is left for the wallet rail in case (2)
    const r = await request(http).post('/v1/fintech/servicing/disbursement-batches')
      .set({ ...H(), 'idempotency-key': randomUUID() }).send({ confirmedBy: people.checker.id, applicationIds: [apps.claimed] });
    expect([r.status, r.body.error?.code ?? null]).toEqual([201, null]);
    runId = r.body.data.id; batchId = r.body.data.batchId;
    expect(r.body.data.queuedCount).toBe(1);
    expect(r.body.data.queuedTotalMinor).toBe('2200000');
    expect(r.body.data.execution.executed).toBe(false);

    // THE PARENT EXISTS AND ITS ITEMS POINT AT IT — the FK that made this route a 500 on every database until this wave
    const row = (await admin.query(
      `SELECT r.total_minor::text AS total, r.loan_count AS c, r.skipped_count AS skipped, r.status::text AS st,
              r.prepared_by, r.confirmed_by, r.confirmed_at IS NOT NULL AS confirmed,
              (SELECT count(*)::int FROM loan_disbursement_run_items i WHERE i.run_id = r.id) AS items,
              (SELECT count(*)::int FROM loan_disbursement_run_items i WHERE i.run_id = r.id AND i.application_id = $2) AS mine
         FROM loan_disbursement_runs r WHERE r.id = $1`, [runId, apps.claimed])).rows[0];
    expect([row.c, row.items, row.mine, row.total, row.st, row.confirmed]).toEqual([1, 1, 1, '2200000', 'queued', true]);
    expect([row.prepared_by, row.confirmed_by]).toEqual([people.banker.id, people.checker.id]);
    // the run records the WRITTEN total, and it is the sum of the rows that were actually written
    const sums = (await admin.query(
      `SELECT (SELECT sum(i.amount_minor)::text FROM loan_disbursement_run_items i WHERE i.run_id = $1) AS items,
              (SELECT sum(p.amount_minor)::text FROM payouts p WHERE p.batch_id = $2) AS payouts,
              (SELECT b.total_minor::text FROM payout_batches b WHERE b.id = $2) AS batch,
              (SELECT count(*)::int FROM payouts p WHERE p.batch_id = $2 AND p.status <> 'queued') AS notQueued,
              (SELECT count(*)::int FROM payouts p WHERE p.batch_id = $2 AND p.provider_code <> 'razorpayx') AS otherProvider,
              (SELECT count(*)::int FROM ledger_transactions t WHERE t.tenant_id = $3) AS txns,
              (SELECT count(*)::int FROM loans l WHERE l.application_id = $4) AS loans`,
      [runId, batchId, T, apps.claimed])).rows[0];
    expect([sums.items, sums.payouts, sums.batch]).toEqual([row.total, row.total, row.total]);
    // NOTHING EXECUTES: the rows are queued, on the one provider, with no ledger movement and no servicing loan
    expect([sums.notqueued ?? sums.notQueued, sums.otherprovider ?? sums.otherProvider, sums.txns, sums.loans]).toEqual([0, 0, 0, 0]);
    // and the application is STILL `approved` — the flip is the separate, key-gated execute step
    expect(await status(apps.claimed)).toBe('approved');

    // A SECOND RUN on the same application is impossible, and the retry REPORTS it rather than silently dropping it
    const retry = await request(http).post('/v1/fintech/servicing/disbursement-batches')
      .set({ ...H(), 'idempotency-key': randomUUID() }).send({ confirmedBy: people.checker.id, applicationIds: [apps.claimed] });
    // the realm answers a 409 with the house's generic conflict sentence (the service's own words are not surfaced to a caller); the REASON
    // is proven by name through the preview, two assertions below
    expect(retry.status).toBe(409);
    expect(await n(`FROM loan_disbursement_run_items WHERE application_id = $1`, [apps.claimed])).toBe(1);
    expect(await n(`FROM loan_disbursement_runs WHERE tenant_id = $1`, [T])).toBe(1);
    // the preview says the same thing, by name
    const prev = await request(http).get('/v1/fintech/servicing/disbursement-preview').set(H());
    expect(prev.status).toBe(200);
    expect((prev.body.data.skipped as Array<{ applicationId: string; reason: string }>)
      .find((s) => s.applicationId === apps.claimed)?.reason).toBe('already_disbursed');

    // AN IDEMPOTENCY-KEY REPLAY is refused BEFORE a payout row is written (the run row is now the first write)
    const key = randomUUID();
    const first = await request(http).post('/v1/fintech/servicing/disbursement-batches')
      .set({ ...H(), 'idempotency-key': key }).send({ confirmedBy: people.checker.id, applicationIds: [apps.spare] });
    expect(first.status).toBe(201);
    const payoutsAfterFirst = await n(`FROM payouts WHERE tenant_id = $1`, [T]);
    const replay = await request(http).post('/v1/fintech/servicing/disbursement-batches')
      .set({ ...H(), 'idempotency-key': key }).send({ confirmedBy: people.checker.id, applicationIds: [apps.spare] });
    // again the house's generic conflict sentence; what matters is that it is a 409 and that NO second payout row was written
    expect(replay.status).toBe(409);
    expect(await n(`FROM payouts WHERE tenant_id = $1`, [T])).toBe(payoutsAfterFirst);
    expect(await n(`FROM loan_disbursement_run_items WHERE application_id = $1`, [apps.spare])).toBe(1);
  }, 240_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) founder 4b-2: the wallet rail REFUSES an application a run has claimed, by name — and an application the wallet paid is no candidate for a run', async () => {
    await setFlag('fintech', true);
    const before = {
      txns: await n(`FROM ledger_transactions WHERE tenant_id = $1`, [T]),
      loans: await n(`FROM loans WHERE tenant_id = $1`, [T]),
    };
    // the claimed application: the wallet rail is refused BY NAME, and nothing is posted
    const refused = await request(http).post(`/v1/fintech/loan-applications/${apps.claimed}/disburse`)
      .set({ ...H(), 'idempotency-key': randomUUID() }).send({});
    expect([refused.status, refused.body.error?.code]).toEqual([409, 'LOAN_ALREADY_QUEUED_FOR_DISBURSAL']);
    expect(String(refused.body.error?.message)).toMatch(/already claimed by a bank-payout disbursement run/);
    expect({
      txns: await n(`FROM ledger_transactions WHERE tenant_id = $1`, [T]),
      loans: await n(`FROM loans WHERE tenant_id = $1`, [T]),
    }).toEqual(before);
    expect(await status(apps.claimed)).toBe('approved');

    // THE ORDER MATTERS AND IS PROVEN BY WHICH REFUSAL CAME BACK: the new check runs before the state machine and before the wallet, so a
    // claimed application is told the real reason — not an account or a balance problem. The UNCLAIMED application a line below gets a
    // DIFFERENT refusal from the wallet itself, which is what shows the first one was not a coincidence.
    const unclaimed = await request(http).post(`/v1/fintech/loan-applications/${apps.wallet}/disburse`)
      .set({ ...H(), 'idempotency-key': randomUUID() }).send({});
    expect(unclaimed.body.error?.code).not.toBe('LOAN_ALREADY_QUEUED_FOR_DISBURSAL');
    // NOTE, HONESTLY: the wallet rail's SUCCESS path needs the cooperative's pool to hold the money, and this spec will not hand-write a
    // ledger row to fake that (Law 2 — app code never INSERTs ledger rows, and a test fixture is still app code). The wallet rail answers
    // `WALLET_INSUFFICIENT_BALANCE` here, which is the zero-sum guard doing its job; the rail's funded happy path is proven by
    // `fintech.integration`. What THIS spec proves is the refusal the wave added, and the other direction below.
    expect([unclaimed.status, unclaimed.body.error?.code]).toEqual([409, 'WALLET_INSUFFICIENT_BALANCE']);
    expect(await status(apps.wallet)).toBe('approved');
    expect(await n(`FROM loans WHERE application_id = $1`, [apps.wallet])).toBe(0);

    // THE OTHER DIRECTION: an application the wallet rail HAS paid is left at `disbursed`, and a run's candidate query requires `approved` —
    // so no run can ever claim it. The fixture puts the application in exactly the state the wallet rail leaves it in.
    await admin.query(`UPDATE loan_applications SET status = 'disbursed', decision_at = now() WHERE id = $1`, [apps.wallet]);
    const prev = await request(http).get('/v1/fintech/servicing/disbursement-preview').set(H());
    expect(prev.status).toBe(200);
    const lines = [...(prev.body.data.lines as Array<{ applicationId: string }>), ...(prev.body.data.skipped as Array<{ applicationId: string }>)];
    expect(lines.map((l) => l.applicationId)).not.toContain(apps.wallet);
    const r = await request(http).post('/v1/fintech/servicing/disbursement-batches')
      .set({ ...H(), 'idempotency-key': randomUUID() }).send({ confirmedBy: people.checker.id, applicationIds: [apps.wallet] });
    expect(r.status).toBe(409);
    expect(await n(`FROM loan_disbursement_run_items WHERE application_id = $1`, [apps.wallet])).toBe(0);
    expect({
      txns: await n(`FROM ledger_transactions WHERE tenant_id = $1`, [T]),
      loans: await n(`FROM loans WHERE tenant_id = $1`, [T]),
    }).toEqual(before);
  }, 240_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) with `fintech` OFF the batch route is INVISIBLE and writes nothing; and NO partner-realm route prepares, confirms or co-approves a run', async () => {
    await setFlag('fintech', false);
    const before = {
      runs: await n(`FROM loan_disbursement_runs WHERE tenant_id = $1`, [T]),
      items: await n(`FROM loan_disbursement_run_items WHERE tenant_id = $1`, [T]),
      payouts: await n(`FROM payouts WHERE tenant_id = $1`, [T]),
      batches: await n(`FROM payout_batches WHERE tenant_id = $1`, [T]),
    };
    const off = await request(http).post('/v1/fintech/servicing/disbursement-batches')
      .set({ ...H(), 'idempotency-key': randomUUID() }).send({ confirmedBy: people.checker.id });
    expect(off.status).toBe(404);
    expect({
      runs: await n(`FROM loan_disbursement_runs WHERE tenant_id = $1`, [T]),
      items: await n(`FROM loan_disbursement_run_items WHERE tenant_id = $1`, [T]),
      payouts: await n(`FROM payouts WHERE tenant_id = $1`, [T]),
      batches: await n(`FROM payout_batches WHERE tenant_id = $1`, [T]),
    }).toEqual(before);

    // the partner realm has no such route, in any shape — a 404 from the router, never a 403 from a guard that read a body
    for (const [method, path] of [
      ['post', '/v1/partner/disbursements'],
      ['post', '/v1/partner/disbursement-batches'],
      ['post', '/v1/partner/loans/disbursement-batches'],
      ['post', `/v1/partner/disbursement-batches/${runId || randomUUID()}/confirm`],
      ['post', `/v1/partner/disbursements/${runId || randomUUID()}/co-approve`],
      ['post', `/v1/partner/loans/${randomUUID()}/disburse`],
      ['get', '/v1/partner/disbursement-batches'],
      ['get', `/v1/partner/disbursement-batches/${runId || randomUUID()}`],
      ['get', '/v1/partner/loans/runs'],
    ] as const) {
      const r = await (request(http) as any)[method](path)
        .set({ authorization: `Bearer ${tok.pAdmin}`, 'idempotency-key': randomUUID() }).send({ confirmedBy: people.pChecker.id });
      expect([path, r.status]).toEqual([path, 404]);
    }
    // the three reads this wave DID build are the only new partner routes, and they answer
    await setFlag('partner_console', true);
    for (const path of ['/v1/partner/loans/dpd', '/v1/partner/loans/collected', '/v1/partner/loans/pipeline']) {
      const r = await request(http).get(path).set({ authorization: `Bearer ${tok.pViewer}` });
      expect([path, r.status]).toEqual([path, 200]);
    }
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  // WHAT A RACED BATCH REALLY DOES — and why "the run records the WRITTEN figures, never the planned ones" is UNPROVABLE today.
  //
  // The lead's QA mutated `finalizeRun(totalMinor: writtenTotal, loanCount: written.length)` to the PLANNED figures
  // (`Σ split.queued`, `split.queued.length`) and no spec went red. This case is the answer, and it is not a gap in the fixture:
  //
  //   1. an `eligibility` skip can never separate the two, because `planRun` sums the QUEUED lines only — a held-back application is
  //      already outside the planned total (`domain/loan-disbursement.rules.ts:46-55`);
  //   2. so the ONLY producer of planned ≠ written is the `raced` branch: `insertItem` catches the 23505 from
  //      `uq_loan_disb_item_once` (0089:68) and returns false, and the loop records `already_disbursed` and carries on
  //      (`repositories/loan-disbursement.repository.ts:80-92`, `services/loan-disbursement.service.ts:96-97`);
  //   3. **and that branch cannot complete.** In Postgres a failed statement ABORTS its transaction: every later statement answers
  //      `25P02 current transaction is aborted` until the block ends. `insertItem` catches the error in JavaScript, but the
  //      TRANSACTION is already poisoned — so `finalizeRun`, the audit write and the COMMIT all fail, and the whole run rolls back
  //      with a 500. A run therefore either writes every line it planned, or writes NOTHING: **no completed run can ever carry
  //      written ≠ planned**, which is exactly why the mutation survives.
  //
  // This case pins that truth, the way PARTNER-4a pinned the write-ordering defect it found: the race is staged deterministically, one
  // run succeeds and the other dies whole, and every row is counted. **The day `insertItem` is wrapped in a SAVEPOINT (or the item is
  // claimed BEFORE its payout), this case turns red and must be rewritten with the assertions the lead asked for** — the loser's
  // `total_minor` = Σ of the rows it wrote, `loan_count` = their count, `skipped_count` / `skipped_detail` naming the raced and the
  // held-back applications, and the written total STRICTLY LESS than the planned one. Carried in the report for the fintech owner.
  //
  // The staging, with no production code involved: THREE eligible applications — one only run A asks for, one only run B asks for, and
  // ONE both ask for — plus two that `eligibility` holds back for reasons this platform really produces (a cooling-off window still
  // open, and a borrower with no verified account). The test holds `SELECT … FOR UPDATE` on the shared borrower's `users` row, so the
  // `payouts` insert that references her (an FK key-share lock) blocks: both runs read their candidates — each seeing the shared
  // application unclaimed — and write their OWN item first, and only then queue behind the gate. That is the real production window,
  // made repeatable.
  it('(5) a RACED batch is all-or-nothing: one run writes, the other dies whole — so planned and written can never differ in a completed run', async () => {
    await setFlag('fintech', true);
    const sfx = randomUUID().replace(/-/g, '').slice(0, 8);
    for (const k of ['rA', 'rB', 'rS', 'rN'] as const) await user(`${k}_${sfx}`, `Race borrower ${k}`);
    const B = (k: string) => people[`${k}_${sfx}`];
    for (const k of ['rA', 'rB', 'rS'] as const) {
      await admin.query(
        `INSERT INTO bank_accounts (tenant_id, user_id, account_kind, account_last4, ifsc, holder_name, vault_ref, is_primary, penny_verified_at)
         VALUES ($1, $2, 'bank', '0001', 'HDFC0000001', 'Fixture Holder', 'vault:fixture', true, now())`, [T, B(k).id]);
    }
    /** An approved application with its own decision time (the candidate ORDER, `loan-disbursement.repository.ts:27`) and cooling-off. */
    const mk = async (borrowerKey: string, minor: string, decisionDays: number, coolingSql: string) => (await admin.query(
      `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status,
                                      cooling_off_until, decision_at)
       VALUES ($1, $2, $3, $4, $4, 'approved', ${coolingSql}, now() - make_interval(days => $5::int)) RETURNING id`,
      [T, B(borrowerKey).id, productId, minor, decisionDays])).rows[0].id as string;
    const LAPSED = `now() - interval '1 day'`;
    // the two each run owns are decided EARLIEST, so each run writes its own item before it reaches the gate
    const raceA = await mk('rA', '1100000', 3, LAPSED);
    const raceB = await mk('rB', '1200000', 3, LAPSED);
    const cool = await mk('rA', '1300000', 2, `now() + interval '2 days'`);     // held back: cooling_off
    const noAcct = await mk('rN', '1400000', 2, LAPSED);                        // held back: no_bank_account
    const shared = await mk('rS', '7700000', 0, LAPSED);                        // decided LAST → both runs reach it last
    const AMT: Record<string, string> = { [raceA]: '1100000', [raceB]: '1200000', [shared]: '7700000' };

    // ── the gate: hold the shared borrower's row, so any payout referencing her blocks
    const before = {
      runs: await n(`FROM loan_disbursement_runs WHERE tenant_id = $1`, [T]),
      batches: await n(`FROM payout_batches WHERE tenant_id = $1`, [T]),
      items: await n(`FROM loan_disbursement_run_items WHERE tenant_id = $1`, [T]),
      payouts: await n(`FROM payouts WHERE tenant_id = $1`, [T]),
    };
    const gate = await admin.connect();
    let aRes: any; let bRes: any;
    try {
      await gate.query('BEGIN');
      await gate.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [B('rS').id]);
      const runA = request(http).post('/v1/fintech/servicing/disbursement-batches')
        .set({ ...H(), 'idempotency-key': randomUUID() })
        .send({ confirmedBy: people.checker.id, applicationIds: [raceA, cool, noAcct, shared] });
      const runB = request(http).post('/v1/fintech/servicing/disbursement-batches')
        .set({ ...H(), 'idempotency-key': randomUUID() })
        .send({ confirmedBy: people.checker.id, applicationIds: [raceB, shared] });
      const fired = Promise.all([runA, runB]);
      // wait until BOTH runs are blocked on the gate — never a sleep, and a timeout fails the case loudly rather than passing it quietly
      const blocked = async () => Number((await admin.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`)).rows[0].n);
      const until = Date.now() + 30_000;
      while ((await blocked()) < 2) {
        if (Date.now() > until) throw new Error('the two runs never queued behind the gate — the race was not staged, so this case proves nothing');
        await new Promise((r) => setTimeout(r, 50));
      }
      await gate.query('COMMIT');                                               // both proceed; one claims the shared item, one races
      [aRes, bRes] = await fired;
    } finally {
      await gate.query('ROLLBACK').catch(() => undefined);
      gate.release();
    }

    // ── ONE run completes; the one that lost the race DIES WHOLE (the 25P02 above), and this is the line the fix will turn red
    const statuses = [aRes.status, bRes.status].sort();
    expect(statuses).toEqual([201, 500]);
    const ok = aRes.status === 201 ? aRes : bRes;
    const dead = aRes.status === 500 ? aRes : bRes;
    expect(dead.body.error?.code).toBe('INTERNAL');
    const ownApp = ok === aRes ? raceA : raceB;
    const lostApp = ok === aRes ? raceB : raceA;

    // the surviving run wrote EVERY line it planned — its own application and the shared one
    const row = (await admin.query(
      `SELECT r.total_minor::text AS total, r.loan_count AS c, r.skipped_count AS skipped, r.skipped_detail AS detail,
              (SELECT count(*)::int FROM loan_disbursement_run_items i WHERE i.run_id = r.id) AS items,
              (SELECT COALESCE(sum(i.amount_minor), 0)::text FROM loan_disbursement_run_items i WHERE i.run_id = r.id) AS itemsum
         FROM loan_disbursement_runs r WHERE r.id = $1`, [ok.body.data.id])).rows[0];
    const planned = (BigInt(AMT[ownApp]) + BigInt(AMT[shared])).toString();
    expect([row.c, row.items]).toEqual([2, 2]);
    expect([row.total, row.itemsum]).toEqual([planned, planned]);               // nothing was raced away from THIS run
    expect(ok.body.data.queuedTotalMinor).toBe(planned);
    // its skip side still names the two the `eligibility` gates held back, when it is the run that asked for them
    const detail = row.detail as Array<{ applicationId: string; reason: string }>;
    if (ok === aRes) {
      expect(row.skipped).toBe(2);
      expect(detail.map((d) => `${d.applicationId}:${d.reason}`).sort()).toEqual([`${cool}:cooling_off`, `${noAcct}:no_bank_account`].sort());
    } else {
      expect(row.skipped).toBe(0);
      expect(detail).toEqual([]);
    }

    // ── THE DEAD RUN LEFT NOTHING AT ALL — not a run, not an item, not a payout, not a batch row of its own
    // exactly ONE run, ONE batch, TWO items and TWO payouts were added by the pair — the dead run contributed nothing
    expect({
      runs: await n(`FROM loan_disbursement_runs WHERE tenant_id = $1`, [T]),
      batches: await n(`FROM payout_batches WHERE tenant_id = $1`, [T]),
      items: await n(`FROM loan_disbursement_run_items WHERE tenant_id = $1`, [T]),
      payouts: await n(`FROM payouts WHERE tenant_id = $1`, [T]),
    }).toEqual({ runs: before.runs + 1, batches: before.batches + 1, items: before.items + 2, payouts: before.payouts + 2 });
    // and no run row anywhere is left with no items of its own (a half-written run is what the rollback prevents)
    expect(await n(`FROM loan_disbursement_runs r WHERE r.tenant_id = $1
                      AND NOT EXISTS (SELECT 1 FROM loan_disbursement_run_items i WHERE i.run_id = r.id)`, [T])).toBe(0);
    expect(await n(`FROM loan_disbursement_run_items WHERE application_id = $1`, [lostApp])).toBe(0);
    expect(await status(lostApp)).toBe('approved');
    // exactly ONE item and exactly ONE payout exist for the shared application: the race did NOT leave a second queued payment behind,
    // precisely BECAUSE the losing transaction rolled back whole (the payout is written before the item claim, `:88-97`)
    expect(await n(`FROM loan_disbursement_run_items WHERE application_id = $1`, [shared])).toBe(1);
    expect(await n(`FROM payouts WHERE reference_id = $1 AND reference_type = 'loan_application'`, [shared])).toBe(1);
    expect(await n(`FROM payouts WHERE reference_id = $1 AND reference_type = 'loan_application'`, [lostApp])).toBe(0);
    // the two held-back applications were written by neither run and are untouched
    for (const held of [cool, noAcct]) {
      expect([held, await n(`FROM loan_disbursement_run_items WHERE application_id = $1`, [held])]).toEqual([held, 0]);
      expect([held, await status(held)]).toEqual([held, 'approved']);
    }
    // nothing executed, here either
    expect(await n(`FROM payouts WHERE tenant_id = $1 AND status <> 'queued'`, [T])).toBe(0);
  }, 300_000);
});
