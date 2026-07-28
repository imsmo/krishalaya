// modules/insurance/__tests__/insurance-claim.rls.integration.spec.ts
// RLS PROBE for `insurance_claims` (DEV-23, KV-BL-054) — EXTENDS DEV-22's
// insurance-policy.rls.integration.spec.ts pattern verbatim (same fixture style, same probes:
// cross-tenant read, cross-tenant write, FORCE ROW SECURITY check) to cover the new claims table.
// insurance_claims is RLS-enabled+forced by the same migration-0014 generic tenant-RLS backfill loop as
// insurance_policies (0011_fintech_schemes.sql predates 0014). No version column on this table either —
// mutations go through repo.getForUpdate()'s FOR UPDATE lock, not optimistic concurrency.
// Guarded by DATABASE_URL — skips cleanly when no test Postgres is configured (repo-wide convention).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeUser } from '../../../../test/helpers/fixtures';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('insurance_claims RLS (integration, real Postgres)', () => {
  let admin: Pool;
  let inspect: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let holder = '';
  let partnerId = '';
  let productId = '';
  let policyId = '';
  let claimId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    inspect = new Pool({ connectionString: APP_URL });

    await admin.query(`INSERT INTO countries (code, default_name, currency_code, phone_prefix) VALUES ('IN','India','INR','+91') ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('tenant_type','Tenant Type') ON CONFLICT (code) DO NOTHING`);
    const tenantTypeId = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'tenant_type','fpo','FPO') ON CONFLICT (id) DO NOTHING`, [tenantTypeId]);
    const mkTenant = (id: string, slug: string) => admin.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code)
       VALUES ($1,$2,$3,$3,$4,'IN') ON CONFLICT (id) DO NOTHING`,
      [id, slug, 'Test Tenant ' + slug, tenantTypeId],
    );
    await mkTenant(tenantA, 'test-clm-a-' + tenantA.slice(0, 8));
    await mkTenant(tenantB, 'test-clm-b-' + tenantB.slice(0, 8));

    holder = await makeUser(admin);

    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('insurance_kind','Insurance Kind') ON CONFLICT (code) DO NOTHING`);
    const kindId = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'insurance_kind','pmfby','PMFBY') ON CONFLICT (id) DO NOTHING`, [kindId]);
    partnerId = randomUUID();
    await admin.query(
      `INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1,$2,'Test Insurer','insurer') ON CONFLICT (id) DO NOTHING`,
      [partnerId, 'test_insurer_clm_' + partnerId.slice(0, 8)],
    );
    productId = randomUUID();
    await admin.query(
      `INSERT INTO insurance_products (id, partner_id, product_kind_id, default_name, premium_calc, govt_subsidy_bps)
       VALUES ($1,$2,$3,'Test PMFBY Product','{"kind":"pct_of_sum_insured","bps":1200}'::jsonb,8333) ON CONFLICT (id) DO NOTHING`,
      [productId, partnerId, kindId],
    );

    // insurance_policies row (tenant A) that the claim references — must exist first (FK).
    policyId = randomUUID();
    await admin.query(
      `INSERT INTO insurance_policies (id, tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until)
       VALUES ($1,$2,$3,$4,'crop_season',$5,10000000,200000,'active','2026-06-15','2026-11-30')
       ON CONFLICT (id) DO NOTHING`,
      [policyId, tenantA, holder, productId, randomUUID()],
    );

    // 'claim_event' lookup vocabulary (seeded in prod by 0005_lookup_vocabularies.sql — insert defensively
    // here so this spec is self-contained against a bare test DB).
    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('claim_event','Insurance claim event type') ON CONFLICT (code) DO NOTHING`);
    const eventTypeId = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'claim_event','flood','Flood') ON CONFLICT (id) DO NOTHING`, [eventTypeId]);

    // The insurance_claims row itself, owned by tenant A.
    claimId = randomUUID();
    await admin.query(
      `INSERT INTO insurance_claims (id, tenant_id, policy_id, claimant_user_id, event_date, event_type_id, description, status)
       VALUES ($1,$2,$3,$4,'2026-06-30',$5,'Heavy rain damage','intimated')
       ON CONFLICT (id) DO NOTHING`,
      [claimId, tenantA, policyId, holder, eventTypeId],
    );
  }, 30000);

  afterAll(async () => {
    await inspect?.end();
    await admin?.end();
  });

  it('tenant B cannot see tenant A\'s insurance_claims row (cross-tenant read returns 0)', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const wrong = await inspect.query(`SELECT id FROM insurance_claims WHERE id=$1`, [claimId]);
    expect(wrong.rows.length).toBe(0);
  });

  it('tenant A can see its own insurance_claims row', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const right = await inspect.query(`SELECT id, status FROM insurance_claims WHERE id=$1`, [claimId]);
    expect(right.rows.length).toBe(1);
    expect(right.rows[0].status).toBe('intimated');
  });

  it('a deliberate cross-tenant WRITE attempt (UPDATE under tenant B context) affects zero rows', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const r = await inspect.query(`UPDATE insurance_claims SET status='rejected' WHERE id=$1`, [claimId]);
    expect(r.rowCount).toBe(0);
    // Confirm the row is untouched from tenant A's own vantage point.
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const still = await inspect.query(`SELECT status FROM insurance_claims WHERE id=$1`, [claimId]);
    expect(still.rows[0].status).toBe('intimated');
  });

  it('a deliberate cross-tenant SETTLEMENT attempt (money-out UPDATE approved_minor/status='+'\'paid\' under tenant B) affects zero rows', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const r = await inspect.query(`UPDATE insurance_claims SET approved_minor=999999, status='paid' WHERE id=$1`, [claimId]);
    expect(r.rowCount).toBe(0);
  });

  it('the tenant_isolation_insurance_claims policy exists and is FORCED (owner cannot bypass)', async () => {
    const pol = await admin.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='insurance_claims'`);
    expect(pol.rows.map((r) => r.policyname)).toContain('tenant_isolation_insurance_claims');
    const forced = await admin.query(`SELECT relforcerowsecurity FROM pg_class WHERE relname='insurance_claims'`);
    expect(forced.rows[0].relforcerowsecurity).toBe(true);
  });
});
