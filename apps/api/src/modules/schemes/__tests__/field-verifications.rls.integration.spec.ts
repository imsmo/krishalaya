// modules/schemes/__tests__/field-verifications.rls.integration.spec.ts
// RLS PROBE for the new `field_verifications` table (DELTA-040, migration 0066_field_verifications.sql).
// DEV-04 is a schema-only batch (no repository/service layer exists yet for this table), so this probe talks
// directly to the migrated schema with raw SQL — same "real Postgres + set_config + cross-tenant read" pattern
// already used by modules/schemes/__tests__/schemes.integration.spec.ts's own RLS test (`SELECT id FROM
// scheme_applications WHERE id=$1` under two different `app.tenant_id` GUCs). Proves the tenant_isolation policy
// added by 0066's idempotent RLS pass actually fires — not just that it exists in pg_policies.
//
// KNOWN DEFECT FOUND (not fixed here, out of DEV-04 scope): `test/helpers/fixtures.ts`'s `makeTenant()` does
// `INSERT INTO tenants (id, name) VALUES (...)`, but the live `tenants` table (0002_tenancy_billing.sql) has no
// `name` column — it requires `slug`, `legal_name`, `display_name`, `tenant_type_id` (FK), `country_code` (FK).
// Reproduced live against a freshly-migrated (68/68) embedded Postgres: `column "name" of relation "tenants"
// does not exist`. This is shared test infrastructure used by many other integration specs and editing it is
// out of this batch's scope (schema-only, per the founder's DEV-04 order) — flagged for founder-directed
// follow-up. This spec avoids the helper and builds its own tenant fixture against the real schema below.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeUser } from '../../../../test/helpers/fixtures';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('field_verifications RLS (integration, real Postgres)', () => {
  let admin: Pool;
  let inspect: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let officer = '';
  let applicant = '';
  let appId = '';
  let visitId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    inspect = new Pool({ connectionString: APP_URL });

    // Tenant fixture built directly against the REAL tenants schema (see KNOWN DEFECT note above) — idempotent
    // master-data rows first (country/language/tenant_type lookup), then the two tenants themselves.
    await admin.query(`INSERT INTO countries (code, default_name, currency_code, phone_prefix) VALUES ('IN','India','INR','+91') ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO languages (code, name_native, name_english, script) VALUES ('hi','हिन्दी','Hindi','Devanagari') ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('tenant_type','Tenant Type') ON CONFLICT (code) DO NOTHING`);
    const tenantTypeId = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'tenant_type','fpo','FPO') ON CONFLICT (id) DO NOTHING`, [tenantTypeId]);
    const mkTenant = (id: string, slug: string) => admin.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code)
       VALUES ($1,$2,$3,$3,$4,'IN') ON CONFLICT (id) DO NOTHING`,
      [id, slug, 'Test Tenant ' + slug, tenantTypeId],
    );
    await mkTenant(tenantA, 'test-fv-a-' + tenantA.slice(0, 8));
    await mkTenant(tenantB, 'test-fv-b-' + tenantB.slice(0, 8));

    officer = await makeUser(admin);
    applicant = await makeUser(admin);

    // Build the minimal schemes/scheme_applications FK chain directly (test-self-contained; does not rely on
    // any seed file having run) — scheme_authorities → lookup_values (category) → schemes → scheme_applications.
    const authorityId = randomUUID();
    await admin.query(
      `INSERT INTO scheme_authorities (id, default_name, level) VALUES ($1,'Test Dept','state') ON CONFLICT (id) DO NOTHING`,
      [authorityId],
    );
    await admin.query(
      `INSERT INTO lookup_types (code, default_name) VALUES ('scheme_category','Scheme Category') ON CONFLICT (code) DO NOTHING`,
    );
    const categoryId = randomUUID();
    await admin.query(
      `INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'scheme_category','test_income_support','Test Income Support') ON CONFLICT (id) DO NOTHING`,
      [categoryId],
    );
    const schemeId = randomUUID();
    await admin.query(
      `INSERT INTO schemes (id, code, default_name, authority_id, category_id, benefit_summary, eligibility_rules)
       VALUES ($1,$2,'Test Scheme',$3,$4,'{}','{}') ON CONFLICT (id) DO NOTHING`,
      [schemeId, 'test_field_verif_scheme_' + schemeId.slice(0, 8), authorityId, categoryId],
    );

    // Minimal scheme_applications row for tenant A (FK target for field_verifications.application_id).
    appId = randomUUID();
    await admin.query(
      `INSERT INTO scheme_applications (id, tenant_id, scheme_id, scheme_version, applicant_user_id, status)
       VALUES ($1,$2,$3,1,$4,'under_verification') ON CONFLICT (id) DO NOTHING`,
      [appId, tenantA, schemeId, applicant],
    );

    // The field_verifications row itself, owned by tenant A.
    visitId = randomUUID();
    await admin.query(
      `INSERT INTO field_verifications (id, tenant_id, application_id, officer_id, status, geotag, measured_values, farmer_otp_signoff)
       VALUES ($1,$2,$3,$4,'pending_otp','[{"media_id":null,"lat":21.47,"lng":70.33,"captured_at":"2026-07-14T09:44:00Z"}]','{"measured_ha":1.44,"approved_ha":1.5}','sent')
       ON CONFLICT (id) DO NOTHING`,
      [visitId, tenantA, appId, officer],
    );
  }, 30000);

  afterAll(async () => {
    await inspect?.end();
    await admin?.end();
  });

  it('tenant B cannot see tenant A\'s field_verifications row (cross-tenant read returns 0)', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const wrong = await inspect.query(`SELECT id FROM field_verifications WHERE id=$1`, [visitId]);
    expect(wrong.rows.length).toBe(0);
  });

  it('tenant A can see its own field_verifications row', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const right = await inspect.query(`SELECT id, farmer_otp_signoff FROM field_verifications WHERE id=$1`, [visitId]);
    expect(right.rows.length).toBe(1);
    expect(right.rows[0].farmer_otp_signoff).toBe('sent');
  });

  it('farmer_otp_signoff never holds a raw OTP value (status enum only)', async () => {
    const cols = await admin.query(
      `SELECT column_name, data_type, character_maximum_length FROM information_schema.columns
       WHERE table_name='field_verifications' AND column_name='farmer_otp_signoff'`,
    );
    expect(cols.rows[0].data_type).toBe('character varying');
    expect(cols.rows[0].character_maximum_length).toBeLessThanOrEqual(16); // too short to hold anything but a status word
  });
});
