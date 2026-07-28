// modules/insurance/__tests__/insurance-policy.rls.integration.spec.ts
// RLS PROBE for `insurance_policies` (already RLS-enabled+forced by migration 0014's generic tenant-RLS
// backfill loop, since 0011_fintech_schemes.sql predates 0014 — see DEV-22 STATE block grounding). Proves the
// `tenant_isolation_insurance_policies` policy actually FIRES against real Postgres — same "real Postgres +
// set_config + cross-tenant read" pattern as modules/schemes/__tests__/field-verifications.rls.integration.spec.ts
// (DEV-04/05/06 precedent) and modules/fintech/__tests__/kcc-drawl-ledger-loan-restructures.rls.integration.spec.ts.
// Guarded by DATABASE_URL — skips cleanly when no test Postgres is configured (same convention repo-wide).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeUser } from '../../../../test/helpers/fixtures';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('insurance_policies RLS (integration, real Postgres)', () => {
  let admin: Pool;
  let inspect: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let holder = '';
  let partnerId = '';
  let productId = '';
  let policyId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    inspect = new Pool({ connectionString: APP_URL });

    // Tenant fixture built directly against the real tenants schema (same known-defect workaround already
    // documented in field-verifications.rls.integration.spec.ts — makeTenant() in fixtures.ts is stale).
    await admin.query(`INSERT INTO countries (code, default_name, currency_code, phone_prefix) VALUES ('IN','India','INR','+91') ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('tenant_type','Tenant Type') ON CONFLICT (code) DO NOTHING`);
    const tenantTypeId = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'tenant_type','fpo','FPO') ON CONFLICT (id) DO NOTHING`, [tenantTypeId]);
    const mkTenant = (id: string, slug: string) => admin.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code)
       VALUES ($1,$2,$3,$3,$4,'IN') ON CONFLICT (id) DO NOTHING`,
      [id, slug, 'Test Tenant ' + slug, tenantTypeId],
    );
    await mkTenant(tenantA, 'test-ins-a-' + tenantA.slice(0, 8));
    await mkTenant(tenantB, 'test-ins-b-' + tenantB.slice(0, 8));

    holder = await makeUser(admin);

    // Minimal financial_partners (insurer) + insurance_products + lookup_values FK chain, self-contained.
    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('insurance_kind','Insurance Kind') ON CONFLICT (code) DO NOTHING`);
    const kindId = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'insurance_kind','pmfby','PMFBY') ON CONFLICT (id) DO NOTHING`, [kindId]);
    partnerId = randomUUID();
    await admin.query(
      `INSERT INTO financial_partners (id, code, default_name, partner_kind) VALUES ($1,$2,'Test Insurer','insurer') ON CONFLICT (id) DO NOTHING`,
      [partnerId, 'test_insurer_' + partnerId.slice(0, 8)],
    );
    productId = randomUUID();
    await admin.query(
      `INSERT INTO insurance_products (id, partner_id, product_kind_id, default_name, premium_calc, govt_subsidy_bps)
       VALUES ($1,$2,$3,'Test PMFBY Product','{"kind":"pct_of_sum_insured","bps":1200}'::jsonb,8333) ON CONFLICT (id) DO NOTHING`,
      [productId, partnerId, kindId],
    );

    // The insurance_policies row itself, owned by tenant A.
    policyId = randomUUID();
    await admin.query(
      `INSERT INTO insurance_policies (id, tenant_id, holder_user_id, product_id, subject_type, subject_id, sum_insured_minor, premium_minor, status, valid_from, valid_until)
       VALUES ($1,$2,$3,$4,'crop_season',$5,10000000,200000,'proposed','2026-06-15','2026-11-30')
       ON CONFLICT (id) DO NOTHING`,
      [policyId, tenantA, holder, productId, randomUUID()],
    );
  }, 30000);

  afterAll(async () => {
    await inspect?.end();
    await admin?.end();
  });

  it('tenant B cannot see tenant A\'s insurance_policies row (cross-tenant read returns 0)', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const wrong = await inspect.query(`SELECT id FROM insurance_policies WHERE id=$1`, [policyId]);
    expect(wrong.rows.length).toBe(0);
  });

  it('tenant A can see its own insurance_policies row', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const right = await inspect.query(`SELECT id, status FROM insurance_policies WHERE id=$1`, [policyId]);
    expect(right.rows.length).toBe(1);
    expect(right.rows[0].status).toBe('proposed');
  });

  it('a deliberate cross-tenant WRITE attempt (UPDATE under tenant B context) affects zero rows', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const r = await inspect.query(`UPDATE insurance_policies SET status='cancelled' WHERE id=$1`, [policyId]);
    expect(r.rowCount).toBe(0);
    // Confirm the row is untouched from tenant A's own vantage point.
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const still = await inspect.query(`SELECT status FROM insurance_policies WHERE id=$1`, [policyId]);
    expect(still.rows[0].status).toBe('proposed');
  });

  it('insurance_products (global reference data) has NO RLS policy — readable regardless of app.tenant_id', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const r = await inspect.query(`SELECT id FROM insurance_products WHERE id=$1`, [productId]);
    expect(r.rows.length).toBe(1); // no tenant_id column on this table — correctly un-RLS'd, Law 11 reference data
  });

  it('the tenant_isolation_insurance_policies policy exists and is FORCED (owner cannot bypass)', async () => {
    const pol = await admin.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='insurance_policies'`);
    expect(pol.rows.map((r) => r.policyname)).toContain('tenant_isolation_insurance_policies');
    const forced = await admin.query(`SELECT relforcerowsecurity FROM pg_class WHERE relname='insurance_policies'`);
    expect(forced.rows[0].relforcerowsecurity).toBe(true);
  });
});
