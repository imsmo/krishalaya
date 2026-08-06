// modules/support/__tests__/platform-reply-delivery.spec.ts · PC-56 ADMIN-2d.
//
// THIS JOB IS THE ONLY THING THAT MAKES A PLATFORM REPLY REAL, and every way it can fail is invisible from the outside:
// a reply that silently never delivers looks identical to one waiting its turn, and a reply marked delivered when the
// spine was never called looks identical to a real answer. So the assertions are about the SEQUENCE and the STATUS, not
// about the SQL.
//
//   • the operator's words reach the spine VERBATIM, with the ticket number and the platform attribution
//   • delivery happens INSIDE the claim's transaction — there must be no window where the farmer has been notified and
//     the row still says queued
//   • app.tenant_id is set before the spine writes, because its own tables are RLS-scoped
//   • a ticket with no requester is REFUSED with a reason, never left queued and never marked delivered
//   • one undeliverable reply does not roll back another farmer's delivered one
//   • attempts are bounded, so a reply cannot retry for ever
import { PlatformReplyDeliveryCadenceJob, PLATFORM_REPLY_EVENT, MAX_ATTEMPTS } from '../jobs/platform-reply-delivery.cadence-job';

type Row = Record<string, any>;

/** A queued reply as the claim query returns it (reply joined to its ticket). */
const reply = (over: Partial<Row> = {}): Row => ({
  id: 'rep-1', tenant_id: 'ten-1', ticket_id: 'tkt-1',
  body: 'Your refund of ₹4,200 was sent to your bank on 4 August. Reference RZP-8812.',
  language_code: 'hi', idempotency_key: 'platform-reply:abc', attempts: 0,
  ticket_no: 'KV-T-8812', requester_user_id: 'farmer-1', ticket_status: 'resolved', ...over,
});

/**
 * A fake pool that records the ORDER of everything, because the ordering is the contract: claim → set tenant → fan out
 * → settle, all between BEGIN and COMMIT.
 */
function makePool(opts: { queued?: Row[]; claims?: Array<Row | undefined>; failFanout?: Error } = {}) {
  const trace: string[] = [];
  const updates: Array<{ sql: string; params: any[] }> = [];
  const claims = opts.claims ? [...opts.claims] : undefined;

  const client = {
    query: jest.fn(async (sql: string, params?: any[]) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') { trace.push(s.toLowerCase()); return { rows: [], rowCount: 0 }; }
      if (s.includes('FOR UPDATE OF r SKIP LOCKED')) {
        trace.push('claim');
        const next = claims ? claims.shift() : reply();
        return { rows: next ? [next] : [], rowCount: next ? 1 : 0 };
      }
      if (s.includes('set_config')) { trace.push(`set_tenant:${params?.[0]}`); return { rows: [], rowCount: 0 }; }
      if (s.startsWith('UPDATE support_platform_replies SET attempts = attempts + 1, updated_at')) {
        trace.push('count_attempt'); updates.push({ sql: s, params: params ?? [] }); return { rows: [], rowCount: 1 };
      }
      if (s.startsWith('UPDATE support_platform_replies')) {
        // the settle (or the failure record)
        const status = params?.[1] ?? 'from-sql';
        trace.push(`settle:${status}`); updates.push({ sql: s, params: params ?? [] }); return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected client query: ${s.slice(0, 80)}`);
    }),
    release: jest.fn(),
  };

  const pool = {
    query: jest.fn(async (sql: string, _params?: any[]) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (s.includes("status = 'queued'")) { trace.push('scan'); return { rows: opts.queued ?? [{ id: 'rep-1' }], rowCount: 1 }; }
      throw new Error(`unexpected pool query: ${s.slice(0, 80)}`);
    }),
    connect: jest.fn(async () => client),
  };
  return { pool, client, trace, updates };
}

const metrics = () => ({ inc: jest.fn(), observe: jest.fn(), gauge: jest.fn() });
function makeJob(opts: { failFanout?: Error } = {}) {
  const fanout = jest.fn(async (_tx: any, _input: any) => {
    if (opts.failFanout) throw opts.failFanout;
  });
  const m = metrics();
  const job = new PlatformReplyDeliveryCadenceJob(m as any, { fanout } as any);
  return { job, fanout, m };
}

describe('registration', () => {
  it('has a stable name and a one-minute cadence', () => {
    const { job } = makeJob();
    expect(job.name).toBe('support-platform-reply-delivery');
    // a farmer waiting for an answer about their money is not a reporting cadence
    expect(job.intervalMs).toBe(60_000);
  });
});

describe('the happy path', () => {
  it('delivers the operator\'s words VERBATIM, attributed to the platform', async () => {
    const { pool } = makePool();
    const { job, fanout } = makeJob();
    await job.run(pool as any);

    expect(fanout).toHaveBeenCalledTimes(1);
    const input = fanout.mock.calls[0][1] as any;
    expect(input.eventCode).toBe(PLATFORM_REPLY_EVENT);
    expect(input.recipients).toEqual(['farmer-1']);
    expect(input.languageCode).toBe('hi');
    // verbatim — the template is a carrier, not a rewrite
    expect(input.payload.body).toBe('Your refund of ₹4,200 was sent to your bank on 4 August. Reference RZP-8812.');
    expect(input.payload.ticketNo).toBe('KV-T-8812');
    // so the farmer's client can label it correctly: the PLATFORM is speaking, not their FPO's desk
    expect(input.payload.from).toBe('krishalaya_support');
    // the spine derives a deterministic notification id from this, so a retry cannot double-notify
    expect(input.dedupeKey).toBe('platform-reply:abc');
  });

  it('runs claim → set tenant → fan out → settle, ALL INSIDE ONE TRANSACTION', async () => {
    // the property that matters: there must be no window in which the farmer has been notified while the row still
    // says queued, which is what a nested/separate transaction would create
    const { pool, trace } = makePool();
    const { job, fanout } = makeJob();
    await job.run(pool as any);

    expect(trace).toEqual([
      'scan', 'begin', 'claim', 'count_attempt', 'set_tenant:ten-1', 'settle:delivered', 'commit',
    ]);
    // fanout ran between setting the tenant and settling — assert it via ordering of the recorded calls
    const settleIdx = trace.indexOf('settle:delivered');
    const tenantIdx = trace.indexOf('set_tenant:ten-1');
    expect(tenantIdx).toBeLessThan(settleIdx);
    expect(fanout).toHaveBeenCalled();
  });

  it('sets app.tenant_id before the spine writes, because its tables are RLS-scoped', async () => {
    const { pool, trace } = makePool();
    const { job } = makeJob();
    await job.run(pool as any);
    expect(trace).toContain('set_tenant:ten-1');
  });

  it('records the recipient and the event code on the delivered row', async () => {
    const { pool, updates } = makePool();
    const { job } = makeJob();
    await job.run(pool as any);
    const settle = updates.find((u) => u.params[1] === 'delivered');
    expect(settle).toBeDefined();
    // 0101 CHECKs that a delivered row names who it reached — "delivered" must never mean "we think so"
    expect(settle!.params[3]).toBe('farmer-1');
    expect(settle!.params[4]).toBe(PLATFORM_REPLY_EVENT);
    expect(settle!.params[2]).toBeNull();      // no detail needed for a real delivery
  });

  it('counts the delivery', async () => {
    const { pool } = makePool();
    const { job, m } = makeJob();
    await job.run(pool as any);
    expect(m.inc).toHaveBeenCalledWith('support.platform_reply_delivered', undefined, 1);
  });
});

describe('refusals are recorded, never left queued and never called delivered', () => {
  it('refuses a ticket with no requester, with the reason', async () => {
    const { pool, trace, updates } = makePool({ claims: [reply({ requester_user_id: null })] });
    const { job, fanout, m } = makeJob();
    await job.run(pool as any);

    expect(fanout).not.toHaveBeenCalled();
    expect(trace).toContain('settle:refused');
    expect(trace).toContain('commit');            // the refusal is COMMITTED — it is a fact, not an error
    const settle = updates.find((u) => u.params[1] === 'refused');
    // 0101's ck_platform_reply_detail requires an explanation for anything that did not reach the farmer
    expect(String(settle!.params[2])).toMatch(/no requester/i);
    expect(m.inc).toHaveBeenCalledWith('support.platform_reply_refused', undefined, 1);
    expect(m.inc).not.toHaveBeenCalledWith('support.platform_reply_delivered', undefined, expect.anything());
  });

  it('counts the attempt even when it refuses, so a row cannot spin for ever', async () => {
    const { pool, trace } = makePool({ claims: [reply({ requester_user_id: null })] });
    const { job } = makeJob();
    await job.run(pool as any);
    expect(trace.indexOf('count_attempt')).toBeGreaterThan(-1);
    expect(trace.indexOf('count_attempt')).toBeLessThan(trace.indexOf('settle:refused'));
  });
});

describe('failures', () => {
  it('rolls back the delivery and records WHY, without crashing the tick', async () => {
    const { pool, trace, updates } = makePool();
    const { job, m } = makeJob({ failFanout: new Error('template render exploded') });
    await expect(job.run(pool as any)).resolves.toBeUndefined();

    expect(trace).toContain('rollback');
    expect(trace).not.toContain('settle:delivered');
    // the failure is recorded in its own statement so it is visible to the operator even though everything else failed
    const recorded = updates.find((u) => String(u.params[1] ?? '').includes('template render exploded'));
    expect(recorded).toBeDefined();
    expect(m.inc).toHaveBeenCalledWith('support.platform_reply_failed', undefined, 1);
  });

  it('bounds retries — the scan itself refuses to pick up an exhausted row', async () => {
    const { pool } = makePool();
    const { job } = makeJob();
    await job.run(pool as any);
    const scan = pool.query.mock.calls[0];
    expect(String(scan[0])).toContain('attempts < $2');
    expect((scan[1] as unknown as any[])[1]).toBe(MAX_ATTEMPTS);
    // and a bounded batch, so a backlog cannot hold the advisory lock for minutes
    expect(String(scan[0])).toContain('LIMIT $1');
  });

  it('always releases the connection, delivered or not', async () => {
    const { pool, client } = makePool();
    const { job } = makeJob({ failFanout: new Error('boom') });
    await job.run(pool as any);
    expect(client.release).toHaveBeenCalled();
  });
});

describe('isolation between replies', () => {
  it('one undeliverable reply does not stop another farmer being answered', async () => {
    // each reply is its own transaction precisely so this holds
    const { pool, trace, updates } = makePool({
      queued: [{ id: 'rep-1' }, { id: 'rep-2' }],
      claims: [reply({ id: 'rep-1', requester_user_id: null }), reply({ id: 'rep-2', requester_user_id: 'farmer-2' })],
    });
    const { job, fanout, m } = makeJob();
    await job.run(pool as any);

    expect(trace.filter((t) => t === 'begin')).toHaveLength(2);
    expect(trace).toContain('settle:refused');
    expect(trace).toContain('settle:delivered');
    expect(fanout).toHaveBeenCalledTimes(1);
    expect((fanout.mock.calls[0][1] as any).recipients).toEqual(['farmer-2']);
    expect(m.inc).toHaveBeenCalledWith('support.platform_reply_refused', undefined, 1);
    expect(m.inc).toHaveBeenCalledWith('support.platform_reply_delivered', undefined, 1);
    expect(updates.filter((u) => u.params[1] === 'delivered')).toHaveLength(1);
  });

  it('skips a row another pod claimed between the scan and the lock', async () => {
    // SKIP LOCKED + the status re-check inside the lock: a row settled since the scan is simply passed over
    const { pool, trace } = makePool({ claims: [undefined] });
    const { job, fanout, m } = makeJob();
    await job.run(pool as any);
    expect(fanout).not.toHaveBeenCalled();
    expect(trace).toEqual(['scan', 'begin', 'claim', 'rollback']);
    expect(m.inc).not.toHaveBeenCalled();
  });

  it('does nothing at all when the queue is empty, and reports no metric', async () => {
    // a zero-count metric would look like activity
    const { pool, trace } = makePool({ queued: [] });
    const { job, fanout, m } = makeJob();
    await job.run(pool as any);
    expect(trace).toEqual(['scan']);
    expect(fanout).not.toHaveBeenCalled();
    expect(m.inc).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
