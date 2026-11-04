// apps/api/src/__tests__/partner5a-arrears-book.integration.spec.ts · PC-56 PARTNER-5a · THE BOOK IN ARREARS, AS COUNTS — the LIVE proof
// (the real AppModule over HTTP, real Postgres + RLS) that the two lender pages this wave adds (W223 DPD aging, W222 write-offs) read
// ONLY what 4a/4b already shipped — `GET /v1/partner/loans/dpd` (0232 `partner_loan_dpd()`), `GET /v1/partner/loans/counts` (0231
// `partner_loan_counts()`) and `GET /v1/partner/loans?status=written_off` (0231 `partner_loans()`) — and that nothing a lender could use to
// collect on a borrower is reachable from the partner realm (founder 5a-5 / 5a-9). This wave adds NO route, NO definer and NO migration.
//
// Fixture (the 4a path): lender A with its admin and viewer, rival lender B, an INSURER, two cooperatives; A's loans in every printable
// status — two `restructured` and two-plus `written_off` written by FIXTURE SQL (the API can no longer write either: founder 5a-1 / 5a-3),
// one `transferred`; `next_due_date` set by fixture SQL on THREE servicing loans (5 days past, 45 days past, in the future — IST days) and
// NULL on every other loan. A borrower with a distinct odd name, a restructure row with a distinct case reference, and a distinct
// write-off "reason" stored where a careless read could reach it (the application's decision note AND purpose text).
//
//   (1) dpd → exactly the six bucket keys; the three dated loans in `1-30`, `31-60`, `not_due`; the other servicing loans in `no_due_date`;
//       NO restructured loan in any bucket and none in the servicing total (TODAY's truth: 0232 buckets `status IN ('active','overdue')`).
//       *** P5-B0 (the real activation, `restructured` as a repayable servicing state) MUST UPDATE THIS CASE when it lands. ***
//   (2) counts + loans?status=written_off → A's written-off count and outstanding over the loans OPENED in the IST FY window (a written-off
//       loan opened one second BEFORE 00:00 IST 1 Apr is in the LIST but not the COUNT; one opened AT that instant is in both); B's absent;
//       the insurer's book is empty (200, zero) — not an error; the viewer reads the same figures.
//   (3) deep-key AND deep-value absence over every response of those three routes: no borrowerUserId / borrower_user_id / channel / reason /
//       writeOffReason / cause / writtenOffBy / caseRef / case_ref / proposedBy / checkerId / phone / name / tenantId at any depth; and the
//       borrower's odd name, the case reference and the reason string in no body.
//   (4) inside `SET LOCAL ROLE kv_partner`: SELECT 1 FROM each of the NINE tables of 0232:189-190 → 42501; `loans.borrower_user_id` and
//       `loan_repayments.channel` → 42501; pg_proc holds no restructure / write-off / collections-case definer (see the pattern note).  [M1]
//   (5) after deleting A's audit rows: one dpd + one counts + one list read → EXACTLY three partner-realm audit rows (loans_dpd,
//       loans_counts, loans), counts only — no minor-unit amount, no person.                                                        [M6]
//   (6) absence → 404: collections (GET/POST, :id), loan restructures (GET, POST), write-off (POST), writeoffs, reports, PATCH/PUT/DELETE on
//       a loan — and nothing moved (every fixture status unchanged).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e?.code ?? 'error');
/** Every property name the two pages' three answers must never carry, at any depth (brief §C case 3). */
const FORBIDDEN_KEY = /^(borrowerUserId|borrower_user_id|channel|reason|writeOffReason|write_off_reason|cause|writtenOffBy|written_off_by|caseRef|case_ref|proposedBy|proposed_by|checkerId|checker_id|phone|name|tenantId|tenant_id)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
/** The NINE tables kv_partner must hold nothing on (0232:189-190; founder 5a-9). */
const FORBIDDEN_TABLES = ['bank_accounts', 'payouts', 'payout_batches', 'loan_disbursement_runs', 'loan_disbursement_run_items',
  'kcc_drawl_ledger', 'loan_restructures', 'credit_scores', 'credit_score_consents'] as const;
/** The distinct strings a careless read could leak. */
const ODD_NAME = 'Borrower Quillon Vashti';
const CASE_REF = 'CASEREF-ZQX-551';
const REASON = 'WRITEOFF-REASON-ZQX herd lost to the flood, family approached';

run('PC-56 PARTNER-5a · the book in arrears, as counts — dpd, counts and the written-off list on the lender\'s own axis (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T1 = randomUUID(); const T2 = randomUUID();
  const LA = randomUUID(); const LB = randomUUID(); const INS = randomUUID();
  const people: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const prod: Record<string, string> = {};
  const loan: Record<string, string> = {};
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  let fy = 0;

  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone, name };
  };
  const membership = (userKey: string, partnerId: string, role: string) => admin.query(
    `INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`,
    [people[userKey].id, partnerId, role]);
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
  const bearer = (key: string) => ({ authorization: `Bearer ${tok[key]}` });
  const get = async (key: string, path: string, query: Record<string, unknown> = {}) => {
    const r = await request(http).get(path).query(query).set(bearer(key));
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
  const statuses = async () => Object.fromEntries((await admin.query(
    `SELECT id, status::text AS s FROM loans WHERE id = ANY($1::uuid[])`, [Object.values(loan)])).rows.map((r) => [r.id, r.s]));

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'fintech']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T1, 'Arrears Book Growers Collective'); await makeTenant(admin, T2, 'Arrears Book Dairy Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES
      ($1, $2, 'Fixture Arrears Lender A', 'bank'), ($3, $4, 'Fixture Arrears Lender B', 'nbfc'), ($5, $6, 'Fixture Arrears Insurer K', 'insurer')`,
      [LA, `p5aa_${sfx}`, LB, `p5ab_${sfx}`, INS, `p5ai_${sfx}`]);
    for (const [k, n] of [['aAdmin', 'Arrears A admin'], ['aViewer', 'Arrears A viewer'], ['bViewer', 'Arrears B viewer'],
      ['iViewer', 'Arrears insurer viewer'], ['b1', ODD_NAME], ['b2', 'Borrower Ramesh Two'], ['desk', 'Arrears desk officer']] as const) await user(k, n);
    await membership('aAdmin', LA, 'partner_admin'); await membership('aViewer', LA, 'partner_viewer');
    await membership('bViewer', LB, 'partner_viewer'); await membership('iViewer', INS, 'partner_viewer');

    const kcc = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'kcc' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    for (const [key, partnerId, name] of [['a', LA, 'Fixture arrears A KCC'], ['b', LB, 'Fixture arrears B KCC']] as const) {
      prod[key] = (await admin.query(
        `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
         VALUES ($1, $2, $3, 100000, 90000000, 700, 'harvest_aligned') RETURNING id`, [partnerId, kcc, name])).rows[0].id;
    }

    // the FY the database itself computes, and its first instant — 00:00 IST 1 April
    fy = (await admin.query(`SELECT CASE WHEN extract(month FROM (now() AT TIME ZONE 'Asia/Kolkata')::date) >= 4
      THEN extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int
      ELSE extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata')::date)::int - 1 END AS y`)).rows[0].y as number;
    const fyStart = `make_timestamptz(${fy}, 4, 1, 0, 0, 0, 'Asia/Kolkata')`;
    const ist = (days: number) => `((now() AT TIME ZONE 'Asia/Kolkata')::date - ${days})`;
    const ago = (min: number) => `now() - interval '${min} minutes'`;

    /** A disbursed application + its loan. The application carries the "reason" in BOTH free-text columns a careless read could reach. */
    const mkLoan = async (key: string, tenantId: string, borrowerKey: string, partnerKey: 'a' | 'b', status: string, outstanding: string,
      dueSql: string, createdAtSql: string) => {
      const appId = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status,
                                        purpose_text, decision_note, created_by)
         VALUES ($1, $2, $3, 9000000, 9000000, 'disbursed', $4, $5, $2) RETURNING id`,
        [tenantId, people[borrowerKey].id, prod[partnerKey], REASON, REASON])).rows[0].id;
      loan[key] = (await admin.query(
        `INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status,
                            outstanding_minor, next_due_date, created_by, updated_by, created_at)
         VALUES ($1, $2, $3, $4, 9000000, 700, CURRENT_DATE - 30, $5::loan_status, $6, ${dueSql}, $7, $7, ${createdAtSql}) RETURNING id`,
        [appId, tenantId, people[borrowerKey].id, partnerKey === 'a' ? LA : LB, status, outstanding, people.desk.id])).rows[0].id;
      return loan[key];
    };
    // A's SERVICING book: three dated loans, two undated
    await mkLoan('d5', T1, 'b1', 'a', 'active', '100000', ist(5), ago(100));          // 1-30
    await mkLoan('d45', T2, 'b2', 'a', 'overdue', '300000', ist(45), ago(95));        // 31-60
    await mkLoan('future', T1, 'b1', 'a', 'active', '500000', ist(-10), ago(90));     // not_due
    await mkLoan('n1', T1, 'b1', 'a', 'active', '600000', 'NULL', ago(85));           // no_due_date
    await mkLoan('n2', T2, 'b2', 'a', 'overdue', '700000', 'NULL', ago(80));          // no_due_date
    // TWO `restructured` — written by fixture SQL, because the API can no longer write that state (founder 5a-1)
    await mkLoan('r1', T1, 'b1', 'a', 'restructured', '2500000', 'NULL', ago(75));
    await mkLoan('r2', T2, 'b2', 'a', 'restructured', '1100000', 'NULL', ago(70));
    // `written_off` — fixture SQL too (founder 5a-3): one inside the window, one AT its first instant, one a second BEFORE it
    await mkLoan('w1', T1, 'b1', 'a', 'written_off', '800000', 'NULL', ago(65));
    await mkLoan('wAt', T2, 'b2', 'a', 'written_off', '444000', 'NULL', fyStart);
    await mkLoan('wPre', T1, 'b1', 'a', 'written_off', '333000', 'NULL', `${fyStart} - interval '1 second'`);
    await mkLoan('closed', T1, 'b2', 'a', 'closed', '0', 'NULL', ago(60));
    await mkLoan('transferred', T2, 'b1', 'a', 'transferred', '900000', 'NULL', ago(55));
    // B's book — A must never see it in any figure
    await mkLoan('bOff', T1, 'b2', 'b', 'written_off', '4444444', 'NULL', ago(50));
    await mkLoan('bDue', T2, 'b1', 'b', 'overdue', '5555555', ist(10), ago(45));
    // a restructure row with a distinct case reference a careless read could leak (activated — the state the API can no longer write)
    await admin.query(
      `INSERT INTO loan_restructures (tenant_id, loan_id, case_ref, reason_code, old_instalment_minor, new_instalment_minor, old_tenor_months,
                                      new_tenor_months, rate_apr_bps, total_interest_delta_minor, status, proposed_by, checker_id)
       VALUES ($1, $2, $3, 'weather_distress', 100000, 80000, 12, 18, 700, 5000, 'activated', $4, $5)`,
      [T1, loan.r1, CASE_REF, people.desk.id, people.b2.id]);

    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    await setFlag('partner_console', true); await setFlag('fintech', false);
    for (const k of ['aAdmin', 'aViewer', 'bViewer', 'iViewer']) await signIn(k);
  }, 300_000);

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
  it('(1) dpd → exactly the six buckets; the dated loans in 1-30 / 31-60 / not_due, the rest in no_due_date; NO restructured loan anywhere', async () => {
    const r = await get('aAdmin', '/v1/partner/loans/dpd');
    expect([r.status, r.status === 200 ? null : r.body]).toEqual([200, null]);
    const d = r.body.data;
    expect(Object.keys(d.buckets)).toEqual(['1-30', '31-60', '61-90', '90+', 'not_due', 'no_due_date']);
    expect(d.buckets).toEqual({
      '1-30': { count: 1, outstandingMinor: '100000' },
      '31-60': { count: 1, outstandingMinor: '300000' },
      '61-90': { count: 0, outstandingMinor: '0' },
      '90+': { count: 0, outstandingMinor: '0' },
      not_due: { count: 1, outstandingMinor: '500000' },
      no_due_date: { count: 2, outstandingMinor: '1300000' },           // n1 + n2 — the two undated SERVICING loans, and nothing else
    });
    // TODAY'S TRUTH, PINNED: the servicing total is active + overdue only (0232 `status IN ('active','overdue')`). The two `restructured`
    // loans (2,500,000 + 1,100,000) are in no bucket and not in the total — the page prints their COUNT beside it (founder 5a-6).
    // *** P5-B0 (the real activation, which makes `restructured` a repayable servicing state) MUST UPDATE THIS CASE. ***
    expect(d.servicing).toEqual({ count: 5, outstandingMinor: '2200000' });
    expect(d.arrears).toEqual({ count: 2, outstandingMinor: '400000' });
    expect(d.noDueDate).toEqual({ count: 2, outstandingMinor: '1300000' });
    const bucketSum = Object.values(d.buckets as Record<string, { count: number; outstandingMinor: string }>)
      .reduce((a, b) => ({ count: a.count + b.count, minor: a.minor + BigInt(b.outstandingMinor) }), { count: 0, minor: 0n });
    expect([bucketSum.count, bucketSum.minor.toString()]).toEqual([d.servicing.count, d.servicing.outstandingMinor]);
    for (const [name, b] of Object.entries(d.buckets as Record<string, { outstandingMinor: string }>)) {
      for (const restructuredMinor of ['2500000', '1100000', '3600000']) expect([name, b.outstandingMinor === restructuredMinor]).toEqual([name, false]);
    }
    expect(typeof d.computedAt).toBe('string');
    // and B's overdue dated loan is B's alone
    const b = await get('bViewer', '/v1/partner/loans/dpd');
    expect(b.body.data.servicing).toEqual({ count: 1, outstandingMinor: '5555555' });
    expect(b.body.data.buckets['1-30']).toEqual({ count: 1, outstandingMinor: '5555555' });
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) counts + the written-off list: opened-in-window (the 00:00 IST 1 Apr boundary), B absent, the insurer empty, the viewer reads too', async () => {
    const c = await get('aAdmin', '/v1/partner/loans/counts');
    expect([c.status, c.status === 200 ? null : c.body]).toEqual([200, null]);
    expect(c.body.data).toMatchObject({
      from: `${fy}-04-01`, to: `${fy + 1}-04-01`, timeZone: 'Asia/Kolkata',
      // every A loan but wPre (opened one second before the window): d5 d45 future n1 n2 r1 r2 w1 wAt closed transferred
      total: 11,
      restructured: 2,
      // w1 + wAt — wAt opened AT the first instant is IN; wPre one second before is OUT; B's 4,444,444 is not here
      writtenOff: { count: 2, outstandingMinor: '1244000' },
      servicing: { count: 5, outstandingMinor: '2200000' },
    });
    expect(c.body.data.byStatus).toMatchObject({ written_off: 2, restructured: 2, active: 3, overdue: 2, closed: 1 });
    // the list is NOT windowed: all three of A's written-off loans, newest first — wPre is in the list but not in the count
    const l = await get('aAdmin', '/v1/partner/loans', { status: 'written_off', limit: 100 });
    expect([l.status, l.status === 200 ? null : l.body]).toEqual([200, null]);
    expect(l.body.data.map((x: { id: string }) => x.id)).toEqual([loan.w1, loan.wAt, loan.wPre]);
    expect(l.body.data.map((x: { outstandingMinor: string; status: string }) => [x.status, x.outstandingMinor]))
      .toEqual([['written_off', '800000'], ['written_off', '444000'], ['written_off', '333000']]);
    expect(JSON.stringify(l.body)).not.toContain(loan.bOff);
    // B's figures are B's: its own written-off loan, never A's
    const bc = await get('bViewer', '/v1/partner/loans/counts');
    expect(bc.body.data.writtenOff).toEqual({ count: 1, outstandingMinor: '4444444' });
    const bl = await get('bViewer', '/v1/partner/loans', { status: 'written_off' });
    expect(bl.body.data.map((x: { id: string }) => x.id)).toEqual([loan.bOff]);
    // the INSURER: an empty book is a 200 with zeros — never an error
    const ic = await get('iViewer', '/v1/partner/loans/counts');
    expect([ic.status, ic.body.data?.total, ic.body.data?.writtenOff, ic.body.data?.restructured]).toEqual([200, 0, { count: 0, outstandingMinor: '0' }, 0]);
    const il = await get('iViewer', '/v1/partner/loans', { status: 'written_off' });
    expect([il.status, il.body.data]).toEqual([200, []]);
    const id = await get('iViewer', '/v1/partner/loans/dpd');
    expect([id.status, id.body.data?.servicing]).toEqual([200, { count: 0, outstandingMinor: '0' }]);
    // the VIEWER reads the same three figures
    const vc = await get('aViewer', '/v1/partner/loans/counts');
    expect([vc.status, vc.body.data.writtenOff, vc.body.data.restructured]).toEqual([200, { count: 2, outstandingMinor: '1244000' }, 2]);
    const vl = await get('aViewer', '/v1/partner/loans', { status: 'written_off' });
    expect([vl.status, vl.body.data.map((x: { id: string }) => x.id)]).toEqual([200, [loan.w1, loan.wAt, loan.wPre]]);
    const vd = await get('aViewer', '/v1/partner/loans/dpd');
    expect([vd.status, vd.body.data.servicing.count]).toEqual([200, 5]);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) no borrower, no reason, no cause, no case, no actor and no tenant id — as a KEY or as a VALUE, at any depth', async () => {
    const bodies = [
      (await get('aAdmin', '/v1/partner/loans/dpd')).body,
      (await get('aAdmin', '/v1/partner/loans/counts')).body,
      (await get('aAdmin', '/v1/partner/loans', { status: 'written_off' })).body,
      (await get('aViewer', '/v1/partner/loans', { status: 'restructured' })).body,
      ...responses,
    ];
    expect(bodies.length).toBeGreaterThanOrEqual(15);
    const values = [people.b1.id, people.b2.id, people.desk.id, people.b1.phone, people.b2.phone, ODD_NAME, people.b2.name, people.desk.name,
      CASE_REF, REASON, 'herd lost', T1, T2];
    for (const b of bodies) {
      expect(deepKeys(b).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(b);
      for (const v of values) expect([v, json.includes(v)]).toEqual([v, false]);
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) THE AXIS RULE: the nine tables and the two columns are 42501 under kv_partner, and no restructure / write-off / case definer exists', async () => {
    await asPartnerAxis(LA, async (c) => {
      // each probe inside its own SAVEPOINT — a refused statement aborts the transaction
      const probe = async (sql: string) => {
        await c.query('SAVEPOINT p');
        const code = await errCode(c.query(sql));
        await c.query(code === 'ok' ? 'RELEASE SAVEPOINT p' : 'ROLLBACK TO SAVEPOINT p');
        return code;
      };
      for (const t of FORBIDDEN_TABLES) expect([t, await probe(`SELECT 1 FROM ${t} LIMIT 1`)]).toEqual([t, '42501']);
      expect(await probe(`SELECT borrower_user_id FROM loans LIMIT 1`)).toBe('42501');
      expect(await probe(`SELECT channel FROM loan_repayments LIMIT 1`)).toBe('42501');
      // the granted columns still read — the wall took the identity, not the figures
      expect(await probe(`SELECT next_due_date, outstanding_minor, status FROM loans LIMIT 1`)).toBe('ok');
    });
    // NO DEFINER may read a restructure, record a write-off or open a collections case. PATTERN NOTE: the brief's 'partner_%collect%'
    // matches 0232's `partner_loan_collected` — the 4b collected-window COUNT, which is legitimate and stays. So that pattern is asserted
    // to match EXACTLY that one name (an explicit exclusion list), and the survey's precise 'partner_%collect%case%' must match nothing.
    const names = async (pattern: string) => (await admin.query(
      `SELECT proname FROM pg_proc WHERE proname LIKE $1 ORDER BY proname`, [pattern])).rows.map((r) => r.proname as string);
    expect(await names('partner_%restructur%')).toEqual([]);
    expect(await names('partner_%write%')).toEqual([]);
    expect(await names('partner_%collect%case%')).toEqual([]);
    const ALLOWED_COLLECT = ['partner_loan_collected'];
    expect((await names('partner_%collect%')).filter((n) => !ALLOWED_COLLECT.includes(n))).toEqual([]);
    expect(await names('partner_%collect%')).toEqual(ALLOWED_COLLECT);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (5)
  it('(5) ONE partner-realm audit row per read — dpd, counts, list — counts only, no amount, no person', async () => {
    await admin.query(`DELETE FROM audit_log WHERE action = 'partner.loans.read' AND new_value ->> 'partnerId' = $1`, [LA]);
    expect(await audits(LA)).toEqual([]);
    await get('aViewer', '/v1/partner/loans/dpd');
    await get('aViewer', '/v1/partner/loans/counts');
    await get('aViewer', '/v1/partner/loans', { status: 'written_off' });
    const rows = await audits(LA);
    expect(rows.map((r) => r.new_value.surface)).toEqual(['loans_dpd', 'loans_counts', 'loans']);
    for (const r of rows) {
      expect([r.tenant_id, r.actor_role, r.entity_type]).toEqual([null, `partner:${LA}:partner_viewer`, 'financial_partner']);
      const json = JSON.stringify(r.new_value);
      expect(json).not.toMatch(/Minor/);
      for (const amt of ['2200000', '1244000', '1300000', '800000', '444000', '333000']) expect([amt, json.includes(amt)]).toEqual([amt, false]);
      for (const v of [people.b1.id, people.b2.id, people.desk.id, people.b1.phone, ODD_NAME, CASE_REF, REASON, T1, T2]) {
        expect([v, json.includes(v)]).toEqual([v, false]);
      }
    }
    expect(rows[0].new_value).toMatchObject({ servicing: 5, arrears: 2, noDueDate: 2 });
    expect(rows[1].new_value).toMatchObject({ loans: 11 });
    expect(rows[2].new_value).toMatchObject({ listed: 3, status: 'written_off' });
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (6)
  it('(6) no collections, no restructure, no write-off, no report and no loan edit from this realm — each 404, and nothing moved', async () => {
    const before = await statuses();
    const id = loan.d45;
    const probes: Array<[string, () => request.Test]> = [
      ['GET collections', () => request(http).get('/v1/partner/collections').set(bearer('aAdmin'))],
      ['POST collections', () => request(http).post('/v1/partner/collections').set(bearer('aAdmin')).send({ loanId: id, note: 'a probe' })],
      ['GET collections/:id', () => request(http).get(`/v1/partner/collections/${randomUUID()}`).set(bearer('aAdmin'))],
      ['GET loans/:id/restructures', () => request(http).get(`/v1/partner/loans/${id}/restructures`).set(bearer('aAdmin'))],
      ['POST loans/:id/restructure', () => request(http).post(`/v1/partner/loans/${id}/restructure`).set(bearer('aAdmin')).send({ newTenorMonths: 18 })],
      ['POST loans/:id/write-off', () => request(http).post(`/v1/partner/loans/${id}/write-off`).set(bearer('aAdmin')).send({ reason: 'a probe reason' })],
      ['GET writeoffs', () => request(http).get('/v1/partner/writeoffs').set(bearer('aAdmin'))],
      ['GET reports', () => request(http).get('/v1/partner/reports').set(bearer('aAdmin'))],
      ['PATCH loans/:id', () => request(http).patch(`/v1/partner/loans/${id}`).set(bearer('aAdmin')).send({ status: 'written_off' })],
      ['PUT loans/:id', () => request(http).put(`/v1/partner/loans/${id}`).set(bearer('aAdmin')).send({ status: 'restructured' })],
      ['DELETE loans/:id', () => request(http).delete(`/v1/partner/loans/${id}`).set(bearer('aAdmin'))],
    ];
    for (const [name, fire] of probes) expect([name, (await fire()).status]).toEqual([name, 404]);
    expect(await statuses()).toEqual(before);
    expect(before[loan.d45]).toBe('overdue');
    expect((await admin.query(`SELECT status, case_ref FROM loan_restructures WHERE loan_id = $1`, [loan.r1])).rows).toEqual([{ status: 'activated', case_ref: CASE_REF }]);
    expect((await admin.query(`SELECT count(*)::int AS n FROM loan_restructures WHERE tenant_id = ANY($1::uuid[])`, [[T1, T2]])).rows[0].n).toBe(1);
  }, 120_000);
});
