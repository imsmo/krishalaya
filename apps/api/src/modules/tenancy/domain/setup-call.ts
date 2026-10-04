// modules/tenancy/domain/setup-call.ts · PC-56 TENANT-SW-d · W2619–W2625 "Book a setup call (free)" — PURE rules.
//
// Founder decision (2026-10-04): a PLATFORM-STAFFED REQUEST OBJECT. The Krishalaya team calls in the slot the requester chose; there
// is NO calendar integration (the page says so: "the Krishalaya team will call you in the slot you chose"). One OPEN request per
// tenant. The phone number is the requester's own user record; the request keeps ONLY its last four digits (0200's CHECK).
export const SETUP_CALL_LANGUAGES = ['en', 'hi', 'gu'] as const;
export type SetupCallLanguage = (typeof SETUP_CALL_LANGUAGES)[number];
export const SETUP_CALL_STATUSES = ['requested', 'scheduled', 'done', 'cancelled'] as const;
export type SetupCallStatus = (typeof SETUP_CALL_STATUSES)[number];
/** The team's clock: slots are chosen and shown in IST (Asia/Kolkata) — the zone the platform team works in. */
export const SETUP_CALL_ZONE = 'Asia/Kolkata';
export const SLOT_MAX_HOURS = 4;
export const SLOT_HORIZON_DAYS = 30;
export const NOTES_MAX = 500;
export const SETUP_CALL_REQUESTED = 'tenancy.setup_call_requested';

/** "••••1234" — the last four digits, never more (the CHECK in 0200 admits nothing else). Null when there is no usable number. */
export function lastFourMask(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : null;
}

/** A slot is in the future, within the horizon, and at most four hours long. Each failure has its own word. */
export function slotProblem(start: Date, end: Date, now: Date = new Date()): 'not_future' | 'too_far' | 'not_after_start' | 'too_long' | null {
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'not_after_start';
  if (start.getTime() <= now.getTime()) return 'not_future';
  if (start.getTime() - now.getTime() > SLOT_HORIZON_DAYS * 86_400_000) return 'too_far';
  if (end.getTime() <= start.getTime()) return 'not_after_start';
  if (end.getTime() - start.getTime() > SLOT_MAX_HOURS * 3_600_000) return 'too_long';
  return null;
}

/** A civil IST date + time ("2026-10-12" + "10:30") → the instant. IST has no DST, so the +05:30 offset is exact. */
export function istInstant(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isOpen(status: string): boolean { return status === 'requested' || status === 'scheduled'; }
