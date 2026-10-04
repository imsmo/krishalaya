// apps/api/src/__tests__/tenant-swc-verification-team.integration.spec.ts · PC-56 TENANT-SW-c — LIVE proof (real Postgres + RLS as kv_app,
// the 0199 triggers, the claim-expiry job and the invite SMS handler on a pool that LOGS IN as kv_relay). No infra mocks except the SMS
// provider (a capturing sender — the real one is the platform SmsSender port) and the media signer.
//   A  the verification desk: take-next claims the oldest UNRECUSED document FOR UPDATE SKIP LOCKED (two claimers → two documents); skip
//      releases with a coded reason and claims the next; a stale claim is released by the job; the ONBOARDER cannot verify (trigger) and is
//      never handed the member's documents; a DECLARED conflict recuses (trigger) and the claim skips it; the median is computed; what
//      verifying unlocks is READ from the 0125 gate.
//   B  the team: seats — the (M+1)th staff role refused by the service AND the trigger, member roles never count, an unlimited plan
//      passes; invites — token hashed, the SMS event written and dispatched AS kv_relay, accept (token + OTP) creates the user + role +
//      desks under the seat check, second use refused, expired refused, revoke; 2FA — enrol → confirm → sign-in pending until a code,
//      wrong / replayed refused, a recovery code works once, `require_staff_2fa` ON → TWO_FACTOR_REQUIRED for an unenrolled staff member
//      and a pass for a member.
//   C  overrides need a reason (DTO + service); a money permission by override needs a SECOND tenant_admin (trigger); remove-from-team
//      needs a reason and revokes the desks, the overrides and THIS tenant's sessions (an old refresh token AND an old access token are
//      refused), the last admin is refused, yourself is refused; µs paging on the team table.
import 'reflect-metadata';
import { randomUUID, createHash } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { Reflector } from '@nestjs/core';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { AppConfig } from '../core/config/app-config';
import { PgPoolProvider } from '../core/database/pg-pool.provider';
import { ShardRouter } from '../core/sharding/shard-router';
import { PgUnitOfWork } from '../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../core/database/read-replica.pg';
import { PgOutboxWriter } from '../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../core/idempotency/idempotency.service.pg';
import { InMemoryCacheService } from '../core/cache/cache.service.in-memory';
import { PromMetrics } from '../core/observability/metrics.prom';
import { AuditWriter } from '../core/audit/audit.writer';
import { TokenService } from '../core/auth/token.service';
import { OtpService, SmsSender } from '../core/auth/otp.service';
import { RefreshTokenService } from '../core/auth/refresh-token.service';
import { RoleCacheService } from '../core/rbac/role-cache.service';
import { TranslationService } from '../core/i18n/translation.service';
import { UiMessageRepository } from '../core/i18n/ui-message.repository';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { runWithContext, RequestContext } from '../core/tenancy-context/request-context';
import { SessionPostureGuard, SessionPostureService, TwoFactorExempt } from '../core/auth/session-posture.guard';
import { resolveKek } from '../core/secrets/secret-envelope';
import { UserRepository } from '../modules/identity/repositories/user.repository';
import { SessionRepository } from '../modules/identity/repositories/session.repository';
import { DeviceRepository } from '../modules/identity/repositories/device.repository';
import { LoginEventRepository } from '../modules/identity/repositories/login-event.repository';
import { RoleRepository } from '../modules/identity/repositories/role.repository';
import { UserTenantRoleRepository } from '../modules/identity/repositories/user-tenant-role.repository';
import { KycDocumentRepository } from '../modules/identity/repositories/kyc-document.repository';
import { DeskRepository } from '../modules/identity/repositories/desk.repository';
import { VerificationTeamRepository } from '../modules/identity/repositories/verification-team.repository';
import { KycDeskReadModel } from '../modules/identity/read-models/kyc-desk.read-model';
import { AuthService } from '../modules/identity/services/auth.service';
import { KycDeskService, DeskActor } from '../modules/identity/services/kyc-desk.service';
import { KycQueueService } from '../modules/identity/services/kyc-queue.service';
import { ConflictService } from '../modules/identity/services/conflict.service';
import { TeamService } from '../modules/identity/services/team.service';
import { TwoFactorService } from '../modules/identity/services/two-factor.service';
import { UserTenantRoleService } from '../modules/identity/services/user-tenant-role.service';
import { KycClaimsExpiryJob } from '../modules/identity/jobs/kyc-claims-expiry.job';
import { StaffInvitedHandler } from '../modules/identity/events/handlers/staff-invited.handler';
import { StaffOverrideSchema } from '../modules/identity/dto/create-user-tenant-role.dto';
import { RevokeAssignmentSchema } from '../modules/identity/dto/create-user-tenant-role.dto';
import { totpCodeAt } from '../modules/identity/domain/totp';
import { decodeKeyset, UUID_RE } from '../shared/pagination/us-keyset';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
class CaptureSms extends SmsSender { sent: Array<{ phone: string; msg: string }> = []; async send(phone: string, msg: string) { this.sent.push({ phone, msg }); } }
const key = () => `idem-${randomUUID()}`;
const phoneOf = () => `+9197${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const codeOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => {
  const m = /\[([A-Z_]+)\]/.exec(String(e?.message ?? ''));
  return m ? m[1] : (e?.code ?? String(e));
});

run('PC-56 TENANT-SW-c · verification desk & team (integration, real Postgres + RLS + 0199 triggers)', () => {
  let admin: Pool; let relayPool: Pool; let pools: PgPoolProvider; let uow: PgUnitOfWork; let config: AppConfig;
  let repo: VerificationTeamRepository; let desk: KycDeskService; let queue: KycQueueService; let claimsJob: KycClaimsExpiryJob;
  let conflicts: ConflictService; let team: TeamService; let twoFactor: TwoFactorService; let utrSvc: UserTenantRoleService;
  let auth: AuthService; let otp: OtpService; let tokens: TokenService; let posture: SessionPostureService; let roleCache: RoleCacheService;
  let ui: UiMessageRepository; const sms = new CaptureSms();

  // ── helpers ──
  const permsOf = async (code: string) => new Set<string>((await admin.query(`SELECT rp.permission_code AS p FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [code])).rows.map((r) => r.p));
  const actor = (userId: string, permissions: Set<string>): DeskActor & { roles?: string[] } => ({ userId, permissions, ip: '203.0.113.7', requestId: 'req-swc' });
  /** A role row as the superuser writes it (created_by = the onboarder, or NULL). */
  const role = async (u: string, t: string, code: string, createdBy: string | null = null, active = true) => (await admin.query(
    `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, created_by, approved_at) SELECT $1, $2, id, $4, $5, CASE WHEN $4 THEN now() END FROM roles WHERE code = $3 RETURNING id`,
    [u, t, code, active, createdBy])).rows[0].id as string;
  /** A pending member document (no evidence file — so no reveal is needed to decide it), born `hoursAgo` hours ago. */
  const pendingDoc = async (t: string, member: string, hoursAgo: number, code = 'aadhaar') => (await admin.query(
    `INSERT INTO kyc_documents (tenant_id, subject_kind, user_id, doc_type_id, doc_type_code, status, verify_method, submitted_by, last_decision, created_at)
     SELECT $1, 'user', $2, lv.id, $3::text, 'pending', 'manual', $2, 'submit', now() - make_interval(hours => $4)
       FROM lookup_values lv WHERE lv.type_code = 'doc_type' AND lv.code = $3::text AND lv.tenant_id IS NULL ORDER BY lv.created_at LIMIT 1 RETURNING id`,
    [t, member, code, hoursAgo])).rows[0].id as string;
  const named = async (u: string, name: string) => admin.query(`UPDATE users SET full_name = $2 WHERE id = $1`, [u, name]);
  /** As kv_app, in the tenant, with app.user_id — what a request's unit of work is; rolled back. */
  async function asKvApp<T>(tenantId: string, userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_app');
      await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [tenantId, userId]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  /** Superuser history the API cannot write (triggers off for THIS transaction only). */
  async function history(fn: (c: PoolClient) => Promise<void>): Promise<void> {
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica'); await fn(c); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const subscribe = async (t: string, planCode: string) => {
    await admin.query(`UPDATE subscriptions SET deleted_at = now() WHERE tenant_id = $1 AND deleted_at IS NULL`, [t]);
    await admin.query(`INSERT INTO subscriptions (tenant_id, plan_id, status, billing_cycle, price_minor, currency_code, current_period_start, current_period_end)
      SELECT $1, p.id, 'active', 'monthly', 0, 'INR', current_date, current_date + 30 FROM plans p WHERE p.code = $2 ORDER BY p.version DESC LIMIT 1`, [t, planCode]);
  };
  /** An active desk as a confirmed 13b proposal leaves it (two people), written as history. */
  const desk1 = async (t: string, code: string, by: string) => {
    const id = randomUUID(); const checker = await makeUser(admin);
    await history(async (c) => { await c.query(`INSERT INTO desks (id, tenant_id, code, name, status, created_by, confirmed_by, created_by_proposal) VALUES ($1, $2, $3, $3, 'active', $4, $5, $6)`, [id, t, code, by, checker, randomUUID()]); });
    return id;
  };
  const signIn = async (t: string, phone: string) => {
    const { code } = await otp.issue(phone);
    return auth.verifyOtp({ phone, code, tenantId: t } as never, '203.0.113.7');
  };
  const ctxOf = (o: Partial<RequestContext>): RequestContext => ({ tenantId: '', userId: '', sessionId: '', requestId: 'r', lang: 'en', roles: [], permissions: new Set(), shardId: 0, ...o });
  class Plain { handle() { return 1; } }
  class Exempt { @TwoFactorExempt() handle() { return 1; } }
  const execOf = (cls: { prototype: { handle: () => number } }, k = cls) => ({ getType: () => 'http', getHandler: () => k.prototype.handle, getClass: () => k, switchToHttp: () => ({ getRequest: () => ({}) }) }) as never;
  const guardCheck = async (ctx: RequestContext, exempt = false) => {
    const g = new SessionPostureGuard(new Reflector(), posture);
    return runWithContext(ctx, () => g.canActivate(execOf(exempt ? Exempt : Plain))).then(() => 'pass', (e: { code?: string }) => e.code ?? String(e));
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    let relayUrl = process.env.RELAY_TEST_DATABASE_URL;
    if (!relayUrl) { await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`); const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev'; relayUrl = u.toString(); }
    relayPool = new Pool({ connectionString: relayUrl, max: 2 });
    expect((await relayPool.query(`SELECT current_user AS u`)).rows[0].u).toBe('kv_relay');
    config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret-itest-32', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1',
      OTP_RESEND_COOLDOWN_SEC: '0', OTP_REQUEST_MAX_PER_HOUR: '100', OTP_VERIFY_MAX_PER_HOUR: '100', TENANT_CONSOLE_BASE_URL: 'https://console.example.test' } as never);
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards) as never;
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const audit = new AuditWriter(pools); const metrics = new PromMetrics();
    const cache = new InMemoryCacheService();
    tokens = new TokenService(config); otp = new OtpService(cache, config);
    roleCache = new RoleCacheService(pools, shards, cache);
    posture = new SessionPostureService(pools, shards, cache);
    ui = new UiMessageRepository(replica);
    repo = new VerificationTeamRepository(replica);
    const users = new UserRepository(replica); const utrRepo = new UserTenantRoleRepository(replica); const deskRepo = new DeskRepository(replica);
    twoFactor = new TwoFactorService(uow, audit, config, repo, posture);
    auth = new AuthService(uow, outbox, metrics, otp, sms, tokens, new RefreshTokenService(tokens, config), roleCache, new TranslationService(), config,
      users, new SessionRepository(replica), new DeviceRepository(), new LoginEventRepository(), repo, twoFactor);
    const fakeMedia = { getDownloadUrl: async () => ({ url: 'https://signed.example/x', expiresInSec: 900 }) };
    desk = new KycDeskService(uow, outbox, audit, idem, new KycDocumentRepository(replica), utrRepo, new KycDeskReadModel(replica), ui, fakeMedia as never, repo);
    queue = new KycQueueService(uow, audit, idem, repo);
    claimsJob = new KycClaimsExpiryJob(60_000, queue);
    conflicts = new ConflictService(uow, audit, idem, repo);
    team = new TeamService(uow, outbox, audit, idem, otp, config, roleCache, { isEnabled: async () => true } as never, repo, users, deskRepo, auth);
    utrSvc = new UserTenantRoleService(uow, outbox, audit, roleCache, utrRepo, new RoleRepository(replica), users,
      { assertMemberSeatAvailable: async () => ({ kind: 'allow' as const }) } as never, repo, deskRepo, posture);
  }, 90_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status = 'published', published_at = now() WHERE status = 'pending' AND aggregate_type IN ('staff_invite', 'user_tenant_role', 'user', 'kyc_document') AND created_at >= now() - interval '1 hour'`).catch(() => undefined);
    await pools?.onModuleDestroy(); await relayPool?.end(); await admin?.end();
  });

  /* ═════════════════════════════════════════ A · THE VERIFICATION DESK ═════════════════════════════════════════ */
  describe('A · take next, skip, recusal, median, unlocks', () => {
    const T = randomUUID(); let adminU = ''; let rev1 = ''; let rev2 = ''; let onboarder = '';
    let coordPerms: Set<string>; let adminPerms: Set<string>;
    const m: string[] = []; const d: Record<string, string> = {};
    beforeAll(async () => {
      await makeTenant(admin, T, 'Anand FPO');
      adminU = await makeUser(admin); rev1 = await makeUser(admin); rev2 = await makeUser(admin); onboarder = await makeUser(admin);
      await role(adminU, T, 'tenant_admin'); await role(rev1, T, 'fpo_coordinator'); await role(rev2, T, 'fpo_coordinator'); await role(onboarder, T, 'fpo_coordinator');
      await named(rev1, 'Priya Shah'); await named(rev2, 'Rajesh Patel');
      coordPerms = await permsOf('fpo_coordinator'); adminPerms = await permsOf('tenant_admin');
      expect(coordPerms.has('kyc.review')).toBe(true);
      for (let i = 0; i < 5; i++) m.push(await makeUser(admin));
      // m0 was ONBOARDED by `onboarder` (created_by on their farmer role); m1..m4 by nobody recorded (self / pre-0199)
      await role(m[0], T, 'farmer', onboarder); for (const u of m.slice(1)) await role(u, T, 'farmer');
      d.m0 = await pendingDoc(T, m[0], 50); d.m1 = await pendingDoc(T, m[1], 40, 'land_record'); d.m2 = await pendingDoc(T, m[2], 30);
      d.m3 = await pendingDoc(T, m[3], 20); d.m4 = await pendingDoc(T, m[4], 10);
    });

    it('A1 · TWO reviewers take next AT THE SAME INSTANT → two DIFFERENT documents, the two oldest (FOR UPDATE SKIP LOCKED); taking next again returns the claim held', async () => {
      const [a, b] = await Promise.all([queue.takeNext(T, actor(rev1, coordPerms), key()), queue.takeNext(T, actor(rev2, coordPerms), key())]);
      expect(a.reason).toBe('claimed'); expect(b.reason).toBe('claimed');
      expect(a.documentId).not.toBe(b.documentId);
      expect(new Set([a.documentId, b.documentId])).toEqual(new Set([d.m0, d.m1]));          // the two oldest pending member documents
      const again = await queue.takeNext(T, actor(rev1, coordPerms), key());
      expect(again).toMatchObject({ reason: 'already_holding', documentId: a.documentId });
      // the queue says "being reviewed by <masked>" to someone else, and "mine" to the holder
      const rows = (await desk.queue(T, actor(adminU, adminPerms), { limit: 25 })).items as Array<{ id: string; claim: { mine: boolean; byMasked: string | null } | null }>;
      const r1 = rows.find((r) => r.id === a.documentId)!;
      expect(r1.claim).toMatchObject({ mine: false }); expect(r1.claim!.byMasked).toMatch(/^[PR]•+$/);
      expect(JSON.stringify(rows)).not.toMatch(/Priya Shah|Rajesh Patel/);
      // release both for the next cases
      await queue.release(T, actor(rev1, coordPerms), a.claim!.id); await queue.release(T, actor(rev2, coordPerms), b.claim!.id);
    });

    it('A2 · the ONBOARDER is never handed the member\'s document, and cannot verify it — refused by the SERVICE and by the TRIGGER (raw kv_app write)', async () => {
      const c = await queue.takeNext(T, actor(onboarder, coordPerms), key());
      expect(c.documentId).toBe(d.m1);                                       // the oldest is m0's — skipped for its onboarder
      await queue.release(T, actor(onboarder, coordPerms), c.claim!.id);
      const rec: any = await desk.record(T, actor(onboarder, coordPerms), d.m0);
      expect(rec.recusal).toEqual({ code: 'KYC_RECUSED_ONBOARDER', onboarderRecorded: true });
      expect(rec.acts.find((x: any) => x.act === 'verify').refusals).toContain('KYC_RECUSED_ONBOARDER');
      const svc = await desk.act(T, actor(onboarder, coordPerms), d.m0, 'verify', {}, key()).then(() => ['ok'], (e: any) => (e.details?.refusals ?? []).map((r: any) => r.code));
      expect(svc).toContain('KYC_RECUSED_ONBOARDER');
      // THE WALL: the decision write itself, as kv_app in the onboarder's session
      expect(await codeOf(asKvApp(T, onboarder, (cl) => cl.query(`UPDATE kyc_documents SET status = 'verified', reviewed_by = $2, last_decision = 'verify' WHERE id = $1`, [d.m0, onboarder])))).toBe('KYC_RECUSED_ONBOARDER');
      // and the claim wall: inserting a claim on m0 for the onboarder
      expect(await codeOf(asKvApp(T, onboarder, (cl) => cl.query(`INSERT INTO kyc_claims (tenant_id, document_id, claimed_by, expires_at) VALUES ($1, $2, $3, now() + interval '15 minutes')`, [T, d.m0, onboarder])))).toBe('KYC_RECUSED_ONBOARDER');
      // a reviewer who did NOT onboard m0 may
      expect(await codeOf(asKvApp(T, rev2, (cl) => cl.query(`UPDATE kyc_documents SET status = 'verified', reviewed_by = $2, last_decision = 'verify' WHERE id = $1`, [d.m0, rev2])))).toBe('ok');
    });

    it('A3 · a DECLARED conflict recuses: the claim skips the member, the decision is refused (trigger); only another admin lifts it, never the declarer', async () => {
      const decl = await conflicts.declare(T, actor(rev1, coordPerms), rev1, { memberUserId: m[1], relation: 'family', reason: 'my sister-in-law is this member' }, key());
      expect(decl.via).toBe('self');
      const c = await queue.takeNext(T, actor(rev1, coordPerms), key());
      expect(c.documentId).not.toBe(d.m1);                                   // m1's document is skipped for rev1
      expect(c.documentId).toBe(d.m0);                                        // (rev1 did not onboard m0)
      expect(await codeOf(asKvApp(T, rev1, (cl) => cl.query(`UPDATE kyc_documents SET status = 'rejected', reviewed_by = $2, last_decision = 'reject', reason_code = 'blurry_image' WHERE id = $1`, [d.m1, rev1])))).toBe('KYC_RECUSED_DECLARED');
      // the recused person cannot lift it — even holding user.approve (the trigger), and a non-admin cannot lift anyone's
      expect(await codeOf(conflicts.lift(T, actor(rev1, new Set([...coordPerms, 'user.approve'])), decl.id, 'I no longer think this matters'))).toBe('CONFLICT_SELF_LIFT');
      expect(await codeOf(asKvApp(T, rev1, (cl) => cl.query(`UPDATE staff_conflict_declarations SET active = false, revoked_by = $2, revoked_at = now(), revoke_reason = 'lifting my own recusal' WHERE id = $1`, [decl.id, rev1])))).toBe('CONFLICT_SELF_LIFT');
      expect(await codeOf(asKvApp(T, rev2, (cl) => cl.query(`UPDATE staff_conflict_declarations SET active = false, revoked_by = $2, revoked_at = now(), revoke_reason = 'lifting a colleague recusal' WHERE id = $1`, [decl.id, rev2])))).toBe('CONFLICT_LIFTER_NOT_ADMIN');
      const l = await conflicts.lift(T, actor(adminU, adminPerms), decl.id, 'the member moved to another family');
      expect(l).toEqual({ id: decl.id, active: false });
      await queue.release(T, actor(rev1, coordPerms), c.claim!.id);
    });

    it('A4 · Skip releases with a coded reason and claims the NEXT (never the same one); a stale claim is released by the job on a kv_relay pool', async () => {
      const first = await queue.takeNext(T, actor(rev2, coordPerms), key());
      expect(await codeOf(queue.skip(T, actor(rev2, coordPerms), first.claim!.id, { reasonCode: 'other', note: 'short' }, key()))).toBe('SKIP_REASON_REQUIRED');
      const s = await queue.skip(T, actor(rev2, coordPerms), first.claim!.id, { reasonCode: 'needs_specialist' }, key());
      expect(s.skipped).toBe(first.documentId); expect(s.documentId).not.toBe(first.documentId); expect(s.reason).toBe('claimed');
      expect((await admin.query(`SELECT release_kind, skip_reason_code FROM kyc_claims WHERE id = $1`, [first.claim!.id])).rows[0]).toEqual({ release_kind: 'skip', skip_reason_code: 'needs_specialist' });
      // age the live claim past its 15 minutes (history), then the job releases it — as kv_relay reading tenants, kv_app per tenant
      await history(async (c) => { await c.query(`UPDATE kyc_claims SET claimed_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes' WHERE id = $1`, [s.claim!.id]); });
      const out = await claimsJob.sweep(relayPool, [T]);
      expect(out).toMatchObject({ tenants: 1, released: 1, failed: 0 });
      expect((await admin.query(`SELECT release_kind, released_by FROM kyc_claims WHERE id = $1`, [s.claim!.id])).rows[0]).toEqual({ release_kind: 'expired', released_by: null });
      // a fresh claim cannot be expired by anyone before its 15 minutes (trigger)
      const fresh = await queue.takeNext(T, actor(rev2, coordPerms), key());
      expect(await codeOf(asKvApp(T, rev2, (cl) => cl.query(`UPDATE kyc_claims SET released_at = now(), release_kind = 'expired' WHERE id = $1`, [fresh.claim!.id])))).toBe('KYC_CLAIM_NOT_STALE');
      await queue.release(T, actor(rev2, coordPerms), fresh.claim!.id);
    });

    it('A5 · "Median verify time (7d)" = median(decided_at − submitted_at) of the desk\'s decisions — read, equal to the SQL', async () => {
      expect((await desk.overview(T, actor(adminU, adminPerms)) as any).median).toMatchObject({ seconds: null, decisions: 0 });   // "no decisions in 7 days"
      for (const doc of [d.m2, d.m3, d.m4]) await desk.act(T, actor(rev2, coordPerms), doc, 'verify', {}, key());
      const ov: any = await desk.overview(T, actor(adminU, adminPerms));
      expect(ov.median.decisions).toBe(3);
      const sql = Number((await admin.query(`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (d.decided_at - k.created_at))) AS m
        FROM kyc_document_decisions d JOIN kyc_documents k ON k.id = d.document_id WHERE d.tenant_id = $1 AND d.act IN ('verify','reject','request_more') AND d.via = 'desk'`, [T])).rows[0].m);
      expect(ov.median.seconds).toBe(Math.round(sql));
      expect(Math.abs(ov.median.seconds - 20 * 3600)).toBeLessThan(120);           // the three were born 30 h, 20 h, 10 h before
      // the decision released any claim on it
      expect(Number((await admin.query(`SELECT count(*) n FROM kyc_claims WHERE document_id = ANY($1::uuid[]) AND released_at IS NULL`, [[d.m2, d.m3, d.m4]])).rows[0].n)).toBe(0);
    });

    it('A6 · "What unlocks on verify" is READ from the 0125 gate (payout_purpose_roles × the roles this document type evidences); evidence reuse is read', async () => {
      const rec: any = await desk.record(T, actor(rev2, coordPerms), d.m1);    // a land record of a farmer
      const expected = (await admin.query(`SELECT array_agg(purpose_code ORDER BY purpose_code) p FROM payout_purpose_roles WHERE role_code = 'farmer' AND deleted_at IS NULL`)).rows[0].p;
      const farmer = rec.unlocks.find((u: any) => u.roleCode === 'farmer');
      expect(farmer).toMatchObject({ effective: expect.any(String), unlocksOnVerify: true });
      expect(farmer.purposes).toEqual(expected);
      expect(Array.isArray(rec.evidenceReuse)).toBe(true);
    });
  });

  /* ═════════════════════════════════════════ B1 · SEATS ═════════════════════════════════════════ */
  describe('B1 · staff seats per plan', () => {
    const T = randomUUID(); let a1 = ''; let a2 = '';
    beforeAll(async () => {
      await makeTenant(admin, T, 'Seat FPO'); await subscribe(T, 'starter');
      a1 = await makeUser(admin); a2 = await makeUser(admin);
      await role(a1, T, 'tenant_admin'); await role(a2, T, 'tenant_admin');
    });

    it('B1 · starter = 3 seats: the 4th staff role is refused by the SERVICE and by the TRIGGER; member roles never count; an unlimited plan passes', async () => {
      const c = await makeUser(admin);
      await utrSvc.assign(T, a1, { userId: c, roleCode: 'fpo_coordinator' }, null);                 // seat 3 (pending approval holds a seat)
      expect(await repo.seatsUsed(T)).toBe(3);
      const x = await makeUser(admin);
      expect(await codeOf(utrSvc.assign(T, a1, { userId: x, roleCode: 'tenant_staff' }, null))).toBe('STAFF_SEATS_EXHAUSTED');
      // THE WALL: the same insert as kv_app (no service in the way)
      expect(await codeOf(asKvApp(T, a1, (cl) => cl.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'auditor'`, [x, T])))).toBe('STAFF_SEATS_EXHAUSTED');
      // a member role is not a seat
      expect(await codeOf(utrSvc.assign(T, a1, { userId: x, roleCode: 'customer' }, null))).toBe('ok');
      expect(await repo.seatsUsed(T)).toBe(3);
      // a second staff role for someone already seated takes no new seat
      expect(await codeOf(asKvApp(T, a1, (cl) => cl.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = 'auditor'`, [c, T])))).toBe('ok');
      // the tile is a real count against the plan
      const ov: any = await team.overview(T, actor(a1, await permsOf('tenant_admin')), { limit: 25 });
      expect(ov.seats).toEqual({ kind: 'limited', used: 3, seats: 3, planName: 'Starter', full: true });
      // enterprise: unlimited — the 4th passes
      await subscribe(T, 'enterprise');
      expect(await codeOf(utrSvc.assign(T, a1, { userId: x, roleCode: 'tenant_staff' }, null))).toBe('ok');
      expect((await team.overview(T, actor(a1, await permsOf('tenant_admin')), { limit: 25 }) as any).seats).toMatchObject({ kind: 'unlimited', used: 4, planName: 'Enterprise' });
    });
  });

  /* ═════════════════════════════════════════ B2 · INVITES ═════════════════════════════════════════ */
  describe('B2 · the SMS invite: token hashed, SMS dispatched as kv_relay, accept with OTP, single use, expiry, revoke', () => {
    const T = randomUUID(); let a1 = ''; let deskId = ''; let adminPerms: Set<string>;
    beforeAll(async () => {
      await makeTenant(admin, T, 'Invite FPO'); await subscribe(T, 'growth');
      a1 = await makeUser(admin); await role(a1, T, 'tenant_admin'); adminPerms = await permsOf('tenant_admin');
      deskId = await desk1(T, 'verification', a1);
    });

    it('B2a · invite → the token is returned ONCE, only sha256 is stored (+ a sealed copy), the event is written; dispatched AS kv_relay the SMS leaves and the sealed copy is cleared', async () => {
      const phone = phoneOf(); const k = key();
      const inv: any = await team.invite(T, actor(a1, adminPerms), { phone, roleCode: 'fpo_coordinator', deskIds: [deskId], languageCode: 'gu' }, k);
      expect(inv.token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(inv.tokenShown).toBe(true);
      expect(inv.phoneMasked).not.toContain(phone.slice(3));
      expect(inv.link).toBe(`https://console.example.test/invite?t=${inv.token}`);
      const replay: any = await team.invite(T, actor(a1, adminPerms), { phone, roleCode: 'fpo_coordinator', deskIds: [deskId], languageCode: 'gu' }, k);
      expect(replay).toMatchObject({ id: inv.id, token: null, tokenShown: false });                       // SHOWN ONCE
      const row = (await admin.query(`SELECT token_hash, token_sealed, status FROM staff_invites WHERE id = $1`, [inv.id])).rows[0];
      expect(row.token_hash).toBe(createHash('sha256').update(inv.token).digest('hex'));
      expect(row.token_sealed).toMatch(/^v2\./); expect(row.token_sealed).not.toContain(inv.token);
      const ev = (await admin.query(`SELECT id, payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'tenancy.staff_invited'`, [inv.id])).rows;
      expect(ev).toHaveLength(1); expect(JSON.stringify(ev[0].payload)).not.toContain(inv.token); expect(JSON.stringify(ev[0].payload)).not.toContain(phone);
      // the audit row carries the MASKED phone only
      const au = (await admin.query(`SELECT new_value FROM audit_log WHERE entity_id = $1 AND action = 'team.invite.created'`, [inv.id])).rows[0];
      expect(JSON.stringify(au.new_value)).not.toContain(phone.slice(3));
      // dispatch through the REAL dispatcher on a pool that logs in as kv_relay
      const reg = new OutboxHandlerRegistry();
      reg.register(new StaffInvitedHandler(uow, repo, ui, sms, resolveKek('', false), 'https://console.example.test'));
      const outcome = await new OutboxDispatcher(relayPool, reg, { inc: () => undefined, observe: () => undefined } as never).relayById(String(ev[0].id));
      expect(outcome.status).toBe('published');
      const sent = sms.sent.filter((s) => s.phone === phone);
      expect(sent).toHaveLength(1);
      expect(sent[0].msg).toContain(inv.link);                                // the Gujarati body carries the link
      expect(sent[0].msg).toMatch(/આમંત્રણ/);
      const after = (await admin.query(`SELECT sent_at IS NOT NULL AS sent, token_sealed FROM staff_invites WHERE id = $1`, [inv.id])).rows[0];
      expect(after).toEqual({ sent: true, token_sealed: null });
    });

    it('B2b · accept = token + OTP on the INVITED phone → a user, the role ACTIVE, the desk joined, the invite accepted, a session; a second use is refused; a wrong OTP never accepts', async () => {
      const phone = phoneOf();
      const inv: any = await team.invite(T, actor(a1, adminPerms), { phone, roleCode: 'fpo_coordinator', deskIds: [deskId] }, key());
      expect(await codeOf(team.accept({ tenantId: T, token: inv.token, phone, code: '000000' }, null))).toBe('INVITE_OTP_INVALID');
      const { code } = await otp.issue(phone);
      const out: any = await team.accept({ tenantId: T, token: inv.token, phone, code, fullName: 'Meena Ben' }, '203.0.113.9');
      expect(out.accessToken).toBeTruthy(); expect(out.invite).toEqual({ id: inv.id, roleCode: 'fpo_coordinator' });
      const uid = (await admin.query(`SELECT id FROM users WHERE phone = $1`, [phone])).rows[0].id;
      expect((await admin.query(`SELECT r.code, utr.is_active, utr.created_by FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id WHERE utr.tenant_id = $1 AND utr.user_id = $2`, [T, uid])).rows)
        .toEqual([{ code: 'fpo_coordinator', is_active: true, created_by: a1 }]);
      expect(Number((await admin.query(`SELECT count(*) n FROM desk_members WHERE desk_id = $1 AND user_id = $2 AND removed_at IS NULL`, [deskId, uid])).rows[0].n)).toBe(1);
      expect((await admin.query(`SELECT status, accepted_user_id FROM staff_invites WHERE id = $1`, [inv.id])).rows[0]).toEqual({ status: 'accepted', accepted_user_id: uid });
      // SINGLE USE — through the service …
      const again = await otp.issue(phone);
      expect(await codeOf(team.accept({ tenantId: T, token: inv.token, phone, code: again.code }, null))).toBe('INVITE_ALREADY_USED');
      // … and at the wall: re-accepting the accepted invite as kv_app
      expect(await codeOf(asKvApp(T, uid, (cl) => cl.query(`UPDATE staff_invites SET status = 'accepted', accepted_user_id = $2, accepted_at = now() WHERE id = $1`, [inv.id, uid])))).toBe('INVITE_ALREADY_USED');
      expect(await codeOf(asKvApp(T, a1, (cl) => cl.query(`UPDATE staff_invites SET status = 'revoked', revoked_by = $2, revoked_at = now(), revoke_reason = 'revoking an accepted one' WHERE id = $1`, [inv.id, a1])))).toBe('INVITE_ALREADY_USED');
    });

    it('B2c · an EXPIRED invite is refused (and its phone can be invited again); a REVOKED one is refused; one pending invite per phone', async () => {
      const phone = phoneOf();
      const inv: any = await team.invite(T, actor(a1, adminPerms), { phone, roleCode: 'tenant_staff' }, key());
      expect(await codeOf(team.invite(T, actor(a1, adminPerms), { phone, roleCode: 'tenant_staff' }, key()))).toBe('INVITE_PENDING_EXISTS');
      await history(async (c) => { await c.query(`UPDATE staff_invites SET expires_at = now() - interval '1 minute', created_at = now() - interval '8 days' WHERE id = $1`, [inv.id]); });
      const { code } = await otp.issue(phone);
      expect(await codeOf(team.accept({ tenantId: T, token: inv.token, phone, code }, null))).toBe('INVITE_EXPIRED');
      expect(await codeOf(asKvApp(T, a1, (cl) => cl.query(`UPDATE staff_invites SET status = 'accepted', accepted_user_id = $2 WHERE id = $1`, [inv.id, a1])))).toBe('INVITE_EXPIRED');
      const inv2: any = await team.invite(T, actor(a1, adminPerms), { phone, roleCode: 'tenant_staff' }, key());   // the stale one no longer blocks the phone
      expect((await admin.query(`SELECT status FROM staff_invites WHERE id = $1`, [inv.id])).rows[0].status).toBe('expired');
      expect(await codeOf(team.revokeInvite(T, actor(a1, adminPerms), inv2.id, 'short'))).toBe('REASON_REQUIRED');
      expect(await team.revokeInvite(T, actor(a1, adminPerms), inv2.id, 'hired someone else for the desk')).toEqual({ id: inv2.id, status: 'revoked' });
      const c2 = await otp.issue(phone);
      expect(await codeOf(team.accept({ tenantId: T, token: inv2.token, phone, code: c2.code }, null))).toBe('INVITE_ALREADY_USED');
      expect((await team.lookup(T, inv2.token)).status).toBe('revoked');
      // WhatsApp is refused by name (no provider connected)
      expect(await codeOf(team.invite(T, actor(a1, adminPerms), { phone: phoneOf(), roleCode: 'tenant_staff', channel: 'whatsapp' }, key()))).toBe('WHATSAPP_NOT_CONNECTED');
    });
  });

  /* ═════════════════════════════════════════ B3 · 2FA ═════════════════════════════════════════ */
  describe('B3 · TOTP 2FA for staff', () => {
    const T = randomUUID(); let staff = ''; let staffPhone = ''; let member = ''; let noTfa = '';
    beforeAll(async () => {
      await makeTenant(admin, T, '2FA FPO');
      staff = await makeUser(admin); member = await makeUser(admin); noTfa = await makeUser(admin);
      await role(staff, T, 'fpo_coordinator'); await role(member, T, 'farmer'); await role(noTfa, T, 'tenant_staff');
      staffPhone = (await admin.query(`SELECT phone FROM users WHERE id = $1`, [staff])).rows[0].phone;
    });
    let recovery: string[] = []; let secret = '';

    it('B3a · enrol → the secret is SEALED at rest (never plaintext) and shown once; confirm with a generated TOTP mints 10 recovery codes, stored hashed', async () => {
      const a = { userId: staff, tenantId: T, ip: null, requestId: null };
      const e = await twoFactor.enrol(a);
      secret = e.secret;
      expect(e.otpauthUri).toMatch(/^otpauth:\/\/totp\/Krishalaya:.*secret=[A-Z2-7]{32}.*period=30.*digits=6.*algorithm=SHA1/);
      const row = (await admin.query(`SELECT secret_enc, confirmed_at FROM user_totp WHERE user_id = $1`, [staff])).rows[0];
      expect(row.secret_enc).toMatch(/^v2\./); expect(row.secret_enc).not.toContain(secret); expect(row.confirmed_at).toBeNull();
      expect(await codeOf(twoFactor.confirm(a, '000000' === totpCodeAt(secret, Date.now()) ? '111111' : '000000'))).toBe('TOTP_INVALID');
      const c = await twoFactor.confirm(a, totpCodeAt(secret, Date.now()));
      recovery = c.recoveryCodes;
      expect(recovery).toHaveLength(10);
      const hashes = (await admin.query(`SELECT code_hash FROM user_recovery_codes WHERE user_id = $1 AND retired_at IS NULL`, [staff])).rows.map((r) => r.code_hash);
      expect(hashes).toHaveLength(10); for (const r of recovery) expect(hashes.join(',')).not.toContain(r.replace('-', ''));
      expect(await codeOf(twoFactor.enrol(a))).toBe('TOTP_ALREADY_CONFIRMED');
    });

    it('B3b · sign-in is PENDING until the second factor; a wrong code and a REPLAYED code are refused; the next step signs in', async () => {
      const pending: any = await signIn(T, staffPhone).then(() => null, (e) => e);
      expect(pending.code).toBe('TWO_FACTOR_PENDING');
      const challenge = pending.details.challengeToken as string;
      // the pending session cannot refresh
      expect(await codeOf(auth.refreshSession({ refreshToken: challenge, tenantId: T } as never, null))).toBe('REFRESH_INVALID');
      const wrong = totpCodeAt(secret, Date.now() + 30_000) === '123456' ? '654321' : '123456';
      expect(await codeOf(auth.verifyTwoFactor({ tenantId: T, challengeToken: challenge, code: wrong } as never, null))).toBe('TOTP_INVALID');
      // the code used at confirm (same step) is a REPLAY — refused by the database's step guard
      const lastStep = Number((await admin.query(`SELECT last_used_step FROM user_totp WHERE user_id = $1`, [staff])).rows[0].last_used_step);
      expect(await codeOf(auth.verifyTwoFactor({ tenantId: T, challengeToken: challenge, code: totpCodeAt(secret, lastStep * 30_000 + 1_000) } as never, null))).toBe('TOTP_REPLAY');
      const ok = await auth.verifyTwoFactor({ tenantId: T, challengeToken: challenge, code: totpCodeAt(secret, (lastStep + 1) * 30_000 + 1_000) } as never, null).catch(async (e) => {
        // if the clock is still inside lastStep, step+1 is "the future" within ±1 — accepted; if not, the current one is fresh
        if ((e as { code?: string }).code !== 'TOTP_INVALID') throw e;
        return auth.verifyTwoFactor({ tenantId: T, challengeToken: challenge, code: totpCodeAt(secret, Date.now()) } as never, null);
      });
      expect(ok.accessToken).toBeTruthy();
      // the challenge is dead
      expect(await codeOf(auth.verifyTwoFactor({ tenantId: T, challengeToken: challenge, code: totpCodeAt(secret, Date.now()) } as never, null))).toBe('TWO_FACTOR_CHALLENGE_INVALID');
    });

    it('B3c · a RECOVERY code signs in once — the second use is refused', async () => {
      const p1: any = await signIn(T, staffPhone).then(() => null, (e) => e);
      const ok = await auth.verifyTwoFactor({ tenantId: T, challengeToken: p1.details.challengeToken, recoveryCode: recovery[0] } as never, null);
      expect(ok.accessToken).toBeTruthy();
      const p2: any = await signIn(T, staffPhone).then(() => null, (e) => e);
      expect(await codeOf(auth.verifyTwoFactor({ tenantId: T, challengeToken: p2.details.challengeToken, recoveryCode: recovery[0] } as never, null))).toBe('RECOVERY_CODE_USED');
      expect(await codeOf(asKvApp(T, staff, (cl) => cl.query(`UPDATE user_recovery_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NOT NULL`, [staff])))).toBe('RECOVERY_CODE_USED');
    });

    it('B3d · `security.require_staff_2fa` ON → TWO_FACTOR_REQUIRED for an unenrolled STAFF session (except the exempt 2FA routes); a member and an enrolled staff member pass', async () => {
      await admin.query(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'security.require_staff_2fa', 'true'::jsonb)`, [T]);
      await posture.forgetRequirement(T);
      expect(await guardCheck(ctxOf({ tenantId: T, userId: noTfa, roles: ['tenant_staff'] }))).toBe('TWO_FACTOR_REQUIRED');
      expect(await guardCheck(ctxOf({ tenantId: T, userId: noTfa, roles: ['tenant_staff'] }), true)).toBe('pass');      // /me/2fa/* stays reachable
      expect(await guardCheck(ctxOf({ tenantId: T, userId: member, roles: ['farmer'] }))).toBe('pass');
      expect(await guardCheck(ctxOf({ tenantId: T, userId: staff, roles: ['fpo_coordinator'] }))).toBe('pass');
      // OFF (no row) → nobody is asked
      const T2 = randomUUID(); await makeTenant(admin, T2, 'No 2FA'); await role(noTfa, T2, 'tenant_staff');
      expect(await guardCheck(ctxOf({ tenantId: T2, userId: noTfa, roles: ['tenant_staff'] }))).toBe('pass');
    });
  });

  /* ═════════════════════════════════════════ C · OVERRIDES + REMOVAL ═════════════════════════════════════════ */
  describe('C · overrides with a reason and a checker; remove-from-team with a reason, sessions cut; last admin / self refused; µs paging', () => {
    const T = randomUUID(); let a1 = ''; let a2 = ''; let s1 = ''; let s1Utr = ''; let s1Phone = ''; let deskId = ''; let adminPerms: Set<string>;
    beforeAll(async () => {
      await makeTenant(admin, T, 'Remove FPO');
      a1 = await makeUser(admin); a2 = await makeUser(admin); s1 = await makeUser(admin);
      await role(a1, T, 'tenant_admin'); await role(a2, T, 'tenant_admin'); s1Utr = await role(s1, T, 'fpo_coordinator', a1);
      adminPerms = await permsOf('tenant_admin');
      s1Phone = (await admin.query(`SELECT phone FROM users WHERE id = $1`, [s1])).rows[0].phone;
      deskId = await desk1(T, 'support', a1);
      await history(async (c) => { await c.query(`INSERT INTO desk_members (tenant_id, desk_id, user_id, added_by) VALUES ($1, $2, $3, $4)`, [T, deskId, s1, a1]); });
    });

    it('C1 · an override WITHOUT a reason is refused (DTO and service); an ordinary override applies with its reason recorded', async () => {
      expect(StaffOverrideSchema.safeParse({ userTenantRoleId: s1Utr, permissionCode: 'report.view', isGranted: true }).success).toBe(false);
      expect(StaffOverrideSchema.safeParse({ userTenantRoleId: s1Utr, permissionCode: 'report.view', isGranted: true, reason: 'too short' }).success).toBe(false);
      expect(await codeOf(utrSvc.setStaffOverride(T, a1, adminPerms, { userTenantRoleId: s1Utr, permissionCode: 'report.view', isGranted: true, reason: '  ' } as never, null))).toBe('REASON_REQUIRED');
      const r = await utrSvc.setStaffOverride(T, a1, adminPerms, { userTenantRoleId: s1Utr, permissionCode: 'report.view', isGranted: true, reason: 'reads the member roster for the camp' }, null);
      expect(r).toMatchObject({ status: 'applied' });
      expect((await admin.query(`SELECT reason, granted_by FROM staff_permission_overrides WHERE user_tenant_role_id = $1 AND permission_code = 'report.view'`, [s1Utr])).rows[0])
        .toEqual({ reason: 'reads the member roster for the camp', granted_by: a1 });
      expect((await admin.query(`SELECT reason FROM audit_log WHERE entity_id = $1 AND action = 'role.override_set'`, [s1Utr])).rows[0].reason).toBe('reads the member roster for the camp');
    });

    it('C2 · a MONEY permission by override becomes a PROPOSAL; the database refuses the row without a confirmed proposal; the proposer cannot confirm; a second admin can', async () => {
      const r: any = await utrSvc.setStaffOverride(T, a1, adminPerms, { userTenantRoleId: s1Utr, permissionCode: 'payout.prepare', isGranted: true, reason: 'covers payout prep while Rajesh is away' }, null);
      expect(r).toMatchObject({ status: 'proposed' });
      expect(Number((await admin.query(`SELECT count(*) n FROM staff_permission_overrides WHERE user_tenant_role_id = $1 AND permission_code = 'payout.prepare'`, [s1Utr])).rows[0].n)).toBe(0);
      // THE WALL: the override row straight in, as kv_app
      expect(await codeOf(asKvApp(T, a1, (cl) => cl.query(`INSERT INTO staff_permission_overrides (user_tenant_role_id, permission_code, is_granted, reason) VALUES ($1, 'payout.prepare', true, 'sneaking it in without a checker')`, [s1Utr])))).toBe('OVERRIDE_NEEDS_CHECKER');
      expect(await codeOf(utrSvc.confirmOverrideProposal(T, a1, r.proposalId, null))).toBe('OVERRIDE_CHECKER_IS_MAKER');
      const ok = await utrSvc.confirmOverrideProposal(T, a2, r.proposalId, null);
      expect(ok).toMatchObject({ status: 'confirmed', permission: 'payout.prepare' });
      expect((await admin.query(`SELECT reason, proposal_id FROM staff_permission_overrides WHERE user_tenant_role_id = $1 AND permission_code = 'payout.prepare'`, [s1Utr])).rows[0])
        .toEqual({ reason: 'covers payout prep while Rajesh is away', proposal_id: r.proposalId });
      await roleCache.invalidate(s1, T);
      expect((await roleCache.effectiveAccess(s1, T)).permissions).toContain('payout.prepare');
    });

    it('C3 · REMOVE needs a reason (DTO + service); it revokes the role, the overrides, the desk seat and THIS tenant\'s sessions — the old refresh token AND the old access token are refused', async () => {
      // the staff member is signed in (refresh + access)
      const t0 = await signIn(T, s1Phone);
      expect(RevokeAssignmentSchema.safeParse({}).success).toBe(false);
      expect(await codeOf(utrSvc.revoke(T, a1, s1Utr, null, null))).toBe('REASON_REQUIRED');
      expect(await guardCheck(ctxOf({ tenantId: T, userId: s1, roles: ['fpo_coordinator'], issuedAtSec: tokens.verifyAccessToken(t0.accessToken)!.iat }))).toBe('pass');
      await new Promise((res) => setTimeout(res, 1100));   // the access token's iat is whole seconds — the cut-off must be after it
      const out = await utrSvc.revoke(T, a1, s1Utr, 'left the cooperative at the end of the season', null);
      expect(out).toMatchObject({ ok: true, roleCode: 'fpo_coordinator', desksRemoved: 1, sessionEndBoundSec: 30 });
      expect(new Set(out.overridesRevoked)).toEqual(new Set(['report.view', 'payout.prepare']));
      expect((await admin.query(`SELECT is_active, revoke_reason FROM user_tenant_roles WHERE id = $1`, [s1Utr])).rows[0]).toEqual({ is_active: false, revoke_reason: 'left the cooperative at the end of the season' });
      expect(Number((await admin.query(`SELECT count(*) n FROM staff_permission_overrides WHERE user_tenant_role_id = $1 AND revoked_at IS NULL`, [s1Utr])).rows[0].n)).toBe(0);
      expect(Number((await admin.query(`SELECT count(*) n FROM desk_members WHERE user_id = $1 AND removed_at IS NULL`, [s1])).rows[0].n)).toBe(0);
      expect((await admin.query(`SELECT reason FROM audit_log WHERE entity_id = $1 AND action = 'role.revoked'`, [s1Utr])).rows[0].reason).toBe('left the cooperative at the end of the season');
      // the OLD refresh token never refreshes into this tenant again
      expect(await codeOf(auth.refreshSession({ refreshToken: t0.refreshToken, tenantId: T } as never, null))).toBe('SESSION_REVOKED');
      // the OLD access token is refused on the next request (posture cache was cleared by the act)
      expect(await guardCheck(ctxOf({ tenantId: T, userId: s1, roles: ['fpo_coordinator'], issuedAtSec: tokens.verifyAccessToken(t0.accessToken)!.iat }))).toBe('SESSION_REVOKED');
      // a NEW sign-in (a whole second later than the cut-off: iat is whole seconds) works, with whatever roles remain
      await new Promise((res) => setTimeout(res, 1100));
      const t1 = await signIn(T, s1Phone);
      expect(await guardCheck(ctxOf({ tenantId: T, userId: s1, roles: [], issuedAtSec: tokens.verifyAccessToken(t1.accessToken)!.iat }))).toBe('pass');
    });

    it('C4 · the LAST tenant_admin is never removed; nobody removes themselves', async () => {
      const T2 = randomUUID(); await makeTenant(admin, T2, 'One admin');
      const only = await makeUser(admin); const other = await makeUser(admin);
      const onlyUtr = await role(only, T2, 'tenant_admin');
      expect(await codeOf(utrSvc.revoke(T2, only, onlyUtr, 'stepping down from the board', null))).toBe('REMOVE_SELF');
      expect(await codeOf(utrSvc.revoke(T2, other, onlyUtr, 'stepping down from the board', null))).toBe('LAST_ADMIN');
      expect((await admin.query(`SELECT is_active FROM user_tenant_roles WHERE id = $1`, [onlyUtr])).rows[0].is_active).toBe(true);
    });

    it('C5 · the team table pages on the MICROSECOND (five staff in one millisecond, limit 1 → all five); pairs are derived from permissions', async () => {
      const T3 = randomUUID(); await makeTenant(admin, T3, 'Paging');
      const people: string[] = [];
      for (let i = 0; i < 5; i++) { const u = await makeUser(admin); people.push(u); const id = await role(u, T3, i === 0 ? 'tenant_admin' : 'fpo_coordinator');
        await history(async (c) => { await c.query(`UPDATE user_tenant_roles SET created_at = '2026-10-04T10:00:00.1229Z'::timestamptz + ($2 || ' microseconds')::interval WHERE id = $1`, [id, String(i * 150)]); }); }
      const seen: string[] = []; let cursor: string | null = null;
      for (let page = 0; page < 7; page++) {
        const ov: any = await team.overview(T3, actor(people[0], adminPerms), { limit: 1, cursor: cursor ? decodeKeyset(cursor, UUID_RE) : undefined });
        seen.push(...ov.staff.map((s: any) => s.userId)); cursor = ov.nextCursor; if (!cursor) break;
      }
      expect(new Set(seen)).toEqual(new Set(people)); expect(seen).toHaveLength(5);
      const ov: any = await team.overview(T3, actor(people[0], adminPerms), { limit: 25 });
      const kyc = ov.pairs.find((p: any) => p.code === 'kyc_decisions');
      expect(kyc.checkers.map((c: any) => c.userId).sort()).toEqual([...people].sort());    // tenant_admin + coordinators hold kyc.review
      const payouts = ov.pairs.find((p: any) => p.code === 'payout_batches');
      const holders = (await admin.query(`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'payout.approve'`)).rows.map((r) => r.code);
      expect(payouts.checkers.length > 0).toBe(holders.includes('tenant_admin'));
    });
  });
});
