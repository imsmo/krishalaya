// apps/api/src/__tests__/gov2a-decide.integration.spec.ts · PC-56 GOV-2a · THE AUTHORITY DECIDES, ON DECLARED FIELDS — LIVE (the real AppModule
// over HTTP on 127.0.0.1, real Postgres + RLS, the kv_gov axis, migration 0240). GOV-2 Q1-A…Q5-A, lead-applied 2026-11-10 (the founder may reopen).
//
// brief_gov2a.md §C: "survey §7 red-today probes 1–7 (prove red at 3b57d55e in a detached worktree, removed) and the gov2a-decide list verbatim".
// The probes (P1–P7) build their fixtures INSIDE each test from the base schema only, so this file runs at 3b57d55e too: P1, P2, P3, P4, P6
// and P7 must be RED there (the defects) and GREEN here; P5 pins a truth GOV-2a does not change (F-7, the window and regions are not enforced
// at apply — B7, a later tenant wave) and is green in both.
// survey_gov2 §7, verbatim: "B1 drafts → 0 rows / NULL form / 404; B2f undeclared key absent, `personal` masked, a published version's
// `form_fields` immutable; B2 verify by A, approve by A → `GOV_DECIDER_IS_VERIFIER`, by the applicant → `GOV_DECIDER_IS_APPLICANT`, by B →
// approved with event + audit row in the organisation; reject without code or sentence → `GOV_REASON_REQUIRED`; another authority's application
// → the same 404; kv_gov direct UPDATE → 42501; the tenant `approve` → `SCHEME_DECISIONS_ARE_THE_AUTHORITYS`; B3 another authority's scheme →
// 404, no draft content, no operator id; RLS gate count asserted." (A missing CODE is named `GOV_REASON_CODE_REQUIRED`, a missing sentence
// `GOV_REASON_REQUIRED` — see the report.) Plus the brief's mutants' walls: the database's own refusals, probed directly (the API refuses first).
// No hour-of-day literal; runs under IST and UTC.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { RoleCacheService } from '../core/rbac/role-cache.service';
import { totpCodeAt } from '../modules/identity/domain/totp';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
/** The RLS gate after migrate + seeds at GOV-0 (1,993): 0240 drops one policy and recreates the same name — the count does not move. */
const RLS_POLICIES_AFTER_GOV2A = 1993;
const AMOUNT = 2471113; const AMOUNT_V1 = 1111113; const FEE = 39917;           // must never reach the gov realm (Q1-A)
const SENTENCE = 'The land record page is missing from the upload.';

run('PC-56 GOV-2a · the authority decides, on declared fields (integration, real AppModule over HTTP, the kv_gov axis)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let otp: OtpService; let roleCache: RoleCacheService;
  const X = randomUUID(); const Y = randomUUID();
  const AUTH1 = randomUUID(); const AUTH2 = randomUUID();
  const OP1 = randomUUID(); const OP2 = randomUUID();               // platform operators (drafted_by / published_by — never shown)
  const s = { s1: '', s2: '', s3: '', v1: '', v2: '', v3: '' };
  const a: Record<string, string> = {};
  const people: Record<string, { id: string; phone: string }> = {};
  const tok: Record<string, { accessToken: string; refreshToken: string }> = {};
  const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const user = async (k: string, name: string) => {
    const id = randomUUID(); const phone = phoneOf();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phone, name]);
    people[k] = { id, phone };
  };
  const handMembership = async (k: string, authorityId: string, roleCode: string) => admin.query(
    `INSERT INTO authority_memberships (authority_id, user_id, role_id, status, term_months, requested_by_admin_id, request_reason, approved_at, expires_at)
     SELECT $1, $2, r.id, 'active', 12, $3, 'fixture membership written by hand', now(), now() + interval '12 months' FROM roles r WHERE r.code = $4`,
    [authorityId, people[k].id, randomUUID(), roleCode]);
  const resetRates = async () => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const r of ['GovAuthController.otp', 'GovAuthController.verify', 'GovAuthController.verifyTwoFactor', 'GovAuthController.enrol', 'GovAuthController.confirm', 'GovApplicationsController.act'])
      for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1', 'unknown']) for (const x of [w - 1, w, w + 1]) await cache.del(`rl:${r}:ip:${ip}:${x}`);
  };
  const otpVerify = async (k: string) => {
    await resetRates();
    const { code } = await otp.issue(people[k].phone);
    return request(http).post('/v1/gov/auth/verify').send({ phone: people[k].phone, code });
  };
  const signIn = async (k: string) => {
    if (tok[k]) return;
    const r1 = await otpVerify(k);
    expect([r1.status, r1.body.error?.code]).toEqual([403, 'GOV_TWO_FACTOR_REQUIRED']);
    const enrolToken = r1.body.error.details.enrolToken as string;
    const en = await request(http).post('/v1/gov/auth/2fa/enrol').send({ enrolToken });
    const now = Date.now();
    expect((await request(http).post('/v1/gov/auth/2fa/confirm').send({ enrolToken, code: totpCodeAt(en.body.data.secret, now) })).status).toBe(201);
    const r2 = await otpVerify(k);
    const done = await request(http).post('/v1/gov/auth/2fa/verify').send({ challengeToken: r2.body.error.details.challengeToken, code: totpCodeAt(en.body.data.secret, now + 30_000) });
    expect(done.status).toBe(201);
    tok[k] = done.body.data;
  };
  const as = (k: string) => ({ authorization: `Bearer ${tok[k].accessToken}` });
  const act = async (k: string, id: string, body: Record<string, unknown>, key = randomUUID()) => {
    await resetRates();
    return request(http).post(`/v1/gov/applications/${id}/act`).set({ ...as(k), 'idempotency-key': key }).send(body);
  };
  const tenantTok = async (k: string, tenantId: string) => {
    await roleCache.invalidate(people[k].id, tenantId);
    const acc = await roleCache.effectiveAccess(people[k].id, tenantId);
    return { authorization: `Bearer ${mintToken(app, { userId: people[k].id, tenantId, perms: [...acc.permissions], roles: [...acc.roles] })}`, 'x-tenant-id': tenantId };
  };
  /** One application, written by the owner — base-schema columns only (so the probes run at 3b57d55e too). */
  const application = async (tenantId: string, schemeId: string, applicant: string, status: string, form: Record<string, unknown>, extra: { versionId?: string | null; assistedBy?: string } = {}) =>
    (await admin.query(
      `INSERT INTO scheme_applications (tenant_id, scheme_id, scheme_version, scheme_version_id, applicant_user_id, assisted_by, status, form_data, submitted_at)
       VALUES ($1, $2, 2, $3, $4, $5, $6::application_status, $7::jsonb, CASE WHEN $6 = 'draft' THEN NULL ELSE now() END) RETURNING id`,
      [tenantId, schemeId, extra.versionId ?? null, people[applicant].id, extra.assistedBy ? people[extra.assistedBy].id : null, status, JSON.stringify(form)])).rows[0].id as string;
  async function asRole<T>(role: 'kv_gov' | 'kv_app', gucs: Record<string, string>, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      for (const [k, v] of Object.entries(gucs)) await c.query(`SELECT set_config($1, $2, true)`, [k, v]);
      await c.query(`SET LOCAL ROLE ${role}`);
      return await fn(c);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET ROLE').catch(() => undefined); c.release(); }
  }
  async function asOwner<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try { await c.query('BEGIN'); return await fn(c); } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  /** 'ok' or the SQLSTATE plus the definer's / constraint's name. */
  const pgCode = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string; constraint?: string }) => {
    const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? '')); return `${e?.code ?? '?'}${m ? `:${m[1]}` : e?.constraint ? `:${e.constraint}` : ''}`;
  });
  const definer = (k: string, id: string, actName: string, code: string | null, note: string | null) => pgCode(asRole('kv_gov', { 'app.authority_id': AUTH1, 'app.user_id': people[k].id },
    (c) => c.query(`SELECT * FROM gov_application_act($1, $2, $3, $4)`, [id, actName, code, note])));
  const FORM = { cropName: 'groundnut', farmerName: 'Ramesh Canaryname', casteCertificateNo: 'SC-99887766', landAcres: 2.5,
    farmer_name: 'CANARY_FARMER_NAME', caste_certificate_no: 'CANARY_CASTE_NO', annual_income: 'CANARY_INCOME', village: 'CANARY_VILLAGE' };
  const UNDECLARED = ['farmer_name', 'caste_certificate_no', 'annual_income', 'village', 'CANARY_FARMER_NAME', 'CANARY_CASTE_NO', 'CANARY_INCOME', 'CANARY_VILLAGE', 'Ramesh', 'Canaryname', '99887766'];

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '500'; process.env.OTP_VERIFY_MAX_PER_HOUR = '500';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, X, 'Gov Two A FPO X'); await makeTenant(admin, Y, 'Gov Two A FPO Y');
    await admin.query(`INSERT INTO scheme_authorities (id, default_name, level) VALUES ($1, 'Gov Two A Test Authority One', 'state'), ($2, 'Gov Two A Test Authority Two', 'district')`, [AUTH1, AUTH2]);
    const category = (await admin.query(`SELECT category_id FROM schemes ORDER BY code LIMIT 1`)).rows[0].category_id;
    const suffix = randomUUID().replace(/-/g, '').slice(0, 10);
    const scheme = async (authorityId: string, code: string, name: string, window: unknown = null, regions: string[] = []) => (await admin.query(
      `INSERT INTO schemes (code, default_name, authority_id, category_id, benefit_summary, eligibility_rules, version, processing_fee_minor, application_window, applicable_region_ids)
       VALUES ($1, $2, $3, $4, $5::jsonb, '{"roles":["farmer"],"landholding_max_acres":5}'::jsonb, 2, $6, $7::jsonb, $8::jsonb) RETURNING id`,
      [code, name, authorityId, category, JSON.stringify({ type: 'dbt_annual', amount_minor: AMOUNT, instalments: 3 }), FEE, window === null ? null : JSON.stringify(window), JSON.stringify(regions)])).rows[0].id as string;
    s.s1 = await scheme(AUTH1, `gov2aa_${suffix}`, 'Gov Two A Scheme One');
    s.s2 = await scheme(AUTH2, `gov2ab_${suffix}`, 'Gov Two A Scheme Two');
    for (const [k, n] of [['H', 'Head H'], ['H2', 'Head H2'], ['O', 'Officer O'], ['Z', 'Officer Z'], ['F', 'Applicant F'], ['G', 'Legacy officer G'], ['M', 'Member M']] as const) await user(k, n);
    await handMembership('H', AUTH1, 'authority_head'); await handMembership('H2', AUTH1, 'authority_head');
    await handMembership('O', AUTH1, 'authority_officer'); await handMembership('Z', AUTH2, 'authority_officer');
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'farmer'`, [people.F.id, X]);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'tenant_admin'`, [people.M.id, X]);
    for (const key of ['gov_console', 'schemes']) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      if (b) backups.push(b);
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key]);
    }
    expect(backups.find((b) => b.key === 'gov_console')?.is_enabled).toBe(false);
    app = await bootstrapE2EApp(); await app.listen(0, '127.0.0.1'); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); otp = app.get<OtpService>(OTP_SERVICE); roleCache = app.get(RoleCacheService);
    for (const k of [...flagKeys('gov_console'), ...flagKeys('schemes')]) await cache.del(k);
  }, 180_000);

  afterAll(async () => {
    for (const b of backups) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = $4`, [b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {}), b.key]).catch(() => undefined);
    const ids = [s.s1, s.s2, s.s3].filter(Boolean);
    await admin?.query(`UPDATE scheme_applications SET deleted_at = now() WHERE scheme_id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids]).catch(() => undefined);
    await admin?.query(`UPDATE scheme_versions SET deleted_at = now() WHERE scheme_id = ANY($1::uuid[]) AND status = 'draft' AND deleted_at IS NULL`, [ids]).catch(() => undefined);
    await admin?.query(`UPDATE schemes SET is_active = false, deleted_at = now() WHERE id = ANY($1::uuid[])`, [ids]).catch(() => undefined);
    await admin?.query(`UPDATE scheme_authorities SET deleted_at = now() WHERE id = ANY($1::uuid[])`, [[AUTH1, AUTH2]]).catch(() => undefined);
    await admin?.query(`UPDATE user_tenant_roles SET is_active = false, deleted_at = now() WHERE user_id = ANY($1::uuid[])`, [Object.values(people).map((p) => p.id)]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 30_000);

  // ═══════════════════════════════════════════════ THE RED-TODAY PROBES (survey §7, 1–7) — base-schema fixtures only
  it('(P4) roles as data: scheme.process is held by the frozen tenant gov_officer only, by no live row; deciding is the authority head\'s alone', async () => {
    const holders = async (perm: string) => (await admin.query(`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = $1 ORDER BY 1`, [perm])).rows.map((x) => x.code);
    expect(await holders('scheme.process')).toEqual(['gov_officer']);
    expect(Number((await admin.query(`SELECT count(*)::int AS n FROM user_tenant_roles u JOIN roles r ON r.id = u.role_id WHERE r.code = 'gov_officer' AND u.is_active AND u.deleted_at IS NULL`)).rows[0].n)).toBe(0);
    expect(await holders('authority.applications.decide')).toEqual(['authority_head']);
    expect(await holders('authority.applications.verify')).toEqual(['authority_head', 'authority_officer']);
  });

  it('(P1) a farmer\'s DRAFT never reaches the authority: not listed, ?status=draft refused, opening → the same 404; the policy admits 0 rows; the form is NULL', async () => {
    await signIn('O');
    a.draft = await application(X, s.s1, 'F', 'draft', FORM);
    const list = await request(http).get('/v1/gov/applications?limit=100').set(as('O'));
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(a.draft);
    expect(list.body.data.filter((r: { status: string }) => r.status === 'draft')).toEqual([]);
    expect((await request(http).get('/v1/gov/applications?status=draft').set(as('O'))).status).toBe(422);   // the house's validation refusal
    const open = await request(http).get(`/v1/gov/applications/${a.draft}`).set(as('O'));
    expect([open.status, open.body.error?.code]).toEqual([404, 'GOV_APPLICATION_NOT_FOUND']);
    // THE WALL: kv_gov's policy itself admits no draft; the form function answers NULL
    expect(await asRole('kv_gov', { 'app.authority_id': AUTH1 }, async (c) => (await c.query(`SELECT count(*)::int AS n FROM scheme_applications WHERE id = $1`, [a.draft])).rows[0].n)).toBe(0);
    expect(await asRole('kv_gov', { 'app.authority_id': AUTH1 }, async (c) => (await c.query(`SELECT gov_application_form($1) AS f`, [a.draft])).rows[0].f)).toBeNull();
  });

  it('(P2) the name, caste certificate, income and village under undeclared keys never reach the official', async () => {
    a.p2 = await application(X, s.s1, 'F', 'submitted', FORM);
    const r = await request(http).get(`/v1/gov/applications/${a.p2}`).set(as('O'));
    expect(r.status).toBe(200);
    const body = JSON.stringify(r.body.data.form);
    for (const leak of UNDECLARED) expect([leak, body.includes(leak)]).toEqual([leak, false]);
  });

  it('(P3) a legacy active gov_officer (written by the owner) cannot verify or approve — not even their own application: refused by name ×2', async () => {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'gov_officer'`, [people.G.id, X]);
    try {
      a.p3 = await application(X, s.s1, 'G', 'submitted', { cropName: 'wheat' });
      const h = await tenantTok('G', X);
      const v = await request(http).post(`/v1/schemes/applications/${a.p3}/verify`).set(h).send({});
      expect([v.status, v.body.error?.code]).toEqual([403, 'SCHEME_DECISIONS_ARE_THE_AUTHORITYS']);
      await admin.query(`UPDATE scheme_applications SET status = 'under_verification' WHERE id = $1`, [a.p3]);
      const ap = await request(http).post(`/v1/schemes/applications/${a.p3}/approve`).set(h).send({});
      expect([ap.status, ap.body.error?.code]).toEqual([403, 'SCHEME_DECISIONS_ARE_THE_AUTHORITYS']);
      expect((await admin.query(`SELECT status::text AS s FROM scheme_applications WHERE id = $1`, [a.p3])).rows[0].s).toBe('under_verification');
    } finally {
      await admin.query(`UPDATE user_tenant_roles SET is_active = false, deleted_at = now() WHERE user_id = $1`, [people.G.id]);
    }
  });

  it('(P5) PIN — not GOV-2a\'s (F-7 → B7): applying to a scheme whose window has closed and whose regions exclude the farmer is still accepted', async () => {
    const md = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const day = 86_400_000; const now = Date.now();
    s.s3 = (await admin.query(`INSERT INTO schemes (code, default_name, authority_id, category_id, benefit_summary, eligibility_rules, application_window, applicable_region_ids)
      SELECT $1, 'Gov Two A Scheme Closed', $2, category_id, '{"type":"in_kind"}'::jsonb, '{}'::jsonb, $3::jsonb, $4::jsonb FROM schemes WHERE id = $5 RETURNING id`,
      [`gov2ac_${randomUUID().replace(/-/g, '').slice(0, 10)}`, AUTH1, JSON.stringify({ opens: md(new Date(now - 40 * day)), closes: md(new Date(now - 2 * day)) }), JSON.stringify([randomUUID()]), s.s1])).rows[0].id;
    const r = await request(http).post('/v1/schemes/applications').set({ ...(await tenantTok('F', X)), 'idempotency-key': randomUUID() }).send({ schemeId: s.s3, formData: { cropName: 'maize' } });
    expect([r.status, r.body.data?.status]).toEqual([201, 'draft']);
    a.p5 = r.body.data.id;
    expect((await admin.query(`SELECT eligibility_check FROM scheme_applications WHERE id = $1`, [a.p5])).rows[0].eligibility_check).toBeNull();
  });

  it('(P6) the eligibility record stays NULL through submitted → checked → approved by the authority (no AI checker writes it — C-4)', async () => {
    await signIn('H');
    a.p6 = await application(X, s.s1, 'F', 'submitted', { cropName: 'rice' });
    expect((await act('O', a.p6, { act: 'verify' })).status).toBe(201);
    expect((await act('H', a.p6, { act: 'approve' })).status).toBe(201);
    expect((await admin.query(`SELECT status::text AS s, eligibility_check FROM scheme_applications WHERE id = $1`, [a.p6])).rows[0]).toEqual({ s: 'approved', eligibility_check: null });
  });

  it('(P7) a rejection with {} is refused: the authority → GOV_REASON_CODE_REQUIRED; the organisation → SCHEME_DECISIONS_ARE_THE_AUTHORITYS', async () => {
    a.p7 = await application(X, s.s1, 'F', 'submitted', { cropName: 'jowar' });
    expect((await act('O', a.p7, { act: 'verify' })).status).toBe(201);
    const g = await act('H', a.p7, { act: 'reject' });
    expect([g.status, g.body.error?.code]).toEqual([422, 'GOV_REASON_CODE_REQUIRED']);
    const t = await request(http).post(`/v1/schemes/applications/${a.p7}/reject`).set(await tenantTok('M', X)).send({});
    expect([t.status, t.body.error?.code]).toEqual([403, 'SCHEME_DECISIONS_ARE_THE_AUTHORITYS']);
    expect((await admin.query(`SELECT status::text AS s, rejection_reason FROM scheme_applications WHERE id = $1`, [a.p7])).rows[0]).toEqual({ s: 'under_verification', rejection_reason: null });
  });

  // ═══════════════════════════════════════════════ gov2a-decide (0240 fixtures from here)
  it('(B2f) declared fields only, personal masked, undeclared absent; a version with none → [] and the API says so; a published list is frozen', async () => {
    const ver = async (n: number, status: string, fields: unknown, benefit: unknown, by: { d: string | null; p: string | null }, rules = '{"roles":["farmer"],"landholding_max_acres":5}') => (await admin.query(
      `INSERT INTO scheme_versions (scheme_id, version, status, benefit_summary, eligibility_rules, processing_fee_minor, change_reason, drafted_by, published_by, published_at, form_fields)
       VALUES ($1, $2, $3::scheme_version_status, $4::jsonb, $5::jsonb, $6, 'fixture version', $7, $8, CASE WHEN $3 = 'draft' THEN NULL ELSE now() - make_interval(days => 10 - $2) END, $9::jsonb) RETURNING id`,
      [s.s1, n, status, JSON.stringify(benefit), rules, FEE, by.d, by.p, JSON.stringify(fields)])).rows[0].id as string;
    const declared = [
      { key: 'cropName', label: 'Crop', kind: 'text', personal: false }, { key: 'farmerName', label: 'Name', kind: 'text', personal: true },
      { key: 'casteCertificateNo', label: 'Caste certificate', kind: 'text', personal: true }, { key: 'landAcres', label: 'Land (acres)', kind: 'number', personal: false },
    ];
    s.v1 = await ver(1, 'superseded', [], { type: 'dbt_annual', amount_minor: AMOUNT_V1, instalments: 2 }, { d: OP1, p: OP2 });
    s.v2 = await ver(2, 'published', declared, { type: 'dbt_annual', amount_minor: AMOUNT, instalments: 3 }, { d: OP1, p: OP2 });
    s.v3 = await ver(3, 'draft', [{ key: 'CANARYDRAFTFIELD', label: 'CANARYDRAFTLABEL', kind: 'text', personal: false }], { type: 'CANARYDRAFTTYPE', instalments: 9 }, { d: OP1, p: null }, '{"roles":["CANARYDRAFTROLE"]}');
    a.a1 = await application(X, s.s1, 'F', 'submitted', FORM, { versionId: s.v2 });
    a.a5 = await application(X, s.s1, 'F', 'submitted', FORM, { versionId: s.v1 });
    const r = await request(http).get(`/v1/gov/applications/${a.a1}`).set(as('O'));
    expect(r.status).toBe(200);
    expect(r.body.data.formDeclared).toBe(true);
    expect(r.body.data.form).toEqual([
      { key: 'cropName', label: 'Crop', kind: 'text', personal: false, value: 'groundnut' },
      { key: 'farmerName', label: 'Name', kind: 'text', personal: true, value: '••••••ame' },
      { key: 'casteCertificateNo', label: 'Caste certificate', kind: 'text', personal: true, value: '••••••766' },
      { key: 'landAcres', label: 'Land (acres)', kind: 'number', personal: false, value: 2.5 },
    ]);
    for (const leak of UNDECLARED) expect([leak, JSON.stringify(r.body).includes(leak)]).toEqual([leak, false]);
    const none = await request(http).get(`/v1/gov/applications/${a.a5}`).set(as('O'));
    expect([none.status, none.body.data.form, none.body.data.formDeclared]).toEqual([200, [], false]);
    // a PUBLISHED version's form_fields can never change (0105's trigger, replaced by 0240) — for the owner too; a draft's can
    expect(await pgCode(asOwner((c) => c.query(`UPDATE scheme_versions SET form_fields = '[]'::jsonb WHERE id = $1`, [s.v2])))).toBe('23514');
    expect(await pgCode(asOwner((c) => c.query(`UPDATE scheme_versions SET form_fields = '[]'::jsonb WHERE id = $1`, [s.v1])))).toBe('ok');   // superseded: '[]' → '[]' is no change
    expect(await pgCode(asOwner((c) => c.query(`UPDATE scheme_versions SET form_fields = '[{"key":"x","label":"X","kind":"text","personal":false}]'::jsonb WHERE id = $1`, [s.v1])))).toBe('23514');
    expect(await pgCode(asOwner((c) => c.query(`UPDATE scheme_versions SET form_fields = '[]'::jsonb WHERE id = $1`, [s.v3])))).toBe('ok');
    // the declared list's own rules (CHECK): a name not personal, a location, a duplicate key, an unknown kind
    // [lead QA, GOV-2a] caste, village and an identifier declared NOT personal are probed here too: a lead mutant dropping `caste` from
    // 0240's database rule passed this spec 18/18 while only a name was probed (the admin-api unit spec covers the app code, not the wall).
    for (const bad of [[{ key: 'farmerName', label: 'Name', kind: 'text', personal: false }], [{ key: 'farmLocation', label: 'Where', kind: 'text', personal: true }],
      [{ key: 'casteCertificateNo', label: 'Caste certificate', kind: 'text', personal: false }], [{ key: 'village', label: 'Village', kind: 'text', personal: false }],
      [{ key: 'aadhaarNo', label: 'Aadhaar', kind: 'text', personal: false }],
      [{ key: 'a', label: 'A', kind: 'text', personal: false }, { key: 'a', label: 'A', kind: 'text', personal: false }], [{ key: 'a', label: 'A', kind: 'file', personal: false }]])
      expect([JSON.stringify(bad), await pgCode(asOwner((c) => c.query(`UPDATE scheme_versions SET form_fields = $2::jsonb WHERE id = $1`, [s.v3, JSON.stringify(bad)])))])
        .toEqual([JSON.stringify(bad), '23514:ck_scheme_version_form_fields']);
  });

  it('(B2) verify by A, approve by A → GOV_DECIDER_IS_VERIFIER; an officer → GOV_PERMISSION_MISSING; by B → approved, with the event row, the organisation\'s audit row and the outbox event', async () => {
    await signIn('H2');
    a.a2 = await application(X, s.s1, 'F', 'submitted', FORM, { versionId: s.v2 });
    const v = await act('H', a.a2, { act: 'verify' });
    expect([v.status, v.body.data.status, v.body.data.from]).toEqual([201, 'under_verification', 'submitted']);
    const self = await act('H', a.a2, { act: 'approve' });
    expect([self.status, self.body.error?.code]).toEqual([403, 'GOV_DECIDER_IS_VERIFIER']);
    const off = await act('O', a.a2, { act: 'approve' });
    expect([off.status, off.body.error?.code]).toEqual([403, 'GOV_PERMISSION_MISSING']);
    const key = randomUUID();
    const ok = await act('H2', a.a2, { act: 'approve' }, key);
    expect([ok.status, ok.body.data.status, ok.body.data.recorded]).toEqual([201, 'approved', true]);
    // approval carries no amount: an `amount` in the body is refused, and none is in the response
    expect(JSON.stringify(ok.body)).not.toMatch(/amount|minor|₹/i);
    expect((await act('H2', a.a2, { act: 'approve', amountMinor: '100' })).status).toBe(422);
    // a retry with the same key writes nothing twice: the refusal order reads the facts BEFORE the key (E2, the GOV-0 precedent), so a retry
    // of a step already taken answers GOV_ACT_NOT_NOW rather than the stored answer (reported) — the events below stay at two
    const replay = await act('H2', a.a2, { act: 'approve' }, key);
    expect([replay.status, replay.body.error?.code]).toEqual([409, 'GOV_ACT_NOT_NOW']);
    const row = (await admin.query(`SELECT status::text AS s, verified_by, verified_realm, decided_by, decided_realm, decided_at IS NOT NULL AS dated FROM scheme_applications WHERE id = $1`, [a.a2])).rows[0];
    expect(row).toEqual({ s: 'approved', verified_by: people.H.id, verified_realm: 'gov', decided_by: people.H2.id, decided_realm: 'gov', dated: true });
    const events = (await admin.query(`SELECT from_status::text AS f, to_status::text AS t, actor_user_id AS who, actor_realm AS realm FROM scheme_application_events WHERE application_id = $1 ORDER BY created_at, to_status`, [a.a2])).rows;
    expect(events).toEqual([{ f: 'submitted', t: 'under_verification', who: people.H.id, realm: 'gov' }, { f: 'under_verification', t: 'approved', who: people.H2.id, realm: 'gov' }]);
    // the audit row is a TENANT row of the application's organisation — X reads it through RLS, Y does not
    const audit = (await admin.query(`SELECT tenant_id, actor_user_id, new_value FROM audit_log WHERE entity_id = $1 AND action = 'gov.application.approve'`, [a.a2])).rows;
    expect(audit.length).toBe(1);
    expect([audit[0].tenant_id, audit[0].actor_user_id, audit[0].new_value.realm, audit[0].new_value.authorityId]).toEqual([X, people.H2.id, 'gov', AUTH1]);
    const seenBy = (t: string) => asRole('kv_app', { 'app.tenant_id': t }, async (c) => (await c.query(`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action LIKE 'gov.application.%'`, [a.a2])).rows[0].n);
    expect([await seenBy(X), await seenBy(Y)]).toEqual([2, 0]);
    const outbox = (await admin.query(`SELECT tenant_id, event_type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY created_at, event_type`, [a.a2])).rows;
    expect(outbox.map((o) => [o.tenant_id, o.event_type, o.payload.realm])).toEqual([[X, 'schemes.application_verifying', 'gov'], [X, 'schemes.application_approved', 'gov']]);
  });

  it('(B2) by the applicant → GOV_DECIDER_IS_APPLICANT; by the assister → GOV_DECIDER_IS_ASSISTER; before any check → GOV_NOT_VERIFIED, then "complete checking"', async () => {
    a.a4 = await application(Y, s.s1, 'H2', 'submitted', { cropName: 'cotton' }, { versionId: s.v2 });
    expect((await act('O', a.a4, { act: 'verify' })).status).toBe(201);
    const own = await act('H2', a.a4, { act: 'approve' });
    expect([own.status, own.body.error?.code]).toEqual([403, 'GOV_DECIDER_IS_APPLICANT']);
    a.a3 = await application(X, s.s1, 'F', 'submitted', { cropName: 'bajra' }, { versionId: s.v2, assistedBy: 'H' });
    expect((await act('O', a.a3, { act: 'verify' })).status).toBe(201);
    const helped = await act('H', a.a3, { act: 'reject', reasonCode: 'documents_missing', note: SENTENCE });
    expect([helped.status, helped.body.error?.code]).toEqual([403, 'GOV_DECIDER_IS_ASSISTER']);
    a.a6 = await application(X, s.s1, 'F', 'under_verification', { cropName: 'tur' }, { versionId: s.v2 });   // moved there before 0240, no checker
    const early = await act('H', a.a6, { act: 'approve' });
    expect([early.status, early.body.error?.code]).toEqual([409, 'GOV_NOT_VERIFIED']);
    const done = await act('O', a.a6, { act: 'verify' });
    expect([done.status, done.body.data.status, done.body.data.from]).toEqual([201, 'under_verification', 'under_verification']);
    expect((await act('O', a.a6, { act: 'verify' })).body.error?.code).toBe('GOV_ACT_NOT_NOW');
  });

  it('(B2) reject without code or sentence is refused; with both → rejected, the code and the sentence stored; clarify needs a sentence', async () => {
    const noCode = await act('H2', a.a3, { act: 'reject', note: SENTENCE });
    expect([noCode.status, noCode.body.error?.code]).toEqual([422, 'GOV_REASON_CODE_REQUIRED']);
    const badCode = await act('H2', a.a3, { act: 'reject', reasonCode: 'because', note: SENTENCE });
    expect(badCode.body.error?.code).toBe('GOV_REASON_CODE_REQUIRED');
    const noSentence = await act('H2', a.a3, { act: 'reject', reasonCode: 'documents_missing' });
    expect([noSentence.status, noSentence.body.error?.code]).toEqual([422, 'GOV_REASON_REQUIRED']);
    const short = await act('H2', a.a3, { act: 'reject', reasonCode: 'documents_missing', note: 'too short' });
    expect(short.body.error?.code).toBe('GOV_REASON_REQUIRED');
    const ok = await act('H2', a.a3, { act: 'reject', reasonCode: 'documents_missing', note: SENTENCE });
    expect([ok.status, ok.body.data.status]).toEqual([201, 'rejected']);
    expect((await admin.query(`SELECT rejection_reason, rejection_reason_code, decided_by FROM scheme_applications WHERE id = $1`, [a.a3])).rows[0])
      .toEqual({ rejection_reason: SENTENCE, rejection_reason_code: 'documents_missing', decided_by: people.H2.id });
    a.a7 = await application(X, s.s1, 'F', 'submitted', { cropName: 'gram' }, { versionId: s.v2 });
    expect((await act('O', a.a7, { act: 'verify' })).status).toBe(201);
    expect((await act('O', a.a7, { act: 'clarify' })).body.error?.code).toBe('GOV_NOTE_REQUIRED');
    const cl = await act('O', a.a7, { act: 'clarify', note: 'Please upload the land record page again.' });
    expect([cl.status, cl.body.data.status]).toEqual([201, 'clarification_needed']);
    expect((await admin.query(`SELECT note FROM scheme_application_events WHERE application_id = $1 AND to_status = 'clarification_needed'`, [a.a7])).rows[0].note).toBe('Please upload the land record page again.');
  });

  it('(B2) another authority\'s application → the same 404 (act and open); a malformed id → the same 404; a gov token never acts on a tenant route', async () => {
    await signIn('Z');
    a.z1 = await application(X, s.s2, 'F', 'submitted', { cropName: 'ragi' });
    for (const id of [a.z1, randomUUID()]) {
      const r = await act('H', id, { act: 'verify' });
      expect([r.status, r.body.error?.code]).toEqual([404, 'GOV_APPLICATION_NOT_FOUND']);
      expect((await request(http).get(`/v1/gov/applications/${id}`).set(as('O'))).body.error?.code).toBe('GOV_APPLICATION_NOT_FOUND');
    }
    expect((await act('H', 'not-a-uuid', { act: 'verify' })).body.error?.code).toBe('GOV_APPLICATION_NOT_FOUND');
    expect((await act('Z', a.a7, { act: 'verify' })).body.error?.code).toBe('GOV_APPLICATION_NOT_FOUND');
    expect((await request(http).post(`/v1/schemes/applications/${a.z1}/verify`).set(as('H')).send({})).status).toBe(401);
    expect((await admin.query(`SELECT status::text AS s FROM scheme_applications WHERE id = $1`, [a.z1])).rows[0].s).toBe('submitted');
  });

  it('(B2) THE WALLS — kv_gov holds no UPDATE (42501); the DEFINER refuses the verifier / applicant / assister / officer / reasonless; the CHECKs refuse every caller', async () => {
    expect(await pgCode(asRole('kv_gov', { 'app.authority_id': AUTH1 }, (c) => c.query(`UPDATE scheme_applications SET status = 'approved' WHERE id = $1`, [a.a6])))).toBe('42501');
    for (const col of ['verified_by', 'decided_by', 'applicant_user_id', 'assisted_by'])
      expect([col, await pgCode(asRole('kv_gov', { 'app.authority_id': AUTH1 }, (c) => c.query(`SELECT ${col} FROM scheme_applications LIMIT 1`)))]).toEqual([col, '42501']);
    // a6: checked by O. a4: applicant H2, checked by O. a8: assisted by H, checked by O.
    a.a8 = await application(X, s.s1, 'F', 'submitted', { cropName: 'moong' }, { versionId: s.v2, assistedBy: 'H' });
    expect((await act('O', a.a8, { act: 'verify' })).status).toBe(201);
    expect(await definer('O', a.a6, 'approve', null, null)).toBe('23514:GOV_PERMISSION_MISSING');
    expect(await definer('O', a.a6, 'reject', 'other', SENTENCE)).toBe('23514:GOV_PERMISSION_MISSING');
    expect(await definer('H2', a.a4, 'approve', null, null)).toBe('23514:GOV_DECIDER_IS_APPLICANT');
    expect(await definer('H', a.a8, 'approve', null, null)).toBe('23514:GOV_DECIDER_IS_ASSISTER');
    expect(await definer('H', a.a8, 'reject', null, SENTENCE)).toBe('23514:GOV_REASON_CODE_REQUIRED');
    expect(await definer('H2', a.a8, 'reject', 'other', 'short')).toBe('23514:GOV_REASON_REQUIRED');
    expect(await definer('H2', a.a8, 'approve', 'other', null)).toBe('23514:GOV_REASON_CODE_ONLY_ON_REJECT');
    expect(await definer('H2', a.draft, 'verify', null, null)).toBe('23514:GOV_APPLICATION_NOT_FOUND');
    // a checker who later holds the decide permission still never decides what they checked (the definer, then the CHECK)
    a.a9 = await application(X, s.s1, 'F', 'submitted', { cropName: 'urad' }, { versionId: s.v2 });
    expect(await pgCode(asRole('kv_gov', { 'app.authority_id': AUTH1, 'app.user_id': people.H.id }, async (c) => {
      await c.query(`SELECT * FROM gov_application_act($1, 'verify', NULL, NULL)`, [a.a9]);
      return c.query(`SELECT * FROM gov_application_act($1, 'approve', NULL, NULL)`, [a.a9]);
    }))).toBe('23514:GOV_DECIDER_IS_VERIFIER');
    // the CHECKs hold for EVERY role, the owner included
    const owner = (sql: string, p: unknown[]) => pgCode(asOwner((c) => c.query(sql, p)));
    expect(await owner(`UPDATE scheme_applications SET decided_by = verified_by, decided_realm = 'gov' WHERE id = $1`, [a.a8])).toBe('23514:ck_sa_decider_not_verifier');
    expect(await owner(`UPDATE scheme_applications SET decided_by = assisted_by, decided_realm = 'gov' WHERE id = $1`, [a.a8])).toBe('23514:ck_sa_decider_not_assister');
    expect(await owner(`UPDATE scheme_applications SET decided_by = applicant_user_id, decided_realm = 'gov' WHERE id = $1`, [a.a8])).toBe('23514:ck_sa_decider_not_applicant');
    expect(await owner(`UPDATE scheme_applications SET decided_by = $2, decided_realm = 'gov' WHERE id = $1`, [a.a9, people.H2.id])).toBe('23514:ck_sa_decision_needs_verifier');
    expect(await owner(`UPDATE scheme_applications SET status = 'rejected', decided_by = $2, decided_realm = 'gov', rejection_reason_code = 'other' WHERE id = $1`, [a.a8, people.H2.id])).toBe('23514:ck_sa_gov_reject_reasoned');
  });

  it('(B4/B1) the scheme filter: one of the authority\'s schemes → only its rows; another authority\'s scheme → none; never a draft; (B5) no organisation name', async () => {
    const mine = await request(http).get(`/v1/gov/applications?schemeId=${s.s1}&limit=100`).set(as('O'));
    expect(mine.status).toBe(200);
    expect(new Set(mine.body.data.map((r: { scheme: { id: string } }) => r.scheme.id))).toEqual(new Set([s.s1]));
    expect(mine.body.data.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([a.a1, a.a2, a.a3, a.a4]));
    expect(mine.body.data.map((r: { id: string }) => r.id)).not.toContain(a.draft);
    const other = await request(http).get(`/v1/gov/applications?schemeId=${s.s2}`).set(as('O'));
    expect([other.status, other.body.data]).toEqual([200, []]);
    expect((await request(http).get(`/v1/gov/applications?schemeId=not-a-uuid`).set(as('O'))).status).toBe(422);
    const opened = await request(http).get(`/v1/gov/applications/${a.a1}`).set(as('O'));
    for (const body of [JSON.stringify(mine.body), JSON.stringify(opened.body)])
      for (const leak of ['Gov Two A FPO', 'organisationName', 'tenantName', 'legal_name', 'display_name']) expect([leak, body.includes(leak)]).toEqual([leak, false]);
  });

  it('(B3) the authority\'s own schemes: published fields only — no amount, no fee, no draft content, no operator id; another authority\'s scheme → the same 404', async () => {
    const list = await request(http).get('/v1/gov/schemes').set(as('O'));
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id).sort()).toEqual([s.s1, s.s3].sort());
    const one = await request(http).get(`/v1/gov/schemes/${s.s1}`).set(as('O'));
    expect(one.status).toBe(200);
    const d = one.body.data;
    expect([d.version, d.isActive, d.newerDraftExists, d.publishedBySecondPerson, d.isBackfilled, d.unrecordedBelow]).toEqual([2, true, true, true, false, null]);
    expect([d.published.benefitType, d.published.instalments, d.published.rules]).toEqual(['dbt_annual', 3, { roles: ['farmer'], landholding_max_acres: 5 }]);
    expect(d.published.formFields.map((f: { key: string }) => f.key)).toEqual(['cropName', 'farmerName', 'casteCertificateNo', 'landAcres']);
    const versions = await request(http).get(`/v1/gov/schemes/${s.s1}/versions`).set(as('O'));
    expect(versions.body.data.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[2, 'published'], [1, 'superseded']]);
    const diff = await request(http).get(`/v1/gov/schemes/${s.s1}/versions/2/diff`).set(as('O'));
    expect([diff.status, diff.body.data.comparedWith, diff.body.data.changes.map((c: { field: string }) => c.field)]).toEqual([200, 1, ['instalments', 'formFields']]);
    expect((await request(http).get(`/v1/gov/schemes/${s.s1}/versions/3/diff`).set(as('O'))).body.error?.code).toBe('GOV_SCHEME_VERSION_NOT_FOUND');
    // walk every body: no amount, no fee, no operator id, nothing of the open draft
    const bodies = JSON.stringify([list.body, one.body, versions.body, diff.body]);
    for (const leak of [String(AMOUNT), String(AMOUNT_V1), String(FEE), OP1, OP2, 'CANARYDRAFT', 'amount', 'Minor', 'processingFee', 'draftedBy', 'publishedBy"', s.v3])
      expect([leak, bodies.includes(leak)]).toEqual([leak, false]);
    // THE WALL ITSELF (builder's mutant 12 survived the HTTP walk — the repository maps `public` field by field, so a definer that returned an
    // amount never reached a response): what kv_gov can read straight from the DEFINERs carries no amount, no fee, no operator, no draft either
    const raw = await asRole('kv_gov', { 'app.authority_id': AUTH1 }, async (c) => JSON.stringify([
      (await c.query(`SELECT * FROM gov_scheme_read($1)`, [s.s1])).rows, (await c.query(`SELECT * FROM gov_scheme_read(NULL)`)).rows,
      (await c.query(`SELECT * FROM gov_scheme_versions($1)`, [s.s1])).rows, (await c.query(`SELECT * FROM gov_scheme_version_diff($1, 2)`, [s.s1])).rows]));
    for (const leak of [String(AMOUNT), String(AMOUNT_V1), String(FEE), OP1, OP2, 'CANARYDRAFT', 'amount', 'fee', s.v3]) expect([leak, raw.includes(leak)]).toEqual([leak, false]);
    for (const path of [`/v1/gov/schemes/${s.s2}`, `/v1/gov/schemes/${s.s2}/versions`, `/v1/gov/schemes/${s.s2}/versions/2/diff`, `/v1/gov/schemes/${randomUUID()}`, '/v1/gov/schemes/x']) {
      const r = await request(http).get(path).set(as('O'));
      expect([path, r.status, r.body.error?.code]).toEqual([path, 404, 'GOV_SCHEME_NOT_FOUND']);
    }
    // no write on a scheme exists in this realm
    for (const [m, p] of [['post', '/v1/gov/schemes'], ['post', `/v1/gov/schemes/${s.s1}/versions`], ['patch', `/v1/gov/schemes/${s.s1}`]] as const)
      expect([m, p, (await (request(http) as any)[m](p).set(as('H')).send({})).status]).toEqual([m, p, 404]);
  });

  it('(tenant) the organisation\'s verify / approve / reject / close → SCHEME_DECISIONS_ARE_THE_AUTHORITYS for every signed-in member; clarify keeps its permission', async () => {
    const h = await tenantTok('M', X);
    a.t1 = await application(X, s.s1, 'F', 'submitted', { cropName: 'til' });
    for (const [p, body] of [['verify', {}], ['approve', {}], ['reject', { reason: 'not eligible for this' }], ['close', {}]] as const) {
      const r = await request(http).post(`/v1/schemes/applications/${a.t1}/${p}`).set(h).send(body);
      expect([p, r.status, r.body.error?.code]).toEqual([p, 403, 'SCHEME_DECISIONS_ARE_THE_AUTHORITYS']);
    }
    expect((await request(http).post(`/v1/schemes/applications/${a.t1}/clarify`).set(h).send({ note: 'x' })).status).toBe(403);   // PERMISSION_DENIED (scheme.process)
    expect((await admin.query(`SELECT status::text AS s FROM scheme_applications WHERE id = $1`, [a.t1])).rows[0].s).toBe('submitted');
  });

  it('(RLS) the gate count does not move: 1,993 (one policy dropped and recreated by name, with the draft clause)', async () => {
    expect(Number((await admin.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`)).rows[0].n)).toBe(RLS_POLICIES_AFTER_GOV2A);
    const pol = (await admin.query(`SELECT roles::text AS r, cmd, qual FROM pg_policies WHERE policyname = 'gov_own_schemes_scheme_applications'`)).rows;
    expect(pol.length).toBe(1);
    expect([pol[0].r, pol[0].cmd, /status <> 'draft'/.test(pol[0].qual)]).toEqual(['{kv_gov}', 'SELECT', true]);
  });

  it('(flag) LAST — gov_console OFF → 404 on the act and the schemes read', async () => {
    await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'gov_console'`);
    for (const k of flagKeys('gov_console')) await cache.del(k);
    expect((await act('H2', a.a6, { act: 'approve' })).status).toBe(404);
    expect((await request(http).get('/v1/gov/schemes').set(as('O'))).status).toBe(404);
  });
});
