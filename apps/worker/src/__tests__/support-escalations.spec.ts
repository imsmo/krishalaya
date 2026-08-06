// apps/worker/src/__tests__/support-escalations.spec.ts · PC-56 ADMIN-2b.
//
// THIS JOB IS THE ONLY THING THAT MAKES AN SLA REAL. Before it, a breach paged nobody — the ADMIN-2 escalation screen
// had to say so in words. So the properties asserted here are the ones whose failure is invisible on every screen:
//   • it fires NOTHING when no policy is published (rather than inventing a default and ringing somebody arbitrary)
//   • a step fires at its delay INCLUSIVELY (the "At breach" step is afterMinutes 0 — a strict comparison would mean
//     the P0 chain never starts, and the board would look identical)
//   • the two breach kinds escalate INDEPENDENTLY (they are different promises to the same farmer)
//   • the delivery truth is recorded per channel: in_app is `recorded`, everything else `provider_pending` WITH a
//     reason, never `sent` — a desk lead must not believe somebody was rung when nothing can ring
//   • ON CONFLICT DO NOTHING is present, which is what stops a re-run paging the support head twice at 02:00
import { supportEscalationsJob } from '../jobs/support-escalations.job';

type Row = Record<string, any>;

/** A fake pg client that answers the job's three shapes of query and records every INSERT it is given. */
function makeClient(opts: { policy?: Row[]; steps?: Row[]; breached?: Row[] }) {
  const inserts: Array<{ sql: string; params: any[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, params?: any[]) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (s.includes('FROM support_policies')) {
        const rows = opts.policy ?? [{ id: 'pol-1' }];
        return { rows, rowCount: rows.length };
      }
      if (s.includes('FROM support_policy_escalations')) {
        const rows = opts.steps ?? [];
        return { rows, rowCount: rows.length };
      }
      if (s.includes('FROM support_tickets')) {
        const rows = opts.breached ?? [];
        return { rows, rowCount: rows.length };
      }
      if (s.includes('INSERT INTO support_escalation_events')) {
        inserts.push({ sql: s, params: params ?? [] });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected query: ${s.slice(0, 90)}`);
    }),
  };
  return { client, inserts };
}

const metrics = () => ({ inc: jest.fn(), observe: jest.fn(), gauge: jest.fn() });
const run = (client: any, m: any) => supportEscalationsJob.run({ client, metrics: m } as any);

/** The insert's positional parameters, named — so an assertion reads like the ledger row it writes. */
const asEvent = (params: any[]) => ({
  ticketId: params[0], policyId: params[1], severity: params[2], afterMinutes: params[3],
  channel: params[4], targetRole: params[5], breachKind: params[6], breachedAt: params[7],
  status: params[8], detail: params[9],
});

const P0_CHAIN = [
  { severity: 'P0', after_minutes: 0, channel: 'call', target_role: 'support_head' },
  { severity: 'P0', after_minutes: 30, channel: 'call', target_role: 'head_of_ops' },
];

/** A ticket 40 minutes past its first-response promise and not yet past resolution. */
const lateFirstResponse = (over = 40): Row => ({
  id: 'tkt-1', severity: 'P0',
  sla_first_response_due: '2026-08-06T03:00:00.000Z',
  sla_resolution_due: '2026-08-06T07:00:00.000Z',
  fr_late_min: over, res_late_min: null,
});

describe('support-escalations job — registration', () => {
  it('has a stable name and a minute interval', () => {
    expect(supportEscalationsJob.name).toBe('support-escalations');
    // a minute of latency on a 15-minute P0 promise is acceptable; ten would not be
    expect(supportEscalationsJob.intervalSec).toBe(60);
  });
});

describe('no published policy = nothing fires', () => {
  it('fires nothing and does not even look at tickets when no policy is active', async () => {
    const { client, inserts } = makeClient({ policy: [] });
    const m = metrics();
    await run(client, m);
    expect(inserts).toHaveLength(0);
    // and it must not have queried tickets: a platform with no policy has not decided who to page
    const sqls = client.query.mock.calls.map((c: any[]) => String(c[0]));
    expect(sqls.some((s) => s.includes('support_tickets'))).toBe(false);
    expect(m.inc).not.toHaveBeenCalled();
  });

  it('fires nothing when a policy exists but has no chain rows', async () => {
    const { client, inserts } = makeClient({ steps: [], breached: [lateFirstResponse()] });
    await run(client, metrics());
    expect(inserts).toHaveLength(0);
  });
});

describe('a step fires at its delay INCLUSIVELY', () => {
  it('fires the at-breach step the moment lateness reaches 0', async () => {
    const { client, inserts } = makeClient({ steps: P0_CHAIN, breached: [lateFirstResponse(0)] });
    await run(client, metrics());
    // exactly one: the +30 step is not due yet
    expect(inserts).toHaveLength(1);
    expect(asEvent(inserts[0].params).afterMinutes).toBe(0);
    expect(asEvent(inserts[0].params).targetRole).toBe('support_head');
  });

  it('does not fire a step whose delay has not elapsed', async () => {
    const { client, inserts } = makeClient({ steps: P0_CHAIN, breached: [lateFirstResponse(29)] });
    await run(client, metrics());
    expect(inserts.map((i) => asEvent(i.params).afterMinutes)).toEqual([0]);
  });

  it('fires the +30 step at exactly 30 minutes late, alongside the earlier one', async () => {
    const { client, inserts } = makeClient({ steps: P0_CHAIN, breached: [lateFirstResponse(30)] });
    await run(client, metrics());
    // both are due; the earlier one is a no-op insert in reality (ON CONFLICT), but the job must still attempt it —
    // it cannot know what a previous tick managed to write
    expect(inserts.map((i) => asEvent(i.params).afterMinutes)).toEqual([0, 30]);
    expect(inserts.map((i) => asEvent(i.params).targetRole)).toEqual(['support_head', 'head_of_ops']);
  });
});

describe('the two breach kinds escalate independently', () => {
  it('logs first_response and resolution as separate events for the same ticket', async () => {
    const both: Row = {
      id: 'tkt-2', severity: 'P0',
      sla_first_response_due: '2026-08-06T03:00:00.000Z',
      sla_resolution_due: '2026-08-06T05:00:00.000Z',
      fr_late_min: 120, res_late_min: 45,
    };
    const { client, inserts } = makeClient({ steps: P0_CHAIN, breached: [both] });
    await run(client, metrics());
    const kinds = inserts.map((i) => `${asEvent(i.params).breachKind}+${asEvent(i.params).afterMinutes}`);
    expect(kinds).toEqual(['first_response+0', 'first_response+30', 'resolution+0', 'resolution+30']);
    // each records the moment ITS OWN promise was missed, not a shared timestamp
    const byKind = Object.fromEntries(inserts.map((i) => [asEvent(i.params).breachKind, asEvent(i.params).breachedAt]));
    expect(byKind.first_response).toBe('2026-08-06T03:00:00.000Z');
    expect(byKind.resolution).toBe('2026-08-06T05:00:00.000Z');
  });

  it('skips a breach kind that has not happened (null lateness is not zero lateness)', async () => {
    // unknown ≠ zero: a null here means the promise is not yet missed, and treating it as 0 would page somebody
    // about a ticket that is perfectly on time
    const { client, inserts } = makeClient({ steps: P0_CHAIN, breached: [lateFirstResponse(0)] });
    await run(client, metrics());
    expect(inserts.every((i) => asEvent(i.params).breachKind === 'first_response')).toBe(true);
  });
});

describe('the delivery truth is recorded per channel', () => {
  it('records in_app as delivered — it lands on the SLA board, which IS the delivery', async () => {
    const { client, inserts } = makeClient({
      steps: [{ severity: 'P2', after_minutes: 0, channel: 'in_app', target_role: 'support_lead' }],
      breached: [{ ...lateFirstResponse(5), severity: 'P2' }],
    });
    await run(client, metrics());
    const ev = asEvent(inserts[0].params);
    expect(ev.status).toBe('recorded');
    expect(ev.detail).toBeNull();
  });

  it.each(['call', 'sms', 'pager', 'email', 'whatsapp'])(
    'marks a %s step provider_pending WITH a reason — never sent', async (channel) => {
      const { client, inserts } = makeClient({
        steps: [{ severity: 'P0', after_minutes: 0, channel, target_role: 'support_head' }],
        breached: [lateFirstResponse(1)],
      });
      await run(client, metrics());
      const ev = asEvent(inserts[0].params);
      expect(ev.status).toBe('provider_pending');
      expect(ev.status).not.toBe('sent');
      // 0098's ck_support_escalation_detail requires >= 3 chars of explanation for a non-delivery
      expect(String(ev.detail).length).toBeGreaterThanOrEqual(3);
      expect(ev.detail).toContain(channel);
      expect(ev.detail).toContain('support_head');
    });
});

describe('idempotency and bookkeeping', () => {
  it('inserts ON CONFLICT DO NOTHING, which is what stops a double page at 02:00', async () => {
    const { client, inserts } = makeClient({ steps: P0_CHAIN, breached: [lateFirstResponse()] });
    await run(client, metrics());
    expect(inserts.length).toBeGreaterThan(0);
    for (const i of inserts) expect(i.sql).toContain('ON CONFLICT DO NOTHING');
  });

  it('records WHICH POLICY VERSION decided each page', async () => {
    // without it, a chain edited next month makes every past page unexplainable
    const { client, inserts } = makeClient({ policy: [{ id: 'pol-77' }], steps: P0_CHAIN, breached: [lateFirstResponse()] });
    await run(client, metrics());
    expect(inserts.every((i) => asEvent(i.params).policyId === 'pol-77')).toBe(true);
  });

  it('counts what it fired, passing the count as the THIRD metrics argument', async () => {
    const { client } = makeClient({ steps: P0_CHAIN, breached: [lateFirstResponse(60)] });
    const m = metrics();
    await run(client, m);
    expect(m.inc).toHaveBeenCalledWith('worker.support_escalations_fired', undefined, 2);
  });

  it('stays silent when nothing fired — a zero-count metric would look like activity', async () => {
    const { client } = makeClient({ steps: P0_CHAIN, breached: [] });
    const m = metrics();
    await run(client, m);
    expect(m.inc).not.toHaveBeenCalled();
  });

  it('ignores a ticket whose severity has no chain rather than crashing the tick', async () => {
    // the policy validator forbids this, but a row predating the validator must not stop every OTHER ticket escalating
    const { client, inserts } = makeClient({
      steps: P0_CHAIN,
      breached: [{ ...lateFirstResponse(99), id: 'tkt-p3', severity: 'P3' }, lateFirstResponse(0)],
    });
    await run(client, metrics());
    expect(inserts.map((i) => asEvent(i.params).ticketId)).toEqual(['tkt-1']);
  });

  it('bounds the scan so a backlog cannot hold the leader lock', async () => {
    const { client } = makeClient({ steps: P0_CHAIN, breached: [] });
    await run(client, metrics());
    const ticketQuery = client.query.mock.calls.find((c: any[]) => String(c[0]).includes('FROM support_tickets'));
    expect(ticketQuery).toBeDefined();
    expect(String(ticketQuery![0])).toContain('LIMIT $1');
    expect(ticketQuery![1]).toEqual([200]);
  });

  it('only considers tickets somebody is still expected to work', async () => {
    const { client } = makeClient({ steps: P0_CHAIN, breached: [] });
    await run(client, metrics());
    const call = client.query.mock.calls.find((c: any[]) => String(c[0]).includes('FROM support_tickets'));
    const sql = String(call![0]);
    // a closed or resolved ticket must not page anybody
    expect(sql).not.toMatch(/'resolved'/);
    expect(sql).not.toMatch(/'closed'/);
    for (const st of ['open', 'pending_customer', 'pending_internal', 'escalated', 'reopened']) {
      expect(sql).toContain(`'${st}'`);
    }
    // lateness is computed with the DATABASE's clock: a worker with a skewed clock must not decide a promise was kept
    expect(sql).toContain('now()');
  });
});
