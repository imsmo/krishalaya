// apps/api/src/__tests__/store4b-messages.integration.spec.ts · PC-56 STORE-4b — MESSAGES TO THE ORGANISATION, NEVER TO A PERSON, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app, the REAL SDK (built
// dist) for the vocabulary read. Own fixtures (never the shared makeCategory). `communication` is switched ON for the run (Law 10: seeded OFF,
// restored OFF in afterAll). The dispute lock runs through the REAL OutboxDispatcher on a pool that logs in as `kv_relay` (production's shape).
//
// What it proves (brief §C7):
//   (1) the buyer opens an ORDER thread with the organisation → participants = the buyer (owner) + every active `order.manage` member (2 here),
//       never the support agent; the buyer's read names the organisation only (no person's name, no person's uuid); a replay with the key →
//       the same thread, a second open → the same thread; another buyer's order → 404 CONVERSATION_CONTEXT_NOT_FOUND (and an unknown one);
//       a LISTING thread is the caller's own (a second buyer gets a different one); a draft listing → 404; audited with a count;
//   (2) the generic open by a buyer → 403 MESSAGING_FORBIDDEN; by staff naming a non-member → 422 CONVERSATION_PARTICIPANT_NOT_MEMBER; by staff
//       naming members → 201; the support-ticket path (ConversationService.open, as SupportThreadService calls it) still opens;
//   (3) a report with a reason → the body hidden for the buyer, the reporter and a seller (staff); the moderator reads body + reason + reporter;
//       the inbox preview is blanked; your own message → 422 MESSAGE_REPORT_OWN; a replay → one event (and a second reporter → still one);
//       an unknown reason → 422; no key → 400; audited `message.reported` with the code, never the body;
//   (4) the owner locks and unlocks (`owner`); a moderator's lock → the owner's unlock 403 CONVERSATION_LOCK_HELD; the moderator lifts it;
//   (5) a `disputes.dispute_resolved` outbox event through the real relay (as kv_relay) → the ORDER thread locked `dispute`; the owner cannot
//       lift it (403); a post → 409 CONVERSATION_LOCKED with `lockKind: dispute`; a second delivery → no second lock event;
//   (6) `?scope=organisation` lists order + listing threads only (the support thread is excluded); no scope → unfiltered; `?scope=maybe` → 422;
//   (7) `GET masked-calls` as the buyer → `direction`, no `callerUserId` / `calleeUserId`; staff keep them;
//   (8) µs keyset: three messages (and two calls) written in ONE millisecond page with limit 1 — none skipped;
//   (9) the relay gate is run as its own spec (172/172 with this wave's handler).
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
import { OUTBOX_HANDLER_REGISTRY } from '../core/outbox/event-envelope';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { Order } from '../modules/orders/domain/order.entity';
import { OrderItem } from '../modules/orders/domain/order-item.entity';
import { orderNoFor } from '../modules/orders/domain/order-no';
import { OrderRepository } from '../modules/orders/repositories/order.repository';
import { ConversationService } from '../modules/communication/services/conversation.service';
import { DisputeResolvedLockHandler } from '../modules/communication/events/handlers/dispute-resolved-lock.handler';
import { createClient } from '../../../../packages/sdk-js/dist';   // the BUILT SDK: exactly what the storefront imports

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

run('PC-56 STORE-4b · messages to the organisation, never to a person (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relayPool: Pool; let cache: CacheService; let uow: UnitOfWork; let port = 0;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const OTHER = randomUUID();
  let farmer = ''; let admin2 = ''; let agent = ''; let buyer = ''; let buyer2 = ''; let outsider = '';
  let liveName = ''; let orderId = ''; let orderNo = ''; let order2 = ''; let listingId = ''; let draftListing = ''; let product = ''; let catId = '';
  const T: Record<string, string> = {};
  const CV: Record<string, string> = {};
  const M: Record<string, string> = {};

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
  const openOrg = (token: string, contextType: string, contextId: string, key: string = randomUUID()) =>
    request(http).post('/v1/conversations/organisation').set({ ...H(token), 'idempotency-key': key }).send({ contextType, contextId });
  const openGeneric = (token: string, body: Record<string, unknown>) =>
    request(http).post('/v1/conversations').set({ ...H(token), 'idempotency-key': randomUUID() }).send(body);
  const post = async (token: string, convo: string, body: string): Promise<string> => {
    const r = await request(http).post(`/v1/conversations/${convo}/messages`).set({ ...H(token), 'idempotency-key': randomUUID() }).send({ body });
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    return r.body.data.id as string;
  };
  const flag = (token: string, messageId: string, body: Record<string, unknown>, key: string | null = randomUUID()) =>
    request(http).post(`/v1/conversations/messages/${messageId}/flag`).set({ ...H(token), ...(key ? { 'idempotency-key': key } : {}) }).send(body);
  const lock = (token: string, convo: string, locked: boolean) => request(http).post(`/v1/conversations/${convo}/lock`).set(H(token)).send({ locked });
  const messagesOf = async (token: string, convo: string) => {
    const r = await request(http).get(`/v1/conversations/${convo}/messages?limit=100`).set(H(token));
    expect(r.status).toBe(200);
    return r.body.data as Array<Record<string, unknown>>;
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Anand FPO s4b ${LIVE.slice(0, 4)}`); await makeTenant(admin, OTHER, `Kisan Sathi s4b ${OTHER.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = ANY($1::uuid[])`, [[LIVE, OTHER]]);
    liveName = (await admin.query(`SELECT display_name FROM tenants WHERE id = $1`, [LIVE])).rows[0].display_name;
    [farmer, admin2, agent, buyer, buyer2, outsider] = await Promise.all(Array.from({ length: 6 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [farmer]);
    await admin.query(`UPDATE users SET full_name = 'Meena Desai' WHERE id = $1`, [admin2]);
    await admin.query(`UPDATE users SET full_name = 'Nilesh Shah' WHERE id = $1`, [buyer]);
    await role(farmer, LIVE, 'farmer');           // order.manage (seed) — the oldest responder
    await role(admin2, LIVE, 'tenant_admin');     // order.manage (seed)
    await role(agent, LIVE, 'support_agent');     // message.moderate, NOT order.manage — staff, never a responder
    for (const x of [buyer, buyer2]) await role(x, LIVE, 'customer');
    await role(outsider, OTHER, 'customer');      // a member of ANOTHER organisation only
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'cs4b' + randomUUID().replace(/-/g, '').slice(0, 12);
    catId = (await admin.query(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Oilseeds s4b', $1::text::ltree, 1, true) RETURNING id`, [code])).rows[0].id;
    product = (await admin.query(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Groundnut s4b', 'quintal', true) RETURNING id`, [catId])).rows[0].id;
    const listing = (status: string, title: string) => admin.query(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code,
                             price_minor, currency_code, status, visibility, published_at)
       VALUES ($1, $2, $3, $4, $5, 40, 40, 1, 'quintal', 615000, 'INR', $6::listing_status, 'public', now()) RETURNING id`, [LIVE, farmer, product, catId, title, status]);
    listingId = (await listing('published', 'GG-20 Groundnut s4b')).rows[0].id;
    draftListing = (await listing('draft', 'Draft lot s4b')).rows[0].id;
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE); uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    port = (http.address() as AddressInfo).port;
    for (const [k, x] of [['buyer', buyer], ['buyer2', buyer2]] as const) T[k] = mintToken(app, { userId: x, tenantId: LIVE, roles: ['customer'], perms: ['order.create'] });
    T.farmer = mintToken(app, { userId: farmer, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'listing.create'] });
    T.admin2 = mintToken(app, { userId: admin2, tenantId: LIVE, roles: ['tenant_admin'], perms: ['order.manage'] });
    T.agent = mintToken(app, { userId: agent, tenantId: LIVE, roles: ['support_agent'], perms: ['message.moderate'] });
    // two orders: the buyer's and buyer2's (both with the farmer's lot)
    ({ id: orderId, orderNo } = await placeOrder(buyer));
    ({ id: order2 } = await placeOrder(buyer2));
    // the relay logs in as kv_relay (production's shape — the relay gate's statement, db/local/local-login-roles.sql)
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev';
    relayPool = new Pool({ connectionString: u.toString(), max: 2, application_name: 'store4b-relay' });
    await setFlag('communication', true);
  }, 240_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = false WHERE key = 'communication'`); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[LIVE, OTHER]]).catch(() => undefined);
    await relayPool?.end().catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 40_000);

  async function placeOrder(buyerUserId: string): Promise<{ id: string; orderNo: string }> {
    const repo = app.get(OrderRepository);
    const id = uuidv7(); const now = new Date();
    const item = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: now, tenantId: LIVE, listingId, productId: product, titleSnapshot: 'GG-20 Groundnut s4b',
      quantity: 1, unitCode: 'quintal', unitPriceMinor: 615_000n, gstRatePct: null, hsnCode: null, batchId: null });
    const no = orderNoFor(id, now);
    const o = Order.place({ id, tenantId: LIVE, orderNo: no, checkoutGroupId: null, buyerUserId, sellerUserId: farmer, source: 'direct',
      currencyCode: 'INR', items: [item], deliveryMethodId: null, deliveryAddressId: null, requiresPayment: false, now });
    await uow.run(LIVE, (tx) => repo.insertGraph(tx, o, [item]), { userId: buyerUserId });
    return { id, orderNo: no };
  }

  describe('(1) the buyer opens ONE thread with the ORGANISATION (founder D1)', () => {
    it('an order thread: the buyer + every active order.manage member (2) — never the support agent; the buyer reads the organisation only', async () => {
      const key = randomUUID();
      const r = await openOrg(T.buyer, 'order', orderId, key);
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      CV.order = r.body.data.id;
      const parts = (await admin.query(`SELECT user_id, role FROM conversation_participants WHERE conversation_id = $1 ORDER BY role, user_id`, [CV.order])).rows;
      expect(parts.length).toBe(3);
      expect(Object.fromEntries(parts.map((p) => [p.user_id, p.role]))).toEqual({ [buyer]: 'owner', [farmer]: 'member', [admin2]: 'member' });
      expect(r.body.data).toMatchObject({ id: CV.order, contextType: 'order', contextId: orderId, counterpartyName: liveName, counterpartyRole: 'organisation', contextLabel: orderNo, lockKind: null });
      const raw = JSON.stringify(r.body.data);   // (the envelope's meta carries the request id — not a person)
      for (const name of ['Ramesh', 'Meena', 'Nilesh']) expect(JSON.stringify(r.body)).not.toContain(name);
      for (const person of [farmer, admin2, agent]) expect(JSON.stringify(r.body)).not.toContain(person);
      expect(new Set((raw.match(UUID) ?? []).map((x) => x.toLowerCase()))).toEqual(new Set([CV.order, orderId]));
      // a replay with the key → the same thread; a fresh key → the same thread (1:1 by context)
      expect((await openOrg(T.buyer, 'order', orderId, key)).body.data.id).toBe(CV.order);
      expect((await openOrg(T.buyer, 'order', orderId)).body.data.id).toBe(CV.order);
      expect(await count(`SELECT count(*)::int n FROM conversations WHERE tenant_id = $1 AND context_type = 'order' AND context_id = $2`, [LIVE, orderId])).toBe(1);
      const audit = (await admin.query(`SELECT actor_user_id, new_value::text nv FROM audit_log WHERE action = 'conversation.opened_with_organisation' AND entity_id = $1`, [CV.order])).rows;
      expect(audit.length).toBe(1);
      expect(JSON.parse(audit[0].nv)).toEqual({ contextType: 'order', contextId: orderId, responders: 2 });
    });
    it('another buyer\'s order → 404 CONVERSATION_CONTEXT_NOT_FOUND; an unknown order → the same; nothing is opened', async () => {
      expect(refusal(await openOrg(T.buyer2, 'order', orderId))).toEqual([404, 'CONVERSATION_CONTEXT_NOT_FOUND']);
      expect(refusal(await openOrg(T.buyer, 'order', order2))).toEqual([404, 'CONVERSATION_CONTEXT_NOT_FOUND']);
      expect(refusal(await openOrg(T.buyer, 'order', uuidv7()))).toEqual([404, 'CONVERSATION_CONTEXT_NOT_FOUND']);
      expect(await count(`SELECT count(*)::int n FROM conversations WHERE tenant_id = $1 AND context_id = $2`, [LIVE, order2])).toBe(0);
    });
    it('a listing thread is the caller\'s OWN: a second buyer gets a different one; a draft listing → 404; no key → 400; a participant list → 422', async () => {
      const a = await openOrg(T.buyer, 'listing', listingId);
      expect([a.status, a.body.data.contextLabel, a.body.data.counterpartyName]).toEqual([201, 'GG-20 Groundnut s4b', liveName]);
      CV.listing = a.body.data.id;
      const b = await openOrg(T.buyer2, 'listing', listingId);
      expect(b.status).toBe(201);
      CV.listing2 = b.body.data.id;
      expect(CV.listing2).not.toBe(CV.listing);
      expect((await openOrg(T.buyer, 'listing', listingId)).body.data.id).toBe(CV.listing);
      expect(refusal(await openOrg(T.buyer, 'listing', draftListing))).toEqual([404, 'CONVERSATION_CONTEXT_NOT_FOUND']);
      expect((await request(http).post('/v1/conversations/organisation').set(H(T.buyer)).send({ contextType: 'order', contextId: orderId })).status).toBe(400);
      expect(refusal(await request(http).post('/v1/conversations/organisation').set({ ...H(T.buyer), 'idempotency-key': randomUUID() })
        .send({ contextType: 'order', contextId: orderId, participantUserIds: [farmer] }))).toEqual([422, 'VALIDATION_FAILED']);
    });
    it('the SDK reaches the route; the report vocabulary is the platform\'s (lookups.values(\'report_reason\'))', async () => {
      const sdk = createClient({ baseUrl: `http://127.0.0.1:${port}`, getToken: () => T.buyer, getHeaders: () => ({ 'x-tenant-id': LIVE }) });
      expect((await sdk.conversations.openWithOrganisation({ contextType: 'order', contextId: orderId }, randomUUID())).id).toBe(CV.order);
      const codes = (await sdk.lookups.values('report_reason')).map((v) => v.code);
      expect(codes).toEqual(expect.arrayContaining(['spam', 'fraud', 'harassment', 'other']));
    });
  });

  describe('(2) the generic open is the organisation\'s tool; internal callers keep working', () => {
    it('a buyer → 403 MESSAGING_FORBIDDEN; staff naming a non-member → 422 CONVERSATION_PARTICIPANT_NOT_MEMBER; staff naming members → 201', async () => {
      expect(refusal(await openGeneric(T.buyer, { contextType: 'direct', participantUserIds: [farmer] }))).toEqual([403, 'MESSAGING_FORBIDDEN']);
      expect(refusal(await openGeneric(T.farmer, { contextType: 'direct', participantUserIds: [buyer, outsider] }))).toEqual([422, 'CONVERSATION_PARTICIPANT_NOT_MEMBER']);
      const ok = await openGeneric(T.farmer, { contextType: 'direct', participantUserIds: [buyer] });
      expect([ok.status, ok.body.error?.code]).toEqual([201, undefined]);
    });
    it('the support-ticket path (ConversationService.open, as SupportThreadService calls it) still opens a thread', async () => {
      const ticket = randomUUID();
      const c = await app.get(ConversationService).open(LIVE, { userId: buyer, isModerator: false }, `support-thread:${ticket}`, { contextType: 'support_ticket', contextId: ticket, participantUserIds: [] });
      CV.support = c.id;
      expect(await count(`SELECT count(*)::int n FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2 AND role = 'owner'`, [CV.support, buyer])).toBe(1);
    });
  });

  describe('(3) a report hides the body from everyone but a moderator (founder D2a/b)', () => {
    it('setup: the buyer writes, the organisation answers — the last message is the farmer\'s', async () => {
      M.mine = await post(T.buyer, CV.order, 'When can I collect?');
      M.bad = await post(T.farmer, CV.order, 'Pay me outside the platform');
    });
    it('a report with a reason (keyed) answers the reporter HIDDEN; audited with the code, never the body', async () => {
      const key = randomUUID();
      const r = await flag(T.buyer, M.bad, { reason: 'fraud' }, key);
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      expect(r.body.data).toMatchObject({ id: M.bad, body: null, hidden: true, from: 'organisation' });
      expect(r.body.data).not.toHaveProperty('flaggedBy');
      const row = (await admin.query(`SELECT m.is_flagged, m.flagged_by, lv.code FROM messages m JOIN lookup_values lv ON lv.id = m.flag_reason_id WHERE m.id = $1`, [M.bad])).rows[0];
      expect(row).toEqual({ is_flagged: true, flagged_by: buyer, code: 'fraud' });
      // a replay with the key → the same answer, one event; a second reporter → still one event
      expect((await flag(T.buyer, M.bad, { reason: 'fraud' }, key)).status).toBe(201);
      expect((await flag(T.admin2, M.bad, { reason: 'spam' })).status).toBe(201);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'comm.message_flagged' AND aggregate_id = $1`, [M.bad])).toBe(1);
      expect((await admin.query(`SELECT flagged_by FROM messages WHERE id = $1`, [M.bad])).rows[0].flagged_by).toBe(buyer);   // the first report stands
      const audit = (await admin.query(`SELECT reason, new_value::text nv FROM audit_log WHERE action = 'message.reported' AND entity_id = $1`, [M.bad])).rows;
      expect(audit.length).toBe(1);
      expect(audit[0].reason).toBe('fraud');
      expect(audit[0].nv).not.toContain('outside the platform');
    });
    it('hidden for the buyer (the reporter), the farmer (the sender, staff) and a second seller; the inbox preview is blank', async () => {
      for (const tok of [T.buyer, T.farmer, T.admin2]) {
        const m = (await messagesOf(tok, CV.order)).find((x) => x.id === M.bad)!;
        expect(m).toMatchObject({ body: null, voiceMediaId: null, attachmentMediaId: null, hidden: true });
        expect(m).not.toHaveProperty('flaggedBy'); expect(m).not.toHaveProperty('flagReason');
        expect((await messagesOf(tok, CV.order)).find((x) => x.id === M.mine)).toMatchObject({ body: 'When can I collect?', hidden: false });
      }
      const inbox = await request(http).get('/v1/conversations?scope=organisation').set(H(T.buyer));
      const row = inbox.body.data.find((c: { id: string }) => c.id === CV.order);
      expect(row).toMatchObject({ lastMessageBody: null, lastMessageHidden: true, lastMessageFromYou: false });
      expect(JSON.stringify(inbox.body)).not.toContain('outside the platform');
    });
    it('the moderator reads the body, the reason and the reporter', async () => {
      const m = (await messagesOf(T.agent, CV.order)).find((x) => x.id === M.bad)!;
      expect(m).toMatchObject({ body: 'Pay me outside the platform', isFlagged: true, flagReason: 'fraud', flaggedBy: buyer });
    });
    it('your own message → 422 MESSAGE_REPORT_OWN; an unknown reason → 422; no key → 400; not a participant → 404', async () => {
      expect(refusal(await flag(T.buyer, M.mine, { reason: 'spam' }))).toEqual([422, 'MESSAGE_REPORT_OWN']);
      expect(refusal(await flag(T.farmer, M.mine, { reason: 'nope' }))).toEqual([422, 'MESSAGE_REPORT_REASON_UNKNOWN']);
      expect((await flag(T.farmer, M.mine, { reason: 'spam' }, null)).status).toBe(400);
      expect(refusal(await flag(T.buyer2, M.mine, { reason: 'spam' }))).toEqual([404, 'MESSAGE_NOT_FOUND']);
      expect((await admin.query(`SELECT is_flagged FROM messages WHERE id = $1`, [M.mine])).rows[0].is_flagged).toBe(false);
    });
  });

  describe('(4) the lock is monotonic (founder D2c)', () => {
    it('the owner locks and unlocks their own lock (`owner`); audited with the kind', async () => {
      const l = await lock(T.buyer, CV.listing, true);
      expect([l.status, l.body.data.isLocked, l.body.data.lockKind]).toEqual([201, true, 'owner']);
      const u = await lock(T.buyer, CV.listing, false);
      expect([u.status, u.body.data.isLocked, u.body.data.lockKind]).toEqual([201, false, null]);
      const a = (await admin.query(`SELECT action, new_value->>'lockKind' k FROM audit_log WHERE entity_id = $1 AND action LIKE 'conversation.%lock%' ORDER BY created_at`, [CV.listing])).rows;
      expect(a).toEqual([{ action: 'conversation.locked', k: 'owner' }, { action: 'conversation.unlocked', k: null }]);
    });
    it('a moderator\'s lock → the owner\'s unlock 403 CONVERSATION_LOCK_HELD; the moderator lifts it', async () => {
      expect((await lock(T.agent, CV.listing, true)).body.data.lockKind).toBe('moderator');
      expect(refusal(await lock(T.buyer, CV.listing, false))).toEqual([403, 'CONVERSATION_LOCK_HELD']);
      expect((await admin.query(`SELECT is_locked, lock_kind FROM conversations WHERE id = $1`, [CV.listing])).rows[0]).toEqual({ is_locked: true, lock_kind: 'moderator' });
      expect((await lock(T.agent, CV.listing, false)).body.data.isLocked).toBe(false);
    });
  });

  describe('(5) a dispute decision locks the trade\'s thread (founder D2d) — through the real relay, as kv_relay', () => {
    const relayDispute = async (disputeId: string) => {
      const id = (await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'dispute',$2,'disputes.dispute_resolved',$3::jsonb) RETURNING id`,
        [LIVE, disputeId, JSON.stringify({ v: 1, disputeId, orderId, resolutionType: 'rejected', resolutionAmountMinor: null, raisedBy: buyer, againstUser: farmer })])).rows[0].id as string;
      const one = new OutboxHandlerRegistry();
      const mine = app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY).entries().filter((e) => e.handler instanceof DisputeResolvedLockHandler);
      expect(mine.length).toBe(1);
      one.register(mine[0].handler);
      return new OutboxDispatcher(relayPool, one, { inc: () => undefined, observe: () => undefined } as never).relayById(String(id));
    };
    it('the order thread is locked `dispute`; the owner cannot lift it; a post → 409 CONVERSATION_LOCKED with the kind; a re-delivery locks nothing twice', async () => {
      const disputeId = randomUUID();
      expect((await relayDispute(disputeId)).status).toBe('published');
      expect((await admin.query(`SELECT is_locked, lock_kind FROM conversations WHERE id = $1`, [CV.order])).rows[0]).toEqual({ is_locked: true, lock_kind: 'dispute' });
      expect(refusal(await lock(T.buyer, CV.order, false))).toEqual([403, 'CONVERSATION_LOCK_HELD']);
      const p = await request(http).post(`/v1/conversations/${CV.order}/messages`).set({ ...H(T.buyer), 'idempotency-key': randomUUID() }).send({ body: 'hello?' });
      expect([p.status, p.body.error?.code, p.body.error?.details?.lockKind]).toEqual([409, 'CONVERSATION_LOCKED', 'dispute']);
      const g = await request(http).get(`/v1/conversations/${CV.order}`).set(H(T.buyer));
      expect([g.body.data.isLocked, g.body.data.lockKind]).toEqual([true, 'dispute']);
      const locks = () => count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'comm.conversation_locked' AND aggregate_id = $1`, [CV.order]);
      expect(await locks()).toBe(1);
      expect((await relayDispute(disputeId)).status).toBe('published');
      expect(await locks()).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'conversation.locked' AND entity_id = $1 AND new_value->>'lockKind' = 'dispute'`, [CV.order])).toBe(1);
    });
  });

  describe('(6) scope=organisation', () => {
    it('order + listing threads only — the support thread is excluded; no scope → unfiltered; scope=maybe → 422', async () => {
      const scoped = (await request(http).get('/v1/conversations?scope=organisation').set(H(T.buyer))).body.data.map((c: { id: string; contextType: string }) => c.id);
      expect(scoped).toEqual(expect.arrayContaining([CV.order, CV.listing]));
      expect(scoped).not.toContain(CV.support);
      const all = (await request(http).get('/v1/conversations').set(H(T.buyer))).body.data.map((c: { id: string }) => c.id);
      expect(all).toContain(CV.support);
      expect(refusal(await request(http).get('/v1/conversations?scope=maybe').set(H(T.buyer)))).toEqual([422, 'VALIDATION_FAILED']);
    });
  });

  describe('(7) the buyer\'s call log names no person (founder D3)', () => {
    it('the buyer reads `direction`, never callerUserId / calleeUserId; staff keep them', async () => {
      await admin.query(`INSERT INTO masked_calls (tenant_id, caller_user_id, callee_user_id, context_type, context_id, provider_call_ref) VALUES ($1,$2,$3,'order',$4,'s4b-ref-1')`, [LIVE, buyer, farmer, orderId]);
      const b = await request(http).get('/v1/masked-calls').set(H(T.buyer));
      expect(b.status).toBe(200);
      const row = b.body.data.find((c: { contextId: string }) => c.contextId === orderId);
      expect(row).toMatchObject({ direction: 'outgoing', contextType: 'order' });
      expect(row).not.toHaveProperty('callerUserId'); expect(row).not.toHaveProperty('calleeUserId');
      expect(JSON.stringify(b.body)).not.toContain(farmer);
      const s = await request(http).get('/v1/masked-calls').set(H(T.farmer));
      expect(s.body.data.find((c: { contextId: string }) => c.contextId === orderId)).toMatchObject({ callerUserId: buyer, calleeUserId: farmer });
    });
  });

  describe('(8) µs keyset (survey F-21, B22): rows written in ONE millisecond page without a skip', () => {
    it('three messages in one millisecond, limit 1 → all three, newest first', async () => {
      const ids = [uuidv7(), uuidv7(), uuidv7()];
      const at = ['2026-10-17T03:00:00.123100Z', '2026-10-17T03:00:00.123400Z', '2026-10-17T03:00:00.123700Z'];
      for (let i = 0; i < 3; i++) await admin.query(`INSERT INTO messages (id, conversation_id, tenant_id, sender_user_id, body, created_at) VALUES ($1,$2,$3,$4,$5,$6::timestamptz)`, [ids[i], CV.listing2, LIVE, buyer2, `same ms ${i}`, at[i]]);
      const seen: string[] = []; let cursor: string | null = null;
      for (let guard = 0; guard < 6; guard++) {
        const r: request.Response = await request(http).get(`/v1/conversations/${CV.listing2}/messages?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).set(H(T.buyer2));
        expect(r.status).toBe(200);
        seen.push(...r.body.data.map((m: { id: string }) => m.id));
        cursor = r.body.meta.nextCursor;
        if (!cursor) break;
      }
      expect(seen.filter((x) => ids.includes(x))).toEqual([ids[2], ids[1], ids[0]]);
    });
    it('two calls in one millisecond, limit 1 → both', async () => {
      const at = ['2026-10-17T03:00:01.555100Z', '2026-10-17T03:00:01.555900Z'];
      const ids: string[] = [];
      for (const t of at) ids.push((await admin.query(`INSERT INTO masked_calls (tenant_id, caller_user_id, callee_user_id, provider_call_ref, created_at) VALUES ($1,$2,$3,'s4b-us',$4::timestamptz) RETURNING id`, [LIVE, buyer2, farmer, t])).rows[0].id);
      const seen: string[] = []; let cursor: string | null = null;
      for (let guard = 0; guard < 6; guard++) {
        const r: request.Response = await request(http).get(`/v1/masked-calls?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`).set(H(T.buyer2));
        seen.push(...r.body.data.map((m: { id: string }) => m.id));
        cursor = r.body.meta.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual([ids[1], ids[0]]);
    });
  });
});
