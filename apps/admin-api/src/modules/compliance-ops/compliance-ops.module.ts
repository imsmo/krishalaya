// apps/admin-api/src/modules/compliance-ops/compliance-ops.module.ts · the god-mode DPDP/COMPLIANCE plane
// (Law 11). Owns: the DPDP data-subject-request queue (access/erasure/correction/portability), the data-export
// approval gate (mass-PII egress control), the append-only audit-log explorer (read-only), retention-policy
// admin, and the DPDP §8 breach-response console. Mounts under AdminCoreModule (auth/RBAC/FIDO2/step-up/audit
// are @Global). It never executes the data deletion/export itself — that's the worker; this owns the DECISIONS.
import { Module } from '@nestjs/common';
import { ComplianceOpsController } from './compliance-ops.controller';
import { ComplianceRepository } from './repositories/compliance.repository';
import { DataSubjectRequestsQueueService } from './services/data-subject-requests-queue.service';
import { TenantExportApprovalsService } from './services/tenant-export-approvals.service';
import { AuditLogExplorerService } from './services/audit-log-explorer.service';
import { RetentionPolicyAdminService } from './services/retention-policy-admin.service';
import { BreachResponseConsoleService } from './services/breach-response-console.service';
import { CompliancePostureService } from './services/compliance-posture.service';

@Module({
  controllers: [ComplianceOpsController],
  providers: [
    ComplianceRepository,
    DataSubjectRequestsQueueService, TenantExportApprovalsService, AuditLogExplorerService,
    RetentionPolicyAdminService, BreachResponseConsoleService, CompliancePostureService,
  ],
})
export class ComplianceOpsModule {}
