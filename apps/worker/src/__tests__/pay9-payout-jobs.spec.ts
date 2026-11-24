// apps/worker/src/__tests__/pay9-payout-jobs.spec.ts · PC-56 PAY-9.
// The two payout safety checks were written in apps/api and never scheduled. These pin what makes them worth running:
//   • both are REGISTERED (the original defect was existing-but-never-run);
//   • the queue monitor counts only payouts the executor may claim — a batch held for approval is the 0114 gate working;
//   • the daily recon runs at most once per UTC day, and a re-tick re-exports gauges from the recorded run;
//   • only the three money-path reasons make a run 'mismatch'; the known loan/co-op gap is reported, never paged;
//   • no recorded run at all reads as STALE, never fresh.
// Live proof (kv_relay on a database built from empty, 0241 applied) is in the PAY-9 log entry.
import { JOBS } from '../registry';
import { payoutQueueMonitorJob, QUEUED_SLA_MINUTES, PROCESSING_SLA_MINUTES } from '../jobs/payout-queue-monitor.job';
import { payoutGatewayReconJob, PAGE_REASONS, WARN_REASONS } from '../jobs/payout-gateway-recon.job';

type Row = Record<string, unknown>;
const norm = (s: string) => String(s).replace(/\s+/g, ' ');

function metrics() {
  const g = new Map<string, number>();
  return { g, m: { setGauge: (n: string, v: number, l?: Record<string, string>) => g.set(l ? `${n}{${l.reason}}` : n, v), inc: jest.fn(), observe: jest.fn() } };
}

describe('PAY-9 · registry', () => {
  it('schedules both payout checks', () => {
    const names = JOBS.map((j) => j.name);
    expect(names).toEqual(expect.arrayContaining(['payout-queue-monitor', 'payout-gateway-recon']));
    expect(payoutQueueMonitorJob.intervalSec).toBe(300);
    expect(payoutGatewayReconJob.intervalSec).toBe(3600);
  });
});

describe('PAY-9 · payout-queue-monitor', () => {
  it('counts claimable payouts only, with the executor\'s own predicate, and writes no row', async () => {
    const sqls: string[] = []; let params: unknown[] = [];
    const client = { query: jest.fn(async (sql: string, p?: unknown[]) => {
      sqls.push(norm(sql)); params = p ?? [];
      return { rows: [{ queued_stuck: '2', processing_stuck: '1', oldest_claimable_mins: '47' }], rowCount: 1 };
    }) };
    const { g, m } = metrics();
    await payoutQueueMonitorJob.run({ client: client as never, metrics: m as never });
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain("b.status IN ('approved','executing')");      // a batch awaiting approval is not a stall
    expect(sqls[0]).toContain("rides_batch");                               // unbatched rides_batch purposes are never claimable
    expect(sqls[0]).toContain('COALESCE(b.approved_at, p.created_at)');      // the clock starts at approval
    expect(sqls[0]).toMatch(/status = 'processing' AND updated_at </);       // processing age from entering processing
    expect(sqls.some((s) => /INSERT|UPDATE|DELETE/.test(s))).toBe(false);
    expect(params).toEqual([QUEUED_SLA_MINUTES, PROCESSING_SLA_MINUTES]);
    expect(g.get('kv_payout_queued_stuck')).toBe(2);
    expect(g.get('kv_payout_processing_stuck')).toBe(1);
    expect(g.get('kv_payout_oldest_claimable_minutes')).toBe(47);
  });
});

describe('PAY-9 · payout-gateway-recon', () => {
  function client(opts: { ranToday: boolean; found?: Row[]; latest?: Row | null }) {
    const inserts: unknown[][] = [];
    let recorded: Row | null = opts.latest ?? null;
    const c = { query: jest.fn(async (sql: string, p?: unknown[]) => {
      const s = norm(sql);
      if (s.includes("run_type = 'daily_gateway' AND created_at >=")) return { rows: [{ n: opts.ranToday ? '1' : '0' }], rowCount: 1 };
      if (s.includes('FROM payouts WHERE status NOT IN')) return { rows: opts.found ?? [], rowCount: (opts.found ?? []).length };
      if (s.startsWith('SELECT count(*)::text AS n FROM payouts')) return { rows: [{ n: '42' }], rowCount: 1 };
      if (s.includes('INSERT INTO reconciliation_runs')) {
        inserts.push(p ?? []);
        recorded = { mismatches: JSON.parse(String((p ?? [])[2])), age: '0' };
        return { rows: [], rowCount: 1 };
      }
      if (s.includes('ORDER BY created_at DESC LIMIT 1')) return { rows: recorded ? [recorded] : [], rowCount: recorded ? 1 : 0 };
      throw new Error(`unexpected query: ${s.slice(0, 80)}`);
    }) };
    return { c, inserts };
  }

  it('records a mismatch run and pages per reason when the money path is broken', async () => {
    const { c, inserts } = client({ ranToday: false, found: [
      { id: 'p1', tenant_id: 't', reason: 'settled_without_gateway' },
      { id: 'p2', tenant_id: 't', reason: 'stuck_processing' },
      { id: 'p3', tenant_id: 't', reason: 'unreserved_batch_payout' },
    ] });
    const { g, m } = metrics();
    await payoutGatewayReconJob.run({ client: c as never, metrics: m as never });
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toBe('mismatch');
    expect(inserts[0][1]).toBe(42);                                        // honest denominator
    expect(g.get('kv_payout_recon_mismatches{settled_without_gateway}')).toBe(1);
    expect(g.get('kv_payout_recon_mismatches{stuck_processing}')).toBe(1);
    expect(g.get('kv_payout_recon_mismatches{reservation_missing}')).toBe(0); // every reason exported, zeros included
    expect(g.get('kv_payout_recon_mismatches{unreserved_batch_payout}')).toBe(1);
    expect(g.get('kv_payout_recon_age_seconds')).toBe(0);
  });

  it('the known loan/co-op gap alone is an ok run (reported, never paged)', async () => {
    const { c, inserts } = client({ ranToday: false, found: [{ id: 'p3', tenant_id: 't', reason: 'unreserved_batch_payout' }] });
    await payoutGatewayReconJob.run({ client: c as never, metrics: metrics().m as never });
    expect(inserts[0][0]).toBe('ok');
    expect(PAGE_REASONS).not.toContain('unreserved_batch_payout');
    expect(WARN_REASONS).toEqual(['unreserved_batch_payout']);
  });

  it('runs at most once per UTC day; a re-tick re-exports the recorded run', async () => {
    const { c, inserts } = client({ ranToday: true, latest: { mismatches: [{ reason: 'reservation_missing' }], age: '3600.4' } });
    const { g, m } = metrics();
    await payoutGatewayReconJob.run({ client: c as never, metrics: m as never });
    expect(inserts).toHaveLength(0);
    expect(g.get('kv_payout_recon_mismatches{reservation_missing}')).toBe(1);
    expect(g.get('kv_payout_recon_age_seconds')).toBe(3600);
  });

  it('no recorded run at all reads as stale (two days), never fresh', async () => {
    const { c } = client({ ranToday: true, latest: null });
    const { g, m } = metrics();
    await payoutGatewayReconJob.run({ client: c as never, metrics: m as never });
    expect(g.get('kv_payout_recon_age_seconds')).toBe(172_800);
  });
});
