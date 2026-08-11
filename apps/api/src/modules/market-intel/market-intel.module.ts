// modules/market-intel/market-intel.module.ts
// Market Intelligence — Mandi Pulse (PRD §16.2). A global mandi registry + a billions-of-rows price-observation
// log (ingested from Agmarknet/eNAM/platform/ambassador), deterministic fair-price BANDS (P10/P50/P90), and
// per-farmer price-threshold ALERTS. Ingesting a price evaluates the tenant's active alerts and emits a
// PriceAlertTriggered event (the notification spine alerts the farmer). Money-free (prices are bigint observation
// data, not wallet movements). Gated by the `market_intel` flag (default OFF).
//
// SCOPE: mandi browse + price ingest/history/pulse + baseline prediction generate/read + price-alert CRUD +
// on-ingest alert firing. DEFERRED: Agmarknet/eNAM external ingest jobs (need the external API) + platform_txn
// aggregation from completed orders + an external ML prediction model (baseline percentile band is wired) +
// search synonyms (catalogue concern, not market-intel).
import { Module } from '@nestjs/common';
import { MandiPricesController } from './controllers/v1/mandi-prices.controller';
import { PredictionsController } from './controllers/v1/predictions.controller';
import { PriceAlertsController } from './controllers/v1/price-alerts.controller';
import { MandiService } from './services/mandi.service';
import { MandiPriceService } from './services/mandi-price.service';
import { PricePredictionService } from './services/price-prediction.service';
import { PriceAlertService } from './services/price-alert.service';
import { MandiPulseReadModel } from './read-models/mandi-pulse.read-model';
import { MarketNamesReadModel } from './read-models/market-names.read-model';
import { MarketSettingsReadModel } from './read-models/market-settings.read-model';
import { MandiRepository } from './repositories/mandi.repository';
import { MandiPriceRepository } from './repositories/mandi-price.repository';
import { PricePredictionRepository } from './repositories/price-prediction.repository';
import { PriceAlertRepository } from './repositories/price-alert.repository';

@Module({
  controllers: [MandiPricesController, PredictionsController, PriceAlertsController],
  providers: [
    MandiService, MandiPriceService, PricePredictionService, PriceAlertService, MandiPulseReadModel, MarketNamesReadModel, MarketSettingsReadModel,
    MandiRepository, MandiPriceRepository, PricePredictionRepository, PriceAlertRepository,
  ],
  exports: [MandiPriceService, PricePredictionService],
})
export class MarketIntelModule {}
