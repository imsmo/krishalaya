// modules/requirements/__tests__/tenant11d-requirement-truth.integration.spec.ts · PC-56 TENANT-11d — LIVE proof against real
// Postgres + RLS (no infra mocks). Founder decision: LINKED RESPONSES, ONE ORDER PER MEMBER, PER-MEMBER CONSENT BEFORE SEND.
// Each block fails on HEAD 3669479 (no desk, no group, no consent, one order per requirement, shortlist moved the requirement):
//   A3  the buyer desk (tenant_admin — who holds no requirement.post) posts AS a named buyer with the buyer's recorded consent;
//       the buyer is the member, never the desk; without the desk permission, or the evidence, or for a non-member → refused;
//   A6  the member-stock read is RULE-BASED (price ascending; same product + unit; never the buyer), labelled so; no AI score;
//   A1  a draft pooled quote + two member lines (price prefilled, blended in bigint, floor + remainder); stock / unit / one line per
//       member refused by name; SEND IS REFUSED while one member lacks consent (CONSENT_MISSING names her) and writes nothing;
//       an edited line loses its consent (DB trigger); the member may consent as self; the send then writes TWO linked responses;
//   A4  support staff cannot accept for the buyer; the desk cannot without the buyer's consent; nothing moves;
//   A2  the buyer accepts the pooled quote → fulfilled BY QUANTITY (40 of 40) and TWO orders, one per member, with the response's
//       quantity and the requirement's unit, linked on requirement_responses.order_id; a redelivery makes nothing; a PARTIAL accept
//       of one quote (20 of 25) → partially_matched and an order for 20; a shortlist no longer moves the requirement;
//   A6  the expiry sweep runs from a kv_relay pool and expires requirements + quotes through kv_app (no relay grant);
//   A7  responsesCount is the SQL count; rows written in ONE millisecond page exactly once (µs cursor); every act is audited
//       with actor · reason · before/after · ip; a moderator close needs a reason;
//   0189 consents are append-only; tenant B sees nothing.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeTenant, makeUser, ensureUnitCurrency } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { QuotaService } from '../../../core/quota/quota.service';
import { TxContext } from '../../../core/database/unit-of-work';
import { OutboxEvent } from '../../../core/outbox/event-envelope';
import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { QuoteAcceptedHandler } from '../../orders/events/handlers/quote-accepted.handler';
import { RequirementRepository } from '../repositories/requirement.repository';
import { RequirementResponseRepository } from '../repositories/requirement-response.repository';
import { ResponseGroupRepository } from '../repositories/response-group.repository';
import { RequirementService } from '../services/requirement.service';
import { RequirementResponseService } from '../services/requirement-response.service';
import { ResponseGroupService } from '../services/response-group.service';
import { RequirementOrderService } from '../services/requirement-order.service';
import { ExpireRequirementsJob } from '../jobs/expire-requirements.job';
import { RequirementActor, requirementActor } from '../policies/requirements.policies';
import { decodeCursor } from '../domain/cursor';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }
const key = () => `idem-${randomUUID()}`;
const IP = '10.0.0.11';
const H = 3600_000;

run('PC-56 TENANT-11d · requirements — linked responses, one order per member, per-member consent before send (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork;
  let reqs: RequirementService; let resps: RequirementResponseService; let groups: ResponseGroupService; let handler: QuoteAcceptedHandler; let job: ExpireRequirementsJob;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const tenantC = randomUUID();
  const adminU = randomUUID(); const coord = randomUUID(); const buyer = randomUUID(); const support = randomUUID();
  const suresh = randomUUID(); const meera = randomUUID(); const ramesh = randomUUID(); const outsider = randomUUID();
  let productId = ''; let categoryId = '';
  let L1 = ''; let L2 = ''; let L3 = ''; let Lkg = ''; let LbuyerOwn = '';
  let R1 = ''; let G1 = ''; let line1 = ''; let line2 = ''; let R2 = ''; let quoteR = '';
  const actors: Record<string, RequirementActor> = {};

  const auditOf = async (entityId: string, action: string) => (await admin.query(`SELECT * FROM audit_log WHERE entity_id=$1 AND action=$2 ORDER BY created_at`, [entityId, action])).rows;
  const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));
  const errOf = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string; details?: unknown }) => e);
  const voice = () => ({ channel: 'voice' as const, mediaId: randomUUID(), note: 'confirmed on call' });

  async function asRelay<T>(tenantId: string, fn: (tx: TxContext) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_relay');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const tx: TxContext = { query: (sql: string, p?: readonly unknown[]) => c.query(sql, p as unknown[]) as never, tenantId, userId: 'system' };
      const out = await fn(tx);
      await c.query('COMMIT');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }
  async function asApp<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_app');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return await fn(c);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }
  const addRole = async (u: string, role: string, tenant = tenantA) => {
    const r = (await admin.query(`SELECT id FROM roles WHERE code=$1`, [role])).rows[0].id;
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING`, [u, tenant, r]);
  };
  const permsOf = async (role: string) => new Set((await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.code=$1`, [role])).rows.map((x: { permission_code: string }) => x.permission_code));
  const listing = async (seller: string, qty: number, priceMinor: bigint, unit = 'quintal', title = 'GG-20 groundnut, grade A') => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,1,$8,$9,'INR','published','tenant')`, [id, tenantA, seller, productId, categoryId, title, qty, unit, priceMinor.toString()]);
    return id;
  };
  /** The relay delivering every pending quote_accepted for these responses, as OutboxDispatcher would (its tx as kv_relay). */
  const deliverAccepted = async (responseIds: string[]) => {
    const rows = (await admin.query(`SELECT * FROM outbox_events WHERE event_type='requirements.quote_accepted' AND aggregate_id = ANY($1::uuid[]) ORDER BY id`, [responseIds])).rows;
    for (const r of rows) {
      const ev = { id: String(r.id), tenantId: r.tenant_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, eventType: r.event_type, payload: r.payload } as unknown as OutboxEvent;
      await asRelay(r.tenant_id, (tx) => handler.handle(ev, tx));
    }
    return rows.length;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'B'); await makeTenant(admin, tenantC, 'C');
    const names: Record<string, string> = { [adminU]: 'Admin Desk', [coord]: 'Kavita Ben Desai', [buyer]: 'Saurashtra Oil Mills', [support]: 'Support Agent',
      [suresh]: 'Suresh Bhai Bhatt', [meera]: 'Meera Ben Joshi', [ramesh]: 'Ramesh Bhai Patel', [outsider]: 'Out Sider' };
    for (const [u, n] of Object.entries(names)) {
      await makeUser(admin, u as ReturnType<typeof randomUUID>);
      await admin.query(`UPDATE users SET full_name=$2, phone=$3 WHERE id=$1`, [u, n, `+9197${String(Math.floor(10000 + Math.random() * 89999))}${String(Math.floor(100 + Math.random() * 899))}`]);
    }
    await addRole(adminU, 'tenant_admin'); await addRole(coord, 'fpo_coordinator'); await addRole(buyer, 'customer'); await addRole(support, 'support_agent');
    for (const u of [suresh, meera, ramesh]) await addRole(u, 'farmer');
    await addRole(adminU, 'tenant_admin', tenantC);
    await ensureUnitCurrency(admin, 'quintal'); await ensureUnitCurrency(admin, 'kg');
    categoryId = randomUUID(); const code = `c${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Oilseeds',$3::ltree,1,true)`, [categoryId, code, code]);
    productId = randomUUID();
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,'Groundnut GG-20','quintal',$3,true, to_tsvector('simple','groundnut'))`, [productId, categoryId, tenantA]);
    L1 = await listing(suresh, 30, 634_000n);
    L2 = await listing(meera, 25, 644_500n);
    L3 = await listing(ramesh, 30, 635_000n);
    Lkg = await listing(ramesh, 900, 6_400n, 'kg', 'Groundnut loose (kg)');
    LbuyerOwn = await listing(buyer, 10, 600_000n);
    await admin.query(`UPDATE user_tenant_roles SET is_active=true WHERE user_id=$1`, [buyer]);

    for (const [u, role] of [[adminU, 'tenant_admin'], [coord, 'fpo_coordinator'], [buyer, 'customer'], [support, 'support_agent'], [suresh, 'farmer'], [meera, 'farmer'], [ramesh, 'farmer'], [outsider, 'customer']] as const) {
      actors[u] = requirementActor({ userId: u, permissions: await permsOf(role) } as never);
    }

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const cache = new InMemoryCacheService(); const flags = new FlagsService(pools, cache);
    const listings = new ListingService(uow, outbox, new AllowAllQuota(), idem, cache, metrics, new ListingRepository(replica as never), new PriceHistoryRepository(replica as never), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    const reqRepo = new RequirementRepository(replica as never); const respRepo = new RequirementResponseRepository(replica as never); const groupRepo = new ResponseGroupRepository(replica as never);
    reqs = new RequirementService(uow, outbox, idem, metrics, audit, reqRepo, groupRepo);
    resps = new RequirementResponseService(uow, outbox, idem, metrics, audit, listings, reqRepo, respRepo, groupRepo);
    groups = new ResponseGroupService(uow, outbox, metrics, audit, listings, reqRepo, respRepo, groupRepo);
    handler = new QuoteAcceptedHandler(new OrderRepository(replica as never), listings, flags, outbox, metrics, uow, new RequirementOrderService(respRepo));
    job = new ExpireRequirementsJob(60_000, uow, reqRepo, respRepo, reqs, resps);
  }, 120_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB, tenantC]]).catch(() => undefined);
    await pools?.onModuleDestroy(); await admin?.end();
  });

  const reqDto = (over: Record<string, unknown> = {}) => ({ title: 'GG-20 groundnut, grade A', quantity: '40', unitCode: 'quintal', productId, categoryId,
    budgetMaxMinor: '650000', needBy: '2030-07-16', deliveryPincode: '360002', isUrgent: true, ...over }) as never;

  it('A3 · the desk posts AS the named buyer with the buyer\'s consent; tenant_admin holds no requirement.post; refusals by name', async () => {
    const adminA = actors[adminU];
    expect(adminA.canPost).toBe(false); expect(adminA.canDesk).toBe(true);
    expect(await codeOf(reqs.create(tenantA, adminA, key(), reqDto(), IP))).toBe('REQUIREMENT_FORBIDDEN');                          // its own post needs requirement.post
    expect(await codeOf(reqs.create(tenantA, actors[support], key(), reqDto({ onBehalf: { buyerUserId: buyer, consent: { channel: 'otp' } } }), IP))).toBe('REQUIREMENT_DESK_FORBIDDEN');
    expect(await codeOf(reqs.create(tenantA, adminA, key(), reqDto({ onBehalf: { buyerUserId: buyer, consent: { channel: 'voice' } } }), IP))).toBe('REQUIREMENT_CONSENT_EVIDENCE_REQUIRED');
    expect(await codeOf(reqs.create(tenantA, adminA, key(), reqDto({ onBehalf: { buyerUserId: outsider, consent: { channel: 'otp' } } }), IP))).toBe('REQUIREMENT_NOT_A_MEMBER');

    const k = key();
    const r = await reqs.create(tenantA, adminA, k, reqDto({ onBehalf: { buyerUserId: buyer, consent: voice() } }), IP);
    const again = await reqs.create(tenantA, adminA, k, reqDto({ onBehalf: { buyerUserId: buyer, consent: voice() } }), IP);
    expect(again.id).toBe(r.id);
    R1 = r.id;
    expect(r.reqNo).toMatch(/^REQ-\d{4}-\d{2}$/);
    const row = (await admin.query(`SELECT buyer_user_id, posted_by, post_consent_id, created_by FROM requirements WHERE id=$1`, [R1])).rows[0];
    expect(row).toMatchObject({ buyer_user_id: buyer, posted_by: adminU, created_by: adminU });
    const c = (await admin.query(`SELECT act, member_user_id, channel, recorded_by FROM requirement_consents WHERE id=$1`, [row.post_consent_id])).rows[0];
    expect(c).toMatchObject({ act: 'post', member_user_id: buyer, channel: 'voice', recorded_by: adminU });
    const au = await auditOf(R1, 'requirement.created');
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_user_id: adminU, ip: IP });
    expect(au[0].new_value).toMatchObject({ buyerUserId: buyer, onBehalf: true, consentChannel: 'voice', quantity: '40', budgetMaxMinor: '650000' });
    const view = await reqs.getById(tenantA, R1, adminA);
    expect(view).toMatchObject({ buyerShortName: 'Saurashtra M.', onBehalf: true, postedByShortName: 'Admin D.', needBy: '2030-07-16', responsesCount: 0, buyerOrganisation: null });
  });

  it('A6 · member stock is RULE-BASED — same product + unit, available ≥ 1, never the buyer, price ascending; no AI score', async () => {
    expect(await codeOf(groups.matches(tenantA, actors[buyer], R1))).toBe('REQUIREMENT_DESK_FORBIDDEN');
    const m = await groups.matches(tenantA, actors[adminU], R1);
    expect(m.rule).toBe('stock match (rule-based) — AI score not yet available');
    expect(m.aiScore).toEqual({ available: false });
    expect(m.basis).toBe('product'); expect(m.orderedBy).toBe('price');
    expect(m.items.map((x) => x.listingId)).toEqual([L1, L3, L2]);             // ₹6,340 · ₹6,350 · ₹6,445 — the kg listing and the buyer's own are out
    expect(m.items[0]).toMatchObject({ sellerShortName: 'Suresh B.', quantityAvailable: '30.000', priceMinor: '634000', aboveCeiling: false, suggestedQuantity: '30.000', distanceKm: null });
    expect(m.items[0].sellerPhoneMasked).toMatch(/^\+91 97••• ••\d{3}$/);
    expect(JSON.stringify(m)).not.toMatch(/\+9197\d{8}/);
    expect((await admin.query(`SELECT count(*)::int n FROM requirement_responses WHERE ai_match_score IS NOT NULL`)).rows[0].n).toBe(0);
  });

  it('A1 · a draft + two member lines: price prefilled, blended in bigint; stock / unit / buyer / one-line-per-member refused by name', async () => {
    expect(await codeOf(groups.createDraft(tenantA, actors[suresh], R1, IP))).toBe('REQUIREMENT_DESK_FORBIDDEN');
    const g = await groups.createDraft(tenantA, actors[coord], R1, IP);
    G1 = g.id; expect(g.status).toBe('draft');
    expect(await codeOf(groups.addLine(tenantA, actors[coord], G1, { listingId: L1, quantity: '31' }, IP))).toBe('REQUIREMENT_LINE_STOCK_SHORT');
    expect(await codeOf(groups.addLine(tenantA, actors[coord], G1, { listingId: Lkg, quantity: '5' }, IP))).toBe('REQUIREMENT_LINE_UNIT_MISMATCH');
    expect(await codeOf(groups.addLine(tenantA, actors[coord], G1, { listingId: LbuyerOwn, quantity: '5' }, IP))).toBe('REQUIREMENT_LINE_MEMBER_IS_BUYER');
    const a = await groups.addLine(tenantA, actors[coord], G1, { listingId: L1, quantity: '17' }, IP);
    expect(await codeOf(groups.addLine(tenantA, actors[coord], G1, { listingId: L1, quantity: '3' }, IP))).toBe('REQUIREMENT_LINE_MEMBER_DUPLICATE');
    const b = await groups.addLine(tenantA, actors[coord], G1, { listingId: L2, quantity: '23' }, IP);
    line1 = a.lines[0].id; line2 = b.lines[1].id;
    expect(b.lines.map((l) => [l.sellerShortName, l.quantity, l.priceMinor])).toEqual([['Suresh B.', '17.000', '634000'], ['Meera J.', '23.000', '644500']]);
    expect(b).toMatchObject({ status: 'consent_pending', totalQuantity: '40.000', totalValueMinor: '25601500', blendedPriceMinor: '640037', blendedRemainderMinor: '20',
      aboveCeiling: false, fillsRequirement: true, validForHours: 48 });
    expect(b.consentMissing.map((x) => x.sellerShortName)).toEqual(['Suresh B.', 'Meera J.']);
    // the draft is a server row — re-read, it is kept
    expect((await groups.get(tenantA, actors[coord], G1)).lines).toHaveLength(2);
  });

  it('A1 · SEND IS REFUSED while one member lacks consent (named), writes nothing; an edited line loses its consent; a member may consent as self', async () => {
    await groups.recordConsent(tenantA, actors[coord], G1, line1, voice(), IP);
    const e = await errOf(groups.send(tenantA, actors[coord], G1, IP)) as { code: string; details: { members: Array<{ userId: string; name: string }> } };
    expect(e.code).toBe('CONSENT_MISSING');
    expect(e.details.members).toEqual([{ userId: meera, name: 'Meera J.', lineId: line2 }]);
    expect((await admin.query(`SELECT count(*)::int n FROM requirement_responses WHERE requirement_id=$1`, [R1])).rows[0].n).toBe(0);
    expect((await admin.query(`SELECT status FROM requirement_response_groups WHERE id=$1`, [G1])).rows[0].status).toBe('consent_pending');

    // Suresh's figures change → his yes no longer covers them (trigger clears it); a new yes is needed
    const edited = await groups.editLine(tenantA, actors[coord], G1, line1, { priceMinor: '634500' }, IP);
    expect(edited.lines[0].consent).toBeNull();
    expect((await auditOf(G1, 'requirement.group_line_edited'))[0].new_value).toMatchObject({ consentCleared: true, priceMinor: '634500' });
    await groups.editLine(tenantA, actors[coord], G1, line1, { priceMinor: '634000' }, IP);
    await groups.recordConsent(tenantA, actors[coord], G1, line1, { channel: 'otp' }, IP);

    // the desk cannot record an `app` yes for her; Meera records her own
    expect(await codeOf(groups.recordConsent(tenantA, actors[coord], G1, line2, { channel: 'app' }, IP))).toBe('REQUIREMENT_CONSENT_EVIDENCE_REQUIRED');
    expect(await codeOf(groups.recordConsent(tenantA, actors[ramesh], G1, line2, { channel: 'app' }, IP))).toBe('REQUIREMENT_DESK_FORBIDDEN');
    const self = await groups.recordConsent(tenantA, actors[meera], G1, line2, { channel: 'app' }, IP);
    expect(self.status).toBe('draft');
    expect(self.lines[1].consent).toMatchObject({ channel: 'app', self: true });
    const qc = (await admin.query(`SELECT member_user_id, listing_id, quantity::text q, price_minor::text p, recorded_by FROM requirement_consents WHERE line_id=$1 ORDER BY recorded_at DESC LIMIT 1`, [line2])).rows[0];
    expect(qc).toMatchObject({ member_user_id: meera, listing_id: L2, q: '23.000', p: '644500', recorded_by: meera });
  });

  it('A1 · send writes TWO linked responses in one transaction, audited; the buyer is told; responsesCount is the SQL count', async () => {
    const sent = await groups.send(tenantA, actors[coord], G1, IP);
    expect(sent.linkedResponses).toBe(2);
    expect(sent.status).toBe('submitted');
    const rows = (await admin.query(`SELECT seller_user_id, quantity::text q, quoted_price_minor::text p, status, group_id, consent_id, valid_until, submitted_by FROM requirement_responses WHERE requirement_id=$1 ORDER BY quantity`, [R1])).rows;
    expect(rows.map((r: any) => [r.seller_user_id, r.q, r.p, r.status, r.group_id, r.submitted_by])).toEqual([[suresh, '17.000', '634000', 'submitted', G1, coord], [meera, '23.000', '644500', 'submitted', G1, coord]]);
    expect(rows.every((r: any) => r.consent_id)).toBe(true);
    const ms = new Date(rows[0].valid_until).getTime() - Date.now();
    expect(ms).toBeGreaterThan(47.9 * H); expect(ms).toBeLessThanOrEqual(48 * H);
    expect((await admin.query(`SELECT count(*)::int n FROM requirement_group_lines WHERE group_id=$1 AND status='sent' AND response_id IS NOT NULL`, [G1])).rows[0].n).toBe(2);
    const au = await auditOf(G1, 'requirement.group_sent');
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ actor_user_id: coord, ip: IP });
    expect(au[0].new_value).toMatchObject({ linkedResponses: 2, totalQuantity: '40.000', blendedPriceMinor: '640037', blendedRemainderMinor: '20', aboveCeiling: false });
    const ob = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='requirement.group_quoted'`, [G1])).rows;
    expect(ob).toHaveLength(1);
    expect(ob[0].payload).toMatchObject({ recipientUserIds: [buyer], members: 2, reqNo: expect.stringMatching(/^REQ-/) });
    expect(await codeOf(groups.send(tenantA, actors[coord], G1, IP))).toBe('REQUIREMENT_GROUP_STATE');
    const list = await reqs.list(tenantA, actors[adminU], { box: 'all', counts: true, limit: 50 });
    expect(list.items.find((x) => x.id === R1)?.responsesCount).toBe(2);
    // the buyer's view of the responses: masked seller, status, group, consent state
    const rl = await resps.listForRequirement(tenantA, actors[buyer], R1, { limit: 20 });
    expect(rl.items.map((x) => [x.sellerShortName, x.status, x.groupId, x.consentState])).toEqual([['Meera J.', 'submitted', G1, 'recorded'], ['Suresh B.', 'submitted', G1, 'recorded']]);
    expect(rl.items[0].sellerPhoneMasked).toMatch(/••/);
    // a member reads only their own response
    expect((await resps.listForRequirement(tenantA, actors[suresh], R1, { limit: 20 })).items.map((x) => x.sellerUserId)).toEqual([suresh]);
  });

  it('A4 · staff cannot accept for the buyer: support (moderator) refused; the desk refused without the buyer\'s consent; nothing moves', async () => {
    expect(actors[support].canModerate).toBe(true);
    expect(await codeOf(resps.acceptGroup(tenantA, actors[support], G1, IP))).toBe('REQUIREMENT_FORBIDDEN');
    expect(await codeOf(resps.acceptGroup(tenantA, actors[coord], G1, IP))).toBe('REQUIREMENT_BUYER_CONSENT_REQUIRED');
    const someResp = (await admin.query(`SELECT id FROM requirement_responses WHERE group_id=$1 LIMIT 1`, [G1])).rows[0].id;
    expect(await codeOf(resps.accept(tenantA, actors[support], someResp, IP))).toBe('REQUIREMENT_FORBIDDEN');
    expect(await codeOf(resps.shortlist(tenantA, actors[support], someResp, IP))).toBe('REQUIREMENT_FORBIDDEN');
    expect(await codeOf(resps.reject(tenantA, actors[support], someResp, IP))).toBe('REQUIREMENT_FORBIDDEN');
    expect((await admin.query(`SELECT status, fulfilled_quantity::text f FROM requirements WHERE id=$1`, [R1])).rows[0]).toMatchObject({ status: 'open', f: '0.000' });
    expect((await admin.query(`SELECT count(*)::int n FROM requirement_responses WHERE group_id=$1 AND status='submitted'`, [G1])).rows[0].n).toBe(2);
  });

  it('A2 · the buyer accepts the pooled quote → fulfilled BY QUANTITY and TWO orders, one per member, in the requirement\'s unit; a redelivery makes nothing', async () => {
    const out = await resps.acceptGroup(tenantA, actors[buyer], G1, IP);
    expect(out.requirement).toMatchObject({ status: 'fulfilled', fulfilledQuantity: '40.000' });
    const ids = out.responses.map((r) => r.id);
    expect(await deliverAccepted(ids)).toBe(2);
    const orders = (await admin.query(
      `SELECT o.id, o.seller_user_id, o.buyer_user_id, o.source, o.requirement_id, o.subtotal_minor::text sub, i.quantity::text q, i.unit_code, i.unit_price_minor::text up
         FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.tenant_id=$1 AND o.requirement_id=$2 ORDER BY i.quantity`, [tenantA, R1])).rows;
    expect(orders.map((o: any) => [o.seller_user_id, o.buyer_user_id, o.source, o.q, o.unit_code, o.up, o.sub])).toEqual([
      [suresh, buyer, 'requirement', '17.000', 'quintal', '634000', '10778000'],
      [meera, buyer, 'requirement', '23.000', 'quintal', '644500', '14823500'],
    ]);
    const linked = (await admin.query(`SELECT seller_user_id, order_id, accepted_quantity::text a FROM requirement_responses WHERE group_id=$1 ORDER BY quantity`, [G1])).rows;
    expect(linked.map((x: any) => [x.seller_user_id, x.order_id, x.a])).toEqual([[suresh, orders[0].id, '17.000'], [meera, orders[1].id, '23.000']]);
    expect(await deliverAccepted(ids)).toBe(2);                                         // re-delivery
    expect((await admin.query(`SELECT count(*)::int n FROM orders WHERE tenant_id=$1 AND requirement_id=$2`, [tenantA, R1])).rows[0].n).toBe(2);
    expect((await admin.query(`SELECT status FROM requirement_response_groups WHERE id=$1`, [G1])).rows[0].status).toBe('accepted');
    const au = await auditOf(G1, 'requirement.group_accepted');
    expect(au[0]).toMatchObject({ actor_user_id: buyer, ip: IP });
    expect(au[0].old_value).toMatchObject({ fulfilledQuantity: '0.000', requirementStatus: 'open' });
    expect(au[0].new_value).toMatchObject({ acceptedQuantity: '40.000', fulfilledQuantity: '40.000', requirementStatus: 'fulfilled', onBehalf: false });
  });

  it('A2 · a shortlist does not move the requirement; a PARTIAL accept (20 of a 25 quote) → partially_matched and ONE order for 20; the desk acts only with consent', async () => {
    const r = await reqs.create(tenantA, actors[buyer], key(), reqDto({ title: 'GG-20 for crushing', budgetMaxMinor: '630000' }), IP);
    R2 = r.id;
    const q = await resps.submit(tenantA, ramesh, R2, key(), { quotedPriceMinor: '635000', quantity: '25', listingId: L3 } as never, IP);
    quoteR = q.id;
    expect((await auditOf(quoteR, 'requirement.response_submitted'))[0]).toMatchObject({ actor_user_id: ramesh, ip: IP });
    // the desk shortlists FOR the buyer only with the buyer's yes
    expect(await codeOf(resps.shortlist(tenantA, actors[coord], quoteR, IP))).toBe('REQUIREMENT_BUYER_CONSENT_REQUIRED');
    const sl = await resps.shortlist(tenantA, actors[coord], quoteR, IP, { consent: { channel: 'otp' } });
    expect(sl.status).toBe('shortlisted');
    expect((await admin.query(`SELECT status FROM requirements WHERE id=$1`, [R2])).rows[0].status).toBe('open');
    expect((await admin.query(`SELECT act, member_user_id, response_id FROM requirement_consents WHERE response_id=$1`, [quoteR])).rows[0]).toMatchObject({ act: 'shortlist', member_user_id: buyer });
    const rl = await resps.listForRequirement(tenantA, actors[buyer], R2, { limit: 5 });
    expect(rl.items[0].aboveCeiling).toBe(true);                                      // ₹6,350 over a ₹6,300 ceiling — allowed, flagged
    expect(await codeOf(resps.accept(tenantA, actors[buyer], quoteR, IP, { quantity: '25.001' }))).toBe('RESPONSE_ACCEPT_QUANTITY_INVALID');
    const acc = await resps.accept(tenantA, actors[buyer], quoteR, IP, { quantity: '20' });
    expect(acc).toMatchObject({ status: 'accepted', acceptedQuantity: '20.000', requirement: { status: 'partially_matched', fulfilledQuantity: '20.000' } });
    expect(await deliverAccepted([quoteR])).toBe(1);
    const o = (await admin.query(`SELECT o.seller_user_id, i.quantity::text q, i.unit_code, o.subtotal_minor::text s FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.requirement_id=$1`, [R2])).rows;
    expect(o).toEqual([{ seller_user_id: ramesh, q: '20.000', unit_code: 'quintal', s: '12700000' }]);
    expect((await auditOf(quoteR, 'requirement.quote_accepted'))[0].new_value).toMatchObject({ acceptedQuantity: '20.000', quotedQuantity: '25.000', partial: true, requirementStatus: 'partially_matched' });
  });

  it('A6 · the expiry sweep runs from a kv_relay pool and expires a requirement past need-by and a lapsed quote through kv_app (no relay grant)', async () => {
    const r = await reqs.create(tenantA, actors[buyer], key(), reqDto({ title: 'Old need', needBy: '2026-01-02' }), IP);
    const q = await resps.submit(tenantA, suresh, R2, key(), { quotedPriceMinor: '630000', quantity: '5', listingId: L1 } as never, IP);
    await admin.query(`UPDATE requirement_responses SET valid_until = now() - interval '1 minute' WHERE id=$1`, [q.id]);
    const relay = {
      query: async (sql: string, params?: unknown[]) => {
        const c: PoolClient = await admin.connect();
        try { await c.query('SET SESSION AUTHORIZATION kv_relay'); return await c.query(sql, params as unknown[]); }
        finally { await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
      },
    } as unknown as Pool;
    const res = await job.sweep(relay, new Date());
    expect(res.failed).toBe(0); expect(res.requirements).toBeGreaterThanOrEqual(1); expect(res.responses).toBeGreaterThanOrEqual(1);
    expect((await admin.query(`SELECT status FROM requirements WHERE id=$1`, [r.id])).rows[0].status).toBe('expired');
    expect((await admin.query(`SELECT status FROM requirement_responses WHERE id=$1`, [q.id])).rows[0].status).toBe('expired');
    expect((await auditOf(r.id, 'requirement.expired'))[0]).toMatchObject({ actor_user_id: null, reason: 'need-by date passed' });
    expect((await admin.query(`SELECT has_table_privilege('kv_relay','requirement_responses','SELECT') AS s`)).rows[0].s).toBe(false);
  });

  it('A7 · rows written in ONE millisecond page exactly once (µs cursor), both sorts; box=open honours status; counts per status', async () => {
    const made: string[] = [];
    for (let i = 0; i < 5; i++) made.push((await reqs.create(tenantC, { userId: adminU, canModerate: false, canPost: true }, key(), { title: `Same ms ${i}`, quantity: '1', unitCode: 'quintal', needBy: '2030-01-0' + (1 + (i % 2)) } as never)).id);
    await admin.query(`UPDATE requirements SET created_at = timestamptz '2026-07-11 10:00:00.123000+05:30' + (interval '1 microsecond' * (ascii(right(title,1)) - 48)) WHERE id = ANY($1::uuid[])`, [made]);
    const deskC = { userId: adminU, canModerate: true, canDesk: true };
    for (const sort of ['recent', 'need_by'] as const) {
      const seen: string[] = []; let cursor: string | null = null;
      do {
        const pg = await reqs.list(tenantC, deskC, { box: 'all', sort, cursor: cursor ? decodeCursor(cursor, sort === 'need_by' ? 'need_by' : 'created') : undefined, limit: 2 });
        seen.push(...pg.items.map((x) => x.id)); cursor = pg.nextCursor;
      } while (cursor);
      expect(seen.sort()).toEqual([...made].sort());
    }
    await reqs.close(tenantC, deskC, made[0], IP, 'duplicate of another post');
    const open = await reqs.list(tenantC, deskC, { box: 'open', status: 'closed', counts: true, limit: 20 });
    expect(open.items).toHaveLength(0);                                               // box=open honours status: nothing closed is "open"
    const all = await reqs.list(tenantC, deskC, { box: 'all', counts: true, limit: 20 });
    expect(all.counts).toEqual({ open: 4, closed: 1 }); expect(all.total).toBe(5);
    expect(await codeOf(reqs.list(tenantC, { userId: randomUUID(), canModerate: false }, { box: 'all', limit: 5 }))).toBe('REQUIREMENT_DESK_FORBIDDEN');
  });

  it('A7 · close: a moderator needs a reason; the buyer\'s own close is audited too; edits audited before/after', async () => {
    const r = await reqs.create(tenantA, actors[buyer], key(), reqDto({ title: 'Close me' }), IP);
    await reqs.update(tenantA, actors[buyer], r.id, { quantity: '45', budgetMaxMinor: '660000' } as never, IP);
    const ed = await auditOf(r.id, 'requirement.edited');
    expect(ed[0].old_value).toMatchObject({ quantity: '40.000', budgetMaxMinor: '650000' });
    expect(ed[0].new_value).toMatchObject({ quantity: '45', budgetMaxMinor: '660000', by: 'buyer' });
    expect(await codeOf(reqs.close(tenantA, actors[support], r.id, IP))).toBe('REQUIREMENT_CLOSE_REASON_REQUIRED');
    await reqs.close(tenantA, actors[support], r.id, IP, 'Posted twice by mistake');
    const cl = await auditOf(r.id, 'requirement.closed');
    expect(cl[0]).toMatchObject({ actor_user_id: support, reason: 'Posted twice by mistake', ip: IP });
    expect(cl[0].new_value).toMatchObject({ status: 'closed', by: 'moderator' });
    const r2 = await reqs.create(tenantA, actors[buyer], key(), reqDto({ title: 'Close me too' }), IP);
    await reqs.close(tenantA, actors[buyer], r2.id, IP);
    expect((await auditOf(r2.id, 'requirement.closed'))[0].new_value).toMatchObject({ by: 'buyer' });
    // every act of the wave left its row
    for (const [id, action] of [[G1, 'requirement.group_created'], [G1, 'requirement.group_line_added'], [G1, 'requirement.group_consent_recorded'], [quoteR, 'requirement.response_shortlisted']] as const) {
      const rows = await auditOf(id, action);
      expect(rows.length).toBeGreaterThan(0); expect(rows[0].ip).toBe(IP); expect(rows[0].actor_user_id).toBeTruthy();
    }
  });

  it('0189 · consents are append-only as kv_app; a sent group\'s figures are frozen; tenant B sees no group, line or consent', async () => {
    expect(await asApp(tenantA, (c) => c.query(`UPDATE requirement_consents SET channel='otp' WHERE requirement_id=$1`, [R1]).then(() => 'ok', (e: { code: string }) => e.code))).toBe('42501');
    expect(await asApp(tenantA, (c) => c.query(`UPDATE requirement_response_groups SET total_quantity = 1 WHERE id=$1`, [G1]).then(() => 'ok', (e: { code: string }) => e.code))).toBe('23514');
    expect(await asApp(tenantA, (c) => c.query(`DELETE FROM requirement_group_lines WHERE group_id=$1`, [G1]).then(() => 'ok', (e: { code: string }) => e.code))).toBe('42501');
    const n = await asApp(tenantB, async (c) => (await c.query(`SELECT (SELECT count(*) FROM requirement_response_groups)::int g, (SELECT count(*) FROM requirement_group_lines)::int l, (SELECT count(*) FROM requirement_consents)::int c`)).rows[0]);
    expect(n).toEqual({ g: 0, l: 0, c: 0 });
  });
});
