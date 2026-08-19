// PC-56 TENANT-5a · the shipment — the money gate W226 printed and nothing enforced, the pickup OTP that
// closed W225's "both directions", and the first tenant-side read of a table with two writers and no reader.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHmac } from 'node:crypto';
import {
  DEAD_ORDER_STATUSES, FREE_REATTEMPTS, MONEY_GATED_ACTIONS, PRE_MONEY_ORDER_STATUSES, SHIPMENT_TABS,
  failureOutcome, isMoneyGated, isShipmentTab, nextMilestone, pickupOtpRequired, possessionProof,
  statusesForTab, transportVerdict,
} from '../domain/shipment-readiness';
import {
  DEFAULT_WINDOW_DAYS, GPS_GAP_SECONDS, HOT_WINDOW_DAYS, LEAD_PRECISION_DP, MEMBER_PRECISION_DP,
  etaVerdict, isGpsGap, lastKnownPoint, milestoneProgress, precisionFor, resolveWindow, roundCoord,
} from '../domain/shipment-event-explorer';
import { Shipment } from '../domain/shipment.entity';
import { SHIPMENT_STATUSES } from '../domain/shipment.state';
import { ORDER_STATUSES } from '../../orders/domain/order.state';
import { ShipmentService } from '../services/shipment.service';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { OrderRepository } from '../../orders/repositories/order.repository';
import { OrderService } from '../../orders/services/order.service';

const strip = (s: string) => s.replace(/^\s*\/\/.*$/gm, '');
const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const raw = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const REPO = path.join(__dirname, '../../../../../..');
const migration = () => fs.readFileSync(path.join(REPO, 'db/migrations/0151_shipment_possession_and_trail.sql'), 'utf8');

const ship = (over: Partial<Parameters<typeof Shipment.rehydrate>[0]> = {}) => Shipment.rehydrate({
  id: 's1', tenantId: 't1', orderId: 'o1', partnerId: null, vehicleId: null, riderUserId: null,
  status: 'assigned', awbNo: null, pickupAddressId: null, dropAddressId: null,
  scheduledPickupAt: null, scheduledWindowMins: null, pickedUpAt: null, deliveredAt: null,
  pickupOtpHash: null, deliveryOtpHash: null, podMediaId: null,
  chargeMinor: 34000n, codMinor: null, requiresColdChain: false, createdAt: new Date('2026-08-18T06:00:00Z'),
  deliveryAttempts: 0, ...over,
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · the wheels may not turn before the money clears', () => {
  it('refuses exactly the two order states that mean "no money yet"', () => {
    // W226, under its own table: "A shipment for a `payment_pending` order stays `pending` — wheels never
    // turn before money clears (the cumin row shows exactly this)."
    expect([...PRE_MONEY_ORDER_STATUSES].sort()).toEqual(['created', 'payment_pending']);
    expect(transportVerdict('payment_pending')).toEqual({ kind: 'awaiting_payment', orderStatus: 'payment_pending' });
    expect(transportVerdict('created')).toEqual({ kind: 'awaiting_payment', orderStatus: 'created' });
    expect(transportVerdict('confirmed')).toEqual({ kind: 'may_move' });
  });

  it('is an ALLOW-list of the pre-money states, not a deny-list of the good ones', () => {
    // A new order status added later must default to ALLOWING transport. The alternative — listing the
    // permitted states — freezes every shipment on the platform the day somebody adds a status, which is a
    // failure mode nobody would connect to an order-machine change.
    for (const s of ORDER_STATUSES) {
      const v = transportVerdict(s);
      const expected = PRE_MONEY_ORDER_STATUSES.includes(s) ? 'awaiting_payment'
        : DEAD_ORDER_STATUSES.includes(s) ? 'order_closed' : 'may_move';
      expect({ status: s, kind: v.kind }).toEqual({ status: s, kind: expected });
    }
  });

  it('distinguishes "not yet" from "no longer" — they send an operator to different places', () => {
    // "awaiting_payment" means go and chase the buyer. "order_closed" means cancel the transport. A console
    // that collapses them sends somebody to chase a payment that will never come.
    expect(transportVerdict('cancelled')).toEqual({ kind: 'order_closed', orderStatus: 'cancelled' });
    expect(transportVerdict('refunded')).toEqual({ kind: 'order_closed', orderStatus: 'refunded' });
  });

  it('REFUSES an unreadable order rather than assuming it is fine', () => {
    // The one verdict that must not default to may_move. An unreadable order is exactly the case a caller
    // would like to wave through, and that is how a gate becomes decorative. Law 12's "degrade never die"
    // means show less on a READ; on a write that moves somebody's goods it means refuse.
    expect(transportVerdict(null)).toEqual({ kind: 'unknown_order' });
    expect(transportVerdict(undefined)).toEqual({ kind: 'unknown_order' });
    expect(transportVerdict('')).toEqual({ kind: 'unknown_order' });
  });

  it('gates the three actions that COMMIT somebody — and deliberately not create', () => {
    expect([...MONEY_GATED_ACTIONS].sort()).toEqual(['assign', 'picked_up', 'schedule_pickup']);
    for (const a of MONEY_GATED_ACTIONS) expect(isMoneyGated(a)).toBe(true);
    // A `pending` shipment for an unpaid order is legitimate — it is what W226's cumin row IS. Refusing to
    // create it would blind the desk to work that is coming and the operator would plan the run half-sighted.
    expect(isMoneyGated('create')).toBe(false);
    expect(isMoneyGated('cancel')).toBe(false);
    // Cancelling an unpaid shipment must stay possible: that is the remedy for a closed order.
  });

  it('is enforced at the ONE choke point every transition passes through', () => {
    const src = read('services', 'shipment.service.ts');
    expect(src).toContain('if (isMoneyGated(action))');
    expect(src).toContain('await this.orders.transportStatus(tx, tenantId, s.orderId)');
    expect(src).toContain('throw new OrderNotReadyForTransportError');
    // Read INSIDE the shipment's own transaction, or an order cancelled a millisecond later still gets a
    // driver. Scoped to `mutate`'s own body — the file has several methods that load and write a shipment,
    // and an assertion against the whole file would pass on the wrong one.
    const body = src.slice(src.indexOf('private async mutate('));
    const gate = body.indexOf('isMoneyGated(action)');
    expect(gate).toBeGreaterThan(body.indexOf('getForUpdate(tx, tenantId, id)'));
    expect(gate).toBeLessThan(body.indexOf('await this.repo.update(tx, s, from)'));
    // Another module's PUBLIC SERVICE, never its repositories (module blueprint).
    expect(src).toContain("from '../../orders/services/order.service'");
    expect(src).not.toContain('orders/repositories');
  });

  it('asks the orders module a question about the ORDER, not about the viewer', () => {
    const repo = read('../orders/repositories', 'order.repository.ts');
    expect(repo).toContain('async statusOf(');
    // `getVisible` filters by who is looking — the right question for a screen, the wrong one for a gate. A
    // shipment write must not depend on whether the dispatcher happens to be a party to the sale.
    const statusOf = repo.slice(repo.indexOf('async statusOf('), repo.indexOf('async getVisible('));
    expect(statusOf).toContain('SELECT status FROM orders WHERE id=$1 AND tenant_id=$2');
    expect(statusOf).not.toContain('viewerUserId');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · possession changes hands with proof, BOTH directions', () => {
  it('issues the pickup OTP at SCHEDULE time, not at pickup time', () => {
    // The code has to reach the seller before the driver arrives. A code generated at the gate would be read
    // out BY the driver TO the person meant to be checking it, which proves nothing at all. This mirrors
    // markOutForDelivery, which has always issued the delivery code before the rider reaches the door.
    const s = ship({ status: 'assigned' });
    s.schedulePickup(new Date('2026-08-18T16:00:00Z'), 30, 'HASH-PICKUP');
    expect(s.toProps().pickupOtpHash).toBe('HASH-PICKUP');
    expect(s.toProps().status).toBe('pickup_scheduled');
    const e = s.pullEvents().find((x) => x.payload.pickupOtpIssued !== undefined);
    expect(e?.payload.pickupOtpIssued).toBe(true);
  });

  it('verifies it at pickup, and refuses a wrong code', () => {
    const s = ship({ status: 'pickup_scheduled', pickupOtpHash: 'HASH-PICKUP' });
    expect(() => s.markPickedUp('WRONG')).toThrow();
    expect(() => s.markPickedUp(null)).toThrow();
    expect(s.toProps().status).toBe('pickup_scheduled');   // refused, not half-applied
    s.markPickedUp('HASH-PICKUP');
    expect(s.toProps().status).toBe('picked_up');
    expect(s.toProps().pickedUpAt).toBeInstanceOf(Date);
  });

  it('lets a shipment with NO issued code through — and does not then claim the proof', () => {
    // Every shipment created before 0151 has a null pickup_otp_hash, and a collection from the tenant's own
    // yard has nobody to hand over. Refusing them would strand every consignment in flight on deploy day.
    // What the platform must never do is claim proof it does not hold.
    const s = ship({ status: 'pickup_scheduled' });
    s.markPickedUp(null);
    expect(s.toProps().status).toBe('picked_up');
    expect(possessionProof({ pickupOtpHash: null, deliveryOtpHash: 'D' })).toBe('delivery_only');
  });

  it('renders W225\'s tick ONLY for a shipment holding both codes', () => {
    expect(possessionProof({ pickupOtpHash: 'P', deliveryOtpHash: 'D' })).toBe('both_ends');
    expect(possessionProof({ pickupOtpHash: 'P', deliveryOtpHash: null })).toBe('pickup_only');
    expect(possessionProof({ pickupOtpHash: null, deliveryOtpHash: null })).toBe('neither');
  });

  it('needs no code where there is nobody to hand over', () => {
    expect(pickupOtpRequired({ fromOwnPremises: false })).toBe(true);
    expect(pickupOtpRequired({ fromOwnPremises: true })).toBe(false);
  });

  it('compares both codes in CONSTANT TIME, through one shared comparator', () => {
    const src = read('domain', 'shipment.entity.ts');
    expect(src).toContain('timingSafeEqual');
    // One comparator for both sides, so the pickup half cannot drift into a `===` the delivery half spent a
    // wave getting right.
    expect(src).toContain('private static hashEq(');
    // ONE call site, not one mention: the import line matches the identifier too, and counting mentions
    // would pass on a file that imported it once and compared with === twice.
    expect((src.match(/timingSafeEqual\(/g) ?? []).length).toBe(1);
  });

  it('NEVER serialises either hash — W227: "OTP values never display here"', () => {
    const src = read('services', 'shipment.service.ts');
    const ser = src.slice(src.indexOf('private serialize('));
    expect(ser).toContain('pickupOtpIssued: p.pickupOtpHash != null');
    // The hashes may be READ inside the block — `possessionProof(...)` needs them and `requiresOtp` is a
    // null check — but no hash may become a FIELD of the response. So the two legitimate readings are
    // removed and nothing carrying a hash may remain.
    const remaining = ser
      .replace(/possessionProof\(\{[^}]*\}\)/g, '')
      .replace(/p\.(pickup|delivery)OtpHash != null/g, '');
    expect(remaining).not.toContain('OtpHash');
    // …and the response contract itself carries no hash field.
    const types = fs.readFileSync(path.join(REPO, 'packages/sdk-js/src/types.ts'), 'utf8');
    const iface = types.slice(types.indexOf('export interface Shipment {'), types.indexOf('export interface Shipment {') + 400);
    expect(iface).not.toContain('OtpHash');
  });

  it('PERSISTS the pickup hash — the update statement did not write it', () => {
    // Even if something HAD issued a pickup code, the very next update dropped it: `UPDATE shipments SET …`
    // wrote every other mutable field and not this one. Two independent reasons the same promise could never
    // have held, and this is the second.
    const repo = read('repositories', 'shipment.repository.ts');
    const upd = repo.slice(repo.indexOf('UPDATE shipments SET'));
    expect(upd).toContain('pickup_otp_hash=');
    expect(upd).toContain('delivery_attempts=');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · a failure without a next step cannot exist', () => {
  it('counts the attempt, so "one free re-attempt" is a number', () => {
    const s = ship({ status: 'out_for_delivery' });
    s.markFailed('gate closed');
    expect(s.toProps().deliveryAttempts).toBe(1);
    const e = s.pullEvents().find((x) => x.payload.attemptNo !== undefined);
    expect(e?.payload).toMatchObject({ reason: 'gate closed', attemptNo: 1 });
  });

  it('gives exactly ONE free re-attempt, then returns the goods', () => {
    expect(FREE_REATTEMPTS).toBe(1);
    expect(failureOutcome(0)).toEqual({ kind: 'reattempt', attemptNo: 1 });
    expect(failureOutcome(1)).toEqual({ kind: 'return', attemptNo: 2 });
    expect(failureOutcome(7)).toEqual({ kind: 'return', attemptNo: 8 });
    // A negative or fractional count is a corrupt read, not a licence for extra runs.
    expect(failureOutcome(-3)).toEqual({ kind: 'reattempt', attemptNo: 1 });
    expect(failureOutcome(0.9)).toEqual({ kind: 'reattempt', attemptNo: 1 });
  });

  it('does NOT book the re-attempt — the WHEN is a slot decision', () => {
    // Inventing a time here would be a domain function deciding a driver's afternoon. The console shows the
    // outcome and the operator books the slot.
    const src = read('services', 'shipment.service.ts');
    const failed = src.slice(src.indexOf('async markFailed('), src.indexOf('async markFailed(') + 900);
    expect(failed).toContain('nextStep: failureOutcome(out.deliveryAttempts - 1)');
    expect(failed).not.toContain('schedulePickup');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · what the list may claim (W226)', () => {
  it('has the canon\'s four tabs and no invented fifth', () => {
    expect([...SHIPMENT_TABS]).toEqual(['active', 'pending', 'delivered', 'failed']);
    expect(isShipmentTab('active')).toBe(true);
    expect(isShipmentTab('all')).toBe(false);
  });

  it('covers every live status across the tabs, and never twice', () => {
    const seen = SHIPMENT_TABS.flatMap((t) => [...statusesForTab(t)]);
    expect(new Set(seen).size).toBe(seen.length);
    // `cancelled` belongs to no tab on purpose — a cancelled shipment is not work. Everything else is
    // reachable, so no live shipment can fall between the tabs and become invisible to the desk.
    const uncovered = SHIPMENT_STATUSES.filter((s) => !seen.includes(s));
    expect(uncovered).toEqual(['cancelled']);
  });

  it('excludes `pending` from "active" — it has its own tab and its own meaning', () => {
    expect(statusesForTab('active')).not.toContain('pending');
    expect(statusesForTab('failed')).toEqual(['failed', 'returned']);
  });

  it('derives the next milestone instead of storing one', () => {
    expect(nextMilestone('pending')).toBe('assign_driver');
    expect(nextMilestone('assigned')).toBe('schedule_pickup');
    expect(nextMilestone('pickup_scheduled')).toBe('pickup');
    expect(nextMilestone('out_for_delivery')).toBe('deliver');
    // A failure's next step is the re-attempt — W236: "a failure without a next step cannot exist".
    expect(nextMilestone('failed')).toBe('deliver');
    // A finished shipment has NO next step. A stored one would be a status recording an act nobody performed.
    for (const s of ['delivered', 'returned', 'cancelled'] as const) expect(nextMilestone(s)).toBeNull();
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · the trail nobody could read', () => {
  it('is the FIRST read of shipment_events in its own module', () => {
    const repo = read('repositories', 'shipment.repository.ts');
    expect(repo).toContain('async trailFor(');
    expect(repo).toContain('async explore(');
    // Both writers are still there — this wave adds readers, it does not move the writes.
    expect(repo).toContain('INSERT INTO shipment_events');
  });

  it('bounds the window, defaults to today, and never offers "all time"', () => {
    const now = new Date('2026-08-18T09:00:00Z');
    expect(DEFAULT_WINDOW_DAYS).toBe(1);
    expect(resolveWindow({}, now)).toEqual({ from: '2026-08-18', to: '2026-08-18', clamped: false });
    expect(resolveWindow({ from: 'garbage' }, now)).toEqual({ from: '2026-08-18', to: '2026-08-18', clamped: false });
    expect(resolveWindow({ from: '2026-08-01', to: '2026-08-10' }, now)).toEqual({ from: '2026-08-01', to: '2026-08-10', clamped: false });
  });

  it('REPORTS the clamp at the 90-day hot horizon instead of quietly returning less', () => {
    // An operator who asked for six months and got ninety days must be told, or the empty stretch reads as
    // "nothing happened" rather than "you did not ask for that".
    const now = new Date('2026-08-18T09:00:00Z');
    const w = resolveWindow({ from: '2026-01-01', to: '2026-08-18' }, now);
    expect(w.clamped).toBe(true);
    expect(w.from).toBe('2026-05-21');   // 90 days inclusive
    expect(HOT_WINDOW_DAYS).toBe(90);
  });

  it('collapses an inverted range to a day instead of querying nothing', () => {
    const now = new Date('2026-08-18T09:00:00Z');
    expect(resolveWindow({ from: '2026-08-17', to: '2026-08-10' }, now)).toEqual({ from: '2026-08-10', to: '2026-08-10', clamped: false });
    // A future `to` is not a window into the future — it clamps to today.
    expect(resolveWindow({ to: '2099-01-01' }, now).to).toBe('2026-08-18');
  });

  it('draws a GAP, never a teleport', () => {
    // Breadcrumbs arrive every 90s, so three missed pings is a gap and one late ping is traffic.
    expect(GPS_GAP_SECONDS).toBe(270);
    const p = (at: string, lat: number | null = 22.0) => ({ at, lat, lng: lat === null ? null : 70.0, status: 'in_transit', note: null });
    expect(isGpsGap(undefined, p('2026-08-18T10:00:00Z'))).toBe(false);   // nothing before it to disconnect from
    expect(isGpsGap(p('2026-08-18T10:00:00Z'), p('2026-08-18T10:02:00Z'))).toBe(false);
    expect(isGpsGap(p('2026-08-18T10:00:00Z'), p('2026-08-18T10:10:00Z'))).toBe(true);
    // A point with no coordinates cannot continue a line either.
    expect(isGpsGap(p('2026-08-18T10:00:00Z', null), p('2026-08-18T10:01:00Z'))).toBe(true);
  });

  it('rounds coordinates BY ROLE, in the domain, not in a template', () => {
    // W236: "GPS coordinates round to ~100m for non-lead roles." A full-precision coordinate that reaches a
    // serializer has already left the building; "the UI rounds it" is not a privacy control.
    expect(precisionFor(true)).toBe(LEAD_PRECISION_DP);
    expect(precisionFor(false)).toBe(MEMBER_PRECISION_DP);
    expect(roundCoord(22.043791, 3)).toBe(22.044);
    expect(roundCoord(22.043791, 6)).toBe(22.043791);
    expect(roundCoord(null, 3)).toBeNull();
    const svc = read('services', 'shipment.service.ts');
    expect(svc).toContain('const dp = precisionFor(actor.canManage)');
    expect(svc).toContain('roundCoord(e.lat, dp)');
  });

  it('shows MILESTONE progress, never kilometres, and never an ETA', () => {
    // W235 prints "72% of route · 38 km remaining" and "ETA 17:30". The platform stores hops and breadcrumbs
    // — no route geometry, no routing engine, no traffic feed — and the buyer-side type already carries the
    // earlier ruling: "No ETA field exists (the app shows ETA as '—' rather than fabricating one)."
    expect(etaVerdict()).toEqual({ kind: 'no_eta_source' });
    expect(milestoneProgress('picked_up')).toEqual({ step: 4, of: 8 });
    expect(milestoneProgress('delivered')).toEqual({ step: 8, of: 8 });
    // Off the line entirely: a bar would imply an arrival that is not coming.
    for (const s of ['failed', 'returned', 'cancelled'] as const) expect(milestoneProgress(s)).toBeNull();
  });

  it('places the shipment only where a located event actually puts it', () => {
    const pt = (at: string, lat: number | null) => ({ at, lat, lng: lat === null ? null : 70.1, status: 'in_transit', note: null });
    expect(lastKnownPoint([pt('a', 1), pt('b', null)])?.at).toBe('a');
    // Nothing located: the screen says so rather than centring a map on a default that reads as a position.
    expect(lastKnownPoint([pt('a', null)])).toBeNull();
    expect(lastKnownPoint([])).toBeNull();
  });

  it('pages the explorer on a keyset and prunes by the window', () => {
    const repo = read('repositories', 'shipment.repository.ts');
    const ex = repo.slice(repo.indexOf('async explore('));
    expect(ex).toContain('ORDER BY created_at DESC, id DESC');
    expect(ex).not.toContain('OFFSET');
    expect(ex).toContain('created_at >= $2::date');
    // The filters run in SQL. A filter applied after the read returns four rows out of twenty-five and calls
    // it "4 of 312".
    expect(ex).toContain("status='failed'");
    expect(ex).toContain('door-open');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · 0151, and what it refuses to invent', () => {
  it('adds the attempt counter and the explorer index', () => {
    const sql = migration().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS delivery_attempts smallint NOT NULL DEFAULT 0');
    expect(sql).toContain('CHECK (delivery_attempts >= 0)');
    // shipment_events had ONE index — (shipment_id, created_at), the per-shipment trail — because nothing in
    // the module read the table at all. W236 asks the opposite question.
    expect(sql).toContain('idx_shipment_events_tenant_time');
    expect(sql).toContain('ON shipment_events (tenant_id, created_at DESC, id DESC)');
  });

  it('ships both flags OFF, and separately', () => {
    const sql = migration();
    for (const f of ['logistics_pickup_otp', 'logistics_event_explorer']) expect(sql).toContain(`'${f}'`);
    // Separate because they fail differently: turning the explorer off costs a screen; turning possession off
    // returns the platform to proving one end of a handover.
    expect(migration().match(/INSERT INTO feature_flags/g)?.length).toBe(2);
  });

  it('names the weighbridge as missing instead of drawing it', () => {
    // W225 stakes a tick on it and W227 stakes its whole dispute-prevention story on slip #1 vs slip #2.
    // There is no weighbridge anywhere in apps/api or db.
    expect(migration()).toContain('NO WEIGHBRIDGE');
    const hits = fs.readdirSync(path.join(REPO, 'db/migrations')).filter((f) =>
      fs.readFileSync(path.join(REPO, 'db/migrations', f), 'utf8').match(/CREATE TABLE [a-z_]*weighbridge/));
    expect(hits).toEqual([]);
  });

  it('records the pickup OTP column\'s history where the next reader will look', () => {
    const sql = migration();
    expect(sql).toContain("COMMENT ON COLUMN shipments.pickup_otp_hash");
    expect(sql).toContain('existed unwritten from 0007 to 0151');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · the SDK could not reach the dispatcher\'s three actions', () => {
  it('now exposes assign, schedulePickup and cancel', () => {
    // All three have existed on the API since the module was built and had NO SDK METHOD, so no screen could
    // call them — which is why W227's console is a page of buttons that lead nowhere. Same shape of gap
    // TENANT-4d-3 found on the tenant profile plane.
    const sdk = fs.readFileSync(path.join(REPO, 'packages/sdk-js/src/resources/logistics.ts'), 'utf8');
    for (const m of ['async assign(', 'async schedulePickup(', 'async cancel(', 'async trail(', 'async events(']) {
      expect({ method: m, present: sdk.includes(m) }).toEqual({ method: m, present: true });
    }
    // And the pickup OTP reaches the endpoint.
    expect(sdk).toContain('async markPickedUp(id: string, otp?: string)');
    const api = read('controllers', 'v1', 'shipments.controller.ts');
    for (const r of ["':id/assign'", "':id/schedule-pickup'", "':id/cancel'", "':id/trail'", "'events'"]) {
      expect({ route: r, present: api.includes(r) }).toEqual({ route: r, present: true });
    }
  });

  it('gates the two new read surfaces on their own flag', () => {
    const api = raw('controllers', 'v1', 'shipments.controller.ts');
    expect(api).toContain("@FeatureFlag('logistics_event_explorer')");
    // OFF leaves both screens saying the trail is not enabled — a different sentence from "nothing happened".
    expect((api.match(/logistics_event_explorer/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
/* THE SERVICE, WIRED TO FAKES — the gate and the codes as BEHAVIOUR, not as source text.                     */
/*                                                                                                            */
/* Mutation testing found the hole this block fills: seventeen plausible-wrong decisions survived a suite that */
/* asserted the gate's SHAPE (that the check sits before `apply`, that it names the verdict) without ever      */
/* running it. "Source-text assertions do not hold behaviour" is on this programme's own defect list, and it   */
/* had reappeared here. Every test below drives the real service through fakes whose calls are observable.     */
/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · the gate, run rather than read', () => {
  const PEPPER = 'test-pepper';
  const hash = (code: string) => createHmac('sha256', PEPPER).update(code).digest('hex');

  function harness(opts: { status?: 'pending' | 'assigned' | 'picked_up' | 'pickup_scheduled'; orderStatus?: string | null; orderThrows?: boolean; flag?: boolean | 'throws'; trail?: Array<{ at: Date; status: string; lat: number | null; lng: number | null; note: string | null }> } = {}) {
    const s = ship({ status: opts.status ?? 'assigned' });
    const tx = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })), tenantId: 't1' };
    const uow = { run: jest.fn(async (t: string, fn: (x: typeof tx) => Promise<unknown>) => { void t; return fn(tx); }) };
    const orders = { transportStatus: jest.fn(async () => {
      if (opts.orderThrows) throw new Error('replica down');
      return opts.orderStatus === undefined ? 'confirmed' : opts.orderStatus;
    }) };
    const flags = { isEnabled: jest.fn(async () => {
      if (opts.flag === 'throws') throw new Error('flag store down');
      return opts.flag ?? true;
    }) };
    // Typed two-arg fakes so `mock.calls[n][1]` is the EVENT — the payloads are what these tests read.
    const outbox = { write: jest.fn(async (t: unknown, e: unknown) => { void t; void e; }) };
    const audit = { write: jest.fn(async (t: unknown, e: unknown) => { void t; void e; }) };
    const metrics = { inc: jest.fn(), observe: jest.fn() };
    const idem = { remember: jest.fn(async (k: string, u: string, e: string, fn: () => Promise<unknown>) => { void k; void u; void e; return fn(); }) };
    const repo = {
      getForUpdate: jest.fn(async () => s), getById: jest.fn(async () => s),
      update: jest.fn(async () => true), insert: jest.fn(async () => {}), existsForOrder: jest.fn(async () => false),
      trailFor: jest.fn(async () => opts.trail ?? []),
      explore: jest.fn(async (t: string, q: unknown) => { void t; void q; return [] as Array<{ id: string; at: Date; shipmentId: string; status: string; lat: number | null; lng: number | null; note: string | null }>; }),
    };
    // PC-56 TENANT-5b added the fleet-fitness read (the vehicle a dispatcher is assigning). These tests do not
    // assign a vehicle, so the fake answers "no such vehicle" — and the gate is flag-gated OFF here anyway,
    // which is what makes this wave's own tests still describe 5a's behaviour rather than 5b's.
    const vehicleRepo = { fitnessOf: jest.fn(async () => null) };
    // PC-56 TENANT-5d added the failure-reason vocabulary read on the WRITE path. These tests fail shipments with a
    // free-text reason and no code (the pre-5d call shape), so the fake answers "no such code" — which is never
    // consulted unless a code is supplied, and that is exactly what the 5d suite proves.
    const deskRepo = { isFailureReason: jest.fn(async () => false) };
    const svc = new ShipmentService(uow as never, orders as never, flags as never, outbox as never, idem as never,
      metrics as never, audit as never, { auth: { hashPepper: PEPPER } } as never, repo as never, vehicleRepo as never,
      deskRepo as never);
    return { svc, s, repo, outbox, audit, metrics, orders, flags };
  }
  const boss = { userId: 'ops-1', canManage: true };
  const member = { userId: 'staff-2', canManage: false };
  const otpOf = (outbox: { write: jest.Mock }, type: string) =>
    (outbox.write.mock.calls.find((c) => (c[1] as { eventType: string }).eventType === type)?.[1] as { payload: { otp: string } } | undefined)?.payload.otp;

  it('refuses to assign a driver to a shipment whose order was cancelled', async () => {
    const h = harness({ orderStatus: 'cancelled' });
    await expect(h.svc.assign('t1', boss, 's1', { riderUserId: 'r1' } as never, null))
      .rejects.toMatchObject({ code: 'SHIPMENT_ORDER_NOT_READY', details: { reason: 'order_closed', orderStatus: 'cancelled' } });
    // And nothing was written: the refusal happens BEFORE the transition, in the same transaction that read
    // the order, so an order cancelled a millisecond later cannot still get a driver.
    expect(h.repo.update).not.toHaveBeenCalled();
    expect(h.metrics.inc).toHaveBeenCalledWith('logistics.transport_refused', { reason: 'order_closed' });
  });

  it('refuses an unpaid order, and refuses an UNREADABLE one just as hard', async () => {
    const unpaid = harness({ orderStatus: 'payment_pending' });
    await expect(unpaid.svc.markPickedUp('t1', boss, 's1', null, null))
      .rejects.toMatchObject({ details: { reason: 'awaiting_payment' } });
    const missing = harness({ orderStatus: null });
    await expect(missing.svc.assign('t1', boss, 's1', { riderUserId: 'r1' } as never, null))
      .rejects.toMatchObject({ details: { reason: 'unknown_order', orderStatus: null } });
    expect(missing.repo.update).not.toHaveBeenCalled();
  });

  it('fails CLOSED when the order cannot be read at all — a write that moves goods never degrades to yes', async () => {
    // Law 12 is "degrade, never die": for a READ that means show less, and for a write that commits a
    // farmer's morning it means refuse. A `.catch(() => "confirmed")` here would be the plausible-wrong
    // decision, and it must not pass.
    const h = harness({ status: 'pending', orderThrows: true });
    await expect(h.svc.assign('t1', boss, 's1', { riderUserId: 'r1' } as never, null)).rejects.toThrow(/replica down/);
    expect(h.repo.update).not.toHaveBeenCalled();
  });

  it('lets a paid order through', async () => {
    const h = harness({ status: 'pending', orderStatus: 'confirmed' });
    const out = await h.svc.assign('t1', boss, 's1', { riderUserId: 'r1' } as never, null);
    expect(out.status).toBe('assigned');
    expect(h.repo.update).toHaveBeenCalled();
    expect(h.metrics.inc).not.toHaveBeenCalledWith('logistics.transport_refused', expect.anything());
  });

  it('stores the pickup code as an HMAC and puts the RAW code only on the relay event', async () => {
    const h = harness();
    await h.svc.schedulePickup('t1', boss, 's1', { scheduledPickupAt: '2026-08-20T05:30:00.000Z', windowMins: 30 } as never, null);
    const code = otpOf(h.outbox, 'logistics.pickup_otp_issued');
    expect(code).toMatch(/^\d{6}$/);
    // The stored value is the hash of that code — not the code, and not something else's hash.
    expect(h.s.toProps().pickupOtpHash).toBe(hash(code!));
    expect(h.s.toProps().pickupOtpHash).not.toBe(code);
    // …and the pickup then verifies against it: the wrong code is refused, the right one passes.
    const armed = h.s;
    expect(() => armed.markPickedUp(hash('000000') === hash(code!) ? 'x' : hash('999999'))).toThrow(/SHIPMENT_INVALID_PICKUP_OTP|pickup/i);
    armed.markPickedUp(hash(code!));
    expect(armed.status).toBe('picked_up');
  });

  it('reads the pickup-OTP flag PER TENANT and fails CLOSED when the flag store is down', async () => {
    const on = harness();
    await on.svc.schedulePickup('t1', boss, 's1', { scheduledPickupAt: '2026-08-20T05:30:00.000Z' } as never, null);
    // Per tenant, not globally: a global read would switch the feature on for every white-label at once.
    expect(on.flags.isEnabled).toHaveBeenCalledWith('logistics_pickup_otp', { tenantId: 't1' });

    const broken = harness({ flag: 'throws' });
    await broken.svc.schedulePickup('t1', boss, 's1', { scheduledPickupAt: '2026-08-20T05:30:00.000Z' } as never, null);
    // An unreadable flag must not silently ENABLE a feature: no code is issued, nothing claims one was, and
    // the shipment keeps reporting the possession it can actually prove.
    expect(broken.s.toProps().pickupOtpHash).toBeNull();
    expect(otpOf(broken.outbox, 'logistics.pickup_otp_issued')).toBeUndefined();
    const ev = broken.outbox.write.mock.calls.map((c) => c[1] as { eventType: string; payload: Record<string, unknown> })
      .find((e) => e.eventType === 'logistics.shipment_pickup_scheduled')!;
    expect(ev.payload.pickupOtpIssued).toBe(false);
  });

  it('audits the dispatch that issues a buyer\'s code — and never writes the code into the audit row', async () => {
    const h = harness({ status: 'picked_up' });
    await h.svc.markOutForDelivery('t1', boss, 's1', '10.1.2.3');
    const row = h.audit.write.mock.calls.map((c) => c[1] as Record<string, unknown>)
      .find((r) => r.action === 'shipment.out_for_delivery');
    expect(row).toBeDefined();
    expect(row!.ip).toBe('10.1.2.3');
    expect((row!.newValue as { deliveryOtpIssued: boolean }).deliveryOtpIssued).toBe(true);
    // The code itself lives on two phones and nowhere else. An audit row carrying it would put a live
    // delivery OTP on every console that can read audit history.
    const code = otpOf(h.outbox, 'logistics.delivery_otp_issued')!;
    expect(JSON.stringify(row)).not.toContain(code);
    expect(JSON.stringify(row)).not.toMatch(/"otp"/);
  });

  it('rounds the trail BY VIEWER — a non-lead never receives a full-precision coordinate', async () => {
    const pt = [{ at: new Date('2026-08-18T07:00:00Z'), status: 'in_transit', lat: 22.043791, lng: 70.812345, note: null }];
    const lead = await harness({ trail: pt }).svc.trail('t1', boss, 's1');
    expect(lead.points[0].lat).toBe(22.043791);
    const other = await harness({ trail: pt }).svc.trail('t1', member, 's1');
    // ~110m at this latitude — the canon's "~100m for non-lead roles", applied in the domain and not in a
    // template: a full-precision coordinate that reaches a serializer has already left the building.
    expect(other.points[0].lat).toBe(22.044);
    expect(other.points[0].lng).toBe(70.812);
    expect(other.eta).toEqual({ kind: 'no_eta_source' });
  });

  it('always queries a RESOLVED window, and reports the clamp it applied', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const near = harness();
    const p1 = await near.svc.events('t1', boss, { filter: 'all', limit: 50 });
    expect(p1.window).toEqual({ from: today, to: today, clamped: false });
    expect(near.repo.explore).toHaveBeenCalledWith('t1', expect.objectContaining({ from: today, to: today }));

    const far = harness();
    const p2 = await far.svc.events('t1', member, { from: '1970-01-01', filter: 'all', limit: 50 });
    // Ninety days hot, and SAID so — an operator who asked for 1970 and silently got ninety days reads the
    // empty stretch as "nothing happened" instead of "you did not ask for that".
    expect(p2.window.clamped).toBe(true);
    expect(p2.window.from > '1970-01-01').toBe(true);
    expect(p2.precisionDp).toBe(MEMBER_PRECISION_DP);
    expect((far.repo.explore.mock.calls[0][1] as { from: string }).from).toBe(p2.window.from);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · the queries themselves, executed', () => {
  const cap = () => { const sql: string[] = []; const params: unknown[][] = [];
    const q = jest.fn(async (s: string, p?: unknown[]) => { sql.push(s); params.push(p ?? []); return { rows: [], rowCount: 0 }; });
    return { q, sql, params, replica: { forTenant: jest.fn(() => ({ query: q })) } };
  };

  it('bounds the per-shipment trail at BOTH ends, so it prunes to one partition', async () => {
    const c = cap();
    await new ShipmentRepository(c.replica as never).trailFor('t1', 's1');
    // The lower bound alone pruned the partitions OLDER than the shipment and then scanned every partition
    // from its creation forward — including the sixteen future months the partition runway had already
    // created, proven by EXPLAIN on a real PG16. An event cannot precede its shipment or be in the future.
    expect(c.sql[0]).toContain('uuid_v7_time($2)');
    expect(c.sql[0]).toContain('created_at <= now()');
    expect(c.params[0]).toEqual(['t1', 's1', 501]);
  });

  it('pages the explorer on the FULL keyset — timestamp and id', async () => {
    const c = cap();
    await new ShipmentRepository(c.replica as never).explore('t1', {
      from: '2026-08-01', to: '2026-08-18', filter: 'door_open', cursor: { c: '2026-08-18T07:00:00Z', id: 'e9' }, limit: 50 });
    const sql = c.sql[0];
    // Without the id tiebreaker, two events sharing a created_at straddle the page boundary and one of them
    // is never shown — on a table written by every 90-second GPS ping, ties are the normal case.
    expect(sql).toMatch(/created_at\s*<\s*\$\d+\s*OR\s*\(created_at=\$\d+\s*AND\s*id\s*<\s*\$\d+\)/);
    expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    expect(sql).toContain("note ILIKE '%door-open%'");
    expect(c.params[0]).toContain('e9');
  });

  it('does not SUBSTITUTE a status when the order cannot be read — the answer travels, the failure travels too', async () => {
    // `transportStatus` is the one question the money gate asks. A `.catch(() => 'confirmed')` here — the
    // shape Law 12's "degrade, never die" invites on a READ — would turn the gate into decoration for
    // exactly the case it exists to refuse, and no caller could tell. So the rejection propagates: the
    // logistics service is the layer that decides what a failure means, and it refuses.
    const boom = { statusOf: jest.fn(async () => { throw new Error('replica down'); }) };
    const svc = new OrderService({} as never, {} as never, { inc: jest.fn(), observe: jest.fn() } as never, {} as never, boom as never);
    await expect(svc.transportStatus({} as never, 't1', 'o1')).rejects.toThrow(/replica down/);
    // …and a readable-but-absent order answers null rather than throwing, which the gate reads as
    // `unknown_order`. Absent and unreadable are different facts and both are refusals.
    const empty = { statusOf: jest.fn(async () => null) };
    const ok = new OrderService({} as never, {} as never, { inc: jest.fn(), observe: jest.fn() } as never, {} as never, empty as never);
    await expect(ok.transportStatus({} as never, 't1', 'o1')).resolves.toBeNull();
  });

  it('reads the order\'s status scoped to the tenant, and never a deleted order', async () => {
    const sql: string[] = [];
    const tx = { query: jest.fn(async (s: string) => { sql.push(s); return { rows: [], rowCount: 0 }; }) };
    const got = await new OrderRepository(cap().replica as never).statusOf(tx as never, 't1', 'o1');
    expect(sql[0]).toContain('tenant_id=$2');
    // PRUNED (Law 8): `orders` is partitioned by created_at and this query runs on the write path of every
    // assignment and collection. Its id is a v7, so its own creation instant is recoverable from it.
    expect(sql[0]).toContain('uuid_v7_time($1)');
    // **AND IT NAMES ONLY COLUMNS THAT EXIST.** This query shipped with `AND deleted_at IS NULL` on a table
    // that has no such column, and the assertion here was `toContain('deleted_at IS NULL')` — a source-text
    // assertion "proving" a clause the database would have rejected on the first assignment. The live
    // integration run found it. So the columns are checked against the MIGRATION that creates the table.
    const ddl = fs.readFileSync(path.join(REPO, 'db/migrations/0005_commerce.sql'), 'utf8');
    const block = ddl.slice(ddl.indexOf('CREATE TABLE orders ('));
    const cols = new Set([...block.slice(0, block.indexOf('\n);')).matchAll(/^\s{2}([a-z_]+)\s+[a-z]/gm)].map((m) => m[1]));
    for (const c of ['id', 'tenant_id', 'status', 'created_at']) expect({ c, present: cols.has(c) }).toEqual({ c, present: true });
    // An order is closed by its STATUS on this platform (`cancelled` / `refunded`) — which is what
    // DEAD_ORDER_STATUSES reads — and never by a soft-delete flag.
    expect(cols.has('deleted_at')).toBe(false);
    expect(sql[0]).not.toContain('deleted_at');
    // No row ⇒ null ⇒ `unknown_order` ⇒ refusal. The absence is answered, not swallowed.
    expect(got).toBeNull();
    expect(transportVerdict(got)).toEqual({ kind: 'unknown_order' });
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-5a · the trail\'s edges', () => {
  const pt = (at: string, lat: number | null = null) => ({ at, lat, lng: lat === null ? null : 70.1, status: 'in_transit', note: null });

  it('treats an unreadable timestamp as a GAP, not as a continuous line', () => {
    // A malformed `at` is the one case where "assume it is fine" draws a straight line between two points
    // that may be a hundred kilometres apart — which is the teleport W235 forbids.
    expect(isGpsGap(pt('not-a-date', 22.1), pt('2026-08-18T07:00:00Z', 22.2))).toBe(true);
    expect(isGpsGap(pt('2026-08-18T07:00:00Z', 22.1), pt('', 22.2))).toBe(true);
    expect(isGpsGap(pt('2026-08-18T07:00:00Z', 22.1), pt('2026-08-18T07:01:00Z', 22.2))).toBe(false);
  });

  it('rounds a member\'s coordinates to a NEIGHBOURHOOD, and nulls a coordinate that is not a number', () => {
    expect(MEMBER_PRECISION_DP).toBeLessThan(LEAD_PRECISION_DP);
    expect(roundCoord(22.043791, MEMBER_PRECISION_DP)).toBe(22.044);
    expect(roundCoord(22.043791, MEMBER_PRECISION_DP)).not.toBe(22.043791);
    // NaN/Infinity would serialise to `null` in JSON anyway on one path and to a broken number on another;
    // answered here so every reader sees the same "no coordinate".
    expect(roundCoord(Number.NaN, 3)).toBeNull();
    expect(roundCoord(Number.POSITIVE_INFINITY, 6)).toBeNull();
  });

  it('places the shipment at its LAST located point, not its first', () => {
    // The first located point is where the journey started. Drawing it as "last seen" tells a dispatcher a
    // lorry that left Rajkot four hours ago is still in Rajkot.
    const trail = [pt('2026-08-18T05:00:00Z', 22.1), pt('2026-08-18T06:00:00Z'), pt('2026-08-18T07:00:00Z', 23.9)];
    expect(lastKnownPoint(trail)?.at).toBe('2026-08-18T07:00:00Z');
    expect(lastKnownPoint(trail)?.lat).toBe(23.9);
    expect(lastKnownPoint([pt('2026-08-18T05:00:00Z')])).toBeNull();
  });
});
