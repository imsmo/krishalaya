// apps/mobile/src/features/labour/worker-home.ts · PURE presentation logic for the worker home dashboard (screen
// 29). No React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. These only shape/count what the
// server already returned; the SERVER remains the authority on offers, confirmations, wages, and the wage floor.
// Money stays as bigint minor-unit strings elsewhere (Law 2) — nothing here coerces a wage to a float.
import type { LabourAssignment, LabourBooking, LabourLookups } from '@krishalaya/sdk-js';

/** Initials for the greeting avatar (design "SK"): the first letters of the first two name-words, uppercased
 * (≤2 chars). Falls back to the given char when the name is empty/blank. Pure. */
export function initials(name: string | undefined | null, fallback = 'K'): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return fallback;
  return words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
}

/** How many of the worker's assignments are OFFERS still awaiting a response (design "N Pending · job offers
 * awaiting response"). Pure. */
export function pendingOfferCount(offers: readonly LabourAssignment[]): number {
  return (offers ?? []).reduce((n, a) => n + (a.status === 'pending_worker' ? 1 : 0), 0);
}

/** How many assignments are CONFIRMED (accepted) upcoming jobs. The design labels this "N Tomorrow", but the
 * assignment read doesn't carry the booking's start date, so we can't isolate *tomorrow* without an N+1 fetch
 * (§13) — we count confirmed bookings and label them honestly ("confirmed bookings") rather than fake a date
 * filter. Pure. */
export function confirmedCount(assignments: readonly LabourAssignment[]): number {
  return (assignments ?? []).reduce((n, a) => n + (a.status === 'accepted' ? 1 : 0), 0);
}

/** Emoji for a nearby-job card, chosen from the task/skill name (design uses 🌾/🌱/💧…). A generic 🧺 fallback keeps
 * an unanticipated skill rendering rather than blank. Pure. */
export function taskEmoji(name: string | null | undefined): string {
  const s = (name ?? '').toLowerCase();
  if (/harvest|wheat|reap|कटाई|गेहूं|લણણી/.test(s)) return '🌾';
  if (/sow|plant|seed|transplant|बुवाई|रोपण|વાવણી/.test(s)) return '🌱';
  if (/irrig|water|सिंचाई|पानी|સિંચાઈ/.test(s)) return '💧';
  if (/spray|pest|छिड़काव|છંટકાવ/.test(s)) return '💦';
  if (/weed|निराई|નીંદણ/.test(s)) return '🌿';
  if (/load|transport|ढुलाई|પરિવહન/.test(s)) return '📦';
  return '🧺';
}

/** Resolve a booking's task-skill id to a localized label via the lookups catalogue; null when unknown/absent
 * (§13 → the screen shows a generic "Farm work" label rather than an opaque id). Pure. */
export function skillLabel(booking: Pick<LabourBooking, 'taskSkillId'>, lookups: LabourLookups | null): string | null {
  if (!booking.taskSkillId || !lookups) return null;
  return lookups.skills.find((s) => s.id === booking.taskSkillId)?.name ?? null;
}

/** Resolve a booking's demand-type id to a localized work-type label via the lookups catalogue; null when
 * unknown/absent (job-detail "Work type" row). Pure. */
export function workTypeLabel(booking: Pick<LabourBooking, 'demandTypeId'>, lookups: LabourLookups | null): string | null {
  if (!booking.demandTypeId || !lookups) return null;
  return lookups.workTypes.find((w) => w.id === booking.demandTypeId)?.name ?? null;
}
