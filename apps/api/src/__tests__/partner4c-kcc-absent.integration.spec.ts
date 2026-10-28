// apps/api/src/__tests__/partner4c-kcc-absent.integration.spec.ts · PC-56 PARTNER-4c · THE KCC ACCOUNT THE PLATFORM DOES NOT KEEP — the LIVE
// proof that the two honest pages of this wave are honest, with the real AppModule over HTTP, real Postgres, a real `kcc`-kind loan on a
// lender's own book and a real `kcc_drawl_ledger` row written on the TENANT plane.
//
// THIS WAVE ADDS NO ROUTE, NO DEFINER, NO GRANT, NO PERMISSION, NO FLAG AND NO MIGRATION. So every assertion here is about ABSENCE, and the
// four the lead asked for are:
//
//   (1) THE LEDGER IS UNREACHABLE ON THE PARTNER AXIS. Inside `SET LOCAL ROLE kv_partner`, `SELECT 1 FROM kcc_drawl_ledger` is 42501 — and
//       so is every single one of its columns — and `pg_proc` holds NO `partner_kcc%` function at all, so there is no definer that could
//       hand a row over either. kv_partner holds nothing on the restructure and account-adjacent tables either.      [M2]
//   (2) DEEP-KEY AND DEEP-VALUE ABSENCE over every partner response this console can make: no `narrative`, `destinationKind`,
//       `purposeCheckStatus`, `balanceAfterMinor`, `accrualBasis`, `entryKind` or `amountMinor` as a KEY at any depth — and none of the
//       ledger row's own VALUES, nor the borrower's id, phone or name, as a VALUE anywhere.                           [M1]
//   (3) THE TEN ABSENT KCC / LIMIT ROUTES answer 404 — a KCC account has no API on this platform, and nor has a limit review. The TENANT
//       servicing plane's own KCC routes refuse a partner token outright.
//   (4) THE ONE READ W216 DOES MAKE is PARTNER-4a's audited `partner_loan`: the loan's facts come back with its kind code resolving to
//       `kcc`, exactly ONE partner-realm audit row is written for the page, and the row carries no amount and no person.
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

/** Every property name of the drawl ledger (0069:75-97), plus the identity the wall removes — forbidden at ANY depth. */
const FORBIDDEN_KEY = /^(narrative|destinationKind|destination_kind|purposeCheckStatus|purpose_check_status|balanceAfterMinor|balance_after_minor|accrualBasis|accrual_basis|entryKind|entry_kind|entryDate|entry_date|amountMinor|amount_minor|repaymentChannel|repayment_channel|ledgerTxnId|ledger_txn_id|drawnMinor|drawn_minor|limitMinor|limit_minor|availableMinor|available_minor|utilisation|renewalDate|renewal_date|borrowerUserId|borrower_user_id|borrower|channel|createdBy|created_by|phone|name)$/;
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
}
/** The tables kv_partner must hold NOTHING on — the ledger, the account-adjacent ones, and the money plane (0231.4 / 0232.3(b)). */
const FORBIDDEN_TABLES = ['kcc_drawl_ledger', 'loan_restructures', 'loan_disbursement_runs', 'loan_disbursement_run_items',
  'credit_scores', 'credit_score_consents', 'bank_accounts', 'payouts'] as const;
/** Every column of the ledger, probed one by one: a column grant added by mistake would be caught here, not only a table grant. */
const LEDGER_COLUMNS = ['id', 'tenant_id', 'loan_id', 'entry_kind', 'amount_minor', 'currency_code', 'balance_after_minor', 'entry_date',
  'narrative', 'destination_kind', 'purpose_check_status', 'repayment_channel', 'accrual_basis', 'ledger_txn_id', 'created_by', 'created_at'] as const;
/** THE TEN ROUTES A KCC ACCOUNT WOULD NEED, and does not have. */
const ABSENT_ROUTES: readonly [('get' | 'post'), (id: string) => string][] = [
  ['get', (id) => `/v1/partner/kcc/${id}`],
  ['post', (id) => `/v1/partner/kcc/${id}`],
  ['get', (id) => `/v1/partner/kcc/${id}/ledger`],
  ['get', (id) => `/v1/partner/kcc/${id}/entries`],
  ['post', (id) => `/v1/partner/kcc/${id}/entries`],
  ['get', (id) => `/v1/partner/kcc/${id}/limit-review`],
  ['post', (id) => `/v1/partner/kcc/${id}/limit-review`],
  ['get', () => '/v1/partner/kcc'],
  ['get', (id) => `/v1/partner/loans/${id}/kcc/ledger`],
  ['post', (id) => `/v1/partner/loans/${id}/kcc/entries`],
];

run('PC-56 PARTNER-4c · the KCC account that does not exist, and the ledger that stays off this axis (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T = randomUUID(); const LA = randomUUID(); const LB = randomUUID();
  const people: Record<string, { id: string; phone: string; name: string }> = {};
  const tok: Record<string, string> = {};
  const prod: Record<string, string> = {};
  const loan: Record<string, string> = {};
  const responses: unknown[] = [];
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};
  /** The ledger row's own values — not one of them may appear in any partner response. */
  const LEDGER = {
    narrative: 'A note about what the family bought with its own line of credit',
    amountMinor: '16000000', balanceAfterMinor: '19430717', destinationKind: 'supplier_direct',
    purposeCheckStatus: 'flagged', repaymentChannel: 'harvest_settlement',
  };
  const PURPOSE = 'Seed and fertiliser for the season';

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
    `SELECT tenant_id, actor_role, entity_type, entity_id, new_value FROM audit_log
      WHERE action = 'partner.loans.read' AND new_value ->> 'partnerId' = $1 ORDER BY created_at, id`, [partnerId])).rows;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console', 'fintech']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T, 'KCC Fixture Collective');
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture KCC Lender A', 'bank'), ($3, $4, 'Fixture KCC Lender B', 'nbfc')`,
      [LA, `p4csa_${sfx}`, LB, `p4csb_${sfx}`]);
    for (const [k, n2] of [['aAdmin', 'KCC A admin'], ['aViewer', 'KCC A viewer'], ['bViewer', 'KCC B viewer'],
      ['b1', 'Borrower Kamla One'], ['fpoAdmin', 'FPO admin']] as const) await user(k, n2);
    for (const [k, p, role] of [['aAdmin', LA, 'partner_admin'], ['aViewer', LA, 'partner_viewer'], ['bViewer', LB, 'partner_viewer']] as const) {
      await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = $3`,
        [people[k].id, p, role]);
    }
    // a product whose kind IS `kcc` — which is all a "KCC account" ever is on this platform
    const product = async (key: string, partnerId: string, kind: string, name: string) => {
      prod[key] = (await admin.query(
        `INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
         SELECT $1, lv.id, $2, 100000, 90000000, 700, 'harvest_aligned' FROM lookup_values lv
          WHERE lv.type_code = 'loan_kind' AND lv.code = $3 AND lv.tenant_id IS NULL ORDER BY lv.created_at, lv.id LIMIT 1 RETURNING id`,
        [partnerId, name, kind])).rows[0].id;
    };
    await product('aKcc', LA, 'kcc', 'Fixture A seasonal credit line');
    await product('bKcc', LB, 'kcc', 'Fixture B seasonal credit line');

    const mkLoan = async (key: string, partnerKey: 'aKcc' | 'bKcc', partnerId: string) => {
      const appId = (await admin.query(
        `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, amount_approved_minor, status, purpose_text, created_by)
         VALUES ($1, $2, $3, 40000000, 40000000, 'disbursed', $4, $2) RETURNING id`,
        [T, people.b1.id, prod[partnerKey], PURPOSE])).rows[0].id;
      loan[key] = (await admin.query(
        `INSERT INTO loans (application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status,
                            outstanding_minor, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 40000000, 700, CURRENT_DATE - 60, 'active', 22000000, $3, $3) RETURNING id`,
        [appId, T, people.b1.id, partnerId])).rows[0].id;
    };
    await mkLoan('a', 'aKcc', LA);
    await mkLoan('b', 'bKcc', LB);

    // THE ROW THIS WAVE KEEPS OFF THE CONSOLE: a real drawl entry on the TENANT plane, with every field the canon prints
    await admin.query(
      `INSERT INTO kcc_drawl_ledger (tenant_id, loan_id, entry_kind, amount_minor, balance_after_minor, entry_date, narrative,
                                     destination_kind, purpose_check_status, repayment_channel, accrual_basis, created_by)
       VALUES ($1, $2, 'drawl', $3, $4, CURRENT_DATE - 30, $5, $6, $7, $8, '{"days":25,"rate_apr_bps":700}'::jsonb, $9)`,
      [T, loan.a, LEDGER.amountMinor, LEDGER.balanceAfterMinor, LEDGER.narrative, LEDGER.destinationKind,
        LEDGER.purposeCheckStatus, LEDGER.repaymentChannel, people.b1.id]);

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
  it('(1) THE LEDGER IS UNREACHABLE ON THE PARTNER AXIS: the table is 42501, every one of its sixteen columns is 42501, and NO partner_kcc% definer exists', async () => {
    // the row really is there, on the tenant plane, with everything the canon draws
    const row = (await admin.query(`SELECT count(*)::int AS n FROM kcc_drawl_ledger WHERE loan_id = $1`, [loan.a])).rows[0].n;
    expect(row).toBe(1);
    await asPartnerAxis(LA, async (c) => {
      // each probe inside its own SAVEPOINT: a refused statement aborts the transaction, and the next probe would answer 25P02 instead
      const probe = async (sql: string) => {
        await c.query('SAVEPOINT p');
        const code = await errCode(c.query(sql));
        await c.query(code === 'ok' ? 'RELEASE SAVEPOINT p' : 'ROLLBACK TO SAVEPOINT p');
        return code;
      };
      expect(await probe(`SELECT 1 FROM kcc_drawl_ledger LIMIT 1`)).toBe('42501');
      expect(await probe(`SELECT * FROM kcc_drawl_ledger LIMIT 1`)).toBe('42501');
      for (const col of LEDGER_COLUMNS) expect([col, await probe(`SELECT ${col} FROM kcc_drawl_ledger LIMIT 1`)]).toEqual([col, '42501']);
      // a partition of it is no way in either (the table is partitioned by created_at)
      const child = (await admin.query(
        `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
          WHERE p.relname = 'kcc_drawl_ledger' LIMIT 1`)).rows[0]?.relname as string | undefined;
      if (child) expect([child, await probe(`SELECT 1 FROM ${child} LIMIT 1`)]).toEqual([child, '42501']);
      for (const t of FORBIDDEN_TABLES) expect([t, await probe(`SELECT 1 FROM ${t} LIMIT 1`)]).toEqual([t, '42501']);
      // and the loan the KCC page DOES read still answers on the same axis — the wall took the ledger, not the book
      expect(await probe(`SELECT 1 FROM partner_loan('${loan.a}')`)).toBe('ok');
    });
    // NO DEFINER EXISTS THAT COULD HAND A ROW OVER: nothing named partner_kcc%, and no function body mentions the table at all
    const fns = (await admin.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND (p.proname LIKE 'partner_kcc%' OR p.proname LIKE '%kcc%') ORDER BY 1`)).rows.map((r) => r.proname);
    expect(fns).toEqual([]);
    const touching = (await admin.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prosecdef AND pg_get_functiondef(p.oid) LIKE '%kcc_drawl_ledger%' ORDER BY 1`)).rows.map((r) => r.proname);
    expect(touching).toEqual([]);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) DEEP-KEY AND DEEP-VALUE ABSENCE: no field of the ledger, and no value of the row, in ANY partner response — nor the borrower\'s id, phone or name', async () => {
    const bodies = [
      (await get('aAdmin', `/v1/partner/loans/${loan.a}`)).body,
      (await get('aAdmin', `/v1/partner/loans/${loan.a}/repayments`)).body,
      (await get('aAdmin', '/v1/partner/loans')).body,
      (await get('aAdmin', '/v1/partner/loans/counts')).body,
      (await get('aAdmin', '/v1/partner/loans/dpd')).body,
      (await get('aAdmin', '/v1/partner/loans/collected')).body,
      (await get('aAdmin', '/v1/partner/loans/pipeline')).body,
      (await get('aAdmin', '/v1/partner/applications')).body,
      (await get('aAdmin', '/v1/partner/dashboard')).body,
      ...responses,
    ];
    for (const b of bodies) {
      expect(deepKeys(b).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      const json = JSON.stringify(b);
      for (const v of [LEDGER.narrative, LEDGER.destinationKind, LEDGER.purposeCheckStatus, LEDGER.repaymentChannel,
        LEDGER.balanceAfterMinor, people.b1.id, people.b1.phone, people.b1.name, PURPOSE, 'accrual_basis', 'rate_apr_bps']) {
        expect([v, json.includes(v)]).toEqual([v, false]);
      }
      // no word of a KCC ACCOUNT is answered either — no limit, no headroom, no renewal, no utilisation
      expect(json).not.toMatch(/limitMinor|drawingPower|availableMinor|headroom|renewalDate|utilisation|revolving/i);
    }
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) THE TEN ABSENT KCC / LIMIT ROUTES answer 404 for every partner role; and the TENANT plane\'s own KCC routes refuse a partner token', async () => {
    for (const who of ['aAdmin', 'aViewer'] as const) {
      for (const [method, path] of ABSENT_ROUTES) {
        const url = path(loan.a);
        const r = method === 'get'
          ? await request(http).get(url).set({ authorization: `Bearer ${tok[who]}` })
          : await request(http).post(url).set({ authorization: `Bearer ${tok[who]}`, 'idempotency-key': randomUUID() }).send({ limitMinor: '44000000' });
        expect([who, method, url, r.status]).toEqual([who, method, url, 404]);
      }
    }
    expect(ABSENT_ROUTES.length).toBe(10);
    // the tenant servicing plane's KCC routes exist (unflagged — survey F-1, closed by 4a) and a PARTNER token is not a tenant session
    for (const [method, url] of [['get', `/v1/fintech/servicing/loans/${loan.a}/kcc/ledger`], ['post', `/v1/fintech/servicing/loans/${loan.a}/kcc/entries`]] as const) {
      const r = method === 'get'
        ? await request(http).get(url).set({ authorization: `Bearer ${tok.aAdmin}` })
        : await request(http).post(url).set({ authorization: `Bearer ${tok.aAdmin}`, 'idempotency-key': randomUUID() }).send({ entryKind: 'drawl', amountMinor: '100', narrative: 'x' });
      expect([url, r.status < 400]).toEqual([url, false]);
      expect([url, [401, 403, 404].includes(r.status)]).toEqual([url, true]);
    }
    // and not one ledger row was written by any of it
    expect((await admin.query(`SELECT count(*)::int AS n FROM kcc_drawl_ledger WHERE loan_id = $1`, [loan.a])).rows[0].n).toBe(1);
  }, 120_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) THE ONE READ W216 MAKES is 4a\'s audited `partner_loan`: the kind code resolves to `kcc`, exactly ONE audit row, no amount and no person in it', async () => {
    await admin.query(`DELETE FROM audit_log WHERE action = 'partner.loans.read' AND new_value ->> 'partnerId' = $1`, [LA]);
    const r = await get('aViewer', `/v1/partner/loans/${loan.a}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: loan.a, kindCode: 'kcc', status: 'active', outstandingMinor: '22000000', interestAprBps: 700 });
    expect(r.body.data.productName).toBe('Fixture A seasonal credit line');
    expect(typeof r.body.data.computedAt).toBe('string');
    // ONE audit row for the page's one read, counts only
    const rows = await audits(LA);
    expect(rows.length).toBe(1);
    expect(rows[0].new_value.surface).toBe('loan');
    expect([rows[0].tenant_id, rows[0].actor_role, rows[0].entity_type, rows[0].entity_id]).toEqual([null, `partner:${LA}:partner_viewer`, 'loan', loan.a]);
    const json = JSON.stringify(rows[0].new_value);
    expect(json).not.toMatch(/Minor|22000000|40000000/);
    for (const v of [people.b1.id, people.b1.phone, people.b1.name, T, LEDGER.narrative]) expect([v, json.includes(v)]).toEqual([v, false]);
    // ANOTHER LENDER'S KCC LOAN IS NOT FOUND — never a 403, and never "not yours"
    const other = await get('aViewer', `/v1/partner/loans/${loan.b}`);
    expect([other.status, other.body.error?.code]).toEqual([404, 'PARTNER_LOAN_NOT_FOUND']);
    // the drawls page makes NO read at all, so there is no second audit row for it to write
    expect((await audits(LA)).length).toBe(2);       // the detail read above + the refused probe, and nothing from a ledger read
    expect((await audits(LA)).map((x) => x.new_value.surface)).toEqual(['loan', 'loan']);
    // `partner_console` OFF → 404 even on the one read the page makes
    await setFlag('partner_console', false);
    expect((await request(http).get(`/v1/partner/loans/${loan.a}`).set({ authorization: `Bearer ${tok.aAdmin}` })).status).toBe(404);
    await setFlag('partner_console', true);
    // a tenant token is not a partner session
    const t = mintToken(app, { userId: people.fpoAdmin.id, tenantId: T, roles: ['tenant_admin'], perms: ['loan.manage', '*'] });
    const asTenant = await request(http).get(`/v1/partner/loans/${loan.a}`).set({ authorization: `Bearer ${t}`, 'x-tenant-id': T });
    expect([asTenant.status, asTenant.body.error?.code]).toEqual([401, 'PARTNER_SESSION_REQUIRED']);
  }, 120_000);
});
