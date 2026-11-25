// apps/admin-api/test/integration-fixtures.ts · PC-56 TEST-1.
// FK-correct fixtures for the admin-api integration specs. Several specs used to borrow whatever row they found
// (`SELECT id FROM tenants LIMIT 1`, `SELECT id FROM users ORDER BY created_at LIMIT 2`): green only on a database an
// earlier apps/api pass had filled, red on one built from the migrations + seeds alone, and — when they did find a row —
// writing into somebody else's tenant. Each spec now makes its OWN tenant / users with unique ids.
// (Mirrors apps/api/test/helpers/fixtures.ts — the tenant type is the SEEDED platform `tenant_type`/`fpo`, never invented.)
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export async function makeTenant(db: Pool, opts: { status?: string; name?: string } = {}): Promise<string> {
  const id = randomUUID();
  const r = await db.query(
    `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status)
     SELECT $1, $2, $3, $3, lv.id, 'IN', $4
       FROM lookup_values lv
      WHERE lv.type_code = 'tenant_type' AND lv.code = 'fpo' AND lv.tenant_id IS NULL
      ORDER BY lv.created_at LIMIT 1
     RETURNING id`,
    [id, 'adm' + id.replace(/-/g, '').slice(0, 20), opts.name ?? 'Admin ITest FPO', opts.status ?? 'active']);
  if (r.rowCount !== 1) throw new Error('makeTenant: the seeded tenant_type/fpo row is missing');
  return id;
}

export async function makeUser(db: Pool): Promise<string> {
  const id = randomUUID();
  const phone = '+9196' + String(Math.floor(10_000_000 + Math.random() * 89_999_999));
  await db.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, 'Admin ITest User')`, [id, phone]);
  return id;
}
