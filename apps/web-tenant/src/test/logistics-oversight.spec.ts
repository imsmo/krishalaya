import { isShipmentStatus, oversightHref, SHIPMENT_STATUSES } from '../features/logistics/oversight';

describe('features/logistics/oversight (PC-25)', () => {
  it('accepts only server shipment states', () => {
    for (const s of SHIPMENT_STATUSES) expect(isShipmentStatus(s)).toBe(true);
    expect(isShipmentStatus('made_up')).toBe(false);
    expect(isShipmentStatus(undefined)).toBe(false);
  });
  it('pager href preserves a valid filter, drops an invalid one, carries the cursor', () => {
    expect(oversightHref('in_transit', 'c123')).toBe('/logistics?status=in_transit&cursor=c123');
    expect(oversightHref('bogus', 'c123')).toBe('/logistics?cursor=c123');
    expect(oversightHref(undefined, null)).toBe('/logistics');
  });
});
