// apps/api/src/__tests__/tenant-swd-onboarding-governance.integration.spec.ts · PC-56 TENANT-SW-d — LIVE proof (real Postgres + RLS as kv_app,
// the 0200 triggers, the `tenants` wall, the jobs on a pool that LOGS IN as kv_relay, the admin realm on a pool that LOGS IN as kv_admin).
// Boots the REAL AppModule (as the HOTFIX-2 gate does) for the services and the full outbox registry; the object store is the only stand-in
// (an in-memory store — the platform's only adapter is S3 through presigned URLs, as 6e-2's spec says).
//   A  the `tenants` wall: kv_app cannot UPDATE another tenant's row nor its own status / risk_score, sees no other tenant, inserts only a
//      trial; the profile PATCH, the 13d brand sync and the slug / host reads still work; signup step 2: save-and-exit draft (owner-only),
//      resume lands on the step; the GSTIN state advisory is a CONFIRM (nothing written) and a matching one is silent; the display name is
//      read-only after a brand.
//   C  setup calls: one open per tenant; the event dispatched AS kv_relay through the full registry → the requester notified + the admin
//      realm's notice; the admin realm (kv_admin) schedules and closes; the tenant cannot schedule; µs paging.
//   D  the AGM pack: assembled from seeded facts with methods; surplus / costs / notice refused by name; issue needs a checker; the render
//      job issues it (PDF sha256 = the stored bytes = the media row); an issued pack is immutable (raw UPDATE refused); an addendum chains
//      to its parent; the verify read is public and figure-free; the dataset is a job on the 6e-2 plane (and becomes ready).
//   E  the register import: consent required; bad rows named by line; the proposer cannot confirm; apply writes source='import' rows
//      idempotently and skips duplicates; µs paging.
import 'reflect-metadata';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { Pool, PoolClient } from 'pg';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { OUTBOX_HANDLER_REGISTRY } from '../core/outbox/event-envelope';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { READ_REPLICA } from '../core/database/read-replica.provider';
import { OUTBOX_WRITER } from '../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE } from '../core/idempotency/idempotency.service';
import { METRICS } from '../core/observability/metrics';
import { AuditWriter } from '../core/audit/audit.writer';
import { AppConfig } from '../core/config/app-config';
import { PgPoolProvider } from '../core/database/pg-pool.provider';
import { OTP_SERVICE, OtpService } from '../core/auth/otp.service';
import { MediaService } from '../core/media/media-links.service';
import { MediaRepository } from '../core/media/media.repository';
import { ExportPlaneService } from '../core/exports-plane/export-plane.service';
import { ExportWorker } from '../core/exports-plane/export-worker';
import { ExportJobRepository } from '../core/exports-plane/export-job.repository';
import { DATASET_REGISTRY } from '../core/exports-plane/dataset.registry';
import { TenantSlugResolver } from '../core/tenancy-context/tenant-slug-resolver';
import { decodeKeyset, UUID_RE } from '../shared/pagination/us-keyset';
import { TenantSignupService } from '../modules/tenancy/services/tenant-signup.service';
import { TenantService } from '../modules/tenancy/services/tenant.service';
import { OnboardingService } from '../modules/tenancy/services/onboarding.service';
import { SetupCallService } from '../modules/tenancy/services/setup-call.service';
import { TenantBrandingRepository } from '../modules/tenancy/repositories/tenant-branding.repository';
import { AgmPackService } from '../modules/memberships/services/agm-pack.service';
import { AgmPackRepository } from '../modules/memberships/repositories/agm-pack.repository';
import { AgmPackRenderJob } from '../modules/memberships/jobs/agm-pack-render.job';
import { RegisterImportService } from '../modules/memberships/services/register-import.service';
import { RegisterImportRepository } from '../modules/memberships/repositories/register-import.repository';
import { RegisterImportApplyJob } from '../modules/memberships/jobs/register-import-apply.job';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const key = () => `idem-${randomUUID()}`;
const codeOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});

/** The stand-in object store: putObject / getObject (and the plane's stream pair) over a Map. */
class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  async putObject(k: string, body: Buffer): Promise<void> { this.objects.set(k, Buffer.from(body)); }
  async getObject(k: string): Promise<Buffer> { const b = this.objects.get(k); if (!b) throw new Error('S3 getObject failed (404)'); return b; }
  async putObjectStream(k: string, body: Readable, _ct: string, len: number): Promise<void> {
    const chunks: Buffer[] = []; for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const b = Buffer.concat(chunks); if (b.length !== len) throw new Error('length'); this.objects.set(k, b);
  }
  async getObjectStream(k: string): Promise<Readable> { return Readable.from([await this.getObject(k)]); }
}

run('PC-56 TENANT-SW-d · onboarding, setup calls, AGM pack, register import (integration, real Postgres + RLS + 0200)', () => {
  let app: INestApplication; let admin: Pool; let relayPool: Pool; let adminRealm: Pool; let uow: UnitOfWork; let pools: PgPoolProvider;
  let signup: TenantSignupService; let otp: OtpService; let tenantSvc: TenantService; let onboarding: OnboardingService; let setupCalls: SetupCallService;
  let agm: AgmPackService; let renderJob: AgmPackRenderJob; let imports: RegisterImportService; let applyJob: RegisterImportApplyJob; let worker: ExportWorker;
  const store = new MemoryStore();
  const flagBackup: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const permsOf = async (code: string) => new Set<string>((await admin.query(`SELECT rp.permission_code AS p FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [code])).rows.map((r) => r.p));
  const role = async (u: string, t: string, code: string) => admin.query(
    `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, approved_at) SELECT $1, $2, id, true, now() FROM roles WHERE code = $3`, [u, t, code]);
  const phoneOf = async (u: string) => (await admin.query(`SELECT phone FROM users WHERE id = $1`, [u])).rows[0].phone as string;
  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  /** As kv_app, in a tenant context, with app.user_id — what a request's unit of work is; rolled back. */
  async function asKvApp<T>(tenantId: string | null, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_app');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [tenantId ?? '', userId]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  /** Superuser history the API cannot write (triggers off for THIS transaction only). */
  async function history(fn: (c: PoolClient) => Promise<void>): Promise<void> {
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica'); await fn(c); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const allow = async (flag: string, tenantId: string) => {
    const row = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key=$1`, [flag])).rows[0];
    if (!row) return;
    if (!flagBackup.find((f) => f.key === flag)) flagBackup.push(row);
    const rules = row.is_enabled ? { ...(row.rules ?? {}), tenant_ids: [...((row.rules ?? {}).tenant_ids ?? []), tenantId] } : { tenant_ids: [tenantId] };
    await admin.query(`UPDATE feature_flags SET is_enabled=true, rollout_pct=$2, rules=$3::jsonb WHERE key=$1`, [flag, row.is_enabled ? row.rollout_pct : 0, JSON.stringify(rules)]);
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    await admin.query(`ALTER ROLE kv_admin WITH LOGIN PASSWORD 'dev'`);
    const as = (role: string) => { const u = new URL(APP_URL as string); u.username = role; u.password = 'dev'; return u.toString(); };
    relayPool = new Pool({ connectionString: process.env.RELAY_TEST_DATABASE_URL ?? as('kv_relay'), max: 2 });
    adminRealm = new Pool({ connectionString: as('kv_admin'), max: 2 });
    expect((await relayPool.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_relay');
    expect((await adminRealm.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_admin');

    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'swd-access-secret-swd-access-secret-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'swd-hash-pepper-swd-hash-pepper-32bb';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    process.env.OTP_RESEND_COOLDOWN_SEC = '0'; process.env.OTP_REQUEST_MAX_PER_HOUR = '100'; process.env.OTP_VERIFY_MAX_PER_HOUR = '100';
    process.env.TENANT_CONSOLE_BASE_URL = 'https://console.example.test';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../app.module') as typeof import('../app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    uow = app.get<UnitOfWork>(UNIT_OF_WORK); pools = app.get(PgPoolProvider);
    signup = app.get(TenantSignupService); otp = app.get<OtpService>(OTP_SERVICE); tenantSvc = app.get(TenantService);
    onboarding = app.get(OnboardingService); setupCalls = app.get(SetupCallService);
    // the object store is the one stand-in: a MediaService over the memory store, and the services that write media built on it
    const media = new MediaService(uow, app.get(METRICS), app.get(AppConfig), store as never, new MediaRepository(app.get(READ_REPLICA)));
    agm = new AgmPackService(uow, app.get(OUTBOX_WRITER), app.get(IDEMPOTENCY_SERVICE), app.get(AuditWriter), app.get(AgmPackRepository), media, app.get(ExportPlaneService), app.get(AppConfig), pools);
    renderJob = new AgmPackRenderJob(60_000, agm);
    imports = new RegisterImportService(uow, app.get(IDEMPOTENCY_SERVICE), app.get(AuditWriter), app.get(RegisterImportRepository), media);
    applyJob = new RegisterImportApplyJob(60_000, imports);
    worker = new ExportWorker(uow, app.get(OUTBOX_WRITER), app.get(READ_REPLICA), app.get(METRICS), app.get(DATASET_REGISTRY), store as never, app.get(ExportJobRepository));
  }, 180_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND aggregate_type IN ('setup_call_request','agm_pack','tenant','tenant_export_job') AND created_at >= now() - interval '1 hour'`).catch(() => undefined);
    for (const f of flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [f.key, f.is_enabled, f.rollout_pct, JSON.stringify(f.rules ?? {})]).catch(() => undefined);
    await app?.close().catch(() => undefined);
    await relayPool?.end().catch(() => undefined); await adminRealm?.end().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  /* ═══════════════════════════════════════ A · THE `tenants` WALL + SIGNUP STEP 2 ═══════════════════════════════════════ */
  describe('A · the tenants wall, the profile step, the advisory, the brand lock', () => {
    const A = randomUUID(); const B = randomUUID(); let u = '';
    beforeAll(async () => { await makeTenant(admin, A, 'Wall A'); await makeTenant(admin, B, 'Wall B'); u = await makeUser(admin); await role(u, A, 'tenant_admin'); });

    it('A1 · the grants: kv_app holds no UPDATE on status / risk_score / slug / plan columns, holds it on the profile columns; RLS is enabled + forced; kv_relay keeps SELECT only', async () => {
      const col = async (c: string) => (await admin.query(`SELECT has_column_privilege('kv_app','tenants',$1,'UPDATE') AS v`, [c])).rows[0].v as boolean;
      for (const c of ['status', 'risk_score', 'slug', 'tenant_type_id', 'country_code', 'approved_at', 'onboarded_by', 'deleted_at', 'created_at']) expect(`${c}:${await col(c)}`).toBe(`${c}:false`);
      for (const c of ['legal_name', 'display_name', 'region_id', 'gstin', 'pan', 'cin_or_reg_no', 'fssai_license', 'owner_name', 'owner_phone', 'owner_email', 'logo_url', 'onboarding_step', 'profile_completed_at', 'updated_at'])
        expect(`${c}:${await col(c)}`).toBe(`${c}:true`);
      expect(await q1(`SELECT relrowsecurity AS r, relforcerowsecurity AS f FROM pg_class WHERE relname='tenants'`)).toEqual({ r: true, f: true });
      expect(await q1(`SELECT has_table_privilege('kv_relay','tenants','SELECT') s, has_table_privilege('kv_relay','tenants','UPDATE') u, has_table_privilege('kv_app','tenants','DELETE') d`)).toEqual({ s: true, u: false, d: false });
    });

    it('A2 · kv_app cannot UPDATE its OWN status or risk_score (42501), and cannot touch or even see ANOTHER tenant\'s row', async () => {
      expect(await codeOf(asKvApp(A, u, (c) => c.query(`UPDATE tenants SET status = 'active' WHERE id = $1`, [A])))).toBe('42501');
      expect(await codeOf(asKvApp(A, u, (c) => c.query(`UPDATE tenants SET risk_score = 0 WHERE id = $1`, [A])))).toBe('42501');
      expect(await asKvApp(A, u, async (c) => (await c.query(`UPDATE tenants SET legal_name = 'Hijacked' WHERE id = $1`, [B])).rowCount)).toBe(0);
      expect(await asKvApp(A, u, async (c) => (await c.query(`SELECT id FROM tenants WHERE id = $1`, [B])).rowCount)).toBe(0);
      expect(await asKvApp(A, u, async (c) => (await c.query(`SELECT count(*)::int AS n FROM tenants`)).rows[0].n)).toBe(1);   // its own row only
      expect(await asKvApp(null, u, async (c) => (await c.query(`SELECT count(*)::int AS n FROM tenants`)).rows[0].n)).toBe(0);   // no context, no rows
      expect((await q1(`SELECT legal_name FROM tenants WHERE id = $1`, [B])).legal_name).toBe('Wall B');
      // the request tier inserts a TRIAL only (and only under the new row's own context)
      const X = randomUUID();
      const ins = (status: string, ctx: string) => asKvApp(ctx, u, (c) => c.query(
        `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status) SELECT $1, $2, 'X', 'X', lv.id, 'IN', $3::tenant_status FROM lookup_values lv WHERE lv.type_code='tenant_type' AND lv.code='fpo' AND lv.tenant_id IS NULL ORDER BY lv.created_at LIMIT 1`,
        [X, 'x' + X.replace(/-/g, '').slice(0, 12), status]));
      expect(await codeOf(ins('active', X))).toBe('TENANT_INSERT_TRIAL_ONLY');
      expect(await codeOf(ins('trial', A))).toBe('42501');            // a row for an id that is not the context: the RLS WITH CHECK refuses it
      expect(await codeOf(ins('trial', X))).toBe('ok');
    });

    it('A3 · every legitimate kv_app path still works: the profile PATCH, the 13d brand sync, the slug / id / branding reads (definer functions)', async () => {
      const out = await tenantSvc.updateProfile(A, { userId: u, canManage: true }, key(), { ownerEmail: 'office@walla.example' }, null);
      expect(out.ownerEmail).toBe('office@walla.example');
      await uow.run(A, (tx) => app.get(TenantBrandingRepository).syncTenantTx(tx, A, 'Wall A Mandi', null), { userId: u });
      expect((await q1(`SELECT display_name FROM tenants WHERE id = $1`, [A])).display_name).toBe('Wall A Mandi');
      const slug = (await q1(`SELECT slug FROM tenants WHERE id = $1`, [A])).slug as string;
      const r = new TenantSlugResolver(pools);
      expect(await r.resolve(slug)).toBe(A);
      expect(await r.resolveId(A)).toBe(A);
      expect((await r.getBranding(A))?.displayName).toBe('Wall A Mandi');
      expect(await r.resolve('no-such-slug-swd')).toBeNull();
    });

    describe('signup step 2', () => {
      let phone = ''; let T = ''; let owner = ''; let other = ''; const junagadh = '11111111-0000-7000-8000-000000000101';
      const actorOf = (userId: string) => ({ userId, canManage: true });
      beforeAll(async () => {
        phone = `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
        const orgType = (await q1(`SELECT id FROM lookup_values WHERE type_code='tenant_type' AND code='fpo' AND tenant_id IS NULL`)).id as string;
        const { code } = await otp.issue(phone);
        const res = await signup.signUp({ phone, code, fullName: 'Kavita Ben', orgName: `Shakti SHG ${randomUUID().slice(0, 6)}`, orgTypeId: orgType, lang: 'gu' }, '203.0.113.9');
        T = res.tenantId; expect(res.resumed).toBe(false); expect(res.onboardingStep).toBe('profile');
        owner = (await q1(`SELECT id FROM users WHERE phone = $1`, [phone])).id;
        other = await makeUser(admin); await role(other, T, 'tenant_admin');
      }, 60_000);

      it('A4 · the step is open after signup; SAVE & EXIT keeps a server draft (owner only); a resume by OTP lands on the saved step with the draft', async () => {
        const s0 = await onboarding.state(T, actorOf(owner));
        expect(s0).toMatchObject({ step: 'profile', draft: null, browserStore: 'refused' });
        expect(s0.districts.find((d) => d.id === junagadh)).toMatchObject({ stateName: 'Gujarat', stateGstCode: '24' });
        const saved = await onboarding.saveDraft(T, actorOf(owner), { legalName: 'Shakti SHG Federation', regionId: junagadh, pan: 'AABCU9603R', bogus: 'dropped' });
        expect(saved.fields.sort()).toEqual(['legalName', 'pan', 'regionId']);
        expect(new Date(saved.expiresAt).getTime() - new Date(saved.savedAt).getTime()).toBe(30 * 86_400_000);
        // the resume: the same phone signs up again → resumed, and told where it stopped
        const { code } = await otp.issue(phone);
        const again = await signup.signUp({ phone, code, fullName: 'Kavita Ben', orgName: 'Anything', orgTypeId: (await q1(`SELECT id FROM lookup_values WHERE type_code='tenant_type' AND code='fpo' AND tenant_id IS NULL`)).id }, null);
        expect(again).toMatchObject({ resumed: true, tenantId: T, onboardingStep: 'profile' });
        const s1 = await onboarding.state(T, actorOf(owner));
        expect(s1.draft?.payload).toEqual({ legalName: 'Shakti SHG Federation', regionId: junagadh, pan: 'AABCU9603R' });
        // owner-only: another administrator learns a draft exists, never what it says, and cannot overwrite it (0200's trigger)
        const s2 = await onboarding.state(T, actorOf(other));
        expect(s2).toMatchObject({ draft: null, draftOwnedByOther: true });
        expect(await codeOf(onboarding.saveDraft(T, actorOf(other), { legalName: 'Other' }))).toBe('ONBOARDING_DRAFT_OWNER_ONLY');
        expect(await codeOf(asKvApp(T, other, (c) => c.query(`DELETE FROM tenant_onboarding_drafts WHERE tenant_id = $1`, [T])))).toBe('ONBOARDING_DRAFT_OWNER_ONLY');
      });

      it('A5 · the GSTIN state advisory is a CONFIRM (nothing written), and the confirmed save completes the step and clears the draft', async () => {
        const body = { legalName: 'Shakti SHG Federation', displayName: 'Shakti SHG', regionId: junagadh, gstin: '27AAPFU0939F1ZV', pan: 'AABCU9603R' };
        const first = await onboarding.saveProfile(T, actorOf(owner), key(), body, null);
        expect(first).toMatchObject({ status: 'needs_confirm', saved: false, advisory: { kind: 'confirm', gstCode: '27', gstStateName: 'Maharashtra', districtStateName: 'Gujarat', districtStateCode: '24' } });
        expect(await q1(`SELECT gstin, onboarding_step FROM tenants WHERE id = $1`, [T])).toEqual({ gstin: null, onboarding_step: 'profile' });
        const done = await onboarding.saveProfile(T, actorOf(owner), key(), { ...body, confirmGstState: true }, null);
        expect(done).toMatchObject({ status: 'saved', saved: true });
        expect(await q1(`SELECT gstin, legal_name, region_id::text AS r, onboarding_step, profile_completed_at IS NOT NULL AS c FROM tenants WHERE id = $1`, [T]))
          .toEqual({ gstin: '27AAPFU0939F1ZV', legal_name: 'Shakti SHG Federation', r: junagadh, onboarding_step: 'done', c: true });
        expect(await n(`SELECT count(*) n FROM tenant_onboarding_drafts WHERE tenant_id = $1`, [T])).toBe(0);
        expect((await q1(`SELECT new_value FROM audit_log WHERE tenant_id = $1 AND action = 'tenancy.onboarding_profile_completed' ORDER BY created_at DESC LIMIT 1`, [T])).new_value)
          .toMatchObject({ gstStateAdvisory: 'confirm', gstStateConfirmed: true, onboardingStep: 'done' });
        expect(await codeOf(onboarding.saveProfile(T, actorOf(owner), key(), body, null))).toBe('ONBOARDING_ALREADY_DONE');
      });

      it('A6 · a MATCHING GSTIN is silent; a missing district is named; the display name is read-only once a brand is published', async () => {
        const M = randomUUID(); await makeTenant(admin, M, 'Match FPO'); await admin.query(`UPDATE tenants SET onboarding_step = 'profile' WHERE id = $1`, [M]);
        const mu = await makeUser(admin); await role(mu, M, 'tenant_admin');
        expect(await codeOf(onboarding.saveProfile(M, actorOf(mu), key(), { legalName: 'Match FPO', displayName: 'Match', regionId: null }, null))).toBe('ONBOARDING_REQUIRED_MISSING');
        const ok = await onboarding.saveProfile(M, actorOf(mu), key(), { legalName: 'Match FPO', displayName: 'Match', regionId: junagadh, gstin: '24AABCU9603R1Z5' }, null);
        expect(ok).toMatchObject({ status: 'saved', advisory: { kind: 'silent' } });
        // a published brand owns the name members see
        const Bt = randomUUID(); await makeTenant(admin, Bt, 'Brand FPO'); await admin.query(`UPDATE tenants SET onboarding_step = 'profile' WHERE id = $1`, [Bt]);
        const bu = await makeUser(admin); const bu2 = await makeUser(admin); await role(bu, Bt, 'tenant_admin');
        await history(async (c) => { await c.query(
          `INSERT INTO tenant_branding (tenant_id, display_name, app_short_name, primary_color, accent_color, ink_color, surface_color, status, version, published_at, published_by, checker_user_id)
           VALUES ($1, 'Brand FPO', 'Brand', '#112233', '#445566', '#000000', '#ffffff', 'published', 1, now(), $2, $3)`, [Bt, bu, bu2]); });
        const st = await onboarding.state(Bt, actorOf(bu));
        expect(st.displayNameLocked).toBe(true);
        expect(await codeOf(onboarding.saveProfile(Bt, actorOf(bu), key(), { legalName: 'Brand FPO Ltd', displayName: 'Another Name', regionId: junagadh }, null))).toBe('TENANT_NAME_IS_BRAND');
        expect(await onboarding.saveProfile(Bt, actorOf(bu), key(), { legalName: 'Brand FPO Ltd', regionId: junagadh }, null)).toMatchObject({ status: 'saved' });
        expect((await q1(`SELECT display_name, legal_name FROM tenants WHERE id = $1`, [Bt]))).toEqual({ display_name: 'Brand FPO', legal_name: 'Brand FPO Ltd' });
      });
    });
  });

  /* ═══════════════════════════════════════ C · SETUP CALLS ═══════════════════════════════════════ */
  describe('C · setup calls', () => {
    const S = randomUUID(); let su = ''; let reqId = '';
    beforeAll(async () => { await makeTenant(admin, S, 'Setup FPO'); su = await makeUser(admin); await role(su, S, 'tenant_admin'); });
    const slot = (days: number, h = 10) => { const d = new Date(Date.now() + days * 86_400_000); d.setUTCHours(h - 5, 30 - 30, 0, 0); return d; };

    it('C1 · one open request per tenant (service AND index); last four digits only; the slot rules named', async () => {
      expect(await codeOf(setupCalls.request(S, { userId: su, canManage: true }, key(), { slotStart: new Date(Date.now() - 3_600_000), slotEnd: new Date(), languageCode: 'gu' }, null))).toBe('SETUP_CALL_SLOT_INVALID');
      expect(await codeOf(setupCalls.request(S, { userId: su, canManage: false }, key(), { slotStart: slot(2), slotEnd: slot(2, 11), languageCode: 'gu' }, null))).toBe('SETUP_CALL_RESTRICTED');
      const v = await setupCalls.request(S, { userId: su, canManage: true }, key(), { slotStart: slot(2), slotEnd: slot(2, 11), languageCode: 'gu', notes: 'Please call after milk collection' }, null);
      reqId = v.id;
      expect(v).toMatchObject({ status: 'requested', languageCode: 'gu', zone: 'Asia/Kolkata', teamNotified: false });
      expect(v.phoneMasked).toBe(`••••${(await phoneOf(su)).slice(-4)}`);
      expect(await codeOf(setupCalls.request(S, { userId: su, canManage: true }, key(), { slotStart: slot(3), slotEnd: slot(3, 11), languageCode: 'en' }, null))).toBe('SETUP_CALL_ALREADY_OPEN');
      // the index is the second wall: a raw second open row is refused by the database
      expect(await codeOf(asKvApp(S, su, (c) => c.query(`INSERT INTO setup_call_requests (tenant_id, requested_by, preferred_slot_start, preferred_slot_end, language_code, phone_masked)
        VALUES ($1, $2, now() + interval '1 day', now() + interval '1 day 1 hour', 'en', '••••1111')`, [S, su])))).toBe('23505');
      // no raw phone anywhere on the row
      const row = await q1(`SELECT * FROM setup_call_requests WHERE id = $1`, [reqId]);
      expect(JSON.stringify(row)).not.toContain((await phoneOf(su)).slice(-10));
      // the tenant cannot schedule (trigger: admin realm only)
      expect(await codeOf(asKvApp(S, su, (c) => c.query(`UPDATE setup_call_requests SET status = 'scheduled', scheduled_at = now(), handled_by = $2 WHERE id = $1`, [reqId, su])))).toBe('42501');
    });

    it('C2 · the event is dispatched AS kv_relay through the FULL registry: the requester is notified (en/hi/gu template) and the admin realm gets its notice', async () => {
      const ev = (await admin.query(`SELECT id FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'tenancy.setup_call_requested' AND status = 'pending'`, [reqId])).rows;
      expect(ev).toHaveLength(1);
      const full = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY);
      expect(full.handlersFor('tenancy.setup_call_requested').length).toBeGreaterThanOrEqual(2);   // the notice + the notification fan-out (+ realtime / webhooks)
      const out = await new OutboxDispatcher(relayPool, full, { inc: () => undefined, observe: () => undefined } as never).relayById(String(ev[0].id));
      expect(out.status).toBe('published');
      expect(await n(`SELECT count(*) n FROM platform_ops_notices WHERE kind = 'setup_call_requested' AND ref_id = $1 AND tenant_id = $2`, [reqId, S])).toBe(1);
      expect(await n(`SELECT count(*) n FROM notifications WHERE user_id = $1 AND event_code = 'tenant.setup_call_requested'`, [su])).toBeGreaterThan(0);
      expect((await q1(`SELECT summary FROM platform_ops_notices WHERE ref_id = $1`, [reqId])).summary).toMatchObject({ language: 'gu', phoneMasked: expect.stringMatching(/^••••\d{4}$/) });
      // redelivery adds nothing
      await admin.query(`UPDATE outbox_events SET status = 'pending', published_at = NULL WHERE id = $1`, [ev[0].id]);
      await new OutboxDispatcher(relayPool, full, { inc: () => undefined, observe: () => undefined } as never).relayById(String(ev[0].id));
      expect(await n(`SELECT count(*) n FROM platform_ops_notices WHERE ref_id = $1`, [reqId])).toBe(1);
    });

    it('C3 · the admin realm (logged in as kv_admin) lists the queue masked, reads the case (audited), schedules and closes it; the tenant may then ask again', async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SetupCallsOpsService } = require('../../../admin-api/src/modules/setup-calls-ops/setup-calls-ops.service');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AdminAuditWriter } = require('../../../admin-api/src/core/audit/admin-audit.writer');
      const pool = { query: (t: string, p?: unknown[]) => adminRealm.query(t, p as never[]), withTx: async (fn: (c: PoolClient) => Promise<unknown>) => {
        const c = await adminRealm.connect(); try { await c.query('BEGIN'); const o = await fn(c); await c.query('COMMIT'); return o; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } } };
      const ops = new SetupCallsOpsService(pool, new AdminAuditWriter(pool));
      const staff = { userId: randomUUID(), roles: ['platform_tenant_ops'], ip: '10.0.0.9', requestId: 'swd' };
      const list = await ops.list({ status: 'requested', limit: 100 });
      const mine = list.items.find((x: { id: string }) => x.id === reqId);
      expect(mine).toMatchObject({ tenantId: S, phoneMasked: expect.stringMatching(/^••••\d{4}$/) });
      expect(JSON.stringify(list.items)).not.toContain((await phoneOf(su)).slice(-10));
      expect((await ops.notices()).some((x: { refId: string }) => x.refId === reqId)).toBe(true);
      expect((await ops.get(staff, reqId)).phone).toBe(await phoneOf(su));
      await ops.schedule(staff, reqId, { scheduledAt: slot(2).toISOString() });
      expect(await q1(`SELECT status, handled_by::text AS h FROM setup_call_requests WHERE id = $1`, [reqId])).toEqual({ status: 'scheduled', h: staff.userId });
      expect(await n(`SELECT count(*) n FROM platform_ops_notices WHERE ref_id = $1 AND acknowledged_at IS NOT NULL`, [reqId])).toBe(1);
      await ops.done(staff, reqId, { outcomeNote: 'Walked through listings and KYC' });
      expect((await q1(`SELECT status FROM setup_call_requests WHERE id = $1`, [reqId])).status).toBe('done');
      // closed is closed
      await expect(ops.done(staff, reqId, { outcomeNote: 'again' })).rejects.toBeTruthy();
      // the tenant may ask again now; its list pages on the µs keyset
      const second = await setupCalls.request(S, { userId: su, canManage: true }, key(), { slotStart: slot(4), slotEnd: slot(4, 11), languageCode: 'hi' }, null);
      await setupCalls.cancel(S, { userId: su, canManage: true }, second.id, 'Found the help article', null);
      const third = await setupCalls.request(S, { userId: su, canManage: true }, key(), { slotStart: slot(5), slotEnd: slot(5, 11), languageCode: 'en' }, null);
      const p1 = await setupCalls.list(S, { userId: su, canManage: true }, undefined, 2);
      const p2 = await setupCalls.list(S, { userId: su, canManage: true }, decodeKeyset(p1.nextCursor, UUID_RE), 2);
      expect(p1.items.map((x) => x.id)).toEqual([third.id, second.id]);
      expect(p2.items.map((x) => x.id)).toEqual([reqId]);
      expect(p2.nextCursor).toBeNull();
    });
  });

  /* ═══════════════════════════════════════ D · THE AGM PACK ═══════════════════════════════════════ */
  describe('D · the AGM pack from facts', () => {
    const G = randomUUID(); let a1 = ''; let a2 = ''; let m1 = ''; let m2 = ''; let buyer = ''; let packId = ''; let addId = '';
    // The facts below are written raw (as superuser) to date them inside a past FY. They are taken out again afterwards so the shared
    // platform accounts, the whole-database ledger invariants (7d-money) and the exports plane's global queue / ETA history (6e-2) are
    // exactly as the next suite expects — a fixture must not become another suite's ledger.
    const madeTxns: string[] = []; const madeAccounts: string[] = [];
    afterAll(async () => {
      const c = await admin.connect();
      try {
        await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`);   // past ledger_entries_append_only, for the fixture only
        await c.query(`DELETE FROM ledger_entries WHERE txn_id = ANY($1::uuid[])`, [madeTxns]);
        await c.query(`DELETE FROM ledger_transactions WHERE id = ANY($1::uuid[])`, [madeTxns]);
        await c.query(`DELETE FROM wallet_accounts a WHERE a.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.account_id = a.id)`, [madeAccounts]);
        await c.query(`DELETE FROM tenant_export_downloads WHERE job_id IN (SELECT id FROM tenant_export_jobs WHERE tenant_id = $1)`, [G]);
        await c.query(`DELETE FROM tenant_export_jobs WHERE tenant_id = $1`, [G]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
    });
    let adminPerms = new Set<string>();
    const actor = (userId: string) => ({ userId, permissions: adminPerms, ip: '203.0.113.5' });
    const at = (iso: string) => iso;   // a fixed instant inside FY 2025-26 (2025-04-01 → 2026-03-31, IST)
    beforeAll(async () => {
      await makeTenant(admin, G, 'Anand FPO'); adminPerms = await permsOf('tenant_admin');
      expect(adminPerms.has('governance.agm.issue')).toBe(true);
      [a1, a2, m1, m2, buyer] = [await makeUser(admin), await makeUser(admin), await makeUser(admin), await makeUser(admin), await makeUser(admin)];
      await role(a1, G, 'tenant_admin'); await role(a2, G, 'tenant_admin'); await role(m1, G, 'farmer'); await role(m2, G, 'farmer'); await role(buyer, G, 'customer');
      await allow('tenant_exports', G);
      const ord = async (subtotal: number, status: string, completedAt: string | null) => {
        const id = (await q1(`SELECT uuid_generate_v7() AS id`)).id as string;
        await admin.query(`INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, delivery_fee_minor, platform_fee_minor, total_minor, status, version, created_at, completed_at)
          VALUES ($1, $2, $3, $4, $5, 'direct', 'INR', $6, 0, 0, $6, $7, 1, uuid_v7_time($1), $8)`, [id, G, `SWD-${id.slice(0, 12)}`, buyer, m1, subtotal, status, completedAt]);
        return id;
      };
      const o1 = await ord(400000, 'completed', at('2025-06-10T06:00:00Z')); const o2 = await ord(100000, 'completed', at('2025-12-01T06:00:00Z'));
      await ord(70000, 'completed', at('2026-05-01T06:00:00Z'));   // next FY: excluded
      await ord(55000, 'cancelled', at('2025-07-01T06:00:00Z'));   // not completed: excluded
      // the ledger, as the settlement leaves it (escrow → member Main + platform fees + GST + the cooperative's commission), dated in the FY
      const acct = async (kind: string, code: string, owner: string | null) => {
        const col = kind === 'user' ? 'owner_user_id' : kind === 'tenant' ? 'owner_tenant_id' : null;
        const ex = (await admin.query(`SELECT id FROM wallet_accounts WHERE owner_kind = $1 AND account_code = $2 AND currency_code = 'INR' ${col ? `AND ${col} = $3` : 'AND shard_no = 0'}`, col ? [kind, code, owner] : [kind, code])).rows[0];
        if (ex) return ex.id as string;
        const id = (await admin.query(`INSERT INTO wallet_accounts (owner_kind, ${col ?? 'shard_no'}, account_code, currency_code) VALUES ($1, $2, $3, 'INR') RETURNING id`, [kind, col ? owner : 0, code])).rows[0].id as string;
        madeAccounts.push(id);
        return id;
      };
      const [escrow, fees, gst] = [await acct('platform', 'escrow', null), await acct('platform', 'fees', null), await acct('platform', 'gst_payable', null)];
      const tcomm = await acct('tenant', 'commission', G); const m1Main = await acct('user', 'main', m1); const m2Main = await acct('user', 'main', m2); const bMain = await acct('user', 'main', buyer);
      const txn = async (k: string, refType: string, refId: string, when: string, legs: Array<[string, number]>) => {
        const t = (await admin.query(`INSERT INTO ledger_transactions (txn_type_id, tenant_id, reference_type, reference_id, idempotency_key, created_at)
          SELECT lv.id, $1, $2, $3, $4, $5 FROM lookup_values lv WHERE lv.type_code = 'ledger_txn_type' AND lv.code = 'escrow_release' AND lv.tenant_id IS NULL ORDER BY lv.created_at LIMIT 1 RETURNING id`,
          [G, refType, refId, `${k}-${randomUUID()}`, when])).rows[0].id;
        madeTxns.push(t);
        for (const [a, amt] of legs) await admin.query(`INSERT INTO ledger_entries (txn_id, account_id, tenant_id, amount_minor, currency_code, balance_after_minor, entry_hash, created_at) VALUES ($1, $2, $3, $4, 'INR', 0, $5, $6)`,
          [t, a, G, amt, createHash('sha256').update(`${t}${a}${amt}`).digest('hex'), when]);
      };
      await txn('settle', 'order', o1, '2025-06-11T06:00:00Z', [[escrow, -400000], [m1Main, 360000], [fees, 20000], [gst, 3600], [tcomm, 16400]]);
      await txn('settle', 'order', o2, '2025-12-02T06:00:00Z', [[escrow, -100000], [m2Main, 90000], [fees, 5000], [gst, 900], [tcomm, 4100]]);
      await txn('dispute-clawback', 'dispute', randomUUID(), '2026-01-15T06:00:00Z', [[m1Main, -10000], [escrow, 10000]]);
      await txn('settle', 'order', randomUUID(), '2025-08-01T06:00:00Z', [[escrow, -5000], [bMain, 5000]]);            // a non-member: not "paid to members"
      await txn('settle', 'order', randomUUID(), '2026-06-01T06:00:00Z', [[escrow, -7000], [m2Main, 7000]]);           // next FY: excluded
      // a statement, the register (unchanged since FY end), a resolution closed in the FY
      await admin.query(`INSERT INTO settlement_statements (tenant_id, seller_user_id, statement_no, period_start, period_end, gross_minor, commission_minor, tax_minor, net_minor)
        VALUES ($1, $2, $3, '2025-09-01', '2025-09-30', 400000, 20000, 3600, 360000)`, [G, m1, `ST-${randomUUID().slice(0, 8)}`]);
      await admin.query(`INSERT INTO coop_share_registers (tenant_id, member_user_id, shares_held, share_value_minor, created_at, updated_at) VALUES ($1, $2, 10, 100000, '2025-01-01', '2025-01-01'), ($1, $3, 5, 50000, '2025-02-01', '2025-02-01')`, [G, m1, m2]);
      await history(async (c) => { await c.query(
        `INSERT INTO coop_resolutions (tenant_id, title, resolution_type, status, outcome, closed_at, closed_by, close_reason, eligible_at_close, quorum_bp, pass_num, pass_den, pass_strict, majority, created_at)
         VALUES ($1, 'Dividend for FY 2024-25', 'dividend', 'closed', 'passed', '2025-08-01T06:00:00Z', $2, 'voting_window_ended', 2, 3300, 1, 2, true, 'ordinary', '2025-07-01T06:00:00Z')`, [G, a1]); });
    }, 120_000);

    it('D1 · the draft is assembled from the FACTS with a method on every row; surplus / costs / notice refused by name and carry no figure; a FY not ended is refused', async () => {
      expect(await codeOf(agm.draft(G, actor(a1), key(), { fyStartYear: new Date().getUTCFullYear(), secondLanguage: 'gu' }))).toBe('AGM_FY_NOT_ENDED');
      const v = await agm.draft(G, actor(a1), key(), { fyStartYear: 2025, secondLanguage: 'gu' });
      packId = v.id;
      expect(v).toMatchObject({ status: 'draft', fiscalYearLabel: 'FY 2025-26', fyStart: '2025-04-01', fyEnd: '2026-03-31', fyBasisSource: 'country_default', zone: 'Asia/Kolkata', qr: 'refused' });
      const row = (item: string) => v.sections.find((s) => s.item === item)!;
      expect(row('gmv')).toMatchObject({ status: 'included', figures: { currency: 'INR', goodsMinor: '500000', orders: 2 } });
      expect(row('paid_to_members')).toMatchObject({ status: 'included', figures: { netMinor: '440000', creditsMinor: '450000', clawbacksMinor: '-10000', members: 2 } });
      expect(row('paid_share')).toMatchObject({ status: 'included', figures: { bp: 8800, percent: '88.00%', paidMinor: '440000', gmvMinor: '500000' } });
      expect(row('platform_fees').figures).toMatchObject({ netMinor: '25000' });
      expect(row('gst_on_commission').figures).toMatchObject({ netMinor: '4500' });
      expect(row('tenant_commission').figures).toMatchObject({ netMinor: '20500' });
      for (const item of ['surplus', 'operating_costs']) expect(row(item)).toMatchObject({ status: 'refused', refusalCode: 'NO_COST_LEDGER', figures: {} });
      expect(row('notice_period')).toMatchObject({ status: 'refused', refusalCode: 'NO_NOTICE_SETTING', figures: {} });
      expect(row('annexure')).toMatchObject({ status: 'refused', refusalCode: 'NOT_UPLOADED' });
      expect(row('statements').figures).toMatchObject({ statements: 1, members: 1, link: '/settlements/statements' });
      expect(row('snapshot')).toMatchObject({ status: 'included', figures: { holders: 2, totalShares: 15, paidUpMinor: '150000' } });
      expect(row('closed_in_fy').figures).toMatchObject({ count: 1, passed: 1 });
      expect(row('quorum').figures).toMatchObject({ quorumBp: 3300, source: 'platform_default' });
      for (const s of v.sections) expect(s.method.length).toBeGreaterThan(20);
      // THE DB WALL UNDER IT: a refused row with a figure, or an included row without one, is refused by 0200's CHECK
      expect(await codeOf(asKvApp(G, a1, (c) => c.query(`INSERT INTO agm_pack_sections (tenant_id, pack_id, section_code, item_code, status, method, refusal_code, figures)
        VALUES ($1, $2, 'income_expenditure', 'surplus_typed', 'refused', 'a typed surplus with a figure', 'NO_COST_LEDGER', '{"amountMinor":"1184000"}')`, [G, packId])))).toBe('23514');
    });

    it('D2 · the annexure is a file the cooperative uploaded; issuing needs a CHECKER: the maker cannot confirm (service path AND raw UPDATE), a second admin can', async () => {
      const mediaId = (await q1(`INSERT INTO media_assets (tenant_id, uploader_user_id, kind, s3_key, mime_type, bytes, sha256, scan_status) VALUES ($1, $2, 'document', $3, 'application/pdf', 1234, $4, 'clean') RETURNING id`,
        [G, a1, `t/${G}/document/${randomUUID()}.pdf`, 'ab'.repeat(32)])).id as string;
      expect(await codeOf(agm.attachAnnexure(G, actor(a1), packId, randomUUID()))).toBe('AGM_ANNEXURE_NOT_FOUND');
      const v = await agm.attachAnnexure(G, actor(a1), packId, mediaId);
      expect(v.sections.find((s) => s.item === 'annexure')).toMatchObject({ status: 'included', figures: { mediaId, label: 'uploaded by the cooperative — not produced by the platform' } });
      await agm.requestIssue(G, actor(a1), packId, key());
      expect(await codeOf(agm.confirm(G, actor(a1), packId, key()))).toBe('AGM_CHECKER_IS_MAKER');
      expect(await codeOf(asKvApp(G, a1, (c) => c.query(`UPDATE agm_packs SET status = 'issuing', confirmed_by = $2, confirmed_at = now() WHERE id = $1`, [packId, a1])))).toBe('AGM_CHECKER_IS_MAKER');
      // a frozen pack's sections cannot be re-assembled
      expect(await codeOf(agm.reassemble(G, actor(a1), packId))).toBe('AGM_PACK_IMMUTABLE');
      expect((await agm.confirm(G, actor(a2), packId, key())).status).toBe('issuing');
    });

    it('D3 · the render job (kv_relay sweep → kv_app UoW) issues it: document id, PDF sha256 = the stored bytes = the media row, content sha256, the dataset on the plane', async () => {
      const out = await renderJob.sweep(relayPool, [G]);
      expect(out).toMatchObject({ tenants: 1, issued: 1, failed: 0 });
      const p = (await app.get(AgmPackRepository).get(G, packId))!;
      const slug = (await q1(`SELECT slug FROM tenants WHERE id = $1`, [G])).slug as string;
      expect(p).toMatchObject({ status: 'issued', documentId: `AGM-${slug.toUpperCase()}-FY2025-26-1` });
      expect(p.pdfSha256).toMatch(/^[0-9a-f]{64}$/); expect(p.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      const m = await q1(`SELECT s3_key, sha256, mime_type, scan_status FROM media_assets WHERE id = $1`, [p.pdfMediaId]);
      expect(m).toMatchObject({ sha256: p.pdfSha256, mime_type: 'application/pdf', scan_status: 'clean' });
      const bytes = store.objects.get(m.s3_key)!;
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.pdfSha256);
      const text = bytes.toString('latin1');
      expect(text).toContain(p.documentId); expect(text).toContain(`console.example.test/verify/agm/${p.documentId}`); expect(text).toContain(p.contentSha256);
      expect(text).toContain('REFUSED - FPO surplus [NO_COST_LEDGER]'); expect(text).toContain('Verification QR: not printed');
      expect(text).toContain('Gujarati: this PDF writer cannot draw Gujarati script');
      // the dataset: queued on the 6e-2 plane in the same act (W2473), then generated by the plane's worker (W2474)
      expect(p.exportJobId).toMatch(UUID_RE);
      expect(await q1(`SELECT dataset_code, status, params->>'packId' AS pack FROM tenant_export_jobs WHERE id = $1`, [p.exportJobId])).toEqual({ dataset_code: 'governance.agm_pack', status: 'queued', pack: packId });
      expect(await worker.generate({ id: p.exportJobId!, tenantId: G })).toBe('ready');
      expect(await q1(`SELECT status, row_count FROM tenant_export_jobs WHERE id = $1`, [p.exportJobId])).toEqual({ status: 'ready', row_count: p ? (await n(`SELECT count(*) n FROM agm_pack_sections WHERE pack_id = $1`, [packId])) : 0 });
      // a second sweep issues nothing more
      expect(await renderJob.sweep(relayPool, [G])).toMatchObject({ issued: 0, failed: 0 });
    });

    it('D4 · an ISSUED pack is immutable: a raw kv_app UPDATE of any column (and of its sections) is refused; withdrawal refused', async () => {
      // `reason` is not even granted to kv_app (42501 — the privilege wall); every granted column meets the trigger
      expect(await codeOf(asKvApp(G, a1, (c) => c.query(`UPDATE agm_packs SET reason = 'edited' WHERE id = $1`, [packId])))).toBe('42501');
      for (const set of [`pdf_sha256 = repeat('0', 64)`, `content_sha256 = repeat('0', 64)`, `status = 'draft'`, `document_id = 'AGM-X-FY2025-26-1'`, `auditor_media_id = NULL`, `export_job_id = NULL`, `issued_at = now()`]) {
        expect(`${set} → ${await codeOf(asKvApp(G, a1, (c) => c.query(`UPDATE agm_packs SET ${set} WHERE id = $1`, [packId])))}`).toBe(`${set} → AGM_PACK_IMMUTABLE`);
      }
      expect(await codeOf(asKvApp(G, a1, (c) => c.query(`DELETE FROM agm_pack_sections WHERE pack_id = $1`, [packId])))).toBe('AGM_PACK_IMMUTABLE');
      expect(await codeOf(asKvApp(G, a1, (c) => c.query(`DELETE FROM agm_packs WHERE id = $1`, [packId])))).toMatch(/42501|AGM_PACK_APPEND_ONLY/);
      expect(await codeOf(agm.withdraw(G, actor(a1), packId, key(), 'we changed our mind about it'))).toBe('AGM_PACK_BAD_MOVE');
    });

    it('D5 · a correction is an ADDENDUM chained to the issued parent (number + 1, a reason); it issues under a checker and supersedes the parent; the chain is linear', async () => {
      // a draft cannot be the parent; an addendum needs a reason
      const D2 = await agm.draft(G, actor(a1), key(), { fyStartYear: 2024, secondLanguage: 'hi' });
      expect(await codeOf(agm.addendum(G, actor(a2), key(), D2.id, { reason: 'Correcting the share register figure' }))).toBe('AGM_PARENT_NOT_ISSUED');
      expect(await codeOf(agm.addendum(G, actor(a2), key(), packId, { reason: 'short' }))).toBe('REASON_REQUIRED');
      const add = await agm.addendum(G, actor(a2), key(), packId, { reason: 'The auditor revised the annexure after the AGM notice' });
      addId = add.id;
      expect(add).toMatchObject({ status: 'draft', parentPackId: packId, addendumNo: 1, fiscalYearLabel: 'FY 2025-26' });
      expect(await codeOf(agm.addendum(G, actor(a1), key(), packId, { reason: 'A second open correction of the same pack' }))).toBe('AGM_PACK_EXISTS');
      await agm.requestIssue(G, actor(a2), addId, key());
      await agm.confirm(G, actor(a1), addId, key());
      expect(await renderJob.sweep(relayPool, [G])).toMatchObject({ issued: 1, failed: 0 });
      const parent = (await app.get(AgmPackRepository).get(G, packId))!; const child = (await app.get(AgmPackRepository).get(G, addId))!;
      expect(parent.supersededBy).toBe(addId);
      expect(child.documentId).toBe(parent.documentId!.replace(/-1$/, '-2'));
      expect(store.objects.get((await q1(`SELECT s3_key FROM media_assets WHERE id = $1`, [child.pdfMediaId])).s3_key)!.toString('latin1')).toContain(`ADDENDUM 1 to ${parent.documentId}`);
      // superseded once: a second set refused; a new addendum must correct the latest one
      expect(await codeOf(asKvApp(G, a1, (c) => c.query(`UPDATE agm_packs SET superseded_by = $2 WHERE id = $1`, [packId, D2.id])))).toBe('AGM_PACK_IMMUTABLE');
      expect(await codeOf(agm.addendum(G, actor(a2), key(), packId, { reason: 'Correcting the parent again, not the latest' }))).toBe('AGM_PARENT_SUPERSEDED');
    });

    it('D6 · the verify read is PUBLIC (no tenant context) and FIGURE-FREE: issue time, FY, the two sha256s, the addendum chain', async () => {
      const parent = (await app.get(AgmPackRepository).get(G, packId))!; const child = (await app.get(AgmPackRepository).get(G, addId))!;
      const v = await agm.verify(parent.documentId!);
      expect(Object.keys(v).sort()).toEqual(['addendumNo', 'contentSha256', 'documentId', 'fiscalYearLabel', 'issuedAt', 'organisation', 'parentDocumentId', 'pdfSha256', 'supersededByDocumentId']);
      expect(v).toMatchObject({ documentId: parent.documentId, fiscalYearLabel: 'FY 2025-26', pdfSha256: parent.pdfSha256, addendumNo: 0, parentDocumentId: null, supersededByDocumentId: child.documentId });
      expect(JSON.stringify(v)).not.toMatch(/500000|440000|88\.00/);
      expect(await agm.verify(child.documentId!)).toMatchObject({ addendumNo: 1, parentDocumentId: parent.documentId });
      expect(await codeOf(agm.verify('AGM-NOPE-FY2025-26-1'))).toBe('AGM_VERIFY_NOT_FOUND');
      // the definer function is the only way in without a context: kv_app with NO tenant sees no agm_packs row directly
      expect(await asKvApp(null, a1, async (c) => (await c.query(`SELECT count(*)::int AS n FROM agm_packs`)).rows[0].n)).toBe(0);
      expect(await asKvApp(null, a1, async (c) => (await c.query(`SELECT count(*)::int AS n FROM public_agm_pack_verify($1)`, [parent.documentId])).rows[0].n)).toBe(1);
    });

    it('D7 · the register extract is REFUSED BY NAME when a year-end row changed afterwards (no history to rebuild it), and a lone administrator cannot ask to issue', async () => {
      const H = randomUUID(); await makeTenant(admin, H, 'Changed FPO');
      const h1 = await makeUser(admin); const hm = await makeUser(admin); await role(h1, H, 'tenant_admin'); await role(hm, H, 'farmer');
      await admin.query(`INSERT INTO coop_share_registers (tenant_id, member_user_id, shares_held, share_value_minor, created_at, updated_at) VALUES ($1, $2, 4, 40000, '2025-01-01', '2026-06-01')`, [H, hm]);
      const v = await agm.draft(H, actor(h1), key(), { fyStartYear: 2025, secondLanguage: 'hi' });
      expect(v.sections.find((s) => s.item === 'snapshot')).toMatchObject({ status: 'refused', refusalCode: 'REGISTER_CHANGED_AFTER_FY_END', figures: {} });
      expect(v.sections.find((s) => s.item === 'paid_share')).toMatchObject({ status: 'refused', refusalCode: 'NO_GMV' });
      expect(await codeOf(agm.requestIssue(H, actor(h1), v.id, key()))).toBe('NEEDS_SECOND_ADMIN');
      // µs paging over the packs
      const p1 = await agm.overview(G, actor(a1), undefined, 2);
      const p2 = await agm.overview(G, actor(a1), decodeKeyset(p1.nextCursor, UUID_RE), 2);
      expect(new Set([...p1.items, ...p2.items].map((x) => x.id)).size).toBe(3);
      expect(p1.fyBasis).toEqual({ startMonth: 4, source: 'country_default' });
      expect(p1.endedYears.map((y) => y.label)).toContain('FY 2025-26');
    });
  });

  /* ═══════════════════════════════════════ E · THE REGISTER IMPORT ═══════════════════════════════════════ */
  describe('E · the share-register import under a checker', () => {
    const R = randomUUID(); let a1 = ''; let a2 = ''; const m: string[] = []; let consent = ''; let impId = ''; let perms = new Set<string>();
    const actor = (userId: string) => ({ userId, permissions: perms, ip: '203.0.113.6' });
    const local = async (u: string) => (await phoneOf(u)).replace('+91', '');
    beforeAll(async () => {
      await makeTenant(admin, R, 'Register FPO'); perms = await permsOf('tenant_admin');
      a1 = await makeUser(admin); a2 = await makeUser(admin); await role(a1, R, 'tenant_admin'); await role(a2, R, 'tenant_admin');
      for (let i = 0; i < 4; i++) { m.push(await makeUser(admin)); await role(m[i], R, 'farmer'); }
      await admin.query(`INSERT INTO coop_share_registers (tenant_id, member_user_id, shares_held, share_value_minor, folio) VALUES ($1, $2, 3, 30000, 'F-001')`, [R, m[0]]);
      consent = (await q1(`INSERT INTO media_assets (tenant_id, uploader_user_id, kind, s3_key, mime_type, bytes, sha256, scan_status) VALUES ($1, $2, 'document', $3, 'application/pdf', 900, $4, 'clean') RETURNING id`,
        [R, a1, `t/${R}/document/${randomUUID()}.pdf`, 'cd'.repeat(32)])).id;
    });

    it('E1 · consent evidence is REQUIRED (service, NOT NULL, and the trigger); the columns are named; an empty file is refused', async () => {
      const csv = `phone,folio,shares,paid_up\n${await local(m[1])},F-101,10,1000.00\n`;
      expect(await codeOf(imports.upload(R, actor(a1), key(), { csv, consentMediaId: randomUUID(), consentKind: 'board_resolution' }))).toBe('IMPORT_CONSENT_REQUIRED');
      expect(await codeOf(asKvApp(R, a1, (c) => c.query(`INSERT INTO share_register_imports (tenant_id, uploaded_by, file_media_id, file_sha256, consent_media_id, consent_kind) VALUES ($1, $2, $3, $4, $5, 'attestation')`,
        [R, a1, consent, 'ef'.repeat(32), randomUUID()])))).toMatch(/IMPORT_CONSENT_REQUIRED|23503/);
      expect(await codeOf(asKvApp(R, a1, (c) => c.query(`INSERT INTO share_register_imports (tenant_id, uploaded_by, file_media_id, file_sha256, consent_kind) VALUES ($1, $2, $3, $4, 'attestation')`,
        [R, a1, consent, 'ef'.repeat(32)])))).toMatch(/IMPORT_CONSENT_REQUIRED|23502/);
      expect(await codeOf(imports.upload(R, actor(a1), key(), { csv: 'phone,folio,shares\n1,2,3\n', consentMediaId: consent, consentKind: 'board_resolution' }))).toBe('IMPORT_COLUMNS_MISSING');
      expect(await codeOf(imports.upload(R, actor(a1), key(), { csv: 'phone,folio,shares,paid_up\n', consentMediaId: consent, consentKind: 'board_resolution' }))).toBe('IMPORT_FILE_EMPTY');
    });

    it('E2 · every line judged and named by its line: valid · PHONE_INVALID · MEMBER_NOT_FOUND · ALREADY_ON_REGISTER (skipped) · SHARES_INVALID · DUPLICATE_IN_FILE · FOLIO_TAKEN; no raw phone stored', async () => {
      const csv = [
        'phone,folio,shares,paid_up',
        `${await local(m[1])},f-101,10,1000.00`,                 // 2 valid (folio upper-cased; ₹1,000.00 = 100000 paise)
        'abc,F-102,3,30',                                       // 3 PHONE_INVALID
        '9000000001,F-103,3,30',                                // 4 MEMBER_NOT_FOUND
        `${await local(m[0])},F-104,3,30`,                      // 5 already on the register → skipped
        `${await local(m[2])},F-105,x,30`,                      // 6 SHARES_INVALID
        `+91${await local(m[1])},F-106,1,10`,                   // 7 DUPLICATE_IN_FILE (same member as line 2)
        `${await local(m[3])},F-001,2,20`,                      // 8 FOLIO_TAKEN (m0 holds F-001)
        `0${await local(m[2])},F-107,5,500.5`,                  // 9 valid (STD zero; ₹500.50)
      ].join('\n');
      const v = await imports.upload(R, actor(a1), key(), { csv, consentMediaId: consent, consentKind: 'board_resolution' });
      impId = v.id;
      expect(v).toMatchObject({ status: 'validated', rowCount: 8, validCount: 2, errorCount: 5, duplicateCount: 1, consentKind: 'board_resolution' });
      const lines = (await imports.lines(R, actor(a1), impId, 0, 100)).items;
      expect(lines.map((l) => [l.lineNo, l.status, l.errorCode])).toEqual([
        [2, 'valid', null], [3, 'error', 'PHONE_INVALID'], [4, 'error', 'MEMBER_NOT_FOUND'], [5, 'skipped_duplicate', 'ALREADY_ON_REGISTER'],
        [6, 'error', 'SHARES_INVALID'], [7, 'error', 'DUPLICATE_IN_FILE'], [8, 'error', 'FOLIO_TAKEN'], [9, 'valid', null]]);
      expect(lines.find((l) => l.lineNo === 9)).toMatchObject({ paidUpMinor: '50050', shares: 5, folio: 'F-107' });
      const raw = JSON.stringify((await admin.query(`SELECT raw FROM share_register_import_rows WHERE import_id = $1`, [impId])).rows);
      for (const u of m) expect(raw).not.toContain((await phoneOf(u)).slice(-10));
      // the file is kept as evidence, with its digest
      expect(await q1(`SELECT sha256 = $2 AS ok FROM media_assets WHERE id = (SELECT file_media_id FROM share_register_imports WHERE id = $1)`, [impId, v.fileSha256])).toEqual({ ok: true });
    });

    it('E3 · the proposer CANNOT confirm (service path AND raw UPDATE — the trigger); a second administrator confirms; a raw import row with an unconfirmed batch is refused', async () => {
      await imports.propose(R, actor(a1), impId, key(), 'Board resolution 12/2025 adopted the paper register');
      expect(await codeOf(imports.confirm(R, actor(a1), impId, key()))).toBe('IMPORT_CHECKER_IS_MAKER');
      expect(await codeOf(asKvApp(R, a1, (c) => c.query(`UPDATE share_register_imports SET status = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE id = $1`, [impId, a1])))).toBe('IMPORT_CHECKER_IS_MAKER');
      const batch = (await q1(`SELECT batch_id FROM share_register_imports WHERE id = $1`, [impId])).batch_id;
      expect(await codeOf(asKvApp(R, a1, (c) => c.query(`INSERT INTO coop_share_registers (tenant_id, member_user_id, shares_held, share_value_minor, source, import_batch_id) VALUES ($1, $2, 1, 10, 'import', $3)`,
        [R, m[3], batch])))).toBe('IMPORT_NOT_CONFIRMED');
      expect((await imports.confirm(R, actor(a2), impId, key())).status).toBe('confirmed');
    });

    it('E4 · the apply job (kv_relay sweep → kv_app UoW) writes source=import rows; re-applying adds nothing; a second import of the same members is skipped', async () => {
      expect(await applyJob.sweep(relayPool, [R])).toMatchObject({ tenants: 1, imports: 1, rows: 2, failed: 0 });
      const batch = (await q1(`SELECT batch_id, status, applied_count FROM share_register_imports WHERE id = $1`, [impId]));
      expect(batch).toMatchObject({ status: 'applied', applied_count: 2 });
      const rows = (await admin.query(`SELECT member_user_id::text AS u, folio, shares_held, share_value_minor::text AS v, source, import_batch_id::text AS b FROM coop_share_registers WHERE tenant_id = $1 AND source = 'import' ORDER BY folio`, [R])).rows;
      expect(rows).toEqual([
        { u: m[1], folio: 'F-101', shares_held: 10, v: '100000', source: 'import', b: batch.batch_id },
        { u: m[2], folio: 'F-107', shares_held: 5, v: '50050', source: 'import', b: batch.batch_id }]);
      expect(await applyJob.sweep(relayPool, [R])).toMatchObject({ imports: 0, rows: 0 });
      expect(await n(`SELECT count(*) n FROM coop_share_registers WHERE tenant_id = $1`, [R])).toBe(3);
      // provenance is final
      expect(await codeOf(asKvApp(R, a1, (c) => c.query(`UPDATE coop_share_registers SET source = 'manual', import_batch_id = NULL WHERE tenant_id = $1 AND member_user_id = $2`, [R, m[1]])))).toBe('IMPORT_PROVENANCE_FINAL');
      // a second file with the same members: validated as skipped, applied as nothing
      const v2 = await imports.upload(R, actor(a2), key(), { csv: `phone,folio,shares,paid_up\n${await local(m[1])},F-201,99,9900\n${await local(m[3])},F-202,1,10\n`, consentMediaId: consent, consentKind: 'attestation' });
      expect(v2).toMatchObject({ validCount: 1, duplicateCount: 1 });
      await imports.propose(R, actor(a2), v2.id, key(), 'Adding the late member from the paper book');
      await imports.confirm(R, actor(a1), v2.id, key());
      expect(await applyJob.sweep(relayPool, [R])).toMatchObject({ imports: 1, rows: 1 });
      expect((await q1(`SELECT shares_held FROM coop_share_registers WHERE tenant_id = $1 AND member_user_id = $2`, [R, m[1]])).shares_held).toBe(10);   // untouched
      // µs paging over imports; reject is a closed state
      const p1 = await imports.list(R, actor(a1), undefined, 1);
      const p2 = await imports.list(R, actor(a1), decodeKeyset(p1.nextCursor, UUID_RE), 1);
      expect(p1.items[0].id).toBe(v2.id); expect(p2.items[0].id).toBe(impId);
      expect(await codeOf(imports.reject(R, actor(a1), impId, 'Too late to reject this one'))).toBe('IMPORT_BAD_MOVE');
    });
  });
});
