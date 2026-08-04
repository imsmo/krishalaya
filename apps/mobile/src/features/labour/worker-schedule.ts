// apps/mobile/src/features/labour/worker-schedule.ts · PURE tab/section logic for the worker "My Schedule" screen
// (screen 32). No React / no SDK I/O (SDK types are `import type` → erased) → unit-tested. Buckets the worker's own
// assignments into Upcoming / Past / Cancelled and (for upcoming) into Today / Tomorrow / This week / Later by the
// booking's start date. These only classify what the server returned; the SERVER stays the authority on statuses.
import type { LabourAssignment, LabourBooking } from '@krishalaya/sdk-js';

/** One row = an assignment plus its (optionally still-loading/absent) booking for date/task context. */
export interface ScheduledJob { assignment: LabourAssignment; booking: LabourBooking | null }

export type ScheduleTab = 'upcoming' | 'past' | 'cancelled';
export const SCHEDULE_TABS: readonly ScheduleTab[] = ['upcoming', 'past', 'cancelled'];

/** Which schedule tab an assignment belongs to — or null for statuses that aren't scheduled work (an unanswered
 * OFFER `pending_worker`, or a self-`applied` interest that isn't confirmed yet; those live in the Offers tab). Pure. */
export function scheduleTab(status: string): ScheduleTab | null {
  switch (status) {
    case 'accepted': case 'in_progress': case 'confirmed': return 'upcoming';
    case 'paid': case 'completed': return 'past';
    case 'rejected': case 'expired': case 'cancelled': return 'cancelled';
    default: return null; // pending_worker / applied / unknown → not on the schedule
  }
}

/** Assignments belonging to a tab (order preserved). Pure. */
export function filterByTab(items: readonly ScheduledJob[], tab: ScheduleTab): ScheduledJob[] {
  return (items ?? []).filter((it) => scheduleTab(it.assignment.status) === tab);
}

/** Live counts per tab (design shows Upcoming (5) / Past (187) / Cancelled (2)). Pure. */
export function tabCounts(items: readonly ScheduledJob[]): Record<ScheduleTab, number> {
  const out: Record<ScheduleTab, number> = { upcoming: 0, past: 0, cancelled: 0 };
  for (const it of items ?? []) { const tb = scheduleTab(it.assignment.status); if (tb) out[tb] += 1; }
  return out;
}

export type DaySection = 'today' | 'tomorrow' | 'week' | 'later';
export const DAY_SECTIONS: readonly DaySection[] = ['today', 'tomorrow', 'week', 'later'];
function dayKey(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }

/** Which day-section a scheduled job sits in, by its booking's start date. No booking / unparseable → 'later'. Pure. */
export function daySection(booking: LabourBooking | null, nowMs: number = Date.now()): DaySection {
  const t = booking ? Date.parse(booking.startDate) : NaN;
  if (Number.isNaN(t)) return 'later';
  const d = dayKey(t);
  if (d === dayKey(nowMs)) return 'today';
  if (d === dayKey(nowMs + 86400000)) return 'tomorrow';
  if (t > nowMs && t <= nowMs + 7 * 86400000) return 'week';
  return 'later';
}

/** Group the UPCOMING jobs into ordered Today / Tomorrow / This-week / Later sections, sorted soonest-first within
 * each, dropping empty sections. Pure. */
export function groupUpcoming(items: readonly ScheduledJob[], nowMs: number = Date.now()): Array<{ key: DaySection; items: ScheduledJob[] }> {
  const upcoming = filterByTab(items, 'upcoming');
  const start = (it: ScheduledJob) => { const t = it.booking ? Date.parse(it.booking.startDate) : NaN; return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t; };
  const buckets: Record<DaySection, ScheduledJob[]> = { today: [], tomorrow: [], week: [], later: [] };
  for (const it of upcoming) buckets[daySection(it.booking, nowMs)].push(it);
  return DAY_SECTIONS
    .map((k) => ({ key: k, items: [...buckets[k]].sort((a, b) => start(a) - start(b)) }))
    .filter((s) => s.items.length > 0);
}

/** Is this scheduled job actively in progress (drives the "IN PROGRESS · View active job" affordance)? Pure. */
export function isActiveNow(it: ScheduledJob): boolean {
  return it.assignment.status === 'in_progress' || it.booking?.status === 'in_progress';
}
