// apps/api/src/__tests__/store4c-notifications-prefs.integration.spec.ts · PC-56 STORE-4c — NOTICES YOU CAN READ, SWITCHES THAT HOLD, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; the fan-out runs
// through the REAL OutboxDispatcher as kv_relay (exactly production's shape) with the app's OWN registered handlers for the one event type
// under test (the DomainEventFanoutHandler instances the map registered, or the BroadcastRequestedHandler) — never a hand-called service.
// Own fixtures (never the shared makeCategory). Flags touched: `communication` (case 1, restored OFF), `online_payments` (case 2, restored OFF).
//
// What it proves (brief §C6):
//   (1) with `communication` OFF (the seed) a buyer's inbox, bell, matrix, preferences and quiet hours answer 200; chat (`conversations`), calls
//       (`masked-calls`) and push devices are STILL refused by the flag (404); `storefront/flags` carries `communication = false`, then `true`
//       when the store's flag is ON (tenant-scoped; not answered with no organisation);
//   (2) a SANDBOX CAPTURE of a real checkout's order → the capture's own outbox event, relayed → an IN-APP `payment.success` row for the BUYER
//       (the payer — the key the payload carries), tier `critical`, its words rendered from the template version the row recorded; the inbox
//       lists it with its other channels; `PUT preferences` switching it off → 409 NOTIFICATION_CANNOT_OPT_OUT; the review refuses it too;
//       a capture for something that is not an order (a membership fee) notifies nobody through this row;
//   (3) `order.created` (the real checkout's event — the map row added by this wave), `order.delivered` and `bid.outbid` (outbox fixtures in the
//       shapes their emitters write) → in-app rows with words;
//   (4) `matrix?audience=buyer` lists only buyer events (no dairy, labour or SaaS notice), `payment.success` LOCKED with every channel on,
//       `tenant.broadcast` OFF by default with `consent: { purpose: 'marketing', granted: false }`; an unknown audience → 422; no audience →
//       the full catalogue (web-tenant's W433);
//   (5) a broadcast to a buyer WITHOUT the marketing consent → `suppressed · no_consent` on EVERY channel and no in-app item; after the grant
//       (`/v1/consents`, keyed) and the opt-in (`PUT preferences`, keyed) → the next broadcast is DELIVERED in-app; the matrix then says both;
//   (6) quiet hours with a BLANK zone resolve to the ORGANISATION's zone (a GB cooperative → Europe/London — never the Asia/Kolkata literal);
//       the preview answers the window and says the zone came from the organisation; the write is audited with the caller's address
//       (`clientIpOf`, F-22);
//   (7) `PATCH users/me {languageCode:'gu'}` → the NEXT notice's in-app row is `gu`, its words Gujarati (the recipient's own language wins);
//   (8) mark-read replayed with the same key → ONE read and ONE audit row; read-all keyed → replayed, one audit row;
//   (9) the relay gate is run as its own spec (group B) — no handler class added (the `order.created` map row registers one more
//       DomainEventFanoutHandler instance, covered by the gate's class-wide case).
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { OUTBOX_HANDLER_REGISTRY, OutboxEvent } from '../core/outbox/event-envelope';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { GatewayRegistry } from '../modules/payments/gateway/gateway.registry';
import { SandboxGateway } from '../modules/payments/gateway/sandbox.gateway';
import { PaymentSucceededHandler } from '../modules/orders/events/handlers/payment-succeeded.handler';
import { DomainEventFanoutHandler } from '../modules/communication/events/handlers/domain-event-fanout.handler';
import { BroadcastRequestedHandler } from '../modules/communication/events/handlers/broadcast-requested.handler';
import { BUYER_AUDIENCE_EVENTS } from '../modules/communication/domain/buyer-audience';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';

run('PC-56 STORE-4c · notices and preferences (integration, real AppModule over HTTP, the fan-out as kv_relay)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relayPool: Pool; let cache: CacheService; let sandbox: SandboxGateway;   // eslint-disable-line @typescript-eslint/no-explicit-any
  let registry: OutboxHandlerRegistry;
  const LIVE = randomUUID(); const BC = randomUUID(); const UK = randomUUID();
  let liveSlug = '';
  const U: Record<string, string> = {};
  const T: Record<string, string> = {};
  const touched = ['communication', 'online_payments'];
  let listingId = '';

  const H = (token: string, tenantId = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const role = async (userId: string, tenantId: string, code: string) =>
    admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key, on]);
    for (const c of [`flag:${key}`, `flagstale:${key}`, 'flags:all', `flagctx:${LIVE}`, `flagctx:${BC}`, `flagctx:${UK}`]) await cache.del(c);
  };
  /** Relay ONE pending outbox row as kv_relay through the real dispatcher, with the app's own handlers of the given class for its type. */
  const relay = async (eventId: string, only: 'fanout' | 'broadcast' = 'fanout') => {
    const row = (await admin.query(`SELECT event_type FROM outbox_events WHERE id = $1`, [eventId])).rows[0];
    const one = new OutboxHandlerRegistry();
    for (const h of registry.handlersFor(row.event_type)) if (only === 'fanout' ? h instanceof DomainEventFanoutHandler : h instanceof BroadcastRequestedHandler) one.register(h);
    expect(one.handlersFor(row.event_type).length).toBeGreaterThan(0);
    const out = await new OutboxDispatcher(relayPool, one, { inc: () => undefined, observe: () => undefined } as never).relayById(String(eventId));
    expect(out.status).toBe('published');
  };
  const emit = async (tenantId: string, eventType: string, aggregateType: string, payload: Record<string, unknown>) =>
    String((await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id`,
      [tenantId, aggregateType, randomUUID(), eventType, JSON.stringify({ v: 1, ...payload })])).rows[0].id);
  const outboxOf = async (eventType: string, aggregateId: string) =>
    String((await admin.query(`SELECT id FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id DESC LIMIT 1`, [eventType, aggregateId])).rows[0].id);
  const rowsOf = async (userId: string, code: string) => (await admin.query(
    `SELECT channel, status::text AS status, suppressed_reason, language_code FROM notifications WHERE user_id = $1 AND event_code = $2 ORDER BY channel, created_at`, [userId, code])).rows;
  const inbox = async (token: string, tenantId = LIVE) => (await request(http).get('/v1/notifications').query({ unreadOnly: 'false' }).set(H(token, tenantId))).body.data as Array<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);   // db/local/local-login-roles.sql's statement
    const as = (r: string) => { const u = new URL(APP_URL as string); u.username = r; u.password = 'dev'; return u.toString(); };
    relayPool = new Pool({ connectionString: as('kv_relay'), max: 2, application_name: 'store4c-relay' });
    await makeTenant(admin, LIVE, `Anand FPO s4c ${LIVE.slice(0, 4)}`); await makeTenant(admin, BC, `Broadcast Coop s4c ${BC.slice(0, 4)}`); await makeTenant(admin, UK, `Kent Growers s4c ${UK.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, BC, UK], JUNAGADH]);
    await admin.query(`UPDATE tenants SET country_code = 'GB' WHERE id = $1`, [UK]);
    liveSlug = (await admin.query(`SELECT slug FROM tenants WHERE id = $1`, [LIVE])).rows[0].slug;
    for (const k of ['buyer', 'seller', 'bcBuyer', 'bcAdmin', 'ukBuyer', 'reader', 'payer']) U[k] = await makeUser(admin);
    await admin.query(`UPDATE users SET language_code = 'en' WHERE id = ANY($1::uuid[])`, [Object.values(U)]);
    for (const k of ['buyer', 'reader', 'payer']) await role(U[k], LIVE, 'customer');
    await role(U.seller, LIVE, 'farmer'); await role(U.bcBuyer, BC, 'customer'); await role(U.bcAdmin, BC, 'tenant_admin'); await role(U.ukBuyer, UK, 'customer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'cs4c' + randomUUID().replace(/-/g, '').slice(0, 12);
    const catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds s4c', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    const product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut s4c', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    listingId = (await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, published_at)
       VALUES ($1, $2, $3, $4, 'Bold groundnut s4c', 40, 40, 1, 'quintal', 615000, 'INR', 'published', 'public', $5, now()) RETURNING id`,
      [LIVE, U.seller, product, catId, JUNAGADH])).rows[0].id;
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    void (http.address() as AddressInfo).port;
    registry = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY);
    sandbox = app.get(GatewayRegistry).get('sandbox') as SandboxGateway;
    for (const k of ['buyer', 'reader', 'payer']) T[k] = mintToken(app, { userId: U[k], tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    T.bcBuyer = mintToken(app, { userId: U.bcBuyer, tenantId: BC, roles: ['customer'], perms: [] });
    T.ukBuyer = mintToken(app, { userId: U.ukBuyer, tenantId: UK, roles: ['customer'], perms: [] });
    await setFlag('communication', false); await setFlag('online_payments', false);
  }, 240_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = ANY($1::text[])`, [touched]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[LIVE, BC, UK]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await relayPool?.end().catch(() => undefined); await admin?.end();
  }, 40_000);

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  it('(1) with `communication` OFF a person\'s inbox, bell, matrix, preferences and quiet hours answer; chat, calls and devices stay behind the flag; the storefront allow-list carries it', async () => {
    for (const path of ['/v1/notifications', '/v1/notifications/bell', '/v1/notifications/filters', '/v1/notifications/matrix', '/v1/notifications/preferences', '/v1/notifications/quiet-hours', '/v1/notifications/read-all']) {
      const r = await request(http).get(path).set(H(T.buyer));
      expect([path, r.status]).toEqual([path, 200]);
    }
    expect((await request(http).post('/v1/notifications/quiet-hours/preview').set(H(T.buyer)).send({ starts: '22:00', ends: '06:00' })).status).toBe(201);
    expect(refusal(await request(http).get('/v1/conversations').set(H(T.buyer)))[0]).toBe(404);
    expect(refusal(await request(http).post('/v1/masked-calls').set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send({ conversationId: randomUUID() }))[0]).toBe(404);
    expect(refusal(await request(http).post('/v1/notifications/devices').set(H(T.buyer)).send({ platform: 'android', token: 'ExponentPushToken[s4c]' }))[0]).toBe(404);
    const off = await request(http).get('/v1/storefront/flags').set('x-tenant-slug', liveSlug);
    expect([off.status, off.body.data.communication]).toEqual([200, false]);
    expect((await request(http).get('/v1/storefront/flags')).body.data).not.toHaveProperty('communication');   // tenant-scoped
    await setFlag('communication', true);
    try {
      expect((await request(http).get('/v1/storefront/flags').set('x-tenant-slug', liveSlug)).body.data.communication).toBe(true);
      expect((await request(http).get('/v1/conversations').set(H(T.buyer))).status).toBe(200);
    } finally { await setFlag('communication', false); }
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  describe('(2)(3) the money notices reach the in-app inbox', () => {
    let orderId = ''; let paymentId = '';
    it('(2) a real checkout + a sandbox capture → the capture\'s own event, relayed as kv_relay → an IN-APP `payment.success` for the buyer, critical, with words', async () => {
      await setFlag('online_payments', true);
      try {
        expect((await request(http).post('/v1/cart/items').set(H(T.payer)).send({ listingId, quantity: '2' })).status).toBe(201);
        const c = await request(http).post('/v1/checkout').set({ ...H(T.payer), 'idempotency-key': randomUUID() }).send({});
        expect(c.status).toBe(201);
        orderId = c.body.data.orders[0].id;
        const o = (await request(http).get(`/v1/orders/${orderId}`).set(H(T.payer))).body.data;
        const i = await request(http).post('/v1/payments').set({ ...H(T.payer), 'idempotency-key': `order-pay:${orderId}:1` })
          .send({ purpose: 'direct_order', amountMinor: o.totalMinor, currencyCode: o.currencyCode, referenceType: 'order', referenceId: orderId });
        expect(i.status).toBe(201);
        paymentId = i.body.data.paymentId;
        const raw = JSON.stringify({ id: `evt_${randomUUID()}`, event: 'payment.captured', order_id: i.body.data.gatewayOrderId, payment_id: `pay_${paymentId.slice(-12)}`, amount: Number(o.totalMinor), currency: 'INR', method: 'upi' });
        expect((await request(http).post('/v1/payments/webhooks/sandbox').set({ 'content-type': 'application/json', 'x-webhook-signature': sandbox.sign(raw) }).send(raw)).status).toBe(200);
      } finally { await setFlag('online_payments', false); }
      const evId = await outboxOf('payments.payment_succeeded', paymentId);
      const ev = (await admin.query(`SELECT payload FROM outbox_events WHERE id = $1`, [evId])).rows[0].payload;
      expect(ev).toMatchObject({ payerUserId: U.payer, referenceType: 'order', referenceId: orderId });   // the key the payload carries
      expect(ev).not.toHaveProperty('buyerUserId');
      await relay(evId);
      const rows = await rowsOf(U.payer, 'payment.success');
      expect(rows.find((r) => r.channel === 'inapp')).toMatchObject({ status: 'sent', suppressed_reason: null });
      expect(rows.map((r) => r.channel).sort()).toEqual(['inapp', 'push', 'sms']);   // critical: never held for quiet hours
      expect(rows.filter((r) => r.status === 'suppressed')).toEqual([]);
      const item = (await inbox(T.payer)).find((n) => n.eventCode === 'payment.success');
      expect(item).toMatchObject({ channel: 'inapp', tier: 'critical', module: 'payment', rendered: { title: 'Payment received', body: 'We received your payment.' } });
      expect(item.alsoOn.map((a: { channel: string }) => a.channel).sort()).toEqual(['push', 'sms']);
      // the order paid (the orders handler's half, so the order reads paid like production) — not this wave's subject
      await app.get<UnitOfWork>(UNIT_OF_WORK).run(LIVE, (tx) => app.get(PaymentSucceededHandler).handle({ id: evId, tenantId: LIVE, aggregateType: 'payment', aggregateId: paymentId, eventType: 'payments.payment_succeeded', payload: ev } as OutboxEvent, tx));
    });
    it('(2) the payment notice cannot be switched off: PUT → 409 NOTIFICATION_CANNOT_OPT_OUT, the review refuses it; a membership capture notifies nobody through this row', async () => {
      const off = await request(http).put('/v1/notifications/preferences').set({ ...H(T.payer), 'idempotency-key': `prefs:${randomUUID()}:p` }).send({ preferences: [{ eventCode: 'payment.success', channel: 'inapp', isEnabled: false }] });
      expect(refusal(off)).toEqual([409, 'NOTIFICATION_CANNOT_OPT_OUT']);
      expect(off.body.error.details).toMatchObject({ eventCode: 'payment.success' });
      const rv = await request(http).post('/v1/notifications/preferences/preview').set(H(T.payer)).send({ preferences: [{ eventCode: 'payment.success', channel: 'push', isEnabled: false }] });
      expect(rv.body.data.refusals).toEqual([{ field: 'payment.success::push', code: 'CANNOT_OPT_OUT' }]);
      const before = await count(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND event_code = 'payment.success'`, [U.reader]);
      await relay(await emit(LIVE, 'payments.payment_succeeded', 'payment', { paymentId: randomUUID(), amountMinor: '5000', referenceType: 'membership_fee', referenceId: randomUUID(), payerUserId: U.reader, currencyCode: 'INR' }));
      expect(await count(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND event_code = 'payment.success'`, [U.reader])).toBe(before);
    });
    it('(3) `order.created` (the checkout\'s own event — the map row this wave added), `order.delivered` and `bid.outbid` → in-app rows with words', async () => {
      await relay(await outboxOf('orders.order_created', orderId));
      await relay(await emit(LIVE, 'orders.order_delivered', 'order', { orderId, buyerUserId: U.payer, sellerUserId: U.seller }));
      await relay(await emit(LIVE, 'auctions.bidder_outbid', 'auction', { auctionId: randomUUID(), previousBidderUserId: U.payer, lot_name: 'Cotton lot s4c' }));
      for (const code of ['order.created', 'order.delivered', 'bid.outbid']) expect([code, (await rowsOf(U.payer, code)).find((r) => r.channel === 'inapp')?.status]).toEqual([code, 'sent']);
      const items = await inbox(T.payer);
      expect(items.find((n) => n.eventCode === 'order.created')).toMatchObject({ tier: 'important', rendered: { title: 'Order placed', body: 'Your order was placed. Open My orders to follow it.' } });
      expect(items.find((n) => n.eventCode === 'order.delivered').rendered.title).toBe('Delivered');
      expect(items.find((n) => n.eventCode === 'bid.outbid').rendered.body).toContain('Cotton lot s4c');
      expect(items.find((n) => n.eventCode === 'bid.outbid').alsoOn.map((a: { channel: string }) => a.channel)).toEqual(['push']);   // push + in-app only — never SMS
    });
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  it('(4) matrix?audience=buyer: only buyer events; payment.success LOCKED, every channel on; tenant.broadcast OFF with its consent half; a bad audience → 422', async () => {
    const r = await request(http).get('/v1/notifications/matrix').query({ audience: 'buyer' }).set(H(T.buyer));
    expect(r.status).toBe(200);
    const events = r.body.data.tiers.flatMap((t: { events: unknown[] }) => t.events) as Array<{ code: string; locked: boolean; priority: string; cells: Array<{ channel: string; sentOn: boolean; enabled: boolean | null }>; consent?: unknown }>;
    for (const e of events) expect([e.code, BUYER_AUDIENCE_EVENTS.has(e.code)]).toEqual([e.code, true]);
    expect(events.map((e) => e.code)).not.toContain('dairy.bill_previewed');
    const pay = events.find((e) => e.code === 'payment.success')!;
    expect([pay.locked, pay.priority]).toEqual([true, 'critical']);
    expect(pay.cells.filter((c) => c.sentOn).map((c) => [c.channel, c.enabled])).toEqual([['push', true], ['sms', true], ['inapp', true]]);
    const promo = events.find((e) => e.code === 'tenant.broadcast')!;
    expect(promo.cells.filter((c) => c.sentOn).map((c) => c.enabled)).toEqual([false, false]);
    expect(promo.consent).toEqual({ purpose: 'marketing', granted: false });
    expect(r.body.data.counts.events).toBe(events.length);
    expect(refusal(await request(http).get('/v1/notifications/matrix').query({ audience: 'everyone' }).set(H(T.buyer)))).toEqual([422, 'VALIDATION_FAILED']);
    const all = await request(http).get('/v1/notifications/matrix').set(H(T.buyer));
    expect(all.body.data.counts.events).toBeGreaterThan(events.length);
    expect(all.body.data.tiers.flatMap((t: { events: Array<{ code: string }> }) => t.events).map((e: { code: string }) => e.code)).toContain('dairy.bill_previewed');
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  it('(5) a broadcast to a buyer WITHOUT the marketing consent → `no_consent` on every channel, nothing in the inbox; after the grant + the opt-in → delivered', async () => {
    const broadcast = async (title: string) => {
      const id = randomUUID();
      await admin.query(`INSERT INTO tenant_broadcasts (id, tenant_id, created_by_user_id, audience_role_code, title, body, status, channel) VALUES ($1,$2,$3,'customer',$4,'The yard is shut.','draft','inapp')`, [id, BC, U.bcAdmin, title]);
      await admin.query(`UPDATE tenant_broadcasts SET status='queued', send_requested_by=$2, send_requested_at=now(), queued_at=now() WHERE id=$1`, [id, U.bcAdmin]);
      const evId = String((await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'tenant_broadcast',$2,'communication.broadcast_requested',$3::jsonb) RETURNING id`,
        [BC, id, JSON.stringify({ v: 1, broadcastId: id })])).rows[0].id);
      await relay(evId, 'broadcast');
      expect((await admin.query(`SELECT status FROM tenant_broadcasts WHERE id = $1`, [id])).rows[0].status).toBe('sent');
      return id;
    };
    await broadcast('Mandi closed (no consent)');
    expect((await rowsOf(U.bcBuyer, 'tenant.broadcast')).map((r) => [r.channel, r.status, r.suppressed_reason])).toEqual([['inapp', 'suppressed', 'no_consent'], ['push', 'suppressed', 'no_consent']]);
    expect((await inbox(T.bcBuyer, BC)).filter((n) => n.eventCode === 'tenant.broadcast')).toEqual([]);
    // the grant (keyed — a replay appends nothing) and the opt-in (keyed)
    const key = `prefs:${randomUUID()}`;
    for (let i = 0; i < 2; i++) expect((await request(http).post('/v1/consents').set({ ...H(T.bcBuyer, BC), 'idempotency-key': `${key}:c` }).send({ purposeCode: 'marketing', granted: true, channel: 'web' })).status).toBe(201);
    expect(await count(`SELECT count(*)::int n FROM consents WHERE user_id = $1 AND purpose_code = 'marketing'`, [U.bcBuyer])).toBe(1);
    const optIn = await request(http).put('/v1/notifications/preferences').set({ ...H(T.bcBuyer, BC), 'idempotency-key': `${key}:p` })
      .send({ preferences: [{ eventCode: 'tenant.broadcast', channel: 'push', isEnabled: true }, { eventCode: 'tenant.broadcast', channel: 'inapp', isEnabled: true }] });
    expect(optIn.status).toBe(200);
    const m = await request(http).get('/v1/notifications/matrix').query({ audience: 'buyer' }).set(H(T.bcBuyer, BC));
    const promo = m.body.data.tiers.flatMap((t: { events: unknown[] }) => t.events).find((e: { code: string }) => e.code === 'tenant.broadcast');
    expect(promo.consent).toEqual({ purpose: 'marketing', granted: true });
    expect(promo.cells.filter((c: { sentOn: boolean }) => c.sentOn).map((c: { enabled: boolean }) => c.enabled)).toEqual([true, true]);
    await broadcast('Mandi open again (consented)');
    const items = (await inbox(T.bcBuyer, BC)).filter((n) => n.eventCode === 'tenant.broadcast');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tier: 'promotional', status: 'sent' });
    expect(items[0].rendered.title).toContain('Mandi open again (consented)');   // the platform wording frames the organisation's title
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  it('(6) quiet hours with a BLANK zone → the ORGANISATION\'s zone (a GB cooperative: Europe/London); the preview says so; the write audited with the caller\'s address', async () => {
    const pv = await request(http).post('/v1/notifications/quiet-hours/preview').set(H(T.ukBuyer, UK)).send({ starts: '22:00', ends: '06:30' });
    expect(pv.status).toBe(201);
    expect(pv.body.data.maths).toMatchObject({ zone: 'Europe/London', zoneFromTenant: true, crossesMidnight: true, lengthMinutes: 510 });
    const w = await request(http).put('/v1/notifications/quiet-hours').set({ ...H(T.ukBuyer, UK), 'idempotency-key': `prefs:${randomUUID()}:q` }).send({ starts: '22:00', ends: '06:30' });
    expect(w.status).toBe(200);
    expect(w.body.data.timezone).toBe('Europe/London');
    expect((await admin.query(`SELECT timezone FROM user_quiet_hours WHERE user_id = $1`, [U.ukBuyer])).rows[0].timezone).toBe('Europe/London');
    const m = await request(http).get('/v1/notifications/matrix').query({ audience: 'buyer' }).set(H(T.ukBuyer, UK));
    expect(m.body.data.quietHours).toMatchObject({ tenantZone: 'Europe/London', effective: { timezone: 'Europe/London', source: 'own' } });
    expect(JSON.stringify(m.body.data)).not.toContain('Asia/Kolkata');
    const audit = (await admin.query(`SELECT ip::text AS ip FROM audit_log WHERE action = 'communication.quiet_hours.set' AND actor_user_id = $1`, [U.ukBuyer])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].ip).toMatch(/127\.0\.0\.1|::1/);   // clientIpOf — the listener is pinned on 127.0.0.1
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  it('(7) PATCH users/me {languageCode:"gu"} → the NEXT notice\'s in-app row is gu, its words Gujarati (the recipient\'s own language wins)', async () => {
    expect((await request(http).patch('/v1/users/me').set(H(T.reader)).send({ languageCode: 'gu' })).status).toBe(200);
    await relay(await emit(LIVE, 'orders.order_delivered', 'order', { orderId: randomUUID(), buyerUserId: U.reader, sellerUserId: U.seller }));
    const row = (await rowsOf(U.reader, 'order.delivered')).find((r) => r.channel === 'inapp');
    expect(row).toMatchObject({ status: 'sent', language_code: 'gu' });
    const item = (await inbox(T.reader)).find((n) => n.eventCode === 'order.delivered');
    expect(item.languageCode).toBe('gu');
    expect(item.rendered).toEqual({ title: 'ડિલિવર થયો', body: 'તમારો ઓર્ડર ડિલિવર થયેલો નોંધાયો છે. જોવા માટે મારા ઓર્ડર ખોલો.' });
  });

  /* ----------------------------------------------------------------------------------------------------------------------------- */
  it('(8) mark-read replayed with the SAME key → one read, one audit row; read-all keyed → replayed, one audit row', async () => {
    const items = (await inbox(T.payer)).filter((n) => n.status !== 'read');
    expect(items.length).toBeGreaterThanOrEqual(2);
    const first = items[0];
    const key = `read:${randomUUID()}`;
    const a = await request(http).post(`/v1/notifications/${first.id}/read`).set({ ...H(T.payer), 'idempotency-key': key }).send({ at: first.at });
    const b = await request(http).post(`/v1/notifications/${first.id}/read`).set({ ...H(T.payer), 'idempotency-key': key }).send({ at: first.at });
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.data.status).toBe('read');
    expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'communication.notification.read' AND entity_id = $1`, [first.id])).toBe(1);
    const allKey = `readall:${randomUUID()}`;
    const x = await request(http).post('/v1/notifications/read-all').set({ ...H(T.payer), 'idempotency-key': allKey }).send({});
    const y = await request(http).post('/v1/notifications/read-all').set({ ...H(T.payer), 'idempotency-key': allKey }).send({});
    expect([x.status, y.status]).toEqual([201, 201]);
    expect(y.body.data).toEqual(x.body.data);
    expect(x.body.data.marked).toBeGreaterThanOrEqual(1);
    expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'communication.notifications.read_all' AND actor_user_id = $1`, [U.payer])).toBe(1);
    expect((await inbox(T.payer)).filter((n) => n.status !== 'read')).toEqual([]);
  });
});
