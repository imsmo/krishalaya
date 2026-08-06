// apps/mobile/src/features/dairy/d2c.ts · PURE rules for the household's D2C milk subscription (PC-55 B6, on
// PC-54 W54-5 + PC-55 A5). No IO, no React — mirrors of the server's own gates so the app only offers what the API
// will accept, and a household on a weak connection learns immediately.
//
// WHAT THIS IS: a standing order for milk to be delivered at home. The household chooses a plan the seller
// published, and OWNS pause / resume / cancel — those three are the customer's own controls, not a support request.
//
// WHAT THIS APP NEVER DOES: price anything. The plan's price per delivery is a bigint minor STRING set once by the
// seller (Law 2/11), and the monthly bill is a SERVER-side postpaid statement over ACTUAL deliveries. So there is no
// "your monthly cost" arithmetic here — multiplying a price by a frequency would produce a confident number that
// ignores every pause, skip and failed drop, and a household would rightly call it a lie when the bill arrived.
export const D2C_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type D2cStatus = (typeof D2C_STATUSES)[number];
export const D2C_FREQUENCIES = ['daily', 'alternate_day', 'weekly', 'monthly'] as const;
export type D2cFrequency = (typeof D2C_FREQUENCIES)[number];

export function isD2cStatus(v: string | undefined | null): v is D2cStatus {
  return !!v && (D2C_STATUSES as readonly string[]).includes(v);
}
export function isD2cFrequency(v: string | undefined | null): v is D2cFrequency {
  return !!v && (D2C_FREQUENCIES as readonly string[]).includes(v);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-fA-F-]{36}$/;

// ---------------------------------------------------------------------------
// Subscribing
// ---------------------------------------------------------------------------
export type SubscribeError = 'plan' | 'address' | 'startsOn' | 'startsOnPast';
export type SubscribeResult =
  | { ok: true; value: { planId: string; addressId: string; startsOn: string } }
  | { ok: false; error: SubscribeError };

/** A subscription cannot START in the past: the delivery run is materialised forward by a server cadence job, so a
 *  back-dated start would silently promise drops that never happened — and then bill for them. Today is allowed. */
export function buildSubscribe(raw: { planId: string; addressId: string; startsOn: string }, todayIso: string): SubscribeResult {
  const planId = raw.planId.trim();
  if (!UUID.test(planId)) return { ok: false, error: 'plan' };
  const addressId = raw.addressId.trim();
  if (!UUID.test(addressId)) return { ok: false, error: 'address' };
  const startsOn = raw.startsOn.trim();
  if (!DATE.test(startsOn)) return { ok: false, error: 'startsOn' };
  if (startsOn < todayIso) return { ok: false, error: 'startsOnPast' };

  return { ok: true, value: { planId, addressId, startsOn } };
}

// ---------------------------------------------------------------------------
// The three controls the household owns
// ---------------------------------------------------------------------------
/** Pause is offered only on an ACTIVE subscription (the API refuses the rest with a 409). */
export function canPause(status: string | null | undefined): boolean { return status === 'active'; }
/** Resume only from paused. */
export function canResume(status: string | null | undefined): boolean { return status === 'paused'; }
/** Cancel from either live state — but never a second time: cancellation is final, and offering it again would
 *  suggest a subscription can be un-cancelled, which it cannot (the household re-subscribes instead). */
export function canCancel(status: string | null | undefined): boolean { return status === 'active' || status === 'paused'; }

export type PauseError = 'pausedUntil' | 'pausedUntilPast' | 'pausedUntilFar';
export type PauseResult = { ok: true; value: { pausedUntil: string } } | { ok: false; error: PauseError };

/** The API REQUIRES a pausedUntil date (a pause with no end is an abandoned subscription nobody resumes), so the
 *  app asks for one rather than sending a null it knows will 400. It must be in the future — pausing "until
 *  yesterday" is not a pause — and is capped at a year, because a longer gap is a cancellation being avoided. */
export function buildPause(raw: { pausedUntil: string }, todayIso: string): PauseResult {
  const pausedUntil = raw.pausedUntil.trim();
  if (!DATE.test(pausedUntil)) return { ok: false, error: 'pausedUntil' };
  if (pausedUntil <= todayIso) return { ok: false, error: 'pausedUntilPast' };
  if (daysAhead(todayIso, pausedUntil) > 366) return { ok: false, error: 'pausedUntilFar' };
  return { ok: true, value: { pausedUntil } };
}

export function daysAhead(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Reading a subscription back
// ---------------------------------------------------------------------------
export interface SubscriptionRow {
  id?: string; planId?: string; planName?: string | null; status?: string | null;
  startsOn?: string | null; pausedUntil?: string | null; addressId?: string | null;
  qtyPerDelivery?: string | null; unitCode?: string | null; pricePerDeliveryMinor?: string | null; frequency?: string | null;
}

/** What a household should read at a glance. 'paused_until' is distinguished from a plain pause because a date the
 *  household set is a promise the app should repeat back to them; 'resuming_today' exists so the last day of a pause
 *  does not look like an ongoing one. */
export function subscriptionState(s: SubscriptionRow, todayIso: string): 'active' | 'paused_until' | 'resuming_today' | 'paused' | 'cancelled' | 'starting' {
  if (s.status === 'cancelled') return 'cancelled';
  if (s.status === 'paused') {
    const until = (s.pausedUntil ?? '').trim();
    if (!DATE.test(until)) return 'paused';
    if (until <= todayIso) return 'resuming_today';
    return 'paused_until';
  }
  const starts = (s.startsOn ?? '').trim();
  if (DATE.test(starts) && starts > todayIso) return 'starting';
  return 'active';
}

/** Deliveries a household can expect to be BILLED for: the postpaid statement counts what was DELIVERED, so a
 *  pending/scheduled drop is deliberately not counted here either. Mirrors the server's `isBillable`. */
export function billableCount(deliveries: ReadonlyArray<{ status?: string | null }>): number {
  return deliveries.filter((d) => d.status === 'delivered').length;
}
