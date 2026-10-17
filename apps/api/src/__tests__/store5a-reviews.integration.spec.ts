// apps/api/src/__tests__/store5a-reviews.integration.spec.ts · PC-56 STORE-5a — A REVIEW IS A BUYER'S VERDICT ON THE ORGANISATION, KEPT, NEVER
// EDITED AWAY, LIVE.
// The real AppModule over HTTP (supertest — listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; the outbox events the
// API wrote are relayed AS kv_relay through the real OutboxDispatcher (production's role), one event at a time; the review-prompts clock ticks
// on a kv_relay pool (the runner's). Tokens for the organisation's staff carry what the DATABASE grants (RoleCacheService.effectiveAccess — the
// login path), so migration 0218's grants are what is exercised. The `reviews` flag is flipped ON for the fixture tenant and restored OFF (Law 10).
// Night-time rule (21:00–06:00 IST quiet hours): the prompt / reminder notices are asserted by their ROWS and event codes only — never a
// template id or "sent".
//
//   (1) D1 — a COD order delivered → the BUYER completes it → the eligibility is born with expires_at = +30 days (`reviews.invite_window_days`,
//       read on the relay transaction as kv_relay), `order.settlement_skipped` audited, NO ledger entry under settle:<id>;
//   (2) submit with the three dimensions → published, edit_locks_at = created_at + 168 h, the author's shape (no target / reviewer uuid); a replay
//       with the key → one review; an unknown dimension → 422 REVIEW_DIMENSION_UNKNOWN (nothing written); a second submit → 409 REVIEW_DUPLICATE;
//   (3) `GET reviews/mine?orderId=` and `GET reviews/eligibility?orderId=` — the shapes, no counterparty id; a stranger: not eligible / 404;
//   (4) edit inside the window → audited `review.edited { before, after }` with the address, a replay under the key → one audit row; the lock
//       moved into the past → 409 REVIEW_LOCKED, nothing changed;
//   (5) an eligibility whose window has closed → 409 REVIEW_WINDOW_CLOSED (submit and preview); eligibility says windowOpen false;
//   (6) preview → the organisation's name, the dimension labels (in Hindi for a Hindi caller), "Verified buyer", editLocksAt, expiresAt — and
//       NOTHING written;
//   (7) the ORGANISATION's reply by a farmer member who is NOT the reviewed seller → stored, served `respondedBy: 'organisation'` with no person;
//       audited `review.responded`; the public row shows the reply, no person; a stranger → 403;
//   (8) 0218's grants: tenant_admin holds review.flag and not review.moderate (nor does ai_ops); tenant_admin → hide 403, remove 403, FLAG 201
//       (under_moderation, out of the public list, audited `review.flagged`); a buyer → flag 403 REVIEW_FLAG_FORBIDDEN; the support desk
//       (support_agent) restores;
//   (9) the review-prompts clock is in SCHEDULED_JOB_REGISTRY at 60 min; a tick invites each open eligibility ONCE (a closed window never; a
//       store whose `reviews` flag is OFF never — F-11); a
//       second tick nothing; seven days after the invite ONE reminder with reminded_at stamped, none on the next tick, none for an order already
//       reviewed; the notification rows exist with the event codes review.prompt / review.reminder;
//   (10) the public read: "Verified buyer", no name, no uuid; the seller's review of the buyer is never on a public route (HOTFIX-7's refusal
//        re-asserted) and the buyer reads it as a party, without the reviewer.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { UNIT_OF_WORK, UnitOfWork } from '../core/database/unit-of-work';
import { uuidv7 } from '../core/database/uuid.util';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { OutboxHandler } from '../core/outbox/event-envelope';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../core/jobs/scheduled-job.registry';
import { CLOCK_CADENCE_MS } from '../core/jobs/clock-cadence';
import { RoleCacheService } from '../core/rbac/role-cache.service';
import { Order } from '../modules/orders/domain/order.entity';
import { OrderItem } from '../modules/orders/domain/order-item.entity';
import { OrderRepository } from '../modules/orders/repositories/order.repository';
import { OrderCompletedHandler as SettleHandler } from '../modules/payments/events/handlers/order-completed.handler';
import { OrderCompletedHandler as EligibilityHandler } from '../modules/reviews/events/handlers/order-completed.handler';
import { ReviewPromptsClock } from '../modules/reviews/jobs/review-prompts.job';
import { DomainEventFanoutHandler } from '../modules/communication/events/handlers/domain-event-fanout.handler';
import { NotificationService } from '../modules/communication/services/notification.service';
import { NOTIFICATION_EVENT_MAP } from '../modules/communication/events/notification-event-map';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const PRICE = 615_000n;

run('PC-56 STORE-5a · reviews: kept, never edited away (integration, real AppModule over HTTP, relay and clock as kv_relay)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let relayPool: Pool; let cache: CacheService; let uow: UnitOfWork;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const LIVE = randomUUID(); const OFFT = randomUUID();   // OFFT: a store whose `reviews` flag stays OFF
  let farmer = ''; let farmer2 = ''; let buyer = ''; let buyer2 = ''; let buyer3 = ''; let stranger = ''; let tadmin = ''; let agent = ''; let aiops = '';
  let liveName = ''; let product = ''; let listing = '';
  const T: Record<string, string> = {};
  const O: Record<string, string> = {};
  const R: Record<string, string> = {};
  const flagCaches = (k: string) => [`flag:${k}`, `flagstale:${k}`, 'flags:all', `flagctx:${LIVE}`];
  const setFlag = async (k: string, on: boolean) => {
    if (on) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = jsonb_build_object('tenant_ids', $2::jsonb) WHERE key = $1`, [k, JSON.stringify([LIVE])]);
    else await admin.query(`UPDATE feature_flags SET is_enabled = false, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [k]);
    for (const c of flagCaches(k)) await cache.del(c);
  };
  const role = (userId: string, code: string) =>
    admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [userId, LIVE, code]);
  const dbToken = async (userId: string) => {
    const access = await app.get(RoleCacheService).effectiveAccess(userId, LIVE);
    return { token: mintToken(app, { userId, tenantId: LIVE, roles: access.roles, perms: access.permissions }), perms: access.permissions as string[] };
  };
  const H = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': LIVE, ...extra });
  const K = (token: string, key: string = randomUUID()) => ({ ...H(token), 'idempotency-key': key });
  const refusal = (r: request.Response) => [r.status, r.body.error?.code];
  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const published = (o: { status: string; error?: unknown }) => (o.status === 'failed' ? `failed: ${(o.error as Error)?.message}` : o.status);

  /** relay ONE pending event AS kv_relay through these handlers (production's role) */
  async function relay(eventType: string, aggregateId: string, handlers: OutboxHandler[]) {
    const row = await q1(`SELECT id::text FROM outbox_events WHERE event_type = $1 AND aggregate_id = $2 AND status = 'pending' ORDER BY id DESC LIMIT 1`, [eventType, aggregateId]);
    expect([eventType, aggregateId, row?.id ? 'pending' : 'none']).toEqual([eventType, aggregateId, 'pending']);
    const reg = new OutboxHandlerRegistry(); for (const h of handlers) reg.register(h);
    return new OutboxDispatcher(relayPool, reg, { inc: () => undefined, observe: () => undefined } as never).relayById(row.id);
  }
  async function placeOrder(buyerUserId: string): Promise<string> {
    const repo = app.get(OrderRepository);
    const id = uuidv7(); const now = new Date();
    const item = OrderItem.of({ id: uuidv7(), orderId: id, orderCreatedAt: now, tenantId: LIVE, listingId: listing, productId: product, titleSnapshot: 'Okra s5a',
      quantity: 1, unitCode: 'quintal', unitPriceMinor: PRICE, gstRatePct: null, hsnCode: null, batchId: null });
    const o = Order.place({ id, tenantId: LIVE, orderNo: `S5A-${id.replace(/-/g, '').slice(-14)}`, checkoutGroupId: null, buyerUserId, sellerUserId: farmer, source: 'direct',
      currencyCode: 'INR', items: [item], deliveryMethodId: null, deliveryAddressId: null, requiresPayment: false, now });
    await uow.run(LIVE, (tx) => repo.insertGraph(tx, o, [item]), { userId: buyerUserId });
    return id;
  }
  /** a pay-on-delivery order delivered and COMPLETED BY ITS BUYER, its completion relayed (settlement + the review eligibility) as kv_relay */
  async function codCompleted(buyerUserId: string, token: string): Promise<string> {
    const id = await placeOrder(buyerUserId);
    await admin.query(`UPDATE orders SET status = 'delivered'::order_status WHERE id = $1`, [id]);
    const r = await request(http).post(`/v1/orders/${id}/complete`).set(K(token));
    expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
    expect(published(await relay('orders.order_completed', id, [app.get(SettleHandler), app.get(EligibilityHandler)]))).toBe('published');
    return id;
  }
  const submit = (token: string, body: Record<string, unknown>, key?: string) => request(http).post('/v1/reviews').set(K(token, key)).send(body);
  const publicList = async () => (await request(http).get('/v1/reviews/public?targetType=organisation&limit=50').set({ 'x-tenant-id': LIVE })).body.data as Array<Record<string, unknown>>;
  const fanout = (outboxType: string) => new DomainEventFanoutHandler(NOTIFICATION_EVENT_MAP.find((e) => e.outboxType === outboxType)!, app.get(NotificationService));

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, LIVE, `Kisan Sathi FPC s5a ${LIVE.slice(0, 4)}`); await makeTenant(admin, OFFT, `Reviews-off Coop s5a ${OFFT.slice(0, 4)}`);
    await admin.query(`UPDATE tenants SET approved_at = now() WHERE id = $1`, [LIVE]);
    liveName = (await q1(`SELECT display_name FROM tenants WHERE id = $1`, [LIVE])).display_name;
    [farmer, farmer2, buyer, buyer2, buyer3, stranger, tadmin, agent, aiops] = await Promise.all(Array.from({ length: 9 }, () => makeUser(admin)));
    await admin.query(`UPDATE users SET full_name = 'Ramesh Kumar Patel' WHERE id = $1`, [farmer]);
    await admin.query(`UPDATE users SET full_name = 'Nilesh Shah' WHERE id = $1`, [buyer]);
    await admin.query(`UPDATE users SET full_name = 'Meena Ben' WHERE id = $1`, [farmer2]);
    await role(farmer, 'farmer'); await role(farmer2, 'farmer'); await role(tadmin, 'tenant_admin'); await role(agent, 'support_agent'); await role(aiops, 'ai_ops');
    for (const x of [buyer, buyer2, buyer3, stranger]) await role(x, 'customer');
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal', 'Quintal', 'mass', true) ON CONFLICT (code) DO NOTHING`);
    const code = 'cs5a' + randomUUID().replace(/-/g, '').slice(0, 12);
    const catId = (await q1(`INSERT INTO categories (code, default_name, path, depth, is_active) VALUES ($1::text, 'Vegetables s5a', $1::text::ltree, 1, true) RETURNING id`, [code])).id;
    product = (await q1(`INSERT INTO products (category_id, default_name, default_unit, is_active) VALUES ($1, 'Okra s5a', 'quintal', true) RETURNING id`, [catId])).id;
    listing = (await q1(
      `INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility, published_at)
       VALUES ($1, $2, $3, $4, 'Okra s5a', 400, 400, 1, 'quintal', $5, 'INR', 'published', 'public', now()) RETURNING id`, [LIVE, farmer, product, catId, PRICE.toString()])).id;
    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE); uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    for (const [k, x] of [['buyer', buyer], ['buyer2', buyer2], ['buyer3', buyer3], ['stranger', stranger]] as const) T[k] = mintToken(app, { userId: x, tenantId: LIVE, roles: ['customer'], perms: ['order.create', 'review.create'] });
    T.farmer = mintToken(app, { userId: farmer, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'review.create'] });
    T.farmer2 = mintToken(app, { userId: farmer2, tenantId: LIVE, roles: ['farmer'], perms: ['order.manage', 'review.create'] });
    T.tadmin = (await dbToken(tadmin)).token; T.agent = (await dbToken(agent)).token;
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev';
    relayPool = new Pool({ connectionString: u.toString(), max: 3, application_name: 'store5a-relay' });
    await setFlag('reviews', true);
  }, 300_000);
  afterAll(async () => {
    try { await admin?.query(`UPDATE feature_flags SET is_enabled = false, rollout_pct = 100, rules = '{}'::jsonb WHERE key = 'reviews'`); for (const c of flagCaches('reviews')) await cache?.del(c); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[LIVE, OFFT]]).catch(() => undefined);
    await relayPool?.end().catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 60_000);

  describe('(1) D1 — the COD "I received it": the buyer completes, nothing settles, the eligibility is born with its window', () => {
    it('a delivered COD order completed by its BUYER → eligibility expires_at = created_at + 30 days; order.settlement_skipped; NO ledger entry', async () => {
      O.a = await codCompleted(buyer, T.buyer);
      const e = await q1(`SELECT (expires_at - created_at) = interval '30 days' AS thirty, reminded_at, prompted_at FROM review_eligibility WHERE order_id = $1`, [O.a]);
      expect(e).toEqual({ thirty: true, reminded_at: null, prompted_at: null });
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'order.settlement_skipped' AND entity_id = $1`, [O.a])).toBe(1);
      expect(await count(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key = $1`, [`settle:${O.a}`])).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM settlement_lines WHERE order_id = $1`, [O.a])).toBe(0);
      for (const [k, b, t] of [['b', buyer2, T.buyer2], ['c', buyer3, T.buyer3]] as const) O[k] = await codCompleted(b, t);
    }, 180_000);
  });

  describe('(2) submit — the vocabulary, the lock, one review per order', () => {
    it('an unknown dimension → 422 REVIEW_DIMENSION_UNKNOWN by name, nothing written', async () => {
      const r = await submit(T.buyer, { orderId: O.a, stars: 5, subRatings: { quality: 5, taste: 4 } });
      expect(refusal(r)).toEqual([422, 'REVIEW_DIMENSION_UNKNOWN']);
      expect(r.body.error.details).toEqual({ unknown: ['taste'] });
      expect(await count(`SELECT count(*)::int n FROM reviews WHERE order_id = $1`, [O.a])).toBe(0);
    });
    it('the three dimensions → published; edit_locks_at = created_at + 168 h; the AUTHOR\'s shape (no target, no reviewer uuid); a replay → one review; a second submit → REVIEW_DUPLICATE', async () => {
      const key = randomUUID();
      const r = await submit(T.buyer, { orderId: O.a, stars: 5, subRatings: { quality: 5, freshness: 4, packaging: 3 }, body: 's5a: fresh okra, honest weight' }, key);
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      R.a = r.body.data.id;
      expect(r.body.data).toMatchObject({ orderId: O.a, status: 'published', label: 'verified_buyer', respondedBy: null, subRatings: { quality: 5, freshness: 4, packaging: 3 } });
      expect(r.body.data).not.toHaveProperty('targetId'); expect(r.body.data).not.toHaveProperty('reviewerUserId');
      const row = await q1(`SELECT (edit_locks_at - created_at) = interval '168 hours' AS week, status FROM reviews WHERE id = $1`, [R.a]);
      expect(row).toEqual({ week: true, status: 'published' });
      expect(new Date(r.body.data.editLocksAt).getTime()).toBeGreaterThan(Date.now() + 167 * 3_600_000);
      const replay = await submit(T.buyer, { orderId: O.a, stars: 5, subRatings: { quality: 5, freshness: 4, packaging: 3 }, body: 's5a: fresh okra, honest weight' }, key);
      expect(replay.body.data.id).toBe(R.a);
      expect(await count(`SELECT count(*)::int n FROM reviews WHERE order_id = $1 AND reviewer_user_id = $2`, [O.a, buyer])).toBe(1);
      expect(refusal(await submit(T.buyer, { orderId: O.a, stars: 2 }))).toEqual([409, 'REVIEW_DUPLICATE']);
    });
  });

  describe('(3) the caller\'s own review and eligibility — no counterparty id', () => {
    it('mine: the author\'s shape + editLocksAt + editable; eligibility: { eligible, expiresAt, windowOpen, reviewed, reviewId } — never the seller\'s uuid', async () => {
      const m = await request(http).get(`/v1/reviews/mine?orderId=${O.a}`).set(H(T.buyer));
      expect(m.status).toBe(200);
      expect(m.body.data).toMatchObject({ id: R.a, orderId: O.a, editable: true, label: 'verified_buyer' });
      expect(m.body.data.editLocksAt).toEqual(expect.any(String));
      expect(JSON.stringify(m.body.data)).not.toContain(farmer);
      const e = await request(http).get(`/v1/reviews/eligibility?orderId=${O.a}`).set(H(T.buyer));
      expect(Object.keys(e.body.data).sort()).toEqual(['eligible', 'expiresAt', 'reviewId', 'reviewed', 'windowOpen']);
      expect(e.body.data).toMatchObject({ eligible: true, windowOpen: true, reviewed: true, reviewId: R.a });
      expect(JSON.stringify(e.body.data)).not.toContain(farmer);
      expect((await request(http).get(`/v1/reviews/eligibility?orderId=${O.b}`).set(H(T.buyer2))).body.data).toMatchObject({ eligible: true, windowOpen: true, reviewed: false });
      expect((await request(http).get(`/v1/reviews/eligibility?orderId=${O.a}`).set(H(T.stranger))).body.data).toEqual({ eligible: false, expiresAt: null, windowOpen: false, reviewed: false });
      expect((await request(http).get(`/v1/reviews/mine?orderId=${O.a}`).set(H(T.stranger))).status).toBe(404);
    });
  });

  describe('(4) the edit window — audited inside it, LOCKED after it', () => {
    it('an edit inside the window → audited review.edited { before, after } with the address; a replay under the key → one audit row', async () => {
      const key = `review-edit:${randomUUID()}`;
      const r = await request(http).patch(`/v1/reviews/${R.a}`).set(K(T.buyer, key)).send({ stars: 4, subRatings: { quality: 4, freshness: 4 }, body: 's5a: still good' });
      expect([r.status, r.body.data?.stars]).toEqual([200, 4]);
      const a = (await admin.query(`SELECT new_value, old_value, ip::text AS ip FROM audit_log WHERE action = 'review.edited' AND entity_id = $1`, [R.a])).rows;
      expect(a).toHaveLength(1);
      expect(a[0].new_value).toEqual({ before: { stars: 5, subRatings: { quality: 5, freshness: 4, packaging: 3 }, body: 's5a: fresh okra, honest weight' },
        after: { stars: 4, subRatings: { quality: 4, freshness: 4 }, body: 's5a: still good' } });
      expect(a[0].ip).toEqual(expect.any(String));
      await request(http).patch(`/v1/reviews/${R.a}`).set(K(T.buyer, key)).send({ stars: 4, subRatings: { quality: 4, freshness: 4 }, body: 's5a: still good' });
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'review.edited' AND entity_id = $1`, [R.a])).toBe(1);
    });
    it('the lock moved into the past → 409 REVIEW_LOCKED by name; the review is kept as it was; mine says editable false', async () => {
      await admin.query(`UPDATE reviews SET edit_locks_at = now() - interval '1 minute' WHERE id = $1`, [R.a]);
      const r = await request(http).patch(`/v1/reviews/${R.a}`).set(K(T.buyer)).send({ stars: 1, body: 's5a: rewritten' });
      expect(refusal(r)).toEqual([409, 'REVIEW_LOCKED']);
      expect(await q1(`SELECT stars, body FROM reviews WHERE id = $1`, [R.a])).toEqual({ stars: 4, body: 's5a: still good' });
      expect((await request(http).get(`/v1/reviews/mine?orderId=${O.a}`).set(H(T.buyer))).body.data.editable).toBe(false);
    });
  });

  describe('(5) the invite window', () => {
    it('an eligibility whose window has closed → 409 REVIEW_WINDOW_CLOSED (submit and preview); eligibility windowOpen false', async () => {
      await admin.query(`UPDATE review_eligibility SET expires_at = now() - interval '1 day' WHERE order_id = $1`, [O.b]);
      expect(refusal(await submit(T.buyer2, { orderId: O.b, stars: 3 }))).toEqual([409, 'REVIEW_WINDOW_CLOSED']);
      expect(refusal(await request(http).post('/v1/reviews/preview').set(H(T.buyer2)).send({ orderId: O.b, stars: 3 }))).toEqual([409, 'REVIEW_WINDOW_CLOSED']);
      expect((await request(http).get(`/v1/reviews/eligibility?orderId=${O.b}`).set(H(T.buyer2))).body.data).toMatchObject({ eligible: true, windowOpen: false, reviewed: false });
      expect(await count(`SELECT count(*)::int n FROM reviews WHERE order_id = $1`, [O.b])).toBe(0);
    });
  });

  describe('(6) the preview — the server\'s review, nothing written', () => {
    it('the organisation\'s name, the dimension labels (Hindi for a Hindi caller), "Verified buyer", editLocksAt and expiresAt; no row, no event', async () => {
      const before = await count(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id = $1`, [LIVE]);
      const r = await request(http).post('/v1/reviews/preview').set(H(T.buyer3, { 'x-lang': 'hi' })).send({ orderId: O.c, stars: 5, subRatings: { quality: 5, packaging: 4 }, body: 's5a: preview' });
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      expect(r.body.data).toMatchObject({ orderId: O.c, organisation: { name: liveName }, stars: 5, body: 's5a: preview', label: 'verified_buyer',
        subRatings: [{ code: 'quality', label: 'गुणवत्ता', stars: 5 }, { code: 'packaging', label: 'पैकिंग', stars: 4 }] });
      expect(new Date(r.body.data.editLocksAt).getTime()).toBeGreaterThan(Date.now() + 167 * 3_600_000);
      expect(r.body.data.expiresAt).toEqual(expect.any(String));
      expect(JSON.stringify(r.body.data).match(UUID_G)).toEqual([O.c]);
      expect(await count(`SELECT count(*)::int n FROM reviews WHERE order_id = $1`, [O.c])).toBe(0);
      expect(await count(`SELECT count(*)::int n FROM outbox_events WHERE tenant_id = $1`, [LIVE])).toBe(before);
      const en = await request(http).post('/v1/reviews/preview').set(H(T.buyer3)).send({ orderId: O.c, stars: 5, subRatings: { quality: 5 } });
      expect(en.body.data.subRatings).toEqual([{ code: 'quality', label: 'Quality', stars: 5 }]);
    });
  });

  describe('(7) the ORGANISATION\'s reply (founder D2)', () => {
    it('a farmer member who is NOT the reviewed seller replies → stored, served respondedBy "organisation" with no person; audited review.responded', async () => {
      const r = await request(http).post(`/v1/reviews/${R.a}/respond`).set(H(T.farmer2)).send({ response: 's5a: thank you — the organisation' });
      expect([r.status, r.body.error?.code]).toEqual([201, undefined]);
      expect(r.body.data).toMatchObject({ respondedBy: 'organisation', sellerResponse: 's5a: thank you — the organisation' });
      expect(JSON.stringify(r.body.data)).not.toContain(farmer2);
      expect(JSON.stringify(r.body.data)).not.toContain('Meena');
      expect((await q1(`SELECT seller_response FROM reviews WHERE id = $1`, [R.a])).seller_response).toBe('s5a: thank you — the organisation');
      expect((await q1(`SELECT actor_user_id::text a, new_value FROM audit_log WHERE action = 'review.responded' AND entity_id = $1`, [R.a]))).toEqual({ a: farmer2, new_value: { respondedBy: 'organisation' } });
      const pub = (await publicList()).find((x) => x.body === 's5a: still good')!;
      expect(pub).toMatchObject({ sellerResponse: 's5a: thank you — the organisation', respondedBy: 'organisation', label: 'verified_buyer' });
      expect(JSON.stringify(pub).match(UUID_G)).toBeNull();
    });
    it('a stranger (a customer, no organisation role) → 403 REVIEW_FORBIDDEN', async () => {
      expect(refusal(await request(http).post(`/v1/reviews/${R.a}/respond`).set(H(T.stranger)).send({ response: 'not mine to answer' }))).toEqual([403, 'REVIEW_FORBIDDEN']);
    });
  });

  describe('(8) the organisation flags; the platform desk hides, removes, restores (founder D2, migration 0218)', () => {
    it('0218\'s grants from the database: tenant_admin holds review.flag and NOT review.moderate; ai_ops not review.moderate; support_agent both', async () => {
      const ta = (await dbToken(tadmin)).perms; const ag = (await dbToken(agent)).perms; const ai = (await dbToken(aiops)).perms;
      expect([ta.includes('review.flag'), ta.includes('review.moderate'), ta.includes('listing.moderate')]).toEqual([true, false, true]);
      expect(ai.includes('review.moderate')).toBe(false);
      expect([ag.includes('review.flag'), ag.includes('review.moderate')]).toEqual([true, true]);
    });
    it('tenant_admin → hide 403, remove 403 (listing.moderate no longer admits it); FLAG 201 → under_moderation, out of the public list, audited', async () => {
      const mod = (token: string, action: string) => request(http).post(`/v1/reviews/${R.a}/moderate`).set(H(token)).send({ action, reason: 's5a' });
      expect(refusal(await mod(T.tadmin, 'hide'))).toEqual([403, 'REVIEW_FORBIDDEN']);
      expect(refusal(await mod(T.tadmin, 'remove'))).toEqual([403, 'REVIEW_FORBIDDEN']);
      expect(refusal(await mod(T.buyer2, 'flag'))).toEqual([403, 'REVIEW_FLAG_FORBIDDEN']);
      const f = await mod(T.tadmin, 'flag');
      expect([f.status, f.body.data?.status]).toEqual([201, 'under_moderation']);
      expect((await q1(`SELECT status FROM reviews WHERE id = $1`, [R.a])).status).toBe('under_moderation');
      expect((await publicList()).some((x) => x.body === 's5a: still good')).toBe(false);
      expect(await count(`SELECT count(*)::int n FROM audit_log WHERE action = 'review.flagged' AND entity_id = $1 AND actor_user_id = $2`, [R.a, tadmin])).toBe(1);
      const back = await mod(T.agent, 'restore');
      expect([back.status, back.body.data?.status]).toEqual([201, 'published']);
      expect((await publicList()).some((x) => x.body === 's5a: still good')).toBe(true);
    });
  });

  describe('(9) one invite, one reminder — the review-prompts clock', () => {
    it('is in SCHEDULED_JOB_REGISTRY at the table\'s cadence (60 min)', () => {
      const jobs = new Map(app.get<ScheduledJobRegistry>(SCHEDULED_JOB_REGISTRY).list().map((j) => [j.name, j.intervalMs]));
      expect(jobs.get('review-prompts')).toBe(CLOCK_CADENCE_MS['review-prompts']);
      expect(CLOCK_CADENCE_MS['review-prompts']).toBe(60 * 60_000);
    });
    it('a tick invites each OPEN eligibility once (never a closed window); a second tick nothing; the notification rows exist (review.prompt)', async () => {
      const clock = app.get(ReviewPromptsClock);
      const prompts = (o: string) => count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'reviews.review_prompt' AND aggregate_id = $1`, [o]);
      O.off = uuidv7();   // an open eligibility in a store whose reviews are OFF (F-11): never invited
      await admin.query(`INSERT INTO review_eligibility (tenant_id, order_id, buyer_user_id, seller_user_id, expires_at) VALUES ($1, $2, $3, $4, now() + interval '30 days')`, [OFFT, O.off, buyer2, farmer2]);
      await clock.tick(relayPool);
      expect([await prompts(O.a), await prompts(O.b), await prompts(O.c), await prompts(O.off)]).toEqual([1, 0, 1, 0]);
      expect((await q1(`SELECT prompted_at FROM review_eligibility WHERE order_id = $1`, [O.off])).prompted_at).toBeNull();
      expect(await count(`SELECT count(*)::int n FROM review_eligibility WHERE order_id = ANY($1::uuid[]) AND prompted_at IS NOT NULL`, [[O.a, O.c]])).toBe(2);
      await clock.tick(relayPool);
      expect([await prompts(O.a), await prompts(O.b), await prompts(O.c)]).toEqual([1, 0, 1]);
      expect(published(await relay('reviews.review_prompt', O.c, [fanout('reviews.review_prompt')]))).toBe('published');
      expect(await count(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND event_code = 'review.prompt'`, [buyer3])).toBeGreaterThan(0);
    }, 120_000);
    it('seven days after the invite: ONE reminder (reminded_at stamped), none on the next tick, none for an order already reviewed; the rows exist (review.reminder)', async () => {
      const clock = app.get(ReviewPromptsClock);
      const reminders = (o: string) => count(`SELECT count(*)::int n FROM outbox_events WHERE event_type = 'reviews.review_reminder' AND aggregate_id = $1`, [o]);
      await admin.query(`UPDATE review_eligibility SET prompted_at = now() - interval '6 days' WHERE order_id = ANY($1::uuid[])`, [[O.a, O.c]]);
      await clock.tick(relayPool);
      expect([await reminders(O.a), await reminders(O.c)]).toEqual([0, 0]);   // not yet a week
      await admin.query(`UPDATE review_eligibility SET prompted_at = now() - interval '8 days' WHERE order_id = ANY($1::uuid[])`, [[O.a, O.c]]);
      await clock.tick(relayPool);
      expect([await reminders(O.a), await reminders(O.c)]).toEqual([0, 1]);   // O.a has a review → nothing to remind
      expect((await q1(`SELECT reminded_at IS NOT NULL AS r FROM review_eligibility WHERE order_id = $1`, [O.c])).r).toBe(true);
      await clock.tick(relayPool);
      expect(await reminders(O.c)).toBe(1);
      const ev = await q1(`SELECT payload FROM outbox_events WHERE event_type = 'reviews.review_reminder' AND aggregate_id = $1`, [O.c]);
      expect(ev.payload).toEqual({ v: 1, orderId: O.c, recipientUserIds: [buyer3, farmer] });
      expect(published(await relay('reviews.review_reminder', O.c, [fanout('reviews.review_reminder')]))).toBe('published');
      expect(await count(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND event_code = 'review.reminder'`, [buyer3])).toBeGreaterThan(0);
      expect(await count(`SELECT count(*)::int n FROM notification_events WHERE code = 'review.reminder' AND priority = 'informational' AND user_can_opt_out`, [])).toBe(1);
    }, 120_000);
  });

  describe('(10) the public read — "Verified buyer", no name; the seller\'s review of the buyer never public', () => {
    it('the public rows carry the label and no name or uuid', async () => {
      const rows = await publicList();
      expect(rows.length).toBeGreaterThan(0);
      for (const x of rows) expect(x.label).toBe('verified_buyer');
      const s = JSON.stringify(rows);
      expect(s.match(UUID_G)).toBeNull();
      expect(s).not.toMatch(/Nilesh|Ramesh|Meena/);
    });
    it('the seller reviews the buyer → stored; NOT in the public list; the public buyer route refused by name; the buyer reads it as a party, without the reviewer', async () => {
      const r = await submit(T.farmer, { orderId: O.a, stars: 4, body: 's5a: prompt payer' });
      expect([r.status, r.body.data?.targetType]).toEqual([201, 'buyer']);
      const id = r.body.data.id as string;
      expect((await publicList()).some((x) => x.body === 's5a: prompt payer')).toBe(false);
      expect(refusal(await request(http).get(`/v1/reviews/public?targetType=buyer&targetId=${buyer}`).set({ 'x-tenant-id': LIVE }))).toEqual([422, 'REVIEW_PUBLIC_BUYER_REFUSED']);
      expect(refusal(await request(http).get(`/v1/reviews/summary?targetType=buyer&targetId=${buyer}`).set({ 'x-tenant-id': LIVE }))).toEqual([422, 'REVIEW_PUBLIC_BUYER_REFUSED']);
      const party = (await request(http).get(`/v1/reviews/${id}`).set(H(T.buyer))).body.data;
      expect(party).toMatchObject({ id, body: 's5a: prompt payer', orderId: O.a });
      expect(party).not.toHaveProperty('reviewerUserId');
      expect(JSON.stringify(party)).not.toContain(farmer);
      expect((await request(http).get(`/v1/reviews/${id}`).set(H(T.tadmin))).body.data).toMatchObject({ reviewerUserId: farmer });   // the organisation's staff
      expect(refusal(await request(http).post(`/v1/reviews/${id}/respond`).set(H(T.farmer2)).send({ response: 'no' }))).toEqual([403, 'REVIEW_FORBIDDEN']);   // no organisation reply on a review of a buyer
    });
  });
});
