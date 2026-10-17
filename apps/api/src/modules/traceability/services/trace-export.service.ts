// modules/traceability/services/trace-export.service.ts · PC-56 STORE-5b · D2 (founder Q13) — "Download the record" = SIGN-IN, on the export
// plane, CSV. The ONLY door that enqueues `traceability.lot_record` (exports/lot-record.producer.ts):
//   • the caller is signed in (the controller's AuthGuard) — the job's tenant is the caller's SESSION tenant (the 4a rule: the plane's job lives
//     where the person asked from; the plane's requester-only lookup reaches it from any organisation);
//   • the lot passes the SAME gate as the public page (live organisation, its `traceability` flag) — an unpublished lot is never exported;
//   • keyed: the Idempotency-Key (the page mints it at render, a Retry re-sends it) → one job; a second request for the same lot while one is open
//     → the same job (the plane's open-twin rule);
//   • audited `trace.export_requested { qrToken, jobId }` — the token, never a person's name;
//   • the plane refusing (the dataset not registered) → 503 TRACE_EXPORT_UNAVAILABLE by name.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { ExportPlaneService } from '../../../core/exports-plane/export-plane.service';
import { UnknownDatasetError } from '../../../core/exports-plane/domain/export-plane.errors';
import { PublicScanService } from './public-scan.service';
import { LOT_RECORD_DATASET } from '../exports/lot-record.producer';
import { TraceExportUnavailableError } from '../domain/traceability.errors';

@Injectable()
export class TraceExportService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly plane: ExportPlaneService,
    private readonly scans: PublicScanService,
  ) {}

  async request(sessionTenantId: string, userId: string, qrToken: string, idemKey: string, ip: string | null): Promise<{ jobId: string }> {
    await this.scans.liveRow(qrToken);   // the public page's gate: unknown / never live → 404, no longer live → 404 by name, OFF → 404 by name
    return this.idem.remember(idemKey, userId, 'trace.export', async () => {
      let r: { kind: 'queued'; jobId: string } | { kind: 'off' };
      try {
        r = await this.uow.run(sessionTenantId, async (tx) => {
          const q = await this.plane.enqueueInTx(tx, sessionTenantId, userId, { datasetCode: LOT_RECORD_DATASET, params: { qrToken } }, ip);
          if (q.kind === 'queued') {
            await this.audit.write(tx, { tenantId: sessionTenantId, actorUserId: userId, action: 'trace.export_requested', entityType: 'tenant_export_job', entityId: q.jobId,
              newValue: { qrToken, dataset: LOT_RECORD_DATASET }, ip });
          }
          return q;
        }, { userId });
      } catch (e) {
        if (e instanceof UnknownDatasetError) throw new TraceExportUnavailableError('the trace record is not registered on the export plane');
        throw e;
      }
      if (r.kind !== 'queued') throw new TraceExportUnavailableError();
      this.metrics.inc('trace.export_requested');
      return { jobId: r.jobId };
    });
  }
}
