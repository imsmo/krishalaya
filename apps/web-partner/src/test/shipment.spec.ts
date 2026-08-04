// apps/web-partner/src/test/shipment.spec.ts · unit tests for the PURE shipment lifecycle helper — the state
// machine (legal transitions only), the action-availability model, and the per-action payload builders.
import {
  SHIPMENT_STATUSES, isShipmentStatus, canTransition, isTerminal, isPrePickup, statusKey, statusTone,
  SHIPMENT_BOXES, isShipmentBox, buildListQuery, shipmentsHref, LIFECYCLE_ACTIONS, availableActions, actionByKey,
  buildAssign, buildSchedulePickup, buildDeliver, buildFail, ShipmentError,
} from '../features/logistics/shipment';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

function throws(fn: () => unknown, key: string, label: string) {
  try { fn(); throw new Error(`${label}: expected throw`); }
  catch (e) { if (!(e instanceof ShipmentError) || e.fieldKey !== key) throw new Error(`${label}: expected ShipmentError(${key}), got ${e}`); }
}

const tests: Array<[string, () => void]> = [
  ['11 statuses', () => { if (SHIPMENT_STATUSES.length !== 11) throw new Error(String(SHIPMENT_STATUSES.length)); }],
  ['isShipmentStatus', () => { if (!isShipmentStatus('in_transit') || isShipmentStatus('flying')) throw new Error('x'); }],
  // transitions
  ['pending→assigned legal', () => { if (!canTransition('pending', 'assigned')) throw new Error('x'); }],
  ['pending→delivered illegal', () => { if (canTransition('pending', 'delivered')) throw new Error('x'); }],
  ['out_for_delivery→delivered legal', () => { if (!canTransition('out_for_delivery', 'delivered')) throw new Error('x'); }],
  ['failed→out_for_delivery legal (re-attempt)', () => { if (!canTransition('failed', 'out_for_delivery')) throw new Error('x'); }],
  ['delivered is terminal (no transitions)', () => { if (!isTerminal('delivered') || availableActions('delivered').length !== 0) throw new Error('x'); }],
  ['cancelled terminal', () => { if (!isTerminal('cancelled')) throw new Error('x'); }],
  ['returned terminal', () => { if (!isTerminal('returned')) throw new Error('x'); }],
  ['isPrePickup', () => { if (!isPrePickup('assigned') || isPrePickup('picked_up')) throw new Error('x'); }],
  // status display
  ['statusKey known', () => { if (statusKey('delivered') !== 'ship.status.delivered') throw new Error('x'); }],
  ['statusKey unknown', () => { if (statusKey('zzz') !== 'ship.status.unknown') throw new Error('x'); }],
  ['statusTone delivered=ok', () => { if (statusTone('delivered') !== 'ok') throw new Error('x'); }],
  ['statusTone failed=danger', () => { if (statusTone('failed') !== 'danger') throw new Error('x'); }],
  ['statusTone cancelled=muted', () => { if (statusTone('cancelled') !== 'muted') throw new Error('x'); }],
  // boxes + list query
  ['SHIPMENT_BOXES = all,mine', () => { if (JSON.stringify(SHIPMENT_BOXES) !== JSON.stringify(['all', 'mine'])) throw new Error('x'); }],
  ['isShipmentBox', () => { if (!isShipmentBox('mine') || isShipmentBox('yours')) throw new Error('x'); }],
  ['buildListQuery defaults box=all', () => { const q = buildListQuery({}); if (q.box !== 'all' || q.status !== undefined || q.limit !== 20) throw new Error(JSON.stringify(q)); }],
  ['buildListQuery keeps valid status/box', () => { const q = buildListQuery({ box: 'mine', status: 'in_transit', cursor: 'c1' }); if (q.box !== 'mine' || q.status !== 'in_transit' || q.cursor !== 'c1') throw new Error(JSON.stringify(q)); }],
  ['buildListQuery drops bad status', () => { const q = buildListQuery({ status: 'bogus' }); if (q.status !== undefined) throw new Error('x'); }],
  ['shipmentsHref all → bare', () => { if (shipmentsHref('all') !== '/shipments') throw new Error(shipmentsHref('all')); }],
  ['shipmentsHref composes', () => { if (shipmentsHref('mine', 'failed', 'cX') !== '/shipments?box=mine&status=failed&cursor=cX') throw new Error(shipmentsHref('mine', 'failed', 'cX')); }],
  // action availability
  ['9 lifecycle actions', () => { if (LIFECYCLE_ACTIONS.length !== 9) throw new Error(String(LIFECYCLE_ACTIONS.length)); }],
  ['availableActions(pending) = assign, cancel', () => { const a = availableActions('pending').map((x) => x.key); if (JSON.stringify(a) !== JSON.stringify(['assign', 'cancel'])) throw new Error(JSON.stringify(a)); }],
  ['availableActions(out_for_delivery) = deliver, fail', () => { const a = availableActions('out_for_delivery').map((x) => x.key); if (JSON.stringify(a) !== JSON.stringify(['deliver', 'fail'])) throw new Error(JSON.stringify(a)); }],
  ['availableActions(picked_up) = inTransit, atHub, outForDelivery, fail', () => { const a = availableActions('picked_up').map((x) => x.key); if (JSON.stringify(a) !== JSON.stringify(['inTransit', 'atHub', 'outForDelivery', 'fail'])) throw new Error(JSON.stringify(a)); }],
  ['actionByKey deliver → endpoint deliver', () => { const x = actionByKey('deliver'); if (!x || x.endpoint !== 'deliver' || x.target !== 'delivered') throw new Error(JSON.stringify(x)); }],
  ['actionByKey unknown → undefined', () => { if (actionByKey('teleport') !== undefined) throw new Error('x'); }],
  // buildAssign
  ['buildAssign rider only', () => { const b = buildAssign({ riderUserId: UUID }); if (b.riderUserId !== UUID || b.partnerId || b.awbNo) throw new Error(JSON.stringify(b)); }],
  ['buildAssign partner+vehicle+awb', () => { const b = buildAssign({ partnerId: UUID, vehicleId: UUID2, awbNo: 'AWB123' }); if (b.partnerId !== UUID || b.vehicleId !== UUID2 || b.awbNo !== 'AWB123') throw new Error(JSON.stringify(b)); }],
  ['buildAssign none → throws', () => throws(() => buildAssign({}), 'assignTarget', 'assignEmpty')],
  ['buildAssign bad uuid → throws', () => throws(() => buildAssign({ riderUserId: 'nope' }), 'riderUserId', 'assignUuid')],
  ['buildAssign long awb → throws', () => throws(() => buildAssign({ riderUserId: UUID, awbNo: 'x'.repeat(61) }), 'awbNo', 'awbLong')],
  // buildSchedulePickup
  ['buildSchedulePickup ISO + window', () => { const b = buildSchedulePickup({ scheduledPickupAt: '2026-06-25T09:00', windowMins: '120' }); if (!b.scheduledPickupAt.endsWith('Z') || b.windowMins !== 120) throw new Error(JSON.stringify(b)); }],
  ['buildSchedulePickup no window', () => { const b = buildSchedulePickup({ scheduledPickupAt: '2026-06-25T09:00' }); if ('windowMins' in b) throw new Error(JSON.stringify(b)); }],
  ['buildSchedulePickup bad date → throws', () => throws(() => buildSchedulePickup({ scheduledPickupAt: '25-06-2026' }), 'scheduledPickupAt', 'schedDate')],
  ['buildSchedulePickup window>1440 → throws', () => throws(() => buildSchedulePickup({ scheduledPickupAt: '2026-06-25T09:00', windowMins: '2000' }), 'windowMins', 'schedWin')],
  // buildDeliver
  ['buildDeliver otp only', () => { const b = buildDeliver({ otp: '4321' }); if (b.otp !== '4321' || 'podMediaId' in b) throw new Error(JSON.stringify(b)); }],
  ['buildDeliver otp + pod', () => { const b = buildDeliver({ otp: '123456', podMediaId: UUID }); if (b.podMediaId !== UUID) throw new Error(JSON.stringify(b)); }],
  ['buildDeliver short otp → throws', () => throws(() => buildDeliver({ otp: '12' }), 'otp', 'otpShort')],
  ['buildDeliver non-digit otp → throws', () => throws(() => buildDeliver({ otp: 'abcd' }), 'otp', 'otpNaN')],
  ['buildDeliver bad pod → throws', () => throws(() => buildDeliver({ otp: '4321', podMediaId: 'x' }), 'podMediaId', 'podUuid')],
  // buildFail
  ['buildFail reason', () => { const b = buildFail({ reason: 'address not found' }); if (b.reason !== 'address not found') throw new Error(JSON.stringify(b)); }],
  ['buildFail empty → throws', () => throws(() => buildFail({ reason: '   ' }), 'reason', 'failEmpty')],
  ['buildFail >500 → throws', () => throws(() => buildFail({ reason: 'x'.repeat(501) }), 'reason', 'failLong')],
];

// PC-2A fix: this file was a SELF-EXECUTING script (assertions ran at import; ZERO jest tests registered —
// jest reported "must contain at least one test" and the suite counted as failed-to-run on every CI run).
// Same assertions, now registered as real jest tests.
describe('shipment lifecycle (ported table)', () => {
  for (const [name, fn] of tests) it(name, fn);
});
export {};
