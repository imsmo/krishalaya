// modules/communication/domain/channel-resolution.ts · PURE channel-resolution policy (no I/O).
// Given a catalog event, the user's per-channel preferences, and their quiet hours, decide which channels to
// actually send on. Rules (PRD §14.3):
//   • start from the event's default_channels;
//   • a user may DISABLE a channel only if the event is opt-out-able (user_can_opt_out) — mandatory events
//     (OTP, dispute, payment) ignore preferences and always send;
//   • during quiet hours, INTRUSIVE channels (push/sms/whatsapp/ivr) are suppressed UNLESS the event is
//     'critical' (critical bypasses quiet hours); email + in-app are never quiet-hours-suppressed (passive);
//   • the result is deterministic and float-free.
import { NotifChannel, NotifPriority } from './communication.events';

export interface CatalogEvent { code: string; priority: NotifPriority; defaultChannels: NotifChannel[]; userCanOptOut: boolean; }
export interface QuietHours { starts: string; ends: string; timezone: string; }   // 'HH:MM[:SS]'
export type SuppressReason = 'opted_out' | 'quiet_hours';
export interface ChannelDecision { channels: NotifChannel[]; suppressed: { channel: NotifChannel; reason: SuppressReason }[]; }

const INTRUSIVE: ReadonlySet<NotifChannel> = new Set<NotifChannel>(['push', 'sms', 'whatsapp', 'ivr']);

/** Local wall-clock minutes-of-day in the user's timezone (stdlib Intl, DST-correct, no float). */
export function minutesOfDayInTz(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return (h % 24) * 60 + m;
}
function toMinutes(hhmm: string): number { const [h, m] = hhmm.split(':'); return (Number(h) % 24) * 60 + Number(m ?? '0'); }

/** Is `now` inside the (possibly overnight) quiet window? */
export function isWithinQuietHours(now: Date, q: QuietHours): boolean {
  const cur = minutesOfDayInTz(now, q.timezone);
  const start = toMinutes(q.starts), end = toMinutes(q.ends);
  if (start === end) return false;                 // zero-length window = disabled
  return start < end ? (cur >= start && cur < end) // same-day window
                     : (cur >= start || cur < end);// overnight window (e.g. 21:00→06:00)
}

export function resolveChannels(
  event: CatalogEvent,
  prefs: ReadonlyMap<NotifChannel, boolean>,        // explicit per-channel is_enabled overrides
  quiet: QuietHours | null,
  now: Date,
): ChannelDecision {
  const channels: NotifChannel[] = [];
  const suppressed: { channel: NotifChannel; reason: SuppressReason }[] = [];
  const inQuiet = quiet ? isWithinQuietHours(now, quiet) : false;
  for (const ch of event.defaultChannels) {
    if (event.userCanOptOut && prefs.get(ch) === false) { suppressed.push({ channel: ch, reason: 'opted_out' }); continue; }
    if (inQuiet && event.priority !== 'critical' && INTRUSIVE.has(ch)) { suppressed.push({ channel: ch, reason: 'quiet_hours' }); continue; }
    channels.push(ch);
  }
  return { channels, suppressed };
}

// ============================================================================================================
// DEV-07 · Q24 / DELTA-059 ROUTINE FAN-OUT POLICY (decided at G0-4, 2026-07-22; verbatim in spec_dev07.md).
// "ROUTINE tier = ONE primary channel per farmer preference + auto-fallback to SMS on non-delivery. Money/
//  security tiers stay multi-channel as already designed (Critical/Important tiers unaffected)."
//
// TIER MAPPING (explicit, per the founder brief's instruction to state it against the canon's own vocabulary,
// W435-admin-notification-variants.html line 115: "critical / important / informational / promotional"):
//   ROUTINE  = 'informational' | 'promotional'   (high-volume, non-money, non-security — the ruling's target)
//   MONEY/SECURITY = 'critical' | 'important'     (unaffected — resolveChannels()'s output passes through as-is)
// This mapping is a reasoned application of the ruling's own words ("routine" / "Money/security tiers"), not an
// invented third vocabulary — the canon defines exactly these 4 tiers and no "routine" tier literally exists in
// it, so this module is the ratified place that binds the ruling's English onto the canon's enum.
//
// NO ranked "preferred channel" field exists anywhere in the schema (grep-confirmed: neither
// `notification_preferences` (0012_engagement.sql) nor `users`/related tables carry a `preferred_channel` /
// `primary_channel` column — preference today is purely per-(user,event_code,channel) boolean opt-in/out, see
// notification-preference.entity.ts). The canon itself (W433 line 172) drew a one-primary-channel toggle
// deliberately DISABLED pending this very founder decision ("pending founder decision on redundancy-by-default
// vs. one-primary-channel for routine tiers... DELTA-059") — it never proposed a ranked-preference schema shape
// either. Adding one now would be a schema change this batch (explicitly framed as application-code, not
// schema/proof) does not own. CONSERVATIVE SUBSTITUTE, flagged for founder confirmation: "the farmer's
// preference" is read as the FIRST channel — after the farmer's own existing per-channel opt-outs are applied by
// resolveChannels() above — in the catalog's own `default_channels` ordering, which is the only ranking the
// system has ever encoded (every seeded routine-tier event already lists its intended-primary channel first,
// e.g. 'informational' price.alert=[push], chat.message_posted=[push,inapp]; 'promotional'
// commerce.catalogue_promo=[whatsapp,sms]). If the founder wants a true per-user ranked-preference column, that
// is a follow-up schema batch, not a silent invention here.
export const ROUTINE_TIERS: ReadonlySet<NotifPriority> = new Set<NotifPriority>(['informational', 'promotional']);

/** The one channel this policy never collapses: a pure local delivery-log/inbox record, zero external cost, zero
 *  farmer-facing interruption — not part of the "fan-out cost/noise" problem Q24 targets. Deliberately its own
 *  concept, not reusing the `INTRUSIVE` set above (that set encodes a DIFFERENT axis — which channels interrupt
 *  quiet hours — email is quiet-hours-passive but still an external, costed send and IS collapsed here). */
const PASSIVE_CHANNELS: ReadonlySet<NotifChannel> = new Set<NotifChannel>(['inapp']);

export interface RoutineFanoutDecision {
  /** Channels to actually dispatch right now: every passive channel (always kept) + at most ONE primary
   *  externally-costed channel. Never more than one non-passive channel — this is the "never fans out to all
   *  channels" guarantee the founder's test names explicitly. */
  toSendNow: NotifChannel[];
  primary: NotifChannel | null;   // the one non-passive channel actually attempted now (null = nothing eligible)
  /** 'sms' iff eligible to be tried automatically should `primary` fail to deliver — never proposed when the
   *  farmer has explicitly disabled sms for this event, and never proposed when sms IS the primary (no
   *  self-fallback). Non-null only when `primary` is non-null (nothing to "fall back" from otherwise). */
  fallback: NotifChannel | null;
}

const NEVER_APPLIES: RoutineFanoutDecision = Object.freeze({ toSendNow: [], primary: null, fallback: null });

/** Apply the Q24/DELTA-059 ruling to an ALREADY-RESOLVED channel list (i.e. `resolveChannels(...).channels` —
 *  opt-outs and quiet-hours are applied upstream; this function only enforces the one-primary-channel collapse
 *  for routine tiers). Critical/important tiers are explicitly unaffected: pass-through, unchanged, still
 *  multi-channel (Q24: "Money/security tiers stay multi-channel as already designed"). Pure, float-free,
 *  deterministic — no I/O, matching this file's own house style. */
export function applyRoutinePolicy(
  priority: NotifPriority,
  resolved: readonly NotifChannel[],
  prefs: ReadonlyMap<NotifChannel, boolean>,   // same per-(event,channel) opt-out map resolveChannels() consumed
): RoutineFanoutDecision {
  if (!ROUTINE_TIERS.has(priority)) return { toSendNow: [...resolved], primary: null, fallback: null };   // unchanged
  if (resolved.length === 0) return NEVER_APPLIES;
  const passive = resolved.filter((c) => PASSIVE_CHANNELS.has(c));
  const candidates = resolved.filter((c) => !PASSIVE_CHANNELS.has(c));
  const primary = candidates[0] ?? null;
  const toSendNow = primary ? [...passive, primary] : passive;
  const smsOptedOut = prefs.get('sms') === false;
  const fallback: NotifChannel | null = primary && primary !== 'sms' && !smsOptedOut ? 'sms' : null;
  return { toSendNow, primary, fallback };
}
