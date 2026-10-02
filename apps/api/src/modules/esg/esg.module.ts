// modules/esg/esg.module.ts · PC-56 TENANT-9d · ESG — NO METHOD, NO METRIC (W423, W424, W2598–W2604).
// The method registry is PLATFORM data (0183, read only); the facts are read where they live (`EsgFactsReadModel` — a read
// model over other modules' tables, never their repositories); the cooperative's own disclosures are its only writes; the
// report is the 6e-2 plane's `esg.metrics` dataset, registered here, UNSIGNED. Behind the `esg` flag; `esg.read` /
// `esg.disclose`. The carbon tables of 0015 are read by nothing here (founder decision owed — wave_9d_report.md).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { DATASET_REGISTRY, DatasetRegistry } from '../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { EsgController } from './controllers/v1/esg.controller';
import { EsgService } from './services/esg.service';
import { EsgRepository } from './repositories/esg.repository';
import { EsgFactsReadModel } from './read-models/esg-facts.read-model';
import { EsgMetricsDataset } from './exports/esg-metrics.dataset';

@Module({
  controllers: [EsgController],
  providers: [EsgService, EsgRepository, EsgFactsReadModel, EsgMetricsDataset, UiMessageRepository],
})
export class EsgModule implements OnModuleInit {
  constructor(@Inject(DATASET_REGISTRY) private readonly datasets: DatasetRegistry, private readonly metricsDataset: EsgMetricsDataset) {}
  onModuleInit(): void { this.datasets.register(this.metricsDataset); }
}
