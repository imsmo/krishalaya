// apps/api/src/__tests__/partner5a-servicing-lockdown.integration.spec.ts · PC-56 PARTNER-5a · THE FOUR NAMED REFUSALS ON THE TENANT PLANE —
// the LIVE proof (the real AppModule over HTTP, real Postgres + RLS + the in-process wallet) of the wave's first commit, which touches the
// money path in the REFUSING direction only (founder 5a-1 … 5a-4; survey_partner5.md F-1, F-2, F-3, F-13).
//
// Fixture: `fintech` ON; one cooperative; a `banker` who ALSO holds `farmer` (tenant token with `loan.manage` + `loan.borrow` — the actor the
// removed `canManage` branch let debit any member's wallet); a second manager (tenant_admin, `loan.manage`); two borrowers (farmer,
// `loan.borrow`) whose wallets are FUNDED through the app's own WalletPort, each with active loans; an Idempotency-Key on every write.
//
//   (1) propose → 201 draft; → mediation 201; → accepted → 409 RESTRUCTURE_ACCEPTANCE_NOT_LIVE; the row still `mediation`,
//       `borrower_accept_otp_status` still 'pending', `accepted_at` still NULL.                                          (founder 5a-2)
//   (2) a restructure placed in `accepted` by FIXTURE SQL (proposed_by = banker) → checker_approved by the PROPOSER → 403 'maker-checker: the
//       checker must differ from the proposer' (F-13: the first live test of this rule); by the OTHER manager → 201.          [M2]
//   (3) → activated → 409 RESTRUCTURE_ACTIVATION_NOT_LIVE, the loan still `active`, the restructure still `checker_approved`; a SECOND loan
//       closed by fixture SQL after its draft (its restructure put in checker_approved by SQL) → activated → 409 and the loan still `closed`
//       (F-1's resurrection of a closed loan as a frozen debt cannot happen).                                         (5a-1) [M3]
//   (4) write-off on an `overdue` fixture loan → 409 WRITE_OFF_NOT_LIVE; still `overdue`, `outstanding_minor` unchanged; the reason string
//       is in NO row of audit_log, outbox_events, loans, loan_restructures or idempotency_keys (searched as the row's text cast).   (5a-3)
//   (5) the banker-farmer repays ANOTHER member's loan → 403 LOAN_REPAY_OWN_WALLET_ONLY; no new ledger_transactions / ledger_entries row;
//       the member's, the banker's and the cooperative's wallet balances unchanged; no loan_repayments row. The borrower repays her OWN
//       loan → 201, two legs posted (her wallet down, the cooperative's main up), outstanding reduced — unchanged behaviour.   (5a-4) [M4]
//   (6) `fintech` OFF → every /v1/fintech/servicing/* route 404 (the partner4a-servicing-flag list); a PARTNER session token (signed in via
//       /v1/partner/auth/verify) on /v1/fintech/servicing/dpd and on a write → refused by the tenant verifier (401/403); nothing written.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../core/wallet/wallet.port';
import { userMain, platform, PlatformAccount } from '../core/wallet/account-codes';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const REASON = 'LOCKDOWN-REASON-QZV the borrower moved away and the cattle died';
const PROPOSAL = { reasonCode: 'weather_distress', oldInstalmentMinor: '100000', newInstalmentMinor: '80000', oldTenorMonths: 12, newTenorMonths: 18, rateAprBps: 700, totalInterestDeltaMinor: '5000' };

run('PC-56 PARTNER-5a · activation, acceptance, write-off and the desk repayment are refused by name on the tenant plane (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T = randomUUID(); const P = randomUUID();
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, string> = {};
  const loan: Record<string, string> = {};
  let productId = ''; let restructureId = ''; let acceptedId = ''; let closedRestructureId = '';
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};

  const H = (key: string) => ({ authorization: `Bearer ${tok[key]}`, 'x-tenant-id': T });
  const K = () => randomUUID();
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone };
  };
  const tenantRole = (key: string, role: string) => admin.query(
    `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3`, [people[key].id, T, role]);
  const n = async (table: string) => Number((await admin.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);
  const loanRow = async (id: string) => (await admin.query(`SELECT status::text AS status, outstanding_minor::text AS outstanding FROM loans WHERE id = $1`, [id])).rows[0];
  const restructure = async (id: string) => (await admin.query(
    `SELECT status, borrower_accept_otp_status AS otp, accepted_at, checker_id FROM loan_restructures WHERE id = $1`, [id])).rows[0];
  const balUser = async (u: string) => BigInt((await admin.query(
    `SELECT COALESCE(cached_balance_minor, 0)::text AS b FROM wallet_accounts WHERE owner_kind = 'user' AND account_code = 'main' AND owner_user_id = $1`, [u])).rows[0]?.b ?? '0');
  const balTenant = async () => BigInt((await admin.query(
    `SELECT COALESCE(cached_balance_minor, 0)::text AS b FROM wallet_accounts WHERE owner_kind = 'tenant' AND account_code = 'main' AND owner_tenant_id = $1`, [T])).rows[0]?.b ?? '0');
  const transition = (who: string, id: string, to: string) =>
    request(http).post(`/v1/fintech/servicing/restructures/${id}/transition`).set(H(who)).set('idempotency-key', K()).send({ to });

  /** Every route of `fintech/servicing` (the partner4a-servicing-flag list), as a thunk. */
  const ROUTES = (who: string) => [
    ['GET dpd', () => request(http).get('/v1/fintech/servicing/dpd').set(H(who))],
    ['GET collections', () => request(http).get('/v1/fintech/servicing/collections').set(H(who))],
    ['POST kcc entry', () => request(http).post(`/v1/fintech/servicing/loans/${loan.a1}/kcc/entries`).set(H(who)).set('idempotency-key', K())
      .send({ entryKind: 'drawl', amountMinor: '100000', narrative: 'a fixture drawl' })],
    ['GET kcc ledger', () => request(http).get(`/v1/fintech/servicing/loans/${loan.a1}/kcc/ledger`).set(H(who))],
    ['POST restructure', () => request(http).post(`/v1/fintech/servicing/loans/${loan.a1}/restructures`).set(H(who)).set('idempotency-key', K()).send(PROPOSAL)],
    ['GET restructures', () => request(http).get(`/v1/fintech/servicing/loans/${loan.a1}/restructures`).set(H(who))],
    ['POST transition', () => request(http).post(`/v1/fintech/servicing/restructures/${acceptedId || randomUUID()}/transition`).set(H(who)).set('idempotency-key', K()).send({ to: 'rejected' })],
    ['GET disbursement-preview', () => request(http).get('/v1/fintech/servicing/disbursement-preview').set(H(who))],
    ['POST disbursement-batches', () => request(http).post('/v1/fintech/servicing/disbursement-batches').set(H(who)).set('idempotency-key', K()).send({ confirmedBy: people.manager2.id })],
    ['GET disbursement-batches', () => request(http).get('/v1/fintech/servicing/disbursement-batches').set(H(who))],
    ['GET disbursement-batches/:id', () => request(http).get(`/v1/fintech/servicing/disbursement-batches/${randomUUID()}`).set(H(who))],
    ['POST execute', () => request(http).post(`/v1/fintech/servicing/disbursement-batches/${randomUUID()}/execute`).set(H(who)).set('idempotency-key', K()).send({})],
    ['POST write-off', () => request(http).post(`/v1/fintech/servicing/loans/${loan.over}/write-off`).set(H(who)).set('idempotency-key', K()).send({ reason: REASON })],
  ] as const;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['fintech', 'partner_console']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T, 'Servicing Lockdown Collective');
    for (const [k, nm] of [['banker', 'Lockdown banker-farmer'], ['manager2', 'Lockdown second manager'], ['bA', 'Lockdown borrower A'],
      ['bB', 'Lockdown borrower B'], ['pMember', 'Lockdown partner member']] as const) await user(k, nm);
    await tenantRole('banker', 'banker'); await tenantRole('banker', 'farmer');
    await tenantRole('manager2', 'tenant_admin'); await tenantRole('bA', 'farmer'); await tenantRole('bB', 'farmer');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture Lockdown Lender', 'bank')`, [P, `p5al_${sfx}`]);
    await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'partner_admin'`, [people.pMember.id, P]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'kcc' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    productId = (await admin.query(
      `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
       VALUES ($1, $2, 'Fixture lockdown KCC', 100000, 50000000, 700, 'harvest_aligned') RETURNING id`, [P, kind])).rows[0].id;
    const mkLoan = async (key: string, borrowerKey: string, status: string, outstanding: string) => {
      const appId = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status)
         VALUES ($1, $2, $3, $4, $4, 'disbursed') RETURNING id`, [T, people[borrowerKey].id, productId, outstanding])).rows[0].id;
      loan[key] = (await admin.query(
        `INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status, outstanding_minor)
         VALUES ($1, $2, $3, $4, $5, 700, CURRENT_DATE - 30, $6::loan_status, $5) RETURNING id`, [appId, T, people[borrowerKey].id, P, outstanding, status])).rows[0].id;
    };
    await mkLoan('a1', 'bA', 'active', '2000000');     // restructure flows (1)–(3)
    await mkLoan('a2', 'bA', 'active', '1500000');     // the loan closed after its draft (3)
    await mkLoan('a3', 'bA', 'active', '1800000');     // the fixture `accepted` restructure (2)–(3) — one open restructure per loan (uq_loan_restructures_loan_open)
    await mkLoan('over', 'bB', 'overdue', '1200000');  // the write-off (4)
    await mkLoan('b1', 'bB', 'active', '900000');      // the repayments (5)

    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    // fund both borrowers' wallets through the app's OWN money boundary (Law 2) — never a raw ledger insert
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK); const wallet = app.get<WalletPort>(WALLET_SERVICE);
    for (const k of ['bA', 'bB'] as const) {
      await uow.run(T, (tx) => wallet.post(tx, { tenantId: T, txnType: 'order_payment', idempotencyKey: `p5a-fund:${randomUUID()}`, initiatedBy: 'system',
        legs: [{ account: userMain(people[k].id), amountMinor: 5_000_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -5_000_000n }] }), { userId: 'system' });
    }
    tok.banker = mintToken(app, { userId: people.banker.id, tenantId: T, roles: ['banker', 'farmer'], perms: ['loan.manage', 'loan.borrow'] });
    tok.manager2 = mintToken(app, { userId: people.manager2.id, tenantId: T, roles: ['tenant_admin'], perms: ['loan.manage'] });
    tok.bB = mintToken(app, { userId: people.bB.id, tenantId: T, roles: ['farmer'], perms: ['loan.borrow'] });
    await setFlag('fintech', true);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`,
        [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
      if (cache) for (const x of flagKeys(k)) await cache.del(x).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) propose → draft; → mediation; → accepted is REFUSED BY NAME (409) and the row stays in mediation with the OTP status pending', async () => {
    const prop = await request(http).post(`/v1/fintech/servicing/loans/${loan.a1}/restructures`).set(H('banker')).set('idempotency-key', K()).send(PROPOSAL);
    expect([prop.status, prop.body?.data?.status]).toEqual([201, 'draft']);
    restructureId = prop.body.data.id;
    const med = await transition('banker', restructureId, 'mediation');
    expect([med.status, med.body?.data?.status]).toEqual([201, 'mediation']);
    for (const who of ['banker', 'manager2']) {
      const acc = await transition(who, restructureId, 'accepted');
      expect([who, acc.status, acc.body?.error?.code]).toEqual([who, 409, 'RESTRUCTURE_ACCEPTANCE_NOT_LIVE']);
      expect(acc.body.error.message).toMatch(/cannot be recorded on the platform yet/);
    }
    expect(await restructure(restructureId)).toMatchObject({ status: 'mediation', otp: 'pending', accepted_at: null, checker_id: null });
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) MAKER-CHECKER: a row in `accepted` (fixture SQL) cannot be checker-approved by its proposer (403), and can by another manager', async () => {
    acceptedId = (await admin.query(
      `INSERT INTO loan_restructures (tenant_id, loan_id, reason_code, old_instalment_minor, new_instalment_minor, old_tenor_months, new_tenor_months,
                                      rate_apr_bps, total_interest_delta_minor, status, proposed_by, accepted_at)
       VALUES ($1, $2, 'weather_distress', 100000, 80000, 12, 18, 700, 5000, 'accepted', $3, now()) RETURNING id`, [T, loan.a3, people.banker.id])).rows[0].id;
    const self = await transition('banker', acceptedId, 'checker_approved');
    // The service throws ForbiddenError('maker-checker: the checker must differ from the proposer') (servicing.service.ts). Over HTTP the
    // global exception filter REPLACES that sentence with the i18n catalog's generic `error.FORBIDDEN` ("You do not have permission to do
    // this.", core/i18n/locales/en.ts) — so the caller never reads WHY. Pinned as it is (a finding for the report), and the rule itself is
    // proven by what did NOT happen: the row is still `accepted` with no checker.
    expect([self.status, self.body?.error?.code]).toEqual([403, 'FORBIDDEN']);
    expect(self.body?.error?.message).toBe('You do not have permission to do this.');
    expect(await restructure(acceptedId)).toMatchObject({ status: 'accepted', checker_id: null });
    const other = await transition('manager2', acceptedId, 'checker_approved');
    expect([other.status, other.body?.data?.status]).toEqual([201, 'checker_approved']);
    expect(await restructure(acceptedId)).toMatchObject({ status: 'checker_approved', checker_id: people.manager2.id });
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) → activated is REFUSED BY NAME (409): the loan stays active; a loan CLOSED after its draft is not resurrected', async () => {
    for (const who of ['banker', 'manager2']) {
      const act = await transition(who, acceptedId, 'activated');
      expect([who, act.status, act.body?.error?.code]).toEqual([who, 409, 'RESTRUCTURE_ACTIVATION_NOT_LIVE']);
      expect(act.body.error.message).toMatch(/cannot be activated on the platform yet/);
    }
    expect((await loanRow(loan.a3)).status).toBe('active');
    expect((await restructure(acceptedId)).status).toBe('checker_approved');
    // the second loan: drafted through the API, then CLOSED (repaid elsewhere) by fixture SQL, its restructure placed in checker_approved
    const prop = await request(http).post(`/v1/fintech/servicing/loans/${loan.a2}/restructures`).set(H('banker')).set('idempotency-key', K()).send(PROPOSAL);
    expect([prop.status, prop.body?.data?.status]).toEqual([201, 'draft']);
    closedRestructureId = prop.body.data.id;
    await admin.query(`UPDATE loans SET status = 'closed', outstanding_minor = 0 WHERE id = $1`, [loan.a2]);
    await admin.query(`UPDATE loan_restructures SET status = 'checker_approved', checker_id = $2, checker_approved_at = now() WHERE id = $1`, [closedRestructureId, people.manager2.id]);
    const act = await transition('manager2', closedRestructureId, 'activated');
    expect([act.status, act.body?.error?.code]).toEqual([409, 'RESTRUCTURE_ACTIVATION_NOT_LIVE']);
    expect(await loanRow(loan.a2)).toEqual({ status: 'closed', outstanding: '0' });
    expect((await restructure(closedRestructureId)).status).toBe('checker_approved');
    // and no loan anywhere in this cooperative was ever set to `restructured`
    expect((await admin.query(`SELECT count(*)::int AS n FROM loans WHERE tenant_id = $1 AND status = 'restructured'`, [T])).rows[0].n).toBe(0);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) write-off is REFUSED BY NAME (409): the loan stays overdue, the outstanding unchanged, and the reason is kept in NO row', async () => {
    const before = await loanRow(loan.over);
    expect(before).toEqual({ status: 'overdue', outstanding: '1200000' });
    for (const who of ['banker', 'manager2']) {
      const wo = await request(http).post(`/v1/fintech/servicing/loans/${loan.over}/write-off`).set(H(who)).set('idempotency-key', K()).send({ reason: REASON });
      expect([who, wo.status, wo.body?.error?.code]).toEqual([who, 409, 'WRITE_OFF_NOT_LIVE']);
      expect(wo.body.error.message).toMatch(/cannot be recorded on the platform yet/);
      expect(JSON.stringify(wo.body)).not.toContain(REASON);
    }
    expect(await loanRow(loan.over)).toEqual(before);
    const tables = (await admin.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY 1`,
      [['audit_log', 'outbox_events', 'loans', 'loan_restructures', 'idempotency_keys']])).rows.map((r) => r.table_name);
    expect(tables).toEqual(['audit_log', 'idempotency_keys', 'loan_restructures', 'loans', 'outbox_events']);
    for (const t of tables) {
      const hits = (await admin.query(`SELECT count(*)::int AS n FROM ${t} x WHERE x::text LIKE $1`, [`%LOCKDOWN-REASON-QZV%`])).rows[0].n;
      expect([t, hits]).toEqual([t, 0]);
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) the banker-farmer cannot repay ANOTHER member\'s loan from her wallet (403, nothing posted); the borrower repays her own (201)', async () => {
    const snap = async () => ({
      txns: await n('ledger_transactions'), entries: await n('ledger_entries'),
      member: await balUser(people.bB.id), banker: await balUser(people.banker.id), coop: await balTenant(),
      repayments: Number((await admin.query(`SELECT count(*)::int AS n FROM loan_repayments WHERE loan_id = $1`, [loan.b1])).rows[0].n),
      loan: await loanRow(loan.b1),
    });
    const before = await snap();
    expect(before.member).toBe(5_000_000n);
    const desk = await request(http).post(`/v1/fintech/loans/${loan.b1}/repay`).set(H('banker')).set('idempotency-key', K()).send({ amountMinor: '100000' });
    expect([desk.status, desk.body?.error?.code]).toEqual([403, 'LOAN_REPAY_OWN_WALLET_ONLY']);
    expect(desk.body.error.message).toMatch(/A desk cannot repay a member's loan from her wallet/);
    expect(await snap()).toEqual(before);
    // the borrower's own repayment — UNCHANGED: two legs, her wallet down, the cooperative's main up, the outstanding reduced
    const own = await request(http).post(`/v1/fintech/loans/${loan.b1}/repay`).set(H('bB')).set('idempotency-key', K()).send({ amountMinor: '100000' });
    expect([own.status, own.body?.error ?? null]).toEqual([201, null]);
    const after = await snap();
    expect(after).toEqual({
      txns: before.txns + 1, entries: before.entries + 2,
      member: before.member - 100_000n, banker: before.banker, coop: before.coop + 100_000n,
      repayments: before.repayments + 1, loan: { status: 'active', outstanding: '800000' },
    });
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) `fintech` OFF → every servicing route 404; a PARTNER session token on the servicing plane is refused; nothing written', async () => {
    const counts = async () => ({ restructures: await n('loan_restructures'), kcc: await n('kcc_drawl_ledger'), payouts: await n('payouts'), runs: await n('loan_disbursement_runs') });
    const statuses = async () => Promise.all([loan.a1, loan.a2, loan.a3, loan.over, loan.b1].map(async (id) => (await loanRow(id)).status));
    const before = { c: await counts(), s: await statuses() };
    await setFlag('fintech', false);
    try {
      for (const [name, fire] of ROUTES('banker')) expect([name, (await fire()).status]).toEqual([name, 404]);
    } finally { await setFlag('fintech', true); }
    // a partner member, signed in through the partner realm's own OTP door
    await setFlag('partner_console', true);
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
    const { code } = await otp.issue(people.pMember.phone);
    const v = await request(http).post('/v1/partner/auth/verify').send({ phone: people.pMember.phone, code });
    expect(v.status).toBe(201);
    tok.partner = v.body.data.accessToken;
    for (const [name, fire] of [
      ['GET dpd', () => request(http).get('/v1/fintech/servicing/dpd').set(H('partner'))],
      ['GET dpd (no tenant header)', () => request(http).get('/v1/fintech/servicing/dpd').set({ authorization: `Bearer ${tok.partner}` })],
      ['POST write-off', () => request(http).post(`/v1/fintech/servicing/loans/${loan.over}/write-off`).set(H('partner')).set('idempotency-key', K()).send({ reason: REASON })],
      ['POST restructure', () => request(http).post(`/v1/fintech/servicing/loans/${loan.a1}/restructures`).set(H('partner')).set('idempotency-key', K()).send(PROPOSAL)],
    ] as const) {
      const r = await fire();
      expect([name, [401, 403].includes(r.status)]).toEqual([name, true]);
    }
    expect({ c: await counts(), s: await statuses() }).toEqual(before);
  }, 120_000);
});
