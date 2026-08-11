// modules/market-ops/services/market-ops.service.ts · W107 (PC-56 ADMIN-SWEEP).
//
// The Mandi Pulse, and the quarantine worklist that makes W107's central promise true for the first time.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { MandiPulseRepository } from '../repositories/mandi-pulse.repository';
import {
  RELEASE_DOES_NOT_BACKFILL_ALERTS, canDecide, guardStateKey, humanEnteredShare, ingestLagP95Minutes, sourceShares,
} from '../domain/mandi-pulse';
import { PriceObservationNotFoundError, PriceAlreadyDecidedError } from '../domain/market-ops.errors';

/** Owners of what this wave did not build, named so the console can print them beside the absent figures. */
export const INGEST_LAG_HISTORY_OWNER = 'ADMIN-SWEEP-Q1';
export const AMBASSADOR_FEEDBACK_OWNER = 'ADMIN-SWEEP-Q2';

@Injectable()
export class MarketOpsService {
  constructor(
    private readonly pool: AdminPool,
    private readonly repo: MandiPulseRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  async pulse(q: { movers: number }) {
    const [census, movers] = await Promise.all([this.repo.census(), this.repo.movers(q.movers)]);
    const p95 = ingestLagP95Minutes(census.lagsMinutes);
    const manualPct = humanEnteredShare(census.sourceMix);
    return {
      data: {
        pointsToday: census.pointsToday,
        activeMandis: census.activeMandis,
        sourceMix: sourceShares(census.sourceMix),
        // **THE FIGURE THAT HAD NO SOURCE UNTIL 0124**, and is NULL rather than zero for any window whose rows predate
        // it: `mandi_prices` had no arrival timestamp at all, and a backfill from `price_date` would have been a
        // fabricated number on the one column whose purpose is measuring promptness.
        ingestLagP95Minutes: p95,
        ingestLagSampleSize: census.lagsMinutes.length,
        stampedToday: census.stampedToday,
        staleMandis: census.staleMandis,
        // The tile the canon does not print and the plane exists for.
        heldToday: census.heldToday,
        heldOpen: census.heldOpen,
        manualSharePct: manualPct,
        movers,
      },
      meta: {
        guardState: guardStateKey(census.heldToday, manualPct),
        ingestLagOwner: INGEST_LAG_HISTORY_OWNER,
        // Day-granular by construction: `price_date` is a DATE, so "stale >48h" is "stale by more than two dates".
        stalenessBasis: 'mp11.stale.basis',
      },
    };
  }

  async quarantine(q: { includeDecided?: boolean; limit: number }) {
    const rows = await this.repo.quarantined(q);
    return {
      data: rows,
      meta: {
        releaseNote: RELEASE_DOES_NOT_BACKFILL_ALERTS,
        feedbackOwner: AMBASSADOR_FEEDBACK_OWNER,
        // An empty queue means either clean data or a gate that is not gating, and the pulse's manual share is what
        // tells them apart. Said here so the console does not have to infer it.
        emptyMeaning: 'mp11.q.emptyMeaning',
      },
    };
  }

  /**
   * Release or reject a held observation.
   *
   * **RELEASING DOES NOT BACKFILL THE ALERTS IT WOULD HAVE FIRED**, and that is a refusal rather than an omission. An
   * alert saying "groundnut crossed your threshold" delivered nine hours late, after the mandi has closed, invites a
   * farmer to act on a window that has shut — worse than no alert. The queue's job is to be fast, not to time-travel.
   */
  async decide(actor: AdminRequestContext, id: string, dto: {
    priceDate: string; decision: 'released' | 'rejected'; note: string;
  }) {
    return this.pool.withTx(async (c) => {
      const row = await this.repo.forUpdate(c, id, dto.priceDate);
      if (!row) throw new PriceObservationNotFoundError(id);
      if (!canDecide(row.anomalyState)) throw new PriceAlreadyDecidedError(id, row.anomalyState);

      await this.repo.decide(c, { id, priceDate: dto.priceDate, to: dto.decision, adminId: actor.userId, note: dto.note });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: `market.price_${dto.decision}`, entityType: 'mandi_price', entityId: id,
        oldValue: { anomalyState: row.anomalyState, modalMinor: row.modalMinor },
        newValue: { anomalyState: dto.decision, priceDate: dto.priceDate },
        reason: dto.note, ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        id, anomalyState: dto.decision,
        // Stated on the response as well as the screen: a released price feeds alerts from NOW, not retroactively.
        backfillNote: RELEASE_DOES_NOT_BACKFILL_ALERTS,
        feedbackOwner: AMBASSADOR_FEEDBACK_OWNER,
      };
    });
  }
}
