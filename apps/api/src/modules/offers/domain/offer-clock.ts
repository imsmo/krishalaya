// modules/offers/domain/offer-clock.ts · PC-56 STORE-3b · B1 (founder D1, survey F-13 / B16) — THE OFFER CLOCK. PURE.
//
// Before this wave an offer had ONE expiry for the whole negotiation (72 h, a literal) that the buyer could set to any future instant and
// that a counter never reset. Founder D1 (2026-10-15): every act that puts a price on the table gives the other side `offers.round_ttl_hours`
// to answer (the first offer and every counter set `expires_at` = now + it), and `offers.max_life_hours` caps the whole negotiation from the
// FIRST offer. Both are PLATFORM SETTINGS (0211, read through `kv_platform_setting`); the two numbers below are compile-time FALLBACKS used
// only when a setting is absent or malformed — the repository logs when it falls back (never a silent literal).
import { OfferExpiryTooLateError, OfferMaxLifeError } from './offers.errors';

/** Used ONLY when `offers.round_ttl_hours` is absent / not a positive integer (0211 seeds 48). */
export const OFFER_ROUND_TTL_FALLBACK_H = 48;
/** Used ONLY when `offers.max_life_hours` is absent / not a positive integer (0211 seeds 336). */
export const OFFER_MAX_LIFE_FALLBACK_H = 336;

export interface OfferClock { roundTtlHours: number; maxLifeHours: number }

const H = 3_600_000;

/** A setting's raw text → a positive integer of hours, or null (then the caller uses the named fallback and says so). */
export function hoursOf(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : null;
}

/** When the whole negotiation ends: the FIRST offer's instant + the ceiling. */
export function maxLifeEndsAt(firstOfferedAt: Date, clock: OfferClock): Date {
  return new Date(firstOfferedAt.getTime() + clock.maxLifeHours * H);
}

/** The latest instant a round may run to, from `now`: now + the round TTL, never past the negotiation's ceiling. */
export function latestRespondBy(now: Date, firstOfferedAt: Date, clock: OfferClock): Date {
  const round = now.getTime() + clock.roundTtlHours * H;
  return new Date(Math.min(round, maxLifeEndsAt(firstOfferedAt, clock).getTime()));
}

/**
 * MAKE: the buyer's own `expiresAt` (optional). Absent → now + the round TTL. Given → it must not be later than now + the round TTL (and so
 * never past the ceiling, which starts now): later → OFFER_EXPIRY_TOO_LATE {max}. (A past / present instant stays the entity's
 * OFFER_INVALID "expiresAt must be in the future".)
 */
export function makeExpiry(now: Date, clock: OfferClock, requested?: Date | null): Date {
  const max = latestRespondBy(now, now, clock);
  if (!requested) return max;
  if (requested.getTime() > max.getTime()) throw new OfferExpiryTooLateError(max.toISOString());
  return requested;
}

/**
 * COUNTER: the new round's respond-by = now + the round TTL, and the negotiation's ceiling. The ENTITY refuses a counter whose round would end
 * after the ceiling (OFFER_MAX_LIFE {endsAt} — `ListingOffer.counter`, one place); founder D1: the negotiation then lapses by its clock.
 */
export function counterClock(now: Date, firstOfferedAt: Date, clock: OfferClock): { respondBy: Date; maxLifeEndsAt: Date } {
  return { respondBy: new Date(now.getTime() + clock.roundTtlHours * H), maxLifeEndsAt: maxLifeEndsAt(firstOfferedAt, clock) };
}

/** The entity's ceiling rule, exported for its one caller and the unit spec. */
export function assertWithinMaxLife(respondBy: Date, ends: Date): void {
  if (respondBy.getTime() > ends.getTime()) throw new OfferMaxLifeError(ends.toISOString());
}
