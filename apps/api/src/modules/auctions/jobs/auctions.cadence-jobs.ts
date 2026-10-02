// modules/auctions/jobs/auctions.cadence-jobs.ts · PC-56 TENANT-11a · F-1 / F-9 — THE FIVE AUCTION SWEEPS, ACTUALLY SCHEDULED.
//
// Before this wave `OpenScheduledAuctionsJob`, `CloseEndedAuctionsJob` and `ReleaseLosingEmdJob` were instantiated nowhere
// (the module header said "apps/worker"; apps/worker hosts no domain job — WORKER-RUNTIME.md "Deferred: domain-handler
// jobs"), so no auction ever left `scheduled` and bidding was unreachable outside tests. They are registered here into
// `SCHEDULED_JOB_REGISTRY` (TENANT-10b's promotions pattern): the runner takes a Postgres advisory lock per job name per
// tick, so N pods never race one sweep.
//
// THE CLAIM IS PER TENANT, IN kv_app'S UNIT OF WORK (F-9). The runner hands a job its kv_relay pool. The ONLY thing a job
// reads with it is `AuctionRepository.tenantsWith` — the distinct tenants holding auctions in the states it sweeps, on
// `auctions` itself, which kv_relay is granted. Every claim after that (`dueToOpen` / `dueToClose` / `dueToLapse` /
// `recentlyClosed` / `dueForDefault`) runs inside `uow.run(tenantId, …)` as kv_app under RLS, and every act runs in its own
// kv_app transaction through AuctionService — which re-locks the row and re-checks the condition, so a row claimed by two
// ticks is acted on once. No grant to kv_relay was added; `bids`, `auction_settlements` and `listings` are never read as it.
//
// ReleaseLosingEmdJob is KEPT as a SWEEPER: the close itself now returns the losers' EMD (F-2), so this only catches a row
// a crash left half-done. It never touches a winner whose hold is kept (awaiting_approval) or applied (settled/defaulted).
// One failure never stops the rest: each act is caught and counted.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { AuctionRepository } from '../repositories/auction.repository';
import { AuctionSettlementRepository } from '../repositories/auction-settlement.repository';
import { AuctionService } from '../services/auction.service';
import { AuctionStatus } from '../domain/auction.state';

export interface SweepResult { tenants: number; claimed: number; acted: number; failed: number }

/** The shared shape: tenants (kv_relay, `auctions` only) → per-tenant claim (kv_app) → per-row act (kv_app). */
export abstract class AuctionSweep implements ScheduledJob {
  abstract readonly name: string;
  protected abstract readonly statuses: readonly AuctionStatus[];
  private readonly log = new Logger('AuctionSweep');
  constructor(readonly intervalMs: number, protected readonly uow: UnitOfWork, protected readonly repo: AuctionRepository, protected readonly auctions: AuctionService, protected readonly limit = 100) {}
  protected abstract claim(tx: TxContext, tenantId: string, now: Date): Promise<string[]>;
  protected abstract act(tenantId: string, id: string, now: Date): Promise<boolean>;

  async sweep(pool: Pool, now: Date = new Date()): Promise<SweepResult> {
    const tenants = await this.repo.tenantsWith(pool, this.statuses);
    let claimed = 0, acted = 0, failed = 0;
    for (const tenantId of tenants) {
      let ids: string[] = [];
      try { ids = await this.uow.run(tenantId, (tx) => this.claim(tx, tenantId, now), { userId: 'system' }); } catch { failed++; continue; }
      claimed += ids.length;
      for (const id of ids) { try { if (await this.act(tenantId, id, now)) acted++; } catch { failed++; } }
    }
    return { tenants: tenants.length, claimed, acted, failed };
  }
  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.acted > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.acted} acted, ${r.failed} failed, of ${r.claimed} claimed across ${r.tenants} tenant(s)`);
  }
}

export class OpenScheduledAuctionsJob extends AuctionSweep {
  readonly name = 'auctions-open-scheduled';
  protected readonly statuses = ['scheduled'] as const;
  protected claim(tx: TxContext, t: string, now: Date) { return this.repo.dueToOpen(tx, t, now, this.limit); }
  protected act(t: string, id: string, now: Date) { return this.auctions.open(t, id, now); }
}

export class CloseEndedAuctionsJob extends AuctionSweep {
  readonly name = 'auctions-close-ended';
  protected readonly statuses = ['live', 'extended'] as const;
  protected claim(tx: TxContext, t: string, now: Date) { return this.repo.dueToClose(tx, t, now, this.limit); }
  protected act(t: string, id: string, now: Date) { return this.auctions.closeAndResolve(t, id, now); }
}

export class SellerDecisionLapseJob extends AuctionSweep {
  readonly name = 'auctions-seller-decision-lapse';
  protected readonly statuses = ['awaiting_approval'] as const;
  protected claim(tx: TxContext, t: string, now: Date) { return this.repo.dueToLapse(tx, t, now, this.limit); }
  protected act(t: string, id: string, now: Date) { return this.auctions.lapse(t, id, now); }
}

export class ReleaseLosingEmdJob extends AuctionSweep {
  readonly name = 'auctions-release-losing-emd';
  protected readonly statuses = ['ended', 'settled', 'awaiting_approval', 'failed_reserve', 'cancelled', 'defaulted'] as const;
  constructor(intervalMs: number, uow: UnitOfWork, repo: AuctionRepository, auctions: AuctionService, private readonly windowMins = 1440) { super(intervalMs, uow, repo, auctions); }
  protected claim(tx: TxContext, t: string, now: Date) { return this.repo.recentlyClosed(tx, t, new Date(now.getTime() - this.windowMins * 60_000), this.limit); }
  protected async act(t: string, id: string) { return (await this.auctions.releaseLosingEmd(t, id)).released > 0; }
}

export class AuctionDefaultJob extends AuctionSweep {
  readonly name = 'auctions-balance-default';
  protected readonly statuses = ['settled'] as const;
  constructor(intervalMs: number, uow: UnitOfWork, repo: AuctionRepository, auctions: AuctionService, private readonly settlements: AuctionSettlementRepository) { super(intervalMs, uow, repo, auctions); }
  protected claim(tx: TxContext, t: string, now: Date) { return this.settlements.dueForDefault(tx, t, now, this.limit); }
  protected async act(t: string, id: string, now: Date) { return (await this.auctions.defaultIfUnpaid(t, id, now)) === 'defaulted'; }
}
