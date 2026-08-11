// modules/market-intel/services/mandi-price.service.ts · ingest price observations + serve the Mandi Pulse.
// ingest needs market.manage; it appends one observation (idempotent per (user, endpoint)), then EVALUATES the
// tenant's active price alerts for that product+region and emits a PriceAlertTriggered event per crossing — the
// notification spine turns those into farmer alerts. One ACID tx, outbox in-tx (Law 4). Money is bigint (Law 2).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { MandiPrice } from '../domain/mandi-price.entity';
import { MarketEventType, PriceSource } from '../domain/market-intel.events';
import { MandiPriceRepository } from '../repositories/mandi-price.repository';
import { PriceAlertRepository } from '../repositories/price-alert.repository';
import { MarketNamesReadModel, withNames } from '../read-models/market-names.read-model';
import { MarketForbiddenError } from '../domain/market-intel.errors';
import { gate, mayFeedFarmerAlerts } from '../domain/price-anomaly';
import { MarketSettingsReadModel } from '../read-models/market-settings.read-model';

export interface MarketActor { userId: string; canManage: boolean; }

@Injectable()
export class MandiPriceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly prices: MandiPriceRepository,
    private readonly alerts: PriceAlertRepository,
    private readonly names: MarketNamesReadModel,
    // PC-56 ADMIN-SWEEP: the anomaly threshold and the gated-source list are PLATFORM SETTINGS (0124), so a founder can
    // tighten a control on a farmer's income without a deploy — ADMIN-11 built the registry for exactly this shape.
    private readonly settings: MarketSettingsReadModel,
  ) {}

  async ingest(tenantId: string, actor: MarketActor, idemKey: string, dto: { mandiId?: string | null; regionId?: string | null; productId: string; gradeOptionId?: string | null; priceDate: string; minMinor?: string | null; maxMinor?: string | null; modalMinor: string; unitCode: string; arrivalsQty?: string | null; source: string }) {
    if (!actor.canManage) throw new MarketForbiddenError('requires market.manage');
    return this.idem.remember(idemKey, actor.userId, 'market.price.ingest', () =>
      timed(this.metrics, 'market.price.ingest', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          // **THE GATE W107 PROMISED AND NOTHING IMPLEMENTED.** Before this wave, ingest inserted the observation and
          // fired farmer alerts off it in this same transaction — so an ambassador who typed ₹64,200 instead of ₹6,420
          // sent "groundnut is above your threshold" to every subscribed farmer in the region, in Gujarati, and W109's
          // timeline shows what a farmer does next: "alerted in Gujarati, listed same day".
          const policy = await this.settings.anomalyPolicy();
          const price = MandiPrice.observe({ mandiId: dto.mandiId ?? null, regionId: dto.regionId ?? null, productId: dto.productId, gradeOptionId: dto.gradeOptionId ?? null, priceDate: dto.priceDate,
            minMinor: dto.minMinor != null ? BigInt(dto.minMinor) : null, maxMinor: dto.maxMinor != null ? BigInt(dto.maxMinor) : null, modalMinor: BigInt(dto.modalMinor), unitCode: dto.unitCode, arrivalsQty: dto.arrivalsQty ?? null, source: dto.source as PriceSource, currencyCode: 'INR' });
          // The reference is read INSIDE the transaction, on the writer, from accepted observations only: judging one
          // bad price against the last bad price is how a typo becomes the new normal.
          const reference = await this.prices.referenceModal(tx, price.productId, price.regionId, dto.priceDate);
          const verdict = gate({
            source: dto.source, modalMinor: price.modalMinor, referenceModalMinor: reference,
            thresholdBp: policy.thresholdBp, gatedSources: policy.gatedSources,
          });

          const written = await this.prices.insert(tx, price, verdict);
          for (const e of price.pullEvents()) await this.outbox.write(tx, { tenantId, aggregateType: 'mandi_price', aggregateId: dto.productId, eventType: e.type, payload: { v: 1, ...e.payload, anomalyState: verdict.state, deviationBp: verdict.deviationBp } });

          if (verdict.state === 'quarantined') {
            // Recorded, visible, and feeding NOTHING until a human decides. The queue row is also the ambassador's
            // feedback path — the farmer is deliberately told nothing, because they never knew about the observation and
            // "a price we nearly sent you was wrong" would manufacture doubt about the prices that are right.
            await this.prices.enqueueAnomalyReview(tx, {
              tenantId, priceId: written.id, priceDate: written.priceDate, deviationBp: verdict.deviationBp,
            });
            this.metrics.inc('market.price.quarantined', { tenant: tenantId, source: dto.source });
            // **AND THE ALERT LOOP IS NOT ENTERED.** This early return is the whole fix; everything else on this path is
            // the record of why.
            return { ...price.toJSON(), id: written.id, anomalyState: verdict.state, deviationBp: verdict.deviationBp, alertsFired: 0 };
          }

          // Belt and braces, and named rather than assumed: only an accepted or released observation may feed an alert.
          // The next person to touch this loop trips over the function name.
          if (!mayFeedFarmerAlerts(verdict.state)) {
            return { ...price.toJSON(), id: written.id, anomalyState: verdict.state, deviationBp: verdict.deviationBp, alertsFired: 0 };
          }

          // fire matching alerts (this tenant's active subscriptions for this product+region)
          let fired = 0;
          for (const alert of await this.alerts.matchActive(tx, tenantId, price.productId, price.regionId)) {
            if (!alert.isCrossedBy(price.modalMinor)) continue;
            fired++;
            const ap = alert.toProps();
            await this.outbox.write(tx, { tenantId, aggregateType: 'price_alert', aggregateId: alert.id, eventType: MarketEventType.PriceAlertTriggered,
              payload: { v: 1, alertId: alert.id, userId: alert.userId, productId: price.productId, modalMinor: price.modalMinor.toString(), thresholdMinor: ap.thresholdMinor.toString(), direction: ap.direction } });
            // Append the trigger-log row IN this tx (Law 4) so the per-user "triggered today/this week" count (P1-3)
            // can never drift from the fired events.
            await this.alerts.insertTrigger(tx, { tenantId, alertId: alert.id, userId: alert.userId, productId: price.productId, regionId: price.regionId, direction: ap.direction, modalMinor: price.modalMinor, thresholdMinor: ap.thresholdMinor });
          }
          this.metrics.inc('market.alerts.fired', { tenant: tenantId }, fired);
          return { ...price.toJSON(), id: written.id, anomalyState: verdict.state, deviationBp: verdict.deviationBp, alertsFired: fired };
        }, { userId: actor.userId })));
  }

  async list(tenantId: string, q: { productId: string; regionId?: string; mandiId?: string; fromDate?: string; cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.prices.listFor(tenantId, q);
    const base = rows.map((m) => m.toJSON());
    const maps = await this.names.resolve(tenantId, base as any);   // commodity/grade/region names (bounded by the page)
    const items = base.map((m) => withNames(m as any, maps));
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.priceDate}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
}
