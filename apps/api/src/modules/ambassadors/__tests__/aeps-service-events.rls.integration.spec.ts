// modules/ambassadors/__tests__/aeps-service-events.rls.integration.spec.ts
// RLS + restricted-column-update PROBE for the new aeps_service_events table (DELTA-045, migration
// 0071_aeps_service_events.sql, DEV-05). Cross-tenant read+write probes per DEV-05's brief; also proves the
// synced_at-only update grant (mirrors outbox_events, 0014) and the Law 10 PII-masking column shapes.
//
// Queries below match on `id` ALONE (bigint, globally unique via bigserial), never re-combined with a
// client-round-tripped `occurred_at` value: `timestamptz` has microsecond precision, a JS `Date` only
// millisecond — reproduced empirically that re-serializing a RETURNING `occurred_at` back into a later
// `WHERE occurred_at=$n` loses that sub-millisecond remainder and never matches, even for a superuser with no
// RLS in play at all (a client-side test artifact, not an access-control defect).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeUser } from '../../../../test/helpers/fixtures';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('aeps_service_events RLS + restricted-update (integration, real Postgres)', () => {
  let admin: Pool;
  let inspect: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let ambassadorProfileId = '';
  let eventId = '';

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
    await mkTenant(tenantA, 'test-aeps-a-' + tenantA.slice(0, 8));
    await mkTenant(tenantB, 'test-aeps-b-' + tenantB.slice(0, 8));

    const ambassadorUser = await makeUser(admin);
    ambassadorProfileId = randomUUID();
    await admin.query(
      `INSERT INTO ambassador_profiles (id, user_id, tenant_id, aeps_enabled) VALUES ($1,$2,$3,true) ON CONFLICT (id) DO NOTHING`,
      [ambassadorProfileId, ambassadorUser, tenantA],
    );

    const ins = await admin.query(
      `INSERT INTO aeps_service_events (tenant_id, ambassador_id, service_kind, bank_name, account_last4, aadhaar_last4, amount_minor, balance_after_minor, npci_rrn)
       VALUES ($1,$2,'cash_withdrawal','Bank of Baroda','0027','0041',250000,571437,'RRNTEST0001')
       RETURNING id`,
      [tenantA, ambassadorProfileId],
    );
    eventId = ins.rows[0].id;
  }, 30000);

  afterAll(async () => {
    await inspect?.end();
    await admin?.end();
  });

  it('tenant B cannot read tenant A\'s AePS event (cross-tenant read = 0 rows)', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const wrong = await inspect.query(`SELECT id FROM aeps_service_events WHERE id=$1`, [eventId]);
    expect(wrong.rows.length).toBe(0);
  });

  it('tenant A can read its own AePS event', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const right = await inspect.query(
      `SELECT id, status, account_last4, aadhaar_last4 FROM aeps_service_events WHERE id=$1`,
      [eventId],
    );
    expect(right.rows.length).toBe(1);
    expect(right.rows[0].status).toBe('success');
    expect(right.rows[0].account_last4).toBe('0027');
  });

  it('tenant B cannot insert an event tagged tenant_id=A (cross-tenant write rejected)', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    await expect(inspect.query(
      `INSERT INTO aeps_service_events (tenant_id, ambassador_id, service_kind) VALUES ($1,$2,'balance_enquiry')`,
      [tenantA, ambassadorProfileId],
    )).rejects.toThrow(/row-level security/i);
  });

  it('kv_app CANNOT update the status column (write-once service outcome)', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    await expect(inspect.query(
      `UPDATE aeps_service_events SET status='failed' WHERE id=$1`,
      [eventId],
    )).rejects.toThrow(/permission denied/i);
  });

  it('kv_app CAN update only synced_at (offline-first kiosk sync, restricted-column grant)', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    await inspect.query(
      `UPDATE aeps_service_events SET synced_at=now() WHERE id=$1`,
      [eventId],
    );
    const after = await admin.query(`SELECT synced_at FROM aeps_service_events WHERE id=$1`, [eventId]);
    expect(after.rows[0].synced_at).not.toBeNull();
  });

  it('no raw Aadhaar or fingerprint column exists — only masked last-4 (Law 10)', async () => {
    const cols = await admin.query(
      `SELECT column_name, character_maximum_length FROM information_schema.columns
       WHERE table_name='aeps_service_events' AND column_name IN ('aadhaar_last4','account_last4')`,
    );
    expect(cols.rows.length).toBe(2);
    for (const row of cols.rows) expect(row.character_maximum_length).toBeLessThanOrEqual(4);
    const noRaw = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='aeps_service_events' AND (column_name ILIKE '%aadhaar%raw%' OR column_name ILIKE '%fingerprint%' OR column_name ILIKE '%biometric%')`,
    );
    expect(noRaw.rows.length).toBe(0);
  });
});
