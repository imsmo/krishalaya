// modules/group-lots/__tests__/store3c-deadline.spec.ts · PC-56 STORE-3c · B8 (founder D3) — THE GROUP-LOT DEADLINE CLOCK, without Postgres:
//   (1) THE REGISTRY GATE: the REAL AppModule is constructed (no database dialled — the HOTFIX-5 gate's shape), GroupLotsModule's onModuleInit
//       runs, and SCHEDULED_JOB_REGISTRY holds `group-lots-deadline` at the cadence table's interval (core/jobs/clock-cadence.ts) — once;
//   (2) the pure rule: still `pledging`, the deadline PASSED, short of the target → due; ready / listed / sold / settled / cancelled, a deadline
//       not yet passed, or a lot at its target → never;
//   (3) the job: tenants from the runner's pool (the ONLY kv_relay read), the claim and every act per tenant through the service; one failure
//       never stops the rest; a second tick acts on nothing.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../../core/jobs/scheduled-job.registry';
import { CLOCK_CADENCE_MS } from '../../../core/jobs/clock-cadence';
import { UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { deadlineCancelDue, GROUP_LOT_DEADLINE_REASON, GROUP_LOT_DEADLINE_STATUSES } from '../domain/deadline';
import { GroupLotDeadlineJob, GROUP_LOT_DEADLINE_JOB } from '../jobs/deadline.job';

describe('PC-56 STORE-3c · (1) the group-lot deadline clock is in SCHEDULED_JOB_REGISTRY at the table\'s cadence', () => {
  const env = { ...process.env };
  let app: INestApplication | undefined;
  beforeAll(() => {
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'store3c-gate-access-secret-store3c-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'store3c-gate-hash-pepper-store3c-32b';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://kv_app:unused@127.0.0.1:1/store3c_never_dialled';
  });
  afterAll(async () => { await app?.close().catch(() => undefined); process.env = env; });

  it('GroupLotsModule registers `group-lots-deadline` once, at 15 min', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../../../app.module') as typeof import('../../../app.module');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GroupLotsModule } = require('../group-lots.module') as typeof import('../group-lots.module');
    app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
    app.get(GroupLotsModule, { strict: false }).onModuleInit();
    const jobs = app.get<ScheduledJobRegistry>(SCHEDULED_JOB_REGISTRY, { strict: false });
    const mine = jobs.list().filter((j) => j.name === GROUP_LOT_DEADLINE_JOB);
    expect(mine).toHaveLength(1);
    expect(mine[0].intervalMs).toBe(CLOCK_CADENCE_MS['group-lots-deadline']);
    expect(CLOCK_CADENCE_MS['group-lots-deadline']).toBe(15 * 60_000);
  }, 120_000);
});

describe('PC-56 STORE-3c · (2) the pure rule (domain/deadline.ts)', () => {
  const now = new Date('2026-10-16T10:00:00Z');
  const lot = (o: Record<string, string>) => ({ status: 'pledging', pledgeDeadline: '2026-10-16T09:59:59Z', pledgedQuantity: '148.000', targetQuantity: '200.000', ...o });
  it('pledging + past the deadline + short of the target → due; the reason is `target_missed`; only `pledging` is ever swept', () => {
    expect(deadlineCancelDue(lot({}), now)).toBe(true);
    expect(GROUP_LOT_DEADLINE_REASON).toBe('target_missed');
    expect([...GROUP_LOT_DEADLINE_STATUSES]).toEqual(['pledging']);
  });
  it('never: a ready / listed / sold / settled / cancelled lot; a deadline not yet passed (or exactly now); a lot at its target', () => {
    for (const status of ['ready', 'listed', 'sold', 'settled', 'cancelled']) expect([status, deadlineCancelDue(lot({ status }), now)]).toEqual([status, false]);
    expect(deadlineCancelDue(lot({ pledgeDeadline: '2026-10-16T10:00:01Z' }), now)).toBe(false);
    expect(deadlineCancelDue(lot({ pledgeDeadline: '2026-10-16T10:00:00Z' }), now)).toBe(false);
    expect(deadlineCancelDue(lot({ pledgedQuantity: '200.000' }), now)).toBe(false);
    expect(deadlineCancelDue(lot({ pledgedQuantity: '200.001' }), now)).toBe(false);
    expect(deadlineCancelDue(lot({ pledgeDeadline: 'not a date' }), now)).toBe(false);
  });
});

describe('PC-56 STORE-3c · (3) the job: kv_relay lists tenants, kv_app claims and acts per lot', () => {
  class FakeTx implements TxContext { constructor(readonly tenantId: string) {} async query<T = any>(): Promise<{ rows: T[]; rowCount: number }> { return { rows: [], rowCount: 0 }; } }   // eslint-disable-line @typescript-eslint/no-explicit-any
  class FakeUow extends UnitOfWork { runs: string[] = []; async run<T>(t: string, fn: (tx: TxContext) => Promise<T>): Promise<T> { this.runs.push(t); return fn(new FakeTx(t)); } }
  it('tenants from the pool; the claim per tenant in kv_app; each lot acted on through the service; a failure is counted, never stops the rest', async () => {
    const uow = new FakeUow();
    const due: Record<string, string[]> = { t1: ['l1', 'l2'], t2: ['l3'] };
    const closed = new Set<string>();
    const repo = { tenantsWithDueDeadline: async () => ['t1', 't2'], dueAtDeadline: async (_tx: TxContext, t: string) => (due[t] ?? []).filter((x) => !closed.has(x)) };
    const lots = { cancelAtDeadline: async (_t: string, id: string) => { if (id === 'l2') throw new Error('boom'); if (closed.has(id)) return false; closed.add(id); return true; } };
    const job = new GroupLotDeadlineJob(CLOCK_CADENCE_MS['group-lots-deadline'], uow, repo as never, lots as never);
    expect(job.name).toBe('group-lots-deadline');
    expect(await job.sweep({} as Pool)).toEqual({ tenants: 2, claimed: 3, acted: 2, failed: 1 });
    expect(uow.runs).toEqual(['t1', 't2']);
    expect(await job.sweep({} as Pool)).toEqual({ tenants: 2, claimed: 1, acted: 0, failed: 1 });   // the second tick: only the failed lot is still due
    expect(await job.sweep({} as Pool, new Date(), ['t2'])).toEqual({ tenants: 1, claimed: 0, acted: 0, failed: 0 });
  });
});
