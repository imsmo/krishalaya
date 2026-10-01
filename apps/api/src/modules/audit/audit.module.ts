// modules/audit/audit.module.ts
// THE AUDITOR REALM (PRD §7 · auditor surface; PC-56 TENANT-9c): the audit-trail browse (masked, bounded, itself recorded),
// the overview (W200), the ledger drill-down through the tenant funnel (W436), the compliance pack computed on read (W437)
// and the auditor's exports on the 6e-2 plane (W201 / W2498 / W2499) — three datasets registered here. The trail itself is
// written only by core/audit AuditWriter inside business transactions; this module writes only `audit_read_log` (the
// record of its own reads) and, through the plane, export jobs. The realm is read-only BY CONSTRUCTION: the global
// AuditorReadOnlyGuard (core/auth) refuses an auditor session every non-GET, the enqueue the one named exception.
// Gated by the `audit_trail` flag (read in the services) + the read codes (audit.read, ledger.read). Imports PaymentsModule
// for its exported ledger funnel (`AuditorLedgerReadModel`) — a read model, never a repository.
import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { DATASET_REGISTRY, DatasetRegistry } from '../../core/exports-plane/dataset.registry';
import { UiMessageRepository } from '../../core/i18n/ui-message.repository';
import { PaymentsModule } from '../payments/payments.module';
import { AuditController } from './controllers/v1/audit.controller';
import { AuditorController } from './controllers/v1/auditor.controller';
import { AuditService } from './services/audit.service';
import { AuditorService } from './services/auditor.service';
import { AuditRepository } from './repositories/audit.repository';
import { AuditReadLogRepository } from './repositories/audit-read-log.repository';
import { AuditorClockRepository } from './repositories/auditor-clock.repository';
import { AuditorComplianceReadModel } from './read-models/auditor-compliance.read-model';
import { AuditTrailDataset, CompliancePackDataset, LedgerEntriesDataset } from './exports/auditor.datasets';

@Module({
  imports: [PaymentsModule],
  controllers: [AuditController, AuditorController],
  providers: [
    AuditService, AuditorService, AuditRepository, AuditReadLogRepository, AuditorClockRepository, AuditorComplianceReadModel,
    AuditTrailDataset, LedgerEntriesDataset, CompliancePackDataset, UiMessageRepository,
  ],
  exports: [AuditService],
})
export class AuditTrailModule implements OnModuleInit {
  constructor(
    @Inject(DATASET_REGISTRY) private readonly datasets: DatasetRegistry,
    private readonly trailDataset: AuditTrailDataset,
    private readonly ledgerDataset: LedgerEntriesDataset,
    private readonly packDataset: CompliancePackDataset,
  ) {}
  onModuleInit(): void {
    this.datasets.register(this.trailDataset);
    this.datasets.register(this.ledgerDataset);
    this.datasets.register(this.packDataset);
  }
}
