// Unit tests for the PURE worker active-job logic (features/labour/worker-jobs). Money summed with BigInt (Law 2).
import { jobBucket, categorizeAssignments, sumEarningsMinor, canClockIn, isWagePaid } from '../../features/labour/worker-jobs';
import type { LabourAssignment } from '@krishalaya/sdk-js';

const a = (status: string, wageMinor = '0', id = Math.random().toString()): LabourAssignment =>
  ({ id, bookingId: 'b', workerId: 'w', status, wageMinor, acceptedAt: null, createdAt: '2026-01-01' } as LabourAssignment);

describe('jobBucket', () => {
  it('maps statuses to buckets (pending → offer, excluded from jobs)', () => {
    expect(jobBucket('accepted')).toBe('upcoming');
    expect(jobBucket('paid')).toBe('paid');
    expect(jobBucket('rejected')).toBe('closed');
    expect(jobBucket('expired')).toBe('closed');
    expect(jobBucket('pending_worker')).toBe('offer');
  });
});

describe('categorizeAssignments', () => {
  it('buckets and excludes offers', () => {
    const r = categorizeAssignments([a('accepted'), a('paid'), a('rejected'), a('pending_worker')]);
    expect(r.upcoming).toHaveLength(1);
    expect(r.paid).toHaveLength(1);
    expect(r.closed).toHaveLength(1);
  });
  it('tolerates empty/undefined', () => {
    expect(categorizeAssignments([])).toEqual({ upcoming: [], paid: [], closed: [] });
  });
});

describe('sumEarningsMinor', () => {
  it('sums only PAID wages as a bigint-minor string', () => {
    expect(sumEarningsMinor([a('paid', '50000'), a('paid', '120000'), a('accepted', '99999')])).toBe('170000');
  });
  it('skips malformed values, never floats', () => {
    expect(sumEarningsMinor([a('paid', 'abc'), a('paid', '100')])).toBe('100');
    expect(sumEarningsMinor([])).toBe('0');
  });
});

describe('canClockIn / isWagePaid', () => {
  it('clock-in only when the booking is in_progress', () => {
    expect(canClockIn('in_progress')).toBe(true);
    expect(canClockIn('open')).toBe(false);
    expect(canClockIn(undefined)).toBe(false);
  });
  it('wage paid only for paid assignments', () => {
    expect(isWagePaid('paid')).toBe(true);
    expect(isWagePaid('accepted')).toBe(false);
  });
});
