// modules/insights/insights.module.ts · PC-56 TENANT-SW-f — THE TENANT INSIGHTS (W193 mandi pulse, W194 demand map, W195 wastage, W196 the
// report builder), the last sweep wave. A READ module over facts other modules record, plus two writes it owns: `wastage_events` (written
// ONLY from recorded source facts, by the database's own derivation) and the tenant report store (definitions, runs, frozen results,
// schedules). Every figure travels with its method or is refused by name (F-24 / F-27).
//
// REGISTERED HERE (onModuleInit):
//   • 5 outbox handlers — one WastageSourceHandler per source event (returns refunded · pours rejected · POD disputes resolved · cold-chain
//     losses · POD rejections), each writing in kv_app's unit of work (HOTFIX-2 relay gate: exercised as kv_relay);
//   • 2 scheduled jobs — insights-reports (15 s) and insights-wastage-sweep (hourly), kv_relay sweep of `tenants`, kv_app per tenant;
//   • 4 datasets on the 6e-2 plane — mandi_pulse_member_crops, demand_map, wastage_events, report_run.
// Flags: market_intel (W193), requirements (W194), insights_wastage (W195), insights_reports (W196), tenant_exports (the plane) — all OFF.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { OUTBOX_HANDLER_REGISTRY } from '../../core/outbox/event-envelope';
import { OutboxHandlerRegistry } from '../../core/outbox/outbox.dispatcher';
import { SCHEDULED_JOB_REGISTRY, ScheduledJobRegistry } from '../../core/jobs/scheduled-job.registry';
import { DATASET_REGISTRY, DatasetRegistry } from '../../core/exports-plane/dataset.registry';
import { UNIT_OF_WORK, UnitOfWork } from '../../core/database/unit-of-work';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { InsightsController, ReportsController } from './controllers/v1/insights.controller';
import { InsightsService } from './services/insights.service';
import { ReportRunner, ReportService } from './services/report.service';
import { InsightsRepository } from './repositories/insights.repository';
import { ReportRepository } from './repositories/report.repository';
import { DemandMapDataset, MandiPulseDataset, ReportRunDataset, WastageEventsDataset } from './exports/insights.datasets';
import { ReportsCadenceJob, WastageSweepJob } from './jobs/insights.jobs';
import { WASTAGE_SOURCE_EVENTS, WastageSourceHandler } from './events/handlers/wastage-source.handler';

export const REPORTS_TICK_MS = 15_000;
export const WASTAGE_SWEEP_MS = 60 * 60_000;

@Module({
  controllers: [InsightsController, ReportsController],
  providers: [
    InsightsService, ReportService, ReportRunner, InsightsRepository, ReportRepository, UiMessageRepository,
    MandiPulseDataset, DemandMapDataset, WastageEventsDataset, ReportRunDataset,
    { provide: ReportsCadenceJob, useFactory: (r: ReportRunner) => new ReportsCadenceJob(REPORTS_TICK_MS, r), inject: [ReportRunner] },
    { provide: WastageSweepJob, useFactory: (uow: UnitOfWork, repo: InsightsRepository) => new WastageSweepJob(WASTAGE_SWEEP_MS, uow, repo), inject: [UNIT_OF_WORK, InsightsRepository] },
  ],
  exports: [InsightsService, ReportService, ReportRunner],
})
export class InsightsModule implements OnModuleInit {
  constructor(
    @Inject(OUTBOX_HANDLER_REGISTRY) private readonly handlers: OutboxHandlerRegistry,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly jobs: ScheduledJobRegistry,
    @Inject(DATASET_REGISTRY) private readonly datasets: DatasetRegistry,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: InsightsRepository,
    private readonly reportsJob: ReportsCadenceJob,
    private readonly sweepJob: WastageSweepJob,
    private readonly mandi: MandiPulseDataset,
    private readonly demand: DemandMapDataset,
    private readonly wastage: WastageEventsDataset,
    private readonly reportRun: ReportRunDataset,
  ) {}
  onModuleInit(): void {
    for (const s of WASTAGE_SOURCE_EVENTS) this.handlers.register(new WastageSourceHandler(s.eventType, s.table, s.idKey, this.uow, this.repo));
    this.jobs.register(this.reportsJob);
    this.jobs.register(this.sweepJob);
    this.datasets.register(this.mandi);
    this.datasets.register(this.demand);
    this.datasets.register(this.wastage);
    this.datasets.register(this.reportRun);
  }
}
