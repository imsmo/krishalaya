// apps/api/src/__tests__/store4-hotfix6-identity-calls.integration.spec.ts · PC-56 HOTFIX-6 — THE CALLS, THE NAMES, THE ADDRESSES AND THE
// CONSENTS, LIVE. The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app, the
// REAL SDK (built dist) for the consent route. Own fixtures (never the shared makeCategory). `communication` is switched ON for the run (the
// conversation, call and inbox routes sit behind it — Law 10: seed OFF, restored OFF in afterAll).
//
// What it proves (brief §C5, survey STORE-4 §7 `store4-hotfix6-identity-calls`):
//   (1) `POST /v1/masked-calls` with a `calleeUserId` → refused by the schema (422 VALIDATION_FAILED — the house's validation answer; the brief's
//       "400"); a conversation the caller is not in → 403 MASKED_CALL_NOT_PARTICIPANT (an unknown one answers the same); a call from the
//       buyer's own thread rings the OTHER participant (server-resolved), is audited `masked_call.initiated` with the conversation and no phone
//       number, and answers no person id; a thread of three → 422 MASKED_CALL_NO_CALLEE; a party with no role here → 403 MASKED_CALL_NOT_MEMBER;
//       the sixth call in a minute → 429 (5 / 60 s per user);
//   (2) a `user_blocks` row in EITHER direction → 403 MASKED_CALL_BLOCKED (nothing bridged, nothing recorded);
//   (3) `GET conversations` / `GET conversations/:id` / messages as the BUYER: the organisation's name, no `full_name`, no person uuid; every
//       message `from`; the order number as the context label; the SELLER (staff) keeps the name and the ids; `?archived=maybe` → 422;
//   (4) editing an address referenced by a placed order AND a shipment's drop: both still point at the OLD id, whose values are unchanged; a NEW
//       row is returned (`copied: true`), listed in its place, the default carried; an unreferenced address is edited in place; a make-default on
//       a referenced address stays in place (no copy); create replayed with the same key → one row; another user's remove → 404; removing the
//       default promotes the newest remaining;
//   (5) the trade invoice's delivery state for that order (TradeInvoiceRepository.resolveParties — the place of supply) is UNCHANGED after an
//       edit that moves the address to another state (24 Gujarat stays 24; the copy would have read 27 Maharashtra);
//   (6) SDK `privacy.listConsents()` / `setConsent()` reach `/v1/consents`; a withdrawal appends a `granted=false` row; a replay with the same
//       key appends nothing;
//   (7) `GET notifications?unreadOnly=false` → read AND unread rows; `=true` → unread only; `=maybe` → 422;
//   (8) an address with a 5-digit postal code and country `GB` is stored as such; an edit changes the country.
//   (9) the relay gate is run as its own spec (group B) — no handler added.
// PC-56 STORE-4b (founder D1): the generic `POST /v1/conversations` is now the ORGANISATION's tool — a buyer gets 403 and every participant must
// hold a role here. So the buyer's order thread is opened through `POST /v1/conversations/organisation` (participants = the buyer + the
// organisation's order.manage members = the farmer), and the direct threads below are opened BY THE FARMER (staff) naming the buyers; the
// not-a-member case gives the outsider a role, opens, then ends the role (a member who left) — the call refusals under test are unchanged.
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
import { uuidv7 } from '../core/database/uuid.util';
import { Order } from '../modules/orders/domain/order.entity';
import { OrderItem } from '../modules/orders/domain/order-item.entity';
import { orderNoFor } from '../modules/orders/domain/order-no';
import { OrderRepository } from '../modules/orders/repositories/order.repository';
import { TradeInvoiceRepository } from '../modules/payments/repositories/trade-invoice.repository';
import { createClient } from '../../../../packages/sdk-js/dist';   // the BUILT SDK: exactly what the storefront / mobile / web-partner import

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const JUNAGADH = '11111111-0000-7000-8000-000000000101';   // in.gj.junagadh → GST state 24
const PUNE = '11111111-0000-7000-8000-000000000201';       // in.mh.pune     → GST state 27
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

run('PC-56 HOTFIX-6 · the calls, the names, the addresses and the consents (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let uow: UnitOfWork; let port = 0;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const OTHER = randomUUID();
  let farmer = ''; let buyer = ''; let stranger = ''; let blockedBuyer = ''; let outsider = ''; let third = ''; let caller6 = '';
  let liveName = ''; let orderId = ''; let orderNo = ''; let listingId = ''; let product = ''; let catId = '';
  const T: Record<string, string> = {};
  const CV: Record<string, string> = {};

  const setFlag = async (k: string, on: boolean) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k, on]);
    for (const c of [`flag:${k}`, `flagstale:${k}`, 'flags:all', `flagctx:${LIVE}`, `flagctx:${OTHER}`]) await cache.del(c);
  };
  async function role(userId: string, tenantId: string, code: string): Promise<void> {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, tenantId, code]);
  }
  const H = (token: string, tenantId = LIVE) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': tenantId });
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const resetRateLimit = async (userId: string) => {
    const w = Math.floor(Date.now() / 1000 / 60);
    for (const x of [w - 1, w, w + 1]) await cache.del(`rl:MaskedCallsController.initiate:user:${userId}:${x}`);
  };
  const call = (token: string, body: Record<string, unknown>, key: string = randomUUID()) =>
    request(http).post('/v1/masked-calls').set({ ...H(token), 'idempotency-key': key }).send(body);
  const open = async (token: string, contextType: string, contextId: string | null, participants: string[]): Promise<string> => {
    const r = await request(http).post('/v1/conversations').set({ ...H(token), 'idempotency-key': randomUUID() }).send({ contextType, contextId, participantUserIds: participants });
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    return r.body.data.id as string;
  };
  const post = async (token: string, convo: string, body: string) => {
    const r = await request(http).post(`/v1/conversations/${convo}/messages`).set({ ...H(token), 'idempotency-key': randomUUID() }).send({ body });
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
  };
  const addrRow = async (id: string) => (await admin.query(
    `SELECT id, user_id, line1, village, pincode, region_id, country_code, contact_phone, is_default, deleted_at FROM addresses WHERE id = $1`, [id])).rows[0];
  const createAddress = async (token: string, body: Record<string, unknown>, key?: string): Promise<string> => {
    const r = await request(http).post('/v1/addresses').set({ ...H(token), ...(key ? { 'idempotency-key': key } : {}) }).send(body);
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    return r.body.data.id as string;
  };
  const patchAddress = (token: string, id: string, body: Record<string, unknown>, key?: string) =>
    request(http).patch(`/v1/addresses/${id}`).set({ ...H(token), ...(key ? { 'idempotency-key': key } : {}) }).send(body);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO hf6 ${LIVE.slice(0, 4)}`); await makeTenant(admin, OTHER, `Kisan Sathi hf6 ${OTHER.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now(), region_id = $2 WHERE id = ANY($1::uuid[])`, [[LIVE, OTHER], JUNAGADH]);
    liveName = (await admin.query(`SELECT display_name FROM tenants WHERE id = $1`, [LIVE])).rows[0].display_name;
    [farmer, buyer, stranger, blockedBuyer, outsider, third, caller6] = await Promise.all(Array.from({ length: 7 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [farmer]);
    await admin.query(`UPDATE users SET full_name = 'Nilesh Shah' WHERE id = $1`, [buyer]);
    await role(farmer, LIVE, 'farmer');
    for (const x of [buyer, stranger, blockedBuyer, third, caller6]) await role(x, LIVE, 'customer');
    await role(outsider, OTHER, 'customer');   // a member of ANOTHER organisation only
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'chf6' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds hf6', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut hf6', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    listingId = (await admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, region_id, published_at)
       VALUES ($1, $2, $3, $4, 'GG-20 Groundnut hf6', 40, 40, 1, 'quintal', 615000, 'INR', 'published', 'public', $5, now()) RETURNING id`,
      [LIVE, farmer, product, catId, JUNAGADH])).rows[0].id;
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE); uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin (foreign processes on IPv4 ephemeral ports)
    port = (http.address() as AddressInfo).port;
    for (const [k, x] of [['buyer', buyer], ['stranger', stranger], ['blockedBuyer', blockedBuyer], ['third', third], ['caller6', caller6]] as const) T[k] = mintToken(app, { userId: x, tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    T.farmer = mintToken(app, { userId: farmer, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create'] });
    T.outsider = mintToken(app, { userId: outsider, tenantId: LIVE, roles: [], perms: [] });   // a token minted for LIVE; no role there in the database
    await setFlag('communication', true);
  }, 240_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'communication'`); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[LIVE, OTHER]]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  // a placed order (the buyer's, the farmer's lot) whose delivery address is the buyer's address A, and a shipment dropping at A
  const A: Record<string, string> = {};
  async function placeOrderTo(addressId: string): Promise<{ id: string; orderNo: string }> {
    const repo = app.get(OrderRepository);
    const id = uuidv7(); const now = new Date();
    const item = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: now, tenantId: LIVE, listingId, productId: product, titleSnapshot: 'GG-20 Groundnut hf6',
      quantity: 1, unitCode: 'quintal', unitPriceMinor: 615_000n, gstRatePct: null, hsnCode: null, batchId: null });
    const no = orderNoFor(id, now);
    const o = Order.place({ id, tenantId: LIVE, orderNo: no, checkoutGroupId: null, buyerUserId: buyer, sellerUserId: farmer, source: 'direct',
      currencyCode: 'INR', items: [item], deliveryMethodId: null, deliveryAddressId: addressId, requiresPayment: false, now });
    await uow.run(LIVE, (tx) => repo.insertGraph(tx, o, [item]), { userId: buyer });
    return { id, orderNo: no };
  }

  describe('setup: the buyer\'s order thread with the organisation', () => {
    it('the buyer\'s address A (Junagadh), an order delivering to it, a shipment dropping at it; the order thread with the farmer', async () => {
      A.ref = await createAddress(T.buyer, { line1: 'Plot 14, GIDC Vadal', village: 'Vadal', regionId: JUNAGADH, pincode: '362001', countryCode: 'IN', contactName: 'Nilesh', contactPhone: '+919898012742', isDefault: true });
      ({ id: orderId, orderNo } = await placeOrderTo(A.ref));
      await admin.query(`INSERT INTO shipments (id, tenant_id, order_id, status, drop_address_id, delivery_attempts, created_at) VALUES (uuid_generate_v7(), $1, $2, 'in_transit', $3, 0, now())`, [LIVE, orderId, A.ref]);
      const org = await request(http).post('/v1/conversations/organisation').set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send({ contextType: 'order', contextId: orderId });
      expect([org.status, org.body.error?.code]).toEqual([201, undefined]);
      CV.order = org.body.data.id as string;   // STORE-4b: the buyer's thread WITH THE ORGANISATION (the farmer is its one order.manage member)
      await post(T.buyer, CV.order, 'When can I collect?');
      await post(T.farmer, CV.order, 'Ready on Thursday');
      expect(orderNo).toMatch(/^KV\d{4}-/);
    });
  });

  describe('(1) + (2) the masked call: no callee from the client, the server resolves it (founder D2)', () => {
    beforeEach(async () => { for (const u of [buyer, stranger, blockedBuyer, outsider, third, caller6, farmer]) await resetRateLimit(u); });
    it('a client-supplied `calleeUserId` → refused by the .strict() schema (422); a context of its own → refused too; nothing bridged', async () => {
      const before = await count(`SELECT count(*)::int n FROM masked_calls WHERE tenant_id = $1`, [LIVE]);
      expect(refusal(await call(T.buyer, { conversationId: CV.order, calleeUserId: stranger }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refusal(await call(T.buyer, { calleeUserId: farmer }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refusal(await call(T.buyer, { conversationId: CV.order, contextType: 'order', contextId: orderId }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(await count(`SELECT count(*)::int n FROM masked_calls WHERE tenant_id = $1`, [LIVE])).toBe(before);
    });
    it('a conversation the caller is not in → 403 MASKED_CALL_NOT_PARTICIPANT; an unknown conversation answers the same', async () => {
      expect(refusal(await call(T.stranger, { conversationId: CV.order }))).toEqual([403, 'MASKED_CALL_NOT_PARTICIPANT']);
      expect(refusal(await call(T.stranger, { conversationId: randomUUID() }))).toEqual([403, 'MASKED_CALL_NOT_PARTICIPANT']);
      expect(await count(`SELECT count(*)::int n FROM masked_calls WHERE caller_user_id = $1`, [stranger])).toBe(0);
    });
    it('from the buyer\'s own thread → rings the OTHER participant (the farmer), audited without a phone number, answers no person id; a replay acts once', async () => {
      const key = randomUUID();
      const r = await call(T.buyer, { conversationId: CV.order }, key);
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      expect(r.body.data).toEqual({ id: expect.any(String), conversationId: CV.order, contextType: 'order', contextId: orderId });
      expect(JSON.stringify(r.body)).not.toContain(farmer);
      const row = (await admin.query(`SELECT caller_user_id, callee_user_id, context_type, context_id FROM masked_calls WHERE id = $1`, [r.body.data.id])).rows[0];
      expect(row).toEqual({ caller_user_id: buyer, callee_user_id: farmer, context_type: 'order', context_id: orderId });
      const audit = (await admin.query(`SELECT actor_user_id, entity_id, new_value::text nv FROM audit_log WHERE action = 'masked_call.initiated' AND entity_id = $1`, [r.body.data.id])).rows;
      expect(audit.length).toBe(1);
      expect([audit[0].actor_user_id, JSON.parse(audit[0].nv).conversationId]).toEqual([buyer, CV.order]);
      const phones = (await admin.query(`SELECT phone FROM users WHERE id = ANY($1::uuid[])`, [[buyer, farmer]])).rows.map((x) => String(x.phone).replace(/\D/g, '').slice(-10));
      for (const p of phones) expect(audit[0].nv).not.toContain(p);
      const again = await call(T.buyer, { conversationId: CV.order }, key);
      expect([again.status, again.body.data.id]).toEqual([201, r.body.data.id]);
      expect(await count(`SELECT count(*)::int n FROM masked_calls WHERE caller_user_id = $1`, [buyer])).toBe(1);
    });
    it('a thread of three → 422 MASKED_CALL_NO_CALLEE (the organisation-contact rule does not exist yet — never guessed)', async () => {
      const trio = await open(T.farmer, 'direct', null, [third, stranger]);   // STORE-4b: staff open it; the buyer calls from it
      expect(refusal(await call(T.third, { conversationId: trio }))).toEqual([422, 'MASKED_CALL_NO_CALLEE']);
    });
    it('a party with no role in this organisation → 403 MASKED_CALL_NOT_MEMBER', async () => {
      // STORE-4b: a participant must be a member when the thread opens — the outsider joins, the thread opens, then the role ends (a member who left)
      await role(outsider, LIVE, 'customer');
      const t = await open(T.farmer, 'direct', null, [outsider]);
      await admin.query(`UPDATE user_tenant_roles SET is_active = false WHERE user_id = $1 AND tenant_id = $2`, [outsider, LIVE]);
      expect(refusal(await call(T.farmer, { conversationId: t }))).toEqual([403, 'MASKED_CALL_NOT_MEMBER']);
      expect(refusal(await call(T.outsider, { conversationId: t }))).toEqual([403, 'MASKED_CALL_NOT_MEMBER']);
    });
    it('(2) a block in EITHER direction → 403 MASKED_CALL_BLOCKED; nothing bridged; a lifted block (soft-deleted) no longer refuses', async () => {
      CV.blocked = await open(T.farmer, 'direct', null, [blockedBuyer]);   // STORE-4b: staff open it
      await admin.query(`INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)`, [farmer, blockedBuyer]);
      expect(refusal(await call(T.blockedBuyer, { conversationId: CV.blocked }))).toEqual([403, 'MASKED_CALL_BLOCKED']);
      expect(refusal(await call(T.farmer, { conversationId: CV.blocked }))).toEqual([403, 'MASKED_CALL_BLOCKED']);
      await admin.query(`UPDATE user_blocks SET deleted_at = now() WHERE blocker_user_id = $1 AND blocked_user_id = $2`, [farmer, blockedBuyer]);
      await admin.query(`INSERT INTO user_blocks (blocker_user_id, blocked_user_id) VALUES ($1, $2)`, [blockedBuyer, farmer]);   // the other direction
      expect(refusal(await call(T.farmer, { conversationId: CV.blocked }))).toEqual([403, 'MASKED_CALL_BLOCKED']);
      expect(await count(`SELECT count(*)::int n FROM masked_calls WHERE (caller_user_id = $1 AND callee_user_id = $2) OR (caller_user_id = $2 AND callee_user_id = $1)`, [farmer, blockedBuyer])).toBe(0);
      await admin.query(`UPDATE user_blocks SET deleted_at = now() WHERE blocker_user_id = $1`, [blockedBuyer]);
      expect((await call(T.blockedBuyer, { conversationId: CV.blocked })).status).toBe(201);
    });
    it('the sixth call in a minute from one user → 429 (RateLimit 5 / 60 s by user)', async () => {
      const t = await open(T.farmer, 'direct', null, [caller6]);   // STORE-4b: staff open it; the buyer calls from it
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await call(T.caller6, { conversationId: t })).status);
      expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    });
  });

  describe('(3) buyer-safe messaging reads (organisation only; staff keep the ids)', () => {
    it('GET conversations as the buyer: the organisation\'s name, the party, the order number — no full_name, no person uuid', async () => {
      const r = await request(http).get('/v1/conversations?archived=false').set(H(T.buyer));
      expect(r.status).toBe(200);
      const row = r.body.data.find((c: { id: string }) => c.id === CV.order);
      expect(row).toMatchObject({ counterpartyName: liveName, counterpartyRole: 'organisation', contextLabel: orderNo, contextType: 'order' });
      expect(row).not.toHaveProperty('counterpartyUserId');
      const raw = JSON.stringify(r.body);
      expect(raw).not.toContain('Ramesh');
      expect(raw).not.toContain(farmer);
      const one = await request(http).get(`/v1/conversations/${CV.order}`).set(H(T.buyer));
      expect([one.status, one.body.data.counterpartyName, one.body.data.contextLabel]).toEqual([200, liveName, orderNo]);
      expect(JSON.stringify(one.body)).not.toContain(farmer);
      expect(JSON.stringify(one.body)).not.toContain('Ramesh');
    });
    it('GET messages as the buyer: `from` (you / organisation), never senderUserId — no uuid but the ids of the rows themselves', async () => {
      const r = await request(http).get(`/v1/conversations/${CV.order}/messages`).set(H(T.buyer));
      expect(r.status).toBe(200);
      const byBody = Object.fromEntries((r.body.data as Array<{ body: string; from: string }>).map((m) => [m.body, m.from]));
      expect(byBody).toEqual({ 'When can I collect?': 'you', 'Ready on Thursday': 'organisation' });
      for (const m of r.body.data) expect(m).not.toHaveProperty('senderUserId');
      const ids = new Set((JSON.stringify(r.body.data).match(UUID) ?? []).map((x) => x.toLowerCase()));
      expect([...ids].every((x) => x === CV.order || (r.body.data as Array<{ id: string }>).some((m) => m.id === x))).toBe(true);
    });
    it('the SELLER (staff) keeps the name and the ids — the HOTFIX-5 "one read model, two shapes"', async () => {
      const r = await request(http).get('/v1/conversations').set(H(T.farmer));
      const row = r.body.data.find((c: { id: string }) => c.id === CV.order);
      expect(row).toMatchObject({ counterpartyName: 'Nilesh Shah', counterpartyUserId: buyer, contextLabel: orderNo });
      const m = await request(http).get(`/v1/conversations/${CV.order}/messages`).set(H(T.farmer));
      const bySender = Object.fromEntries((m.body.data as Array<{ body: string; senderUserId: string }>).map((x) => [x.body, x.senderUserId]));
      expect(bySender).toEqual({ 'When can I collect?': buyer, 'Ready on Thursday': farmer });
    });
    it('`?archived=` is read strictly: false → the inbox, true → the archive, maybe → 422', async () => {
      expect((await request(http).get('/v1/conversations?archived=false').set(H(T.buyer))).body.data.some((c: { id: string }) => c.id === CV.order)).toBe(true);
      expect((await request(http).get('/v1/conversations?archived=true').set(H(T.buyer))).body.data.some((c: { id: string }) => c.id === CV.order)).toBe(false);
      expect(refusal(await request(http).get('/v1/conversations?archived=maybe').set(H(T.buyer)))).toEqual([422, 'VALIDATION_FAILED']);
    });
  });

  describe('(4) + (5) copy-on-write: an address somebody is delivering to is never edited in place', () => {
    const before: Record<string, unknown> = {};
    const stateOf = async () => uow.run(LIVE, (tx) => app.get(TradeInvoiceRepository).resolveParties(tx, { tenantId: LIVE, buyerUserId: buyer, deliveryAddressId: (A.orderAddr as string) }), { userId: 'system' });
    it('(5) baseline: the order\'s place of supply is Gujarat (24)', async () => {
      A.orderAddr = (await admin.query(`SELECT delivery_address_id FROM orders WHERE id = $1`, [orderId])).rows[0].delivery_address_id;
      expect(A.orderAddr).toBe(A.ref);
      expect((await stateOf()).deliveryStateCode).toBe('24');
      Object.assign(before, await addrRow(A.ref));
    });
    it('(4) editing it (a new street, Pune): a NEW row is returned (copied), the old row keeps every value, the order and the shipment still point at it', async () => {
      const r = await patchAddress(T.buyer, A.ref, { line1: 'Warehouse 7, Hadapsar', regionId: PUNE, pincode: '411028' }, randomUUID());
      expect([r.status, r.body.error?.code]).toEqual([200, undefined]);
      expect(r.body.data).toEqual({ ok: true, id: expect.any(String), copied: true, previousId: A.ref });
      A.copy = r.body.data.id;
      expect(A.copy).not.toBe(A.ref);
      const old = await addrRow(A.ref);
      expect({ ...old, deleted_at: null, is_default: before.is_default }).toEqual(before);   // values untouched
      expect(old.deleted_at).not.toBeNull();                                              // retired
      expect((await admin.query(`SELECT delivery_address_id FROM orders WHERE id = $1`, [orderId])).rows[0].delivery_address_id).toBe(A.ref);
      expect((await admin.query(`SELECT drop_address_id FROM shipments WHERE order_id = $1`, [orderId])).rows[0].drop_address_id).toBe(A.ref);
      const copy = await addrRow(A.copy);
      expect(copy).toMatchObject({ user_id: buyer, line1: 'Warehouse 7, Hadapsar', region_id: PUNE, pincode: '411028', village: 'Vadal', country_code: 'IN', contact_phone: '+919898012742', is_default: true, deleted_at: null });
      const list = (await request(http).get('/v1/addresses').set(H(T.buyer))).body.data.map((a: { id: string }) => a.id);
      expect([list.includes(A.copy), list.includes(A.ref)]).toEqual([true, false]);
    });
    it('(5) the trade invoice\'s delivery state for that order is UNCHANGED (still 24 — the copy would read 27)', async () => {
      expect((await stateOf()).deliveryStateCode).toBe('24');
      const viaCopy = await uow.run(LIVE, (tx) => app.get(TradeInvoiceRepository).resolveParties(tx, { tenantId: LIVE, buyerUserId: buyer, deliveryAddressId: A.copy }), { userId: 'system' });
      expect(viaCopy.deliveryStateCode).toBe('27');
    });
    it('an address nobody is delivering to is edited IN PLACE (same id, copied: false)', async () => {
      A.free = await createAddress(T.buyer, { line1: 'Farm road 3', regionId: JUNAGADH, pincode: '362001', countryCode: 'IN' });
      const r = await patchAddress(T.buyer, A.free, { line1: 'Farm road 3, gate 2' });
      expect(r.body.data).toEqual({ ok: true, id: A.free, copied: false, previousId: null });
      expect((await addrRow(A.free)).line1).toBe('Farm road 3, gate 2');
    });
    it('a make-default on an address in use stays in place (the flag is a preference no delivery reads — no copy)', async () => {
      const B = await createAddress(T.buyer, { line1: 'Shop 2, Kalupur', regionId: JUNAGADH, pincode: '362001', countryCode: 'IN' });
      await placeOrderTo(B);
      const r = await patchAddress(T.buyer, B, { isDefault: true });
      expect(r.body.data).toEqual({ ok: true, id: B, copied: false, previousId: null });
      expect((await addrRow(B)).is_default).toBe(true);
      expect((await addrRow(A.copy)).is_default).toBe(false);   // one default
    });
    it('create replayed with the same key → ONE row; an edit replayed with its key → the same new id, one copy', async () => {
      const key = randomUUID();
      const n0 = await count(`SELECT count(*)::int n FROM addresses WHERE user_id = $1`, [buyer]);
      const a1 = await createAddress(T.buyer, { line1: 'Replay lane 1', pincode: '362001', countryCode: 'IN' }, key);
      const a2 = await createAddress(T.buyer, { line1: 'Replay lane 1', pincode: '362001', countryCode: 'IN' }, key);
      expect(a2).toBe(a1);
      expect(await count(`SELECT count(*)::int n FROM addresses WHERE user_id = $1`, [buyer])).toBe(n0 + 1);
      await placeOrderTo(a1);
      const ek = randomUUID();
      const e1 = (await patchAddress(T.buyer, a1, { line1: 'Replay lane 1A' }, ek)).body.data;
      const e2 = (await patchAddress(T.buyer, a1, { line1: 'Replay lane 1A' }, ek)).body.data;
      expect([e1.copied, e2.id]).toEqual([true, e1.id]);
      expect(await count(`SELECT count(*)::int n FROM addresses WHERE user_id = $1`, [buyer])).toBe(n0 + 2);
    });
    it('another user\'s remove → 404 (never 403, never a silent ok); a non-uuid → 404; the row untouched', async () => {
      expect(refusal(await request(http).delete(`/v1/addresses/${A.free}`).set(H(T.stranger)))).toEqual([404, 'ADDRESS_NOT_FOUND']);
      expect(refusal(await request(http).delete('/v1/addresses/not-a-uuid').set(H(T.stranger)))).toEqual([404, 'ADDRESS_NOT_FOUND']);
      expect(refusal(await patchAddress(T.stranger, A.free, { line1: 'Hijack road' }))).toEqual([404, 'ADDRESS_NOT_FOUND']);
      expect((await addrRow(A.free)).deleted_at).toBeNull();
    });
    it('removing the default makes the NEWEST remaining address the default (said in the answer); a repeat is ok', async () => {
      const s1 = await createAddress(T.stranger, { line1: 'Old lane 1', pincode: '362001', countryCode: 'IN', isDefault: true });
      const s2 = await createAddress(T.stranger, { line1: 'New lane 2', pincode: '362001', countryCode: 'IN' });
      const r = await request(http).delete(`/v1/addresses/${s1}`).set(H(T.stranger));
      expect([r.status, r.body.data]).toEqual([200, { ok: true, defaultId: s2 }]);
      expect((await addrRow(s2)).is_default).toBe(true);
      expect((await request(http).delete(`/v1/addresses/${s1}`).set(H(T.stranger))).body.data).toEqual({ ok: true, defaultId: null });
    });
  });

  describe('(6) consents through the REAL SDK reach /v1/consents', () => {
    it('setConsent grants then withdraws (an appended granted=false row); a replay appends nothing; listConsents reads the latest', async () => {
      const sdk = createClient({ baseUrl: `http://127.0.0.1:${port}`, getToken: () => T.buyer, getHeaders: () => ({ 'x-tenant-id': LIVE }) });
      const rows = () => count(`SELECT count(*)::int n FROM consents WHERE user_id = $1 AND purpose_code = 'marketing'`, [buyer]);
      expect(await rows()).toBe(0);
      await sdk.privacy.setConsent('marketing', true, randomUUID());
      const key = randomUUID();
      const w = await sdk.privacy.setConsent('marketing', false, key);
      expect(w.ok).toBe(true);
      await sdk.privacy.setConsent('marketing', false, key);   // the replay
      expect(await rows()).toBe(2);
      expect((await admin.query(`SELECT granted FROM consents WHERE user_id = $1 AND purpose_code = 'marketing' ORDER BY created_at DESC LIMIT 1`, [buyer])).rows[0].granted).toBe(false);
      const list = await sdk.privacy.listConsents();
      expect(list.find((c) => c.purposeCode === 'marketing')).toMatchObject({ purposeCode: 'marketing', granted: false });
      expect(refusal(await request(http).get('/v1/privacy/consents').set(H(T.buyer)))[0]).toBe(404);   // the dead path stays dead
    });
  });

  describe('(7) the inbox\'s `unreadOnly` is read strictly', () => {
    it('false → read AND unread; true → unread only; maybe → 422', async () => {
      await admin.query(`INSERT INTO notifications (tenant_id, user_id, event_code, channel, status, read_at, created_at) VALUES ($1, $2, 'order.confirmed', 'inapp', 'read', now(), now() - interval '2 minutes')`, [LIVE, buyer]);
      await admin.query(`INSERT INTO notifications (tenant_id, user_id, event_code, channel, status, created_at) VALUES ($1, $2, 'order.created', 'inapp', 'sent', now() - interval '1 minute')`, [LIVE, buyer]);
      const all = await request(http).get('/v1/notifications?unreadOnly=false').set(H(T.buyer));
      expect(all.status).toBe(200);
      expect(all.body.data.length).toBe(2);
      expect(all.body.data.filter((n: { readAt: string | null }) => n.readAt).length).toBe(1);
      const unread = await request(http).get('/v1/notifications?unreadOnly=true').set(H(T.buyer));
      expect(unread.body.data.length).toBe(1);
      expect(refusal(await request(http).get('/v1/notifications?unreadOnly=maybe').set(H(T.buyer)))).toEqual([422, 'VALIDATION_FAILED']);
    });
  });

  describe('(8) Rule Zero: any country\'s postal code, and the country is editable', () => {
    it('a 5-digit postal code with country GB is stored as such; an edit changes the country', async () => {
      const id = await createAddress(T.stranger, { line1: '14 Mill Lane, Wembley', pincode: '12345', countryCode: 'GB' });
      expect(await addrRow(id)).toMatchObject({ pincode: '12345', country_code: 'GB' });
      const r = await patchAddress(T.stranger, id, { countryCode: 'IN', pincode: '362001' });
      expect(r.body.data).toEqual({ ok: true, id, copied: false, previousId: null });
      expect(await addrRow(id)).toMatchObject({ pincode: '362001', country_code: 'IN' });
    });
  });
});
