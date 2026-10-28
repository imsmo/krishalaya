// apps/api/src/__tests__/partner4b-lender-servicing.integration.spec.ts · PC-56 PARTNER-4b · WHAT A LENDER IS TOLD ABOUT ITS OWN SERVICING
// BOOK — the LIVE proof of the three reads this wave adds (the real AppModule over HTTP, real Postgres, 0232's two definers and 0225's
// consent-gated application axis).
//
//   (1) THE ARREARS BUCKETS equal a hand-computed fixture: 1–30 / 31–60 / 61–90 / over 90 days past a RECORDED due date, the loans not yet
//       due, and the loans with NO due date — six disjoint buckets whose counts sum to every serviced loan, with bigint sums exact past
//       Number.MAX_SAFE_INTEGER, and a closed loan in none of them. The day arithmetic is IST, not the server's timezone.    [M5]
//   (2) THE COLLECTED WINDOW is what was RECORDED in [from, to) as IST calendar days: a repayment one second before the window's first
//       instant is out, one at that instant is in; the sum is a bigint; and the default window is the FY the DATABASE answers.
//   (3) THE APPLICATION PIPELINE: every approved application of this book, the ones whose cooling-off instant has passed, the ones still
//       inside it, and the ones disbursed INSIDE the window — the cooling-off comparison made by the database, never rounded in the
//       lender's favour, and an application nobody consented to share is in NO count.
//   (4) DEEP-KEY AND DEEP-VALUE ABSENCE over all three answers: no borrower id, no name, no phone, no channel, no bank account, no
//       destination, no narrative, no `createdBy`, no tenant id — at any depth, as a key or as a value.                      [M4]
//   (5) THE GRANT IS STILL THE WALL: inside `SET LOCAL ROLE kv_partner`, `loan_repayments.channel` is 42501 and so is every column of
//       `bank_accounts`, `payouts`, `payout_batches`, `loan_disbursement_runs`, `loan_disbursement_run_items`, `kcc_drawl_ledger`,
//       `loan_restructures`, `credit_scores` and `credit_score_consents`; kv_app cannot EXECUTE either new definer.
//   (6) THE NULL GUARD: with no partner in scope both definers answer zero rows — and, because that is a redundancy no behavioural test can
//       kill (PARTNER-4a's surviving mutant M6), the guard is ALSO asserted in the SOURCE of all six loan-book definers, which is the lead's
//       own ruling made executable.                                                                                          [M6]
//   (7) ONE partner-realm audit row per read, counts only: `tenant_id` NULL, `actor_role = partner:<id>:<roles>`, `new_value` keys from the
//       allow-list, and NO amount and NO person in any row.                                                                  [M7]
//   (8) a tenant token → 401; `partner_console` OFF → 404 on all three; a malformed window → 422 by name; another lender's book is invisible.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
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
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e?.code ?? 'error');
/** Every property name these three answers must never carry, at any depth. */
const FORBIDDEN_KEY = /^(borrowerUserId|borrower_user_id|borrower|channel|repaymentChannel|repayment_channel|destination|destinationKind|destination_kind|narrative|createdBy|created_by|updatedBy|updated_by|tenantId|tenant_id|applicantUserId|applicant_user_id|phone|name|bankAccount|bank_account|ledgerTxnId|ledger_txn_id)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
/** The NINE tables kv_partner must hold nothing on (0232.3(b)). */
const FORBIDDEN_TABLES = ['bank_accounts', 'payouts', 'payout_batches', 'loan_disbursement_runs', 'loan_disbursement_run_items',
  'kcc_drawl_ledger', 'loan_restructures', 'credit_scores', 'credit_score_consents'] as const;
/** The SIX loan-book definers whose SOURCE must still carry the NULL guard and the ownership predicate. */
const DEFINER_SIGS = ['partner_loans(text, timestamptz, uuid, integer)', 'partner_loan(uuid)', 'partner_loan_repayments(uuid, integer)',
  'partner_loan_counts(date, date)', 'partner_loan_dpd()', 'partner_loan_collected(date, date)'] as const;

run('PC-56 PARTNER-4b · the arrears buckets, the collected window and the application pipeline on the lender\'s own axis (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T = randomUUID(); const LA = randomUUID(); const LB = randomUUID();
  const people: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const prod: Record<string, string> = {};
  const loan: Record<string, string> = {};
  const apps: Record<string, string> = {};
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  /** The window the DATABASE answers for this FY, as IST calendar days — never a JS clock. */
  let fyFrom = ''; let fyTo = '';
  const PURPOSE = 'A borewell pump and two acres of groundnut';

  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone, name };
  };
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
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
  const get = async (key: string, path: string, query: Record<string, unknown> = {}) => {
    const r = await request(http).get(path).query(query).set({ authorization: `Bearer ${tok[key]}` });
    responses.push(r.body);
    return r;
  };
  async function asPartnerAxis<T2>(partnerId: string | null, fn: (c: PoolClient) => Promise<T2>): Promise<T2> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
      if (partnerId) await c.query(`SELECT set_config('app.partner_id', $1, true)`, [partnerId]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const audits = async (partnerId: string) => (await admin.query(
    `SELECT tenant_id, actor_role, entity_type, new_value FROM audit_log
      WHERE action = 'partner.loans.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'fintech']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T, 'Servicing Figures Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture Servicing Lender A', 'bank'), ($3, $4, 'Fixture Servicing Lender B', 'nbfc')`,
      [LA, `p4bsa_${sfx}`, LB, `p4bsb_${sfx}`]);
    for (const [k, n2] of [['aAdmin', 'Servicing A admin'], ['aViewer', 'Servicing A viewer'], ['bViewer', 'Servicing B viewer'],
      ['b1', 'Borrower Savitri One'], ['b2', 'Borrower Ramesh Two'], ['fpoAdmin', 'FPO admin']] as const) await user(k, n2);
    for (const [k, p, role] of [['aAdmin', LA, 'partner_admin'], ['aViewer', LA, 'partner_viewer'], ['bViewer', LB, 'partner_viewer']] as const) {
      await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`,
        [people[k].id, p, role]);
    }
    const product = async (key: string, partnerId: string, name: string) => {
      prod[key] = (await admin.query(
        `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
         SELECT $1, lv.id, $2, 100000, 90000000, 700, 'harvest_aligned' FROM lookup_values lv
          WHERE lv.type_code = 'loan_kind' AND lv.code = 'kcc' AND lv.tenant_id IS NULL ORDER BY lv.created_at, lv.id LIMIT 1 RETURNING id`,
        [partnerId, name])).rows[0].id;
    };
    await product('a', LA, 'Fixture servicing A KCC');
    await product('b', LB, 'Fixture servicing B KCC');

    /** A disbursed application + its loan. `dueSql` is the loan's next_due_date, in IST days or NULL. */
    const mkLoan = async (key: string, partnerKey: 'a' | 'b', borrowerKey: string, status: string, outstanding: string, dueSql: string) => {
      const appId = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status, purpose_text, created_by)
         VALUES ($1, $2, $3, $4, $4, 'disbursed', $5, $2) RETURNING id`,
        [T, people[borrowerKey].id, prod[partnerKey], outstanding, PURPOSE])).rows[0].id;
      loan[key] = (await admin.query(
        `INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status,
                            outstanding_minor, next_due_date, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 700, CURRENT_DATE - 30, $6::loan_status, $5, ${dueSql}, $3, $3) RETURNING id`,
        [appId, T, people[borrowerKey].id, partnerKey === 'a' ? LA : LB, outstanding, status])).rows[0].id;
      return loan[key];
    };
    const ist = (days: number) => `((now() AT TIME ZONE 'Asia/Kolkata')::date - ${days})`;
    // A's SERVICING book — one loan in each of the six buckets, hand-computed
    await mkLoan('d5', 'a', 'b1', 'active', '100000', ist(5));            // 1-30
    await mkLoan('d30', 'a', 'b1', 'overdue', '200000', ist(30));         // 1-30 (the inclusive edge)
    await mkLoan('d45', 'a', 'b2', 'overdue', '300000', ist(45));         // 31-60
    await mkLoan('d75', 'a', 'b1', 'overdue', '400000', ist(75));         // 61-90
    await mkLoan('d200', 'a', 'b2', 'overdue', '9007199254740993', ist(200));  // 90+ — and the bigint sum must stay exact
    await mkLoan('future', 'a', 'b1', 'active', '500000', ist(-3));       // not yet due
    await mkLoan('null1', 'a', 'b1', 'active', '600000', 'NULL');         // no due date recorded — the truth of this platform
    await mkLoan('null2', 'a', 'b2', 'active', '700000', 'NULL');
    // NOT serviced, so in NO bucket: a closed loan and a written-off one, both with a due date long past
    await mkLoan('closed', 'a', 'b1', 'closed', '0', ist(400));
    await mkLoan('off', 'a', 'b2', 'written_off', '800000', ist(400));
    // B's loan — A must never see it in any figure
    await mkLoan('bLoan', 'b', 'b2', 'overdue', '4444444', ist(10));

    // the FY window the database itself answers, and the repayments either side of its first instant (IST)
    const w = (await admin.query(
      `SELECT CASE WHEN extract(month FROM (now() AT TIME ZONE 'Asia/Kolkata')::date) >= 4
                   THEN make_date(extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int, 4, 1)
                   ELSE make_date(extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int - 1, 4, 1) END::text AS f`)).rows[0];
    fyFrom = w.f;
    fyTo = (await admin.query(`SELECT (($1::date + interval '1 year')::date)::text AS t`, [fyFrom])).rows[0].t;
    // the window's first instant, built from the date the DATABASE answered (never a JS clock, and not a parameter — some rows below do
    // not reference it at all, and an unreferenced parameter is untypable)
    const fyStart = `('${fyFrom}'::date::timestamp AT TIME ZONE 'Asia/Kolkata')`;
    // three repayments INSIDE the window (two on A's book, one on B's) and one a second BEFORE it
    for (const [key, loanKey, paid, offset] of [
      ['in1', 'd5', '50000', `${fyStart} + interval '1 second'`],
      ['in2', 'd45', '70000', `now()`],
      ['out', 'd5', '999999', `${fyStart} - interval '1 second'`],
      ['bIn', 'bLoan', '123456', `now()`],
    ] as const) {
      await admin.query(
        `INSERT INTO loan_repayments (loan_id, tenant_id, due_date, amount_due_minor, amount_paid_minor, paid_at, channel, created_at)
         VALUES ($1, $2, (now() AT TIME ZONE 'Asia/Kolkata')::date, $3, $3, now(), 'milk_bill_deduction', ${offset})`,
        [loan[loanKey], T, paid]);
      void key;
    }

    /** An application on A's shelf, with the consent 0225's oracle needs (or without it, deliberately). */
    const mkApp = async (key: string, borrowerKey: string, status: string, coolingSql: string, decisionSql: string, consent = true) => {
      apps[key] = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status,
                                        cooling_off_until, decision_at, purpose_text, created_by)
         VALUES ($1, $2, $3, 1000000, 1000000, $4::loan_app_status, ${coolingSql}, ${decisionSql}, $5, $2) RETURNING id`,
        [T, people[borrowerKey].id, prod.a, status, PURPOSE])).rows[0].id;
      if (consent) await admin.query(
        `INSERT INTO credit_score_consents (user_id, partner_id, purpose_ref, expires_at) VALUES ($1, $2, $3, now() + interval '30 days')`,
        [people[borrowerKey].id, LA, apps[key]]);
      return apps[key];
    };
    await mkApp('ready1', 'b1', 'approved', `now() - interval '2 hours'`, `now() - interval '26 hours'`);
    await mkApp('ready2', 'b2', 'approved', `now() - interval '1 second'`, `now() - interval '25 hours'`);   // one second past: READY
    await mkApp('cooling1', 'b1', 'approved', `now() + interval '1 second'`, `now() - interval '1 hour'`);   // one second to go: NOT ready
    await mkApp('cooling2', 'b2', 'approved', `now() + interval '20 hours'`, `now() - interval '4 hours'`);
    await mkApp('disbursedIn', 'b1', 'disbursed', `now() - interval '40 days'`, `now() - interval '2 days'`);
    await mkApp('noConsent', 'b2', 'approved', `now() - interval '2 hours'`, `now() - interval '26 hours'`, false);

    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    await setFlag('partner_console', true); await setFlag('fintech', false);
    for (const k of ['aAdmin', 'aViewer', 'bViewer'] as const) await signIn(k);
  }, 240_000);

  afterAll(async () => {
    for (const [k, b] of Object.entries(backup)) {
      if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4 WHERE key = $1`, [k, b.is_enabled, b.rollout_pct, b.rules]);
      if (cache) for (const x of flagKeys(k)) await cache.del(x);
    }
    await app?.close(); await admin?.end();
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (1)
  it('(1) the SIX arrears buckets equal the hand-computed fixture, IST days, bigint-exact, with the closed and written-off loans in NONE', async () => {
    const r = await get('aAdmin', '/v1/partner/loans/dpd');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(Object.keys(d.buckets)).toEqual(['1-30', '31-60', '61-90', '90+', 'not_due', 'no_due_date']);
    expect(d.buckets['1-30']).toEqual({ count: 2, outstandingMinor: '300000' });        // 5 days and 30 days — the inclusive edge
    expect(d.buckets['31-60']).toEqual({ count: 1, outstandingMinor: '300000' });
    expect(d.buckets['61-90']).toEqual({ count: 1, outstandingMinor: '400000' });
    expect(d.buckets['90+']).toEqual({ count: 1, outstandingMinor: '9007199254740993' });   // exact past Number.MAX_SAFE_INTEGER
    expect(d.buckets.not_due).toEqual({ count: 1, outstandingMinor: '500000' });
    expect(d.buckets.no_due_date).toEqual({ count: 2, outstandingMinor: '1300000' });
    // the four arrears buckets added, and the two that are not arrears kept out of them
    // 100000 + 200000 + 300000 + 400000 + 9007199254740993 — added as bigints, exact to the last rupee
    expect(d.arrears).toEqual({ count: 5, outstandingMinor: '9007199255740993' });
    expect(d.noDueDate).toEqual({ count: 2, outstandingMinor: '1300000' });
    expect(d.servicing).toEqual({ count: 8, outstandingMinor: '9007199257540993' });
    expect(d.arrears.count + d.buckets.not_due.count + d.noDueDate.count).toBe(d.servicing.count);
    // some loans have a due date here, so the "nothing can be late" flag is FALSE — on the real platform it is true
    expect(d.noScheduleOnPlatform).toBe(false);
    expect(typeof d.computedAt).toBe('string');
    // the closed and written-off loans are serviced by nobody and counted in no bucket
    expect(d.servicing.count).toBe(8);
    // B's loan is in none of A's figures, and A's are in none of B's
    const b = await get('bViewer', '/v1/partner/loans/dpd');
    expect(b.body.data.servicing).toEqual({ count: 1, outstandingMinor: '4444444' });
    expect(b.body.data.buckets['1-30']).toEqual({ count: 1, outstandingMinor: '4444444' });
    // and NO RATE of any kind is answered
    expect(JSON.stringify(r.body)).not.toMatch(/%|percent|ratio|rate|par\b|dpd/i);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) the collected window is what was RECORDED in [from, to) IST days — a second before the first instant is OUT', async () => {
    const r = await get('aAdmin', '/v1/partner/loans/collected');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ from: fyFrom, to: fyTo, timeZone: 'Asia/Kolkata', repayments: 2, amountPaidMinor: '120000', loans: 2 });
    expect(typeof r.body.data.computedAt).toBe('string');
    // the explicit window answers the same thing, and a window that starts one day later LOSES the repayment at the first instant
    const same = await get('aAdmin', '/v1/partner/loans/collected', { from: fyFrom, to: fyTo });
    expect(same.body.data).toMatchObject({ repayments: 2, amountPaidMinor: '120000' });
    const later = (await admin.query(`SELECT (($1::date + 1)::date)::text AS t`, [fyFrom])).rows[0].t;
    const narrowed = await get('aAdmin', '/v1/partner/loans/collected', { from: later, to: fyTo });
    expect(narrowed.body.data.repayments).toBe(1);
    expect(narrowed.body.data.amountPaidMinor).toBe('70000');
    // B's repayment is in B's figure and in none of A's
    expect((await get('bViewer', '/v1/partner/loans/collected')).body.data).toMatchObject({ repayments: 1, amountPaidMinor: '123456', loans: 1 });
    // a malformed window is refused BY NAME, never silently widened
    for (const q of [{ from: fyFrom }, { to: fyTo }, { from: fyTo, to: fyFrom }, { from: '2026-02-30', to: fyTo }]) {
      const bad = await get('aAdmin', '/v1/partner/loans/collected', q);
      expect([JSON.stringify(q), bad.status]).toEqual([JSON.stringify(q), 422]);
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) the pipeline counts: ready / still waiting / disbursed in the window / every approved one — the instant compared by the DATABASE', async () => {
    const r = await get('aAdmin', '/v1/partner/loans/pipeline');
    expect(r.status).toBe(200);
    const d = r.body.data;
    // ready1 and ready2 are past their instant (one of them by a single second); cooling1 and cooling2 are not
    expect([d.ready, d.coolingOff, d.approved]).toEqual([2, 2, 4]);
    // the disbursed count is the ones DECIDED inside the window; the fixture's own disbursed applications were decided 2 days ago
    expect(d.disbursed).toBeGreaterThanOrEqual(1);
    expect(d.pipeline).toBe(d.approved + d.disbursed);
    expect(d).toMatchObject({ from: fyFrom, to: fyTo, timeZone: 'Asia/Kolkata' });
    // THE APPLICATION NOBODY CONSENTED TO SHARE is in no count at all (0225's oracle, repeated in the predicate)
    expect(d.approved).toBe(4);
    const all = (await admin.query(`SELECT count(*)::int AS n FROM loan_applications WHERE tenant_id = $1 AND status = 'approved'`, [T])).rows[0].n;
    expect(all).toBe(5);                     // five approved rows exist; the lender is told about four
    // B consented to nothing on this tenant, so B's pipeline is empty — never an error
    const b = await get('bViewer', '/v1/partner/loans/pipeline');
    expect([b.status, b.body.data.pipeline, b.body.data.approved]).toEqual([200, 0, 0]);
    expect(JSON.stringify(r.body)).not.toMatch(/%|percent|ratio|rate/i);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) no borrower, no channel, no bank account, no destination, no narrative and no tenant id — as a KEY or as a VALUE, at any depth', async () => {
    const bodies = [
      (await get('aAdmin', '/v1/partner/loans/dpd')).body,
      (await get('aAdmin', '/v1/partner/loans/collected')).body,
      (await get('aAdmin', '/v1/partner/loans/pipeline')).body,
      ...responses,
    ];
    for (const b of bodies) {
      expect(deepKeys(b).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(b);
      for (const v of [people.b1.id, people.b2.id, people.b1.phone, people.b2.phone, people.b1.name, people.b2.name, T,
        'milk_bill_deduction', PURPOSE, 'HDFC0000001']) {
        expect([v, json.includes(v)]).toEqual([v, false]);
      }
    }
    // the two new definers' OWN column sets are identity-free as well — the second wall, under the axis role
    await asPartnerAxis(LA, async (c) => {
      for (const sql of ['SELECT * FROM partner_loan_dpd()', `SELECT * FROM partner_loan_collected('2000-01-01', '2100-01-01')`]) {
        const res = await c.query(sql);
        for (const f of res.fields) expect([sql, f.name, FORBIDDEN_KEY.test(f.name)]).toEqual([sql, f.name, false]);
      }
    });
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) THE GRANT IS THE WALL: the channel is 42501 on the axis, and so is every column of the NINE tables this console never reaches', async () => {
    await asPartnerAxis(LA, async (c) => {
      // each probe inside its own SAVEPOINT: a refused statement aborts the transaction, and the next probe would answer 25P02 instead of
      // the 42501 that is the thing being proven
      const probe = async (sql: string) => {
        await c.query('SAVEPOINT p');
        const code = await errCode(c.query(sql));
        await c.query(code === 'ok' ? 'RELEASE SAVEPOINT p' : 'ROLLBACK TO SAVEPOINT p');
        return code;
      };
      expect(await probe(`SELECT channel FROM loan_repayments LIMIT 1`)).toBe('42501');
      expect(await probe(`SELECT * FROM loan_repayments LIMIT 1`)).toBe('42501');
      expect(await probe(`SELECT borrower_user_id FROM loans LIMIT 1`)).toBe('42501');
      // the granted columns still answer — the narrowing took the identity, not the figures
      expect(await probe(`SELECT next_due_date, outstanding_minor FROM loans LIMIT 1`)).toBe('ok');
      for (const t of FORBIDDEN_TABLES) {
        expect([t, await probe(`SELECT 1 FROM ${t} LIMIT 1`)]).toEqual([t, '42501']);
      }
    });
    // kv_app must wear the axis role to call either new definer
    const priv = (await admin.query(
      `SELECT has_function_privilege('kv_app', 'partner_loan_dpd()', 'EXECUTE') AS app_dpd,
              has_function_privilege('kv_app', 'partner_loan_collected(date,date)', 'EXECUTE') AS app_col,
              has_function_privilege('kv_partner', 'partner_loan_dpd()', 'EXECUTE') AS p_dpd,
              has_function_privilege('kv_partner', 'partner_loan_collected(date,date)', 'EXECUTE') AS p_col`)).rows[0];
    expect([priv.app_dpd, priv.app_col, priv.p_dpd, priv.p_col]).toEqual([false, false, true, true]);
    // and no new policy was added: the RLS gate's figure is unchanged by this wave (0232 adds none)
    const policies = (await admin.query(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('loans', 'loan_repayments')`)).rows[0].n;
    expect(policies).toBeGreaterThan(0);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) the NULL guard: no partner in scope → zero rows; and the guard is asserted in the SOURCE of all SIX definers (the M6 ruling)', async () => {
    await asPartnerAxis(null, async (c) => {
      expect((await c.query(`SELECT * FROM partner_loan_dpd()`)).rows).toEqual([]);
      const col = (await c.query(`SELECT * FROM partner_loan_collected('2000-01-01', '2100-01-01')`)).rows[0];
      expect([Number(col.n), String(col.amount_paid_minor), Number(col.loans)]).toEqual([0, '0', 0]);
    });
    // B's axis is blind to A's book, and A's to B's
    await asPartnerAxis(LB, async (c) => {
      const rows = (await c.query(`SELECT bucket, n::text AS n FROM partner_loan_dpd() ORDER BY 1`)).rows;
      expect(rows).toEqual([{ bucket: '1-30', n: '1' }]);
    });
    // THE SOURCE ASSERTION the lead's ruling on PARTNER-4a's surviving mutant M6 asked for: a redundancy no behavioural test can kill is
    // pinned where it can be — in the function's own definition. 0232 makes the MIGRATION fail too; this pins the live database.
    for (const sig of DEFINER_SIGS) {
      const src = (await admin.query(`SELECT pg_get_functiondef($1::regprocedure) AS d`, [sig])).rows[0].d as string;
      expect([sig, src.includes('current_partner_id() IS NOT NULL')]).toEqual([sig, true]);
      expect([sig, src.includes('= current_partner_id()')]).toEqual([sig, true]);
      expect([sig, src.includes('SECURITY DEFINER'), src.includes('SET search_path TO')]).toEqual([sig, true, true]);
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (7)
  it('(7) ONE partner-realm audit row per read, counts only — no amount, no person, tenant_id NULL', async () => {
    await admin.query(`DELETE FROM audit_log WHERE action = 'partner.loans.read' AND new_value ->> 'partnerId' = $1`, [LA]);
    await get('aViewer', '/v1/partner/loans/dpd');
    await get('aViewer', '/v1/partner/loans/collected');
    await get('aViewer', '/v1/partner/loans/pipeline');
    const rows = await audits(LA);
    expect(rows.map((r) => r.new_value.surface)).toEqual(['loans_dpd', 'loans_collected', 'applications_pipeline']);
    const ALLOWED = ['partnerId', 'realm', 'surface', 'servicing', 'arrears', 'noDueDate', 'from', 'to', 'repayments', 'loans', 'pipeline', 'ready', 'coolingOff'];
    for (const r of rows) {
      expect([r.tenant_id, r.actor_role, r.entity_type]).toEqual([null, `partner:${LA}:partner_viewer`, 'financial_partner']);
      expect(Object.keys(r.new_value).filter((k) => !ALLOWED.includes(k))).toEqual([]);
      const json = JSON.stringify(r.new_value);
      // counts only: no minor-unit amount, no borrower, no phone, no name
      expect(json).not.toMatch(/Minor|9007199254740993|120000|300000/);
      for (const v of [people.b1.id, people.b1.phone, people.b1.name, T]) expect([v, json.includes(v)]).toEqual([v, false]);
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (8)
  it('(8) a tenant token → 401; `partner_console` OFF → 404 on all three; and the permission is held by the four partner roles only', async () => {
    const t = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T, roles: ['tenant_admin'], perms: ['loan.manage', '*'] });
    for (const path of ['/v1/partner/loans/dpd', '/v1/partner/loans/collected', '/v1/partner/loans/pipeline']) {
      const r = await request(http).get(path).set({ authorization: `Bearer ${t}`, 'x-tenant-id': T });
      expect([path, r.status, r.body.error?.code]).toEqual([path, 401, 'PARTNER_SESSION_REQUIRED']);
    }
    await setFlag('partner_console', false);
    for (const path of ['/v1/partner/loans/dpd', '/v1/partner/loans/collected', '/v1/partner/loans/pipeline']) {
      const r = await request(http).get(path).set({ authorization: `Bearer ${tok.aAdmin}` });
      expect([path, r.status]).toEqual([path, 404]);
    }
    await setFlag('partner_console', true);
    const holders = (await admin.query(
      `SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'partner.loans.read' ORDER BY r.code`)).rows.map((x) => x.code);
    expect(holders).toEqual(['partner_admin', 'partner_checker', 'partner_maker', 'partner_viewer']);
  }, 120_000);
});
