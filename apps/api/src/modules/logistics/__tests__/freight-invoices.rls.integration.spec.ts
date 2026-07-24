// modules/logistics/__tests__/freight-invoices.rls.integration.spec.ts
// RLS PROBE for the new freight_invoices + freight_invoice_lines tables (DELTA-034, migration
// 0070_freight_invoices.sql, DEV-05). Same pattern as field-verifications.rls.integration.spec.ts (DEV-04) —
// cross-tenant read AND write probes per DEV-05's brief ("cross-tenant RLS probe per new tenant-scoped table
// (read + write)").
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('freight_invoices + freight_invoice_lines RLS (integration, real Postgres)', () => {
  let admin: Pool;
  let inspect: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let carrierId = '';
  let invoiceId = '';
  let lineId = '';

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
    await mkTenant(tenantA, 'test-fi-a-' + tenantA.slice(0, 8));
    await mkTenant(tenantB, 'test-fi-b-' + tenantB.slice(0, 8));

    carrierId = randomUUID();
    await admin.query(
      `INSERT INTO logistics_partners (id, tenant_id, partner_kind, default_name) VALUES ($1,$2,'3pl','Test Carrier') ON CONFLICT (id) DO NOTHING`,
      [carrierId, tenantA],
    );

    const inv = await admin.query(
      `INSERT INTO freight_invoices (tenant_id, carrier_id, invoice_no, period_start, period_end, shipment_count, billed_minor, expected_minor)
       VALUES ($1,$2,'DLV-INV-TEST-01','2026-06-01','2026-06-30',86,9644000,9412000) RETURNING id`,
      [tenantA, carrierId],
    );
    invoiceId = inv.rows[0].id;

    const line = await admin.query(
      `INSERT INTO freight_invoice_lines (tenant_id, invoice_id, billed_minor, expected_minor)
       VALUES ($1,$2,232000,0) RETURNING id`,
      [tenantA, invoiceId],
    );
    lineId = line.rows[0].id;
  }, 30000);

  afterAll(async () => {
    await inspect?.end();
    await admin?.end();
  });

  describe('freight_invoices RLS (read + write)', () => {
    it('tenant B cannot read tenant A\'s invoice (cross-tenant read = 0 rows)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
      const wrong = await inspect.query(`SELECT id FROM freight_invoices WHERE id=$1`, [invoiceId]);
      expect(wrong.rows.length).toBe(0);
    });
    it('tenant A can read its own invoice, variance_minor computed correctly', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
      const right = await inspect.query(`SELECT id, variance_minor FROM freight_invoices WHERE id=$1`, [invoiceId]);
      expect(right.rows.length).toBe(1);
      expect(Number(right.rows[0].variance_minor)).toBe(232000); // 9,644,000 - 9,412,000
    });
    it('tenant B cannot insert an invoice tagged tenant_id=A (cross-tenant write rejected)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
      await expect(inspect.query(
        `INSERT INTO freight_invoices (tenant_id, carrier_id, invoice_no, period_start, period_end, billed_minor)
         VALUES ($1,$2,'cross-tenant-probe','2026-06-01','2026-06-30',1)`,
        [tenantA, carrierId],
      )).rejects.toThrow(/row-level security/i);
    });
  });

  describe('freight_invoice_lines RLS (read + write)', () => {
    it('tenant B cannot read tenant A\'s invoice line (cross-tenant read = 0 rows)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
      const wrong = await inspect.query(`SELECT id FROM freight_invoice_lines WHERE id=$1`, [lineId]);
      expect(wrong.rows.length).toBe(0);
    });
    it('tenant A can read its own invoice line', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
      const right = await inspect.query(`SELECT id, dispute_status FROM freight_invoice_lines WHERE id=$1`, [lineId]);
      expect(right.rows.length).toBe(1);
      expect(right.rows[0].dispute_status).toBe('none');
    });
    it('tenant B cannot insert a line tagged tenant_id=A (cross-tenant write rejected)', async () => {
      await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
      await expect(inspect.query(
        `INSERT INTO freight_invoice_lines (tenant_id, invoice_id, billed_minor, expected_minor) VALUES ($1,$2,1,1)`,
        [tenantA, invoiceId],
      )).rejects.toThrow(/row-level security/i);
    });
  });
});
