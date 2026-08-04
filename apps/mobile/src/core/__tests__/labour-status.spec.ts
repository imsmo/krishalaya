// Unit tests for the PURE labour logic (features/labour/labour-status). No React/native deps (SDK/ui types are
// type-only). Money is bigint minor strings (Law 2). The 18+ gate + accept window are server-enforced; these
// helpers drive UX only.
import { bookingStatusTone, assignmentStatusTone, assignmentActions, canAcceptWork, rupeesToWageMinor, buildWorkerPatch, isJobOpen } from '../../features/labour/labour-status';
import type { WorkerProfile } from '@krishalaya/sdk-js';

const worker = (over: Partial<WorkerProfile> = {}): WorkerProfile => ({
  id: 'w1', userId: 'u1', ageVerified18: true, villageRegionId: null, travelKm: 10, stayAwayOk: 'same_day',
  minWageExpectationMinor: null, autoAcceptAboveMinor: null, hasSmartphone: true, ratingAvg: null, bookingsCompleted: 0, noShowCount: 0, ...over,
});

describe('tones', () => {
  it('booking + assignment status → tone', () => {
    expect(bookingStatusTone('open')).toBe('info');
    expect(bookingStatusTone('completed')).toBe('success');
    expect(bookingStatusTone('cancelled')).toBe('danger');
    expect(assignmentStatusTone('accepted')).toBe('success');
    expect(assignmentStatusTone('pending_worker')).toBe('warning');
    expect(assignmentStatusTone('rejected')).toBe('danger');
  });
});

describe('assignmentActions', () => {
  it('offers accept/reject only while pending', () => {
    expect(assignmentActions('pending_worker')).toEqual(['accept', 'reject']);
    expect(assignmentActions('accepted')).toEqual([]);
    expect(assignmentActions('expired')).toEqual([]);
  });
});

describe('canAcceptWork (18+ gate)', () => {
  it('requires an age-verified worker profile', () => {
    expect(canAcceptWork(null)).toBe(false);
    expect(canAcceptWork(worker({ ageVerified18: false }))).toBe(false);
    expect(canAcceptWork(worker({ ageVerified18: true }))).toBe(true);
  });
});

describe('rupeesToWageMinor', () => {
  it('whole rupees → paise, else undefined', () => {
    expect(rupeesToWageMinor('500')).toBe('50000');
    expect(rupeesToWageMinor('0')).toBe('0');
    expect(rupeesToWageMinor('12.5')).toBeUndefined();
    expect(rupeesToWageMinor('')).toBeUndefined();
  });
});

describe('buildWorkerPatch', () => {
  it('drops empties, converts wage, keeps valid fields', () => {
    expect(buildWorkerPatch({ travelKm: '20', stayAwayOk: 'overnight', minWageRupees: '400', emergencyContactName: ' Asha ', emergencyContactPhone: '' }))
      .toEqual({ travelKm: 20, stayAwayOk: 'overnight', minWageExpectationMinor: '40000', emergencyContactName: 'Asha' });
  });
  it('returns null when nothing valid to send', () => {
    expect(buildWorkerPatch({})).toBeNull();
    expect(buildWorkerPatch({ travelKm: 'abc', stayAwayOk: 'nope', minWageRupees: '1.5' })).toBeNull();
  });
});

describe('isJobOpen', () => {
  it('only open bookings are takeable (UX)', () => {
    expect(isJobOpen({ status: 'open' })).toBe(true);
    expect(isJobOpen({ status: 'in_progress' })).toBe(false);
  });
});
