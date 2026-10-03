// modules/tenancy/jobs/brand-domain-proposals.job.ts · PC-56 TENANT-13d · THE CLOCK — a brand or domain proposal nobody confirmed in 7 days
// expires (0194 `trg_tbp_moves` / `trg_tdp_moves` admit `expired` only after the window). Registered; advisory-locked by the runner; the
// runner's kv_relay pool only reads which tenants have an overdue proposal; each expiry is kv_app's, per tenant, audited.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { TenantBrandingRepository } from '../repositories/tenant-branding.repository';
import { TenantDomainRepository } from '../repositories/tenant-domain.repository';
import { TenantBrandingService } from '../services/tenant-branding.service';
import { TenantDomainService } from '../services/tenant-domain.service';

export const BRAND_DOMAIN_PROPOSALS_JOB = 'tenancy-brand-domain-proposals-clock';

export class BrandDomainProposalsJob implements ScheduledJob {
  readonly name = BRAND_DOMAIN_PROPOSALS_JOB;
  private readonly log = new Logger(BrandDomainProposalsJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly brandRepo: TenantBrandingRepository,
              private readonly domainRepo: TenantDomainRepository, private readonly brand: TenantBrandingService, private readonly domains: TenantDomainService,
              private readonly limit = 100) {}

  async sweep(pool: Pool): Promise<{ tenants: number; expired: number; failed: number }> {
    const tenants = await this.brandRepo.tenantsWithOpenProposals(pool);
    let expired = 0, failed = 0;
    for (const tenantId of tenants) {
      let b: string[] = []; let d: string[] = [];
      try {
        [b, d] = await this.uow.run(tenantId, async (tx) => [
          await this.brandRepo.dueToExpireTx(tx, tenantId, this.limit), await this.domainRepo.dueProposalsTx(tx, tenantId, this.limit),
        ], { userId: undefined });
      } catch { failed++; continue; }
      for (const id of b) { try { if (await this.brand.expireDue(tenantId, id)) expired++; } catch { failed++; } }
      for (const id of d) { try { if (await this.domains.expireProposal(tenantId, id)) expired++; } catch { failed++; } }
    }
    return { tenants: tenants.length, expired, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.expired || r.failed) this.log.log(`${this.name}: ${r.expired} expired, ${r.failed} failed across ${r.tenants} tenant(s)`);
  }
}
