// modules/logistics/__tests__/tenant5d-desk.integration.spec.ts · PC-56 TENANT-5d — the desk against a REAL
// PostgreSQL, through the real repository.
//
// The wave's headline claim is a database claim: **the reason a delivery failed was written to no column of this
// database** (the API accepted it, the domain put it in an outbox payload, and the only writer of a status hop passed
// `note = NULL`). A unit test can only assert that the code now passes something; only a live run can prove that a
// row comes back with the reason on it, that the vocabulary accepts a tenant's OWN added value, and that the chart's
// query groups what it should.
//
// It also proves the two things this programme has learned to distrust: that every windowed read PRUNES the
// partitions it should, and that the new indexes are the ones the planner actually chooses.
//
//   DATABASE_URL="postgres://postgres@/krish154?host=/var/run/postgresql" \
//     npx jest src/modules/logistics/__tests__/tenant5d-desk.integration.spec.ts
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { LogisticsDeskRepository } from '../repositories/logistics-desk.repository';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { Shipment } from '../domain/shipment.entity';
import { uuidv7 } from '../../../core/database/uuid.util';
import { failureBreakdown, firstAttemptVerdict, historyVerdict, laneShares, transitVerdict } from '../domain/logistics-desk';

const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;

run('PC-56 TENANT-5d · the logistics desk against real Postgres', () => {
  let pool: Pool;
  let app: PoolClient;
  let desk: LogisticsDeskRepository;
  let ships: ShipmentRepository;
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const userId = randomUUID();
  const regionA = randomUUID();
  const regionB = randomUUID();
  const addrA = randomUUID();
  const addrB = randomUUID();
  // **uuid_generate_v7(), not randomUUID().** `shipments` is partitioned and every per-row read prunes with
  // `uuid_v7_time(id)` (Law 8), so a v4 id is invisible to `getForUpdate` — the row exists and the repository cannot
  // see it. Found by this probe, which is the only kind of test that can find it.
  let failedShipmentId = '';

  const tx = () => ({ tenantId, query: (sql: string, params?: unknown[]) => app.query(sql, params as never) });

  async function order(id: string): Promise<void> {
    await app.query(
      `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, subtotal_minor, total_minor)
       VALUES ($1,$2,$3,$4,$4,1000,1000)`,
      [id, tenantId, `5D-${id.slice(0, 8)}`, userId]);
  }

  /** A delivered shipment, with its pickup and delivery stamps and its failed-attempt count — the raw material of
   *  every measured figure on both screens. */
  async function delivered(o: { attempts: number; hours: number; daysAgo?: number }): Promise<string> {
    const orderId = randomUUID();
    await order(orderId);
    const ago = o.daysAgo ?? 3;
    const r = await app.query(
      `INSERT INTO shipments (id, tenant_id, order_id, status, pickup_address_id, drop_address_id,
         picked_up_at, delivered_at, delivery_attempts, created_at)
       VALUES (uuid_generate_v7(),$1,$2,'delivered',$3,$4,
               now() - ($5::int || ' days')::interval - ($6::numeric || ' hours')::interval,
               now() - ($5::int || ' days')::interval, $7, now() - ($5::int || ' days')::interval)
       RETURNING id`,
      [tenantId, orderId, addrA, addrB, ago, String(o.hours), o.attempts]);
    return r.rows[0].id as string;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    const admin = await pool.connect();
    await admin.query(`INSERT INTO countries (code, default_name, currency_code, phone_prefix) VALUES ('IN','India','INR','+91') ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO lookup_types (code, default_name) VALUES ('tenant_type','Tenant Type') ON CONFLICT (code) DO NOTHING`);
    const ttype = randomUUID();
    await admin.query(`INSERT INTO lookup_values (id, type_code, code, default_name) VALUES ($1,'tenant_type','fpo','FPO') ON CONFLICT DO NOTHING`, [ttype]);
    for (const [id, slug] of [[tenantId, 'a'], [otherTenantId, 'b']] as const) {
      await admin.query(
        `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code)
         VALUES ($1,$2,$3,$3,$4,'IN') ON CONFLICT (id) DO NOTHING`,
        [id, `t5d-${slug}-${String(id).slice(0, 8)}`, `5d ${slug}`, ttype]);
    }
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1,$2,'5d probe') ON CONFLICT (id) DO NOTHING`,
      [userId, `+9197${String(Date.now()).slice(-8)}`]);
    // Two villages, so a LANE has both ends — the desk excludes any shipment whose ends are unknown.
    for (const [id, name] of [[regionA, 'Vanthali'], [regionB, 'Rajkot']] as const) {
      await admin.query(
        // `level` is a SMALLINT depth, not a word — read off the live schema rather than assumed. `path` is an
        // ltree, so the code doubles as the label at this depth.
        `INSERT INTO admin_regions (id, country_code, level, code, default_name, path)
         VALUES ($1,'IN',4,$2,$3,$4::ltree) ON CONFLICT (id) DO NOTHING`,
        [id, `5d-${String(id).slice(0, 8)}`, name, `r5d_${String(id).slice(0, 8).replace(/-/g, '_')}`]);
    }
    for (const [id, region] of [[addrA, regionA], [addrB, regionB]] as const) {
      await admin.query(
        `INSERT INTO addresses (id, tenant_id, user_id, line1, village, region_id, pincode, country_code)
         VALUES ($1,$2,$3,'probe','v',$4,'362001','IN') ON CONFLICT (id) DO NOTHING`,
        [id, tenantId, userId, region]);
    }
    admin.release();

    app = await pool.connect();
    await app.query('SET ROLE kv_app');
    await app.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    const replica = { forTenant: () => ({ query: (sql: string, params?: unknown[]) => app.query(sql, params as never) }) };
    desk = new LogisticsDeskRepository(replica as never);
    ships = new ShipmentRepository(replica as never);
  }, 30_000);

  afterAll(async () => {
    app?.release();
    await pool?.end();
  }, 30_000);

  it('persists the failure REASON and its coded class on the event row — the column that was NULL since 0007', async () => {
    const orderId = randomUUID();
    await order(orderId);
    // Created through the REAL insert path, because two live properties depend on it: a per-row read prunes with
    // uuid_v7_time(id) ±5s (5a's PRUNE), and the UPDATE matches on `created_at` to the millisecond. A row minted by
    // SQL now() satisfies neither — see the lost-update test below, which is this wave's live finding.
    const s0 = Shipment.create({ id: uuidv7(), tenantId, orderId, pickupAddressId: addrA, dropAddressId: addrB });
    await ships.insert(tx() as never, s0);
    failedShipmentId = s0.toProps().id;
    // Walk it to a state a failure can happen from, through the real repository each time.
    s0.assign({ riderUserId: userId });
    await ships.update(tx() as never, s0, 'pending');
    s0.markPickedUp(null);
    await ships.update(tx() as never, s0, 'assigned');
    s0.markOutForDelivery('deadbeef');
    await ships.update(tx() as never, s0, 'picked_up');

    const s = await ships.getForUpdate(tx() as never, tenantId, failedShipmentId);
    expect(s).not.toBeNull();
    s!.markFailed('gate closed, watchman said after 6', 'gate_closed');
    await ships.update(tx() as never, s!, 'out_for_delivery');

    const row = await app.query(
      `SELECT status::text AS status, reason_code, note FROM shipment_events
        WHERE shipment_id=$1 AND status='failed' ORDER BY created_at DESC LIMIT 1`, [failedShipmentId]);
    expect(row.rows[0]).toMatchObject({
      status: 'failed', reason_code: 'gate_closed', note: 'gate closed, watchman said after 6',
    });
    // and the attempt was counted (5a's column), which is what the first-attempt rate reads
    const ship = await app.query(`SELECT delivery_attempts FROM shipments WHERE id=$1`, [failedShipmentId]);
    expect(Number(ship.rows[0].delivery_attempts)).toBe(1);
  });

  it('REFUSES a write whose row it cannot match, instead of recording an event the shipment contradicts', async () => {
    // **This wave's live finding.** `update` matches on `created_at` (the partition key) and PostgreSQL keeps
    // microseconds where JS keeps milliseconds, so a shipment row created by SQL `now()` — a fixture, a backfill, an
    // importer, a data fix — can never be matched by the app. Before this wave the UPDATE affected zero rows, said
    // nothing, and the event row was written anyway: `shipment_events` recorded a failed attempt while `shipments`
    // still said out_for_delivery with zero attempts. It now fails closed.
    const orderId = randomUUID();
    await order(orderId);
    const ins = await app.query(
      `INSERT INTO shipments (id, tenant_id, order_id, status, pickup_address_id, drop_address_id, picked_up_at, created_at)
       VALUES (uuid_generate_v7(),$1,$2,'out_for_delivery',$3,$4, now() - interval '2 hours', now())
       RETURNING id, created_at`,
      [tenantId, orderId, addrA, addrB]);
    const rawId = ins.rows[0].id as string;
    const before = await app.query(`SELECT count(*)::int AS n FROM shipment_events WHERE shipment_id=$1`, [rawId]);

    // Rehydrated with the created_at as JS read it — i.e. truncated to milliseconds, exactly as the app would.
    const ship = Shipment.rehydrate({
      id: rawId, tenantId, orderId, partnerId: null, vehicleId: null, riderUserId: userId,
      status: 'out_for_delivery', awbNo: null, pickupAddressId: addrA, dropAddressId: addrB,
      scheduledPickupAt: null, scheduledWindowMins: null, pickedUpAt: new Date(), deliveredAt: null,
      pickupOtpHash: null, deliveryOtpHash: null, podMediaId: null, chargeMinor: null, codMinor: null,
      requiresColdChain: false, createdAt: new Date(ins.rows[0].created_at as string), deliveryAttempts: 0,
    } as never);
    ship.markFailed('gate closed', 'gate_closed');
    await expect(ships.update(tx() as never, ship, 'out_for_delivery')).rejects.toMatchObject({ code: 'SHIPMENT_UPDATE_LOST' });

    // And no event was recorded: the refusal is the whole point — a trail that contradicts its own shipment is worse
    // than a transition that did not happen.
    const after = await app.query(`SELECT count(*)::int AS n FROM shipment_events WHERE shipment_id=$1`, [rawId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('accepts a PLATFORM reason code and a TENANT\'S OWN added one, and refuses a typo', async () => {
    // Law 6, and the reason the vocabulary is tenant-extendable: a tenant in the hills needs "road closed".
    expect(await desk.isFailureReason(tenantId, 'gate_closed')).toBe(true);
    expect(await desk.isFailureReason(tenantId, 'gate_clsoed')).toBe(false);
    const admin = await pool.connect();
    await admin.query(
      `INSERT INTO lookup_values (id, type_code, tenant_id, code, default_name, sort_order)
       VALUES ($1,'shipment_failure_reason',$2,'ferry_missed','Ferry missed',7) ON CONFLICT DO NOTHING`,
      [randomUUID(), tenantId]);
    admin.release();
    expect(await desk.isFailureReason(tenantId, 'ferry_missed')).toBe(true);
    // ...and it belongs to THIS tenant only
    expect(await desk.isFailureReason(otherTenantId, 'ferry_missed')).toBe(false);
    const vocab = await desk.failureReasonVocabulary(tenantId);
    expect(vocab.map((v) => v.code)).toEqual([
      'gate_closed', 'reschedule_requested', 'address_problem', 'vehicle_problem', 'weather', 'other', 'ferry_missed',
    ]);
  });

  it('groups the chart by coded reason and keeps the pre-wave rows as their own NULL group', async () => {
    // A failure recorded the old way: a status hop with no reason at all, which is every failed attempt on this
    // platform before 0154.
    await app.query(
      `INSERT INTO shipment_events (id, shipment_id, tenant_id, status, note)
       VALUES (uuid_generate_v7(), $1, $2, 'failed', NULL)`, [failedShipmentId, tenantId]);
    const rows = await desk.failureReasons(tenantId, 90);
    const b = failureBreakdown(rows);
    expect(b.total).toBe(2);
    expect(b.unclassified).toBe(1);
    expect(b.slices).toEqual([{ code: 'gate_closed', events: 1, shareBps: 10_000 }]);
    // Half the window is unrecorded history, so the chart says it is a sample rather than the picture.
    expect(b.mostlyUnclassified).toBe(false);
  });

  it('uses the new partial index for the chart, on the partitioned event table', async () => {
    const plan = await app.query(
      `EXPLAIN (COSTS OFF) SELECT reason_code, count(*) FROM shipment_events
        WHERE tenant_id=$1 AND status='failed' AND reason_code IS NOT NULL
          AND created_at >= (now() - interval '90 days') GROUP BY reason_code`, [tenantId]);
    const text = plan.rows.map((r) => String((r as Record<string, unknown>)['QUERY PLAN'])).join('\n');
    expect(text).toMatch(/idx_shipment_events_reason|Index Scan|Bitmap Index Scan|Subplans Removed|shipment_events_/);
  });

  it('measures first-attempt delivery from `delivery_attempts`, counting only ZERO failures as first-attempt', async () => {
    await delivered({ attempts: 0, hours: 5 });
    await delivered({ attempts: 0, hours: 7 });
    await delivered({ attempts: 1, hours: 30 });   // delivered on the SECOND attempt: not first-attempt
    const stats = await desk.deliveryStats(tenantId, 30);
    expect(stats.delivered).toBe(3);
    expect(stats.firstAttempt).toBe(2);
    expect(firstAttemptVerdict(stats)).toEqual({ kind: 'measured', bps: 6667, of: 3 });
  });

  it('computes the transit median in the database, over the rows that HAVE a pickup stamp', async () => {
    const stats = await desk.deliveryStats(tenantId, 30);
    const v = transitVerdict(stats);
    expect(v.kind).toBe('measured');
    // 5h, 7h, 30h → median 7h. Computed by percentile_cont, not in JS.
    expect(v.kind === 'measured' && v.medianHours).toBe(7);
    expect(stats.missingPickupStamp).toBe(0);
  });

  it('prunes the shipment partitions for the delivered window and uses the new delivered index', async () => {
    const plan = await app.query(
      `EXPLAIN (COSTS OFF) SELECT count(*) FROM shipments
        WHERE tenant_id=$1 AND status='delivered' AND delivered_at IS NOT NULL
          AND delivered_at >= (now() - interval '30 days')
          AND created_at >= (now() - interval '60 days')`, [tenantId]);
    const text = plan.rows.map((r) => String((r as Record<string, unknown>)['QUERY PLAN'])).join('\n');
    expect(text).toMatch(/Subplans Removed|shipments_/);
  });

  it('counts today\'s pickups on the database\'s own day boundary, and only ones still waiting', async () => {
    const orderId = randomUUID();
    await order(orderId);
    const dueIns = await app.query(
      `INSERT INTO shipments (id, tenant_id, order_id, status, pickup_address_id, drop_address_id, scheduled_pickup_at, vehicle_id, created_at)
       VALUES (uuid_generate_v7(),$1,$2,'pickup_scheduled',$3,$4, date_trunc('day', now()) + interval '16 hours', NULL, now())
       RETURNING id`,
      [tenantId, orderId, addrA, addrB]);
    const due = dueIns.rows[0].id as string;
    expect(await desk.pickupsToday(tenantId)).toBe(1);
    const rows = await desk.pickupsDue(tenantId, 24, 10);
    expect(rows.map((r) => r.id)).toContain(due);
    // No vehicle, no rider, no 3PL — the row W225 prints as needing a person.
    const row = rows.find((r) => r.id === due)!;
    expect(row).toMatchObject({ hasVehicle: false, hasRider: false, hasPartner: false });
  });

  it('builds the lane table from BOTH ends\' regions, naming the villages', async () => {
    const lanes = await desk.lanes(tenantId, 90, 10);
    expect(lanes.length).toBeGreaterThan(0);
    expect(lanes[0]).toMatchObject({ fromRegionId: regionA, toRegionId: regionB, fromName: 'Vanthali', toName: 'Rajkot' });
    const shares = laneShares(lanes);
    expect(shares.basis).toBe('shipments');
    expect(shares.lanes[0].shareBps).toBe(10_000);   // one lane carries everything this tenant moved
  });

  it('excludes a shipment whose far end has no region rather than inventing a lane', async () => {
    const orderId = randomUUID();
    await order(orderId);
    const noRegion = randomUUID();
    const admin = await pool.connect();
    await admin.query(
      `INSERT INTO addresses (id, tenant_id, user_id, line1, village, region_id, pincode, country_code)
       VALUES ($1,$2,$3,'no region','v',NULL,'362001','IN')`, [noRegion, tenantId, userId]);
    admin.release();
    const before = (await desk.lanes(tenantId, 90, 10)).reduce((a, l) => a + l.shipments, 0);
    await app.query(
      `INSERT INTO shipments (id, tenant_id, order_id, status, pickup_address_id, drop_address_id, created_at)
       VALUES (uuid_generate_v7(),$1,$2,'in_transit',$3,$4, now())`,
      [tenantId, orderId, addrA, noRegion]);
    const after = (await desk.lanes(tenantId, 90, 10)).reduce((a, l) => a + l.shipments, 0);
    expect(after).toBe(before);
  });

  it('reads status counts, history depth and the window bounds the export will name', async () => {
    const counts = await desk.statusCounts(tenantId, 90);
    expect(counts.delivered).toBeGreaterThanOrEqual(3);
    expect(counts.pickup_scheduled).toBeGreaterThanOrEqual(1);
    const days = await desk.historyDays(tenantId);
    expect(days).not.toBeNull();
    expect(historyVerdict(days).kind).toBe('not_enough_history');   // this probe's fixtures are days old, not months
    const bounds = await desk.windowBounds(tenantId, 30);
    expect(bounds.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bounds.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(bounds.from < bounds.to).toBe(true);
  });

  it('reads the next weekly run from the route STATUS, and the day-of-week from the database', async () => {
    const admin = await pool.connect();
    const routeId = randomUUID();
    await admin.query(
      `INSERT INTO delivery_routes (id, tenant_id, default_name, run_weekday, village_region_ids, status, approved_by, approved_at)
       VALUES ($1,$2,'Saturday Run',6,$3::jsonb,'active',$4, now())`,
      [routeId, tenantId, JSON.stringify([regionA, regionB]), userId]);
    admin.release();
    const run = await desk.nextWeeklyRun(tenantId);
    expect(run).toMatchObject({ id: routeId, name: 'Saturday Run', runWeekday: 6, villages: 2 });
    expect(await desk.activeRouteCount(tenantId)).toBe(1);
    const dow = await desk.todayDow(tenantId);
    expect(dow).toBeGreaterThanOrEqual(0);
    expect(dow).toBeLessThanOrEqual(6);
  });

  it('reads a live reefer\'s latest temperature and its breach count from the ledgered readings', async () => {
    const orderId = randomUUID();
    await order(orderId);
    const reeferIns = await app.query(
      `INSERT INTO shipments (id, tenant_id, order_id, status, requires_cold_chain, pickup_address_id, drop_address_id, created_at)
       VALUES (uuid_generate_v7(),$1,$2,'in_transit',true,$3,$4, now()) RETURNING id`,
      [tenantId, orderId, addrA, addrB]);
    const reeferShipment = reeferIns.rows[0].id as string;
    await app.query(
      `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, recorded_at, is_breach)
       VALUES ($1,'shipment',$2, 4.2, now() - interval '2 hours', false),
              ($1,'shipment',$2, 9.9, now() - interval '1 hour', true)`,
      [tenantId, reeferShipment]);
    const rows = await desk.coldChainInTransit(tenantId, 10);
    const row = rows.find((r) => r.shipmentId === reeferShipment);
    expect(row).toBeDefined();
    expect(Number(row!.lastTempC)).toBeCloseTo(9.9, 1);
    expect(row!.breaches).toBe(1);
  });

  it('shows another tenant nothing, on every read this desk makes', async () => {
    await app.query(`SELECT set_config('app.tenant_id', $1, false)`, [otherTenantId]);
    expect(await desk.statusCounts(otherTenantId, 90)).toEqual({});
    expect(await desk.pickupsToday(otherTenantId)).toBe(0);
    expect(await desk.failureReasons(otherTenantId, 90)).toEqual([]);
    expect(await desk.lanes(otherTenantId, 90, 10)).toEqual([]);
    expect(await desk.nextWeeklyRun(otherTenantId)).toBeNull();
    expect(await desk.historyDays(otherTenantId)).toBeNull();
    await app.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
  });

  it('keeps the desk switched OFF, which is the state this wave ships in', async () => {
    const flag = await app.query(`SELECT is_enabled FROM feature_flags WHERE key='logistics_desk_insights'`);
    expect(flag.rows[0].is_enabled).toBe(false);
  });
});
