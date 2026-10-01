// modules/identity/__tests__/tenant9a-kyc-desk.integration.spec.ts · PC-56 TENANT-9a · THE KYC DESK, live.
//
// Real PG16, the harness's test database (the real migrations + seeds), every tenant-realm query as `kv_app` under RLS.
// Run under TZ=Asia/Kolkata AND TZ=UTC: "today" is the cooperative's own date (0180 `kyc_tenant_today`), never the
// process zone. What this proves:
//   1. F-1 · a wage-role eKYC verifies the WORKER only, and does NOT open the farmer SETTLEMENT payout gate (0125's gate,
//      run exactly as PayoutService runs it); F-19 · the bank-account gate is the per-role map too;
//   2. F-2 · a renewal is a new document: the old one stays verified, the role stays verified, nothing pauses — and 0180
//      refuses a direct downgrade underneath (23514);
//   3. F-3 · the expiry job flips a lapsed document, the role reads expired, and the settlement gate closes — and the gate
//      already reads `expired` before the job runs (`kyc_role_effective_status`);
//   4. F-4/F-5 · the organisation is a subject; "organisation verified" = every REQUIRED type for its country verified, the
//      TS verdict and 0180's SQL agree; the tenant's own admin approving the organisation's document → 23514 (and the
//      verdict SELF_CERTIFICATION); maker ≠ checker; evidence before decision;
//   5. F-6 · a reveal writes its decision + audit row BEFORE the link exists; a non-holder of member.pii.reveal is refused;
//   6. F-12 · another tenant sees none of it (the desk, the record, kv_app across the wall); a NULL-tenant row cannot be forged;
//   7. F-3 · the idempotent replay: one key → one document, one decision row, one audit row;
//   8. F-7 · the queue's keyset loses no row written in the same millisecond;
//   9. F-15 · the four kyc.* events are catalogued with serving en/hi/gu templates.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { EkycSessionRepository } from '../repositories/ekyc-session.repository';
import { UserRepository } from '../repositories/user.repository';
import { KycDeskReadModel } from '../read-models/kyc-desk.read-model';
import { KycDeskService, DeskActor } from '../services/kyc-desk.service';
import { EkycService } from '../services/ekyc.service';
import { SandboxEkycProvider, SANDBOX_EKYC_OTP } from '../gateway/sandbox-ekyc.provider';
import { KycDocumentExpiryJob } from '../jobs/kyc-document-expiry.job';
import { KycExpiryRemindersJob } from '../jobs/kyc-expiry-reminders.job';
import { organisationVerdict } from '../domain/kyc-org-status';
import { PayoutRepository } from '../../payments/repositories/payout.repository';
import { kycVerdictFor } from '../../payments/domain/payout-kyc';
import { AuditRepository } from '../../audit/repositories/audit.repository';
import { GoLiveReadModel } from '../../tenancy/read-models/go-live.read-model';
import { AuditService } from '../../audit/services/audit.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
const VALID_AADHAAR = '999999990019';

run('TENANT-9a · the KYC desk (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork;
  let desk: KycDeskService; let ekyc: EkycService; let expiry: KycDocumentExpiryJob; let reminders: KycExpiryRemindersJob;
  let kycRepo: KycDocumentRepository; let utrRepo: UserTenantRoleRepository; let payouts: PayoutRepository; let readModel: KycDeskReadModel;
  const revealCalls: Array<{ mediaId: string; auditRowsAtCall: number }> = [];
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const adminU = randomUUID(); const coordU = randomUUID(); const wageWorker = randomUUID(); const renewer = randomUUID();
  const lapser = randomUUID(); const staffB = randomUUID(); const plainCoord = randomUUID();
  let adminPerms: Set<string>; let coordPerms: Set<string>; let plainPerms: Set<string>;
  const actor = (userId: string, permissions: Set<string>): DeskActor => ({ userId, permissions, ip: '203.0.113.9', requestId: 'req-9a' });

  const pgCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const refusals = async (p: Promise<unknown>) => { try { await p; return ['ok']; } catch (e) { const d = (e as any).details?.refusals; return d ? d.map((r: any) => r.code) : [(e as any).code ?? String(e)]; } };
  async function asApp<T>(tenant: string, fn: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      return await fn((sql, p) => c.query(sql, p as unknown[]));
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const permsOf = async (role: string) => new Set<string>((await admin.query(
    `SELECT rp.permission_code AS p FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [role])).rows.map((r) => r.p));
  const role = (u: string, code: string, t = tenantA, kyc = 'none') => admin.query(
    `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, kyc_status) SELECT $1, $2, id, true, $4::kyc_status FROM roles WHERE code = $3`, [u, t, code, kyc]);
  const roleStatus = async (u: string, code: string) => (await admin.query(
    `SELECT utr.kyc_status::text AS s FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id WHERE utr.tenant_id=$1 AND utr.user_id=$2 AND r.code=$3`, [tenantA, u, code])).rows[0]?.s;
  const media = async (t = tenantA, scan = 'clean', kind = 'image') => (await admin.query(
    `INSERT INTO media_assets (tenant_id, uploader_user_id, kind, s3_key, mime_type, bytes, sha256, scan_status)
     VALUES ($1, $2, $4, $3, 'image/jpeg', 1200, repeat('a', 64), $5) RETURNING id`, [t, adminU, `t/${randomUUID()}.jpg`, kind, scan])).rows[0].id as string;
  const settlementGate = (u: string) => uow.run(tenantA, async (tx) => kycVerdictFor(await payouts.rolesForPurpose(tx, 'settlement'), await payouts.callerRoleKyc(tx, tenantA, u)));
  const wageGate = (u: string) => uow.run(tenantA, async (tx) => kycVerdictFor(await payouts.rolesForPurpose(tx, 'wage'), await payouts.callerRoleKyc(tx, tenantA, u)));
  /** A verified document whose date has passed — born the only way a lapsed one exists: verified earlier. Triggers are off
   *  for THIS transaction only (superuser, session_replication_role), so the fixture writes history the API cannot. */
  const lapsedVerified = async (u: string, code: string, validUntil: string) => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`);
      const id = (await c.query(
        `INSERT INTO kyc_documents (tenant_id, subject_kind, user_id, doc_type_id, doc_type_code, status, verify_method, reviewed_by, reviewed_at, submitted_by, last_decision, valid_until)
         SELECT $1, 'user', $2, lv.id, $3::text, 'verified', 'manual', $5, now() - interval '400 days', $2, 'verify', $4::date
           FROM lookup_values lv WHERE lv.type_code='doc_type' AND lv.code=$3::text AND lv.tenant_id IS NULL ORDER BY lv.created_at LIMIT 1 RETURNING id`,
        [tenantA, u, code, validUntil, coordU])).rows[0].id;
      await c.query('COMMIT');
      return id as string;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'B');
    for (const u of [adminU, coordU, wageWorker, renewer, lapser, staffB, plainCoord]) await makeUser(admin, u);
    await role(adminU, 'tenant_admin'); await role(coordU, 'fpo_coordinator'); await role(plainCoord, 'fpo_coordinator');
    await role(wageWorker, 'worker'); await role(wageWorker, 'farmer');
    await role(renewer, 'worker'); await role(lapser, 'worker'); await role(lapser, 'farmer', tenantA, 'verified');
    await role(staffB, 'tenant_admin', tenantB);
    adminPerms = await permsOf('tenant_admin');
    plainPerms = await permsOf('fpo_coordinator');
    // the desk officer the cooperative granted the reveal by override (0128 keeps member.pii.reveal tenant_admin-only by default)
    coordPerms = new Set([...plainPerms, 'member.pii.reveal']);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const audit = new AuditWriter(pools); const idem = new PgIdempotencyService(pools);
    kycRepo = new KycDocumentRepository(replica as any); utrRepo = new UserTenantRoleRepository(replica as any);
    readModel = new KycDeskReadModel(replica as any);
    const ui = new UiMessageRepository(replica as never);
    const fakeMedia = { getDownloadUrl: async (t: string, _a: unknown, mediaId: string) => {
      const n = Number((await admin.query(`SELECT count(*) AS n FROM audit_log WHERE tenant_id=$1 AND action='kyc.document.revealed'`, [t])).rows[0].n);
      revealCalls.push({ mediaId, auditRowsAtCall: n });
      return { mediaId, url: `https://signed.example/${mediaId}`, expiresInSec: 900 };
    } };
    desk = new KycDeskService(uow, outbox, audit, idem, kycRepo, utrRepo, readModel, ui, fakeMedia as any);
    ekyc = new EkycService(uow, outbox, new SandboxEkycProvider(), audit, new EkycSessionRepository(replica as any), new UserRepository(replica as any), kycRepo, utrRepo);
    expiry = new KycDocumentExpiryJob(uow, outbox, audit, kycRepo, utrRepo, ui);
    reminders = new KycExpiryRemindersJob(uow, outbox, kycRepo, ui);
    payouts = new PayoutRepository(replica as any);
  }, 60000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); await app?.end(); });

  it('F-1 · a wage-role eKYC verifies the WORKER only and does NOT open the farmer settlement payout gate', async () => {
    const started = await ekyc.start(tenantA, wageWorker, { docType: 'aadhaar', idNumber: VALID_AADHAAR });
    await ekyc.verify(tenantA, wageWorker, { sessionId: started.id, otp: SANDBOX_EKYC_OTP });
    expect([await roleStatus(wageWorker, 'worker'), await roleStatus(wageWorker, 'farmer')]).toEqual(['verified', 'none']);
    const settlement = await settlementGate(wageWorker);
    expect(settlement).toMatchObject({ allowed: false, reason: 'eligible_role_unverified', decidingRole: 'farmer', decidingStatus: 'none' });
    expect(await wageGate(wageWorker)).toMatchObject({ allowed: true, decidingRole: 'worker' });
    const d = (await admin.query(`SELECT status, reviewed_by, verify_method, doc_type_code FROM kyc_documents WHERE tenant_id=$1 AND user_id=$2`, [tenantA, wageWorker])).rows;
    expect(d).toEqual([{ status: 'verified', reviewed_by: null, verify_method: 'ekyc:sandbox', doc_type_code: 'aadhaar' }]);
    const dec = (await admin.query(`SELECT act, via, decided_by FROM kyc_document_decisions WHERE tenant_id=$1 AND document_id IN (SELECT id FROM kyc_documents WHERE user_id=$2)`, [tenantA, wageWorker])).rows;
    expect(dec).toEqual([{ act: 'verify', via: 'ekyc', decided_by: null }]);
    // F-19 · the worker is a payee (wage), so the destination may be added; a customer verified the same way may not.
    expect(await utrRepo.callerKycVerified(tenantA, wageWorker)).toBe(true);
    const cust = randomUUID(); await makeUser(admin, cust); await role(cust, 'customer', tenantA, 'verified');
    expect(await utrRepo.callerKycVerified(tenantA, cust)).toBe(false);
  });

  it('F-1 · an eKYC whose NAME does not match verifies nothing — it is filed pending for the desk', async () => {
    const u = randomUUID(); await makeUser(admin, u); await role(u, 'worker');
    class Mismatch extends SandboxEkycProvider { async verify(i: any) { return { ...(await super.verify(i)), nameMatch: false }; } }
    const e2 = new EkycService(uow, new PgOutboxWriter(), new Mismatch(), new AuditWriter(pools), new EkycSessionRepository(new PgReadReplicaProvider(pools, new ShardRouter(new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' }))) as any), new UserRepository(new PgReadReplicaProvider(pools, new ShardRouter(new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' }))) as any), kycRepo, utrRepo);
    const s1 = await e2.start(tenantA, u, { docType: 'aadhaar', idNumber: VALID_AADHAAR });
    await e2.verify(tenantA, u, { sessionId: s1.id, otp: SANDBOX_EKYC_OTP });
    expect(await roleStatus(u, 'worker')).toBe('pending');
    const d = (await admin.query(`SELECT status::text, reviewed_by FROM kyc_documents WHERE tenant_id=$1 AND user_id=$2`, [tenantA, u])).rows;
    expect(d).toEqual([{ status: 'pending', reviewed_by: null }]);
  });

  it('F-2 · a renewal is a NEW document: the old one stays verified, the role stays verified, nothing pauses; 0180 refuses a direct downgrade', async () => {
    const m1 = await media();
    const first = await desk.submit(tenantA, actor(adminU, adminPerms), { subjectKind: 'user', userId: renewer, docTypeCode: 'aadhaar', mediaId: m1, validUntil: '2099-01-31' }, randomUUID());
    expect(first).toMatchObject({ status: 'pending', evidences: ['worker'], follows: null });
    expect(await roleStatus(renewer, 'worker')).toBe('pending');
    await desk.act(tenantA, actor(coordU, coordPerms), first.id, 'reveal', { note: 'checking the photo against the member register' }, randomUUID());
    await desk.act(tenantA, actor(coordU, coordPerms), first.id, 'verify', {}, randomUUID());
    expect(await roleStatus(renewer, 'worker')).toBe('verified');

    const m2 = await media();
    const renewal = await desk.submit(tenantA, actor(adminU, adminPerms), { subjectKind: 'user', userId: renewer, docTypeCode: 'aadhaar', mediaId: m2, validUntil: '2099-12-31' }, randomUUID());
    expect(renewal).toMatchObject({ status: 'pending', follows: { id: first.id, kind: 'renewal' }, roleWrites: [] });
    const both = (await admin.query(`SELECT id, status, supersedes_id FROM kyc_documents WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at`, [tenantA, renewer])).rows;
    expect(both).toEqual([{ id: first.id, status: 'verified', supersedes_id: null }, { id: renewal.id, status: 'pending', supersedes_id: first.id }]);
    expect(await roleStatus(renewer, 'worker')).toBe('verified');
    // the old way (every role → pending) as kv_app, underneath the service:
    const direct = await asApp(tenantA, (q) => pgCode(q(`UPDATE user_tenant_roles SET kyc_status='pending' WHERE tenant_id=$1 AND user_id=$2`, [tenantA, renewer])));
    expect(direct).toBe('23514');
    // a second open submission of the same type is refused (review + 0180's partial unique index)
    expect(await refusals(desk.submit(tenantA, actor(adminU, adminPerms), { subjectKind: 'user', userId: renewer, docTypeCode: 'aadhaar', mediaId: m2, validUntil: '2099-12-31' }, randomUUID()))).toEqual(['DUPLICATE_OPEN_SUBMISSION']);
  });

  it('F-3 · the gate reads validity before the job runs; the expiry job flips the document, the role reads expired, the gate closes', async () => {
    const lap = await lapsedVerified(lapser, 'land_record', '2026-01-31');
    await admin.query(`UPDATE user_tenant_roles utr SET kyc_status='verified' FROM roles r WHERE r.id=utr.role_id AND utr.user_id=$1 AND r.code='farmer'`, [lapser]);
    // before the job: recorded verified, EFFECTIVE expired — the settlement gate is already closed
    expect(await roleStatus(lapser, 'farmer')).toBe('verified');
    expect(await settlementGate(lapser)).toMatchObject({ allowed: false, decidingRole: 'farmer', decidingStatus: 'expired' });
    // F-19 · and the bank-account gate reads the same effective status: a lapsed seller cannot add a payout destination
    expect(await utrRepo.callerKycVerified(tenantA, lapser)).toBe(false);
    const n = await expiry.runForTenant(tenantA);
    expect(n).toBeGreaterThanOrEqual(1);
    const row = (await admin.query(`SELECT status, last_decision, expired_at IS NOT NULL AS stamped FROM kyc_documents WHERE id=$1`, [lap])).rows[0];
    expect(row).toEqual({ status: 'expired', last_decision: 'expire', stamped: true });
    expect(await roleStatus(lapser, 'farmer')).toBe('expired');
    expect(await settlementGate(lapser)).toMatchObject({ allowed: false, decidingStatus: 'expired' });
    const dec = (await admin.query(`SELECT act, via, decided_by FROM kyc_document_decisions WHERE document_id=$1`, [lap])).rows;
    expect(dec).toEqual([{ act: 'expire', via: 'expiry_job', decided_by: null }]);
    const evt = (await admin.query(`SELECT payload FROM outbox_events WHERE event_type='identity.kyc_expired' AND aggregate_id=$1`, [lap])).rows;
    expect(evt.length).toBe(1);
    expect(evt[0].payload).toMatchObject({ notifyUserId: lapser, docTypeCode: 'land_record', day: '31/01/2026', document: { en: 'land record', gu: 'જમીનનો રેકર્ડ' } });
    // a second tick changes nothing; an expiry with the date not yet passed is refused underneath
    expect(await expiry.runForTenant(tenantA)).toBe(0);
    const fresh = (await admin.query(`SELECT id FROM kyc_documents WHERE tenant_id=$1 AND user_id=$2 AND status='verified' LIMIT 1`, [tenantA, renewer])).rows[0].id;
    expect(await asApp(tenantA, (q) => pgCode(q(`UPDATE kyc_documents SET status='expired' WHERE id=$1`, [fresh])))).toBe('23514');
  });

  it('F-3 · a reminder goes ONCE, with the document named per language', async () => {
    const m = await media();
    const lic = await desk.submit(tenantA, actor(adminU, adminPerms), { subjectKind: 'organisation', docTypeCode: 'fssai_licence', mediaId: m, validUntil: await (async () => (await admin.query(`SELECT (kyc_tenant_today($1) + 10)::text AS d`, [tenantA])).rows[0].d)() }, randomUUID());
    await desk.act(tenantA, actor(coordU, coordPerms), lic.id, 'reveal', { note: 'reading the licence number and its date' }, randomUUID());
    await desk.act(tenantA, actor(coordU, coordPerms), lic.id, 'verify', {}, randomUUID());
    const first = await reminders.runForTenant(tenantA, 30);
    const second = await reminders.runForTenant(tenantA, 30);
    expect([first >= 1, second]).toEqual([true, 0]);
    const evt = (await admin.query(`SELECT payload FROM outbox_events WHERE event_type='identity.kyc_expiring' AND aggregate_id=$1`, [lic.id])).rows;
    expect(evt.length).toBe(1);
    expect(evt[0].payload).toMatchObject({ notifyUserId: adminU, docTypeCode: 'fssai_licence', document: { en: 'FSSAI licence' } });
  });

  it('F-4/F-5 · the organisation verifies on its REQUIRED types, by somebody who is not its admin; SQL and TS agree', async () => {
    const before = await readModel.organisationStatusSql(tenantA);
    expect(before).toMatchObject({ verified: false, required: 2, satisfied: 0 });
    const reg = await desk.submit(tenantA, actor(adminU, adminPerms), { subjectKind: 'organisation', docTypeCode: 'society_registration', mediaId: await media(), docNoMasked: 'GUJ/AND/2019/00••4' }, randomUUID());
    const pan = await desk.submit(tenantA, actor(adminU, adminPerms), { subjectKind: 'organisation', docTypeCode: 'pan_org', mediaId: await media(), docNoMasked: 'AAB••••••C' }, randomUUID());
    // the tenant's own admin cannot certify the tenant — the verdict, and 0180 underneath as kv_app
    const admin2 = randomUUID(); await makeUser(admin, admin2); await role(admin2, 'tenant_admin');
    await desk.act(tenantA, actor(admin2, adminPerms), reg.id, 'reveal', { note: 'second admin opening the certificate' }, randomUUID());
    expect(await refusals(desk.act(tenantA, actor(admin2, adminPerms), reg.id, 'verify', {}, randomUUID()))).toEqual(['SELF_CERTIFICATION']);
    expect(await asApp(tenantA, (q) => pgCode(q(`UPDATE kyc_documents SET status='verified', reviewed_by=$2, reviewed_at=now() WHERE id=$1`, [reg.id, admin2])))).toBe('23514');
    // maker ≠ checker as kv_app too
    expect(await asApp(tenantA, (q) => pgCode(q(`UPDATE kyc_documents SET status='verified', reviewed_by=$2, reviewed_at=now() WHERE id=$1`, [reg.id, adminU])))).toBe('23514');
    // evidence before decision: the coordinator has not opened it yet
    expect(await refusals(desk.act(tenantA, actor(coordU, coordPerms), reg.id, 'verify', {}, randomUUID()))).toEqual(['EVIDENCE_NOT_REVEALED']);
    for (const d of [reg, pan]) {
      await desk.act(tenantA, actor(coordU, coordPerms), d.id, 'reveal', { note: 'reading the certificate before deciding' }, randomUUID());
      await desk.act(tenantA, actor(coordU, coordPerms), d.id, 'verify', {}, randomUUID());
    }
    const after = await readModel.organisationStatusSql(tenantA);
    const org = await readModel.organisation(tenantA);
    const ts = organisationVerdict(org.requirements, org.docs, org.today);
    expect(after).toMatchObject({ verified: true, required: 2, satisfied: 2 });
    expect({ verified: ts.verified, missing: ts.missingRequired }).toEqual({ verified: true, missing: [] });
    const ov = await desk.overview(tenantA, actor(coordU, coordPerms));
    expect(ov.organisation).toMatchObject({ verified: true, reason: 'all_required_verified' });
    // the go-live step reads it (F-4: not any buyer's profile) — verified here, and not for a tenant with nothing on file
    const goLive = new GoLiveReadModel(new PgReadReplicaProvider(pools, new ShardRouter(new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' }))) as any);
    expect((await goLive.facts(tenantA))!.kycVerified).toBe(true);
    expect((await goLive.facts(tenantB))!.kycVerified).toBe(false);
    // and a buyer's verified business profile no longer stands in for the organisation
    await admin.query(`INSERT INTO business_kyc_profiles (tenant_id, user_id, business_type, legal_name, pan_masked, status, reviewed_at) VALUES ($1, $2, 'trader', 'Some Buyer', 'ABC••••12F', 'verified', now())`, [tenantB, staffB]).catch(() => undefined);
    expect((await goLive.facts(tenantB))!.kycVerified).toBe(false);
  });

  it('F-6 · a reveal is recorded BEFORE the link exists; a non-holder of member.pii.reveal is refused; a request-more says why', async () => {
    const m = await media();
    const d = await desk.submit(tenantA, actor(adminU, adminPerms), { subjectKind: 'user', userId: wageWorker, docTypeCode: 'land_record', mediaId: m }, randomUUID());
    expect(await refusals(desk.act(tenantA, actor(plainCoord, plainPerms), d.id, 'reveal', { note: 'I would like to see this document' }, randomUUID()))).toEqual(['NO_PERMISSION']);
    expect(await refusals(desk.act(tenantA, actor(coordU, coordPerms), d.id, 'reveal', { note: 'too short' }, randomUUID()))).toEqual(['REVEAL_REASON_TOO_SHORT']);
    const before = revealCalls.length;
    const r = await desk.act(tenantA, actor(coordU, coordPerms), d.id, 'reveal', { note: 'matching the land record survey number' }, randomUUID());
    expect(r.url).toBe(`https://signed.example/${m}`);
    const call = revealCalls[before];
    expect(call.mediaId).toBe(m);
    expect(call.auditRowsAtCall).toBeGreaterThanOrEqual(1);
    const aud = (await admin.query(`SELECT actor_user_id, reason, new_value FROM audit_log WHERE tenant_id=$1 AND action='kyc.document.revealed' AND entity_id=$2`, [tenantA, d.id])).rows;
    expect(aud).toEqual([{ actor_user_id: coordU, reason: 'matching the land record survey number', new_value: { field: 'evidence', mediaId: m } }]);
    // ask for more, with a coded ground — the member is told, by the reason's words in each language
    const more = await desk.act(tenantA, actor(coordU, coordPerms), d.id, 'request_more', { reasonCode: 'back_side_missing' }, randomUUID());
    expect(more.status).toBe('rejected');
    const evt = (await admin.query(`SELECT payload FROM outbox_events WHERE event_type='identity.kyc_rejected' AND aggregate_id=$1`, [d.id])).rows[0].payload;
    expect(evt).toMatchObject({ notifyUserId: wageWorker, reasonCode: 'back_side_missing', decision: 'request_more', reason: { en: 'the other side of the document is missing' } });
    const rec = await desk.record(tenantA, actor(coordU, coordPerms), d.id);
    expect(rec.history.map((h) => h.act)).toEqual(['request_more', 'reveal', 'submit']);
    expect(rec.history.find((h) => h.act === 'reveal')!.note).toBeNull();   // the reveal's reason is the audit trail's, not the page's
    expect(await roleStatus(wageWorker, 'farmer')).toBe('rejected');
    expect(await roleStatus(wageWorker, 'worker')).toBe('verified');
  });

  it('F-12 · another tenant sees none of it; a NULL-tenant "platform" document cannot be forged from a tenant context', async () => {
    await expect(desk.record(tenantB, actor(staffB, adminPerms), (await admin.query(`SELECT id FROM kyc_documents WHERE tenant_id=$1 LIMIT 1`, [tenantA])).rows[0].id)).rejects.toMatchObject({ code: 'KYC_NOT_FOUND' });
    const q = await desk.queue(tenantB, actor(staffB, adminPerms), { limit: 50 });
    expect(q.items).toEqual([]);
    const seen = await asApp(tenantB, async (qq) => Number((await qq(`SELECT count(*) AS n FROM kyc_documents WHERE tenant_id=$1`, [tenantA])).rows[0].n));
    expect(seen).toBe(0);
    const dec = await asApp(tenantB, async (qq) => Number((await qq(`SELECT count(*) AS n FROM kyc_document_decisions WHERE tenant_id=$1`, [tenantA])).rows[0].n));
    expect(dec).toBe(0);
    const forged = await asApp(tenantA, (qq) => pgCode(qq(
      `INSERT INTO kyc_documents (tenant_id, user_id, doc_type_id, status, verify_method, submitted_by)
       SELECT NULL, $1, id, 'pending', 'manual', $1 FROM lookup_values WHERE type_code='doc_type' AND code='aadhaar' LIMIT 1`, [renewer])));
    expect(forged).toBe('42501');
    const del = await asApp(tenantA, (qq) => pgCode(qq(`DELETE FROM kyc_documents WHERE tenant_id=$1`, [tenantA])));
    expect(del).toBe('42501');
    expect(await refusals(desk.overview(tenantA, actor(renewer, new Set())))).toEqual(['KYC_DESK_RESTRICTED']);
  });

  it('idempotent replay: one key → one document, one submit decision, one audit row', async () => {
    const key = randomUUID(); const m = await media();
    const u = randomUUID(); await makeUser(admin, u); await role(u, 'vyapari');
    const input = { subjectKind: 'user', userId: u, docTypeCode: 'pan', mediaId: m, docNoMasked: 'ABC••••12F' };
    const [a, b] = await Promise.allSettled([desk.submit(tenantA, actor(adminU, adminPerms), input, key), desk.submit(tenantA, actor(adminU, adminPerms), input, key)]);
    const c = await desk.submit(tenantA, actor(adminU, adminPerms), input, key);
    const ids = [a, b].filter((x) => x.status === 'fulfilled').map((x) => (x as PromiseFulfilledResult<any>).value.id);
    expect(new Set([...ids, c.id]).size).toBe(1);
    expect(Number((await admin.query(`SELECT count(*) AS n FROM kyc_documents WHERE tenant_id=$1 AND user_id=$2`, [tenantA, u])).rows[0].n)).toBe(1);
    expect(Number((await admin.query(`SELECT count(*) AS n FROM kyc_document_decisions WHERE document_id=$1 AND act='submit'`, [c.id])).rows[0].n)).toBe(1);
    expect(Number((await admin.query(`SELECT count(*) AS n FROM audit_log WHERE tenant_id=$1 AND action='kyc.document.submitted' AND entity_id=$2`, [tenantA, c.id])).rows[0].n)).toBe(1);
  });

  it('F-7 · the queue keyset loses no row written in the same millisecond', async () => {
    const t = randomUUID(); await makeTenant(admin, t, 'Q');
    const people = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = replica`);
      let i = 0;
      for (const p of people) {
        await makeUser(admin, p);
        await c.query(`INSERT INTO kyc_documents (tenant_id, subject_kind, user_id, doc_type_id, doc_type_code, status, verify_method, submitted_by, last_decision, created_at)
          SELECT $1, 'user', $2, lv.id, 'aadhaar', 'pending', 'manual', $2, 'submit', '2026-10-04T10:00:00.1229Z'::timestamptz + ($3 || ' microseconds')::interval
            FROM lookup_values lv WHERE lv.type_code='doc_type' AND lv.code='aadhaar' AND lv.tenant_id IS NULL ORDER BY lv.created_at LIMIT 1`, [t, p, String(i++ * 300)]);
      }
      await c.query('COMMIT');
    } finally { c.release(); }
    const seen: string[] = []; let cursor: any;
    for (let page = 0; page < 6; page++) {
      const r = await desk.queue(t, actor(adminU, adminPerms), { limit: 1, cursor });
      seen.push(...r.items.map((x) => x.userId!));
      if (!r.nextCursor) break;
      const { decodeKeyset, UUID_RE } = await import('../domain/kyc-cursor');
      cursor = decodeKeyset(r.nextCursor, UUID_RE);
    }
    expect(new Set(seen)).toEqual(new Set(people));
  });

  it('F-7 · the AUDIT TRAIL keyset loses no row written in the same millisecond (the survey\'s probe, re-run)', async () => {
    const t = randomUUID(); await makeTenant(admin, t, 'AuditProbe');
    for (const [a, us] of [['probe.a', '.122900'], ['probe.b', '.123100'], ['probe.c', '.123400'], ['probe.d', '.123700']]) {
      await admin.query(`INSERT INTO audit_log (tenant_id, action, entity_type, created_at) VALUES ($1, $2, 'probe', $3::timestamptz)`, [t, a, `2026-10-04T10:00:00${us}Z`]);
    }
    const svc = new AuditService(new AuditRepository(new PgReadReplicaProvider(pools, new ShardRouter(new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' }))) as any));
    const seen: string[] = []; let cursor: string | undefined;
    for (let i = 0; i < 6; i++) {
      const r = await svc.list(t, { canRead: true } as any, { limit: 1, cursor } as any);
      seen.push(...r.items.map((x: any) => x.action));
      if (!r.nextCursor) break; cursor = r.nextCursor;
    }
    expect(seen).toEqual(['probe.d', 'probe.c', 'probe.b', 'probe.a']);
  });

  it('F-15 · kyc.approved / rejected / expiring / expired are catalogued with SERVING templates in en, hi and gu', async () => {
    const r = (await admin.query(
      `SELECT e.code, t.channel, t.language_code FROM notification_events e JOIN notification_templates t ON t.event_code = e.code
        WHERE e.code LIKE 'kyc.%' AND t.tenant_id IS NULL AND t.serving_version_id IS NOT NULL ORDER BY 1,2,3`)).rows;
    expect(r.length).toBe(24);
    expect(new Set(r.map((x) => x.code))).toEqual(new Set(['kyc.approved', 'kyc.rejected', 'kyc.expiring', 'kyc.expired']));
  });
});
