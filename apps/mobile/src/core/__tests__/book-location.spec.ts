// Unit tests for the PURE booking Work-Location logic (features/labour/book-location) behind screen 62. No
// React/native deps (SDK types import-type only). Pins the saved-location row mapping (real fields only, no
// fabricated address) + GPS-gated continue + landmark normalization.
import { savedLocationRows, canContinueLocation, normalizeLandmark } from '../../features/labour/book-location';
import type { LandParcel, LabourLookups } from '@krishalaya/sdk-js';

const P = (id: string, surveyNo: string | null, regionId: string | null, area = '2', areaUnit = 'acre'): LandParcel => ({
  id, ownerUserId: 'u1', regionId, surveyNo, bhulekhRef: null, area, areaUnit, irrigationTypeId: null,
  boundaryGeojson: null, verificationStatus: 'verified', isTenantFarmed: false,
});
const LK: LabourLookups = { workTypes: [], skills: [], regions: [{ id: 'r1', code: 'AN', name: 'Anand' }], skillLevels: [] };

describe('savedLocationRows', () => {
  it('maps survey no → title, region+area → subtitle; first is default; default selected when none picked', () => {
    const rows = savedLocationRows([P('a', '247', 'r1'), P('b', '152', null)], LK);
    expect(rows[0]).toMatchObject({ id: 'a', title: 'Plot 247', subtitle: 'Anand · 2 acre', isDefault: true, selected: true });
    expect(rows[1]).toMatchObject({ id: 'b', title: 'Plot 152', isDefault: false, selected: false });
    expect(rows[1].subtitle).toBe('2 acre'); // region unknown → omitted, never faked
  });
  it('honours an explicit selectedId', () => {
    const rows = savedLocationRows([P('a', '247', 'r1'), P('b', '152', 'r1')], LK, 'b');
    expect(rows[0].selected).toBe(false);
    expect(rows[1].selected).toBe(true);
  });
  it('falls back to a generic parcel title when no survey no', () => {
    expect(savedLocationRows([P('a', null, null)], null)[0].title).toBe('Parcel 1');
  });
  it('is empty for no parcels', () => {
    expect(savedLocationRows([], LK)).toEqual([]);
  });
});

describe('canContinueLocation', () => {
  it('requires a finite GPS fix', () => {
    expect(canContinueLocation({ lat: 22.5, lng: 72.9 })).toBe(true);
    expect(canContinueLocation(null)).toBe(false);
    expect(canContinueLocation({ lat: NaN, lng: 1 })).toBe(false);
  });
});

describe('normalizeLandmark', () => {
  it('trims + collapses whitespace, caps length, empty → null', () => {
    expect(normalizeLandmark('  near   the  temple ')).toBe('near the temple');
    expect(normalizeLandmark('')).toBeNull();
    expect(normalizeLandmark(null)).toBeNull();
    expect(normalizeLandmark('x'.repeat(200))!.length).toBe(120);
  });
});
