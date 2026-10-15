// apps/api/src/__tests__/store3b-offers.integration.spec.ts · PC-56 STORE-3b — AN OFFER IS A NEGOTIATION WITH A CLOCK, A TURN, AND A REAL ORDER AT
// THE END, LIVE. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; the
// outbox consumers (OfferAcceptedHandler, OrderFromOfferCreatedHandler, the restock handler) are driven with the outbox rows the API wrote, exactly
// as the relay hands them over. Own fixtures (never the shared makeCategory). The `offers` flag (seed OFF — Law 10) is switched ON for THIS
// spec's tenant only (an allow-list) and restored afterwards.
//
// What it proves (brief §C6):
//   (1) accept on the seller's turn → 409 OFFER_NOT_YOUR_TURN (the entity's code) and nothing reserved;
//   (2) accept when available < quantity → 409 OFFER_STOCK_SHORT {available}; accept within stock → `quantity_available` decremented under the
//       lock, a checkout for the remainder + 1 refused LISTING_INSUFFICIENT_STOCK; the relay-created order carries `stock_reserved_at`; its
//       reasoned cancel (3a) restocks ONCE;
//   (3) the created order: the LISTING's currency (USD), the decimal quantity exact, `offerId` serialised, the platform fee and the buyer
//       commission EQUAL to what checkout computes for the same goods value under the same rule (a buyer-charged commission rule + the split
//       ON), no delivery charge, the rows sum to the total; the offer `converted` with `convertedOrderId`;
//   (4) counter / accept / reject replayed with the same key → one round row, one effect;
//   (5) the clock from the SETTING (round TTL set to 24 h here — not the 48 h fallback): make, counter reset it; a make beyond → 422
//       OFFER_EXPIRY_TOO_LATE; a counter past the max life → 409 OFFER_MAX_LIFE; the expiry act writes an `expire` round row;
//   (6) a decline with `lot_committed` → `declineReasonCode` on the read; an unknown code → 422 OFFER_DECLINE_REASON_UNKNOWN;
//   (7) `offers/counts` bounded (cap 3 → capped);
//   (8) two offers in ONE millisecond both page (the µs keyset);
//   (9) a paused listing / a suspended seller → OFFER_LISTING_UNAVAILABLE / OFFER_SELLER_UNAVAILABLE at accept, nothing reserved;
//   (10) the relay gate is run as its own spec (group B).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OutboxEvent } from '../core/outbox/event-envelope';
import { ListingOfferService } from '../modules/offers/services/listing-offer.service';
import { OrderFromOfferCreatedHandler } from '../modules/offers/events/handlers/order-from-offer-created.handler';
import { OfferAcceptedHandler } from '../modules/orders/events/handlers/offer-accepted.handler';
import { OrderCancelledRestockHandler } from '../modules/orders/events/handlers/order-cancelled-restock.handler';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const H_MS = 3_600_000;

run('PC-56 STORE-3b · offers: the clock, the turn, the reservation, the order (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID();
  let seller = ''; let seller2 = ''; let buyer = ''; let buyer2 = ''; let buyer3 = ''; let cbuyer = ''; let pbuyer = ''; let staff = '';
  let catId = ''; let product = '';
  const L: Record<string, string> = {};
  const T: Record<string, string> = {};
  let changedMind = '';
  const flagBackup: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];
  const RELAY_TX = { query: async () => { throw new Error('the relay transaction must not be used'); } } as never;

  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': LIVE });
  async function setFlag(key: string, on: boolean): Promise<void> {
    if (!flagBackup.some((f) => f.key === key)) {
      const row = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      if (row) flagBackup.push(row);
    }
    // an ALLOW-LIST for this spec's tenant (the relay gate's way) — never a platform-wide switch
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 0, rules = $3::jsonb WHERE key = $1`, [key, on, JSON.stringify(on ? { tenant_ids: [LIVE] } : {})]);
    for (const c of [`flag:${key}`, `flagstale:${key}`, 'flags:all', `flagctx:${LIVE}`]) await cache.del(c);
  }
  async function travel(sql: string, p: unknown[] = []): Promise<any[]> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = await admin.connect();
    try { await c.query(`SET session_replication_role = replica`); return (await c.query(sql, p)).rows; }
    finally { await c.query(`SET session_replication_role = origin`).catch(() => undefined); c.release(); }
  }
  async function role(userId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, LIVE, code]);
  }
  async function listing(title: string, o: { seller?: string; price?: number; total?: string; currency?: string } = {}): Promise<string> {
    const r = await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, published_at, sale_type)
       VALUES ($1, $2, $3, $4, $5::text, $6::numeric, $6::numeric, 1, 'quintal', $7, $8, 'published', 'public', $9, now(), 'both') RETURNING id`,
      [LIVE, o.seller ?? seller, product, catId, title, o.total ?? '40', o.price ?? 252_000, o.currency ?? 'INR', JUNAGADH]);
    return r.rows[0].id;
  }
  const available = async (id: string) => String((await admin.query(`SELECT quantity_available::text a FROM listings WHERE id = $1`, [id])).rows[0].a);
  const invalidate = (id: string) => cache.del(`t:${LIVE}:listing:${id}`);
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const make = (token: string, listingId: string, quantity: string, offeredPriceMinor: string, extra: Record<string, unknown> = {}) =>
    request(http).post('/v1/offers').set({ ...H(token), 'idempotency-key': randomUUID() }).send({ listingId, quantity, offeredPriceMinor, ...extra });
  async function made(token: string, listingId: string, quantity: string, price: string): Promise<string> {
    const r = await make(token, listingId, quantity, price);
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    return r.body.data.offerId as string;
  }
  const act = (token: string, id: string, a: 'counter' | 'accept' | 'reject', body: Record<string, unknown> = {}, key?: string) =>
    request(http).post(`/v1/offers/${id}/${a}`).set({ ...H(token), ...(key ? { 'idempotency-key': key } : {}) }).send(body);
  const read = async (token: string, id: string) => { const r = await request(http).get(`/v1/offers/${id}`).set(H(token)); expect(r.status).toBe(200); return r.body.data; };
  const rounds = async (offerId: string) => (await admin.query(`SELECT round, party, act, price_minor::text price FROM listing_offer_rounds WHERE offer_id = $1 ORDER BY created_at, id`, [offerId])).rows;
  async function outbox(eventType: string, where: string, p: unknown[]): Promise<OutboxEvent | null> {
    const r = (await admin.query(`SELECT id::text, tenant_id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events WHERE event_type = $1 AND ${where} ORDER BY id DESC LIMIT 1`, [eventType, ...p])).rows[0];
    return r ? { id: r.id, tenantId: r.tenant_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload } : null;
  }
  /** What the relay does for an accepted offer: the order (OfferAcceptedHandler), then the link-back (OrderFromOfferCreatedHandler). */
  async function relayAccepted(offerId: string): Promise<string> {
    const ev = await outbox('offers.offer_accepted', `aggregate_id = $2`, [offerId]);
    expect(ev).not.toBeNull();
    await app.get(OfferAcceptedHandler).handle(ev!, RELAY_TX);
    const link = await outbox('orders.order_from_offer_created', `payload->>'offerId' = $2`, [offerId]);
    expect(link).not.toBeNull();
    await app.get(OrderFromOfferCreatedHandler).handle(link!, RELAY_TX);
    return String(link!.payload.orderId);
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO s3b ${LIVE.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = $1`, [LIVE, JUNAGADH]);
    [seller, seller2, buyer, buyer2, buyer3, cbuyer, pbuyer, staff] = await Promise.all(Array.from({ length: 8 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [seller]);
    for (const s of [seller, seller2]) await role(s, 'farmer');
    for (const b of [buyer, buyer2, buyer3, cbuyer, pbuyer]) await role(b, 'customer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO currencies (code, default_name, symbol, minor_units, is_active) VALUES ('USD', 'US dollar', '$', 2, true) ON CONFLICT (code) DO NOTHING`);
    const code = 'cs3b' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Grains s3b', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Wheat s3b', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    L.main = await listing('Lokwan wheat s3b', { total: '400' });
    L.short = await listing('Sharbati wheat s3b', { total: '10' });
    L.usd = await listing('Durum wheat s3b (USD)', { currency: 'USD', price: 31_500 });
    L.pause = await listing('Paused lot s3b');
    L.susp = await listing('Suspended seller lot s3b', { seller: seller2 });
    changedMind = (await admin.query(`SELECT id FROM lookup_values WHERE type_code = 'cancel_reason' AND tenant_id IS NULL AND code = 'changed_mind'`)).rows[0].id;
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin (foreign processes on IPv4 ephemeral ports)
    for (const [k, x] of [['buyer', buyer], ['buyer2', buyer2], ['buyer3', buyer3], ['cbuyer', cbuyer], ['pbuyer', pbuyer]] as const) {
      T[k] = mintToken(app, { userId: x, tenantId: LIVE, roles: ['customer'], perms: ['order.create', 'offer.create'] });
    }
    T.seller = mintToken(app, { userId: seller, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create', 'offer.create'] });
    T.seller2 = mintToken(app, { userId: seller2, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create', 'offer.create'] });
    await setFlag('offers', true); await setFlag('online_payments', false); await setFlag('buyer_charges', false); await setFlag('commission_split', false);
  }, 240_000);
  afterAll(async () => {
    await admin?.query(`UPDATE setting_definitions SET default_value = '48' WHERE key = 'offers.round_ttl_hours'`).catch(() => undefined);
    for (const f of flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [f.key, f.is_enabled, f.rollout_pct, JSON.stringify(f.rules ?? {})]).catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = $1`, [LIVE]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  it('(1) accept on the SELLER\'s turn by the buyer → 409 OFFER_NOT_YOUR_TURN (the entity\'s code); nothing reserved, no round written', async () => {
    const o = await made(T.buyer, L.main, '5', '240000');
    const before = await available(L.main);
    expect(refusal(await act(T.buyer, o, 'accept', {}, randomUUID()))).toEqual([409, 'OFFER_NOT_YOUR_TURN']);
    expect(await available(L.main)).toBe(before);
    expect((await rounds(o)).map((r) => r.act)).toEqual(['offer']);
    const v = await read(T.buyer, o);
    expect([v.yourTurn, v.allowedActs, v.listingTitle, v.unitCode, v.organisation?.name.startsWith('Anand FPO')]).toEqual([false, [], 'Lokwan wheat s3b', 'quintal', true]);
    expect(JSON.stringify(v)).not.toContain(seller);                                     // never the seller's person id
    expect(JSON.stringify(v)).not.toContain('Ramesh');
  });

  describe('(2) accept RESERVES (founder D2)', () => {
    it('available < the offer\'s quantity at accept → 409 OFFER_STOCK_SHORT {available: the locked remainder}; nothing taken', async () => {
      const o = await made(T.buyer, L.short, '8', '240000');
      expect((await act(T.seller, o, 'counter', { priceMinor: '248000' })).status).toBe(201);
      await admin.query(`UPDATE listings SET quantity_available = 6 WHERE id = $1`, [L.short]); await invalidate(L.short);
      const r = await act(T.buyer, o, 'accept', {}, randomUUID());
      expect([r.status, r.body.error?.code, r.body.error?.details]).toEqual([409, 'OFFER_STOCK_SHORT', { available: '6.000' }]);
      expect(await available(L.short)).toBe('6.000');
      expect((await read(T.buyer, o)).status).toBe('countered');
      await admin.query(`UPDATE listings SET quantity_available = 10 WHERE id = $1`, [L.short]); await invalidate(L.short);
    });
    it('within stock: decremented under the lock; a checkout for the remainder + 1 → LISTING_INSUFFICIENT_STOCK; the order carries stock_reserved_at; its cancel restocks ONCE', async () => {
      // a second buyer carts 3 BEFORE the accept (the cart then is fine), so the refusal comes from placement's locked re-read
      await request(http).delete('/v1/cart').set(H(T.buyer2));
      expect((await request(http).post('/v1/cart/items').set(H(T.buyer2)).send({ listingId: L.short, quantity: '3' })).status).toBe(201);
      const o = await made(T.buyer, L.short, '8', '245000');
      const a = await act(T.seller, o, 'accept', {}, randomUUID());                         // round 1: the seller's turn
      expect([a.status, a.body.data.status, a.body.data.conversion, a.body.data.convertedOrderId]).toEqual([201, 'accepted', 'creating', null]);
      expect(await available(L.short)).toBe('2.000');
      const c = await request(http).post('/v1/checkout').set({ ...H(T.buyer2), 'idempotency-key': randomUUID() }).send({});
      expect(refusal(c)).toEqual([409, 'LISTING_INSUFFICIENT_STOCK']);
      const orderId = await relayAccepted(o);
      const row = (await admin.query(`SELECT status::text, source, offer_id, stock_reserved_at IS NOT NULL AS reserved FROM orders WHERE id = $1`, [orderId])).rows[0];
      expect(row).toEqual({ status: 'created', source: 'offer', offer_id: o, reserved: true });
      expect(await available(L.short)).toBe('2.000');                                     // the order creation took nothing more
      const cancel = await request(http).post(`/v1/orders/${orderId}/cancel`).set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send({ reasonId: changedMind });
      expect([cancel.status, cancel.body.error?.code]).toEqual([201, undefined]);
      const ev = await outbox('orders.order_cancelled', `aggregate_id = $2`, [orderId]);
      await app.get(OrderCancelledRestockHandler).handle(ev!);
      expect(await available(L.short)).toBe('10.000');
      await app.get(OrderCancelledRestockHandler).handle(ev!);                              // a replay restocks nothing
      expect(await available(L.short)).toBe('10.000');
    });
  });

  it('(3) the offer order: the LISTING\'s currency, the decimal quantity, offerId, checkout\'s fees for the same goods value, no delivery, rows sum; the offer converted', async () => {
    await setFlag('commission_split', true);
    await travel(`INSERT INTO commission_rules (tenant_id, source, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_from, is_active)
      VALUES ($1, NULL, 200, 0, 1000, 'buyer', 1, CURRENT_DATE - 1, true)`, [LIVE]);
    try {
      const o = await made(T.buyer, L.usd, '2.345', '31500');                                // at the list price — the same goods value as a checkout
      const a = await act(T.seller, o, 'accept', {}, randomUUID());
      expect(a.status).toBe(201);
      const offerValue = a.body.data.offerValueMinor as string;
      const orderId = await relayAccepted(o);
      const order = (await request(http).get(`/v1/orders/${orderId}`).set(H(T.buyer))).body.data;
      expect([order.currencyCode, order.source, order.offerId, order.auctionId, order.deliveryFeeMinor]).toEqual(['USD', 'offer', o, null, '0']);
      expect(order.subtotalMinor).toBe(offerValue);                                       // the server value the buyer read IS the order's subtotal
      expect(String(order.items[0].quantity)).toMatch(/^2\.345(0*)$/);
      // checkout's preview for the SAME goods value (the same lot, the same quantity) under the same rule
      await request(http).delete('/v1/cart').set(H(T.buyer3));
      expect((await request(http).post('/v1/cart/items').set(H(T.buyer3)).send({ listingId: L.usd, quantity: '2.345' })).status).toBe(201);
      const p = (await request(http).post('/v1/checkout/preview').set(H(T.buyer3)).send({})).body.data;
      expect(p.subtotalMinor).toBe(order.subtotalMinor);
      expect(BigInt(p.buyerCommissionMinor)).toBeGreaterThan(0n);
      expect([order.platformFeeMinor, order.buyerCommissionMinor]).toEqual([p.platformFeeMinor, p.buyerCommissionMinor]);
      const rows = BigInt(order.subtotalMinor) + BigInt(order.deliveryFeeMinor) + BigInt(order.taxMinor) - BigInt(order.discountMinor) + BigInt(order.platformFeeMinor) + BigInt(order.buyerCommissionMinor);
      expect(rows.toString()).toBe(order.totalMinor);
      const snap = (await admin.query(`SELECT commission_snapshot, charge_snapshot FROM orders WHERE id = $1`, [orderId])).rows[0];
      expect(snap.commission_snapshot).not.toBeNull();
      expect(JSON.stringify(snap.charge_snapshot)).toContain('buyer_commission');
      const v = await read(T.buyer, o);
      expect([v.status, v.convertedOrderId, v.conversion, v.convertedOrderStatus]).toEqual(['converted', orderId, 'converted', 'created']);
      expect((await rounds(o)).map((r) => [r.party, r.act])).toEqual([['buyer', 'offer'], ['seller', 'accept']]);
    } finally {
      await setFlag('commission_split', false);
      await travel(`DELETE FROM commission_rules WHERE tenant_id = $1`, [LIVE]);
    }
  });

  it('(4) counter / accept / reject replayed with the SAME key → one round row, one effect', async () => {
    const a = await made(T.buyer, L.main, '3', '240000');
    const k1 = randomUUID();
    const c1 = await act(T.seller, a, 'counter', { priceMinor: '250000' }, k1);
    const c2 = await act(T.seller, a, 'counter', { priceMinor: '250000' }, k1);
    expect([c1.status, c2.status, c2.body.data.round]).toEqual([201, 201, 2]);
    expect((await rounds(a)).map((r) => r.act)).toEqual(['offer', 'counter']);
    const k2 = randomUUID();
    const before = await available(L.main);
    const x1 = await act(T.buyer, a, 'accept', {}, k2);
    const x2 = await act(T.buyer, a, 'accept', {}, k2);
    expect([x1.status, x2.status, x2.body.data.status]).toEqual([201, 201, 'accepted']);
    expect((await rounds(a)).map((r) => r.act)).toEqual(['offer', 'counter', 'accept']);
    expect(Number(before) - Number(await available(L.main))).toBe(3);                      // reserved ONCE
    const b = await made(T.buyer, L.main, '2', '240000');
    const k3 = randomUUID();
    const r1 = await act(T.buyer, b, 'reject', { reasonCode: 'price' }, k3);
    const r2 = await act(T.buyer, b, 'reject', { reasonCode: 'price' }, k3);
    expect([r1.status, r2.status, r2.body.data.status]).toEqual([201, 201, 'rejected']);
    expect((await rounds(b)).map((r) => r.act)).toEqual(['offer', 'decline']);
    expect(Number((await admin.query(`SELECT count(*) n FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'offers.offer_rejected'`, [b])).rows[0].n)).toBe(1);
  });

  describe('(5) the clock from the SETTING (founder D1)', () => {
    beforeAll(async () => { await admin.query(`UPDATE setting_definitions SET default_value = '24' WHERE key = 'offers.round_ttl_hours'`); });
    afterAll(async () => { await admin.query(`UPDATE setting_definitions SET default_value = '48' WHERE key = 'offers.round_ttl_hours'`); });
    it('make → one round of 24 h (the setting, not the 48 h fallback); a counter RESETS it to a full round from the counter', async () => {
      const t0 = Date.now();
      const r = await make(T.buyer, L.main, '1', '240000');
      expect(r.status).toBe(201);
      expect(Math.abs(new Date(r.body.data.expiresAt).getTime() - (t0 + 24 * H_MS))).toBeLessThan(60_000);
      expect([r.body.data.roundTtlHours, r.body.data.respondBy]).toEqual([24, r.body.data.expiresAt]);
      const o = r.body.data.offerId as string;
      await admin.query(`UPDATE listing_offers SET expires_at = now() + interval '2 hours' WHERE id = $1`, [o]);   // most of the round has run
      const t1 = Date.now();
      const c = await act(T.seller, o, 'counter', { priceMinor: '248000' });
      expect(c.status).toBe(201);
      expect(Math.abs(new Date(c.body.data.expiresAt).getTime() - (t1 + 24 * H_MS))).toBeLessThan(60_000);
      expect(Math.abs(new Date(c.body.data.maxLifeEndsAt).getTime() - (new Date(r.body.data.createdAt).getTime() + 336 * H_MS))).toBeLessThan(60_000);
    });
    it('a make with expiresAt beyond one round → 422 OFFER_EXPIRY_TOO_LATE {max}', async () => {
      const r = await make(T.buyer, L.main, '1', '240000', { expiresAt: new Date(Date.now() + 25 * H_MS).toISOString() });
      expect(refusal(r)).toEqual([422, 'OFFER_EXPIRY_TOO_LATE']);
      expect(typeof r.body.error.details.max).toBe('string');
    });
    it('a counter whose round would pass the max life → 409 OFFER_MAX_LIFE {endsAt}; nothing changes', async () => {
      const o = await made(T.buyer, L.main, '1', '240000');
      await admin.query(`UPDATE listing_offers SET created_at = now() - interval '330 hours' WHERE id = $1`, [o]);
      const r = await act(T.seller, o, 'counter', { priceMinor: '249000' });
      expect(refusal(r)).toEqual([409, 'OFFER_MAX_LIFE']);
      expect(typeof r.body.error.details.endsAt).toBe('string');
      expect((await read(T.buyer, o)).round).toBe(1);
    });
    it('the expiry act (offers-expire) writes an `expire` round row by the system', async () => {
      const o = await made(T.buyer, L.main, '1', '240000');
      await admin.query(`UPDATE listing_offers SET expires_at = now() - interval '1 minute' WHERE id = $1`, [o]);
      expect(await app.get(ListingOfferService).expire(LIVE, o)).toBe(true);
      expect((await rounds(o)).map((r) => [r.party, r.act, r.price])).toEqual([['buyer', 'offer', '240000'], ['system', 'expire', null]]);
      expect((await read(T.buyer, o)).status).toBe('expired');
    });
  });

  it('(6) a decline with `lot_committed` → declineReasonCode + declinedBy on the read; an unknown code → 422, nothing changes', async () => {
    const o = await made(T.buyer, L.main, '1', '240000');
    expect((await act(T.seller, o, 'counter', { priceMinor: '250000' })).status).toBe(201);
    const bad = await act(T.buyer, o, 'reject', { reasonCode: 'holding_for_auction' }, randomUUID());
    expect(refusal(bad)).toEqual([422, 'OFFER_DECLINE_REASON_UNKNOWN']);
    expect((await read(T.buyer, o)).status).toBe('countered');
    const ok = await act(T.buyer, o, 'reject', { reasonCode: 'lot_committed' }, randomUUID());
    expect(ok.status).toBe(201);
    const v = await read(T.buyer, o);
    expect([v.status, v.declineReasonCode, v.declinedBy]).toEqual(['rejected', 'lot_committed', 'buyer']);
    expect((await admin.query(`SELECT decline_reason_code, declined_by FROM listing_offers WHERE id = $1`, [o])).rows[0]).toEqual({ decline_reason_code: 'lot_committed', declined_by: 'buyer' });
  });

  it('(7) `offers/counts` — the caller\'s own, bounded: cap 3 → capped; the route answers every status', async () => {
    for (let i = 0; i < 4; i++) await made(T.cbuyer, L.main, '1', '240000');
    const c = await app.get(ListingOfferService).counts(LIVE, cbuyer, 3);
    expect([c.all, c.open, c.rejected]).toEqual([{ count: 3, capped: true }, { count: 3, capped: true }, { count: 0, capped: false }]);
    const r = await request(http).get('/v1/offers/counts').set(H(T.cbuyer));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(['accepted', 'all', 'converted', 'countered', 'expired', 'open', 'rejected']);
    expect(r.body.data.all).toEqual({ count: 4, capped: false });
  });

  it('(8) three offers written in ONE millisecond all page, one per page (the µs keyset — a millisecond cursor skipped them)', async () => {
    const ids: string[] = [];
    for (const us of ['123700', '123400', '123100']) {
      ids.push((await admin.query(`INSERT INTO listing_offers (tenant_id, listing_id, buyer_user_id, quantity, offered_price_minor, status, expires_at, created_at)
        VALUES ($1, $2, $3, 1, 240000, 'open', now() + interval '1 day', $4::timestamptz) RETURNING id`, [LIVE, L.main, pbuyer, `2026-10-15T06:00:00.${us}Z`])).rows[0].id);
    }
    const seen: string[] = []; let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const r: request.Response = await request(http).get(`/v1/offers?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).set(H(T.pbuyer));
      expect(r.status).toBe(200);
      seen.push(...(r.body.data as Array<{ offerId: string }>).map((x) => x.offerId));
      cursor = r.body.meta.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(ids);
  });

  it('(9) a PAUSED listing → OFFER_LISTING_UNAVAILABLE; a SUSPENDED seller → OFFER_SELLER_UNAVAILABLE; nothing reserved', async () => {
    const p = await made(T.buyer, L.pause, '2', '240000');
    expect((await act(T.seller, p, 'counter', { priceMinor: '250000' })).status).toBe(201);
    await admin.query(`UPDATE listings SET status = 'paused' WHERE id = $1`, [L.pause]); await invalidate(L.pause);
    expect(refusal(await act(T.buyer, p, 'accept', {}, randomUUID()))).toEqual([409, 'OFFER_LISTING_UNAVAILABLE']);
    expect(await available(L.pause)).toBe('40.000');
    const s = await made(T.buyer, L.susp, '2', '240000');
    expect((await act(T.seller2, s, 'counter', { priceMinor: '250000' })).status).toBe(201);
    await admin.query(`INSERT INTO tenant_member_suspensions (tenant_id, user_id, reason, suspended_by) VALUES ($1, $2, 'store3b live spec: a suspended seller', $3)`, [LIVE, seller2, staff]);
    expect(refusal(await act(T.buyer, s, 'accept', {}, randomUUID()))).toEqual([409, 'OFFER_SELLER_UNAVAILABLE']);
    expect(await available(L.susp)).toBe('40.000');
    expect((await read(T.buyer, s)).status).toBe('countered');
  });
});
