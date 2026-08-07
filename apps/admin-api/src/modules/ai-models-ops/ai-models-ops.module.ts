// apps/admin-api/src/modules/ai-models-ops/ai-models-ops.module.ts · the god-mode AI model registry module
// (Law 11). Owns the lifecycle WRITE path for the GLOBAL ai_models table (register/promote/retire + threshold
// tuning) plus fairness reporting. apps/api/modules/ai-governance holds the tenant-facing READ-ONLY mirror.
import { Module } from '@nestjs/common';
import { AiModelsOpsController } from './ai-models-ops.controller';
import { ModelRegistryService } from './services/model-registry.service';
import { ThresholdTuningService } from './services/threshold-tuning.service';
import { FairnessAuditReportsService } from './services/fairness-audit-reports.service';
import { AiModelRepository } from './repositories/ai-model.repository';
import { AiReviewOpsController } from './ai-review-ops.controller';
import { AiGovernanceRepository } from './repositories/ai-governance.repository';
import { FairnessGateService } from './services/fairness-gate.service';
import { AiReviewService } from './services/ai-review.service';

@Module({
  controllers: [AiModelsOpsController, AiReviewOpsController],
  providers: [
    ModelRegistryService, ThresholdTuningService, FairnessAuditReportsService, AiModelRepository,
    // PC-56 ADMIN-7 — the fairness gate, the cross-tenant review queue and the decision explorer.
    AiGovernanceRepository, FairnessGateService, AiReviewService,
  ],
})
export class AiModelsOpsModule {}
