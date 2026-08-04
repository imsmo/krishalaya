// Unit tests for the PURE employer (hire) logic (features/labour/booking-flow). Money built with BigInt (Law 2).
import { bookingLifecycleActions, bookingStatusTone, tallyAssignments, canAssignMore, workerFilterParams, buildBookingDraft, rupeesToMinor } from '../../features/labour/booking-flow';
import type { LabourAssignment } from '@krishalaya/sdk-js';

const asg = (status: string): LabourAssignment => ({ id: Math.random().toString(), bookingId: 'b', workerId: 'w', status, wageMinor: '0', acceptedAt: null, createdAt: '2026-01-01' } as LabourAssignment);

describe('bookingLifecycleActions', () => {
  it('maps status → allowed employer actions', () => {
    expect(bookingLifecycleActions('open')).toEqual(['assign', 'cancel']);
    expect(bookingLifecycleActions('in_progress')).toEqual(['complete', 'cancel']);
    expect(bookingLifecycleActions('completed')).toEqual(['pay']);
    expect(bookingLifecycleActions('paid')).toEqual([]);
    expect(bookingLifecycleActions('cancelled')).toEqual([]);
  });
});

describe('bookingStatusTone', () => {
  it('tones', () => {
    expect(bookingStatusTone('open')).toBe('info');
    expect(bookingStatusTone('paid')).toBe('success');
    expect(bookingStatusTone('expired')).toBe('danger');
  });
});

describe('tallyAssignments', () => {
  it('counts accepted (incl paid) / pending / rejected (incl expired)', () => {
    const t = tallyAssignments([asg('accepted'), asg('paid'), asg('pending_worker'), asg('rejected'), asg('expired')]);
    expect(t).toEqual({ accepted: 2, pending: 1, rejected: 2, total: 5 });
  });
});

describe('canAssignMore', () => {
  it('only while open and below headcount', () => {
    expect(canAssignMore({ status: 'open', workersNeeded: 3 }, 2)).toBe(true);
    expect(canAssignMore({ status: 'open', workersNeeded: 3 }, 3)).toBe(false);
    expect(canAssignMore({ status: 'in_progress', workersNeeded: 3 }, 0)).toBe(false);
  });
});

describe('workerFilterParams', () => {
  it('drops empties; verifiedOnly → ageVerified true', () => {
    expect(workerFilterParams({})).toEqual({});
    expect(workerFilterParams({ villageRegionId: ' r1 ', verifiedOnly: true })).toEqual({ villageRegionId: 'r1', ageVerified: true });
    expect(workerFilterParams({ verifiedOnly: false })).toEqual({});
  });
});

describe('rupeesToMinor', () => {
  it('whole rupees → paise; rejects non-integers', () => {
    expect(rupeesToMinor('500')).toBe('50000');
    expect(rupeesToMinor('12.5')).toBeUndefined();
    expect(rupeesToMinor('')).toBeUndefined();
  });
});

describe('buildBookingDraft', () => {
  const ok = {
    demandTypeCode: 'HARVEST', taskSkillId: '11111111-1111-1111-1111-111111111111',
    regionId: '22222222-2222-2222-2222-222222222222', skillLevel: 'unskilled',
    workersNeeded: '5', startDate: '2026-07-01', endDate: '2026-07-05',
    wageKind: 'per_day', wageRupees: '400', womenOnly: false, farmLat: 23.02, farmLng: 72.57, respondByHours: '4',
  };
  it('assembles a valid CreateBookingInput (wage→paise, respondBy kept)', () => {
    const r = buildBookingDraft(ok);
    expect(r.ok).toBe(true);
    expect(r.input).toMatchObject({ demandTypeCode: 'HARVEST', workersNeeded: 5, wageOfferedMinor: '40000', wageKind: 'per_day', womenOnly: false, farmLat: 23.02, farmLng: 72.57, respondByHours: 4 });
  });
  it('flags the taxonomy group when ids are missing (no fake submit)', () => {
    const r = buildBookingDraft({ ...ok, demandTypeCode: '', taskSkillId: '', regionId: '', skillLevel: '' });
    expect(r.ok).toBe(false);
    expect(r.errors).toContain('taxonomy');
  });
  it('flags bad dates / workers / wage / location', () => {
    const r = buildBookingDraft({ ...ok, workersNeeded: '0', startDate: '2026-07-09', endDate: '2026-07-01', wageRupees: '0', farmLat: null, farmLng: null });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining(['workers', 'dates', 'wage', 'location']));
  });
  it('omits respondByHours when out of range', () => {
    const r = buildBookingDraft({ ...ok, respondByHours: '999' });
    expect(r.ok).toBe(true);
    expect(r.input!.respondByHours).toBeUndefined();
  });
});
