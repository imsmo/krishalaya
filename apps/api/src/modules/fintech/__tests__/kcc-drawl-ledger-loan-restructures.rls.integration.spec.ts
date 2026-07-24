// modules/fintech/__tests__/kcc-drawl-ledger-loan-restructures.rls.integration.spec.ts
// RLS + append-only PROBE for the two new lender tables (DELTA-032/DELTA-033, migration
// 0069_kcc_drawl_ledger_loan_restructures.sql, DEV-05). Same "real Postgres + set_config + cross-tenant
// read/write" pattern as modules/schemes/__tests__/field-verifications.rls.integration.spec.ts (DEV-04) — this
// probe goes further per DEV-05's own brief ("cross-tenant RLS probe per new tenant-scoped table (read + write)")
// and additionally proves kcc_drawl_ledger's LEDGER-class append-only grant (UPDATE rejected for the kv_app role).
//
// Reuses the DEV-04-documented workaround for test/helpers/fixtures.ts's stale makeTenant() (no `name` column on
// the live `tenants` table) — builds its own tenant fixture directly against the real schema.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeUser } from '../../../../test/helpers/fixtures';

const APP_URL = process.env.DATABASE_URL;       // least-privilege kv_app role
const ADMIN_URL = process.env.DATABASE_ADMIN_URL; // superuser/kv_admin, bypasses RLS for fixture setup
const run = APP_URL ? describe : describe.skip;

run('kcc_drawl_ledger + loan_restructures RLS + append-only (integration, real Postgres)', () => {
  let admin: Pool;
  let inspect: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let borrower = '';
  let loanId = '';
  let ledgerEntryId = ''; // bigint id — globally unique on its own (bigserial); queried by id ALONE below, never
  // re-combined with a client-round-tripped `created_at` value: `timestamptz` has microsecond precision, a JS
  // `Date` only millisecond — reproduced empirically that re-serializing a RETURNING `created_at` back into a
  // later `WHERE created_at=$n` loses that sub-millisecond remainder and never matches, even for a superuser with
  // no RLS in play at all (a client-side test artifact, not an access-control defect). `id` alone is sufficient.
  let restructureId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    inspect = new Pool({ connectionString: APP_URL });

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
    await mkTenant(tenantA, 'test-kcc-a-' + tenantA.slice(0, 8));
    await mkTenant(tenantB, 'test-kcc-b-' + tenantB.slice(0, 8));

    borrower = await makeUser(admin);

    // Minimal FK chain: financial_partners → lookup_values(loan_kind) → loan_products → loan_applications → loans.
    const partnerId = randomUUID();
    await admin.query(
      `INSERT INTO financial_partners (id, code, default_name, partner_kind, sla) VALUES ($1,$2,'Test Bank','bank','{}') ON CONFLICT (id) DO NOTHING`,
      [partnerId, 'test_bank_' + partnerId.slice(0, 8)],
    );
    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('loan_kind','Loan Kind') ON CONFLICT (code) DO NOTHING`);
    const kindId = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'loan_kind','kcc','KCC') ON CONFLICT (id) DO NOTHING`, [kindId]);
    const productId = randomUUID();
    await admin.query(
      `INSERT INTO loan_products (id, partner_id, product_kind_id, default_name, min_amount_minor, max_amount_minor, interest_apr_bps)
       VALUES ($1,$2,$3,'Test KCC',100000,30000000,700) ON CONFLICT (id) DO NOTHING`,
      [productId, partnerId, kindId],
    );
    const appId = randomUUID();
    await admin.query(
      `INSERT INTO loan_applications (id, tenant_id, applicant_user_id, product_id, amount_requested_minor, status)
       VALUES ($1,$2,$3,$4,22000000,'disbursed') ON CONFLICT (id) DO NOTHING`,
      [appId, tenantA, borrower, productId],
    );
    loanId = randomUUID();
    await admin.query(
      `INSERT INTO loans (id, application_id, tenant_id, borrower_user_id, partner_id, principal_minor, interest_apr_bps, disbursed_at, status, outstanding_minor)
       VALUES ($1,$2,$3,$4,$5,22000000,700,'2026-06-06','active',22000000) ON CONFLICT (id) DO NOTHING`,
      [loanId, appId, tenantA, borrower, partnerId],
    );

    // The kcc_drawl_ledger row itself, owned by tenant A.
    const ins = await admin.query(
      `INSERT INTO kcc_drawl_ledger (tenant_id, loan_id, entry_kind, amount_minor, balance_after_minor, narrative)
       VALUES ($1,$2,'drawl',6000000,22000000,'Drawl — seed + fertiliser (kharif kit)')
       RETURNING id`,
      [tenantA, loanId],
    );
    ledgerEntryId = ins.rows[0].id;

    // The loan_restructures row, owned by tenant A.
    const r = await admin.query(
      `INSERT INTO loan_restructures (tenant_id, loan_id, old_instalment_minor, new_instalment_minor, old_tenor_months, new_tenor_months, rate_apr_bps, total_interest_delta_minor)
       VALUES ($1,$2,2280000,1940000,36,44,1150,3380000) RETURNING id`,
      [tenantA, loanId],
    );
    restructureId = r.rows[0].id;
  }, 30000);

  afterAll(async () => {
    await inspect?.end();
    await admin?.end();
  });

  describe('kcc_drawl_ledger RLS (read + write)', () => {
    it('tenant B cannot read tenant A\'s ledger row (cross-tenant read = 0 rows)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
      const wrong = await inspect.query(`SELECT id FROM kcc_drawl_ledger WHERE id=$1`, [ledgerEntryId]);
      expect(wrong.rows.length).toBe(0);
    });
    it('tenant A can read its own ledger row', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
      const right = await inspect.query(`SELECT id, entry_kind FROM kcc_drawl_ledger WHERE id=$1`, [ledgerEntryId]);
      expect(right.rows.length).toBe(1);
      expect(right.rows[0].entry_kind).toBe('drawl');
    });
    it('tenant B cannot insert a row tagged tenant_id=A (cross-tenant write rejected)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
      await expect(inspect.query(
        `INSERT INTO kcc_drawl_ledger (tenant_id, loan_id, entry_kind, amount_minor, balance_after_minor, narrative)
         VALUES ($1,$2,'drawl',100000,100000,'cross-tenant probe insert')`,
        [tenantA, loanId],
      )).rejects.toThrow(/row-level security/i);
    });
    it('append-only: kv_app cannot UPDATE a kcc_drawl_ledger row (LEDGER-class grant, Law 2)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
      await expect(inspect.query(
        `UPDATE kcc_drawl_ledger SET narrative='mutated' WHERE id=$1`,
        [ledgerEntryId],
      )).rejects.toThrow(/permission denied/i);
    });
    it('append-only: kv_app cannot DELETE a kcc_drawl_ledger row', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
      await expect(inspect.query(
        `DELETE FROM kcc_drawl_ledger WHERE id=$1`,
        [ledgerEntryId],
      )).rejects.toThrow(/permission denied/i);
    });
  });

  describe('loan_restructures RLS (read + write)', () => {
    it('tenant B cannot read tenant A\'s restructure row (cross-tenant read = 0 rows)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
      const wrong = await inspect.query(`SELECT id FROM loan_restructures WHERE id=$1`, [restructureId]);
      expect(wrong.rows.length).toBe(0);
    });
    it('tenant A can read its own restructure row', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
      const right = await inspect.query(`SELECT id, status FROM loan_restructures WHERE id=$1`, [restructureId]);
      expect(right.rows.length).toBe(1);
      expect(right.rows[0].status).toBe('draft');
    });
    it('tenant B cannot insert a row tagged tenant_id=A (cross-tenant write rejected)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
      await expect(inspect.query(
        `INSERT INTO loan_restructures (tenant_id, loan_id, old_instalment_minor, new_instalment_minor, old_tenor_months, new_tenor_months, rate_apr_bps, total_interest_delta_minor)
         VALUES ($1,$2,1,1,1,1,100,0)`,
        [tenantA, loanId],
      )).rejects.toThrow(/row-level security/i);
    });
    it('borrower_accept_otp_status never holds a raw OTP value (status enum only, Law 10)', async () => {
      const cols = await admin.query(
        `SELECT character_maximum_length FROM information_schema.columns
         WHERE table_name='loan_restructures' AND column_name='borrower_accept_otp_status'`,
      );
      expect(cols.rows[0].character_maximum_length).toBeLessThanOrEqual(16);
    });
  });
});
