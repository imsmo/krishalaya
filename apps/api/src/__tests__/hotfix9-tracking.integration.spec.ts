// apps/api/src/__tests__/hotfix9-tracking.integration.spec.ts · PC-56 HOTFIX-9 — A BUYER SEES THE JOURNEY, NEVER THE DRIVER, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; the outbox consumer
// that creates the shipment (logistics `orders.order_confirmed`) is driven with the outbox row the API wrote, exactly as the relay hands it over.
// Own fixtures (never the shared makeCategory). `logistics` + `logistics_event_explorer` ON for THIS organisation only (an allow-list), restored after.
//
// What it proves (brief §B, survey §7 `hotfix9-tracking`; founder Q3 — milestones and times only):
//   (1) after a rider's location ping (with a note), a seller's note on the order and a failed attempt (its reason is a note), the BUYER's
//       `GET orders/:id/tracking` carries `riderUserId === null`, every `note === null`, every `lat === null && lng === null` (not rounded),
//       `riderAssigned === true`, `deliveryAttempts === 1`, `awbNo` as set, and the milestones with their `at`, in order;
//   (2) the SELLER's read keeps the rider's id, the notes and the coordinates (+ the same two fields);
//   (3) a MODERATOR's read keeps them too;
//   (4) `shipments/:id/trail` with `logistics` + `logistics_event_explorer` ON → the buyer 403, the manager 200, the shipment's rider 200,
//       a different rider 403;
//   (5) a non-party gets 404 on tracking (unchanged, pinned); another organisation's member gets 404 too.
// No hour-of-day literal, no notification template.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OutboxEvent } from '../core/outbox/event-envelope';
import { OrderConfirmedHandler as ShipmentOnConfirmHandler } from '../modules/logistics/events/handlers/order-confirmed.handler';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';
const FLAGS = ['logistics', 'logistics_event_explorer'];
// the words a buyer must never receive — the rider ping's note, the seller's note, the failure reason (all free text by people)
const PING_NOTE = 'near Unjha, gate code 4411';
const SELLER_NOTE = 'Call Ramesh on +91 98250 11111 before loading';
const FAIL_NOTE = 'Buyer not home; neighbour Suresh said call later';
const AWB = 'AWB-HF9-77120';
const LAT = 23.587812; const LNG = 72.369145;

run('PC-56 HOTFIX-9 · a buyer sees the journey, never the driver (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const OTHER = randomUUID();
  let seller = ''; let buyer = ''; let stranger = ''; let moderator = ''; let manager = ''; let rider = ''; let rider2 = ''; let otherMember = '';
  let catId = ''; let product = ''; let listingId = '';
  let orderId = ''; let shipmentId = '';
  const T: Record<string, string> = {};
  const flagBackup: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const H = (token: string, tenantId = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const post = (token: string, path: string, body: unknown = {}) => request(http).post(path).set({ ...H(token), 'idempotency-key': randomUUID() }).send(body as object);
  const ok = (r: request.Response, status = 201) => expect([r.status, r.body.error?.code]).toEqual([status, undefined]);
  const tracking = (token: string, tenantId = LIVE) => request(http).get(`/v1/orders/${orderId}/tracking`).set(H(token, tenantId));
  const trail = (token: string) => request(http).get(`/v1/shipments/${shipmentId}/trail`).set(H(token));
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  async function clearFlagCache(): Promise<void> {
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${LIVE}`, `flagctx:${OTHER}`]) await cache.del(c);
  }
  /** The outbox row the API wrote, as the relay hands it to a handler. */
  async function outboxEvent(eventType: string, aggregateId: string): Promise<OutboxEvent> {
    const r = (await admin.query(`SELECT id::text, tenant_id, aggregate_type, aggregate_id, event_type, payload FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 ORDER BY id DESC LIMIT 1`, [eventType, aggregateId])).rows[0];
    expect(r).toBeDefined();
    return { id: r.id, tenantId: r.tenant_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload };
  }

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO hf9 ${LIVE.slice(0, 4)}`); await makeTenant(admin, OTHER, `Kisan Sathi hf9 ${OTHER.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, OTHER], JUNAGADH]);
    [seller, buyer, stranger, moderator, manager, rider, rider2, otherMember] = await Promise.all(Array.from({ length: 8 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [seller]);
    await admin.query(`UPDATE users SET full_name = 'Suresh Rider Bhai' WHERE id = $1`, [rider]);
    await role(seller, LIVE, 'farmer');
    for (const x of [buyer, stranger]) await role(x, LIVE, 'customer');
    for (const x of [moderator, manager]) await role(x, LIVE, 'tenant_admin');
    for (const x of [rider, rider2]) await role(x, LIVE, 'delivery_partner');
    await role(otherMember, OTHER, 'customer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'chf9' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Spices hf9', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Cumin hf9', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    listingId = (await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, published_at)
       VALUES ($1, $2, $3, $4, 'Cumin hf9', 10, 10, 1, 'quintal', 1800000, 'INR', 'published', 'public', $5, now()) RETURNING id`,
      [LIVE, seller, product, catId, JUNAGADH])).rows[0].id;
    // pay-on-delivery placement (online payments OFF) and both logistics flags ON for THIS organisation only — every row restored in afterAll
    for (const key of ['online_payments', ...FLAGS]) {
      const row = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      expect({ key, present: !!row }).toEqual({ key, present: true });
      flagBackup.push(row);
    }
    await admin.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'online_payments'`);
    for (const key of FLAGS) {
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [key, JSON.stringify({ tenant_ids: [LIVE] })]);
    }
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const c of ['flag:online_payments', 'flagstale:online_payments']) await cache.del(c);
    await clearFlagCache();
    T.buyer = mintToken(app, { userId: buyer, tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    T.stranger = mintToken(app, { userId: stranger, tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    T.seller = mintToken(app, { userId: seller, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create'] });
    T.moderator = mintToken(app, { userId: moderator, tenantId: LIVE, roles: ['tenant_admin'], perms: ['dispute.resolve'] });
    T.manager = mintToken(app, { userId: manager, tenantId: LIVE, roles: ['tenant_admin'], perms: ['logistics.manage'] });
    T.rider = mintToken(app, { userId: rider, tenantId: LIVE, roles: ['delivery_partner'], perms: [] });
    T.rider2 = mintToken(app, { userId: rider2, tenantId: LIVE, roles: ['delivery_partner'], perms: [] });
    T.other = mintToken(app, { userId: otherMember, tenantId: OTHER, roles: ['customer'], perms: ['order.create'] });

    // the journey: a pay-on-delivery order → the seller confirms → the shipment is created by the logistics consumer of the confirm →
    // the manager assigns the rider with the partner's AWB → the rider picks up, goes in transit, POSTS A PING WITH A NOTE, goes out for
    // delivery and records a FAILED attempt (its reason is a note); the seller's note sits on the confirm hop of the order timeline.
    ok(await request(http).post('/v1/cart/items').set(H(T.buyer)).send({ listingId, quantity: '2' }));
    const placed = await request(http).post('/v1/checkout').set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send({});
    ok(placed);
    orderId = placed.body.data.orders[0].id;
    ok(await post(T.seller, `/v1/orders/${orderId}/confirm`));
    await app.get(ShipmentOnConfirmHandler).handle(await outboxEvent('orders.order_confirmed', orderId), undefined as never);   // the relay tx is unused (HOTFIX-2)
    shipmentId = (await admin.query(`SELECT id FROM shipments WHERE order_id = $1`, [orderId])).rows[0].id;
    // A person's words on the order timeline. No API route writes a person's free text into `order_events.note` today (the order repository
    // writes the fixed words 'order placed' / 'system', or NULL) — the column is planted here so the shape, not the writer, is what is proven.
    await admin.query(`UPDATE order_events SET note = $2 WHERE order_id = $1 AND to_status = 'confirmed'`, [orderId, SELLER_NOTE]);
    ok(await post(T.manager, `/v1/shipments/${shipmentId}/assign`, { riderUserId: rider, awbNo: AWB }));
    ok(await post(T.rider, `/v1/shipments/${shipmentId}/picked-up`, {}));
    ok(await post(T.rider, `/v1/shipments/${shipmentId}/in-transit`));
    ok(await post(T.rider, `/v1/shipments/${shipmentId}/location`, { lat: LAT, lng: LNG, note: PING_NOTE }));
    ok(await post(T.rider, `/v1/shipments/${shipmentId}/out-for-delivery`));
    ok(await post(T.rider, `/v1/shipments/${shipmentId}/fail`, { reason: FAIL_NOTE }));
  }, 240_000);

  afterAll(async () => {
    try {
      for (const row of flagBackup) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [row.key, row.is_enabled, row.rollout_pct, JSON.stringify(row.rules ?? {})]);
    } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[LIVE, OTHER]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  const MILESTONES = ['pending', 'assigned', 'picked_up', 'in_transit', 'in_transit', 'out_for_delivery', 'failed'];
  const inOrder = (ats: string[]) => ats.every((a, i) => i === 0 || Date.parse(ats[i - 1]) <= Date.parse(a));

  it('(0) the fixture is real: the rows carry the rider, the coordinates and the notes the buyer must not receive', async () => {
    const s = (await admin.query(`SELECT rider_user_id, awb_no, delivery_attempts FROM shipments WHERE id = $1`, [shipmentId])).rows[0];
    expect(s).toEqual({ rider_user_id: rider, awb_no: AWB, delivery_attempts: 1 });
    const notes = (await admin.query(`SELECT note FROM shipment_events WHERE shipment_id = $1 AND note IS NOT NULL ORDER BY created_at`, [shipmentId])).rows.map((r) => r.note);
    expect(notes).toEqual(expect.arrayContaining([PING_NOTE, FAIL_NOTE]));
    expect(Number((await admin.query(`SELECT count(*)::int n FROM shipment_events WHERE shipment_id = $1 AND lat IS NOT NULL`, [shipmentId])).rows[0].n)).toBe(1);
    expect(Number((await admin.query(`SELECT count(*)::int n FROM order_events WHERE order_id = $1 AND note = $2`, [orderId, SELLER_NOTE])).rows[0].n)).toBe(1);
  });

  it('(1) the BUYER: no rider id, no note, no coordinate (null, not rounded); riderAssigned, deliveryAttempts, the AWB and the milestones with their times, in order', async () => {
    const r = await tracking(T.buyer);
    ok(r, 200);
    const d = r.body.data;
    expect(d.shipment.riderUserId).toBeNull();
    expect(d.shipment).toMatchObject({ id: shipmentId, status: 'failed', riderAssigned: true, deliveryAttempts: 1, awbNo: AWB });
    expect(d.orderEvents.length).toBeGreaterThanOrEqual(2);
    for (const e of d.orderEvents) expect(e.note).toBeNull();
    for (const e of d.shipmentEvents) expect([e.lat, e.lng, e.note]).toEqual([null, null, null]);
    expect(d.orderEvents.map((e: { toStatus: string }) => e.toStatus)).toEqual(['created', 'confirmed']);
    expect(d.shipmentEvents.map((e: { status: string }) => e.status)).toEqual(MILESTONES);
    for (const e of [...d.orderEvents, ...d.shipmentEvents]) expect(Number.isNaN(Date.parse(e.at))).toBe(false);
    expect(inOrder(d.orderEvents.map((e: { at: string }) => e.at))).toBe(true);
    expect(inOrder(d.shipmentEvents.map((e: { at: string }) => e.at))).toBe(true);
    // the field names are kept (the mobile app and the SDK read them as `T | null`) — a buyer simply always receives null
    expect(Object.keys(d.shipment)).toEqual(expect.arrayContaining(['riderUserId', 'awbNo', 'riderAssigned', 'deliveryAttempts']));
    expect(Object.keys(d.shipmentEvents[4]).sort()).toEqual(['at', 'lat', 'lng', 'note', 'status']);
    // nothing of the person, the place or the words, anywhere in the wire answer
    const wire = JSON.stringify(r.body);
    // (the coordinates are proven null field by field above — a digit string is not searched for, since an ISO time's seconds can contain one)
    for (const leak of [rider, PING_NOTE, SELLER_NOTE, FAIL_NOTE, 'Suresh', 'Ramesh']) expect({ leak, found: wire.includes(leak) }).toEqual({ leak, found: false });
  });

  it('(2) the SELLER keeps the rider\'s id, the notes and the coordinates (+ riderAssigned, deliveryAttempts)', async () => {
    const r = await tracking(T.seller);
    ok(r, 200);
    const d = r.body.data;
    expect(d.shipment).toMatchObject({ riderUserId: rider, riderAssigned: true, deliveryAttempts: 1, awbNo: AWB });
    expect(d.orderEvents.find((e: { toStatus: string }) => e.toStatus === 'confirmed').note).toBe(SELLER_NOTE);
    const ping = d.shipmentEvents.find((e: { lat: number | null }) => e.lat != null);
    expect(ping).toMatchObject({ status: 'in_transit', lat: LAT, lng: LNG, note: PING_NOTE });
    expect(d.shipmentEvents.find((e: { status: string }) => e.status === 'failed').note).toBe(FAIL_NOTE);
    expect(d.shipmentEvents.map((e: { status: string }) => e.status)).toEqual(MILESTONES);
  });

  it('(3) a MODERATOR (not a party) keeps them too', async () => {
    const r = await tracking(T.moderator);
    ok(r, 200);
    const d = r.body.data;
    expect(d.shipment).toMatchObject({ riderUserId: rider, riderAssigned: true, deliveryAttempts: 1, awbNo: AWB });
    expect(d.orderEvents.find((e: { toStatus: string }) => e.toStatus === 'confirmed').note).toBe(SELLER_NOTE);
    expect(d.shipmentEvents.find((e: { lat: number | null }) => e.lat != null)).toMatchObject({ lat: LAT, lng: LNG, note: PING_NOTE });
  });

  it('(4) shipments/:id/trail with logistics + logistics_event_explorer ON: the buyer 403, the manager 200, the shipment\'s rider 200, a different rider 403', async () => {
    const b = await trail(T.buyer);
    expect([b.status, b.body.error?.code]).toEqual([403, 'SHIPMENT_FORBIDDEN']);
    expect(JSON.stringify(b.body)).not.toContain(rider);
    const m = await trail(T.manager);
    ok(m, 200);
    expect(m.body.data.shipment).toMatchObject({ id: shipmentId, riderUserId: rider });
    expect(m.body.data.points.find((p: { lat: number | null }) => p.lat != null)).toMatchObject({ lat: LAT, lng: LNG });   // a lead: full precision
    const own = await trail(T.rider);
    ok(own, 200);
    expect(own.body.data.points.find((p: { lat: number | null }) => p.lat != null)).toMatchObject({ lat: 23.588, lng: 72.369 });   // a member: 3 dp
    const r2 = await trail(T.rider2);
    expect([r2.status, r2.body.error?.code]).toEqual([403, 'SHIPMENT_FORBIDDEN']);
    const s = await trail(T.seller);                                    // the seller holds no logistics.manage and is not the rider
    expect([s.status, s.body.error?.code]).toEqual([403, 'SHIPMENT_FORBIDDEN']);
  });

  it('(5) a non-party gets 404 on tracking (unchanged, pinned); another organisation\'s member gets 404 too', async () => {
    const s = await tracking(T.stranger);
    expect([s.status, s.body.error?.code]).toEqual([404, 'ORDER_NOT_FOUND']);
    const o = await tracking(T.other, OTHER);
    expect(o.status).toBe(404);
    expect(JSON.stringify(o.body)).not.toContain(rider);
  });
});
