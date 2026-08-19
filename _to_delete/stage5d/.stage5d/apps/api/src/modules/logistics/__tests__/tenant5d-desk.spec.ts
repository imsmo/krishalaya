// modules/logistics/__tests__/tenant5d-desk.spec.ts · PC-56 TENANT-5d — W225 (Logistics overview) and W244
// (Logistics insights): the desk, and the fourteen figures those two screens print.
//
// The suite is organised around the distinction that IS the wave: a figure this platform measured, versus a figure the
// canon drew. Eight of the fourteen have a source; six do not, and the tests hold the refusals as tightly as the
// arithmetic — a refusal that silently becomes a zero is how a rate card acquires a number nobody measured.
//
// Behaviour, not source text (5a's mutation pass taught this programme the difference): the verdicts run, the SQL is
// EXECUTED against capturing fakes, and the write-path validation is driven through the service.
import {
  ACTIVE_STATUSES, DEFAULT_INSIGHT_WINDOW, INSIGHT_WINDOWS, MIN_HISTORY_DAYS, UNCLASSIFIED,
  activeCount, attentionKey, callAheadCandidate, costPerQtlKmVerdict, daysUntilWeekday, failureBreakdown,
  firstAttemptVerdict, historyVerdict, isInsightWindow, isLaneCandidate, laneShares, mechanismKey, mechanisms,
  onTimeVerdict, orderAttention, transitLossVerdict, transitVerdict,
  type AttentionItem, type DeliveryStats, type LaneRow,
} from '../domain/logistics-desk';
import { LogisticsDeskRepository } from '../repositories/logistics-desk.repository';
import { LogisticsDeskReadModel } from '../read-models/logistics-desk.read-model';
import { ShipmentService } from '../services/shipment.service';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { Shipment } from '../domain/shipment.entity';

/* ----------------------------------------------------------------------------------------------------------- */
/* helpers                                                                                                     */
/* ----------------------------------------------------------------------------------------------------------- */

const stats = (o: Partial<DeliveryStats> = {}): DeliveryStats => ({
  delivered: 100, firstAttempt: 93, medianTransitHours: 6.5, missingPickupStamp: 0, ...o,
});

function capturingReplica(rowsFor: (sql: string) => unknown[] = () => []) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rows: rowsFor(sql) };
  });
  const repo = new LogisticsDeskRepository({ forTenant: () => ({ query }) } as never);
  return { repo, calls, sqlOf: (needle: string) => calls.find((c) => c.sql.includes(needle)) };
}

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · the figures W225 refuses to print', () => {
  it('refuses on-time delivery, because nothing on this platform promises a delivery time', () => {
    // W225 prints "On-time delivery (30d) 95.1%". There is no promised-by column on a shipment, no SLA on a zone,
    // and none in a charge definition — so the ratio has no denominator, and the refusal names both candidates.
    expect(onTimeVerdict()).toEqual({
      kind: 'not_promised',
      missing: ['shipment_promised_delivery_at', 'zone_delivery_sla'],
    });
  });

  it('refuses transit loss AND the wastage share, and names the nearest signal instead of using it', () => {
    // The nearest thing is a buyer dispute reasoned `damaged` with a resolution amount — a CLAIMS figure in another
    // module's plane, which the blueprint forbids this module from reading. Named, not computed.
    const v = transitLossVerdict();
    expect(v.kind).toBe('not_recorded');
    expect(v.nearest).toBe('buyer_disputes_damaged');
    expect(v.missing).toEqual(['shipment_loss_record', 'weighbridge_slips', 'wastage_baseline']);
  });

  it('refuses cost per qtl-km with all THREE missing inputs named', () => {
    // Distance is a dead column since 0007, `shipments` has no weight at all, and nothing writes the charge (5c).
    // One missing input would be a gap; three is a tile that cannot exist, and the screen says which three.
    expect(costPerQtlKmVerdict()).toEqual({
      kind: 'not_computable',
      missing: ['shipment_distance_km', 'consignment_weight', 'shipment_charge_minor'],
    });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · what IS measured', () => {
  it('counts as active only the statuses where produce is committed and moving', () => {
    // `pending` is excluded on purpose: 5a established that a pending shipment is one whose money has not cleared,
    // and counting it would tell an FPO a truck is out for an order nobody paid for.
    expect(ACTIVE_STATUSES).not.toContain('pending');
    expect(ACTIVE_STATUSES).toContain('at_hub');
    expect(activeCount({ pending: 7, assigned: 2, in_transit: 3, at_hub: 1, delivered: 40, failed: 2 })).toBe(6);
    expect(activeCount({})).toBe(0);
  });

  it('gives the first-attempt rate in integer basis points, with the count it was measured over', () => {
    expect(firstAttemptVerdict(stats({ delivered: 118, firstAttempt: 109 }))).toEqual({ kind: 'measured', bps: 9237, of: 118 });
  });

  it('ROUNDS the rate rather than truncating it, so a small window is not quietly reported low', () => {
    // 2 of 3 is 66.67%. Truncation prints 66.6% — on a tenant with three deliveries a week that is the difference
    // between "first-attempt is holding" and "first-attempt slipped", from arithmetic alone.
    expect(firstAttemptVerdict(stats({ delivered: 3, firstAttempt: 2 })).kind).toBe('measured');
    expect(firstAttemptVerdict(stats({ delivered: 3, firstAttempt: 2 }))).toEqual({ kind: 'measured', bps: 6667, of: 3 });
    expect(firstAttemptVerdict(stats({ delivered: 7, firstAttempt: 5 }))).toEqual({ kind: 'measured', bps: 7143, of: 7 });
  });

  it('says "nothing was delivered" rather than reporting 0% — which is a claim about performance', () => {
    expect(firstAttemptVerdict(stats({ delivered: 0, firstAttempt: 0 }))).toEqual({ kind: 'no_deliveries' });
  });

  it('reports the transit median with its coverage, and refuses when nothing can be timed', () => {
    expect(transitVerdict(stats({ delivered: 50, missingPickupStamp: 5, medianTransitHours: 7.2 })))
      .toEqual({ kind: 'measured', medianHours: 7.2, of: 45, missingPickupStamp: 5 });
    expect(transitVerdict(stats({ medianTransitHours: null, missingPickupStamp: 12 })))
      .toEqual({ kind: 'not_measurable', missingPickupStamp: 12 });
  });

  it('counts days to the next weekly run on DATE boundaries, and says "on demand" when there is no weekday', () => {
    // Thursday (4) to Saturday (6) is two days; Saturday to Saturday is today, not seven days away.
    expect(daysUntilWeekday(4, 6)).toBe(2);
    expect(daysUntilWeekday(6, 6)).toBe(0);
    expect(daysUntilWeekday(6, 1)).toBe(2);
    expect(daysUntilWeekday(0, 6)).toBe(6);
    expect(daysUntilWeekday(3, null)).toBeNull();
    // Garbage in the column is not a run in six days' time.
    expect(daysUntilWeekday(3, 9)).toBeNull();
    expect(daysUntilWeekday(3, -1)).toBeNull();
  });

  it('offers only the windows the indexes and the partition pruning can serve', () => {
    expect(INSIGHT_WINDOWS).toEqual([30, 90, 180]);
    expect(DEFAULT_INSIGHT_WINDOW).toBe(90);
    expect(isInsightWindow(90)).toBe(true);
    expect(isInsightWindow(3650)).toBe(false);
    expect(isInsightWindow('90')).toBe(false);
  });

  it('has three history states, and the middle one is not an error', () => {
    expect(historyVerdict(null)).toEqual({ kind: 'no_data' });
    expect(historyVerdict(12)).toEqual({ kind: 'not_enough_history', days: 12, needDays: MIN_HISTORY_DAYS });
    expect(historyVerdict(30)).toEqual({ kind: 'ready', days: 30 });
    expect(MIN_HISTORY_DAYS).toBe(30);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · the failure chart this wave gave a source', () => {
  it('keeps unclassified attempts OUT of the bars and reports them separately', () => {
    // The reason a delivery failed was written to no column of this database before 0154, so every attempt recorded
    // before this wave is unclassified. Distributing them across the bars would let a call-ahead pilot be justified
    // by arithmetic nobody performed.
    const b = failureBreakdown([
      { reasonCode: 'gate_closed', events: 40 },
      { reasonCode: 'weather', events: 10 },
      { reasonCode: null, events: 68 },
    ]);
    expect(b.total).toBe(118);
    expect(b.unclassified).toBe(68);
    expect(b.slices.map((s) => s.code)).toEqual(['gate_closed', 'weather']);
    // Shares are of the CODED events (50), not of the 118 — otherwise every bar shrinks by however much history
    // predates the column, for a reason that has nothing to do with deliveries.
    expect(b.slices[0]).toEqual({ code: 'gate_closed', events: 40, shareBps: 8000 });
    expect(b.slices[1]).toEqual({ code: 'weather', events: 10, shareBps: 2000 });
    expect(b.mostlyUnclassified).toBe(true);
  });

  it('treats an empty-string code as unclassified, not as a bar named ""', () => {
    const b = failureBreakdown([{ reasonCode: '', events: 3 }]);
    expect(b.unclassified).toBe(3);
    expect(b.slices).toEqual([]);
  });

  it('sorts the bars by size, and breaks ties by code so the chart does not reshuffle between reads', () => {
    const b = failureBreakdown([
      { reasonCode: 'weather', events: 5 }, { reasonCode: 'address_problem', events: 5 }, { reasonCode: 'gate_closed', events: 9 },
    ]);
    expect(b.slices.map((s) => s.code)).toEqual(['gate_closed', 'address_problem', 'weather']);
  });

  it('merges duplicate rows for one code rather than drawing the bar twice', () => {
    const b = failureBreakdown([{ reasonCode: 'weather', events: 2 }, { reasonCode: 'weather', events: 3 }]);
    expect(b.slices).toEqual([{ code: 'weather', events: 5, shareBps: 10_000 }]);
  });

  it('is not "mostly unclassified" when the coded rows are the majority', () => {
    const b = failureBreakdown([{ reasonCode: 'gate_closed', events: 60 }, { reasonCode: null, events: 40 }]);
    expect(b.mostlyUnclassified).toBe(false);
  });

  it('offers the call-ahead pilot only when gate_closed leads the CODED reasons and history is not mostly blank', () => {
    const coded = failureBreakdown([{ reasonCode: 'gate_closed', events: 30 }, { reasonCode: 'weather', events: 10 }]);
    expect(callAheadCandidate(coded)).toBe(true);
    // Same top reason, but two thirds of the window predates the column: not a decision, a guess.
    const blank = failureBreakdown([{ reasonCode: 'gate_closed', events: 30 }, { reasonCode: null, events: 70 }]);
    expect(callAheadCandidate(blank)).toBe(false);
    // A different leader is a different pilot, and this sentence is specifically about calling ahead.
    const weather = failureBreakdown([{ reasonCode: 'weather', events: 30 }, { reasonCode: 'gate_closed', events: 10 }]);
    expect(callAheadCandidate(weather)).toBe(false);
    expect(callAheadCandidate(failureBreakdown([]))).toBe(false);
  });

  it('exports the unclassified label as a constant, so the API and the console cannot spell it differently', () => {
    expect(UNCLASSIFIED).toBe('unclassified');
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · the lanes, measured in what this platform has', () => {
  const rows: LaneRow[] = [
    { fromRegionId: 'r1', toRegionId: 'r2', fromName: 'Vanthali', toName: 'Rajkot', shipments: 31 },
    { fromRegionId: 'r1', toRegionId: 'r3', fromName: 'Vanthali', toName: 'Mendarda', shipments: 9 },
    { fromRegionId: 'r4', toRegionId: 'r2', fromName: 'Kodinar', toName: 'Rajkot', shipments: 60 },
  ];

  it('computes each lane\'s share of SHIPMENTS and says so, because qtl-km cannot be computed', () => {
    const s = laneShares(rows);
    expect(s.basis).toBe('shipments');
    expect(s.totalShipments).toBe(100);
    expect(s.lanes[0]).toMatchObject({ fromName: 'Kodinar', shipments: 60, shareBps: 6000 });
    expect(s.lanes.map((l) => l.shipments)).toEqual([60, 31, 9]);
  });

  it('does not divide by zero when there is no traffic at all', () => {
    expect(laneShares([])).toEqual({ lanes: [], totalShipments: 0, basis: 'shipments' });
    expect(laneShares([{ fromRegionId: 'a', toRegionId: 'b', fromName: null, toName: null, shipments: 0 }]).lanes[0].shareBps).toBe(0);
  });

  it('marks a fixed-run candidate only on BOTH share and absolute volume', () => {
    // 60% of five shipments is not a daily run, and twelve shipments that are 3% of the window are not either.
    expect(isLaneCandidate({ shareBps: 6000, shipments: 60 })).toBe(true);
    expect(isLaneCandidate({ shareBps: 6000, shipments: 3 })).toBe(false);
    expect(isLaneCandidate({ shareBps: 300, shipments: 300 })).toBe(false);
    // Exactly on both thresholds qualifies — the boundary is stated, not accidental.
    expect(isLaneCandidate({ shareBps: 2000, shipments: 12 })).toBe(true);
    expect(isLaneCandidate({ shareBps: 1999, shipments: 12 })).toBe(false);
    expect(isLaneCandidate({ shareBps: 2000, shipments: 11 })).toBe(false);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · what needs you today, and the philosophy block', () => {
  const pickup = (at: string, driver = false): AttentionItem =>
    (driver
      ? { kind: 'pickup_due', shipmentId: `s-${at}`, orderId: 'o1', at }
      : { kind: 'pickup_no_driver', shipmentId: `s-${at}`, orderId: 'o1', at, hasVehicle: true });
  const reefer = (breaches: number): AttentionItem =>
    ({ kind: 'cold_chain_live', shipmentId: 'sr', orderId: 'o2', lastTempC: '4.2', lastAt: '2026-08-19T10:00:00Z', breaches });
  const run: AttentionItem = { kind: 'village_run', routeId: 'rt', routeName: 'Saturday Run', dayKey: 'route.day.sat', daysAway: 5, consolidation: 'not_tracked' };

  it('puts a BREACHING reefer first, whatever the clocks say', () => {
    // The only thing on this screen that spoils while you read it.
    const out = orderAttention([run, pickup('2026-08-19T09:00:00Z'), reefer(3)]);
    expect(out[0].kind).toBe('cold_chain_live');
  });

  it('then the driverless pickup, then a healthy reefer, then the rest — and earlier clocks first inside a kind', () => {
    const out = orderAttention([run, pickup('2026-08-19T16:00:00Z'), pickup('2026-08-19T09:00:00Z'), reefer(0)]);
    expect(out.map((i) => i.kind)).toEqual(['pickup_no_driver', 'pickup_no_driver', 'cold_chain_live', 'village_run']);
    expect((out[0] as { at: string }).at).toBe('2026-08-19T09:00:00Z');
  });

  it('does not mutate the caller\'s list', () => {
    const items = [run, reefer(1)];
    orderAttention(items);
    expect(items[0].kind).toBe('village_run');
  });

  it('names every attention row with its own key', () => {
    for (const i of [pickup('x'), pickup('x', true), reefer(0), run]) {
      expect(attentionKey(i)).toBe(`logistics.attention.${i.kind}`);
    }
  });

  it('resolves W225\'s three ticks against the software, and never ticks the weighbridge', () => {
    // The canon prints three ✓. Here: the pickup OTP half is 5a's and flag-gated, the weighbridge does not exist
    // anywhere on this platform, and the Village Run has routes but no consolidation record.
    const on = mechanisms({ pickupOtpEnabled: true, routesActive: 2 });
    expect(on.map((m) => [m.key, m.state])).toEqual([
      ['otp_both_ends', 'on'], ['weighbridge', 'absent'], ['village_run', 'partial'],
    ]);
    const off = mechanisms({ pickupOtpEnabled: false, routesActive: 0 });
    expect(off.map((m) => [m.key, m.state])).toEqual([
      ['otp_both_ends', 'partial'], ['weighbridge', 'absent'], ['village_run', 'absent'],
    ]);
    // With the flag off the platform proves ONE end of a handover, and the detail says which.
    expect(off[0].detail).toBe('delivery_only');
    expect(on[2].detail).toBe('consolidation_not_tracked');
    expect(mechanismKey(off[0])).toBe('logistics.mech.otp_both_ends.partial');
  });

  it('never reports the weighbridge as anything but absent, whatever is switched on', () => {
    for (const otp of [true, false]) for (const routes of [0, 5]) {
      expect(mechanisms({ pickupOtpEnabled: otp, routesActive: routes })[1].state).toBe('absent');
    }
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · the SQL behind the desk', () => {
  it('bounds every windowed read by created_at, which is what prunes the partitions', async () => {
    const { repo, calls } = capturingReplica();
    await repo.statusCounts('t1', 90);
    await repo.failureReasons('t1', 90);
    await repo.deliveryStats('t1', 30);
    await repo.lanes('t1', 90, 10);
    for (const c of calls) {
      expect(c.sql).toContain('created_at >=');
      expect(c.sql).toContain('tenant_id=$1');
    }
  });

  it('reads the delivered window by delivered_at AND keeps a created_at bound wider than it', async () => {
    // A shipment delivered yesterday may have been created weeks ago, so the created_at bound is the window plus a
    // month — narrow enough to prune, wide enough not to drop a slow lane out of the numbers.
    const { repo, sqlOf } = capturingReplica();
    await repo.deliveryStats('t1', 30);
    const sql = sqlOf('percentile_cont')!.sql;
    expect(sql).toContain('delivered_at >=');
    expect(sql).toMatch(/\(\$2::int \+ 30\)/);
  });

  it('counts a first-attempt delivery as ZERO failed attempts, not "at most one"', async () => {
    // `delivery_attempts` counts FAILURES (5a). `<= 1` would count a shipment that failed once and turn a 60% rate
    // into 80% — the single most flattering off-by-one available on this screen.
    const { repo, sqlOf } = capturingReplica();
    await repo.deliveryStats('t1', 30);
    expect(sqlOf('percentile_cont')!.sql).toContain('coalesce(delivery_attempts,0) = 0');
  });

  it('groups failure events by the coded reason and keeps the NULL group', async () => {
    const { repo, sqlOf } = capturingReplica((sql) => (sql.includes('reason_code') ? [{ reason_code: null, events: 4 }] : []));
    const rows = await repo.failureReasons('t1', 90);
    expect(rows).toEqual([{ reasonCode: null, events: 4 }]);
    const sql = sqlOf('GROUP BY reason_code')!.sql;
    expect(sql).toContain("status='failed'");
    expect(sql).toContain('FROM shipment_events');
  });

  it('validates a failure reason against the vocabulary, allowing a TENANT\'S OWN added value', async () => {
    const { repo, sqlOf } = capturingReplica((sql) => (sql.includes('lookup_values') ? [{ '?column?': 1 }] : []));
    expect(await repo.isFailureReason('t1', 'ferry_missed')).toBe(true);
    const sql = sqlOf('lookup_values')!.sql;
    expect(sql).toContain("type_code='shipment_failure_reason'");
    // Platform values AND this tenant's own — Law 6, and the reason the vocabulary is tenant-extendable at all.
    expect(sql).toContain('(tenant_id IS NULL OR tenant_id = $1)');
    expect(sql).toContain('is_active = true');
  });

  it('counts today\'s pickups on the DATABASE\'s day boundary, and only ones still waiting', async () => {
    const { repo, sqlOf } = capturingReplica();
    await repo.pickupsToday('t1');
    const sql = sqlOf('scheduled_pickup_at >= date_trunc')!.sql;
    expect(sql).toContain("date_trunc('day', now())");
    expect(sql).toContain("status IN ('assigned','pickup_scheduled')");
  });

  it('reads the route STATUS, never the generated is_active column', async () => {
    // 5b proved a partial index on a generated column cannot be matched by the planner, and that reading the fact is
    // what fixed the plan.
    const { repo, calls } = capturingReplica();
    await repo.nextWeeklyRun('t1');
    await repo.activeRouteCount('t1');
    for (const c of calls) {
      expect(c.sql).toContain("status='active'");
      expect(c.sql).not.toContain('is_active');
    }
  });

  it('excludes shipments whose lane has an unknown end rather than inventing a phantom lane', async () => {
    const { repo, sqlOf } = capturingReplica();
    await repo.lanes('t1', 90, 10);
    const sql = sqlOf('FROM shipments s')!.sql;
    expect(sql).toContain('pa.region_id IS NOT NULL AND da.region_id IS NOT NULL');
  });

  it('clamps every caller-supplied limit, so a query string cannot ask for the whole table', async () => {
    const { repo, sqlOf } = capturingReplica();
    await repo.lanes('t1', 90, 10_000);
    expect(sqlOf('FROM shipments s')!.sql).toContain('LIMIT 50');
    const b = capturingReplica();
    await b.repo.pickupsDue('t1', 24, 0);
    expect(b.sqlOf('scheduled_pickup_at <=')!.sql).toContain('LIMIT 1');
  });

  it('reads a `date` column as the day PostgreSQL holds — the same trap 5c documented', async () => {
    // `String(v).slice(0,10)` on a JS Date yields "Wed Jul 01"; `toISOString()` is a day early behind UTC.
    const { repo } = capturingReplica((sql) => (sql.includes('from_day') ? [{ from_day: new Date(2026, 6, 1), to_day: new Date(2026, 6, 31) }] : []));
    expect(await repo.windowBounds('t1', 30)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · a write that matches no row (found LIVE)', () => {
  function repoWith(rowCount: number | null) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const tx = {
      tenantId: 't1',
      query: jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [], rowCount }; }),
    };
    const repo = new ShipmentRepository({ forTenant: () => ({ query: tx.query }) } as never);
    return { repo, tx, calls };
  }
  const ship = () => {
    const s = Shipment.rehydrate({
      id: 's1', tenantId: 't1', orderId: 'o1', partnerId: null, vehicleId: null, riderUserId: 'r1',
      status: 'out_for_delivery', awbNo: null, pickupAddressId: null, dropAddressId: null,
      scheduledPickupAt: null, scheduledWindowMins: null, pickedUpAt: new Date(), deliveredAt: null,
      pickupOtpHash: null, deliveryOtpHash: null, podMediaId: null, chargeMinor: null, codMinor: null,
      requiresColdChain: false, createdAt: new Date(), deliveryAttempts: 0,
    } as never);
    s.markFailed('gate closed', 'gate_closed');
    return s;
  };

  it('THROWS instead of recording an event the shipment row contradicts', async () => {
    // The live run found this: `update` matches on `created_at` (the partition key) and PostgreSQL keeps microseconds
    // where JS keeps milliseconds, so a row created by SQL now() can never be matched. The UPDATE affected nothing,
    // the method returned void, and the event row was written anyway — a trail saying "failed" over a shipment still
    // saying "out for delivery".
    const h = repoWith(0);
    await expect(h.repo.update(h.tx as never, ship(), 'out_for_delivery')).rejects.toMatchObject({ code: 'SHIPMENT_UPDATE_LOST', httpStatus: 409 });
    expect(h.calls.some((c) => c.sql.includes('INSERT INTO shipment_events'))).toBe(false);
  });

  it('accepts an update the driver cannot count, rather than failing on a null rowCount', async () => {
    // Only a DEFINITE zero is a lost update; `null` means the driver did not report a count, and treating that as a
    // failure would refuse every legitimate write on a driver that does not count rows.
    const h = repoWith(null);
    await expect(h.repo.update(h.tx as never, ship(), 'out_for_delivery')).resolves.toBeUndefined();
    expect(h.calls.some((c) => c.sql.includes('INSERT INTO shipment_events'))).toBe(true);
  });

  it('writes the reason and the code onto the event row it does record', async () => {
    const h = repoWith(1);
    await h.repo.update(h.tx as never, ship(), 'out_for_delivery');
    const ev = h.calls.find((c) => c.sql.includes('INSERT INTO shipment_events'))!;
    expect(ev.sql).toContain('reason_code');
    expect(ev.params).toEqual(['s1', 't1', 'failed', 'gate closed', 'gate_closed']);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · the read model composes the screens', () => {
  function harness(o: {
    byStatus?: Record<string, number>; due?: unknown[]; reefer?: unknown[]; stats?: DeliveryStats;
    run?: unknown; routes?: number; dow?: number; otpOn?: boolean | 'throws';
    failures?: unknown[]; lanes?: LaneRow[]; days?: number | null; recovered?: unknown[];
  } = {}) {
    const repo = {
      statusCounts: jest.fn(async () => o.byStatus ?? { assigned: 4, in_transit: 20, delivered: 100 }),
      pickupsToday: jest.fn(async () => 2),
      pickupsDue: jest.fn(async () => o.due ?? []),
      coldChainInTransit: jest.fn(async () => o.reefer ?? []),
      deliveryStats: jest.fn(async () => o.stats ?? stats()),
      nextWeeklyRun: jest.fn(async () => o.run ?? null),
      activeRouteCount: jest.fn(async () => o.routes ?? 1),
      todayDow: jest.fn(async () => o.dow ?? 4),
      failureReasons: jest.fn(async () => o.failures ?? []),
      failureReasonVocabulary: jest.fn(async () => [{ code: 'gate_closed', name: 'Gate closed', sortOrder: 1 }]),
      lanes: jest.fn(async () => o.lanes ?? []),
      historyDays: jest.fn(async () => (o.days === undefined ? 200 : o.days)),
      windowBounds: jest.fn(async () => ({ from: '2026-05-21', to: '2026-08-19' })),
    };
    // Typed two-arg so `mock.calls[0][1]` is the WINDOW BOUND — that argument is what the recovery-window test reads
    // (a zero-arg jest.fn() types its calls as an empty tuple, which is how 5a's suite lost an assertion).
    const freight = {
      recoveredSince: jest.fn(async (t: string, since: string) => { void t; void since; return o.recovered ?? []; }),
    };
    const flags = { isEnabled: jest.fn(async () => { if (o.otpOn === 'throws') throw new Error('flag store down'); return o.otpOn ?? true; }) };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    return { rm: new LogisticsDeskReadModel(repo as never, freight as never, flags as never, metrics as never), repo, freight, flags };
  }

  it('builds W225 from counted rows, with the refusals attached', async () => {
    const h = harness();
    const ov = await h.rm.overview('t1');
    expect(ov.activeShipments).toBe(24);      // 4 assigned + 20 in transit; the 100 delivered are not moving
    expect(ov.pickupsToday).toBe(2);
    expect(ov.onTime.kind).toBe('not_promised');
    expect(ov.transitLoss.kind).toBe('not_recorded');
    expect(ov.firstAttempt).toEqual({ kind: 'measured', bps: 9300, of: 100 });
    expect(ov.windowDays).toBe(30);
  });

  it('splits a driverless own-fleet pickup from a 3PL one, which carries its own driver', async () => {
    const h = harness({ due: [
      { id: 's1', orderId: 'o1', status: 'pickup_scheduled', scheduledPickupAt: '2026-08-19T16:00:00Z', hasVehicle: true, hasRider: false, hasPartner: false, requiresColdChain: false },
      { id: 's2', orderId: 'o2', status: 'pickup_scheduled', scheduledPickupAt: '2026-08-19T17:00:00Z', hasVehicle: false, hasRider: false, hasPartner: true, requiresColdChain: false },
    ] });
    const ov = await h.rm.overview('t1');
    expect(ov.attention.map((a) => a.kind)).toEqual(['pickup_no_driver', 'pickup_due']);
  });

  it('puts the Village Run on the desk with its day and WITHOUT a consolidation count', async () => {
    const h = harness({ run: { id: 'rt1', name: 'Saturday Run', runWeekday: 6, villages: 32 }, dow: 1 });
    const ov = await h.rm.overview('t1');
    const run = ov.attention.find((a) => a.kind === 'village_run') as { dayKey: string; daysAway: number; consolidation: string };
    expect(run.dayKey).toBe('route.day.sat');
    expect(run.daysAway).toBe(5);
    expect(run.consolidation).toBe('not_tracked');
    expect(ov.nextRun).toMatchObject({ routeId: 'rt1', villages: 32, daysAway: 5 });
  });

  it('fails CLOSED on the flag store: a safety mechanism is never claimed to be on when we cannot tell', async () => {
    const h = harness({ otpOn: 'throws' });
    const ov = await h.rm.overview('t1');
    expect(ov.mechanisms[0]).toMatchObject({ key: 'otp_both_ends', state: 'partial', detail: 'delivery_only' });
  });

  it('reads the flag PER TENANT', async () => {
    const h = harness();
    await h.rm.overview('t-abc');
    expect(h.flags.isEnabled).toHaveBeenCalledWith('logistics_pickup_otp', { tenantId: 't-abc' });
  });

  it('sums cold-chain breaches over the reefer rows and counts the live runs', async () => {
    const h = harness({ reefer: [
      { shipmentId: 's1', orderId: 'o1', lastTempC: '4.2', lastAt: '2026-08-19T10:00:00Z', breaches: 0 },
      { shipmentId: 's2', orderId: 'o2', lastTempC: '9.9', lastAt: '2026-08-19T11:00:00Z', breaches: 3 },
    ] });
    const ov = await h.rm.overview('t1');
    expect(ov.coldChain).toEqual({ breaches7d: 3, liveReeferShipments: 2 });
    // and the breaching one is first on the list
    expect(ov.attention[0]).toMatchObject({ kind: 'cold_chain_live', shipmentId: 's2' });
  });

  it('builds W244 with the window it was asked for, and asks 5c for the recovery in that same window', async () => {
    const h = harness({ recovered: [{ currencyCode: 'INR', recoveredMinor: '1184000' }] });
    const ins = await h.rm.insights('t1', 30);
    expect(ins.window).toBe(30);
    expect(h.repo.deliveryStats).toHaveBeenCalledWith('t1', 30);
    expect(h.repo.failureReasons).toHaveBeenCalledWith('t1', 30);
    expect(ins.freightRecovered).toEqual([{ currencyCode: 'INR', recoveredMinor: '1184000' }]);
    expect(ins.windowFrom).toBe('2026-05-21');
    // The recovery must cover the SAME window the screen names. A shorter one would print a smaller figure under a
    // "90 days" heading, which is the quietest way to make a desk wrong.
    const since = Date.parse(h.freight.recoveredSince.mock.calls[0][1] as string);
    const days = (Date.now() - since) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it('blocks the insights body on too little history rather than drawing bars over three days', async () => {
    const h = harness({ days: 9 });
    const ins = await h.rm.insights('t1', 90);
    expect(ins.history).toEqual({ kind: 'not_enough_history', days: 9, needDays: 30 });
  });

  it('marks lane candidates and carries the basis, never claiming qtl-km', async () => {
    const h = harness({ lanes: [
      { fromRegionId: 'r1', toRegionId: 'r2', fromName: 'Vanthali', toName: 'Rajkot', shipments: 40 },
      { fromRegionId: 'r3', toRegionId: 'r4', fromName: 'A', toName: 'B', shipments: 4 },
    ] });
    const ins = await h.rm.insights('t1', 90);
    expect(ins.lanes.basis).toBe('shipments');
    expect(ins.lanes.lanes[0].candidate).toBe(true);
    expect(ins.lanes.lanes[1].candidate).toBe(false);
    expect(ins.costPerQtlKm.kind).toBe('not_computable');
  });

  it('passes the vocabulary through so a tenant\'s own reason can be named on the screen', async () => {
    const h = harness({ failures: [{ reasonCode: 'gate_closed', events: 5 }] });
    const ins = await h.rm.insights('t1', 90);
    expect(ins.reasonNames).toEqual([{ code: 'gate_closed', name: 'Gate closed' }]);
    expect(ins.callAhead).toBe(true);
  });
});

/* ----------------------------------------------------------------------------------------------------------- */
describe('PC-56 TENANT-5d · recording WHY a delivery failed', () => {
  function harness(o: { codeKnown?: boolean } = {}) {
    const tx = { tenantId: 't1', query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
    const uow = { run: jest.fn(async (t: string, fn: (x: unknown) => Promise<unknown>) => { void t; return fn(tx); }) };
    const s = Shipment.rehydrate({
      id: 's1', tenantId: 't1', orderId: 'o1', partnerId: null, vehicleId: null, riderUserId: 'r1',
      status: 'out_for_delivery', awbNo: null, pickupAddressId: null, dropAddressId: null,
      scheduledPickupAt: null, scheduledWindowMins: null, pickedUpAt: new Date(), deliveredAt: null,
      pickupOtpHash: null, deliveryOtpHash: null, podMediaId: null, chargeMinor: null, codMinor: null,
      requiresColdChain: false, createdAt: new Date(), deliveryAttempts: 0,
    } as never);
    const repo = { getForUpdate: jest.fn(async () => s), update: jest.fn(async () => {}), recordEvent: jest.fn(async () => {}) };
    const orders = { transportStatus: jest.fn(async () => 'confirmed') };
    const flags = { isEnabled: jest.fn(async () => false) };
    const outbox = { write: jest.fn(async (a: unknown, b: unknown) => { void a; void b; }) };
    const audit = { write: jest.fn(async (a: unknown, b: unknown) => { void a; void b; }) };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    const idem = { remember: jest.fn(async (k: string, u: string, e: string, fn: () => Promise<unknown>) => { void k; void u; void e; return fn(); }) };
    const desk = { isFailureReason: jest.fn(async () => o.codeKnown ?? true) };
    const svc = new ShipmentService(uow as never, orders as never, flags as never, outbox as never, idem as never,
      metrics as never, audit as never, { auth: { hashPepper: 'p' } } as never, repo as never,
      { fitnessOf: jest.fn(async () => null) } as never, desk as never);
    return { svc, s, repo, audit, metrics, desk, outbox };
  }
  const rider = { userId: 'r1', canManage: false };

  it('refuses a code the vocabulary does not have, and writes nothing', async () => {
    // A typo that reaches this column becomes a permanent slice of W244's chart and a policy decision resting on a
    // word nobody defined.
    const h = harness({ codeKnown: false });
    await expect(h.svc.markFailed('t1', rider, 's1', { reason: 'gate was shut', reasonCode: 'gate_clsoed' } as never, null))
      .rejects.toMatchObject({ code: 'SHIPMENT_INVALID' });
    expect(h.repo.update).not.toHaveBeenCalled();
    expect(h.metrics.inc).toHaveBeenCalledWith('logistics.failure_reason_unknown', { code: 'gate_clsoed' });
  });

  it('accepts a failure with NO code — the attempt must be recorded either way', async () => {
    const h = harness({ codeKnown: false });
    await h.svc.markFailed('t1', rider, 's1', { reason: 'nobody at the gate' } as never, null);
    expect(h.desk.isFailureReason).not.toHaveBeenCalled();
    expect(h.repo.update).toHaveBeenCalled();
  });

  it('carries the code and the operator\'s words onto the event row, which was NULL before this wave', async () => {
    const h = harness();
    await h.svc.markFailed('t1', rider, 's1', { reason: '  gate closed, watchman said after 6  ', reasonCode: 'gate_closed' } as never, null);
    // The annotation the repository writes into `shipment_events` — the column that made W244's chart possible.
    expect(h.s.pendingEventAnnotation()).toEqual({ note: 'gate closed, watchman said after 6', reasonCode: 'gate_closed' });
  });

  it('counts the attempt and puts the code on the outbox event too', async () => {
    const h = harness();
    await h.svc.markFailed('t1', rider, 's1', { reason: 'gate closed again', reasonCode: 'gate_closed' } as never, null);
    const ev = h.outbox.write.mock.calls[0][1] as { payload: { reasonCode: string; attemptNo: number } };
    expect(ev.payload).toMatchObject({ reasonCode: 'gate_closed', attemptNo: 1 });
  });

  it('clears the annotation on the NEXT transition, so a later hop cannot inherit these words', async () => {
    const h = harness();
    await h.svc.markFailed('t1', rider, 's1', { reason: 'gate closed again', reasonCode: 'gate_closed' } as never, null);
    h.s.markReturned();
    expect(h.s.pendingEventAnnotation()).toEqual({ note: null, reasonCode: null });
  });
});
