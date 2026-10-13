// core/tenancy-context/storefront-public-stats.job.ts · PC-56 STORE-1b · B3 (founder D3) — the clock behind "Today at a glance".
//
// The platform home's three public counts (live public listings · verified organisations · districts) are PRECOMPUTED: every 15 minutes
// this job CALLs 0204's SECURITY DEFINER `refresh_platform_public_stats()` — three cross-tenant counts, one statement each, then one UPDATE of
// the singleton `platform_public_stats` row with `computed_at`. The request path only ever reads that row (`public_platform_stats()`), so a
// home-page visit never counts anything and nothing here loops over tenants (Law 11).
//
// ROLE: the runner hands every job its kv_relay pool (for the advisory lock and cross-tenant sweeps). This job does not use it: EXECUTE on
// the refresh is granted to kv_app only (0204), so it runs on the request tier's own writer pool — kv_relay holds nothing new (the HOTFIX-2
// rule: the relay role is not widened for a job that does not need it). No outbox event, no handler.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import type { PgPoolProvider } from '../database/pg-pool.provider';
import type { ScheduledJob } from '../jobs/scheduled-job';

export const STOREFRONT_PUBLIC_STATS_JOB = 'storefront-public-stats';
export const STOREFRONT_PUBLIC_STATS_MS = 15 * 60_000;

export class StorefrontPublicStatsJob implements ScheduledJob {
  readonly name = STOREFRONT_PUBLIC_STATS_JOB;
  private readonly log = new Logger(StorefrontPublicStatsJob.name);
  constructor(readonly intervalMs: number, private readonly pools: PgPoolProvider) {}

  /** One refresh. Returns the new `computed_at` (ISO). Exposed for the integration spec (the runner is off under test). */
  async refresh(): Promise<string> {
    const r = await this.pools.writer(0).query<{ at: Date }>(`SELECT refresh_platform_public_stats() AS at`);
    return new Date(r.rows[0].at).toISOString();
  }

  async run(_relayPool: Pool): Promise<void> {
    const at = await this.refresh();
    this.log.log(`${this.name}: public counts recomputed at ${at}`);
  }
}
