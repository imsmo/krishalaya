// modules/tenancy/__tests__/tenant13b-settings-desks.integration.spec.ts · PC-56 TENANT-13b — LIVE proof against real Postgres + RLS
// (no infra mocks). Founder decisions: TENANT MAKER-CHECKER WITH PLATFORM FLOORS, EFFECTIVE NEXT MIDNIGHT IST WITH MEMBER NOTICE ·
// TENANT DESK BUNDLES, NO NEW GLOBAL ROLES, NO SEPARATE OWNER ROLE. Each block fails on HEAD 201d9e2:
//   A1  a money key PUT → 409 PROPOSAL_REQUIRED and nothing written; kv_app's own INSERT / UPDATE of a money key is refused by the
//       key-aware trigger (it cites no confirmed proposal); a proposal outside the floor is refused BY NAME; a one-admin tenant is
//       told "needs a second administrator"; the proposer's confirm is refused by the TRIGGER (service and raw SQL); a second admin
//       confirms → effective_at = next 00:00 IST (SQL and TypeScript agree); the job does not apply it early; a due proposal is applied
//       by the job (value + history + audit + `tenancy.setting_effective` to every member, in three languages); 7 days → expired;
//   A3  GET gated (tenant.settings); an ordinary key writes with before/after (history + audit + reason); unwired / deprecated keys
//       refused by name; group_lot.max_extension_hours floored 1–48 and READ by the extend act;
//   A4  every tenant-scope key is in exactly one of WIRED / UNWIRED;
//   A5  languages write tenant_languages; removing a language a published page uses is refused by name;
//   A6  kv_app probes: INSERT / UPDATE setting_definitions, platform_setting_values, feature_flags, roles → 42501;
//   B   a desk create needs a checker (trigger); the compiled grant includes a desk's codes and excludes a disabled desk's; an ungrantable
//       code is refused in a desk and never compiled even if a row carries it; kv_app cannot write desk_permissions outside a confirming
//       transaction; templates install via one proposal and every mapped code exists; the labour suggestion is a real count;
//   µs  proposals written in ONE transaction (one created_at) page exactly once at limit 2.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { TenantSettingsRepository } from '../repositories/tenant-settings.repository';
import { SettingGovernanceRepository } from '../repositories/setting-governance.repository';
import { TenantSettingsService } from '../services/tenant-settings.service';
import { SettingProposalsJob } from '../jobs/setting-proposals.job';
import { nextMidnightIst } from '../domain/setting-governance';
import { UNWIRED_SETTINGS, WIRED_SETTINGS } from '../domain/setting-consumers';
import { DeskRepository } from '../../identity/repositories/desk.repository';
import { DeskService } from '../../identity/services/desk.service';
import { DESK_TEMPLATES, allMappedCodes, allRefusedLabels } from '../../identity/domain/desk-templates';
import { GroupLotRepository } from '../../group-lots/repositories/group-lot.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const key = () => `idem-${randomUUID()}`;
const IP = '10.0.13.2';
const WHY = 'Board resolution 14/2026: tighten the refund two-person rule after the September incident';

run('PC-56 TENANT-13b · settings maker-checker with floors, languages, desks (integration, real Postgres)', () => {
  let admin: Pool; let pools: PgPoolProvider; let uow: PgUnitOfWork; let replica: PgReadReplicaProvider;
  let settings: TenantSettingsService; let desks: DeskService; let job: SettingProposalsJob; let roleCache: RoleCacheService; let cache: InMemoryCacheService;
  let gov: SettingGovernanceRepository;
  const tA = randomUUID(); const tB = randomUUID();
  const a1 = randomUUID(); const a2 = randomUUID(); const b1 = randomUUID(); const staff = randomUUID(); const farmer = randomUUID();
  const mgr = (u: string) => ({ userId: u, canManage: true });
  const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => e.code ?? String(e.message ?? e));
  const errOf = (p: Promise<unknown>) => p.then(() => null, (e: any) => e);
  const addRole = async (u: string, role: string, tenant: string) => {
    const r = (await admin.query(`SELECT id FROM roles WHERE code=$1`, [role])).rows[0].id;
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING`, [u, tenant, r]);
  };
  async function asApp<T>(tenantId: string, userId: string | null, fn: (c: PoolClient, probe: (sql: string, p?: unknown[]) => Promise<string>) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_app');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId ?? '']);
      const probe = async (sql: string, p: unknown[] = []) => {
        await c.query('SAVEPOINT p');
        try { await c.query(sql, p); await c.query('RELEASE SAVEPOINT p'); return 'ok'; }
        catch (e) { await c.query('ROLLBACK TO SAVEPOINT p'); const x = e as { code?: string; message?: string }; return `${x.code}:${(x.message ?? '').match(/\[([A-Z_]+)\]/)?.[1] ?? ''}`; }
      };
      return await fn(c, probe);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }
  const settingRow = async (t: string, k: string) => (await admin.query(`SELECT value FROM tenant_settings WHERE tenant_id=$1 AND key=$2`, [t, k])).rows[0]?.value;
  /** A proposal in the past, written with the admin connection (the trigger still judges it): time travel for the job's tests. */
  const backdated = async (t: string, k: string, oldV: unknown, newV: unknown, by: string, checker: string | null, daysAgo: number) => {
    const id = (await admin.query(
      `INSERT INTO tenant_setting_proposals (tenant_id, key, old_value, new_value, reason, proposed_by, proposed_at, expires_at)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6, now() - make_interval(days => $7), now() - make_interval(days => $7) + interval '7 days') RETURNING id`,
      [t, k, JSON.stringify(oldV), JSON.stringify(newV), WHY, by, daysAgo])).rows[0].id;
    if (checker) {
      await admin.query(`UPDATE tenant_setting_proposals SET status='confirmed', confirmed_by=$2, confirmed_at=now() - make_interval(days => $3) + interval '1 hour',
                           effective_at = next_midnight_ist(now() - make_interval(days => $3) + interval '1 hour') WHERE id=$1`, [id, checker, daysAgo]);
    }
    return id;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, tA, 'Anand FPO 13b'); await makeTenant(admin, tB, 'One Admin FPO');
    for (const [u, n] of [[a1, 'Hetal Admin'], [a2, 'Raman Admin'], [b1, 'Solo Admin'], [staff, 'Staff Desk'], [farmer, 'Kanji Farmer']] as const) {
      await makeUser(admin, u as ReturnType<typeof randomUUID>); await admin.query(`UPDATE users SET full_name=$2 WHERE id=$1`, [u, n]);
    }
    await addRole(a1, 'tenant_admin', tA); await addRole(a2, 'tenant_admin', tA); await addRole(b1, 'tenant_admin', tB);
    await addRole(staff, 'tenant_staff', tA); await addRole(farmer, 'farmer', tA);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config); const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards); replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const ui = new UiMessageRepository(replica as never);
    gov = new SettingGovernanceRepository(replica as never);
    settings = new TenantSettingsService(uow, outbox, idem, metrics, audit, new TenantSettingsRepository(replica as never), gov, ui);
    job = new SettingProposalsJob(60_000, uow, gov, settings);
    cache = new InMemoryCacheService();
    roleCache = new RoleCacheService(pools, shards, cache as never);
    desks = new DeskService(uow, outbox, idem, audit, new DeskRepository(replica as never), roleCache);
  });
  afterAll(async () => { await admin.end(); await pools.onModuleDestroy?.(); });

  /* ================================================================================================================== */
  it('A3 · GET is gated by tenant.settings, and prints type / platform default / risk / floor / effect only where wired', async () => {
    expect(await codeOf(settings.registry(tA, { userId: farmer, canManage: false }))).toBe('TENANT_FORBIDDEN');
    const reg = await settings.registry(tA, mgr(a1));
    const by = Object.fromEntries(reg.items.map((i: any) => [i.key, i]));
    expect(by['disputes.refund_checker_threshold_minor']).toMatchObject({ type: 'int', riskClass: 'money_path', route: 'proposal', wired: true, floor: { min: 0, max: 1000000 } });
    expect(by['disputes.refund_checker_threshold_minor'].effect).toEqual(expect.any(String));
    expect(by['order.auto_confirm_hours']).toMatchObject({ riskClass: 'security', memberNotice: true, route: 'none', wired: false, unwiredReason: 'no_consumer', effect: null });
    expect(by['listing.approval_required']).toMatchObject({ route: 'none', unwiredReason: 'no_consumer', effect: null });
    expect(by['languages.enabled']).toMatchObject({ route: 'none', deprecated: true });
    expect(by['settlements.cycle_length']).toMatchObject({ route: 'none', floor: { locked: true } });
    expect(by['group_lot.max_extension_hours']).toMatchObject({ type: 'int', platformDefault: 48, route: 'direct', wired: true, floor: { min: 1, max: 48 } });
    expect(reg.admins.count).toBe(2);
  });

  it('A4 · every tenant-scope key in the registry is in exactly one of WIRED / UNWIRED', async () => {
    const keys = (await admin.query(`SELECT key FROM setting_definitions WHERE scope='tenant' ORDER BY key`)).rows.map((x) => x.key);
    for (const k of keys) {
      const n = Number(k in WIRED_SETTINGS) + Number(k in UNWIRED_SETTINGS);
      expect({ k, n }).toEqual({ k, n: 1 });
    }
    for (const k of [...Object.keys(WIRED_SETTINGS), ...Object.keys(UNWIRED_SETTINGS)]) expect(keys).toContain(k);
  });

  /* ================================================================================================================== */
  it('A1 · a money key PUT is refused (409 PROPOSAL_REQUIRED) and nothing is written; kv_app cannot write it either', async () => {
    const e = await errOf(settings.put(tA, mgr(a1), key(), { key: 'disputes.refund_checker_threshold_minor', value: 9007199254740991 }, IP));
    expect(e).toMatchObject({ code: 'PROPOSAL_REQUIRED', httpStatus: 409 });
    expect(await codeOf(settings.put(tA, mgr(a1), key(), { key: 'governance.quorum_bp', value: 0 }, IP))).toBe('PROPOSAL_REQUIRED');
    expect(await settingRow(tA, 'disputes.refund_checker_threshold_minor')).toBeUndefined();
    // the database wall under the service: RLS cannot tell keys apart, the trigger can
    await asApp(tA, a1, async (_c, probe) => {
      expect(await probe(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'disputes.refund_checker_threshold_minor', '9007199254740991')`, [tA])).toBe('23514:PROPOSAL_REQUIRED');
      expect(await probe(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'governance.quorum_bp', '0')`, [tA])).toBe('23514:PROPOSAL_REQUIRED');
      expect(await probe(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'languages.enabled', '["en"]')`, [tA])).toBe('23514:SETTING_DEPRECATED');
      // citing a proposal that is not confirmed + due does not help
      await probe(`SELECT set_config('app.setting_proposal_id', $1, true)`, [randomUUID()]);
      expect(await probe(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'disputes.refund_checker_threshold_minor', '1')`, [tA])).toBe('23514:PROPOSAL_REQUIRED');
    });
  });

  it('A2 · a proposal outside the platform floor is refused by name; a one-admin tenant needs a second administrator', async () => {
    const above = await errOf(settings.propose(tA, mgr(a1), key(), { key: 'disputes.refund_checker_threshold_minor', value: 2_000_000, reason: WHY }, IP));
    expect(above).toMatchObject({ code: 'SETTING_OUTSIDE_FLOOR', details: { key: 'disputes.refund_checker_threshold_minor', code: 'above_ceiling', ceiling: 1000000 } });
    expect(await errOf(settings.propose(tA, mgr(a1), key(), { key: 'governance.quorum_bp', value: 3000, reason: WHY }, IP))).toMatchObject({ code: 'SETTING_OUTSIDE_FLOOR', details: { code: 'below_floor', floor: 3300 } });
    expect(await errOf(settings.propose(tA, mgr(a1), key(), { key: 'settlements.cycle_length', value: 'monthly', reason: WHY }, IP))).toMatchObject({ code: 'SETTING_OUTSIDE_FLOOR', details: { code: 'only_value', only: 'fortnightly' } });
    expect(await codeOf(settings.propose(tA, mgr(a1), key(), { key: 'disputes.refund_checker_threshold_minor', value: 500000, reason: 'too short' }, IP))).toBe('SETTING_REASON_INVALID');
    expect(await codeOf(settings.propose(tA, mgr(a1), key(), { key: 'plans.usage_alert_threshold_pct', value: 80, reason: WHY }, IP))).toBe('SETTING_NOT_GATED');
    expect(await codeOf(settings.propose(tA, mgr(a1), key(), { key: 'order.auto_confirm_hours', value: 2, reason: WHY }, IP))).toBe('SETTING_NOT_WIRED');
    expect(await errOf(settings.propose(tB, mgr(b1), key(), { key: 'disputes.refund_checker_threshold_minor', value: 500000, reason: WHY }, IP))).toMatchObject({ code: 'NEEDS_SECOND_ADMIN', details: { admins: 1 } });
    // the floor in the DATABASE too (the service's check removed, the trigger still refuses)
    await asApp(tA, a1, async (_c, probe) => {
      expect(await probe(`INSERT INTO tenant_setting_proposals (tenant_id, key, old_value, new_value, reason, proposed_by, proposed_at, expires_at)
                          VALUES ($1,'disputes.refund_checker_threshold_minor','1000000','2000000',$2,$3, now(), now() + interval '7 days')`, [tA, WHY, a1])).toBe('23514:SETTING_OUTSIDE_FLOOR');
    });
    expect((await admin.query(`SELECT count(*)::int n FROM tenant_setting_proposals WHERE tenant_id IN ($1,$2)`, [tA, tB])).rows[0].n).toBe(0);
  });

  let P1 = '';
  it('A1 · the proposer cannot confirm (the TRIGGER refuses — service and raw SQL); a second admin confirms → effective next 00:00 IST', async () => {
    const p = await settings.propose(tA, mgr(a1), key(), { key: 'disputes.refund_checker_threshold_minor', value: 500000, reason: WHY }, IP);
    P1 = p.id;
    expect(p).toMatchObject({ status: 'proposed', oldValue: 1000000, newValue: 500000, youProposed: true, canConfirm: false });
    expect(await codeOf(settings.propose(tA, mgr(a2), key(), { key: 'disputes.refund_checker_threshold_minor', value: 400000, reason: WHY }, IP))).toBe('SETTING_PROPOSAL_LIVE');
    expect(await errOf(settings.confirm(tA, mgr(a1), key(), P1, IP))).toMatchObject({ code: 'CHECKER_IS_MAKER', httpStatus: 409 });
    await asApp(tA, a1, async (_c, probe) => {
      expect(await probe(`UPDATE tenant_setting_proposals SET status='confirmed', confirmed_by=$2, confirmed_at=now(), effective_at=next_midnight_ist(now()) WHERE id=$1`, [P1, a1])).toBe('23514:SETTING_CHECKER_IS_MAKER');
      // a second admin cannot be impersonated from the first admin's session either
      expect(await probe(`UPDATE tenant_setting_proposals SET status='confirmed', confirmed_by=$2, confirmed_at=now(), effective_at=next_midnight_ist(now()) WHERE id=$1`, [P1, a2])).toBe('23514:SETTING_PROPOSAL_NOT_YOURS');
      // a staff member is no checker
      await probe(`SELECT set_config('app.user_id', $1, true)`, [staff]);
      expect(await probe(`UPDATE tenant_setting_proposals SET status='confirmed', confirmed_by=$2, confirmed_at=now(), effective_at=next_midnight_ist(now()) WHERE id=$1`, [P1, staff])).toBe('23514:SETTING_CHECKER_NOT_ADMIN');
    });
    const c = await settings.confirm(tA, mgr(a2), key(), P1, IP);
    expect(c.status).toBe('confirmed');
    const row = (await admin.query(`SELECT confirmed_at, effective_at, effective_at = next_midnight_ist(confirmed_at) AS ok,
                                           to_char(effective_at AT TIME ZONE 'Asia/Kolkata', 'HH24:MI:SS') AS ist FROM tenant_setting_proposals WHERE id=$1`, [P1])).rows[0];
    expect(row.ok).toBe(true);
    expect(row.ist).toBe('00:00:00');
    expect(new Date(row.effective_at).toISOString()).toBe(nextMidnightIst(new Date(row.confirmed_at)).toISOString());
    expect(new Date(row.effective_at).getTime()).toBeGreaterThan(Date.now());
    const au = (await admin.query(`SELECT action, old_value, new_value, reason FROM audit_log WHERE entity_id=$1 ORDER BY created_at`, [P1])).rows;
    expect(au.map((x) => x.action)).toEqual(['tenancy.setting_proposed', 'tenancy.setting_confirmed']);
    expect(au[0]).toMatchObject({ old_value: { value: 1000000 }, new_value: { value: 500000 }, reason: WHY });
    // confirmed is final: not even the admin realm re-dates it
    expect(await codeOf(admin.query(`UPDATE tenant_setting_proposals SET effective_at = now() WHERE id=$1`, [P1]))).toMatch(/23514|check/);
    // not due → the job leaves it; the value is unchanged
    await job.sweep(admin as never);
    expect(await settingRow(tA, 'disputes.refund_checker_threshold_minor')).toBeUndefined();
    expect((await admin.query(`SELECT status FROM tenant_setting_proposals WHERE id=$1`, [P1])).rows[0].status).toBe('confirmed');
  });

  it('A1 · a DUE confirmed proposal is applied by the job: value + history + audit + the member notice (three languages)', async () => {
    const id = await backdated(tA, 'dairy.dispute_window_hours', 24, 48, a1, a2, 2);
    const r = await job.sweep(admin as never);
    expect(r.applied).toBeGreaterThanOrEqual(1);
    expect(Number(await settingRow(tA, 'dairy.dispute_window_hours'))).toBe(48);
    const p = (await admin.query(`SELECT status, applied_at FROM tenant_setting_proposals WHERE id=$1`, [id])).rows[0];
    expect(p.status).toBe('applied');
    const h = (await admin.query(`SELECT * FROM tenant_setting_history WHERE proposal_id=$1`, [id])).rows;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ source: 'proposal', old_value: 24, new_value: 48, proposed_by: a1, confirmed_by: a2 });
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='tenancy.setting_applied'`, [id])).rows[0].n).toBe(1);
    const ev = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='tenancy.setting_effective'`, [id])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].payload.recipientUserIds).toEqual(expect.arrayContaining([a1, a2, staff, farmer]));
    expect(ev[0].payload.settingName).toMatchObject({ en: 'Milk bill objection window (hours)', hi: expect.any(String), gu: expect.any(String) });
    expect(ev[0].payload.newValue).toMatchObject({ en: '48' });
    expect(ev[0].payload.effectiveAt).toMatch(/^\d{4}-\d{2}-\d{2} 00:00$/);
    // history is append-only; a second sweep applies nothing twice
    expect(await codeOf(admin.query(`UPDATE tenant_setting_history SET new_value='1' WHERE proposal_id=$1`, [id]))).toMatch(/42501|append/);
    await job.sweep(admin as never);
    expect((await admin.query(`SELECT count(*)::int n FROM tenant_setting_history WHERE proposal_id=$1`, [id])).rows[0].n).toBe(1);
  });

  it('A1 · a proposal nobody confirmed in 7 days expires; refuse needs a reason and closes it', async () => {
    const stale = await backdated(tA, 'payouts.batch_cut_off_minutes', 30, 60, a1, null, 8);
    await job.sweep(admin as never);
    expect((await admin.query(`SELECT status FROM tenant_setting_proposals WHERE id=$1`, [stale])).rows[0].status).toBe('expired');
    const p = await settings.propose(tA, mgr(a1), key(), { key: 'governance.quorum_bp', value: 5000, reason: WHY }, IP);
    expect(await codeOf(settings.refuse(tA, mgr(a2), key(), p.id, 'no', IP))).toBe('SETTING_REASON_INVALID');
    const r = await settings.refuse(tA, mgr(a2), key(), p.id, 'The AGM has not voted on raising the quorum yet — bring it to the AGM first', IP);
    expect(r.status).toBe('refused');
    expect(await codeOf(settings.confirm(tA, mgr(a2), key(), p.id, IP))).toBe('SETTING_PROPOSAL_CLOSED');
  });

  /* ================================================================================================================== */
  it('A3 · an ordinary key writes directly with before/after + reason; unwired / deprecated refused; floors apply', async () => {
    const res = await settings.put(tA, mgr(a1), key(), { key: 'plans.usage_alert_threshold_pct', value: 80, reason: 'warn earlier in harvest season' }, IP);
    expect(res).toMatchObject({ value: 80, before: 90 });
    const h = (await admin.query(`SELECT * FROM tenant_setting_history WHERE tenant_id=$1 AND key='plans.usage_alert_threshold_pct'`, [tA])).rows;
    expect(h[0]).toMatchObject({ source: 'direct', old_value: 90, new_value: 80, actor_user_id: a1, reason: 'warn earlier in harvest season' });
    const au = (await admin.query(`SELECT old_value, new_value, reason, entity_id FROM audit_log WHERE tenant_id=$1 AND action='tenancy.tenant_setting_changed' AND new_value->>'key'='plans.usage_alert_threshold_pct'`, [tA])).rows[0];
    expect(au.entity_id).toBe(res.historyId);
    expect(au).toMatchObject({ old_value: { value: 90 }, new_value: { value: 80 }, reason: 'warn earlier in harvest season' });
    expect(await codeOf(settings.put(tA, mgr(a1), key(), { key: 'review.enabled', value: false }, IP))).toBe('SETTING_NOT_WIRED');
    expect(await codeOf(settings.put(tA, mgr(a1), key(), { key: 'languages.enabled', value: ['gu'] }, IP))).toBe('SETTING_DEPRECATED');
    expect(await codeOf(settings.put(tA, mgr(a1), key(), { key: 'group_lot.max_extension_hours', value: 72 }, IP))).toBe('SETTING_OUTSIDE_FLOOR');
    await settings.put(tA, mgr(a1), key(), { key: 'group_lot.max_extension_hours', value: 24 }, IP);
    // the consumer reads it (11c's extend act)
    const glr = new GroupLotRepository(replica as never);
    expect(await uow.run(tA, (tx) => glr.maxExtensionHoursTx(tx, tA, 'group_lot.max_extension_hours'), { userId: a1 })).toBe(24);
    expect(await uow.run(tB, (tx) => glr.maxExtensionHoursTx(tx, tB, 'group_lot.max_extension_hours'), { userId: b1 })).toBe(48);
    // history pages by µs keyset
    const page = await settings.history(tA, mgr(a1), { limit: 1 });
    expect(page.items).toHaveLength(1); expect(page.nextCursor).toEqual(expect.any(String));
  });

  /* ================================================================================================================== */
  it('A5 · languages write tenant_languages; removing a language a published page uses is refused by name', async () => {
    const r = await settings.putLanguages(tA, mgr(a1), key(), { enabled: ['gu', 'hi', 'en'], primary: 'gu' }, IP);
    expect(r.primary).toBe('gu');
    const rows = (await admin.query(`SELECT language_code, is_default FROM tenant_languages WHERE tenant_id=$1 ORDER BY language_code`, [tA])).rows;
    expect(rows).toEqual([{ language_code: 'en', is_default: false }, { language_code: 'gu', is_default: true }, { language_code: 'hi', is_default: false }]);
    expect(await codeOf(settings.putLanguages(tA, mgr(a1), key(), { enabled: ['gu', 'mr'], primary: 'gu' }, IP))).toBe('LANGUAGES_INVALID');   // mr not platform-active
    expect(await codeOf(settings.putLanguages(tA, mgr(a1), key(), { enabled: ['gu'], primary: 'hi' }, IP))).toBe('LANGUAGES_INVALID');
    const pg = (await admin.query(`INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code, created_by)
                       VALUES ($1, 'about-hi', 'static', 'हमारे बारे में', 'संस्था', 1, 'draft', 'hi', $2) RETURNING id`, [tA, a1])).rows[0].id;
    await admin.query(`UPDATE cms_pages SET status='published', published_at=now(), published_by=$2 WHERE id=$1`, [pg, a2]);
    const e = await errOf(settings.putLanguages(tA, mgr(a1), key(), { enabled: ['gu', 'en'], primary: 'gu' }, IP));
    expect(e).toMatchObject({ code: 'LANGUAGE_IN_USE', details: { uses: [{ code: 'hi', kind: 'page', count: 1 }] } });
    expect((await admin.query(`SELECT count(*)::int n FROM tenant_languages WHERE tenant_id=$1`, [tA])).rows[0].n).toBe(3);
    const au = (await admin.query(`SELECT old_value, new_value FROM audit_log WHERE tenant_id=$1 AND action='tenancy.tenant_languages_changed'`, [tA])).rows;
    expect(au).toHaveLength(1);
    expect(au[0].new_value).toMatchObject({ enabled: ['gu', 'hi', 'en'], primary: 'gu' });
  });

  /* ================================================================================================================== */
  it('A6 · kv_app cannot write the global registries', async () => {
    await asApp(tA, a1, async (_c, probe) => {
      expect(await probe(`UPDATE setting_definitions SET risk_class='ordinary' WHERE key='disputes.refund_checker_threshold_minor'`)).toBe('42501:');
      expect(await probe(`INSERT INTO setting_definitions (key, value_type, default_value) VALUES ('x.y', 'int', '1')`)).toBe('42501:');
      expect(await probe(`INSERT INTO platform_setting_values (key, value, set_by_admin_id, reason) VALUES ('billing.tax_bp', '0', $1, 'twenty characters of reason')`, [a1])).toBe('42501:');
      expect(await probe(`UPDATE feature_flags SET is_enabled = true`)).toBe('42501:');
      expect(await probe(`INSERT INTO roles (code, default_name) VALUES ('owner', 'Owner')`)).toBe('42501:');
      expect(await probe(`UPDATE languages SET is_active = true WHERE code='mr'`)).toBe('42501:');
    });
  });

  /* ================================================================================================================== */
  let D1 = '';
  it('B · a desk create needs a checker; the compiled grant includes its codes; an ungrantable code is refused; a disabled desk grants nothing', async () => {
    const dm = { userId: a1, canManage: true }; const dm2 = { userId: a2, canManage: true };
    expect(await codeOf(desks.board(tA, { userId: staff, canManage: false }))).toBe('DESK_FORBIDDEN');
    expect(await codeOf(desks.propose(tB, { userId: b1, canManage: true }, key(), { kind: 'create', code: 'support_desk', name: 'Support', permissions: ['support.handle'], reason: WHY }, IP))).toBe('NEEDS_SECOND_ADMIN');
    const bad = await errOf(desks.propose(tA, dm, key(), { kind: 'create', code: 'support_desk', name: 'Support', permissions: ['support.handle', 'payout.approve', 'ledger.read'], members: { add: [staff] }, reason: WHY }, IP));
    expect(bad.code).toBe('DESK_INVALID');
    const refusals = bad.details.refusals.map((r: any) => `${r.code}:${r.detail?.code ?? ''}`);
    expect(refusals).toEqual(expect.arrayContaining(['DESK_CODE_UNGRANTABLE:payout.approve', 'DESK_CODE_NOT_HELD:ledger.read']));
    const preview = await desks.preview(tA, dm, { kind: 'create', code: 'support_desk', name: 'Support', permissions: ['support.handle', 'report.view'], members: { add: [staff] }, reason: WHY });
    expect(preview).toMatchObject({ ready: true, diff: { add: ['report.view', 'support.handle'], members: { add: [staff] } }, reGranted: 1 });
    const p = await desks.propose(tA, dm, key(), { kind: 'create', code: 'support_desk', name: 'Support', permissions: ['support.handle', 'report.view'], members: { add: [staff] }, reason: WHY }, IP);
    expect(await codeOf(desks.confirm(tA, dm, key(), p.id, IP))).toBe('CHECKER_IS_MAKER');
    expect((await admin.query(`SELECT count(*)::int n FROM desks WHERE tenant_id=$1`, [tA])).rows[0].n).toBe(0);
    expect((await roleCache.effectiveAccess(staff, tA)).permissions).not.toContain('support.handle');
    const c = await desks.confirm(tA, dm2, key(), p.id, IP);
    expect(c).toMatchObject({ status: 'confirmed', reGranted: 1 });
    D1 = (await admin.query(`SELECT id FROM desks WHERE tenant_id=$1 AND code='support_desk'`, [tA])).rows[0].id;
    expect((await roleCache.effectiveAccess(staff, tA)).permissions).toEqual(expect.arrayContaining(['support.handle', 'report.view']));
    // a row that somehow carries an ungrantable code is never compiled
    await admin.query(`INSERT INTO desk_permissions (tenant_id, desk_id, permission_code, added_by_proposal) VALUES ($1,$2,'payout.approve',$3)`, [tA, D1, p.id]);
    await roleCache.invalidate(staff, tA);
    expect((await roleCache.effectiveAccess(staff, tA)).permissions).not.toContain('payout.approve');
    // kv_app cannot add a desk permission (or create a desk) outside the transaction that confirms a proposal
    await asApp(tA, a1, async (_c, probe) => {
      expect(await probe(`INSERT INTO desk_permissions (tenant_id, desk_id, permission_code, added_by_proposal) VALUES ($1,$2,'kyc.read',$3)`, [tA, D1, p.id])).toBe('23514:DESK_PROPOSAL_REQUIRED');
      await probe(`SELECT set_config('app.desk_proposal_id', $1, true)`, [p.id]);   // an OLD confirmed proposal: not this transaction's
      expect(await probe(`INSERT INTO desk_permissions (tenant_id, desk_id, permission_code, added_by_proposal) VALUES ($1,$2,'kyc.read',$3)`, [tA, D1, p.id])).toBe('23514:DESK_PROPOSAL_REQUIRED');
      expect(await probe(`UPDATE desks SET status='disabled', disabled_at=now(), disabled_by_proposal=$2 WHERE id=$1`, [D1, p.id])).toBe('23514:DESK_PROPOSAL_REQUIRED');
    });
    // disable → the grant goes
    const dis = await desks.propose(tA, dm2, key(), { kind: 'disable', deskId: D1, reason: 'Support moves to the district office from the first of the month' }, IP);
    await desks.confirm(tA, dm, key(), dis.id, IP);
    const after = (await roleCache.effectiveAccess(staff, tA)).permissions;
    expect(after).not.toContain('support.handle');
    expect(after).not.toContain('report.view');
    expect(await codeOf(desks.addMember(tA, dm, key(), D1, farmer, null, IP))).toBe('DESK_DISABLED');
    // enable → it comes back; edit permissions via the checker; members direct + audited
    const en = await desks.propose(tA, dm, key(), { kind: 'enable', deskId: D1, reason: 'District office plan withdrawn; support stays here' }, IP);
    await desks.confirm(tA, dm2, key(), en.id, IP);
    expect((await roleCache.effectiveAccess(staff, tA)).permissions).toContain('support.handle');
    const ed = await desks.propose(tA, dm, key(), { kind: 'edit', deskId: D1, permissions: ['support.handle'], reason: 'Support no longer needs the member roster — privacy review' }, IP);
    // the edit also removes the stray ungrantable row planted above (it was never compiled; now it is gone from the desk too)
    expect(ed.diff).toMatchObject({ add: [], remove: ['payout.approve', 'report.view'] });
    await desks.confirm(tA, dm2, key(), ed.id, IP);
    expect((await roleCache.effectiveAccess(staff, tA)).permissions).not.toContain('report.view');
    expect((await admin.query(`SELECT count(*)::int n FROM desk_permissions WHERE desk_id=$1 AND permission_code='report.view' AND removed_at IS NOT NULL`, [D1])).rows[0].n).toBe(1);
    await desks.addMember(tA, dm, key(), D1, farmer, 'covers the Tuesday support shift', IP);
    expect((await roleCache.effectiveAccess(farmer, tA)).permissions).toContain('support.handle');
    expect(await codeOf(desks.removeMember(tA, dm, key(), D1, farmer, 'x', IP))).toBe('DESK_MEMBER_REASON');
    await desks.removeMember(tA, dm, key(), D1, farmer, 'shift ended', IP);
    expect((await roleCache.effectiveAccess(farmer, tA)).permissions).not.toContain('support.handle');
    expect((await admin.query(`SELECT action FROM audit_log WHERE entity_id=$1 AND action LIKE 'desk.member_%' ORDER BY created_at`, [D1])).rows.map((x) => x.action)).toEqual(['desk.member_added', 'desk.member_removed']);
  });

  it('B3 · templates install via ONE proposal and a checker; every mapped code exists; refused labels are never minted; the labour suggestion is a real count', async () => {
    const lookup = (await admin.query(`SELECT code FROM desk_templates ORDER BY sort_order`)).rows.map((x) => x.code);
    expect(lookup).toEqual(DESK_TEMPLATES.map((t) => t.code));
    const known = new Set((await admin.query(`SELECT code FROM permissions`)).rows.map((x) => x.code));
    for (const c of allMappedCodes()) expect({ c, exists: known.has(c) }).toEqual({ c, exists: true });
    for (const l of allRefusedLabels()) expect({ l, exists: known.has(l) }).toEqual({ l, exists: false });
    const board0 = await desks.board(tA, { userId: a1, canManage: true });
    expect(board0.suggestion).toBeNull();
    // one booking this season created by a tenant_admin → the suggestion prints it
    const dt = (await admin.query(`SELECT id FROM lookup_values LIMIT 1`)).rows[0].id; const sk = (await admin.query(`SELECT id FROM skills LIMIT 1`)).rows[0].id;
    await admin.query(`INSERT INTO labour_bookings (tenant_id, booking_no, employer_user_id, demand_type_id, task_skill_id, start_date, end_date, wage_offered_minor, min_wage_minor, farm_lat, farm_lng, created_by)
                       VALUES ($1,'LB-13B-1',$2,$3,$4,current_date,current_date,50000,40000,22.5,72.9,$2)`, [tA, a1, dt, sk]);
    const board1 = await desks.board(tA, { userId: a1, canManage: true });
    expect(board1.suggestion).toMatchObject({ template: 'labour', adminBookings: 1 });
    const fin = board1.templates.find((t: any) => t.code === 'finance')!;
    expect(fin.labels.find((l: any) => l.label === 'ledger.read')).toMatchObject({ kind: 'mapped', code: 'ledger.read', grant: 'not_held' });
    expect(fin.labels.find((l: any) => l.label === 'statement.read')).toMatchObject({ kind: 'refused', reasonKey: 'rides_other', ridesOn: 'settlement.close' });
    const p = await desks.propose(tA, { userId: a2, canManage: true }, key(), { kind: 'install_templates', reason: 'Install the standard desks before the kharif procurement rush' }, IP);
    expect(p.diff.desks.map((d: any) => d.code)).toEqual(['verification', 'support', 'moderation', 'dairy', 'finance', 'content', 'labour']);
    await desks.confirm(tA, { userId: a1, canManage: true }, key(), p.id, IP);
    const made = (await admin.query(`SELECT d.code, array_agg(dp.permission_code ORDER BY dp.permission_code) AS codes FROM desks d JOIN desk_permissions dp ON dp.desk_id=d.id AND dp.removed_at IS NULL
                                     WHERE d.tenant_id=$1 AND d.template_code IS NOT NULL GROUP BY d.code ORDER BY d.code`, [tA])).rows;
    expect(made.find((x) => x.code === 'finance')!.codes).toEqual(['payout.prepare']);
    expect(made.find((x) => x.code === 'labour')!.codes).toEqual(['labour.desk']);
    expect(made.flatMap((x) => x.codes)).not.toContain('payout.approve');
    expect((await desks.board(tA, { userId: a1, canManage: true })).suggestion).toBeNull();   // a labour desk exists now
  });

  /* ================================================================================================================== */
  it('µs · proposals written in ONE transaction (one created_at) page exactly once at limit 2', async () => {
    const t = randomUUID(); const u1 = randomUUID(); const u2 = randomUUID();
    await makeTenant(admin, t, 'Paging FPO'); await makeUser(admin, u1 as never); await makeUser(admin, u2 as never);
    await addRole(u1, 'tenant_admin', t); await addRole(u2, 'tenant_admin', t);
    const keys = ['disputes.refund_checker_threshold_minor', 'payouts.batch_checker_threshold_minor', 'payouts.batch_cut_off_minutes', 'dairy.cycle_payday_offset_days', 'dairy.deduction_consent_pct'];
    const vals = [100, 100, 60, 1, 10];
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      for (let i = 0; i < keys.length; i++) {
        await c.query(`INSERT INTO tenant_setting_proposals (tenant_id, key, old_value, new_value, reason, proposed_by, proposed_at, expires_at)
                       SELECT $1::uuid,$2::varchar,d.default_value,$3::jsonb,$4,$5::uuid, now(), now() + interval '7 days' FROM setting_definitions d WHERE d.key=$2::varchar`, [t, keys[i], JSON.stringify(vals[i]), WHY, u1]);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    expect((await admin.query(`SELECT count(DISTINCT created_at)::int n FROM tenant_setting_proposals WHERE tenant_id=$1`, [t])).rows[0].n).toBe(1);
    const seen: string[] = []; let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await settings.proposals(t, mgr(u2), { limit: 2, cursor });
      seen.push(...page.items.map((x: any) => x.id));
      if (!page.nextCursor) break; cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5); expect(new Set(seen).size).toBe(5);
  });

  it('RLS · tenant B sees none of A\'s proposals, history, desks or languages', async () => {
    await asApp(tB, b1, async (c) => {
      for (const tbl of ['tenant_setting_proposals', 'tenant_setting_history', 'desks', 'desk_permissions', 'desk_members', 'desk_change_proposals', 'tenant_languages']) {
        const n = (await c.query(`SELECT count(*)::int n FROM ${tbl} WHERE tenant_id=$1`, [tA])).rows[0].n;
        expect({ tbl, n }).toEqual({ tbl, n: 0 });
      }
    });
  });
});
