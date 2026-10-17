// modules/traceability/traceability.module.ts
// Traceability — farm-to-fork QR (PRD §16.3). A farmer/ops opens a traceable lot (qr_token = public capability)
// and appends a tamper-evident, HASH-CHAINED journey (harvested→listed→sold→packed→picked→in_transit→delivered).
// A consumer scans the QR with NO auth and gets a curated, non-PII provenance (via the SECURITY DEFINER
// trace_scan_v3 function, db/migrations/0219). Money-free. Gated by the `traceability` flag (default OFF).
//
// SCOPE: trace-lot create + manual journey append (hash-chained) + owner/manager reads + public QR scan + the public verify read + the
// signed-in record export (the export plane) + the daily platform seal. DEFERRED: auto-fanout of journey events from order/shipment outbox
// (appendForListing() is ready for when the emitting modules carry listing_id) + any public ledger (refused by name — STORE-5b D3).
//
// PC-56 STORE-5b (founder D2 / D3): the seal clock `TraceAnchorClock` is REGISTERED (cadence `trace-anchor`, daily; per organisation with
// `traceability` ON); the `traceability.lot_record` dataset is REGISTERED on the export plane (requester-only).
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { cadenceOf } from '../../core/jobs/clock-cadence';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { AuditWriter } from '../../core/audit/audit.writer';
import { FlagsService } from '../../core/feature-flags/flags.service';
import { DATASET_REGISTRY, DatasetRegistry } from '../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { TraceLotsController } from './controllers/v1/trace-lots.controller';
import { PublicScanController } from './controllers/v1/public-scan.controller';
import { TraceLotService } from './services/trace-lot.service';
import { PublicScanService, TRACEABILITY_FLAG } from './services/public-scan.service';
import { TraceExportService } from './services/trace-export.service';
import { TraceLotRepository } from './repositories/trace-lot.repository';
import { TraceEventRepository } from './repositories/trace-event.repository';
import { LotRecordDataset } from './exports/lot-record.producer';
import { TraceAnchorClock } from './jobs/anchor-hashes.job';

@Module({
  controllers: [TraceLotsController, PublicScanController],
  providers: [TraceLotService, PublicScanService, TraceExportService, TraceLotRepository, TraceEventRepository, LotRecordDataset, UiMessageRepository,
    { provide: TraceAnchorClock,
      useFactory: (uow: UnitOfWork, audit: AuditWriter, lots: TraceLotRepository, flags: FlagsService) =>
        new TraceAnchorClock(cadenceOf('trace-anchor'), uow, audit, lots, (t) => flags.isEnabled(TRACEABILITY_FLAG, { tenantId: t })),
      inject: [UNIT_OF_WORK, AuditWriter, TraceLotRepository, FlagsService] }],
  exports: [TraceLotService],
})
export class TraceabilityModule implements OnModuleInit {
  constructor(
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    @Inject(DATASET_REGISTRY) private readonly datasets: DatasetRegistry,
    private readonly sealClock: TraceAnchorClock,
    private readonly lotRecord: LotRecordDataset,
  ) {}
  onModuleInit(): void {
    this.jobs.register(this.sealClock);        // STORE-5b · D3: the daily platform seal
    this.datasets.register(this.lotRecord);    // STORE-5b · D2: "Download the record" (requester-only, CSV)
  }
}
