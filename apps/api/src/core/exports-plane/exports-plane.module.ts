// core/exports-plane/exports-plane.module.ts · the @Global tenant EXPORT PLANE (PC-56 TENANT-6e-2 · W2553/W2554).
//
// What `core/bulk` is for files coming IN, this is for files going OUT: a queue with a live position and an honest ETA,
// a worker that streams the file and computes its digest, an audit-stamped receipt, a 15-minute signed link and a log of
// every fetch. Generic plumbing — WHAT is in a file is a registered `DatasetProducer`'s business, and dairy's
// `dairy.insights` is the first. Imports `MediaModule` for the object store, as `core/bulk` does.
//
// NOT `modules/exports`, which is the EXPORT-TRADE module (exporters, shipments, documents) and shares only a word.
import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../jobs/scheduled-job.registry';
import { FlagsService } from '../feature-flags/flags.service';
import { ExportsController } from './controllers/v1/exports.controller';
import { ExportPlaneService } from './export-plane.service';
import { ExportWorker } from './export-worker';
import { ExportJobRepository } from './export-job.repository';
import { ExportDownloadRepository } from './export-download.repository';
import { DatasetRegistry, DATASET_REGISTRY } from './dataset.registry';
import { ExportPlaneCadenceJob, EXPORT_TICK_MS } from './jobs/export-plane.cadence-job';

@Global()
@Module({
  imports: [MediaModule],
  controllers: [ExportsController],
  providers: [
    ExportPlaneService, ExportWorker, ExportJobRepository, ExportDownloadRepository,
    DatasetRegistry, { provide: DATASET_REGISTRY, useExisting: DatasetRegistry },
    { provide: ExportPlaneCadenceJob, useFactory: (w: ExportWorker, f: FlagsService) => new ExportPlaneCadenceJob(EXPORT_TICK_MS, w, f), inject: [ExportWorker, FlagsService] },
  ],
  exports: [ExportPlaneService, ExportWorker, DatasetRegistry, DATASET_REGISTRY],
})
export class ExportsPlaneModule implements OnModuleInit {
  constructor(@Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry, private readonly tick: ExportPlaneCadenceJob) {}
  onModuleInit(): void {
    // The registration. Without this line the plane is 0120's shape all over again — a queue table nothing drains.
    this.jobs.register(this.tick);
  }
}
