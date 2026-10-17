// modules/traceability/jobs/anchor-hashes.job.ts · PC-56 STORE-5b · D3 (founder Q14, survey C-3 / F-9) — THE DAILY PLATFORM SEAL.
//
// WHAT WAS: `runAnchorHashes` stamped a lot's `blockchain_anchor` with its chain head ONCE (`blockchain_anchor IS NULL`) and nothing ever called
// it (survey C-3) — `anchored` was always false, and a lot that gained events after a stamp would have kept a stale anchor for ever.
//
// WHAT IS: `TraceAnchorClock`, a registered `ScheduledJob` (the 5a ReviewPromptsClock shape) at the registry table's cadence
// (`core/jobs/clock-cadence.ts` row `trace-anchor`, every 24 h):
//   • the runner's kv_relay pool only answers WHICH organisations have a lot whose chain head is not what its seal stamps (never sealed, or
//     events added since) — bounded;
//   • per organisation, its `traceability` flag is asked (the FlagsService — the API's own rule) and an organisation with it OFF is SKIPPED
//     (fails closed: a flag store that cannot answer skips the organisation);
//   • the seal is written AS kv_app in the organisation's own transaction (RLS): `blockchain_anchor = head`, `anchored_at = now()`,
//     `anchored_event_count = the events it covers` — RE-SEALED whenever the head moves (never "only once");
//   • ONE audit row per lot sealed, `trace.lot_sealed { anchor, eventCount }` (actor: the system; no person, no PII), in the same transaction.
// A platform seal — "written to a public ledger", "polygon:0x…" and block numbers are refused by name. The page prints "sealed by the platform
// at <time>" when the seal stamps the head as it stands, else "not yet sealed — the next seal runs daily".
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { TraceLotRepository } from '../repositories/trace-lot.repository';

export const TRACE_ANCHOR_JOB = 'trace-anchor';
/** Organisations visited per tick, and lots sealed per organisation per tick (bounded; the rest wait one tick). */
export const SEAL_TENANTS_PER_TICK = 500;
export const SEAL_LOTS_PER_TENANT = 2000;

export interface SealResult { tenantsSeen: number; tenantsSkipped: number; sealed: number }

export class TraceAnchorClock implements ScheduledJob {
  readonly name = TRACE_ANCHOR_JOB;
  private readonly log = new Logger(TraceAnchorClock.name);
  constructor(
    readonly intervalMs: number,
    private readonly uow: UnitOfWork,
    private readonly audit: AuditWriter,
    private readonly lots: TraceLotRepository,
    private readonly traceOn: (tenantId: string) => Promise<boolean>,
  ) {}

  /** One pass (the testable seam: the live spec passes the relay pool). */
  async tick(relay: Pool): Promise<SealResult> {
    const due = await this.lots.tenantsDueForSeal(relay, SEAL_TENANTS_PER_TICK);
    const res: SealResult = { tenantsSeen: due.length, tenantsSkipped: 0, sealed: 0 };
    for (const tenantId of due) {
      if (!(await this.traceOn(tenantId).catch(() => false))) { res.tenantsSkipped += 1; continue; }   // fail closed
      const sealed = await this.uow.run(tenantId, async (tx) => {
        const rows = await this.lots.sealDue(tx, tenantId, SEAL_LOTS_PER_TENANT);
        for (const s of rows) {
          await this.audit.write(tx, { tenantId, actorUserId: null, actorRole: 'system:trace-anchor', action: 'trace.lot_sealed', entityType: 'trace_lot', entityId: s.id,
            newValue: { anchor: s.anchor, eventCount: s.eventCount } });
        }
        return rows.length;
      }, { userId: 'system' });
      res.sealed += sealed;
    }
    return res;
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.tick(pool);
    if (r.sealed > 0 || r.tenantsSkipped > 0) this.log.log(`${this.name}: ${r.sealed} lot(s) sealed; ${r.tenantsSkipped} organisation(s) skipped (traceability OFF)`);
  }
}
