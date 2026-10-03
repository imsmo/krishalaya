// modules/market-intel/services/price-prediction.service.ts · generate + serve fair-price bands.
// PC-56 TENANT-12: generate is REFUSED from the tenant API (409, see below); read returns the latest band a governed producer wrote.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { PricePredictionRepository } from '../repositories/price-prediction.repository';
import { MandiPriceRepository } from '../repositories/mandi-price.repository';
import { MarketForbiddenError, PredictionRefusedError } from '../domain/market-intel.errors';
import { MarketActor } from './mandi-price.service';

@Injectable()
export class PricePredictionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly predictions: PricePredictionRepository,
    private readonly prices: MandiPriceRepository,
  ) {}

  /**
   * PC-56 TENANT-12 (F-4 / F-1): REFUSED (409 MARKET_PREDICTION_REFUSED). A band generated here was a GLOBAL row every tenant
   * reads, stamped with the literal 'baseline-v1', registered in no `ai_models` row and logged in no `ai_inferences` row — the
   * AI-shaped figure this wave's law forbids. 0190 also revoked kv_app's INSERT on price_predictions. The read (`latest`) stays.
   * The baseline computation stays in the domain (`PricePrediction.baseline`) for the governed producer that will own it.
   */
  async generate(tenantId: string, actor: MarketActor, dto: { productId: string; regionId: string; gradeOptionId?: string | null; targetDate: string; lookbackDays: number }): Promise<never> {
    if (!actor.canManage) throw new MarketForbiddenError('requires market.manage');
    throw new PredictionRefusedError();
  }

  async latest(tenantId: string, productId: string, regionId: string) {
    const p = await this.predictions.latest(tenantId, productId, regionId);
    return p ? p.toJSON() : null;
  }

}
