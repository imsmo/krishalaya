// apps/api/src/__tests__/partner6b-consents-absent.integration.spec.ts · PC-56 PARTNER-6b · CONSENT AND THE FILINGS THE PLATFORM DOES NOT MAKE —
// the LIVE proof (the real AppModule over HTTP, real Postgres + RLS) behind W213 `/lender/consents` and W224 `/lender/reports/regulatory`, two
// honest pages that read nothing (founder 6b-1 / 6b-3, doors Q3-A / Q6-A). This wave adds NO route, NO definer, NO grant and NO migration;
// this spec is its only `apps/api` file (the 4c / 5b / 6a precedent). It proves that what the two pages say is true of the platform underneath:
//
//   (1) "The platform checks it every time your organisation reads the application, and your access ends when the consent expires." With
//       `partner_console` ON, a lender with three applications on its own product: one whose consent expires in thirty days, one whose consent
//       has NO end date, one with no consent. THERE IS NO WRITER OF `credit_score_consents` ANYWHERE ON THE PLATFORM (P4-B6, survey C-1) — the
//       consent rows are FIXTURE SQL written as the owner, inside this spec's own database only. `GET /v1/partner/applications` admits the two
//       consented ones; after the first consent's `expires_at` is moved into the past (fixture SQL), the NEXT read hides it — list and detail
//       (404, the named not-found). The consent with `expires_at` NULL STAYS ADMITTED: survey C-10, PINNED AS TODAY'S TRUTH. Founder 6b-2
//       (door Q4-A) binds P4-B6 / P6-B1 to give every consent a platform-set end date and a withdrawal effective on the lender's next read; THAT
//       wave turns this assertion red and MUST update it (the P4aR D-1 precedent) — it is not a promise the console makes (it never says
//       "revocable" or "standing access").
//   (2) THE 42501 PROBE under `SET LOCAL ROLE kv_partner`: credit_score_consents, consents, consent_purposes (it exists — 0003:197), users,
//       land_parcels, and the nine of 0232:189-190 → 42501 each, no write privilege on any (RE-PROVED here: 0231 / 0232's asserts are LOCAL —
//       M1 kills here); `pg_proc` holds no partner_%consent%, partner_%regulat%, partner_%psl% function.
//   (3) absence → 404: every consent-registry / revoke / regulatory / pack / PSL address a partner console could call.
//   (4) a partner token on the TENANT consent routes (`GET` / `POST /v1/consents`) → refused (401, the verifier); nothing written.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
const errCode = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e?.code ?? 'error');

run('PC-56 PARTNER-6b · consent is checked at every read and ends on expiry; no registry, no regulatory extract, nothing of a consent reaches a lender (integration)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService;
  const T = randomUUID(); const PA = randomUUID(); const PB = randomUUID();
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, string> = {};
  const app_: Record<string, string> = {};
  let prodA = '';
  const backup: Record<string, { is_enabled: boolean; rollout_pct: number; rules: unknown } | null> = {};

  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    if (cache) for (const k of flagKeys(key)) await cache.del(k);
  };
  const user = async (key: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[key] = { id, phone };
  };
  const application = (applicantKey: string, productId: string) => admin.query(
    `INSERT INTO loan_applications (tenant_id, applicant_user_id, product_id, amount_requested_minor, purpose_text, status, created_by)
     VALUES ($1, $2, $3, 5000000, 'seed and fertiliser for the season', 'submitted', $2) RETURNING id`,
    [T, people[applicantKey].id, productId]).then((r) => r.rows[0].id as string);
  /** FIXTURE SQL — no writer of this table exists on the platform (P4-B6); only this spec's own test database is written. */
  const consent = (applicantKey: string, partnerId: string, appId: string, expires: 'live' | 'open') => admin.query(
    `INSERT INTO credit_score_consents (user_id, partner_id, purpose_ref, expires_at) VALUES ($1, $2, $3, CASE $4 WHEN 'live' THEN now() + interval '30 days' ELSE NULL END)`,
    [people[applicantKey].id, partnerId, appId, expires]);
  const listIds = async (who: string) => {
    const r = await request(http).get('/v1/partner/applications').set(bearer(tok[who]));
    expect([who, r.status]).toEqual([who, 200]);
    return (r.body.data as Array<{ id: string }>).map((x) => x.id).sort();
  };
  const consentRows = async (userId: string) => (await admin.query(`SELECT count(*)::int AS n FROM consents WHERE user_id = $1`, [userId])).rows[0].n as number;

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '200'; process.env.OTP_VERIFY_MAX_PER_HOUR = '200';
    admin = new Pool({ connectionString: ADMIN_URL });
    for (const k of ['partner_console']) backup[k] = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0] ?? null;
    await makeTenant(admin, T, 'Consent Absent Growers Collective');
    const kind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'loan_kind' AND code = 'crop' AND tenant_id IS NULL ORDER BY created_at, id LIMIT 1`)).rows[0].id;
    const sfx = randomUUID().replace(/-/g, '').slice(0, 10);
    await admin.query(`INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1, $2, 'Fixture Consent Lender A', 'bank'), ($3, $4, 'Fixture Consent Lender B', 'bank')`,
      [PA, `p6ba_${sfx}`, PB, `p6bb_${sfx}`]);
    prodA = (await admin.query(`INSERT INTO loan_products (partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps, repayment_style)
      VALUES ($1, $2, 'Consent crop loan', 100000, 50000000, 1100, 'harvest_aligned') RETURNING id`, [PA, kind])).rows[0].id;
    for (const [k, n] of [['f1', 'Consent applicant one'], ['f2', 'Consent applicant two'], ['f3', 'Consent applicant three'],
      ['aAdmin', 'Consent lender admin'], ['bAdmin', 'Consent rival admin']] as const) await user(k, n);
    for (const k of ['f1', 'f2', 'f3']) {
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'farmer'`, [people[k].id, T]);
    }
    for (const [k, p] of [['aAdmin', PA], ['bAdmin', PB]] as const) {
      await admin.query(`INSERT INTO partner_memberships (user_id, partner_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'partner_admin'`, [people[k].id, p]);
    }
    app_.live = await application('f1', prodA); app_.open = await application('f2', prodA); app_.none = await application('f3', prodA);
    await consent('f1', PA, app_.live, 'live');
    await consent('f2', PA, app_.open, 'open');
    // B's consent on A's application admits nothing to anyone: the oracle needs the PRODUCT's partner
    await consent('f3', PB, app_.none, 'live');

    await setFlag('partner_console', true);
    app = await bootstrapE2EApp(); http = app.getHttpServer();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE);
    for (const k of flagKeys('partner_console')) await cache.del(k);
    for (const k of ['aAdmin', 'bAdmin']) {
      const w = Math.floor(Date.now() / 1000 / 60);
      for (const r of ['PartnerAuthController.verify', 'PartnerAuthController.otp'])
        for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
      const { code } = await otp.issue(people[k].phone);
      const v = await request(http).post('/v1/partner/auth/verify').send({ phone: people[k].phone, code });
      expect([k, v.status]).toEqual([k, 201]);
      tok[k] = v.body.data.accessToken;
    }
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
  it('(1) consent is checked at EVERY read: the consented applications are admitted; once one expires the NEXT read hides it; a consent with NO end date stays admitted (C-10, today\'s truth)', async () => {
    // there is still no writer: no route, no job, no service of the platform writes this table (only fixture SQL above did)
    expect((await admin.query(`SELECT count(*)::int AS n FROM credit_score_consents WHERE partner_id = ANY($1::uuid[])`, [[PA, PB]])).rows[0].n).toBe(3);
    expect(await listIds('aAdmin')).toEqual([app_.live, app_.open].sort());
    // the rival's consent on A's application opens nothing for B (the product's partner is A) and nothing extra for A
    expect(await listIds('bAdmin')).toEqual([]);
    const live = await request(http).get(`/v1/partner/applications/${app_.live}`).set(bearer(tok.aAdmin));
    expect(live.status).toBe(200);
    // what a consent IS never reaches the lender: no consent id, no grant date, no expiry, no channel, no scope, no applicant
    const json = JSON.stringify(live.body);
    for (const k of ['consentId', 'consent_id', 'grantedAt', 'granted_at', 'expiresAt', 'expires_at', 'purposeRef', 'purpose_ref', 'channel', 'applicantUserId']) expect([k, json.includes(`"${k}"`)]).toEqual([k, false]);
    expect(json.includes(people.f1.id)).toBe(false);

    // the consent ends (fixture SQL moves its expiry into the past) — the very NEXT read hides the application, list and detail alike
    await admin.query(`UPDATE credit_score_consents SET expires_at = now() - interval '1 second' WHERE purpose_ref = $1 AND partner_id = $2`, [app_.live, PA]);
    expect(await listIds('aAdmin')).toEqual([app_.open]);
    const gone = await request(http).get(`/v1/partner/applications/${app_.live}`).set(bearer(tok.aAdmin));
    expect([gone.status, gone.body.error?.code]).toEqual([404, 'PARTNER_APPLICATION_NOT_FOUND']);

    // C-10 PINNED AS TODAY'S TRUTH — a consent recorded with NO end date is admitted for ever. Founder 6b-2 (door Q4-A, 2026-11-05) binds the
    // consent step P4-B6 / P6-B1 to set an end date on every consent and to make a withdrawal effective on the lender's next read: THAT wave
    // turns this red and must update it. The console therefore never says "revocable", "time-boxed" or "you never hold standing access".
    expect((await admin.query(`SELECT expires_at FROM credit_score_consents WHERE purpose_ref = $1`, [app_.open])).rows[0].expires_at).toBeNull();
    const open = await request(http).get(`/v1/partner/applications/${app_.open}`).set(bearer(tok.aAdmin));
    expect(open.status).toBe(200);
    // and there is no column a withdrawal could be recorded in (C-10)
    const cols = (await admin.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'credit_score_consents' ORDER BY column_name`)).rows.map((r) => r.column_name as string);
    expect(cols.filter((c) => /revok|withdraw|channel|scope/.test(c))).toEqual([]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (2)
  it('(2) THE WALL IS THE GRANT: kv_partner → 42501 on the consent tables, users and land records (and the nine of 0232); no consent / regulatory / PSL definer exists', async () => {
    const TABLES = ['credit_score_consents', 'consents', 'consent_purposes', 'users', 'land_parcels',
      // the nine of 0232:189-190
      'bank_accounts', 'payouts', 'payout_batches', 'loan_disbursement_runs', 'loan_disbursement_run_items', 'kcc_drawl_ledger', 'loan_restructures', 'credit_scores'];
    for (const t of TABLES) {
      expect([t, (await admin.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`])).rows[0].ok]).toEqual([t, true]);
      const c = await admin.connect();
      try {
        await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_partner');
        await c.query(`SELECT set_config('app.partner_id', $1, true)`, [PA]);
        expect([t, await errCode(c.query(`SELECT 1 FROM ${t} LIMIT 1`))]).toEqual([t, '42501']);
      } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
    }
    for (const t of TABLES) {
      const w = (await admin.query(`SELECT has_table_privilege('kv_partner', $1, 'SELECT') OR has_table_privilege('kv_partner', $1, 'INSERT') OR has_table_privilege('kv_partner', $1, 'UPDATE') OR has_table_privilege('kv_partner', $1, 'DELETE') AS any`, [`public.${t}`])).rows[0].any;
      expect([t, w]).toEqual([t, false]);
    }
    const names = async (pattern: string) => (await admin.query(`SELECT proname FROM pg_proc WHERE proname LIKE $1 ORDER BY proname`, [pattern])).rows.map((r) => r.proname as string);
    for (const p of ['partner\\_%consent%', 'partner\\_%regulat%', 'partner\\_%psl%']) expect([p, await names(p)]).toEqual([p, []]);
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (3)
  it('(3) absence → 404: no consent registry, export, revoke, regulatory, pack or PSL address exists in the partner realm', async () => {
    for (const p of ['/v1/partner/consents', '/v1/partner/consents/export', `/v1/partner/consents/${app_.open}`, '/v1/partner/regulatory', '/v1/partner/regulatory/packs', '/v1/partner/reports/psl']) {
      const r = await request(http).get(p).set(bearer(tok.aAdmin));
      expect([p, r.status]).toEqual([p, 404]);
    }
    for (const p of [`/v1/partner/consents/${app_.open}/revoke`, '/v1/partner/regulatory/packs', '/v1/partner/consents/export']) {
      const r = await request(http).post(p).set({ ...bearer(tok.aAdmin), 'idempotency-key': randomUUID() }).send({});
      expect([p, r.status]).toEqual([p, 404]);
    }
    // nothing changed: the open consent is still there and still admits its application
    expect((await admin.query(`SELECT count(*)::int AS n FROM credit_score_consents WHERE purpose_ref = $1`, [app_.open])).rows[0].n).toBe(1);
    expect(await listIds('aAdmin')).toEqual([app_.open]);
  });

  // ─────────────────────────────────────────────────────────────────────────────────────────────────────────── (4)
  it('(4) a partner token on the TENANT consent routes is refused (401, the verifier) and nothing is written', async () => {
    const before = await consentRows(people.aAdmin.id);
    const g = await request(http).get('/v1/consents').set({ ...bearer(tok.aAdmin), 'x-tenant-id': T });
    expect([401, 403]).toContain(g.status);
    expect(g.status).toBe(401);
    const p = await request(http).post('/v1/consents').set({ ...bearer(tok.aAdmin), 'x-tenant-id': T, 'idempotency-key': randomUUID() })
      .send({ purposeCode: 'data_sharing', granted: true, channel: 'web' });
    expect(p.status).toBe(401);
    expect(await consentRows(people.aAdmin.id)).toBe(before);
    expect(before).toBe(0);
  });
});
