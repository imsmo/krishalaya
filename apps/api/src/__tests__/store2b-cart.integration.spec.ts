// apps/api/src/__tests__/store2b-cart.integration.spec.ts · PC-56 STORE-2b — WHAT'S IN THE CART IS REAL, LIVE (the real AppModule over HTTP, real
// Postgres + RLS as kv_app; supertest drives the same middleware, guards, pipes and filter production runs).
//
// What it proves (brief §C8, the numbered list):
//   (1) below the minimum order → BELOW_MIN_ORDER (minimum + unit named) on add, on update AND at placement (and the preview);
//   (2) a price change after add → the cart line carries BOTH numbers and the delta, placement → PRICE_CHANGED with both; accept → placement
//       charges the accepted (= current) price; a second change after accept → refused again;
//   (3) a national `license_required` product → LICENCE_REQUIRED at add; a `banned_state` product with a delivery address INSIDE the banned
//       state (a district of it) → BANNED_IN_REGION (region named) at the preview and placement; allowed with an address outside it;
//   (4) `storefront_cart` OFF → 503 STOREFRONT_CART_OFF on the cart read, add, the checkout preview and placement; ON → 200;
//   (5) another organisation's listing added with this session's token from THAT store → WRONG_STORE naming the other store's slug;
//   (6) a decimal quantity 2.5 is accepted, stored as 2.500 and read back as "2.500";
//   (7) a suspended seller's lot → refused at add, its line says `suspended`, placement refuses it;
//   (8) a non-purchasable line carries its reason (paused, sold_out) — never a bare boolean;
//   (9) accept-price is idempotent (an unchanged price is a no-op 200) and refused for a non-purchasable line; an unseen price is refused.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const MAHARASHTRA = '11111111-0000-7000-8000-000000000002';

run('PC-56 STORE-2b · what\'s in the cart is real (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const OTHER = randomUUID();
  let liveSlug = ''; let otherSlug = '';
  let seller = ''; let seller2 = ''; let suspendedSeller = ''; let staff = ''; let otherSeller = ''; let buyer = '';
  let catId = ''; let catInputs = ''; let product = ''; let productLic = ''; let productBan = '';
  let addrBanned = ''; let addrOk = ''; let pune = '';
  let token = '';
  const L: Record<string, string> = {};
  const touched = ['storefront_cart'];

  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    for (const c of [`flag:${key}`, `flagstale:${key}`, 'flags:all', `flagctx:${LIVE}`]) await cache.del(c);
  };
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function listing(tenantId: string, sellerId: string, title: string, o: { price?: number; min?: string; avail?: string; product?: string; category?: string } = {}): Promise<string> {
    const r = await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, published_at)
       VALUES ($1, $2, $3, $4, $5::text, 40, $6::numeric, $7::numeric, 'quintal', $8, 'INR', 'published', 'public', $9, now())
       RETURNING id`, [tenantId, sellerId, o.product ?? product, o.category ?? catId, title, o.avail ?? '34', o.min ?? '1', o.price ?? 615000, JUNAGADH]);
    return r.rows[0].id;
  }
  /** A direct write to a listing, then the cached copy dropped — the way ListingService's own writers do after commit. */
  async function patchListing(id: string, set: string, params: unknown[] = []): Promise<void> {
    await admin.query(`UPDATE listings SET ${set} WHERE id = $1`, [id, ...params]);
    await cache.del(`t:${LIVE}:listing:${id}`);
  }
  const authed = () => ({ authorization: `Bearer ${token}`, 'x-tenant-id': LIVE });
  const add = (listingId: string, quantity: number | string, extra: Record<string, string> = {}) =>
    request(http).post('/v1/cart/items').set({ ...authed(), ...extra }).send({ listingId, quantity });
  const cart = async () => (await request(http).get('/v1/cart').set(authed())).body.data;
  const line = async (id: string) => (await cart()).items.find((x: { listingId: string }) => x.listingId === id);
  const clear = () => request(http).delete('/v1/cart').set(authed());
  const place = (body: Record<string, unknown> = {}) => request(http).post('/v1/checkout').set({ ...authed(), 'idempotency-key': randomUUID() }).send(body);
  const preview = (body: Record<string, unknown> = {}) => request(http).post('/v1/checkout/preview').set(authed()).send(body);
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO s2b ${LIVE.slice(0, 4)}`); await makeTenant(admin, OTHER, `Girnar FPO s2b ${OTHER.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, OTHER], JUNAGADH]);
    liveSlug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
    otherSlug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [OTHER])).rows[0].slug;
    seller = await makeUser(admin); seller2 = await makeUser(admin); suspendedSeller = await makeUser(admin); staff = await makeUser(admin);
    otherSeller = await makeUser(admin); buyer = await makeUser(admin);
    for (const u of [seller, seller2, suspendedSeller]) await role(u, LIVE, 'farmer');
    await role(staff, LIVE, 'tenant_staff'); await role(buyer, LIVE, 'customer'); await role(otherSeller, OTHER, 'farmer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = (p: string) => p + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds s2b', $1::text::ltree, 1, true) RETURNING id`, [code('cs2b')])).rows[0].id;
    catInputs = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Inputs s2b', $1::text::ltree, 1, true) RETURNING id`, [code('is2b')])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut s2b', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    productLic = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Chlorpyrifos s2b', 'quintal', true) RETURNING id`, [catInputs])).rows[0].id;
    productBan = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Monocrotophos s2b', 'quintal', true) RETURNING id`, [catInputs])).rows[0].id;
    // the window starts well before today: a rule's window is checked on the UTC day (2a's `todayUtc`), and the column's default is the
    // database's own date — near midnight IST those are different days (named in the wave report, found writing this spec)
    await admin.query(`INSERT INTO regulated_product_rules (product_id, rule_type, payload, effective_from) VALUES ($1, 'license_required', '{}'::jsonb, '2026-01-01')`, [productLic]);
    await admin.query(`INSERT INTO regulated_product_rules (product_id, rule_type, region_id, payload, effective_from) VALUES ($1, 'banned_state', $2, '{}'::jsonb, '2026-01-01')`, [productBan, MAHARASHTRA]);
    // a district INSIDE Maharashtra (the banned state's subtree) — the address lies there, not on the state row itself
    pune = (await admin.query(
      `INSERT INTO admin_regions (country_code, parent_id, level, default_name, path, is_active)
       VALUES ('IN', $1, 2, 'Pune s2b', ('in.mh.p' || substr(md5(random()::text), 1, 8))::ltree, true) RETURNING id`, [MAHARASHTRA])).rows[0].id;
    addrBanned = (await admin.query(`INSERT INTO addresses (user_id, tenant_id, line1, village, pincode, country_code, contact_name, region_id)
      VALUES ($1, $2, 'Shop 2, Market Yard', 'Pune', '411037', 'IN', 'Buyer s2b', $3) RETURNING id`, [buyer, LIVE, pune])).rows[0].id;
    addrOk = (await admin.query(`INSERT INTO addresses (user_id, tenant_id, line1, village, pincode, country_code, contact_name, region_id, is_default)
      VALUES ($1, $2, 'Plot 4, GIDC', 'Vanthali', '362001', 'IN', 'Buyer s2b', $3, true) RETURNING id`, [buyer, LIVE, JUNAGADH])).rows[0].id;
    L.min = await listing(LIVE, seller, 'Bold groundnut s2b', { min: '5' });
    L.drift = await listing(LIVE, seller2, 'Lokwan wheat s2b', { price: 252000, min: '2' });
    L.lic = await listing(LIVE, seller, 'Chlorpyrifos 20% EC s2b', { product: productLic, category: catInputs });
    L.ban = await listing(LIVE, seller, 'Monocrotophos s2b', { product: productBan, category: catInputs });
    L.susp = await listing(LIVE, suspendedSeller, 'Suspended seller lot s2b');
    L.dec = await listing(LIVE, seller2, 'Okra s2b', { price: 4000, min: '0' });
    L.paused = await listing(LIVE, seller2, 'Paused later s2b');
    L.other = await listing(OTHER, otherSeller, 'Girnar groundnut s2b');
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    token = mintToken(app, { userId: buyer, tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    await setFlag('storefront_cart', true);
  }, 240_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = true WHERE key = ANY($1::text[])`, [touched]); } catch { /* teardown only */ }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);
  beforeEach(async () => { await clear(); });

  it('(1) below the minimum → BELOW_MIN_ORDER (minimum + unit named) on add, update, the preview and placement', async () => {
    const a = await add(L.min, 3);
    expect(refusal(a)).toEqual([422, 'BELOW_MIN_ORDER']);
    expect(a.body.error.details).toMatchObject({ listingId: L.min, minOrderQty: '5.000', unitCode: 'quintal', requested: '3.000' });
    expect((await add(L.min, '5')).status).toBe(201);
    const u = await request(http).patch(`/v1/cart/items/${L.min}`).set(authed()).send({ quantity: '4.999' });
    expect(refusal(u)).toEqual([422, 'BELOW_MIN_ORDER']);
    expect((await line(L.min)).quantityDecimal).toBe('5.000');                      // the refused update changed nothing
    // the seller raises the minimum after the line was carted: the line says so, and the preview and placement refuse by name
    await patchListing(L.min, `min_order_qty = 6`);
    expect(await line(L.min)).toMatchObject({ belowMin: true, minOrderQty: '6.000', unitCode: 'quintal' });
    expect(refusal(await preview())).toEqual([422, 'BELOW_MIN_ORDER']);
    const p = await place();
    expect(refusal(p)).toEqual([422, 'BELOW_MIN_ORDER']);
    expect(p.body.error.details).toMatchObject({ minOrderQty: '6.000', unitCode: 'quintal' });
    expect((await admin.query(`SELECT count(*)::int n FROM orders WHERE tenant_id = $1 AND buyer_user_id = $2`, [LIVE, buyer])).rows[0].n).toBe(0);
    await patchListing(L.min, `min_order_qty = 5`);
  });

  it('(2) a price change after add → BOTH numbers on the line, placement PRICE_CHANGED with both; accept → charged the accepted price; changed again → refused again', async () => {
    expect((await add(L.drift, 8)).status).toBe(201);
    await patchListing(L.drift, `price_minor = 256000`);
    expect(await line(L.drift)).toMatchObject({ addedPriceMinor: '252000', currentPriceMinor: '256000', priceChanged: true, priceDeltaMinor: '4000', currencyCode: 'INR', purchasable: true, reason: null });
    const p = await place();
    expect(refusal(p)).toEqual([409, 'PRICE_CHANGED']);
    expect(p.body.error.details).toEqual({ listingId: L.drift, addedPriceMinor: '252000', currentPriceMinor: '256000', currencyCode: 'INR' });
    expect(refusal(await preview())).toEqual([409, 'PRICE_CHANGED']);
    const acc = await request(http).post(`/v1/cart/items/${L.drift}/accept-price`).set(authed()).send({ expectedPriceMinor: '256000' });
    expect(acc.status).toBe(200);
    expect(acc.body.data.accepted).toMatchObject({ listingId: L.drift, changed: true, previousPriceMinor: '252000', acceptedPriceMinor: '256000', currencyCode: 'INR' });
    expect(typeof acc.body.data.accepted.acceptedAt).toBe('string');
    expect(acc.body.data.cart.items[0]).toMatchObject({ addedPriceMinor: '256000', currentPriceMinor: '256000', priceChanged: false, priceDeltaMinor: null });
    const ok = await place();
    expect(ok.status).toBe(201);
    const item = (await admin.query(`SELECT unit_price_minor::text p, quantity::text q, line_total_minor::text t FROM order_items WHERE order_id = $1`, [ok.body.data.orders[0].id])).rows[0];
    expect(item).toEqual({ p: '256000', q: '8.000', t: '2048000' });
    // a second change after an accept: refused again (the accept was of 256000, not of any later price)
    expect((await add(L.drift, 8)).status).toBe(201);
    await patchListing(L.drift, `price_minor = 260000`);
    expect((await request(http).post(`/v1/cart/items/${L.drift}/accept-price`).set(authed()).send({ expectedPriceMinor: '260000' })).status).toBe(200);
    await patchListing(L.drift, `price_minor = 262000`);
    const again = await place();
    expect(refusal(again)).toEqual([409, 'PRICE_CHANGED']);
    expect(again.body.error.details).toMatchObject({ addedPriceMinor: '260000', currentPriceMinor: '262000' });
  });

  it('(3) license_required → LICENCE_REQUIRED at add; banned_state → BANNED_IN_REGION (region named) at preview + placement for an address inside it, allowed outside', async () => {
    const lic = await add(L.lic, 2);
    expect(refusal(lic)).toEqual([422, 'LICENCE_REQUIRED']);
    expect((await cart()).items).toEqual([]);
    expect((await add(L.ban, 2)).status).toBe(201);                                   // no licence rule on this one — the ban is regional
    const pv = await preview({ deliveryAddressId: addrBanned });
    expect(refusal(pv)).toEqual([422, 'BANNED_IN_REGION']);
    expect(pv.body.error.details).toEqual({ listingId: L.ban, region: 'Maharashtra' });
    const pl = await place({ deliveryAddressId: addrBanned });
    expect(refusal(pl)).toEqual([422, 'BANNED_IN_REGION']);
    expect(pl.body.error.details.region).toBe('Maharashtra');
    expect((await preview({ deliveryAddressId: addrOk })).status).toBe(201);
    expect((await place({ deliveryAddressId: addrOk })).status).toBe(201);
  });

  it('(4) storefront_cart OFF → 503 STOREFRONT_CART_OFF on the cart read, add, preview and placement; ON → 200', async () => {
    expect((await add(L.dec, 1)).status).toBe(201);
    await setFlag('storefront_cart', false);
    try {
      expect(refusal(await request(http).get('/v1/cart').set(authed()))).toEqual([503, 'STOREFRONT_CART_OFF']);
      expect(refusal(await add(L.dec, 2))).toEqual([503, 'STOREFRONT_CART_OFF']);
      expect(refusal(await request(http).post(`/v1/cart/items/${L.dec}/accept-price`).set(authed()).send({}))).toEqual([503, 'STOREFRONT_CART_OFF']);
      expect(refusal(await preview())).toEqual([503, 'STOREFRONT_CART_OFF']);
      expect(refusal(await place())).toEqual([503, 'STOREFRONT_CART_OFF']);
      // the public flags read says so (platform-scoped, with or without an organisation)
      expect((await request(http).get('/v1/storefront/flags')).body.data.storefront_cart).toBe(false);
      // an anonymous caller still meets 401 first (the switch is not an oracle)
      expect((await request(http).get('/v1/cart').set('x-tenant-slug', liveSlug)).status).toBe(401);
    } finally {
      await setFlag('storefront_cart', true);
    }
    expect((await request(http).get('/v1/cart').set(authed())).status).toBe(200);
    expect((await preview()).status).toBe(201);
    expect((await request(http).get('/v1/storefront/flags').set('x-tenant-slug', liveSlug)).body.data.storefront_cart).toBe(true);
  });

  it('(5) another organisation\'s listing, added from THAT store with this session → WRONG_STORE naming the other store\'s slug', async () => {
    const r = await add(L.other, 2, { 'x-tenant-slug': otherSlug });
    expect(refusal(r)).toEqual([409, 'WRONG_STORE']);
    expect(r.body.error.details).toMatchObject({ listingId: L.other, listingTenantSlug: otherSlug });
    expect(r.body.error.details.listingTenantName).toMatch(/^Girnar FPO s2b/);
    // without the store's name on the request the platform cannot say which store — the line is simply not this organisation's
    const anon = await add(L.other, 2);
    expect([anon.status, anon.body.error?.code, anon.body.error?.details?.reason]).toEqual([409, 'LISTING_NOT_PURCHASABLE', 'not_found']);
    expect((await cart()).items).toEqual([]);
  });

  it('(6) a decimal quantity 2.5 is accepted, stored as 2.500 and read back as "2.500" (never a float)', async () => {
    expect((await add(L.dec, '2.5')).status).toBe(201);
    expect(await line(L.dec)).toMatchObject({ quantityDecimal: '2.500', quantity: 2.5, unitPriceMinor: '4000', lineTotalMinor: '10000' });
    const db = (await admin.query(`SELECT ci.quantity::text q FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = $1 AND c.status = 'active' AND ci.listing_id = $2`, [buyer, L.dec])).rows[0];
    expect(db.q).toBe('2.500');
    expect(refusal(await add(L.dec, '2.5001'))).toEqual([422, 'VALIDATION_FAILED']);
    expect((await request(http).patch(`/v1/cart/items/${L.dec}`).set(authed()).send({ quantity: '0.125' })).status).toBe(200);
    expect((await line(L.dec)).quantityDecimal).toBe('0.125');
  });

  it('(7) a suspended seller\'s lot: refused at add; a carted line says `suspended` and placement refuses it', async () => {
    expect((await add(L.susp, 2)).status).toBe(201);
    await admin.query(`INSERT INTO tenant_member_suspensions (tenant_id, user_id, reason, suspended_by) VALUES ($1, $2, 'store2b live spec: a suspended seller', $3)`, [LIVE, suspendedSeller, staff]);
    expect(await line(L.susp)).toMatchObject({ purchasable: false, reason: 'suspended' });
    const p = await place();
    expect([p.status, p.body.error?.code, p.body.error?.details?.reason]).toEqual([409, 'LISTING_NOT_PURCHASABLE', 'suspended']);
    await clear();
    const a = await add(L.susp, 2);
    expect([a.status, a.body.error?.code, a.body.error?.details?.reason]).toEqual([409, 'LISTING_NOT_PURCHASABLE', 'suspended']);
  });

  it('(8) a non-purchasable line carries its REASON by name (paused, sold_out) and leaves the subtotal', async () => {
    expect((await add(L.paused, 2)).status).toBe(201);
    expect((await add(L.dec, 1)).status).toBe(201);
    await patchListing(L.paused, `status = 'paused'`);
    const c = await cart();
    expect(c.items.find((x: { listingId: string }) => x.listingId === L.paused)).toMatchObject({ purchasable: false, reason: 'paused', title: 'Paused later s2b' });
    expect(c.subtotalMinor).toBe('4000');                                             // the okra only: a paused lot is not a sum anyone can pay
    await patchListing(L.paused, `status = 'sold_out'`);
    expect(await line(L.paused)).toMatchObject({ purchasable: false, reason: 'sold_out' });
    await patchListing(L.paused, `status = 'published'`);
  });

  it('(9) accept-price: idempotent (unchanged price = a no-op 200, twice = the same), an unseen price refused, a non-purchasable line refused by reason', async () => {
    expect((await add(L.paused, 2)).status).toBe(201);
    const once = await request(http).post(`/v1/cart/items/${L.paused}/accept-price`).set(authed()).send({ expectedPriceMinor: '615000' });
    expect([once.status, once.body.data.accepted.changed, once.body.data.accepted.acceptedAt]).toEqual([200, false, null]);
    await patchListing(L.paused, `price_minor = 620000`);
    const unseen = await request(http).post(`/v1/cart/items/${L.paused}/accept-price`).set(authed()).send({ expectedPriceMinor: '615000' });
    expect(refusal(unseen)).toEqual([409, 'PRICE_CHANGED']);
    expect(unseen.body.error.details).toMatchObject({ addedPriceMinor: '615000', currentPriceMinor: '620000' });
    const first = await request(http).post(`/v1/cart/items/${L.paused}/accept-price`).set(authed()).send({ expectedPriceMinor: '620000' });
    const second = await request(http).post(`/v1/cart/items/${L.paused}/accept-price`).set(authed()).send({ expectedPriceMinor: '620000' });
    expect([first.status, first.body.data.accepted.changed, second.status, second.body.data.accepted.changed]).toEqual([200, true, 200, false]);
    expect((await line(L.paused)).addedPriceMinor).toBe('620000');
    await patchListing(L.paused, `status = 'paused'`);
    const refused = await request(http).post(`/v1/cart/items/${L.paused}/accept-price`).set(authed()).send({ expectedPriceMinor: '620000' });
    expect([refused.status, refused.body.error?.code, refused.body.error?.details?.reason]).toEqual([409, 'LISTING_NOT_PURCHASABLE', 'paused']);
    await patchListing(L.paused, `status = 'published', price_minor = 615000`);
  });
});
