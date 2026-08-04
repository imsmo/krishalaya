// apps/mobile/src/features/labour/book-worker.ts · PURE helpers for the worker-targeted booking (screen 26). No
// React/native deps (SDK types are `import type` → erased) → unit-tested.
import type { CreateBookingInput } from '@krishalaya/sdk-js';

/** The day-length options the design offers (half/three-quarter/full day). `dailyHours` is a real CreateBooking
 * field. */
export const BOOKING_HOURS = [4, 6, 8] as const;
export type BookingHours = (typeof BOOKING_HOURS)[number];

/** Attach a validated day-length to a booking payload. Only the offered options are accepted; anything else falls
 * back to a full day (8h). Pure — never mutates the input. */
export function withDailyHours(input: CreateBookingInput, hours: number): CreateBookingInput {
  const valid = (BOOKING_HOURS as readonly number[]).includes(hours) ? hours : 8;
  return { ...input, dailyHours: valid };
}
