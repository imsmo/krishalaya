// apps/api/src/__tests__/partner4a-lender-book.integration.spec.ts · PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK — FACTS, NEVER A
// BORROWER — LIVE proof (the real AppModule over HTTP, real Postgres + RLS: the kv_partner axis through 0231's four definers, and 0231's
// COLUMN GRANTS as the wall — `loans.borrower_user_id` and `loan_repayments.channel` are a 42501 on the axis, not merely absent from a view).
//
// Fixture (the 3a / 2c path): FIVE financial partners — lender A (the book under test), lender B (the rival), an INSURER (whose member must
// get an empty book, not an error), a PAGING lender with a 101-row book, and a BOUNDARY lender with two loans one second either side of the
// IST financial-year start — each with a real member; TWO cooperatives (tenants) with real borrowers; A's loans in EVERY status of
// `loan_status` INCLUDING `transferred` (the value nothing writes — survey §1E) and one whose product kind does not resolve to a platform
// `loan_kind` (it must print as "not recorded"), one loan opened BEFORE the FY start, and repayments carrying
// `channel = 'milk_bill_deduction'` — the one value that tells a lender whose milk cheque was debited. `partner_console` ON, `fintech` OFF
// throughout (the partner realm deliberately does not consult the tenant-scoped flag — survey F-20 / E5).
//
//   (1) ownership: A's viewer reads only A's loans, NEWEST first; B's loan id → 404 PARTNER_LOAN_NOT_FOUND (an absent id and a non-uuid the
//       same, and never "not yours"); the INSURER's member → an EMPTY book and zero counts, not an error                           [M5]
//   (2) DEEP-KEY absence over list, detail, repayments AND counts: no borrowerUserId / borrower_user_id / channel / createdBy / updatedBy /
//       originationFeeTxnId / tenantId / purposeText / decisionNote / applicantUserId / phone / name / narrative at ANY depth, and no
//       borrower id, name, phone or tenant id as a VALUE                                                                      [M3, M7]
//   (3) THE GRANT IS THE WALL: inside `SET LOCAL ROLE kv_partner`, `SELECT borrower_user_id FROM loans`, `SELECT channel FROM
//       loan_repayments` and `SELECT * FROM loans` are each 42501 — and so is `SELECT 1` on each of the EIGHT forbidden tables; the granted
//       columns still read; kv_app cannot EXECUTE a definer                                                                        [M4]
//   (4) the NULL guard: `app.partner_id` unset → ZERO rows from all four definers; a tenant token → 401; `partner_console` OFF → 404 on
//       every route; all four partner roles hold `partner.loans.read`                                                              [M6]
//   (5) the counts equal a HAND-COMPUTED fixture (status × platform `loan_kind` code × the IST FY window): the pre-FY loan excluded, the
//       unresolvable kind counted as `not_recorded`, `transferred` in `total` but in no status bucket, bigint sums exact, and NOT ONE `%`;
//       the IST boundary proven at 31 Mar 23:59:59 vs 1 Apr 00:00:00; a malformed window → 422
//   (6) keyset paging over a 101-row book: exact, no row twice, no row missed; `limit` clamped (101 → 422 from the DTO, 100 honoured) and
//       DEFAULTED to 25
//   (7) ONE partner-realm audit row per read (list / detail / repayments / counts), `tenant_id` NULL, `actor_role = partner:<id>:<roles>`,
//       `new_value` keys from the allow-list only, a refused probe recorded with `found:false`, and NO amount and NO person anywhere  [M8]
//   (8) the NINE absent act routes pinned: disburse / write-off / restructure / disbursements / disbursement-batches / kcc entries /
//       kcc limit-review / kcc ledger → 404, and a `channel` filter on the repayment history refused by the strict DTO
//   (9) THE MACHINE REALM STILL AGREES: with `partner_api` ON and one key, `GET /v1/partner-api/lending/loans` and `…/:id/repayments`
//       answer 200 WITHOUT `borrowerUserId` and WITHOUT `channel` and do not 500 — the same-commit `partner-api.repository.ts` edit
import 'reflect-metadata';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});
/** Every property name the lender's book must never carry, at any depth (brief §C / survey §7 case 2). */
const FORBIDDEN_KEY = /^(borrowerUserId|borrower_user_id|borrower|channel|repaymentChannel|repayment_channel|createdBy|created_by|updatedBy|updated_by|originationFeeTxnId|origination_fee_txn_id|tenantId|tenant_id|purposeText|purpose_text|decisionNote|decision_note|applicantUserId|applicant_user_id|phone|name|narrative|ledgerTxnId|ledger_txn_id|bankAccount|bank_account|creditScore|credit_score)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
/** The eight tables kv_partner must hold NOTHING on (0231.4(b)). */
const FORBIDDEN_TABLES = ['kcc_drawl_ledger', 'loan_restructures', 'loan_disbursement_runs', 'loan_disbursement_run_items',
  'credit_scores', 'credit_score_consents', 'bank_accounts', 'payouts'] as const;
/** The application text a lender must never read before approval, and the decision note it must never read at all (founder 4a-2). */
const PURPOSE = 'Two acres of groundnut and a borewell pump that stopped in June';
const DECISION = 'Rejected earlier because the milk bill was short three months running';
/** The four definers of 0231, with a call that is valid on an empty axis. */
const DEFINERS = (loanId: string) => [
  ['partner_loans', `SELECT * FROM partner_loans(NULL, NULL, NULL, 100)`, [] as unknown[]],
  ['partner_loan', `SELECT * FROM partner_loan($1::uuid)`, [loanId]],
  ['partner_loan_repayments', `SELECT * FROM partner_loan_repayments($1::uuid, 200)`, [loanId]],
  ['partner_loan_counts', `SELECT * FROM partner_loan_counts('2000-01-01', '2100-01-01')`, []],
] as const;

run('PC-56 PARTNER-4a · a lender reads the loan facts on its own book — never a borrower, never a channel (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T1 = randomUUID(); const T2 = randomUUID();
  const LA = randomUUID(); const LB = randomUUID(); const INS = randomUUID(); const LP = randomUUID(); const LD = randomUUID();
  const people: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const prod: Record<string, string> = {};
  const loan: Record<string, string> = {};
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  const kinds: Record<string, string> = {};
  let foreignLookup = '';
  let fy = 0;
  let pagingIds: string[] = [];
  /** Two explicit windows, as IST calendar days: one wide enough to reach A's pre-FY loan, one straddling the FY boundary. */
  let wide = { from: '', to: '' }; let bound = { from: '', to: '' };
  let machineKey = { prefix: '', secret: '' };

  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone, name };
  };
  const membership = (userKey: string, partnerId: string, role: string) => admin.query(
    `INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`,
    [people[userKey].id, partnerId, role]);
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
  const bearer = (key: string) => ({ authorization: `Bearer ${tok[key]}` });
  const get = async (key: string, path: string, query: Record<string, unknown> = {}) => {
    const r = await request(http).get(path).query(query).set(bearer(key));
    responses.push(r.body);
    return r;
  };
  /** The kv_partner AXIS, exactly as the repository wears it: SET LOCAL ROLE + app.partner_id, always rolled back. */
  async function asPartnerAxis<T>(partnerId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
      if (partnerId) await c.query(`SELECT set_config('app.partner_id', $1, true)`, [partnerId]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const audits = async (partnerId: string) => (await admin.query(
    `SELECT tenant_id, actor_role, entity_type, entity_id, new_value FROM audit_log
      WHERE action = 'partner.loans.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'partner_api', 'fintech']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T1, 'Lender Book Growers Collective'); await makeTenant(admin, T2, 'Lender Book Dairy Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES
      ($1, $2, 'Fixture Lender A', 'bank'), ($3, $4, 'Fixture Lender B', 'nbfc'), ($5, $6, 'Fixture Insurer K', 'insurer'),
      ($7, $8, 'Fixture Paging Lender', 'bank'), ($9, $10, 'Fixture Boundary Lender', 'bank')`,
      [LA, `p4aa_${sfx}`, LB, `p4ab_${sfx}`, INS, `p4ai_${sfx}`, LP, `p4ap_${sfx}`, LD, `p4ad_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'Lender A admin'], ['aViewer', 'Lender A viewer'], ['bViewer', 'Lender B viewer'],
      ['iViewer', 'Insurer K viewer'], ['pViewer', 'Paging lender viewer'], ['dViewer', 'Boundary lender viewer'],
      ['b1', 'Borrower Savitri One'], ['b2', 'Borrower Ramesh Two'], ['b3', 'Borrower Hetal Three'], ['fpoAdmin', 'FPO admin']] as const) await user(k, n);
    await membership('aAdmin', LA, 'partner_admin'); await membership('aViewer', LA, 'partner_viewer');
    await membership('bViewer', LB, 'partner_viewer'); await membership('iViewer', INS, 'partner_viewer');
    await membership('pViewer', LP, 'partner_viewer'); await membership('dViewer', LD, 'partner_viewer');
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.fpoAdmin.id, T1]);

    for (const r of (await admin.query(`SELECT id, code FROM lookup_values WHERE type_code = 'loan_kind' AND tenant_id IS NULL`)).rows) kinds[r.code] = r.id;
    // a lookup value that is NOT a platform `loan_kind` — its product's kind must resolve to NULL → "not recorded"
    foreignLookup = (await admin.query(
      `SELECT id FROM lookup_values WHERE type_code <> 'loan_kind' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;

    const product = async (key: string, partnerId: string, kindId: string, name: string, bps: number) => {
      prod[key] = (await admin.query(
        `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
         VALUES ($1, $2, $3, 100000, 90000000, $4, 'harvest_aligned') RETURNING id`, [partnerId, kindId, name, bps])).rows[0].id;
    };
    await product('aKcc', LA, kinds.kcc, 'Fixture A KCC', 700);
    await product('aDairy', LA, kinds.dairy, 'Fixture A dairy term', 1125);
    await product('aCrop', LA, kinds.crop, 'Fixture A crop loan', 900);
    await product('aOdd', LA, foreignLookup, 'Fixture A unresolvable kind', 1200);
    await product('bKcc', LB, kinds.kcc, 'Fixture B KCC', 800);
    await product('pKcc', LP, kinds.kcc, 'Fixture paging KCC', 700);
    await product('dKcc', LD, kinds.kcc, 'Fixture boundary KCC', 700);

    /** One disbursed application + its loan, with a REAL borrower, a creator and a fee anchor the read must never return. */
    const mkLoan = async (key: string, tenantId: string, borrowerKey: string, partnerId: string, productKey: string,
      status: string, principal: string, outstanding: string, createdAtSql: string, params: unknown[] = []) => {
      const appId = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status,
                                        purpose_text, decision_note, created_by)
         VALUES ($1, $2, $3, $4, $4, 'disbursed', $5, $6, $2) RETURNING id`,
        [tenantId, people[borrowerKey].id, prod[productKey], principal, PURPOSE, DECISION])).rows[0].id;
      loan[key] = (await admin.query(
        `INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status,
                            outstanding_minor, origination_fee_txn_id, created_by, updated_by, created_at)
         SELECT $1, $2, $3, $4, $5, lp.interest_apr_bps, CURRENT_DATE - 30, $6::loan_status, $7, $8, $3, $3, ${createdAtSql}
           FROM loan_products lp WHERE lp.id = $9 RETURNING id`,
        [appId, tenantId, people[borrowerKey].id, partnerId, principal, status, outstanding, randomUUID(), prod[productKey], ...params])).rows[0].id;
      return loan[key];
    };
    const ago = (min: number) => `now() - interval '${min} minutes'`;
    // A's book: every status of the machine, both cooperatives, an unresolvable kind, and one loan opened BEFORE the FY start
    await mkLoan('la1', T1, 'b1', LA, 'aKcc', 'active', '2200000', '2200000', ago(100));
    await mkLoan('la2', T2, 'b2', LA, 'aDairy', 'overdue', '1500000', '1200000', ago(90));
    await mkLoan('la3', T1, 'b1', LA, 'aKcc', 'restructured', '3000000', '2500000', ago(80));
    await mkLoan('la4', T2, 'b2', LA, 'aCrop', 'closed', '1000000', '0', ago(70));
    await mkLoan('la5', T1, 'b3', LA, 'aCrop', 'written_off', '800000', '800000', ago(60));
    await mkLoan('la6', T2, 'b3', LA, 'aOdd', 'active', '500000', '500000', ago(50));
    // `transferred` exists in the enum and NOTHING writes it (survey §1E): it must still PRINT, and must not be a filter
    await mkLoan('la7', T1, 'b1', LA, 'aKcc', 'transferred', '900000', '900000', ago(40));
    // the pre-FY loan is anchored to the FY START, not to a calendar literal, so the window assertions below hold in any month
    // B's loan — A must never see it
    await mkLoan('lb1', T2, 'b3', LB, 'bKcc', 'active', '4444444', '4444444', ago(30));

    // repayments on A's first loan, one carrying the channel that names a cooperative's milk cheque
    for (const [due, dueMinor, paidMinor, chan] of [['-40', '300000', '300000', 'upi'], ['-20', '300000', '300000', 'milk_bill_deduction'],
      ['-5', '300000', '150000', 'harvest_settlement']] as const) {
      await admin.query(
        `INSERT INTO loan_repayments (loan_id, tenant_id, due_date, amount_due_minor, amount_paid_minor, paid_at, channel)
         VALUES ($1, $2, CURRENT_DATE + ($3)::int, $4, $5, now(), $6)`, [loan.la1, T1, due, dueMinor, paidMinor, chan]);
    }

    // the FY the database itself computes, and the two BOUNDARY loans one second either side of its first instant (IST)
    fy = (await admin.query(`SELECT CASE WHEN extract(month FROM (now() AT TIME ZONE 'Asia/Kolkata')::date) >= 4
      THEN extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int
      ELSE extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int - 1 END AS y`)).rows[0].y as number;
    const fyStart = `make_timestamptz(${fy}, 4, 1, 0, 0, 0, 'Asia/Kolkata')`;
    await mkLoan('ldOut', T1, 'b1', LD, 'dKcc', 'active', '111111', '111111', `${fyStart} - interval '1 second'`);
    await mkLoan('ldIn', T1, 'b1', LD, 'dKcc', 'active', '222222', '222222', fyStart);
    // A's pre-FY loan: 20 days BEFORE the FY start, so an explicit window 30 days wider reaches it without exceeding
    // the DTO's 400-day ceiling in any month of the year
    await mkLoan('laOld', T1, 'b1', LA, 'aKcc', 'active', '7777777', '7777777', `${fyStart} - interval '20 days'`);
    // the two explicit windows, as IST CALENDAR DAYS answered by the database (never a JS clock)
    const w = (await admin.query(
      `SELECT ((${fyStart} - interval '30 days') AT TIME ZONE 'Asia/Kolkata')::date::text AS wfrom,
              (((now() AT TIME ZONE 'Asia/Kolkata')::date) + 1)::text AS wto,
              ((${fyStart} + interval '30 days') AT TIME ZONE 'Asia/Kolkata')::date::text AS bto`)).rows[0];
    wide = { from: w.wfrom, to: w.wto }; bound = { from: w.wfrom, to: w.bto };

    // the 101-row book, one application per loan (`loans.application_id` is NOT NULL UNIQUE), each with its own created_at
    pagingIds = (await admin.query(
      `WITH s AS (SELECT g FROM generate_series(1, 101) g),
            a AS (INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status)
                  SELECT $1, $2, $3, 100000, 100000, 'disbursed' FROM s RETURNING id),
            n AS (SELECT id, row_number() OVER (ORDER BY id) AS k FROM a)
       INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status,
                          outstanding_minor, created_at)
       SELECT n.id, $1, $2, $4, 100000, 700, CURRENT_DATE - 1, 'active', 100000, now() - make_interval(secs => n.k::int)
         FROM n RETURNING id, created_at`,
      [T1, people.b1.id, prod.pKcc, LP])).rows.sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0)).map((r) => r.id);
    expect(pagingIds.length).toBe(101);

    // the machine realm's key for A (lending:book:read) — the shape db/scripts/mint-partner-key.js writes
    const secret = randomBytes(32).toString('base64url'); const prefix = `kv_pk_test_${randomBytes(8).toString('hex')}`;
    await admin.query(
      `INSERT INTO partner_api_keys (partner_id, name, key_prefix, key_hash, scopes, rate_limit_per_hour, is_active)
       VALUES ($1, 'p4a machine book', $2, $3, $4::jsonb, 10000, true)`,
      [LA, prefix, createHash('sha256').update(secret, 'utf8').digest('hex'), JSON.stringify(['partner:identity:read', 'lending:book:read'])]);
    machineKey = { prefix, secret };

    await setFlag('partner_console', true); await setFlag('fintech', false); await setFlag('partner_api', false);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of ['partner_console', 'partner_api', 'fintech'].flatMap(flagKeys)) await cache.del(k);
    for (const k of ['aAdmin', 'aViewer', 'bViewer', 'iViewer', 'pViewer', 'dViewer']) await signIn(k);
  }, 300_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`,
        [k, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  /** A's book, NEWEST first — the order the definer's keyset produces. */
  const A_ORDER = () => [loan.la7, loan.la6, loan.la5, loan.la4, loan.la3, loan.la2, loan.la1, loan.laOld];

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) A reads only A\'s loans, NEWEST first; B\'s loan → 404 by name; the insurer\'s member → an empty book, not an error', async () => {
    const all = await get('aViewer', '/v1/partner/loans', { limit: 100 });
    expect([all.status, all.status === 200 ? null : all.body]).toEqual([200, null]);
    expect(all.body.data.map((x: { id: string }) => x.id)).toEqual(A_ORDER());
    expect(all.body.meta).toMatchObject({ nextCursor: null, limit: 100, computedAt: expect.any(String) });
    // the facts, field by field — and the FPO by its PUBLIC name, never its id
    expect(all.body.data.find((x: { id: string }) => x.id === loan.la1)).toEqual({
      id: loan.la1, applicationId: expect.any(String), productId: prod.aKcc, productName: 'Fixture A KCC', kindCode: 'kcc',
      fpoName: 'Lender Book Growers Collective', principalMinor: '2200000', interestAprBps: 700,
      disbursedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), maturityDate: null, status: 'active', outstandingMinor: '2200000',
      nextDueDate: null, openedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/), lastChangedAt: expect.any(String),
    });
    expect(all.body.data.find((x: { id: string }) => x.id === loan.la2)).toMatchObject({ fpoName: 'Lender Book Dairy Collective', kindCode: 'dairy', interestAprBps: 1125 });
    // an unresolvable product kind is NULL — the console prints "not recorded", it does not invent a kind
    expect(all.body.data.find((x: { id: string }) => x.id === loan.la6)).toMatchObject({ kindCode: null });
    // `transferred` still PRINTS (it is in the enum) but is not a filter the DTO accepts
    expect(all.body.data.find((x: { id: string }) => x.id === loan.la7)).toMatchObject({ status: 'transferred' });
    expect((await get('aViewer', '/v1/partner/loans', { status: 'transferred' })).status).toBe(422);
    // the status filter, over the five the platform can produce
    for (const [status, ids] of [['active', [loan.la6, loan.la1, loan.laOld]], ['overdue', [loan.la2]], ['restructured', [loan.la3]],
      ['closed', [loan.la4]], ['written_off', [loan.la5]]] as const) {
      const r = await get('aViewer', '/v1/partner/loans', { status, limit: 100 });
      expect([status, r.body.data.map((x: { id: string }) => x.id)]).toEqual([status, ids]);
    }
    // nothing of B's, and no tenant id anywhere in the payload
    const json = JSON.stringify(all.body);
    expect(json).not.toContain(loan.lb1); expect(json).not.toContain(T1); expect(json).not.toContain(T2);
    // B's own axis sees B's loan only (0090's policy, not the application's filter)
    const b = await get('bViewer', '/v1/partner/loans');
    expect(b.body.data.map((x: { id: string }) => x.id)).toEqual([loan.lb1]);
    // B's loan id asked by A, an absent id, and a non-uuid: the same 404, and never "not yours"
    for (const id of [loan.lb1, randomUUID(), 'not-a-uuid']) {
      const r = await get('aViewer', `/v1/partner/loans/${id}`);
      expect([id, r.status, r.body.error?.code]).toEqual([id, 404, 'PARTNER_LOAN_NOT_FOUND']);
      expect(JSON.stringify(r.body)).not.toMatch(/not yours|another (lender|partner)/i);
      expect([id, (await get('aViewer', `/v1/partner/loans/${id}/repayments`)).status]).toEqual([id, 404]);
    }
    // the INSURER's member: an empty book and zero counts, not an error — an insurer has no lending book, and that is not a failure
    const i = await get('iViewer', '/v1/partner/loans');
    expect([i.status, i.body.data]).toEqual([200, []]);
    const ic = await get('iViewer', '/v1/partner/loans/counts');
    expect(ic.status).toBe(200);
    expect(ic.body.data).toMatchObject({ total: 0, servicing: { count: 0, outstandingMinor: '0' }, restructured: 0, writtenOff: { count: 0, outstandingMinor: '0' } });
    expect(Object.values(ic.body.data.byStatus).every((n) => n === 0)).toBe(true);
    expect(Object.values(ic.body.data.byKind).every((n) => n === 0)).toBe(true);
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) no borrower, no channel, no note anywhere — deep keys AND values, over list, detail, repayments and counts', async () => {
    const one = await get('aViewer', `/v1/partner/loans/${loan.la1}`);
    expect(one.status).toBe(200);
    expect(one.body.data).toMatchObject({ id: loan.la1, status: 'active', kindCode: 'kcc', computedAt: expect.any(String) });
    const rep = await get('aViewer', `/v1/partner/loans/${loan.la1}/repayments`);
    expect(rep.status).toBe(200);
    expect(rep.body.data).toHaveLength(3);
    expect(rep.body.data[0]).toEqual({
      id: expect.any(String), loanId: loan.la1, dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      amountDueMinor: '300000', amountPaidMinor: expect.any(String), paidAt: expect.any(String),
      recordedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
    });
    // newest due date first, and the amounts are bigint minor-unit STRINGS
    expect(rep.body.data.map((x: { amountPaidMinor: string }) => x.amountPaidMinor)).toEqual(['150000', '300000', '300000']);
    await get('aViewer', '/v1/partner/loans/counts');
    await get('aViewer', '/v1/partner/loans', { limit: 5 });
    expect(responses.length).toBeGreaterThanOrEqual(10);
    for (const body of responses) {
      expect(deepKeys(body).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(body);
      for (const p of ['b1', 'b2', 'b3']) {
        expect([p, json.includes(people[p].id), json.includes(people[p].name), json.includes(people[p].phone)]).toEqual([p, false, false, false]);
      }
      for (const v of ['milk_bill_deduction', 'harvest_settlement', PURPOSE, DECISION, T1, T2]) expect([v, json.includes(v)]).toEqual([v, false]);
    }
    // and 0231's own definers carry no identity column at all
    for (const [name, sql, params] of DEFINERS(loan.la1)) {
      const cols = (await asPartnerAxis(LA, (c) => c.query(sql, params as unknown[]))).fields.map((f) => f.name);
      expect([name, cols.filter((c) => /borrower|channel|created_by|updated_by|origination_fee|purpose|decision|narrative|phone/.test(c))]).toEqual([name, []]);
    }
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) THE GRANT IS THE WALL — a banned column is 42501 on the axis, `SELECT *` is 42501, the eight forbidden tables are 42501', async () => {
    for (const sql of ['SELECT borrower_user_id FROM loans', 'SELECT created_by FROM loans', 'SELECT updated_by FROM loans',
      'SELECT origination_fee_txn_id FROM loans', 'SELECT * FROM loans', 'SELECT channel FROM loan_repayments', 'SELECT * FROM loan_repayments']) {
      expect([sql, await errCode(asPartnerAxis(LA, (c) => c.query(sql)))]).toEqual([sql, '42501']);
    }
    // the GRANTED columns still read — the narrowing took exactly what it should and no more
    for (const sql of ['SELECT id, principal_minor, outstanding_minor, status FROM loans', 'SELECT id, due_date, amount_paid_minor FROM loan_repayments']) {
      expect([sql, await errCode(asPartnerAxis(LA, (c) => c.query(sql)))]).toEqual([sql, 'ok']);
    }
    for (const t of FORBIDDEN_TABLES) {
      expect([t, await errCode(asPartnerAxis(LA, (c) => c.query(`SELECT 1 FROM ${t}`)))]).toEqual([t, '42501']);
    }
    // a direct read of a `loan_repayments` PARTITION must not bypass the parent's narrowing either
    const child = (await admin.query(
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'loan_repayments' ORDER BY c.relname LIMIT 1`)).rows[0]?.relname as string | undefined;
    expect(typeof child).toBe('string');
    expect(await errCode(asPartnerAxis(LA, (c) => c.query(`SELECT channel FROM ${child}`)))).toBe('42501');
    // kv_app must wear the axis role: it cannot EXECUTE any of the four definers
    const kvApp = new Pool({ connectionString: APP_URL, max: 1 });
    try {
      for (const [name, sql, params] of DEFINERS(loan.la1)) {
        expect([name, await errCode(kvApp.query(sql, params as unknown[]))]).toEqual([name, '42501']);
      }
    } finally { await kvApp.end(); }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) the NULL guard (no partner in scope → no rows); a tenant token → 401; partner_console OFF → 404; four roles hold the permission', async () => {
    for (const [name, sql, params] of DEFINERS(loan.la1)) {
      expect([name, (await asPartnerAxis(null, (c) => c.query(sql, params as unknown[]))).rowCount]).toEqual([name, 0]);
    }
    // and another lender's axis sees nothing of A's
    expect((await asPartnerAxis(LB, (c) => c.query(`SELECT id FROM partner_loans(NULL, NULL, NULL, 100)`))).rows.map((x) => x.id)).toEqual([loan.lb1]);
    expect((await asPartnerAxis(LB, (c) => c.query(`SELECT id FROM partner_loan($1::uuid)`, [loan.la1]))).rowCount).toBe(0);
    expect((await asPartnerAxis(LB, (c) => c.query(`SELECT id FROM partner_loan_repayments($1::uuid, 200)`, [loan.la1]))).rowCount).toBe(0);

    const tenantTok = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T1, roles: ['tenant_admin'], perms: ['loan.manage'] });
    for (const p of ['/v1/partner/loans', '/v1/partner/loans/counts', `/v1/partner/loans/${loan.la1}`, `/v1/partner/loans/${loan.la1}/repayments`]) {
      const t = await request(http).get(p).set({ authorization: `Bearer ${tenantTok}`, 'x-tenant-id': T1 });
      expect([p, t.status, t.body.error?.code]).toEqual([p, 401, 'PARTNER_SESSION_REQUIRED']);
    }
    expect((jwt.decode(tok.aViewer) as { perms: string[] }).perms).toContain('partner.loans.read');
    expect((await request(http).get('/v1/partner/me').set(bearer('aViewer'))).body.data.person.permissions).toContain('partner.loans.read');
    expect((await admin.query(
      `SELECT string_agg(r.code, ',' ORDER BY r.code) AS roles FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
        WHERE rp.permission_code = 'partner.loans.read'`)).rows[0].roles).toBe('partner_admin,partner_checker,partner_maker,partner_viewer');
    await setFlag('partner_console', false);
    try {
      for (const p of ['/v1/partner/loans', '/v1/partner/loans/counts', `/v1/partner/loans/${loan.la1}`, `/v1/partner/loans/${loan.la1}/repayments`]) {
        expect([p, (await request(http).get(p).set(bearer('aViewer'))).status]).toEqual([p, 404]);
      }
    } finally { await setFlag('partner_console', true); }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) the counts equal the hand-computed fixture over the IST FY window — counts and bigint sums, not one `%`', async () => {
    const r = await get('aViewer', '/v1/partner/loans/counts');
    expect([r.status, r.status === 200 ? null : r.body]).toEqual([200, null]);
    const zeros = (ks: readonly string[]) => Object.fromEntries(ks.map((k) => [k, 0]));
    const zeroMinor = (ks: readonly string[]) => Object.fromEntries(ks.map((k) => [k, '0']));
    const KINDS = ['kcc', 'crop', 'tractor', 'dairy', 'whr', 'gold', 'bnpl', 'shg', 'tenant_wc', 'not_recorded'] as const;
    expect(r.body.data).toEqual({
      from: `${fy}-04-01`, to: `${fy + 1}-04-01`, timeZone: 'Asia/Kolkata',
      fy: `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`,
      // la1…la7 — the pre-FY loan (laOld) is OUT
      total: 7,
      // `transferred` (la7) is counted in `total` and in NO status bucket: nothing writes that state and the console does not claim it
      byStatus: { ...zeros(['active', 'overdue', 'restructured', 'closed', 'written_off']), active: 2, overdue: 1, restructured: 1, closed: 1, written_off: 1 },
      byKind: { ...zeros(KINDS), kcc: 3, dairy: 1, crop: 2, not_recorded: 1 },
      outstandingByKindMinor: { ...zeroMinor(KINDS), kcc: '5600000', dairy: '1200000', crop: '800000', not_recorded: '500000' },
      principalByKindMinor: { ...zeroMinor(KINDS), kcc: '6100000', dairy: '1500000', crop: '1800000', not_recorded: '500000' },
      servicing: { count: 3, outstandingMinor: '3900000' },
      restructured: 1,
      writtenOff: { count: 1, outstandingMinor: '800000' },
      computedAt: expect.any(String),
    });
    // the sum of the status buckets is 6 while total is 7 — the honest gap `transferred` leaves
    expect(Object.values(r.body.data.byStatus).reduce((a: number, b) => a + Number(b), 0)).toBe(6);
    // NOT ONE percentage, ratio, average or PAR figure anywhere on the lender's book
    expect(JSON.stringify(r.body)).not.toMatch(/%|percent|ratio|\brate\b|average|median|\bpar\b|onTime|on_time|dpd/i);
    // the IST FINANCIAL-YEAR BOUNDARY: 31 Mar 23:59:59 IST is out, 1 Apr 00:00:00 IST is in
    const d = await get('dViewer', '/v1/partner/loans/counts');
    expect([d.status, d.body.data.total, d.body.data.principalByKindMinor.kcc]).toEqual([200, 1, '222222']);
    const dAll = await get('dViewer', '/v1/partner/loans/counts', bound);
    expect([dAll.status, dAll.body.data?.total, dAll.body.data?.fy, dAll.body.data?.principalByKindMinor.kcc]).toEqual([200, 2, null, '333333']);
    // an explicit window that reaches back over the pre-FY loan counts it
    const w = await get('aViewer', '/v1/partner/loans/counts', wide);
    expect([w.status, w.status === 200 ? null : w.body]).toEqual([200, null]);
    expect(w.body.data).toMatchObject({ total: 8, fy: null, byStatus: { active: 3 }, principalByKindMinor: { kcc: '13877777' } });
    // a malformed window → 422 (one bound alone, a reversed window, a non-day)
    for (const q of [{ from: `${fy}-04-01` }, { to: `${fy}-04-01` }, { from: `${fy + 1}-04-01`, to: `${fy}-04-01` }, { from: 'yesterday', to: 'today' }]) {
      expect([JSON.stringify(q), (await get('aViewer', '/v1/partner/loans/counts', q)).status]).toEqual([JSON.stringify(q), 422]);
    }
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) keyset paging over a 101-row book is exact — no row twice, no row missed; the limit clamped and defaulted to 25', async () => {
    const def = await get('pViewer', '/v1/partner/loans');
    expect([def.status, def.body.data.length, def.body.meta.limit]).toEqual([200, 25, 25]);
    expect(def.body.data.map((x: { id: string }) => x.id)).toEqual(pagingIds.slice(0, 25));
    const hundred = await get('pViewer', '/v1/partner/loans', { limit: 100 });
    expect([hundred.body.data.length, hundred.body.meta.limit]).toEqual([100, 100]);
    // above the ceiling the DTO refuses rather than silently trimming — and the DEFINER clamps too (p_limit 500 → 100 rows)
    expect((await get('pViewer', '/v1/partner/loans', { limit: 101 })).status).toBe(422);
    expect((await get('pViewer', '/v1/partner/loans', { limit: 0 })).status).toBe(422);
    expect((await asPartnerAxis(LP, (c) => c.query(`SELECT id FROM partner_loans(NULL, NULL, NULL, 500)`))).rowCount).toBe(100);
    expect((await asPartnerAxis(LP, (c) => c.query(`SELECT id FROM partner_loans(NULL, NULL, NULL, NULL)`))).rowCount).toBe(25);
    // page the whole book at 40 a time: 40 + 40 + 21, then the cursor is exhausted
    const seen: string[] = [];
    let cursor: string | null = null; let pages = 0;
    do {
      const p: any = await get('pViewer', '/v1/partner/loans', cursor ? { limit: 40, cursor } : { limit: 40 });
      expect([pages, p.status]).toEqual([pages, 200]);
      seen.push(...p.body.data.map((x: { id: string }) => x.id));
      cursor = p.body.meta.nextCursor; pages += 1;
      expect(pages).toBeLessThan(10);
    } while (cursor);
    expect([pages, seen.length, new Set(seen).size]).toEqual([3, 101, 101]);
    expect(seen).toEqual(pagingIds);
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7)
  it('(7) ONE partner-realm audit row per read — counts only, tenant_id NULL, actor_role partner:<id>:<roles>, no amount, no person', async () => {
    const before = (await audits(LA)).length;
    await get('aAdmin', '/v1/partner/loans', { status: 'active' });
    await get('aAdmin', `/v1/partner/loans/${loan.la1}`);
    await get('aAdmin', `/v1/partner/loans/${loan.la1}/repayments`);
    await get('aAdmin', '/v1/partner/loans/counts');
    const rows = (await audits(LA)).slice(before);
    expect(rows.map((r) => r.new_value.surface)).toEqual(['loans', 'loan', 'loan_repayments', 'loans_counts']);
    expect(rows.map((r) => [r.entity_type, r.entity_id])).toEqual([
      ['financial_partner', LA], ['loan', loan.la1], ['loan', loan.la1], ['financial_partner', LA]]);
    const allowed = new Set(['partnerId', 'realm', 'surface', 'listed', 'status', 'page', 'found', 'from', 'to', 'loans']);
    for (const r of rows) {
      expect(r.tenant_id).toBeNull();
      expect(r.actor_role).toBe(`partner:${LA}:partner_admin`);
      expect(Object.keys(r.new_value).filter((k) => !allowed.has(k))).toEqual([]);
      expect(r.new_value).toMatchObject({ partnerId: LA, realm: 'partner' });
      const json = JSON.stringify(r);
      for (const p of ['b1', 'b2', 'b3']) expect([p, json.includes(people[p].id), json.includes(people[p].name)]).toEqual([p, false, false]);
      // no amount — not a principal, not an outstanding, not a repayment
      for (const amt of ['2200000', '1200000', '300000', '150000', '3900000']) expect([amt, json.includes(amt)]).toEqual([amt, false]);
    }
    expect(rows[0].new_value).toMatchObject({ listed: 3, status: 'active', page: 'first' });
    expect(rows[1].new_value).toMatchObject({ found: true });
    expect(rows[2].new_value).toMatchObject({ found: true, listed: 3 });
    expect(rows[3].new_value).toMatchObject({ loans: 7, from: `${fy}-04-01`, to: `${fy + 1}-04-01` });
    // a REFUSED probe is recorded too, with found:false — and carries no more of the asked-for entity than its id
    const n = (await audits(LA)).length;
    await get('aAdmin', `/v1/partner/loans/${loan.lb1}`);
    await get('aAdmin', `/v1/partner/loans/${loan.lb1}/repayments`);
    expect((await audits(LA)).slice(n).map((r) => [r.entity_id, r.new_value.found, r.new_value.surface]))
      .toEqual([[loan.lb1, false, 'loan'], [loan.lb1, false, 'loan_repayments']]);
    // the viewer's actor_role names the viewer's role, not the admin's
    const m = (await audits(LA)).length;
    await get('aViewer', '/v1/partner/loans/counts');
    expect((await audits(LA)).slice(m).map((r) => r.actor_role)).toEqual([`partner:${LA}:partner_viewer`]);
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (8)
  it('(8) nothing acts on a loan from this realm — the nine absences pinned, and nothing moved', async () => {
    const posts = [`/v1/partner/loans/${loan.la1}/disburse`, `/v1/partner/loans/${loan.la1}/write-off`, `/v1/partner/loans/${loan.la1}/restructure`,
      '/v1/partner/disbursements', '/v1/partner/disbursement-batches', `/v1/partner/kcc/${loan.la1}/entries`, `/v1/partner/kcc/${loan.la1}/limit-review`];
    for (const p of posts) {
      const r = await request(http).post(p).set(bearer('aAdmin')).send({ amountMinor: '100000', reason: 'a probe', confirmedBy: people.aAdmin?.id ?? randomUUID() });
      expect([p, r.status]).toEqual([p, 404]);
    }
    expect([(await request(http).get(`/v1/partner/kcc/${loan.la1}/ledger`).set(bearer('aAdmin'))).status]).toEqual([404]);
    for (const m of ['patch', 'put', 'delete'] as const) {
      expect([m, (await request(http)[m](`/v1/partner/loans/${loan.la1}`).set(bearer('aAdmin')).send({ status: 'closed' })).status]).toEqual([m, 404]);
    }
    // the ninth: there is no `channel` filter on the repayment history — the strict DTO refuses the parameter outright (422),
    // so the channel cannot even be NAMED on the axis. The survey asked for a 404; a 422 from the DTO is the stronger refusal
    // (the route exists and answers, the FILTER does not) and is recorded as such in the wave report's §6.
    expect((await get('aAdmin', `/v1/partner/loans/${loan.la1}/repayments`, { channel: 'milk_bill_deduction' })).status).toBe(422);
    // nothing moved: every status is still what the fixture wrote, and the money plane is untouched
    expect((await admin.query(`SELECT status::text AS s FROM loans WHERE id = ANY($1::uuid[]) ORDER BY created_at`,
      [[loan.la1, loan.la2, loan.la5, loan.la7]])).rows.map((x) => x.s)).toEqual(['active', 'overdue', 'written_off', 'transferred']);
    // scoped to THIS fixture's cooperatives and loans — another spec in the same run may legitimately hold rows of its own
    const mine = [T1, T2];
    for (const [t, sql] of [
      ['payouts', `SELECT count(*)::int AS n FROM payouts WHERE tenant_id = ANY($1::uuid[])`],
      ['payout_batches', `SELECT count(*)::int AS n FROM payout_batches WHERE tenant_id = ANY($1::uuid[])`],
      ['loan_disbursement_runs', `SELECT count(*)::int AS n FROM loan_disbursement_runs WHERE tenant_id = ANY($1::uuid[])`],
      ['kcc_drawl_ledger', `SELECT count(*)::int AS n FROM kcc_drawl_ledger WHERE tenant_id = ANY($1::uuid[])`],
      ['loan_restructures', `SELECT count(*)::int AS n FROM loan_restructures WHERE tenant_id = ANY($1::uuid[])`],
    ] as const) {
      expect([t, Number((await admin.query(sql, [mine])).rows[0].n)]).toEqual([t, 0]);
    }
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (9)
  it('(9) the MACHINE realm still agrees — the lending book answers without borrowerUserId and without channel, and does not 500', async () => {
    await setFlag('partner_api', true);
    try {
      const auth = { authorization: `Bearer ${machineKey.prefix}.${machineKey.secret}` };
      const me = await request(http).get('/v1/partner-api/me').set(auth);
      expect([me.status, me.body.data?.partnerId]).toEqual([200, LA]);
      const loans = await request(http).get('/v1/partner-api/lending/loans').query({ limit: 100 }).set(auth);
      expect([loans.status, loans.status === 200 ? null : loans.body]).toEqual([200, null]);
      expect(loans.body.data.length).toBeGreaterThanOrEqual(8);
      expect(deepKeys(loans.body).filter((k) => /^(borrowerUserId|borrower_user_id|channel|createdBy|updatedBy|originationFeeTxnId)$/.test(k))).toEqual([]);
      for (const p of ['b1', 'b2', 'b3']) expect([p, JSON.stringify(loans.body).includes(people[p].id)]).toEqual([p, false]);
      // the machine realm KEEPS tenantId (an FPO is an organisation, and a machine caller has no public-name resolver — the 0228 ruling)
      expect(loans.body.data[0]).toHaveProperty('tenantId');
      const reps = await request(http).get(`/v1/partner-api/lending/loans/${loan.la1}/repayments`).set(auth);
      expect([reps.status, reps.status === 200 ? null : reps.body]).toEqual([200, null]);
      expect(reps.body.data).toHaveLength(3);
      expect(deepKeys(reps.body).filter((k) => /^channel$/.test(k))).toEqual([]);
      expect(JSON.stringify(reps.body)).not.toContain('milk_bill_deduction');
      // and the machine realm is still not an existence oracle: another lender's loan is an empty page, never a 404
      const foreign = await request(http).get(`/v1/partner-api/lending/loans/${loan.lb1}/repayments`).set(auth);
      expect([foreign.status, foreign.body.data]).toEqual([200, []]);
    } finally { await setFlag('partner_api', false); }
  }, 180_000);
});
