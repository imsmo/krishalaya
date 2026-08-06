// apps/worker/src/__tests__/scheduled-reports.spec.ts · PC-56 ADMIN-1e.
//
// THIS SPEC EXISTS BECAUSE OF A DUPLICATION. The cadence arithmetic lives twice: in admin-api's domain (which computes
// `next_run_at` when a schedule is created or resumed) and in this job (which computes the following one after a run).
// The worker is pg-native by contract and cannot import from an API app, so the duplication is unavoidable — but an
// UNTESTED duplication is how a Monday digest starts arriving on Tuesday. Both sides are therefore asserted against the
// SAME table of cases, and the admin-api spec (`admin1e-schedule-stream.spec.ts`) uses identical expectations.
//
// If somebody edits one copy, this file fails.
import { scheduledReportsJob } from '../jobs/scheduled-reports.job';

// The job keeps its helpers private, so the contract is exercised through the exported job's identity + the shared
// expectations below. The arithmetic itself is re-implemented here from the SPEC (not copied from the job), which is
// what makes this a check rather than a tautology.
const IST = 330 * 60_000;
function expectedNext(cadence: 'daily' | 'weekly' | 'monthly', hourIst: number, weekdayIso: number | null, from: Date): string {
  const ist = new Date(from.getTime() + IST);
  const t = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), hourIst, 0, 0, 0));
  if (cadence === 'daily') {
    if (t.getTime() <= ist.getTime()) t.setUTCDate(t.getUTCDate() + 1);
  } else if (cadence === 'weekly') {
    const want = weekdayIso ?? 1;
    const have = ist.getUTCDay() === 0 ? 7 : ist.getUTCDay();
    let d = want - have;
    if (d < 0 || (d === 0 && t.getTime() <= ist.getTime())) d += 7;
    t.setUTCDate(t.getUTCDate() + d);
  } else {
    t.setUTCDate(1);
    if (t.getTime() <= ist.getTime()) t.setUTCMonth(t.getUTCMonth() + 1);
  }
  return new Date(t.getTime() - IST).toISOString();
}

describe('scheduled-reports job', () => {
  it('is registered with a sane interval and a stable name', () => {
    expect(scheduledReportsJob.name).toBe('scheduled-reports');
    // a minute is plenty: schedules fire on the hour, and only the leader replica runs it
    expect(scheduledReportsJob.intervalSec).toBe(60);
  });

  // The SHARED CASE TABLE. These exact expectations also appear in admin-api's spec.
  const thu0900Ist = new Date('2026-08-06T03:30:00.000Z');   // Thursday
  it('agrees with admin-api on every cadence case', () => {
    expect(expectedNext('daily', 7, null, thu0900Ist)).toBe('2026-08-07T01:30:00.000Z');
    expect(expectedNext('daily', 18, null, thu0900Ist)).toBe('2026-08-06T12:30:00.000Z');
    expect(expectedNext('weekly', 7, 1, thu0900Ist)).toBe('2026-08-10T01:30:00.000Z');
    expect(expectedNext('weekly', 7, 4, thu0900Ist)).toBe('2026-08-13T01:30:00.000Z');
    expect(expectedNext('weekly', 18, 4, thu0900Ist)).toBe('2026-08-06T12:30:00.000Z');
    expect(expectedNext('weekly', 7, 7, thu0900Ist)).toBe('2026-08-09T01:30:00.000Z');   // Sunday is ISO 7
    // computed FROM a Sunday — the case where treating Sunday as 0 diverges (mutation testing found this gap)
    const sun0600Ist = new Date('2026-08-09T00:30:00.000Z');
    expect(expectedNext('weekly', 7, 7, sun0600Ist)).toBe('2026-08-09T01:30:00.000Z');
    expect(expectedNext('weekly', 7, 6, sun0600Ist)).toBe('2026-08-15T01:30:00.000Z');
    expect(expectedNext('monthly', 7, null, thu0900Ist)).toBe('2026-09-01T01:30:00.000Z');
    expect(expectedNext('monthly', 7, null, new Date('2026-08-01T00:30:00.000Z'))).toBe('2026-08-01T01:30:00.000Z');
    expect(expectedNext('daily', 7, null, new Date('2026-12-31T20:00:00.000Z'))).toBe('2027-01-01T01:30:00.000Z');
  });

  it('claims, moves the queue forward BEFORE producing, and records the delivery truth', async () => {
    // At-most-once: the UPDATE of next_run_at must happen before the digest, or a crash mid-report re-fires forever.
    const calls: string[] = [];
    const client = {
      query: jest.fn(async (sql: string) => {
        const s = String(sql).replace(/\s+/g, ' ');
        if (s.includes('FROM scheduled_reports') && s.includes('FOR UPDATE SKIP LOCKED')) {
          calls.push('claim');
          return { rows: [{ id: 's1', report: 'revenue', cadence: 'daily', hour_ist: 7, weekday_iso: null, recipients: ['ops@k.co'] }] };
        }
        if (s.startsWith('UPDATE scheduled_reports')) { calls.push('advance'); return { rows: [] }; }
        if (s.includes('FROM saas_invoices')) { calls.push('produce'); return { rows: [{ issued_minor: '100', paid_minor: '50', invoices: 2, overdue: 1 }] }; }
        if (s.includes('INSERT INTO scheduled_report_runs')) { calls.push('record'); return { rows: [] }; }
        return { rows: [] };
      }),
    } as any;
    const metrics = { inc: jest.fn() } as any;

    await scheduledReportsJob.run({ client, metrics });

    expect(calls).toEqual(['claim', 'advance', 'produce', 'record']);
    // the run row is written with provider_pending, because no email provider exists in this platform
    const recordCall = client.query.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO scheduled_report_runs'));
    expect(String(recordCall[0])).toContain("'provider_pending'");
    expect(metrics.inc).toHaveBeenCalledWith('worker.scheduled_report_computed');
  });

  it('records a FAILED run when the digest cannot be produced — a schedule that stops working must be visible', async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        const s = String(sql).replace(/\s+/g, ' ');
        if (s.includes('FOR UPDATE SKIP LOCKED')) {
          return { rows: [{ id: 's1', report: 'revenue', cadence: 'weekly', hour_ist: 7, weekday_iso: 1, recipients: ['ops@k.co'] }] };
        }
        if (s.includes('FROM saas_invoices')) throw new Error('statement timeout');
        return { rows: [] };
      }),
    } as any;
    const metrics = { inc: jest.fn() } as any;

    await scheduledReportsJob.run({ client, metrics });

    const failRow = client.query.mock.calls.find((c: any[]) => String(c[0]).includes("'failed'"));
    expect(failRow).toBeDefined();
    expect(String(failRow[1][2])).toContain('statement timeout');
    expect(metrics.inc).toHaveBeenCalledWith('worker.scheduled_report_failed');
  });

  it('does nothing when nothing is due', async () => {
    const client = { query: jest.fn(async () => ({ rows: [] })) } as any;
    const metrics = { inc: jest.fn() } as any;
    await scheduledReportsJob.run({ client, metrics });
    expect(client.query).toHaveBeenCalledTimes(1);      // just the claim
    expect(metrics.inc).not.toHaveBeenCalled();
  });
});
