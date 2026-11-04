// apps/api/src/__tests__/partner5b-collections-absent.integration.spec.ts · PC-56 PARTNER-5b · COLLECTIONS THE PLATFORM DOES NOT DO — the
// LIVE proof (the real AppModule over HTTP, real Postgres + RLS) behind the three honest lender pages W219 / W220 / W221, which READ NOTHING
// (founder 5b-1 … 5b-4, doors Q4 + Q5). This wave adds NO route, NO definer, NO grant and NO migration; this spec is its only `apps/api`
// file (the 4c precedent). It proves that what the pages say is true of the platform underneath them:
//
//   (1) `partner_console` ON + `fintech` ON; a restructure PROPOSED and moved to `mediation` on the TENANT plane through the real routes with
//       Idempotency-Keys (`accepted` is refused since PARTNER-5a and is not attempted here). Then across EVERY partner loan response — list,
//       get, counts, dpd, collected, the loan's repayments — nothing of it is readable: deep-value absence of the restructure's id, its case
//       reference, its proposer's user id and its typed term values (distinctive numbers), and no restructure-shaped key at any depth; the
//       loan's own page shows its `status` only. Inside `SET LOCAL ROLE kv_partner`, `SELECT 1 FROM loan_restructures` → 42501 — RE-PROVED
//       HERE because 0231/0232's asserts are LOCAL (a later grant passes asserts that already ran — the 4c rule; M1 kills here).
//   (2) a PARTNER session's token on every `/v1/fintech/servicing/*` collections / restructure / write-off route and on
//       `POST /v1/fintech/loans/:id/repay` → refused (401/403), nothing written (loan_restructures, ledger_transactions, ledger_entries and
//       loan_repayments counted before/after; the proposal still `mediation`; every loan status unchanged).
//   (3) absence → 404 on the partner realm: every collections / contact / promise / restructure address a lender's console could call, each
//       404 and nothing moved (what 5a (6) did not already pin, plus its three collections addresses again for this wave's own record).
//   (4) `pg_proc` holds no `partner_%collect%` (save 0232's legitimate `partner_loan_collected` count), `partner_%restructur%`,
//       `partner_%contact%` or `partner_%promise%` function; and `kv_app` holds EXECUTE on NO partner_% definer of the lender's book — only on
//       the two PARTNER-0 identity helpers 0225 grants it by name.
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
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e?.code ?? 'error');

/** The proposal's DISTINCTIVE values — none can occur by chance in a partner response. */
const CASE_REF = 'CASEREF-P5B-QWXJ-7731';
const PROPOSAL = {
  caseRef: CASE_REF, reasonCode: 'weather_distress',
  oldInstalmentMinor: '7314159', newInstalmentMinor: '6271828', oldTenorMonths: 347, newTenorMonths: 353,
  rateAprBps: 93517, holidayMonths: 19, holidayStartsOn: '2031-02-17', penalInterestWaived: true, totalInterestDeltaMinor: '4669201',
};
const TERM_STRINGS = ['7314159', '6271828', '4669201', '93517', '2031-02-17', CASE_REF];
const TERM_NUMBERS = [347, 353, 93517];
/** Any restructure-shaped property name, at any depth of any partner response. */
const RESTRUCTURE_KEY = /restructur|caseRef|case_ref|instalment|tenor|holiday|penal|interestDelta|interest_delta|proposedBy|proposed_by|checker|accept|mediation|cooling|otp|comparison|evidence|reasonCode|reason_code|borrower/i;

function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
function deepNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v);
  else if (Array.isArray(v)) for (const x of v) deepNumbers(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v as Record<string, unknown>)) deepNumbers(x, out);
  return out;
}

run('PC-56 PARTNER-5b · collections the platform does not do — nothing of a restructure, a contact or a promise reaches a lender (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T = randomUUID(); const P = randomUUID();
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, string> = {};
  const loan: Record<string, string> = {};
  let restructureId = '';
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};

  const H = (key: string) => ({ authorization: `Bearer ${tok[key]}`, 'x-tenant-id': T });
  const bearer = (key: string) => ({ authorization: `Bearer ${tok[key]}` });
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
  const statuses = async () => Object.fromEntries((await admin.query(
    `SELECT id, status::text AS s FROM loans WHERE id = ANY($1::uuid[])`, [Object.values(loan)])).rows.map((r) => [r.id, r.s]));
  const proposal = async () => (await admin.query(`SELECT status, case_ref FROM loan_restructures WHERE id = $1`, [restructureId])).rows[0];
  const snapshot = async () => ({
    restructures: await n('loan_restructures'), txns: await n('ledger_transactions'), entries: await n('ledger_entries'),
    repayments: await n('loan_repayments'), statuses: await statuses(), proposal: await proposal(),
  });

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['fintech', 'partner_console']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T, 'Collections Absent Collective');
    for (const [k, nm] of [['banker', 'Absent desk banker'], ['borrower', 'Absent borrower Zephyrine Okolo'], ['pAdmin', 'Absent lender admin']] as const) await user(k, nm);
    await tenantRole('banker', 'banker'); await tenantRole('borrower', 'farmer');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture Absent Lender', 'bank')`, [P, `p5b_${sfx}`]);
    await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'partner_admin'`, [people.pAdmin.id, P]);
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'crop' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const productId = (await admin.query(
      `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
       VALUES ($1, $2, 'Fixture absent crop loan', 100000, 50000000, 700, 'harvest_aligned') RETURNING id`, [P, kind])).rows[0].id;
    const mkLoan = async (key: string, status: string, outstanding: string) => {
      const appId = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status)
         VALUES ($1, $2, $3, $4, $4, 'disbursed') RETURNING id`, [T, people.borrower.id, productId, outstanding])).rows[0].id;
      loan[key] = (await admin.query(
        `INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status, outstanding_minor)
         VALUES ($1, $2, $3, $4, $5, 700, CURRENT_DATE - 30, $6::loan_status, $5) RETURNING id`, [appId, T, people.borrower.id, P, outstanding, status])).rows[0].id;
    };
    await mkLoan('r', 'active', '2000000');      // the loan whose restructure the cooperative proposes (1)
    await mkLoan('o', 'overdue', '1200000');     // a second servicing loan — the absence probes and the write-off attempt (2)

    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    tok.banker = mintToken(app, { userId: people.banker.id, tenantId: T, roles: ['banker'], perms: ['loan.manage'] });
    await setFlag('fintech', true); await setFlag('partner_console', true);
    // the lender's console member, signed in through the partner realm's own OTP door
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
    const { code } = await otp.issue(people.pAdmin.phone);
    const v = await request(http).post('/v1/partner/auth/verify').send({ phone: people.pAdmin.phone, code });
    expect(v.status).toBe(201);
    tok.partner = v.body.data.accessToken;
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
  it('(1) a restructure proposed and in mediation on the TENANT plane: nothing of it is readable in ANY partner loan response; kv_partner → 42501', async () => {
    const prop = await request(http).post(`/v1/fintech/servicing/loans/${loan.r}/restructures`).set(H('banker')).set('idempotency-key', K()).send(PROPOSAL);
    expect([prop.status, prop.body?.data?.status]).toEqual([201, 'draft']);
    restructureId = prop.body.data.id;
    const med = await request(http).post(`/v1/fintech/servicing/restructures/${restructureId}/transition`).set(H('banker')).set('idempotency-key', K()).send({ to: 'mediation' });
    expect([med.status, med.body?.data?.status]).toEqual([201, 'mediation']);
    // the row is really there, with the distinctive terms, on the tenant plane
    expect((await admin.query(
      `SELECT status, case_ref, proposed_by, old_instalment_minor::text AS oi, new_tenor_months AS nt, rate_apr_bps AS r FROM loan_restructures WHERE id = $1`, [restructureId])).rows[0])
      .toEqual({ status: 'mediation', case_ref: CASE_REF, proposed_by: people.banker.id, oi: '7314159', nt: 353, r: 93517 });

    // every partner loan read the console makes — the book, each loan, the figures, the repayments
    const reads: Array<[string, string, Record<string, unknown>]> = [
      ['list', '/v1/partner/loans', {}], ['list mediation-agnostic', '/v1/partner/loans', { status: 'active' }],
      ['get r', `/v1/partner/loans/${loan.r}`, {}], ['get o', `/v1/partner/loans/${loan.o}`, {}],
      ['counts', '/v1/partner/loans/counts', {}], ['dpd', '/v1/partner/loans/dpd', {}], ['collected', '/v1/partner/loans/collected', {}],
      ['repayments r', `/v1/partner/loans/${loan.r}/repayments`, {}], ['repayments o', `/v1/partner/loans/${loan.o}/repayments`, {}],
    ];
    const bodies: unknown[] = [];
    for (const [name, path, query] of reads) {
      const r = await request(http).get(path).query(query).set(bearer('partner'));
      expect([name, r.status]).toEqual([name, 200]);
      bodies.push(r.body);
    }
    // the reads saw the book (the fixture is reachable) — so an absence below is a real absence, not an empty answer
    const list = bodies[0] as { data: Array<{ id: string }> };
    expect(list.data.map((i) => i.id).sort()).toEqual([loan.r, loan.o].sort());
    const forbiddenValues = [restructureId, people.banker.id, people.borrower.id, people.borrower.phone, 'Zephyrine', ...TERM_STRINGS, T];
    for (const [i, b] of bodies.entries()) {
      const name = reads[i][0];
      // the ONE permitted match is the loan-STATUS vocabulary's own word: the counts read carries how many loans have status
      // `restructured` (4a, a loan fact). It is pinned to ZERO below — a proposal in mediation changes no loan.
      expect([name, deepKeys(b).filter((k) => RESTRUCTURE_KEY.test(k) && k !== 'restructured')]).toEqual([name, []]);
      const json = JSON.stringify(b);
      for (const v of forbiddenValues) expect([name, v, json.includes(v)]).toEqual([name, v, false]);
      for (const x of TERM_NUMBERS) expect([name, x, deepNumbers(b).includes(x)]).toEqual([name, x, false]);
    }
    const counts = (bodies[4] as { data: { restructured: number; byStatus: Record<string, number> } }).data;
    expect([counts.restructured, counts.byStatus.restructured ?? 0]).toEqual([0, 0]);
    expect(deepKeys(bodies[4]).filter((k) => k === 'restructured').length).toBe(2);   // exactly the two status-count keys, nothing more
    // the loan's own page shows its STATUS only — the proposal changed nothing a lender can read
    const own = (bodies[2] as { data: Record<string, unknown> }).data;
    expect([own.id, own.status]).toEqual([loan.r, 'active']);
    // THE AXIS RULE, re-proved here (0231/0232's asserts are local): kv_partner holds nothing on loan_restructures
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
      await c.query(`SELECT set_config('app.partner_id', $1, true)`, [P]);
      expect(await errCode(c.query('SELECT 1 FROM loan_restructures LIMIT 1'))).toBe('42501');
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
    expect((await admin.query(
      `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = 'kv_partner' AND table_name = 'loan_restructures'`)).rows[0].n).toBe(0);
    expect((await admin.query(
      `SELECT count(*)::int AS n FROM information_schema.column_privileges WHERE grantee = 'kv_partner' AND table_name = 'loan_restructures'`)).rows[0].n).toBe(0);
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) a PARTNER token on the tenant plane\'s collections / restructure / write-off / repay routes → refused, nothing written', async () => {
    const before = await snapshot();
    expect(before.proposal).toEqual({ status: 'mediation', case_ref: CASE_REF });
    const routes: Array<[string, () => request.Test]> = [];
    for (const [label, h] of [['tenant header', H('partner')], ['no tenant header', bearer('partner')]] as const) {
      routes.push(
        [`${label} · GET collections`, () => request(http).get('/v1/fintech/servicing/collections').set(h)],
        [`${label} · GET dpd`, () => request(http).get('/v1/fintech/servicing/dpd').set(h)],
        [`${label} · POST restructures`, () => request(http).post(`/v1/fintech/servicing/loans/${loan.o}/restructures`).set(h).set('idempotency-key', K()).send(PROPOSAL)],
        [`${label} · GET restructures`, () => request(http).get(`/v1/fintech/servicing/loans/${loan.r}/restructures`).set(h)],
        [`${label} · POST transition (rejected)`, () => request(http).post(`/v1/fintech/servicing/restructures/${restructureId}/transition`).set(h).set('idempotency-key', K()).send({ to: 'rejected' })],
        [`${label} · POST transition (expired)`, () => request(http).post(`/v1/fintech/servicing/restructures/${restructureId}/transition`).set(h).set('idempotency-key', K()).send({ to: 'expired' })],
        [`${label} · POST write-off`, () => request(http).post(`/v1/fintech/servicing/loans/${loan.o}/write-off`).set(h).set('idempotency-key', K()).send({ reason: 'a partner probe reason' })],
        [`${label} · POST repay`, () => request(http).post(`/v1/fintech/loans/${loan.o}/repay`).set(h).set('idempotency-key', K()).send({ amountMinor: '100000' })],
      );
    }
    for (const [name, fire] of routes) {
      const r = await fire();
      expect([name, [401, 403].includes(r.status)]).toEqual([name, true]);
      expect([name, JSON.stringify(r.body ?? {}).includes(CASE_REF)]).toEqual([name, false]);
    }
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) no collections, contact, promise or restructure address exists on the partner realm — each 404, nothing moved', async () => {
    const before = await snapshot();
    const id = loan.o; const any = randomUUID();
    const probes: Array<[string, () => request.Test]> = [
      ['GET collections', () => request(http).get('/v1/partner/collections').set(bearer('partner'))],
      ['POST collections', () => request(http).post('/v1/partner/collections').set(bearer('partner')).send({ loanId: id })],
      ['GET collections/:id', () => request(http).get(`/v1/partner/collections/${id}`).set(bearer('partner'))],
      ['GET collections/:id/contacts', () => request(http).get(`/v1/partner/collections/${id}/contacts`).set(bearer('partner'))],
      ['POST collections/:id/contacts', () => request(http).post(`/v1/partner/collections/${id}/contacts`).set(bearer('partner')).send({ channel: 'voice', note: 'a probe' })],
      ['GET collections/:id/promises', () => request(http).get(`/v1/partner/collections/${id}/promises`).set(bearer('partner'))],
      ['POST collections/:id/promises', () => request(http).post(`/v1/partner/collections/${id}/promises`).set(bearer('partner')).send({ amountMinor: '100000', byDate: '2031-01-01' })],
      ['POST collections/:id/restructure', () => request(http).post(`/v1/partner/collections/${id}/restructure`).set(bearer('partner')).send(PROPOSAL)],
      ['GET loans/:id/restructure', () => request(http).get(`/v1/partner/loans/${loan.r}/restructure`).set(bearer('partner'))],
      ['GET loans/:id/restructures', () => request(http).get(`/v1/partner/loans/${loan.r}/restructures`).set(bearer('partner'))],
      ['POST loans/:id/contacts', () => request(http).post(`/v1/partner/loans/${id}/contacts`).set(bearer('partner')).send({ channel: 'voice', note: 'a probe' })],
      ['POST loans/:id/promises', () => request(http).post(`/v1/partner/loans/${id}/promises`).set(bearer('partner')).send({ amountMinor: '100000', byDate: '2031-01-01' })],
      ['GET loans/:id/collections', () => request(http).get(`/v1/partner/loans/${id}/collections`).set(bearer('partner'))],
      ['GET restructures', () => request(http).get('/v1/partner/restructures').set(bearer('partner'))],
      ['GET restructures/:id', () => request(http).get(`/v1/partner/restructures/${restructureId || any}`).set(bearer('partner'))],
      ['POST restructures/:id/transition', () => request(http).post(`/v1/partner/restructures/${restructureId || any}/transition`).set(bearer('partner')).send({ to: 'accepted' })],
    ];
    for (const [name, fire] of probes) {
      const r = await fire();
      expect([name, r.status]).toEqual([name, 404]);
      expect([name, JSON.stringify(r.body ?? {}).includes(CASE_REF)]).toEqual([name, false]);
    }
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) no collections / restructure / contact / promise definer exists, and kv_app holds EXECUTE on no definer of the lender\'s book', async () => {
    const names = async (pattern: string) => (await admin.query(
      `SELECT proname FROM pg_proc WHERE proname LIKE $1 ORDER BY proname`, [pattern])).rows.map((r) => r.proname as string);
    expect(await names('partner_%restructur%')).toEqual([]);
    expect(await names('partner_%contact%')).toEqual([]);
    expect(await names('partner_%promise%')).toEqual([]);
    // PATTERN NOTE (the 5a finding): 'partner_%collect%' matches 0232's `partner_loan_collected` — the 4b collected-window COUNT, which is
    // legitimate and stays. It is the ONLY match, by name; no collections-case definer exists.
    expect(await names('partner_%collect%')).toEqual(['partner_loan_collected']);
    expect(await names('partner_%collect%case%')).toEqual([]);
    // kv_app must wear the axis role to call any definer of the lender's book (0232.3(c), re-proved across EVERY partner_% definer). The two
    // exceptions are PARTNER-0's identity helpers, granted to kv_app BY NAME in 0225 (`partner_invite_partner`, `partner_has_console_members`)
    // — neither reads a loan, a restructure, a contact or a promise.
    const kvApp = (await admin.query(
      `SELECT proname FROM pg_proc WHERE proname LIKE 'partner\\_%' AND prosecdef AND has_function_privilege('kv_app', oid, 'EXECUTE') ORDER BY proname`)).rows.map((r) => r.proname);
    expect(kvApp).toEqual(['partner_has_console_members', 'partner_invite_partner']);
    const book = (await admin.query(
      `SELECT proname, has_function_privilege('kv_app', oid, 'EXECUTE') AS app, has_function_privilege('kv_partner', oid, 'EXECUTE') AS axis
         FROM pg_proc WHERE proname LIKE 'partner\\_loan%' ORDER BY proname`)).rows;
    expect(book.length).toBeGreaterThanOrEqual(6);
    for (const r of book) expect([r.proname, r.app, r.axis]).toEqual([r.proname, false, true]);
  }, 60_000);
});
