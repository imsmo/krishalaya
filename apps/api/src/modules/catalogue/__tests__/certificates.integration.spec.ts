// modules/catalogue/__tests__/certificates.integration.spec.ts
// REAL end-to-end proof of the certificates slice against a live Postgres (no infra mocks). Verifies:
//   1. submit a certificate → persists (status pending, tenant_id = caller) + emits catalogue.certificate_submitted
//      to the outbox in the SAME tx; idempotent (same key → same id);
//   2. the moderator decision verify → status verified + verified_by + an audit_log row + certificate_verified event;
//   3. the regulated-rule resolver returns a GLOBAL rule applying to the product's category;
//   4. ROW-LEVEL SECURITY: tenant B cannot read tenant A's certificate (getById → 404 via RLS).
// Requires DATABASE_URL (kv_app). DATABASE_ADMIN_URL (superuser) loads fixtures.
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
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { CertificateRepository } from '../repositories/certificate.repository';
import { CertificateService } from '../services/certificate.service';
import { RegulatedRuleRepository } from '../repositories/regulated-rule.repository';
import { RegulatedRuleService } from '../services/regulated-rule.service';
import { CertificateNotFoundError } from '../domain/catalogue.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('catalogue certificates (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let certs: CertificateService; let rules: RegulatedRuleService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const user = randomUUID();
  const tag = Date.now().toString(36).slice(-6);
  const categoryId = randomUUID(); const productId = randomUUID(); let certTypeId = ''; let createdId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, user);   // PC-56 TEST-1: certificates.owner_user_id REFERENCES users — the owner must be a real user
    // a cert_type lookup value, a shared category, a platform product on it, and a national regulated rule.
    await admin.query(`INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('cert_type','Certificate type',false) ON CONFLICT (code) DO NOTHING`);
    const lv = await admin.query(`INSERT INTO lookup_values (type_code, tenant_id, code, default_name) VALUES ('cert_type',NULL,$1,'NPOP Organic') RETURNING id`, [`npop_${tag}`]);
    certTypeId = lv.rows[0].id;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Cert Crops',$3::ltree,1,true) ON CONFLICT (id) DO NOTHING`, [categoryId, `cert_crops_${tag}`, `cert_crops_${tag}`]);
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal','Quintal','mass',true) ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active) VALUES ($1,$2,'Pesticide X','quintal',NULL,true) ON CONFLICT (id) DO NOTHING`, [productId, categoryId]);
    await admin.query(`INSERT INTO regulated_product_rules (category_id, rule_type, payload, effective_from) VALUES ($1,'license_required','{}',CURRENT_DATE)`, [categoryId]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards); const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const repo = new CertificateRepository(replica as any);
    certs = new CertificateService(uow, outbox, idem, metrics, audit, repo);
    rules = new RegulatedRuleService(metrics, new RegulatedRuleRepository(replica as any));
  }, 30000);

  afterAll(async () => {
    if (admin) {
      if (createdId) await admin.query(`DELETE FROM certificates WHERE id=$1`, [createdId]).catch(() => undefined);
      await admin.query(`DELETE FROM regulated_product_rules WHERE category_id=$1`, [categoryId]).catch(() => undefined);
      await admin.query(`DELETE FROM products WHERE id=$1`, [productId]).catch(() => undefined);
      await admin.query(`DELETE FROM categories WHERE id=$1`, [categoryId]).catch(() => undefined);
      if (certTypeId) await admin.query(`DELETE FROM lookup_values WHERE id=$1`, [certTypeId]).catch(() => undefined);
      await admin.end();
    }
    await pools?.onModuleDestroy();
  });

  it('submit → pending + outbox; idempotent; verify → verified + audit', async () => {
    const key = `idem-${randomUUID()}`;
    const a = await certs.submit(tenantA, user, key, { certTypeId, subjectType: 'product', subjectId: productId, certNo: 'NPOP-1', issuingBody: 'APEDA' } as any);
    createdId = a.id;
    const b = await certs.submit(tenantA, user, key, { certTypeId, subjectType: 'product', subjectId: productId, certNo: 'NPOP-1', issuingBody: 'APEDA' } as any);
    expect(b.id).toBe(a.id);   // idempotent

    const row = await admin.query(`SELECT tenant_id, status FROM certificates WHERE id=$1`, [a.id]);
    expect(row.rows[0].tenant_id).toBe(tenantA);
    expect(row.rows[0].status).toBe('pending');
    const ev = await admin.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='catalogue.certificate_submitted'`, [a.id]);
    expect(ev.rowCount).toBe(1);

    await certs.decide(tenantA, user, a.id, { decision: 'verify', validUntil: '2999-12-31' } as any, '127.0.0.1');
    const after = await admin.query(`SELECT status, verified_by FROM certificates WHERE id=$1`, [a.id]);
    expect(after.rows[0].status).toBe('verified');
    expect(after.rows[0].verified_by).toBe(user);
    const au = await admin.query(`SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='catalogue.certificate_verified'`, [a.id]);
    expect(au.rowCount).toBe(1);
  });

  it('regulated-rule resolver returns the global rule on the category', async () => {
    const got: any = await rules.resolve(tenantA, { productId, categoryId } as any);
    expect(got.some((r: any) => r.ruleType === 'license_required')).toBe(true);
  });

  it('RLS: tenant B cannot read tenant A certificate', async () => {
    await expect(certs.getById(tenantB, createdId)).rejects.toBeInstanceOf(CertificateNotFoundError);
  });
});
