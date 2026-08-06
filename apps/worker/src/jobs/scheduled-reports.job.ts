// apps/worker/src/jobs/scheduled-reports.job.ts · runs the platform's SCHEDULED REPORTS (PC-56 ADMIN-1e, closes
// ADMIN-1-Q9). pg-native and bounded, like every job in this runtime.
//
// WHY THIS JOB IS THE FEATURE. ADMIN-1d deferred "schedule a report by email" on the grounds that a schedule button
// which silently never fires is the worst version of it. So the deferral is repaid here first: this job is what fires,
// and every firing writes a RUN ROW saying what was produced, for whom, and whether it actually went out.
//
// THE DELIVERY TRUTH IS RECORDED HONESTLY. This platform has no email provider (there is an SMS sender in
// apps/api/src/core/auth and nothing for email), so a run ends `provider_pending` with the reason in words — not
// `sent`. The digest is computed and stored either way, so when a provider is wired the only change is the delivery
// leg; nothing about the schedule or the numbers moves. An operator reading the run history sees the truth today:
// "computed on Monday 07:00, not delivered, no email provider configured".
//
// AT-MOST-ONCE, DELIBERATELY. `next_run_at` is pushed forward BEFORE the digest is produced, inside the claiming
// transaction. If the process dies mid-report the schedule has already moved on: the run is missed, not repeated. For a
// digest that is the right default — a missed weekly summary is an annoyance, a mail loop is an incident — and the
// unique index on (schedule, period) is the second belt.
//
// The SQL lives here rather than calling admin-api because this runtime is pg-native by contract (see
// WORKER-RUNTIME.md): a job that needed an HTTP call to another service would need a machine credential for it, which
// is a bigger security surface than a SELECT.
import { Job, JobCtx } from './index';

/** Bounded per tick: a burst of schedules must not hold the leader lock for minutes. */
const CLAIM_LIMIT = 20;

/** Cadence → the next moment this schedule should run, in UTC, from a base time. Mirrors the pure helper in
 *  admin-api's domain (`scheduled-report.ts`) — the two agree by construction because both encode the same three
 *  rules, and both are unit-tested against the same cases. */
function nextRunAt(cadence: string, hourIst: number, weekdayIso: number | null, from: Date): Date {
  // IST is UTC+5:30 with no daylight saving, so the offset is a constant. Doing this arithmetic in UTC keeps the
  // stored queue comparable to `now()` in the database without either side guessing a timezone.
  const IST_OFFSET_MIN = 330;
  const istNow = new Date(from.getTime() + IST_OFFSET_MIN * 60_000);
  const target = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), hourIst, 0, 0, 0));

  if (cadence === 'daily') {
    if (target.getTime() <= istNow.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  } else if (cadence === 'weekly') {
    const want = weekdayIso ?? 1;                       // ISO 1=Mon..7=Sun
    const have = istNow.getUTCDay() === 0 ? 7 : istNow.getUTCDay();
    let delta = want - have;
    if (delta < 0 || (delta === 0 && target.getTime() <= istNow.getTime())) delta += 7;
    target.setUTCDate(target.getUTCDate() + delta);
  } else {
    // monthly: the 1st
    target.setUTCDate(1);
    if (target.getTime() <= istNow.getTime()) target.setUTCMonth(target.getUTCMonth() + 1);
  }
  return new Date(target.getTime() - IST_OFFSET_MIN * 60_000);
}

/** The period a run covers, so two runs of one schedule are distinguishable and a re-run is detectable. */
function periodFor(cadence: string, at: Date): { start: string; end: string } {
  const d = new Date(at.getTime());
  const ymd = (x: Date) => x.toISOString().slice(0, 10);
  if (cadence === 'daily') {
    const start = new Date(d.getTime() - 86_400_000);
    return { start: ymd(start), end: ymd(start) };
  }
  if (cadence === 'weekly') {
    const end = new Date(d.getTime() - 86_400_000);
    const start = new Date(end.getTime() - 6 * 86_400_000);
    return { start: ymd(start), end: ymd(end) };
  }
  const firstOfThis = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(firstOfThis.getTime() - 86_400_000);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return { start: ymd(start), end: ymd(end) };
}

export const scheduledReportsJob: Job = {
  name: 'scheduled-reports',
  // A minute is plenty: schedules fire on the hour, and the leader lock means only one replica does this.
  intervalSec: 60,

  async run({ client, metrics }: JobCtx): Promise<void> {
    // 1. CLAIM. Due, active schedules — locked and moved forward in the same transaction so a crash cannot re-fire.
    const due = await client.query(
      `SELECT id, report, cadence::text AS cadence, hour_ist, weekday_iso, recipients
         FROM scheduled_reports
        WHERE is_active AND deleted_at IS NULL AND next_run_at IS NOT NULL AND next_run_at <= now()
        ORDER BY next_run_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`, [CLAIM_LIMIT]);

    for (const row of due.rows as Array<Record<string, any>>) {
      const now = new Date();
      const period = periodFor(String(row.cadence), now);
      const next = nextRunAt(String(row.cadence), Number(row.hour_ist), row.weekday_iso === null ? null : Number(row.weekday_iso), now);

      // Push the queue forward FIRST (at-most-once — see the header).
      await client.query(
        `UPDATE scheduled_reports SET next_run_at = $2, last_run_at = now(), updated_at = now() WHERE id = $1`,
        [row.id, next]);

      try {
        // 2. PRODUCE the digest. Plain bounded SQL over the period — the same shape the console's revenue series uses,
        //    so the emailed numbers and the on-screen numbers cannot disagree.
        const summary = await client.query(
          `SELECT COALESCE(SUM(total_minor), 0)::text AS issued_minor,
                  COALESCE(SUM(paid_minor), 0)::text  AS paid_minor,
                  count(*)::int                        AS invoices,
                  count(*) FILTER (WHERE status = 'overdue')::int AS overdue
             FROM saas_invoices
            WHERE deleted_at IS NULL AND status <> 'void'
              AND created_at >= $1::date AND created_at < ($2::date + interval '1 day')`,
          [period.start, period.end]);
        const s = summary.rows[0] ?? {};

        // 3. RECORD the run, with the delivery truth. No email provider exists in this platform yet, so the honest
        //    status is `provider_pending` — the digest is real, the delivery is not, and the row says which.
        await client.query(
          `INSERT INTO scheduled_report_runs
             (schedule_id, status, summary, row_count, recipients, detail, period_start, period_end)
           VALUES ($1, 'provider_pending', $2::jsonb, $3, $4, $5, $6::date, $7::date)
           ON CONFLICT DO NOTHING`,
          [row.id,
           JSON.stringify({ report: row.report, issuedMinor: s.issued_minor ?? '0', paidMinor: s.paid_minor ?? '0', invoices: s.invoices ?? 0, overdue: s.overdue ?? 0 }),
           Number(s.invoices ?? 0), row.recipients,
           'computed but not delivered: no email provider is configured in this deployment',
           period.start, period.end]);

        metrics.inc('worker.scheduled_report_computed');
      } catch (e) {
        // A failure to PRODUCE is recorded too — a schedule that quietly stops working is exactly what the run history
        // exists to make visible.
        await client.query(
          `INSERT INTO scheduled_report_runs
             (schedule_id, status, summary, row_count, recipients, detail, period_start, period_end)
           VALUES ($1, 'failed', '{}'::jsonb, 0, $2, $3, $4::date, $5::date)
           ON CONFLICT DO NOTHING`,
          [row.id, row.recipients, `report could not be produced: ${e instanceof Error ? e.message : 'unknown error'}`,
           period.start, period.end]).catch(() => undefined);
        metrics.inc('worker.scheduled_report_failed');
      }
    }
  },
};
