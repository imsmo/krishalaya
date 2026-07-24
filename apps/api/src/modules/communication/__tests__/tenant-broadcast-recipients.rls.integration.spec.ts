// modules/communication/__tests__/tenant-broadcast-recipients.rls.integration.spec.ts
// RLS PROBE for the new tenant_broadcast_recipients table (DELTA-053, migration
// 0073_tenant_broadcast_targeting.sql, DEV-06). Same pattern as
// freight-invoices.rls.integration.spec.ts (DEV-05) — cross-tenant read AND write probes per the
// contract's own gate 6 ("a deliberate cross-tenant read/write attempt ... returns zero rows / is rejected").
// tenant_broadcast_recipients is PARTITION BY RANGE(created_at) (event-log-volume audience snapshot) — this
// probe exercises the parent table; RLS on a partitioned parent applies uniformly to every child partition
// (verified separately via verify-rls-coverage.js's gaps:[] against every monthly child).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('tenant_broadcast_recipients RLS (integration, real Postgres)', () => {
  let admin: Pool;
  let inspect: Pool;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let userA = '';
  let broadcastA = '';

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
    await mkTenant(tenantA, 'test-tbr-a-' + tenantA.slice(0, 8));
    await mkTenant(tenantB, 'test-tbr-b-' + tenantB.slice(0, 8));

    const u = await admin.query(
      `INSERT INTO users (phone, language_code, country_code) VALUES ($1,'hi','IN') RETURNING id`,
      ['+9198' + tenantA.replace(/-/g, '').slice(0, 8)],
    );
    userA = u.rows[0].id;

    const bc = await admin.query(
      `INSERT INTO tenant_broadcasts (tenant_id, created_by_user_id, title, body, channel, eligible_count, recipient_count)
       VALUES ($1,$2,'Test broadcast','test body','whatsapp',2412,1387) RETURNING id`,
      [tenantA, userA],
    );
    broadcastA = bc.rows[0].id;

    await admin.query(
      `INSERT INTO tenant_broadcast_recipients (tenant_id, broadcast_id, user_id, delivery_status)
       VALUES ($1,$2,$3,'delivered')`,
      [tenantA, broadcastA, userA],
    );
  }, 30000);

  afterAll(async () => {
    await inspect?.end();
    await admin?.end();
  });

  it("tenant B cannot read tenant A's broadcast recipient row (cross-tenant read = 0 rows)", async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    const wrong = await inspect.query(`SELECT id FROM tenant_broadcast_recipients WHERE broadcast_id=$1`, [broadcastA]);
    expect(wrong.rows.length).toBe(0);
  });

  it('tenant A can read its own broadcast recipient row', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const right = await inspect.query(`SELECT id, delivery_status FROM tenant_broadcast_recipients WHERE broadcast_id=$1`, [broadcastA]);
    expect(right.rows.length).toBe(1);
    expect(right.rows[0].delivery_status).toBe('delivered');
  });

  it('tenant B cannot insert a recipient row tagged tenant_id=A (cross-tenant write rejected)', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    await expect(inspect.query(
      `INSERT INTO tenant_broadcast_recipients (tenant_id, broadcast_id, user_id, delivery_status)
       VALUES ($1,$2,$3,'queued')`,
      [tenantA, broadcastA, userA],
    )).rejects.toThrow(/row-level security/i);
  });

  it('tenant A can insert its own recipient row', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    const otherUser = await admin.query(
      `INSERT INTO users (phone, language_code, country_code) VALUES ($1,'hi','IN') RETURNING id`,
      ['+9199' + tenantA.replace(/-/g, '').slice(0, 8)],
    );
    await expect(inspect.query(
      `INSERT INTO tenant_broadcast_recipients (tenant_id, broadcast_id, user_id, delivery_status)
       VALUES ($1,$2,$3,'queued')`,
      [tenantA, broadcastA, otherUser.rows[0].id],
    )).resolves.toBeDefined();
  });
});
