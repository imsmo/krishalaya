// modules/identity/events/handlers/erasure-ready.handler.ts · PC-56 DPDP-1 — consumes `identity.erasure_ready`: ERASE THE PERSON.
//
// The worker's hourly cooling job (apps/worker dpdp-erasure-cooling.job.ts) emits this event when an erasure request's 90-day cooling
// ends, and RE-EMITS it every hour for a request that is `blocked` (or `in_progress` with no event in flight — a crash or a failed
// attempt), so a blocker that clears is picked up on the next tick without anybody pressing a button.
//
// It runs INSIDE the relay's per-event transaction, as kv_relay (HOTFIX-2), and touches NO table directly: every read and write goes
// through migration 0245's SECURITY DEFINER wall — kv_relay holds EXECUTE on three functions and no table privilege for this:
//   1. kv_dsr_erasure_claim(dsr)          lock the request + the person; status, cooling end, the blocker COUNTS.
//   2. decideErasure()                    pure (domain/erasure.rules.ts): skip / not due / block / erase.
//   3a. kv_dsr_erasure_block(dsr, …)      blocked: record the reasons; the person is told once per new set of reasons.
//   3b. kv_dsr_erasure_execute(dsr, …)    clear: the database RE-CHECKS every blocker (fails closed) and de-identifies per the matrix,
//                                         writes the evidence rows + one audit row, completes the request with its summary.
// Idempotent and resumable: everything commits with the event or not at all; a completed request is a no-op; a crash rolls back and
// the next delivery (or the hourly re-drive) starts again from the same state. Media storage deletion is recorded as PENDING on the
// rows (no storage-delete path exists — 0245 §245.3), never claimed as done. Logs ids only — never a phone, a name or a reason text.
//
// NO KILL-SWITCH (Law 10, the 0214/0223 precedent): erasure is a statutory right (DPDP s.12). Its safety is the blockers, the cooling
// window and the database's own re-check — not a flag that could suspend the law.
import { Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { decideErasure, parseErasureSummary } from '../../domain/erasure.rules';

export const ERASURE_READY = 'identity.erasure_ready';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ErasureOutcome = 'malformed' | 'not_found' | 'skip' | 'not_due' | 'blocked' | 'erased';

export class ErasureReadyHandler implements OutboxHandler {
  readonly eventType = ERASURE_READY;
  private readonly log = new Logger(ErasureReadyHandler.name);

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> { await this.run(event, tx); }

  /** The whole act, returning what happened (the spec reads it; the relay ignores it). */
  async run(event: OutboxEvent, tx: TxContext): Promise<ErasureOutcome> {
    const dsrId = typeof event.payload?.dsrId === 'string' && UUID.test(event.payload.dsrId) ? event.payload.dsrId : null;
    if (!dsrId) { this.log.warn(`erasure event ${event.id}: no request id — ignored`); return 'malformed'; }
    const r = await tx.query<{ status: string; user_id: string; cooling_ends_at: Date | null; figures: unknown; db_now: Date }>(
      `SELECT c.status, c.user_id, c.cooling_ends_at, c.figures, now() AS db_now FROM kv_dsr_erasure_claim($1) c`, [dsrId]);
    const row = r.rows[0];
    if (!row) return 'not_found';
    // the event names the person it was emitted for; a mismatch is a corrupted event — never erase on it
    if (typeof event.payload.userId === 'string' && event.payload.userId !== row.user_id) {
      this.log.error(`erasure event ${event.id}: request ${dsrId} belongs to another person — refused`);
      return 'malformed';
    }
    const { decision, reasons } = decideErasure({ status: row.status, coolingEndsAt: row.cooling_ends_at ? new Date(row.cooling_ends_at) : null,
      figures: row.figures, now: new Date(row.db_now) });
    if (decision === 'skip' || decision === 'not_due') return decision;
    if (decision === 'block') {
      const b = await tx.query<{ notified: boolean }>(`SELECT kv_dsr_erasure_block($1, $2::text[], $3) AS notified`, [dsrId, reasons, event.tenantId]);
      this.log.log(`erasure ${dsrId}: blocked (${reasons.join(',')})${b.rows[0]?.notified ? ' — person told' : ''}`);
      return 'blocked';
    }
    const e = await tx.query<{ summary: unknown }>(`SELECT kv_dsr_erasure_execute($1, $2) AS summary`, [dsrId, event.tenantId]);
    const s = parseErasureSummary(e.rows[0]?.summary);
    if (!s) throw new Error(`kv_dsr_erasure_execute returned no summary for ${dsrId}`);   // roll the whole erasure back
    this.log.log(`erasure ${dsrId}: completed — ${Object.keys(s.classes).length} data classes, ${s.mediaPendingStoragePurge} file(s) pending storage purge`);
    return 'erased';
  }
}
