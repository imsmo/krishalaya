// apps/worker/src/jobs/dpdp-erasure-cooling.job.ts · advance erasure DSRs whose 90-day cooling-off has elapsed to
// 'in_progress' and emit identity.erasure_ready to the outbox so the erasure pipeline runs. kv_relay (BYPASSRLS)
// sees every tenant. Mirrors the api job's SQL; writes the outbox row in the same statement scope.
//
// PC-56 DPDP-1: the event now HAS a consumer (apps/api identity ErasureReadyHandler → migration 0245's executor). This job is also
// the executor's RETRY CLOCK: every hour it RE-EMITS `identity.erasure_ready` for an erasure that is
//   • `blocked` (an open order, wallet money, a dispute, a loan, a payout… — the handler re-checks and completes it once clear), or
//   • `in_progress` with no event in flight (the advance and the emit below are two statements: a crash between them, or a handler
//     failure that quarantined the event, would otherwise leave the request stuck forever),
// once its last attempt is at least 55 minutes old and no `identity.erasure_ready` for the person is still pending. Bounded (LIMIT).
import { Job, JobCtx } from './index';

/** Re-drive batch bound per tick. */
export const ERASURE_REDRIVE_LIMIT = 500;

const SUBJECT_TENANT = `(SELECT utr.tenant_id FROM user_tenant_roles utr
            WHERE utr.user_id = d.user_id AND utr.is_active AND utr.deleted_at IS NULL
            ORDER BY utr.created_at LIMIT 1)`;

export const dpdpErasureCoolingJob: Job = {
  name: 'dpdp-erasure-cooling',
  intervalSec: 3600, // hourly
  async run({ client, metrics }: JobCtx) {
    // data_subject_requests is keyed by user_id and has NO tenant_id column (users are global; tenant membership
    // lives in user_tenant_roles). Resolve the subject's tenant for the outbox row via their active membership
    // (any one — erasure is global to the user; outbox_events.tenant_id is nullable, so NULL is acceptable when the
    // user has no active membership).
    const due = await client.query<{ id: string; user_id: string; tenant_id: string | null }>(
      `UPDATE data_subject_requests d SET status='in_progress', updated_at=now()
        WHERE request_type='erasure' AND status='open'
          AND cooling_ends_at IS NOT NULL AND cooling_ends_at <= now()
        RETURNING id, user_id, ${SUBJECT_TENANT} AS tenant_id`);
    for (const r of due.rows) await emit(client, r);
    metrics.inc('kv_erasure_advanced_total', undefined, due.rowCount ?? 0);

    // PC-56 DPDP-1: the re-drive (see header). The NOT EXISTS reads only pending outbox rows (idx_outbox_pending).
    const again = await client.query<{ id: string; user_id: string; tenant_id: string | null }>(
      `SELECT d.id, d.user_id, ${SUBJECT_TENANT} AS tenant_id
         FROM data_subject_requests d
        WHERE d.request_type = 'erasure' AND d.status IN ('in_progress', 'blocked') AND d.deleted_at IS NULL
          AND d.cooling_ends_at IS NOT NULL AND d.cooling_ends_at <= now()
          AND coalesce(d.last_attempt_at, d.updated_at) <= now() - interval '55 minutes'
          AND NOT EXISTS (SELECT 1 FROM outbox_events e
                           WHERE e.status = 'pending' AND e.event_type = 'identity.erasure_ready' AND e.aggregate_id = d.user_id)
        ORDER BY d.last_attempt_at NULLS FIRST, d.id
        LIMIT ${ERASURE_REDRIVE_LIMIT}`);
    for (const r of again.rows) await emit(client, r);
    metrics.inc('kv_erasure_redriven_total', undefined, again.rowCount ?? 0);
  },
};

/** PC-56 DPDP-1: `outbox_events.id` is a BIGSERIAL — the previous `VALUES (uuid_generate_v7(), …)` could never insert (42804), so after
 *  the advance committed no event was ever written and every due request stuck at `in_progress`. The id is the sequence's. */
async function emit(client: JobCtx['client'], r: { id: string; user_id: string; tenant_id: string | null }): Promise<void> {
  await client.query(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
     VALUES ($1, 'user', $2, 'identity.erasure_ready', $3::jsonb, 'pending', now())`,
    [r.tenant_id, r.user_id, JSON.stringify({ v: 1, dsrId: r.id, userId: r.user_id })]);
}
