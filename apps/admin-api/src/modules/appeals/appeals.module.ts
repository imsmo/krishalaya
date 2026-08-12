// apps/admin-api/src/modules/appeals/appeals.module.ts · W097 + W1953–W1955 (PC-56 ADMIN-SWEEP-b1).
//
// SEPARATE FROM moderation-queue (ADMIN-5f) AND FROM trust-safety (ADMIN-5d), because the security object differs
// from both: this module sits in judgement ON the other two. Its writes span four planes at once — a tenant's
// listing/review, the platform's risk file, the notice rail, and a register about a named reviewer's work — and its
// one permission (`moderation.appeals`) is exactly the grant that must be separable from the grants that make the
// original calls, or the ≠-reviewer rule collapses into a formality (see owner-roles.ts).
import { Module } from '@nestjs/common';
import { AppealsController } from './appeals.controller';
import { AppealsRepository } from './repositories/appeals.repository';
import { AppealsQueueService } from './services/appeals-queue.service';
import { AppealDecisionService } from './services/appeal-decision.service';

@Module({
  controllers: [AppealsController],
  providers: [AppealsRepository, AppealsQueueService, AppealDecisionService],
})
export class AppealsModule {}
