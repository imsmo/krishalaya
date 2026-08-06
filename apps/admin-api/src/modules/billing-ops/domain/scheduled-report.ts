// apps/admin-api/src/modules/billing-ops/domain/scheduled-report.ts · pure rules for a SCHEDULED REPORT
// (PC-56 ADMIN-1e, closes ADMIN-1-Q9; tables in migration 0095). No I/O → unit-provable.
//
// The cadence arithmetic is duplicated in the worker job (`apps/worker/src/jobs/scheduled-reports.job.ts`) because the
// worker is pg-native by contract and cannot import from an API app. That duplication is deliberate and bounded: both
// encode the same three rules and BOTH are tested against the same cases, so a divergence fails a spec rather than
// quietly sending a Monday digest on Tuesday.
import { InvalidScheduledReportError } from './billing-ops.errors';

export const CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];
export function isCadence(v: string | null | undefined): v is Cadence {
  return !!v && (CADENCES as readonly string[]).includes(v);
}

/** IST is UTC+5:30 with no daylight saving, so the offset is a constant rather than a lookup. The platform operates on
 *  IST; storing the rule as "hour in IST" and computing UTC moments keeps the queue comparable to `now()` in the
 *  database without either side guessing a timezone. */
export const IST_OFFSET_MIN = 330;

export const MAX_RECIPIENTS = 20;
/** Deliberately simple: these are internal ops mailboxes, and an over-clever regex rejects valid addresses (a `+` tag,
 *  a long TLD) more often than it catches a typo. The real validation is that somebody receives it. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function assertRecipients(raw: readonly string[]): string[] {
  const list = [...new Set(raw.map((r) => r.trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) throw new InvalidScheduledReportError('at least one recipient is required');
  if (list.length > MAX_RECIPIENTS) throw new InvalidScheduledReportError(`at most ${MAX_RECIPIENTS} recipients`);
  const bad = list.filter((r) => !EMAIL_RE.test(r));
  if (bad.length) throw new InvalidScheduledReportError(`not an email address: ${bad.join(', ')}`);
  return list;
}

/** Weekly needs a weekday; daily and monthly must not carry one — a stale weekday on a monthly schedule is a lie a
 *  reader would act on, and the 0095 CHECK refuses it too. */
export function assertCadenceShape(cadence: Cadence, weekdayIso: number | null): number | null {
  if (cadence === 'weekly') {
    if (weekdayIso === null || !Number.isInteger(weekdayIso) || weekdayIso < 1 || weekdayIso > 7) {
      throw new InvalidScheduledReportError('a weekly schedule needs weekdayIso between 1 (Monday) and 7 (Sunday)');
    }
    return weekdayIso;
  }
  if (weekdayIso !== null) throw new InvalidScheduledReportError(`a ${cadence} schedule must not carry a weekday`);
  return null;
}

export function assertHour(hourIst: number): number {
  if (!Number.isInteger(hourIst) || hourIst < 0 || hourIst > 23) {
    throw new InvalidScheduledReportError('hourIst must be a whole hour between 0 and 23');
  }
  return hourIst;
}

/**
 * The next UTC moment this schedule should run.
 *
 * Reads "the next time the IST clock shows this hour on a matching day". A schedule created at 09:00 for 07:00 daily
 * runs TOMORROW, not in a minute — `<=` on the comparison is what makes that true, and getting it wrong would send a
 * digest immediately on every edit.
 */
export function nextRunAt(cadence: Cadence, hourIst: number, weekdayIso: number | null, from: Date): Date {
  const istNow = new Date(from.getTime() + IST_OFFSET_MIN * 60_000);
  const target = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), hourIst, 0, 0, 0));

  if (cadence === 'daily') {
    if (target.getTime() <= istNow.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  } else if (cadence === 'weekly') {
    const want = weekdayIso ?? 1;
    const have = istNow.getUTCDay() === 0 ? 7 : istNow.getUTCDay();   // ISO: Sunday is 7, not 0
    let delta = want - have;
    if (delta < 0 || (delta === 0 && target.getTime() <= istNow.getTime())) delta += 7;
    target.setUTCDate(target.getUTCDate() + delta);
  } else {
    target.setUTCDate(1);
    if (target.getTime() <= istNow.getTime()) target.setUTCMonth(target.getUTCMonth() + 1);
  }
  return new Date(target.getTime() - IST_OFFSET_MIN * 60_000);
}

/** Human summary of the rule, for the console and for the audit row — so the recorded reason says "every Monday at
 *  07:00 IST" rather than three columns a reader has to reassemble. */
export function describeSchedule(cadence: Cadence, hourIst: number, weekdayIso: number | null): string {
  const hh = `${String(hourIst).padStart(2, '0')}:00 IST`;
  if (cadence === 'daily') return `every day at ${hh}`;
  if (cadence === 'monthly') return `on the 1st of each month at ${hh}`;
  const days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return `every ${days[weekdayIso ?? 1]} at ${hh}`;
}

export const RUN_STATUSES = ['computed', 'sent', 'provider_pending', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Is a run's outcome a DELIVERY? `provider_pending` means the numbers were produced and nothing was sent — the
 *  console must never render that as a success tick, because somebody would then wait for an email that is not coming. */
export function wasDelivered(status: string | null | undefined): boolean { return status === 'sent'; }
