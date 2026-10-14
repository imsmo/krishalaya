// apps/api/src/__tests__/hotfix4-money-privacy.integration.spec.ts · PC-56 HOTFIX-4 — STOREFRONT MONEY AND PRIVACY TRUTH, LIVE (the real
// AppModule over HTTP, real Postgres + RLS as kv_app; supertest drives the same middleware, guards, pipes and filter production runs).
//
// What it proves (brief §A, survey §7 "hotfix" items 1–6):
//   A6  an ANONYMOUS `GET /v1/listings/:id` carries an allow-list only — none of lat, lng, pincode, regionId, tenantId, version, aiExtracted,
//       sellerUserId — and names the ORGANISATION and a district NAME (founder D3); the owner's own read is untouched;
//   A7  `GET /v1/sellers/:id/public` → 404 for a buyer, a staff member, another organisation's seller and an unknown id; a member seller →
//       the organisation's fields, no person's name, no join date, no region uuid;
//   A1/A2/C2/A9 (online_payments OFF, the seed) a two-seller checkout creates two `created` orders, paymentState `none`, both named by the
//       checkout group; the payments route answers 404 (no Pay step exists); the order detail carries platformFeeMinor + buyerCommissionMinor;
//   A5  (buyer_charges + commission_split ON, a zone tenant) the preview WITHOUT the address says `deliveryNeedsAddress`; WITH it, its
//       delivery fee is the one placement charges, its grand total = the sum of its rows, and the placed order's rows sum to its total
//       (subtotal + delivery + tax − discount + platformFee + buyerCommission) with fee and buyer commission both non-zero;
//   A1  (online_payments ON) the order is `pending`; its SELLER cannot confirm it (ORDER_AWAITING_PAYMENT);
//   A4  a Razorpay-shaped webhook whose payment entity carries NO notes resolves its context from OUR payment row (0206) and is booked;
//       notes that name another payment are refused (PAYMENT_WEBHOOK_CONTEXT_MISMATCH) and an unknown gateway order books nothing;
//   A3  payment.failed (pay_A) then payment.captured (pay_B) on the SAME gateway order books exactly once (one ledger transaction, escrow +
//       total), the order confirms (paymentState `paid`); a replayed capture is a no-op; the failed attempt's own id is refused by name.
// Real Razorpay test-mode proof is STILL OWED (no keys on this Mac): the payloads below are shaped from Razorpay's documented webhook body.
import 'reflect-metadata';
import request from 'supertest';
import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { ResilienceService } from '../core/resilience/resilience.service';
import { GatewayRegistry } from '../modules/payments/gateway/gateway.registry';
import { RazorpayGateway } from '../modules/payments/gateway/razorpay.gateway';
import type { CreateOrderInput, CreateOrderResult } from '../modules/payments/gateway/payment-gateway.port';
import { PaymentSucceededHandler } from '../modules/orders/events/handlers/payment-succeeded.handler';
import { PUBLIC_LISTING_KEYS } from '../modules/listings/domain/listing-public.view';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const RZP_SECRET = 'hf4-razorpay-webhook-secret';
const LINK_KEYS = ['qrToken', 'auctionId', 'auctionStatus', 'auctionEndsAt'];
const LEAKS = ['lat', 'lng', 'pincode', 'regionId', 'tenantId', 'version', 'aiExtracted', 'sellerUserId', 'visibility', 'createdBy'];

/** A Razorpay adapter whose ORDER creation does not leave this machine (no keys here) — every other method is the real adapter. */
class OfflineRazorpay extends RazorpayGateway {
  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> { return { gatewayOrderId: `order_hf4${input.receipt.replace(/-/g, '').slice(0, 14)}` }; }
}

run('PC-56 HOTFIX-4 · storefront money and privacy truth (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const OTHER = randomUUID();
  let liveSlug = ''; let seller = ''; let seller2 = ''; let buyer = ''; let staff = ''; let otherSeller = '';
  let catId = ''; let productId = ''; let l1 = ''; let l2 = ''; let addressId = '';
  let buyerToken = ''; let sellerToken = '';
  const touched = ['online_payments', 'buyer_charges', 'commission_split'];

  const setFlags = async (on: Record<string, boolean>) => {
    for (const [k, v] of Object.entries(on)) {
      await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k, v]);
      for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    }
    await cache.del('flags:all'); await cache.del(`flagctx:${LIVE}`);
  };
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function listing(tenantId: string, sellerId: string, title: string, priceMinor: number): Promise<string> {
    const r = await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, description, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, pincode, lat, lng, ai_extracted, organic_claim, harvest_date, published_at)
       VALUES ($1, $2, $3, $4, $5::text, 'Moisture 7.8%', 40, 40, 1, 'quintal', $6, 'INR', 'published', 'public', $7, '362001', 21.522222, 70.457777, true,
               'natural', '2026-07-08', now())
       RETURNING id`, [tenantId, sellerId, productId, catId, title, priceMinor, JUNAGADH]);
    return r.rows[0].id;
  }
  async function travel(sql: string, p: unknown[] = []): Promise<any[]> {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const c = await admin.connect();
    try { await c.query(`SET session_replication_role = replica`); return (await c.query(sql, p)).rows; }
    finally { await c.query(`SET session_replication_role = origin`).catch(() => undefined); c.release(); }
  }
  const authed = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': LIVE });
  const rzpBody = (event: 'payment.captured' | 'payment.failed', gatewayOrderId: string, payId: string, amount: string, notes?: Record<string, string>) => JSON.stringify({
    entity: 'event', account_id: 'acc_hf4', event, contains: ['payment'], created_at: Math.floor(Date.now() / 1000),
    payload: { payment: { entity: {
      id: payId, entity: 'payment', amount: Number(amount), currency: 'INR', status: event === 'payment.captured' ? 'captured' : 'failed',
      order_id: gatewayOrderId, method: 'upi', captured: event === 'payment.captured',
      ...(event === 'payment.failed' ? { error_code: 'BAD_REQUEST_ERROR', error_description: 'Payment failed' } : {}),
      notes: notes ?? [],   // Razorpay sends [] for "no notes" — the context must NOT depend on them
    } } },
  });
  const webhook = (body: string, eventId: string) => request(http).post('/v1/payments/webhooks/razorpay')
    .set({ 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', RZP_SECRET).update(body).digest('hex'), 'x-razorpay-event-id': eventId })
    .send(body);
  const ledgerTxns = async (paymentId: string) => Number((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE reference_type = 'payment' AND reference_id = $1`, [paymentId])).rows[0].n);
  const sumRows = (o: Record<string, string>) => BigInt(o.subtotalMinor) + BigInt(o.deliveryFeeMinor) + BigInt(o.taxMinor) - BigInt(o.discountMinor)
    + BigInt(o.platformFeeMinor) + BigInt(o.buyerCommissionMinor);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    // main.ts teaches BigInt to serialise process-wide at boot; the e2e bootstrap does not run main.ts, so the OWNER's full listing read
    // (bigint priceMinor) would 500 here and only here — the same one line, set the same way
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, 'Anand FPO hf4'); await makeTenant(admin, OTHER, 'Girnar FPO hf4');
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, OTHER], JUNAGADH]);
    liveSlug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
    seller = await makeUser(admin); seller2 = await makeUser(admin); buyer = await makeUser(admin); staff = await makeUser(admin); otherSeller = await makeUser(admin);
    await admin.query(`UPDATE users SET full_name = 'Ramesh Patel hf4' WHERE id = $1`, [seller]);
    await role(seller, LIVE, 'farmer'); await role(seller2, LIVE, 'farmer'); await role(buyer, LIVE, 'customer'); await role(staff, LIVE, 'tenant_staff');
    await role(otherSeller, OTHER, 'farmer');
    const code = 'chf4' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds hf4', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    productId = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut hf4', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    l1 = await listing(LIVE, seller, 'Bold groundnut hf4', 615000);
    l2 = await listing(LIVE, seller2, 'Java groundnut hf4', 590000);
    addressId = (await admin.query(`INSERT INTO addresses (user_id, tenant_id, line1, village, pincode, country_code, contact_name, is_default)
      VALUES ($1, $2, 'Plot 4, GIDC', 'Vanthali', '362001', 'IN', 'Buyer hf4', true) RETURNING id`, [buyer, LIVE])).rows[0].id;
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    buyerToken = mintToken(app, { userId: buyer, tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    sellerToken = mintToken(app, { userId: seller, tenantId: LIVE, roles: ['farmer'], perms: ['listing.create', 'listing.update', 'order.manage'] });
    // the real Razorpay adapter (signature + parseEvent), with an order creation that stays on this machine
    const reg = app.get(GatewayRegistry);
    reg.register(new OfflineRazorpay({ keyId: 'rzp_test_hf4', keySecret: 'hf4-key-secret', webhookSecret: RZP_SECRET }, app.get(ResilienceService)), true);
  }, 240_000);
  afterAll(async () => {
    try {
      const reg = app?.get(GatewayRegistry); if (reg?.has('sandbox')) reg.register(reg.get('sandbox'), true);
      await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = ANY($1::text[])`, [touched]);
    } catch { /* teardown only */ }
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  describe('A6 · the public listing is an allow-list (survey F-7, founder D3)', () => {
    it('anonymous GET /v1/listings/:id → only the allow-listed keys (+ the public links); no coordinates, ids, version, AI flag or seller person', async () => {
      const r = await request(http).get(`/v1/listings/${l1}`).set('x-tenant-slug', liveSlug);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.data).sort()).toEqual([...PUBLIC_LISTING_KEYS, ...LINK_KEYS].sort());
      for (const k of LEAKS) expect([k, r.body.data[k]]).toEqual([k, undefined]);
      expect(JSON.stringify(r.body)).not.toMatch(/21\.52|70\.45|362001|Ramesh/);
      expect(JSON.stringify(r.body)).not.toContain(seller);
      expect(r.body.data.organisation).toEqual({ slug: liveSlug, name: 'Anand FPO hf4' });
      expect(r.body.data.district).toBe('Junagadh');
      expect([r.body.data.priceMinor, r.body.data.currencyCode, r.body.data.organic, r.body.data.minOrderQty]).toEqual(['615000', 'INR', true, 1]);
    });
    it('a signed-in BUYER (not the owner) reads the same allow-list; the OWNER still reads their own full record', async () => {
      const b = await request(http).get(`/v1/listings/${l1}`).set(authed(buyerToken));
      expect(b.status).toBe(200);
      for (const k of LEAKS) expect(b.body.data).not.toHaveProperty(k);
      const own = await request(http).get(`/v1/listings/${l1}`).set(authed(sellerToken));
      expect(own.status).toBe(200);
      expect(own.body.data.sellerUserId).toBe(seller);
    });
  });

  describe('A7 · the seller read is scoped to member sellers and names the organisation (survey F-8, D3)', () => {
    it('a buyer, a staff member, another organisation\'s seller and an unknown id → 404', async () => {
      for (const id of [buyer, staff, otherSeller, randomUUID()]) {
        const r = await request(http).get(`/v1/sellers/${id}/public`).set('x-tenant-slug', liveSlug);
        expect([id, r.status]).toEqual([id, 404]);
      }
    });
    it('a member seller → organisation fields only: no name, no join date, no region uuid', async () => {
      const r = await request(http).get(`/v1/sellers/${seller}/public`).set('x-tenant-slug', liveSlug);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.data).sort()).toEqual(['listingsActive', 'organisation', 'rating', 'sellerId']);
      expect(r.body.data.organisation).toEqual({ slug: liveSlug, name: 'Anand FPO hf4', district: 'Junagadh' });
      expect(r.body.data.listingsActive).toBe(1);
      expect(JSON.stringify(r.body)).not.toMatch(/Ramesh|displayName|fullName|full_name|memberSince|regionId/);
    });
  });

  describe('A1/A2/C2/A9 · online_payments OFF (the seed): no Pay step, every order of the group named', () => {
    let group = ''; let ids: string[] = [];
    it('a two-seller checkout → two `created` orders with paymentState `none`, one checkout group naming both', async () => {
      await setFlags({ online_payments: false, buyer_charges: false, commission_split: false });
      for (const id of [l1, l2]) expect((await request(http).post('/v1/cart/items').set(authed(buyerToken)).send({ listingId: id, quantity: 2 })).status).toBe(201);
      const c = await request(http).post('/v1/checkout').set({ ...authed(buyerToken), 'idempotency-key': randomUUID() }).send({});
      expect([c.status, c.body.error]).toEqual([201, undefined]);
      expect(c.body.data.orders).toHaveLength(2);
      for (const o of c.body.data.orders) expect([o.status, o.paymentState]).toEqual(['created', 'none']);
      group = c.body.data.checkoutGroupId; ids = c.body.data.orders.map((o: { id: string }) => o.id);
      const g = await request(http).get(`/v1/orders/checkout-groups/${group}`).set(authed(buyerToken));
      expect(g.status).toBe(200);
      expect(g.body.data.orders.map((o: { id: string }) => o.id).sort()).toEqual([...ids].sort());
    });
    it('the order detail says `none` and carries the two buyer-side charges; the rows sum to the total', async () => {
      const o = (await request(http).get(`/v1/orders/${ids[0]}`).set(authed(buyerToken))).body.data;
      expect([o.status, o.paymentState, o.currencyCode, o.checkoutGroupId]).toEqual(['created', 'none', 'INR', group]);
      expect([o.platformFeeMinor, o.buyerCommissionMinor]).toEqual(['0', '0']);
      expect(sumRows(o).toString()).toBe(o.totalMinor);
    });
    it('the payments route answers 404 behind its flag — the storefront must never send the buyer there', async () => {
      const r = await request(http).post('/v1/payments').set({ ...authed(buyerToken), 'idempotency-key': randomUUID() })
        .send({ purpose: 'direct_order', amountMinor: '1230000', currencyCode: 'INR', referenceType: 'order', referenceId: ids[0] });
      expect(r.status).toBe(404);
    });
  });

  describe('A5/A2 · a zone tenant with buyer charges and a buyer-charged commission: quote = charge, rows sum', () => {
    let preview: any; let orderId = ''; let order: any;   // eslint-disable-line @typescript-eslint/no-explicit-any
    beforeAll(async () => {
      await setFlags({ online_payments: true, buyer_charges: true, commission_split: true });
      // fixture rows written the TENANT-SW-a way (`travel`: session_replication_role = replica) — the proposal/checker triggers guard the
      // tenant's own doors, which this spec does not exercise
      const def = (await travel(`INSERT INTO charge_definitions (tenant_id, charge_code, calc_method, config, effective_from, is_active, label)
        VALUES ($1, 'zone_delivery_hf4', 'flat', '{"fee_minor": 7500}', CURRENT_DATE - 1, true, 'Zone hf4') RETURNING id`, [LIVE]))[0].id;
      await travel(`INSERT INTO delivery_zones (tenant_id, default_name, pincodes, charge_definition_id, is_active) VALUES ($1, 'Junagadh zone hf4', '["362001"]', $2, true)`, [LIVE, def]);
      await travel(`INSERT INTO commission_rules (tenant_id, source, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_from, is_active)
        VALUES ($1, 'direct', 200, 0, 1000, 'buyer', 1, CURRENT_DATE - 1, true)`, [LIVE]);
      expect((await request(http).post('/v1/cart/items').set(authed(buyerToken)).send({ listingId: l1, quantity: 3 })).status).toBe(201);
    });
    it('the preview WITHOUT the address says it needs one (delivery 0 + deliveryNeedsAddress) — never the generic slab', async () => {
      const p = (await request(http).post('/v1/checkout/preview').set(authed(buyerToken)).send({})).body.data;
      expect([p.deliveryNeedsAddress, p.deliveryFeeMinor]).toEqual([true, '0']);
    });
    it('WITH the address: the zone fee; platform fee and buyer commission both > 0; the grand total is the sum of its rows', async () => {
      preview = (await request(http).post('/v1/checkout/preview').set(authed(buyerToken)).send({ deliveryAddressId: addressId })).body.data;
      expect([preview.deliveryNeedsAddress, preview.deliveryFeeMinor, preview.currencyCode]).toEqual([false, '7500', 'INR']);
      expect(BigInt(preview.platformFeeMinor)).toBeGreaterThan(0n);
      expect(BigInt(preview.buyerCommissionMinor)).toBeGreaterThan(0n);
      const rows = BigInt(preview.subtotalMinor) + BigInt(preview.deliveryFeeMinor) + BigInt(preview.platformFeeMinor) + BigInt(preview.buyerCommissionMinor) - BigInt(preview.discountMinor);
      expect(rows.toString()).toBe(preview.grandTotalMinor);
      expect(preview.sellers).toHaveLength(1);
    });
    it('placement with the same address charges what the preview quoted; the order rows sum to its total; paymentState `pending`', async () => {
      const c = await request(http).post('/v1/checkout').set({ ...authed(buyerToken), 'idempotency-key': randomUUID() }).send({ deliveryAddressId: addressId });
      expect(c.status).toBe(201);
      expect([c.body.data.orders[0].status, c.body.data.orders[0].paymentState]).toEqual(['payment_pending', 'pending']);
      orderId = c.body.data.orders[0].id;
      order = (await request(http).get(`/v1/orders/${orderId}`).set(authed(buyerToken))).body.data;
      expect([order.paymentState, order.deliveryFeeMinor, order.totalMinor]).toEqual(['pending', preview.deliveryFeeMinor, preview.grandTotalMinor]);
      expect([order.platformFeeMinor, order.buyerCommissionMinor]).toEqual([preview.platformFeeMinor, preview.buyerCommissionMinor]);
      expect(sumRows(order).toString()).toBe(order.totalMinor);
    });
    it('the SELLER cannot confirm an order still awaiting the buyer\'s online payment (ORDER_AWAITING_PAYMENT)', async () => {
      const r = await request(http).post(`/v1/orders/${orderId}/confirm`).set({ ...authed(sellerToken), 'idempotency-key': randomUUID() });
      expect([r.status, r.body.error?.code]).toEqual([409, 'ORDER_AWAITING_PAYMENT']);
    });

    describe('A4/A3 · the Razorpay webhook: context from OUR row, a late capture booked once', () => {
      let paymentId = ''; let gwOrder = '';
      it('the intent is created on the Razorpay adapter (offline order creation)', async () => {
        const r = await request(http).post('/v1/payments').set({ ...authed(buyerToken), 'idempotency-key': `order-pay:${orderId}` })
          .send({ purpose: 'direct_order', amountMinor: order.totalMinor, currencyCode: 'INR', referenceType: 'order', referenceId: orderId });
        expect(r.status).toBe(201);
        expect(r.body.data.provider).toBe('razorpay');
        paymentId = r.body.data.paymentId; gwOrder = r.body.data.gatewayOrderId;
      });
      it('a capture on an UNKNOWN gateway order books nothing; notes naming ANOTHER payment are refused by name', async () => {
        const unknown = await webhook(rzpBody('payment.captured', 'order_not_ours_hf4', 'pay_x', order.totalMinor), `evt_${randomUUID()}`);
        expect([unknown.status, unknown.body.data?.unknown]).toEqual([200, true]);
        const forged = await webhook(rzpBody('payment.captured', gwOrder, 'pay_forged', order.totalMinor, { tenant_id: LIVE, payment_id: randomUUID() }), `evt_${randomUUID()}`);
        expect([forged.status, forged.body.error?.code]).toEqual([409, 'PAYMENT_WEBHOOK_CONTEXT_MISMATCH']);
        const wrongTenant = await webhook(rzpBody('payment.captured', gwOrder, 'pay_forged2', order.totalMinor, { tenant_id: OTHER }), `evt_${randomUUID()}`);
        expect([wrongTenant.status, wrongTenant.body.error?.code]).toEqual([409, 'PAYMENT_WEBHOOK_CONTEXT_MISMATCH']);
        expect(await ledgerTxns(paymentId)).toBe(0);
      });
      it('payment.failed (pay_A, NO notes) → the payment is failed and the attempt id recorded; nothing booked', async () => {
        const r = await webhook(rzpBody('payment.failed', gwOrder, 'pay_A_hf4', order.totalMinor), `evt_${randomUUID()}`);
        expect(r.status).toBe(200);
        const p = (await admin.query(`SELECT status, gateway_payment_id FROM payments WHERE id = $1`, [paymentId])).rows[0];
        expect([p.status, p.gateway_payment_id]).toEqual(['failed', 'pay_A_hf4']);
        expect(await ledgerTxns(paymentId)).toBe(0);
      });
      it('the failed attempt\'s OWN id "captured" is refused by name, nothing booked', async () => {
        const r = await webhook(rzpBody('payment.captured', gwOrder, 'pay_A_hf4', order.totalMinor), `evt_${randomUUID()}`);
        expect([r.status, r.body.error?.code]).toEqual([409, 'PAYMENT_CAPTURE_OF_FAILED_ATTEMPT']);
        expect(await ledgerTxns(paymentId)).toBe(0);
      });
      it('payment.captured (pay_B, NO notes) on the same gateway order → booked ONCE: escrow + total, payment success', async () => {
        const r = await webhook(rzpBody('payment.captured', gwOrder, 'pay_B_hf4', order.totalMinor), `evt_${randomUUID()}`);
        expect([r.status, r.body.data]).toEqual([200, { ok: true }]);
        const p = (await admin.query(`SELECT status, gateway_payment_id, ledger_txn_id FROM payments WHERE id = $1`, [paymentId])).rows[0];
        expect([p.status, p.gateway_payment_id]).toEqual(['success', 'pay_B_hf4']);
        expect(await ledgerTxns(paymentId)).toBe(1);
        const legs = (await admin.query(`SELECT amount_minor::text a FROM ledger_entries WHERE txn_id = $1 ORDER BY amount_minor`, [p.ledger_txn_id])).rows.map((x) => x.a);
        expect(legs).toEqual([`-${order.totalMinor}`, order.totalMinor]);   // zero-sum: gateway −, escrow +
      });
      it('the capture\'s event confirms the order (the orders consumer) → paymentState `paid`', async () => {
        const ev = (await admin.query(`SELECT id::text, tenant_id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events
           WHERE event_type = 'payments.payment_succeeded' AND aggregate_id = $1`, [paymentId])).rows;
        expect(ev).toHaveLength(1);
        const h = app.get(PaymentSucceededHandler);
        await app.get<UnitOfWork>(UNIT_OF_WORK).run(LIVE, (tx) => h.handle({ id: ev[0].id, tenantId: ev[0].tenant_id, aggregateType: ev[0].aggregate_type,
          aggregateId: ev[0].aggregate_id, eventType: ev[0].event_type, payload: ev[0].payload }, tx));
        const o = (await request(http).get(`/v1/orders/${orderId}`).set(authed(buyerToken))).body.data;
        expect([o.status, o.paymentState]).toEqual(['confirmed', 'paid']);
      });
      it('a REPLAYED capture (new delivery id, same pay_B) is a no-op: still one ledger transaction', async () => {
        const r = await webhook(rzpBody('payment.captured', gwOrder, 'pay_B_hf4', order.totalMinor), `evt_${randomUUID()}`);
        expect([r.status, r.body.data]).toEqual([200, { ok: true, duplicate: true }]);
        const late = await webhook(rzpBody('payment.failed', gwOrder, 'pay_C_hf4', order.totalMinor), `evt_${randomUUID()}`);
        expect([late.status, late.body.data]).toEqual([200, { ok: true, superseded: true }]);
        expect(await ledgerTxns(paymentId)).toBe(1);
        expect((await admin.query(`SELECT status FROM payments WHERE id = $1`, [paymentId])).rows[0].status).toBe('success');
      });
    });
  });
});
