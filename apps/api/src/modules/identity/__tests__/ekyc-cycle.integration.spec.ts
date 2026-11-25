// modules/identity/__tests__/ekyc-cycle.integration.spec.ts
// REAL end-to-end proof of the eKYC flow against a live Postgres (concrete UoW + RLS + outbox + audit), using the
// deterministic SandboxEkycProvider (fixed OTP). It proves the security-critical contract:
//   1. start(aadhaar) → a session is persisted with ONLY a masked id + last-4 (the raw Aadhaar is NOWHERE in the DB);
//   2. verify(123456) → users.aadhaar_vault_ref + aadhaar_last4 are set (opaque vault ref, never the raw id), a
//      VERIFIED kyc_documents row exists (no media), and an audit row + outbox event were written IN-TX;
//   3. anti-IDOR: another user cannot verify the first user's session (404, no enumeration);
//   4. a wrong OTP fails (422) and never sets a vault ref;
//   5. NO raw Aadhaar string appears in users / ekyc_sessions / kyc_documents / audit_log / outbox.
// Requires DATABASE_URL (kv_app role). Schema+seeds come from the real db/migrations+seeds via global setup.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { EkycService } from '../services/ekyc.service';
import { SandboxEkycProvider, SANDBOX_EKYC_OTP } from '../gateway/sandbox-ekyc.provider';
import { EkycSessionRepository } from '../repositories/ekyc-session.repository';
import { UserRepository } from '../repositories/user.repository';
import { KycDocumentRepository } from '../repositories/kyc-document.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { EkycSessionNotFoundError, EkycVerificationFailedError } from '../domain/identity.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

const VALID_AADHAAR = '999999990019';   // Verhoeff-valid test Aadhaar (UIDAI sample)

run('eKYC cycle (integration, real Postgres + RLS, sandbox provider)', () => {
  let pools: PgPoolProvider;
  let inspect: Pool;
  let svc: EkycService;
  const tenant = randomUUID();
  const userId = randomUUID();
  const otherUser = randomUUID();

  beforeAll(async () => {
    const a = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(a, tenant, 'EKYC');
    await makeUser(a, userId); await makeUser(a, otherUser);
    await a.end();

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    svc = new EkycService(
      uow, new PgOutboxWriter(), new SandboxEkycProvider(), new AuditWriter(pools),
      new EkycSessionRepository(replica as any), new UserRepository(replica as any),
      new KycDocumentRepository(replica as any), new UserTenantRoleRepository(replica as any),
    );
    // PC-56 TEST-1: the assertion reads run as the OWNER. As kv_app with no `app.tenant_id` they were hidden by RLS — the session and
    // KYC rows read back as nothing, and "the raw Aadhaar appears in no table" passed vacuously because no row was visible to search.
    inspect = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); });

  it('start persists a session with masked id + last-4 only — never the raw Aadhaar', async () => {
    const started = await svc.start(tenant, userId, { docType: 'aadhaar', idNumber: VALID_AADHAAR, fullName: 'Test User' });
    expect(started.maskedId).toBe('XXXXXXXX0019');
    const row = await inspect.query(`SELECT masked_id, last4, provider_ref, status FROM ekyc_sessions WHERE id=$1`, [started.id]);
    expect(row.rows[0].masked_id).toBe('XXXXXXXX0019');
    expect(row.rows[0].last4).toBe('0019');
    expect(row.rows[0].status).toBe('pending');
    // the raw Aadhaar must not be anywhere in the session row
    expect(JSON.stringify(row.rows[0])).not.toContain(VALID_AADHAAR);
  });

  it('verify(123456) sets the vault ref + last-4 on the user and writes a verified KYC doc (no raw id stored)', async () => {
    const started = await svc.start(tenant, userId, { docType: 'aadhaar', idNumber: VALID_AADHAAR });
    const res = await svc.verify(tenant, userId, { sessionId: started.id, otp: SANDBOX_EKYC_OTP });
    expect(res.status).toBe('verified');

    const u = await inspect.query(`SELECT aadhaar_vault_ref, aadhaar_last4 FROM users WHERE id=$1`, [userId]);
    expect(u.rows[0].aadhaar_vault_ref).toMatch(/^vault_/);
    expect(u.rows[0].aadhaar_last4).toBe('0019');

    const doc = await inspect.query(`SELECT status, verify_method, media_id FROM kyc_documents WHERE user_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 1`, [userId, tenant]);
    expect(doc.rows[0].status).toBe('verified');
    expect(doc.rows[0].verify_method).toBe('ekyc:sandbox');
    expect(doc.rows[0].media_id).toBeNull();

    // audit + outbox written
    const aud = await inspect.query(`SELECT count(*)::int n FROM audit_log WHERE entity_type='ekyc_session' AND action='identity.ekyc.verified'`);
    expect(aud.rows[0].n).toBeGreaterThanOrEqual(1);
    const evt = await inspect.query(`SELECT count(*)::int n FROM outbox_events WHERE event_type='identity.ekyc_verified'`);
    expect(evt.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('anti-IDOR: a different user cannot verify someone else\'s session (404)', async () => {
    const started = await svc.start(tenant, userId, { docType: 'pan', idNumber: 'ABCDE1234F' });
    await expect(svc.verify(tenant, otherUser, { sessionId: started.id, otp: SANDBOX_EKYC_OTP })).rejects.toBeInstanceOf(EkycSessionNotFoundError);
  });

  it('a wrong OTP fails and the user PAN vault ref stays unset', async () => {
    const started = await svc.start(tenant, otherUser, { docType: 'pan', idNumber: 'ABCDE1234F' });
    await expect(svc.verify(tenant, otherUser, { sessionId: started.id, otp: '000000' })).rejects.toBeInstanceOf(EkycVerificationFailedError);
    const u = await inspect.query(`SELECT pan_vault_ref FROM users WHERE id=$1`, [otherUser]);
    expect(u.rows[0].pan_vault_ref).toBeNull();
  });

  it('the raw Aadhaar appears in NO persisted table (users/sessions/kyc/audit/outbox)', async () => {
    for (const q of [
      `SELECT count(*)::int n FROM ekyc_sessions WHERE masked_id LIKE '%${VALID_AADHAAR}%' OR provider_ref LIKE '%${VALID_AADHAAR}%'`,
      `SELECT count(*)::int n FROM users WHERE aadhaar_vault_ref LIKE '%${VALID_AADHAAR}%'`,
      `SELECT count(*)::int n FROM kyc_documents WHERE doc_no_masked LIKE '%${VALID_AADHAAR}%'`,
      `SELECT count(*)::int n FROM audit_log WHERE new_value::text LIKE '%${VALID_AADHAAR}%'`,
      `SELECT count(*)::int n FROM outbox_events WHERE payload::text LIKE '%${VALID_AADHAAR}%'`,
    ]) {
      const r = await inspect.query(q);
      expect(r.rows[0].n).toBe(0);
    }
  });
});
