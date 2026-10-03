// modules/tenancy/jobs/domain-verification.job.ts · PC-56 TENANT-13d · B2 — THE DOMAIN VERIFIER (every 5 minutes).
//
// Registered in SCHEDULED_JOB_REGISTRY (the runner takes a Postgres advisory lock per job name per tick, so N pods never race one
// sweep). The runner's kv_relay pool only reads WHICH tenants have claims to check (SELECT on tenant_domains; 0194 revoked its
// writes); every check and every write runs PER TENANT IN kv_app's UNIT OF WORK under RLS (the 11b / 13a pattern):
//   • a pending / failed claim not checked in the last 5 minutes → DNS through the platform's pinned resolvers (the DOMAIN_DNS port):
//     CNAME <domain> → the edge AND TXT `_krishalaya-verify.<domain>` = the token → verified; otherwise failed with the reason in words;
//   • a claim past its 7-day window → expired and RELEASED (soft-deleted; the name is free for its rightful owner);
//   • the included subdomain's TLS follows `platform.wildcard_tls_ready` (issued only when the wildcard certificate is configured).
// One tenant's failure never stops the rest. Never a fake verified: 0194 admits `verified` only from TenantDomainService.verifyOne.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { TenantDomainRepository } from '../repositories/tenant-domain.repository';
import { TenantDomainService } from '../services/tenant-domain.service';

export const DOMAIN_VERIFICATION_JOB = 'tenancy-domain-verification';

export class DomainVerificationJob implements ScheduledJob {
  readonly name = DOMAIN_VERIFICATION_JOB;
  private readonly log = new Logger(DomainVerificationJob.name);
  constructor(readonly intervalMs: number, private readonly repo: TenantDomainRepository, private readonly svc: TenantDomainService, private readonly perTenant = 20) {}

  async sweep(pool: Pool): Promise<{ tenants: number; verified: number; failed: number; expired: number; tlsSynced: number; errors: number }> {
    const tenants = await this.repo.tenantsToVisit(pool);
    let verified = 0, failed = 0, expired = 0, tlsSynced = 0, errors = 0;
    for (const tenantId of tenants) {
      try {
        const r = await this.svc.sweepTenant(tenantId, this.perTenant);
        verified += r.verified; failed += r.failed; expired += r.expired; tlsSynced += r.tlsSynced;
      } catch (e) { errors++; this.log.error(`${this.name}: tenant ${tenantId} failed: ${(e as Error).message}`); }
    }
    return { tenants: tenants.length, verified, failed, expired, tlsSynced, errors };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.verified || r.expired || r.errors || r.tlsSynced) {
      this.log.log(`${this.name}: ${r.verified} verified, ${r.failed} failed, ${r.expired} released, ${r.tlsSynced} TLS synced, ${r.errors} errors across ${r.tenants} tenant(s)`);
    }
  }
}
