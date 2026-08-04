// apps/web-ops/src/features/equipment/manage.ts · PURE CHC-rental logic (PC-33 OW-3). Mirrors the rental
// state machine (requested→quoted→confirmed→in_progress→completed→settled; cancel pre-start). Money float-free.
import { parseMajorToMinor } from '../money';

export const RENTAL_STATUSES = ['requested', 'quoted', 'confirmed', 'in_progress', 'completed', 'settled', 'cancelled'] as const;

export function isRentalStatus(v: string | undefined | null): boolean {
  return !!v && (RENTAL_STATUSES as readonly string[]).includes(v);
}
export function canQuote(status: string | undefined | null): boolean { return status === 'requested'; }
export function canStart(status: string | undefined | null): boolean { return status === 'confirmed'; }
export function canComplete(status: string | undefined | null): boolean { return status === 'in_progress'; }
export function canSettle(status: string | undefined | null): boolean { return status === 'completed'; }
export function canCancelRental(status: string | undefined | null): boolean {
  return status === 'requested' || status === 'quoted' || status === 'confirmed';
}

export function buildQuoteAdvance(major: string): { ok: true; value: string } | { ok: false; error: 'advance' } {
  const minor = parseMajorToMinor(major);
  if (minor === undefined) return { ok: false, error: 'advance' };
  return { ok: true, value: minor };
}

export function buildStartOtp(raw: string): { ok: true; value: string } | { ok: false; error: 'otp' } {
  const otp = raw.trim();
  if (!/^\d{4,12}$/.test(otp)) return { ok: false, error: 'otp' };
  return { ok: true, value: otp };
}

export function buildActualQuantity(raw: string): { ok: true; value: string } | { ok: false; error: 'quantity' } {
  const q = raw.trim();
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(q) || Number(q) <= 0) return { ok: false, error: 'quantity' };
  return { ok: true, value: q };
}
