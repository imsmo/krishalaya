// modules/logistics/jobs/logistics-ops.jobs.ts · PC-56 TENANT-SW-e — the two clocks logistics ops needs, REGISTERED in
// SCHEDULED_JOB_REGISTRY by LogisticsModule. Each sweeps on the runner's kv_relay pool reading ONLY `tenants`, and does every table
// act per tenant in kv_app's unit of work (the HOTFIX-2 / SW-a shape) — the relay role holds nothing on the tables they touch.
//   • logistics-cold-chain-watch (every minute): a logger silent > 15 minutes is flagged once and alerted ("alerted, not called");
//     a shipment breach out of range ≥ 15 minutes offers the buyer accept / accept-with-test / reject.
//   • logistics-slot-proposal-expiry (every 15 minutes): a pickup-slot proposal unanswered for 7 days expires.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ColdChainService } from '../services/cold-chain.service';
import { SlotProposalService } from '../services/slot-proposal.service';

const LIVE_TENANTS = `SELECT id FROM tenants WHERE status IN ('trial','active','grace') AND deleted_at IS NULL`;

export class ColdChainWatchJob {
  readonly name = 'logistics-cold-chain-watch';
  private readonly log = new Logger(ColdChainWatchJob.name);
  constructor(readonly intervalMs: number, private readonly svc: ColdChainService) {}
  /** `only` narrows the sweep to named tenants (the relay gate and the live spec drive one tenant). */
  async sweep(pool: Pool, only?: readonly string[]): Promise<{ tenants: number; silences: number; offers: number; failed: number }> {
    const t = await pool.query<{ id: string }>(only?.length ? `${LIVE_TENANTS} AND id = ANY($1::uuid[]) ORDER BY id` : `${LIVE_TENANTS} ORDER BY id`, only?.length ? [[...only]] : []);
    let silences = 0, offers = 0, failed = 0;
    for (const { id } of t.rows) {
      try { const r = await this.svc.watchTenant(id); silences += r.silences; offers += r.offers; }
      catch (e) { failed++; this.log.error(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return { tenants: t.rows.length, silences, offers, failed };
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.silences || r.offers || r.failed) this.log.log(`${this.name}: ${r.silences} silence(s) flagged, ${r.offers} buyer offer(s), ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}

export class SlotProposalExpiryJob {
  readonly name = 'logistics-slot-proposal-expiry';
  private readonly log = new Logger(SlotProposalExpiryJob.name);
  constructor(readonly intervalMs: number, private readonly svc: SlotProposalService) {}
  async sweep(pool: Pool, only?: readonly string[]): Promise<{ tenants: number; expired: number; failed: number }> {
    const t = await pool.query<{ id: string }>(only?.length ? `${LIVE_TENANTS} AND id = ANY($1::uuid[]) ORDER BY id` : `${LIVE_TENANTS} ORDER BY id`, only?.length ? [[...only]] : []);
    let expired = 0, failed = 0;
    for (const { id } of t.rows) {
      try { expired += await this.svc.expireDue(id); }
      catch (e) { failed++; this.log.error(`${this.name}: tenant ${id} failed: ${(e as Error).message}`); }
    }
    return { tenants: t.rows.length, expired, failed };
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.expired || r.failed) this.log.log(`${this.name}: ${r.expired} proposal(s) expired, ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
