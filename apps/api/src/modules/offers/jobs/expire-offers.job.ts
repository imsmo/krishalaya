// modules/offers/jobs/expire-offers.job.ts · OFFER EXPIRY (status open | countered → expired past expires_at), ACTUALLY SCHEDULED.
//
// PC-56 HOTFIX-5 · B1 (founder D2, survey F-1(d) / C-2). Before this wave the class said "instantiated by apps/worker" — apps/worker hosts
// no domain job — so no offer ever expired; and as written it claimed `listing_offers FOR UPDATE SKIP LOCKED` across tenants on the kv_relay
// pool, a role with NO grant on `listing_offers`: wired as-is, its first tick would have been a 42501. It is now a `ScheduledJob` registered by
// OffersModule (the TENANT-11d requirements-expiry pattern): the only read on the kv_relay pool is `tenants` (granted; the relay gate proves
// it), the claim is per tenant in kv_app's unit of work under RLS (bounded, SKIP LOCKED), and each act is `ListingOfferService.expire` in its
// own kv_app transaction — re-lock, re-check (still negotiable, past expires_at) — so a second tick changes nothing. No money moves.
// SCALE NOTE (named, Law 11): the tenant list is every live tenant (the requirements-expiry precedent) because kv_relay holds no grant on
// `listing_offers` to narrow it; the per-tenant claim is an indexed, bounded read. Cadence: core/jobs/clock-cadence.ts.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork } from '../../../core/database/unit-of-work';
import { ListingOfferRepository } from '../repositories/listing-offer.repository';
import { ListingOfferService } from '../services/listing-offer.service';

export const OFFERS_EXPIRE_JOB = 'offers-expire';

export class ExpireOffersJob implements ScheduledJob {
  readonly name = OFFERS_EXPIRE_JOB;
  private readonly log = new Logger(ExpireOffersJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly repo: ListingOfferRepository, private readonly offers: ListingOfferService, private readonly limit = 200) {}

  async sweep(pool: Pool, now: Date = new Date(), onlyTenants?: string[]): Promise<{ tenants: number; claimed: number; expired: number; failed: number }> {
    const tenants = onlyTenants ?? await this.repo.liveTenants(pool);
    let claimed = 0, expired = 0, failed = 0;
    for (const tenantId of tenants) {
      let ids: string[] = [];
      try { ids = await this.uow.run(tenantId, (tx) => this.repo.dueToExpire(tx, tenantId, now, this.limit), { userId: 'system' }); }
      catch (e) { failed++; this.log.error(`${this.name}: claim failed for tenant ${tenantId}: ${(e as Error).message}`); continue; }
      claimed += ids.length;
      for (const id of ids) {
        try { if (await this.offers.expire(tenantId, id, now)) expired++; }
        catch (e) { failed++; this.log.error(`${this.name}: offer ${id} not expired: ${(e as Error).message}`); }
      }
    }
    return { tenants: tenants.length, claimed, expired, failed };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.expired > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.expired} offer(s) expired, ${r.failed} failed, of ${r.claimed} claimed across ${r.tenants} tenant(s)`);
  }
}
