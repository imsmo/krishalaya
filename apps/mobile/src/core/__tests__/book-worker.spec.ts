// Unit tests for the PURE worker-booking helper (screen 26).
import { withDailyHours, BOOKING_HOURS } from '../../features/labour/book-worker';
import type { CreateBookingInput } from '@krishalaya/sdk-js';

const base = { demandTypeCode: 'harvest', taskSkillId: 's1', regionId: 'r1', skillLevel: 'skilled', workersNeeded: 1, startDate: '2026-08-18', endDate: '2026-08-18', wageOfferedMinor: '40000', farmLat: 22.3, farmLng: 73.1 } as unknown as CreateBookingInput;

describe('book worker (screen 26)', () => {
  it('withDailyHours accepts offered options, else falls back to 8', () => {
    expect(withDailyHours(base, 4).dailyHours).toBe(4);
    expect(withDailyHours(base, 6).dailyHours).toBe(6);
    expect(withDailyHours(base, 5).dailyHours).toBe(8);
    expect(withDailyHours(base, 0).dailyHours).toBe(8);
  });
  it('does not mutate the input', () => {
    const out = withDailyHours(base, 4);
    expect(out).not.toBe(base);
    expect((base as { dailyHours?: number }).dailyHours).toBeUndefined();
    expect(BOOKING_HOURS).toEqual([4, 6, 8]);
  });
});
