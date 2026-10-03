// apps/api/test/helpers/fixtures.ts
// FK-correct test fixtures for the integration specs. The REAL schema enforces foreign keys
// (listings → tenants/users/products/categories/units/currencies), so fixtures must be inserted
// in dependency order. All inserts run as the admin/superuser pool (bypassing RLS) and use random
// ids + ON CONFLICT so specs are parallel-safe against the single globalSetup-built database.
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

const rnd = () => randomUUID();
const ltreeLabel = () => 'c' + rnd().replace(/-/g, '').slice(0, 16); // valid ltree label (alnum)

/**
 * A tenant.
 *
 * **THIS INSERTED A COLUMN THAT HAS NEVER EXISTED (PC-56 TENANT-4d-5 CHAIN REPAIR).** It was
 * `INSERT INTO tenants (id, name)`, and `tenants` (0002) has no `name` column — it has `slug`,
 * `legal_name`, `display_name`, `tenant_type_id` and `country_code`, all NOT NULL. Every integration
 * spec that makes a tenant therefore failed at the first fixture with
 *     error: column "name" of relation "tenants" does not exist
 * — 494 occurrences across 67 suites, all one cause.
 *
 * It was invisible because the suite could not START: its globalSetup builds the database from the real
 * `db/migrations`, and the migration chain halted at 0057 (and then 0082, 0086, 0108, 0122, 0123, 0125,
 * 0140, 0145) on a fresh database. Three waves of this programme recorded "the api integration suite
 * cannot bootstrap" as a pre-existing quirk and ran the unit suites instead. Once 0056a and 0150 made
 * the chain apply, the suite bootstrapped for the first time and this fixture was the next thing in the
 * way.
 *
 * `tenant_type_id` REFERENCES `lookup_values(id)`, so the type is resolved from the seeded
 * `tenant_type` vocabulary rather than invented — `fpo`, because a Farmer Producer Organisation is the
 * tenant this platform's canon is written about.
 */
export async function makeTenant(admin: Pool, id = rnd(), name = 'T'): Promise<string> {
  await admin.query(
    `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status)
     SELECT $1, $2, $3, $3, lv.id, 'IN', 'active'
       FROM lookup_values lv
      WHERE lv.type_code = 'tenant_type' AND lv.code = 'fpo' AND lv.tenant_id IS NULL
     ON CONFLICT (id) DO NOTHING`,
    [id, 't' + String(id).replace(/-/g, '').slice(0, 20), name]);
  return id;
}

/** A user (E.164 phone is unique; language/country are seeded master data). */
export async function makeUser(admin: Pool, id = rnd()): Promise<string> {
  const phone = '+9198' + Math.floor(10000000 + Math.random() * 89999999);
  await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1,$2,'Test User') ON CONFLICT (id) DO NOTHING`, [id, phone]);
  return id;
}

/** Ensure the base unit + currency the fixtures use exist (idempotent; normally already seeded). */
export async function ensureUnitCurrency(admin: Pool, unit = 'quintal', currency = 'INR'): Promise<void> {
  await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ($1,'Quintal','mass',true) ON CONFLICT (code) DO NOTHING`, [unit]);
  await admin.query(`INSERT INTO currencies (code, default_name, symbol, minor_units, is_active) VALUES ($1,'Rupee','₹',2,true) ON CONFLICT (code) DO NOTHING`, [currency]);
}

/** A category (code + path are unique; depth 1). */
export async function makeCategory(admin: Pool, id = rnd()): Promise<string> {
  const code = ltreeLabel();
  await admin.query(
    `INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Test Category',$2::ltree,1,true) ON CONFLICT (id) DO NOTHING`,
    [id, code]);
  return id;
}

/** A product. tenantId=null → platform master; set → tenant-private. */
export async function makeProduct(admin: Pool, opts: { id?: string; categoryId: string; tenantId?: string | null; unit?: string; name?: string }): Promise<string> {
  const id = opts.id ?? rnd();
  await ensureUnitCurrency(admin, opts.unit ?? 'quintal');
  await admin.query(
    `INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
     VALUES ($1,$2,$3,$4,$5,true, to_tsvector('simple',$3)) ON CONFLICT (id) DO NOTHING`,
    [id, opts.categoryId, opts.name ?? 'Test Product', opts.unit ?? 'quintal', opts.tenantId ?? null]);
  return id;
}

/** A billing plan (all NOT NULLs satisfied). Optionally attach one plan_limit (-1 = unlimited). */
export async function makePlan(admin: Pool, opts: { limitCode?: string; limitValue?: number } = {}): Promise<string> {
  const id = rnd();
  const code = 'p' + rnd().replace(/-/g, '').slice(0, 10);
  await admin.query(
    `INSERT INTO plans (id, code, default_name, country_code, currency_code, monthly_price_minor, annual_price_minor)
     VALUES ($1,$2,'Test Plan','IN','INR',0,0) ON CONFLICT DO NOTHING`, [id, code]);
  if (opts.limitCode) {
    await admin.query(`INSERT INTO plan_limits (plan_id, limit_code, limit_value) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [id, opts.limitCode, opts.limitValue ?? -1]);
  }
  return id;
}

/** An ACTIVE subscription linking a tenant to a plan (all NOT NULLs satisfied). */
export async function activateSubscription(admin: Pool, tenantId: string, planId: string): Promise<void> {
  await admin.query(
    `INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle, price_minor, currency_code, current_period_start, current_period_end)
     VALUES ($1,$2,$3,'active','monthly',0,'INR', current_date, current_date + 30)`, [rnd(), tenantId, planId]);
}

export interface ListingFixture { id: string; tenantId: string; sellerId: string; productId: string; categoryId: string; }

/** A PUBLISHED, in-stock listing owned by `sellerId` in `tenantId`, creating its category +
 *  product dependencies. Returns all ids so the spec can drive cart/checkout/order against it. */
export async function makePublishedListing(
  admin: Pool,
  opts: { tenantId: string; sellerId: string; priceMinor?: bigint; qty?: number; unit?: string; title?: string },
): Promise<ListingFixture> {
  const id = rnd();
  const categoryId = await makeCategory(admin);
  const productId = await makeProduct(admin, { categoryId, tenantId: opts.tenantId, unit: opts.unit ?? 'quintal' });
  const qty = opts.qty ?? 100;
  await admin.query(
    `INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, quantity_total,
       quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,'INR','published','public') ON CONFLICT (id) DO NOTHING`,
    [id, opts.tenantId, opts.sellerId, productId, categoryId, opts.title ?? 'Wheat', qty, qty,
     opts.unit ?? 'quintal', (opts.priceMinor ?? 50000n).toString()]);
  return { id, tenantId: opts.tenantId, sellerId: opts.sellerId, productId, categoryId };
}

/** PC-56 TENANT-SW-a: settlement prices an order from the ORDER's frozen commission snapshot (A2), so a settlement spec needs the order
 *  row. A completed order header with a v7 id (partition pruning); `commissionSnapshot` omitted = an order placed before 0196 (settlement
 *  resolves it once on the placement date and records it). Returns the order id. */
export async function makeCompletedOrder(admin: Pool, o: { tenantId: string; buyerUserId: string; sellerUserId: string; totalMinor: bigint;
  source?: string; commissionSnapshot?: Record<string, unknown> | null; buyerCommissionMinor?: bigint }): Promise<string> {
  const id = (await admin.query(`SELECT uuid_generate_v7() AS id`)).rows[0].id as string;
  await admin.query(
    `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, total_minor, status, version, created_at,
       commission_snapshot, buyer_commission_minor)
     VALUES ($1,$2,$3,$4,$5,$6,'INR',$7,$7,'completed',1, uuid_v7_time($1), $8::jsonb, $9)`,
    [id, o.tenantId, `KV-${id.slice(0, 8)}`, o.buyerUserId, o.sellerUserId, o.source ?? 'direct', o.totalMinor.toString(),
     o.commissionSnapshot ? JSON.stringify(o.commissionSnapshot) : null, (o.buyerCommissionMinor ?? 0n).toString()]);
  return id;
}
