// modules/ambassadors/jobs/weekly-payout-batch.job.ts · the weekly commission payout runner — DELIBERATELY UNCALLED.
//
// PC-56 TENANT-10a · F-9 / F-23. NOTHING SCHEDULES THIS, AND THAT IS A DECISION, NOT A GAP. Every payout leg is
// `platform(PlatformAccount.Fees) → ambassador userMain`: the PLATFORM's fee account pays a tenant's village agents. Whether
// that is right — or whether a cooperative's ambassadors are paid from its own org wallet under its own maker-checker — is
// founder question F-23, open. Until it is answered, money moves only when a tenant_admin runs it from the console
// (`POST /ambassadors/payouts/run`, `ambassador.payout`, reason required, audited `ambassador.payout.batch`), and this file
// stays what it is: the same service call, per tenant, ready for whoever wires the cadence once F-23 is decided.
//
// It can no longer pay as "system": a run needs a NAMED actor (the human who scheduled the cadence) and a reason, exactly as
// the console's run does, and each tenant's run is idempotent on `(tenant, batch window)` so a re-run pays nothing twice.
// Connected as the BYPASSRLS relay role, it only READS which tenants have unpaid earnings; every write goes through the
// service's own request-tier unit of work.
import type { Pool } from 'pg';
import { AmbassadorEarningService } from '../services/ambassador-earning.service';

export interface PayoutBatchResult { tenants: number; attempted: number; paid: number; failed: number; }

export async function runWeeklyPayout(
  relayPool: Pool, service: AmbassadorEarningService,
  schedule: { actorUserId: string; reason: string }, batchKey = new Date().toISOString().slice(0, 10),
): Promise<PayoutBatchResult> {
  if (!schedule.actorUserId) throw new Error('weekly ambassador payout refused: no named actor (F-23 — see the header)');
  const r = await relayPool.query(`SELECT DISTINCT tenant_id FROM ambassador_earnings WHERE payout_id IS NULL`);
  const result: PayoutBatchResult = { tenants: r.rows.length, attempted: 0, paid: 0, failed: 0 };
  for (const row of r.rows) {
    try {
      const out = await service.runPayouts(row.tenant_id, { userId: schedule.actorUserId }, `ambweekly:${row.tenant_id}:${batchKey}`, schedule.reason);
      result.attempted += out.attempted; result.paid += out.paid; result.failed += out.failed;
    } catch { result.failed++; }   // a refused tenant (permission, reason) never stops the others
  }
  return result;
}
