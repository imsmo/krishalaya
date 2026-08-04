// Unit tests for the PURE booking-progress logic (features/labour/booking-progress) behind screen 51. No
// React/native deps (SDK type is import-type only). Pins the honest stage mapping + anonymous worker derivation.
import { bookingProgressStage, progressStepIndex, isJobActive, assignedWorkerId, workerAvatarInitials, PROGRESS_STEPS } from '../../features/labour/booking-progress';
import type { LabourAssignment } from '@krishalaya/sdk-js';

const A = (workerId: string, status: string): LabourAssignment => ({ id: 'a-' + workerId, bookingId: 'b1', workerId, status, wageMinor: '39000', acceptedAt: null });

describe('bookingProgressStage', () => {
  it('maps scheduled statuses', () => {
    for (const s of ['pending', 'open', 'confirmed', 'accepted']) expect(bookingProgressStage(s)).toBe('scheduled');
  });
  it('maps working/done/cancelled', () => {
    expect(bookingProgressStage('in_progress')).toBe('working');
    expect(bookingProgressStage('completed')).toBe('done');
    expect(bookingProgressStage('paid')).toBe('done');
    expect(bookingProgressStage('cancelled')).toBe('cancelled');
    expect(bookingProgressStage('rejected')).toBe('cancelled');
    expect(bookingProgressStage('expired')).toBe('cancelled');
  });
});

describe('progressStepIndex', () => {
  it('is 0/1/2 through the 3 steps and -1 when cancelled', () => {
    expect(progressStepIndex('open')).toBe(0);
    expect(progressStepIndex('in_progress')).toBe(1);
    expect(progressStepIndex('completed')).toBe(2);
    expect(progressStepIndex('cancelled')).toBe(-1);
    expect(PROGRESS_STEPS).toHaveLength(3);
  });
});

describe('isJobActive', () => {
  it('only in_progress is active', () => {
    expect(isJobActive('in_progress')).toBe(true);
    expect(isJobActive('completed')).toBe(false);
    expect(isJobActive('open')).toBe(false);
  });
});

describe('assignedWorkerId', () => {
  it('prefers the accepted/confirmed assignment', () => {
    expect(assignedWorkerId([A('w1', 'pending'), A('w2', 'accepted')])).toBe('w2');
    expect(assignedWorkerId([A('w3', 'confirmed')])).toBe('w3');
  });
  it('falls back to the first assignment, else null', () => {
    expect(assignedWorkerId([A('w9', 'pending')])).toBe('w9');
    expect(assignedWorkerId([])).toBeNull();
  });
});

describe('workerAvatarInitials', () => {
  it('gives 2 uppercase chars from the id, never a fabricated name', () => {
    expect(workerAvatarInitials('d0000001-0000-7000-8000-000000000006')).toBe('D0');
    expect(workerAvatarInitials('ab')).toBe('AB');
  });
  it('is null when there is no worker', () => {
    expect(workerAvatarInitials(null)).toBeNull();
    expect(workerAvatarInitials('')).toBeNull();
    expect(workerAvatarInitials('----')).toBeNull();
  });
});
