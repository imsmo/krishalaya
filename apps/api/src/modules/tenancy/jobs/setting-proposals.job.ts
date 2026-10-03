// modules/tenancy/jobs/setting-proposals.job.ts · PC-56 TENANT-13b · A1 — THE CLOCK THAT MAKES A CONFIRMED SETTING TAKE EFFECT AT
// MIDNIGHT, AND THAT EXPIRES A PROPOSAL NOBODY CONFIRMED IN 7 DAYS.
//
// Registered in SCHEDULED_JOB_REGISTRY (the 10b / 11a / 11b pattern: the runner takes a Postgres advisory lock per job name per
// tick, so N pods never race one sweep). The only thing it reads with the runner's kv_relay pool is `tenants`; every claim and
// every act runs PER TENANT IN kv_app's UNIT OF WORK under RLS — kv_relay holds no write on tenant_settings (0192 revoked it), and
// 0192's `trg_tenant_settings_gate` admits the write only because the transaction cites the confirmed, due proposal.
// `applyDue` / `expireDue` re-lock the row and re-check its status and instant, so a row two ticks claim is acted on once. One
// failure never stops the rest.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { SettingGovernanceRepository } from '../repositories/setting-governance.repository';
import { TenantSettingsService } from '../services/tenant-settings.service';

export const SETTING_PROPOSALS_JOB = 'tenancy-setting-proposals';

export class SettingProposalsJob implements ScheduledJob {
  readonly name = SETTING_PROPOSALS_JOB;
  private readonly log = new Logger(SettingProposalsJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: SettingGovernanceRepository,
              private readonly svc: TenantSettingsService, private readonly limit = 200) {}

  async sweep(pool: Pool): Promise<{ tenants: number; applied: number; notApplied: number; expired: number; failed: number }> {
    const tenants = await this.repo.activeTenants(pool);
    let applied = 0, notApplied = 0, expired = 0, failed = 0;
    for (const tenantId of tenants) {
      let due: string[] = []; let stale: string[] = [];
      try {
        [due, stale] = await this.uow.run(tenantId, async (tx) => [
          await this.repo.dueToApplyTx(tx, tenantId, this.limit), await this.repo.dueToExpireTx(tx, tenantId, this.limit),
        ], { userId: undefined });
      } catch { failed++; continue; }
      for (const id of due) {
        try { const r = await this.svc.applyDue(tenantId, id); if (r === 'applied') applied++; else if (r === 'expired') notApplied++; }
        catch (e) { failed++; this.log.error(`${this.name}: apply ${id} failed: ${(e as Error).message}`); }
      }
      for (const id of stale) {
        try { if (await this.svc.expireDue(tenantId, id)) expired++; }
        catch (e) { failed++; this.log.error(`${this.name}: expire ${id} failed: ${(e as Error).message}`); }
      }
    }
    return { tenants: tenants.length, applied, notApplied, expired, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.applied || r.notApplied || r.expired || r.failed) {
      this.log.log(`${this.name}: ${r.applied} applied, ${r.notApplied} not applied (floor moved), ${r.expired} expired, ${r.failed} failed, across ${r.tenants} tenant(s)`);
    }
  }
}
