// PC-56 TENANT-5a · W226/W227/W235/W236's rules — what the logistics desk may and may not say.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EVENT_FILTERS, TABS, blockedKey, canDispatch, driverGapKey, etaKey, eventsHref, isEventFilter, isTab,
  lastSeenKey, listHref, milestoneKey, possessionIsProven, possessionKey, precisionKey, progressPct,
  refusalKey, segmentStyle, statusesForTab, stepVerdict, tabOf, weighbridgeVerdict, windowKey,
} from '../features/logistics/shipments';

const LOCALES = ['en', 'hi', 'gu'] as const;
const dict = (l: string) => fs.readFileSync(path.join(__dirname, `../i18n/${l}.ts`), 'utf8');

describe('TENANT-5a · the list (W226)', () => {
  it('has the canon\'s four tabs, and defaults to the one it opens on', () => {
    expect([...TABS]).toEqual(['active', 'pending', 'delivered', 'failed']);
    expect(tabOf(undefined)).toBe('active');
    expect(tabOf('nonsense')).toBe('active');
    expect(isTab('failed')).toBe(true);
  });

  it('agrees with the API about which statuses each tab holds', () => {
    // The screen must not invent its own bucket: a tab whose count disagrees with the rows under it is worse
    // than no tab. This asserts the two lists against each other rather than against a copy of one of them.
    const api = fs.readFileSync(path.join(__dirname, '../../../api/src/modules/logistics/domain/shipment-readiness.ts'), 'utf8');
    for (const tab of TABS) {
      for (const s of statusesForTab(tab)) {
        expect({ tab, status: s, inApi: api.includes(`'${s}'`) }).toEqual({ tab, status: s, inApi: true });
      }
    }
    expect(statusesForTab('active')).not.toContain('pending');
    expect(statusesForTab('failed')).toEqual(['failed', 'returned']);
  });

  it('keeps the tab in the URL and drops the default', () => {
    expect(listHref('active')).toBe('/logistics');
    expect(listHref('failed')).toBe('/logistics?tab=failed');
    expect(listHref('pending', 'CUR')).toBe('/logistics?tab=pending&cursor=CUR');
  });

  it('calls out a vehicle with no driver — the row an operator must act on today', () => {
    expect(driverGapKey({ vehicleId: 'v1', riderUserId: null })).toBe('ship.gap.driverUnassigned');
    expect(driverGapKey({ vehicleId: 'v1', riderUserId: 'r1' })).toBeNull();
    // A 3PL brings its own driver, so it is not short of one.
    expect(driverGapKey({ partnerId: 'p1' })).toBeNull();
    expect(driverGapKey({})).toBe('ship.gap.unassigned');
  });

  it('shows a next milestone only while there IS one', () => {
    expect(milestoneKey('assign_driver')).toBe('ship.milestone.assign_driver');
    // A finished shipment renders a dash. An invented "archived" step would be a status recording an act
    // nobody performed — this programme's most-found defect.
    expect(milestoneKey(null)).toBeNull();
  });
});

describe('TENANT-5a · why a shipment is not moving', () => {
  it('says WHICH kind of not-moving it is', () => {
    // "not yet" sends an operator to chase a buyer; "no longer" sends them to cancel the transport.
    expect(blockedKey('awaiting_payment')).toBe('ship.blocked.awaitingPayment');
    expect(blockedKey('order_closed')).toBe('ship.blocked.orderClosed');
    expect(blockedKey('unknown_order')).toBe('ship.blocked.unknownOrder');
    expect(blockedKey('something_new')).toBe('ship.blocked.generic');
    expect(blockedKey(null)).toBeNull();
  });

  it('does not OFFER a dispatch action the server will refuse', () => {
    // A button that refuses on click is worse than an absent one with a reason — the rule W120's pay button
    // already follows.
    expect(canDispatch({ status: 'pending' }, true)).toBe(true);
    expect(canDispatch({ status: 'pending' }, false)).toBe(false);
    expect(canDispatch({ status: 'delivered' }, true)).toBe(false);
    expect(canDispatch({ status: 'in_transit' }, true)).toBe(false);
  });

  it('translates the API\'s refusals BY NAME', () => {
    expect(refusalKey('SHIPMENT_ORDER_NOT_READY')).toBe('ship.err.orderNotReady');
    expect(refusalKey('SHIPMENT_INVALID_PICKUP_OTP')).toBe('ship.err.pickupOtp');
    expect(refusalKey('SHIPMENT_INVALID_OTP')).toBe('ship.err.deliveryOtp');
    // The pickup and delivery failures are DIFFERENT sentences: a driver at a farm gate and a driver at a
    // mill gate are different people at different moments.
    expect(refusalKey('SHIPMENT_INVALID_PICKUP_OTP')).not.toBe(refusalKey('SHIPMENT_INVALID_OTP'));
    expect(refusalKey('WHATEVER')).toBe('ship.err.generic');
  });
});

describe('TENANT-5a · possession, and the weighbridge that does not exist', () => {
  it('renders W225\'s tick ONLY for a shipment proving both ends', () => {
    expect(possessionIsProven('both_ends')).toBe(true);
    for (const p of ['delivery_only', 'pickup_only', 'neither'] as const) expect(possessionIsProven(p)).toBe(false);
    expect(possessionKey('delivery_only')).toBe('ship.possession.deliveryOnly');
    // Four distinct sentences: "both", "only delivery", "only pickup" and "neither" are four different
    // things to tell an FPO about goods that have left their gate.
    expect(new Set((['both_ends', 'delivery_only', 'pickup_only', 'neither'] as const).map(possessionKey)).size).toBe(4);
  });

  it('never draws the weighbridge as done', () => {
    // W225 stakes a tick on it and W227 stakes its whole dispute-prevention story on slip #1 vs slip #2.
    // There is no weighbridge anywhere in apps/api or db — drawing it as part of a completed step would tell
    // an FPO that 998 kg was weighed at both ends when nothing weighed anything.
    expect(weighbridgeVerdict()).toBe('not_built');
    expect(weighbridgeVerdict()).not.toBe('done');
  });

  it('walks the three journey steps in order', () => {
    expect(stepVerdict(1, 'pending')).toBe('next');
    expect(stepVerdict(1, 'picked_up')).toBe('done');
    expect(stepVerdict(2, 'picked_up')).toBe('next');
    expect(stepVerdict(3, 'out_for_delivery')).toBe('next');
    expect(stepVerdict(3, 'delivered')).toBe('done');
    expect(stepVerdict(3, 'pending')).toBe('later');
  });
});

describe('TENANT-5a · tracking (W235) and the explorer (W236)', () => {
  it('refuses to draw an ETA', () => {
    // The single number on this screen a farmer would plan an afternoon around, on a platform with no
    // routing engine and no traffic feed. The buyer-side type already carries the same earlier ruling.
    expect(etaKey()).toBe('ship.eta.none');
    for (const l of LOCALES) {
      const line = dict(l).split('\n').find((x) => x.includes("'ship.eta.none'")) ?? '';
      expect({ l, hasLine: line.length > 0 }).toEqual({ l, hasLine: true });
      // …and no locale may quietly promise one back.
      expect({ l, promises: /\bETA (is|:)\s*\d/i.test(line) }).toEqual({ l, promises: false });
    }
  });

  it('shows a last-seen fact instead, and says when there is none', () => {
    expect(lastSeenKey(true)).toBe('ship.lastSeen.at');
    expect(lastSeenKey(false)).toBe('ship.lastSeen.never');
  });

  it('draws a gap as DOTTED, never as a straight line', () => {
    expect(segmentStyle(true)).toBe('dotted');
    expect(segmentStyle(false)).toBe('solid');
  });

  it('shows milestone progress, and none at all when the shipment is off the line', () => {
    expect(progressPct({ step: 4, of: 8 })).toBe(50);
    expect(progressPct({ step: 8, of: 8 })).toBe(100);
    // A bar for a failed or returned shipment would imply an arrival that is not coming.
    expect(progressPct(null)).toBeNull();
    expect(progressPct({ step: 1, of: 0 })).toBeNull();
  });

  it('says the window it queried, and says when that window was trimmed', () => {
    expect(windowKey({ clamped: false })).toBe('ship.events.window');
    expect(windowKey({ clamped: true })).toBe('ship.events.windowClamped');
    expect(windowKey({ clamped: true })).not.toBe(windowKey({ clamped: false }));
  });

  it('tells a non-lead that their coordinates are rounded', () => {
    // Otherwise they read a ~100m point as an address and drive to the wrong gate.
    expect(precisionKey(6)).toBe('ship.gps.exact');
    expect(precisionKey(3)).toBe('ship.gps.rounded');
  });

  it('carries the filter and the window through the pager', () => {
    expect(eventsHref('all')).toBe('/logistics/events');
    expect(eventsHref('failed', '2026-08-01', '2026-08-18', 'CUR'))
      .toBe('/logistics/events?filter=failed&from=2026-08-01&to=2026-08-18&cursor=CUR');
    expect(isEventFilter('door_open')).toBe(true);
    expect(isEventFilter('everything')).toBe(false);
    expect([...EVENT_FILTERS]).toEqual(['all', 'failed', 'at_hub', 'door_open', 'gps_gap']);
  });
});

describe('TENANT-5a · i18n parity ×3', () => {
  it('has every new key in all three launch languages', () => {
    const en = dict('en');
    const keys = [...en.matchAll(/'(ship\.[a-zA-Z0-9_.]+)':/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(90);
    for (const l of ['hi', 'gu'] as const) {
      const d = dict(l);
      const missing = keys.filter((k) => !d.includes(`'${k}':`));
      expect({ locale: l, missing }).toEqual({ locale: l, missing: [] });
    }
  });
});
