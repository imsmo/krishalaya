// apps/worker/src/jobs/support-escalations.job.ts · FIRES the support escalation chain (PC-56 ADMIN-2b, completing
// ADMIN-2-Q2). pg-native and bounded, like every job in this runtime.
//
// THIS JOB IS THE POINT OF THE WHOLE WAVE. Before it, an SLA breach did nothing: the targets were real, the board showed
// the overrun, and whether anybody was told depended on somebody happening to look. 0097 stored the promise; this makes
// it happen.
//
// FOUR PROPERTIES, EACH DELIBERATE:
//   1. IDEMPOTENT PER STEP. The unique index in 0098 is on (ticket, breach kind, after_minutes, channel) and the insert
//      is ON CONFLICT DO NOTHING, so a re-run, a crash mid-tick, or two replicas racing cannot page the support head
//      twice for the same breach. Paging somebody twice at 02:00 is how a chain gets switched off by the person it wakes.
//   2. IT READS THE ACTIVE POLICY, ONCE PER TICK. Not per ticket — the policy is one row and re-reading it per ticket
//      would turn a 200-ticket tick into 200 extra queries for an answer that cannot change mid-tick.
//   3. DELIVERY TRUTH IS RECORDED. `in_app` is genuinely delivered (it lands on the SLA board, which the console reads),
//      so it is `recorded`. A call/SMS/pager step has no provider wired in this platform, so it is `provider_pending`
//      WITH the reason — never `sent`. A desk lead reading this ledger must not believe somebody was rung when nothing
//      can ring.
//   4. BOTH BREACH KINDS ARE SEPARATE FAILURES. A ticket can miss its first response AND its resolution; they are
//      different promises to the same farmer, so they escalate independently and are logged apart.
import { Job, JobCtx } from './index';

/** Tickets examined per tick. Bounded so a backlog cannot hold the leader lock for minutes. */
const CLAIM_LIMIT = 200;

export const supportEscalationsJob: Job = {
  name: 'support-escalations',
  // A minute: the tightest chain step is "at breach", and a P0 first response is 15 minutes — a minute of latency on a
  // 15-minute promise is acceptable; ten would not be.
  intervalSec: 60,

  async run({ client, metrics }: JobCtx): Promise<void> {
    // 1. THE ACTIVE POLICY. No policy → nothing fires, and that is correct rather than a default: a platform with no
    //    published support policy has not decided who to page, and inventing one here would page somebody arbitrary.
    const pol = await client.query(
      `SELECT id FROM support_policies WHERE is_active AND deleted_at IS NULL LIMIT 1`);
    const policyId = pol.rows[0]?.id;
    if (!policyId) return;

    const steps = await client.query(
      `SELECT severity, after_minutes, channel::text AS channel, target_role
         FROM support_policy_escalations
        WHERE policy_id = $1 AND deleted_at IS NULL
        ORDER BY severity, after_minutes`, [policyId]);
    if (steps.rowCount === 0) return;

    // 2. BREACHED, STILL-WORKING TICKETS with how long ago each promise was missed. Computed in SQL so the clock is the
    //    database's — a worker with a skewed clock must not decide that a promise was kept.
    const breached = await client.query(
      `SELECT t.id, t.severity,
              t.sla_first_response_due,
              t.sla_resolution_due,
              CASE WHEN t.first_responded_at IS NULL AND t.sla_first_response_due IS NOT NULL
                        AND t.sla_first_response_due < now()
                   THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - t.sla_first_response_due))::int / 60) END AS fr_late_min,
              CASE WHEN t.resolved_at IS NULL AND t.sla_resolution_due IS NOT NULL
                        AND t.sla_resolution_due < now()
                   THEN GREATEST(0, EXTRACT(EPOCH FROM (now() - t.sla_resolution_due))::int / 60) END AS res_late_min
         FROM support_tickets t
        WHERE t.deleted_at IS NULL
          AND t.status IN ('open','pending_customer','pending_internal','escalated','reopened')
          AND (
            (t.first_responded_at IS NULL AND t.sla_first_response_due IS NOT NULL AND t.sla_first_response_due < now())
            OR (t.resolved_at IS NULL AND t.sla_resolution_due IS NOT NULL AND t.sla_resolution_due < now())
          )
        ORDER BY t.severity, t.sla_first_response_due NULLS LAST
        LIMIT $1`, [CLAIM_LIMIT]);

    let fired = 0;
    for (const t of breached.rows as Array<Record<string, any>>) {
      const applicable = (steps.rows as Array<Record<string, any>>).filter((s) => s.severity === t.severity);
      if (applicable.length === 0) continue;   // no chain for this severity: the policy validator forbids it, but a row
                                               // predating the validator must not crash the job

      for (const kind of ['first_response', 'resolution'] as const) {
        const lateMin = kind === 'first_response' ? t.fr_late_min : t.res_late_min;
        if (lateMin === null || lateMin === undefined) continue;
        const breachedAt = kind === 'first_response' ? t.sla_first_response_due : t.sla_resolution_due;

        for (const step of applicable) {
          // A step fires once its delay has elapsed. Steps not yet due are simply skipped — they will fire on a later
          // tick, which is why the ledger's uniqueness is per step rather than per ticket.
          if (Number(lateMin) < Number(step.after_minutes)) continue;

          const inApp = step.channel === 'in_app';
          const status = inApp ? 'recorded' : 'provider_pending';
          const detail = inApp
            ? null
            : `policy says ${step.channel} ${step.target_role}, but no ${step.channel} provider is configured in this deployment`;

          const res = await client.query(
            `INSERT INTO support_escalation_events
               (ticket_id, policy_id, severity, after_minutes, channel, target_role, breach_kind, breached_at, status, detail)
             VALUES ($1,$2,$3,$4,$5::support_escalation_channel,$6,$7,$8,$9::support_escalation_status,$10)
             ON CONFLICT DO NOTHING`,
            [t.id, policyId, t.severity, step.after_minutes, step.channel, step.target_role, kind, breachedAt, status, detail]);
          if ((res.rowCount ?? 0) > 0) fired += 1;
        }
      }
    }

    // the metrics signature is inc(name, labels?, by?) — the count is the THIRD argument
    if (fired > 0) metrics.inc('worker.support_escalations_fired', undefined, fired);
  },
};
