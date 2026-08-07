// apps/admin-api/src/modules/trust-safety/trust-safety.module.ts · the TRUST & SAFETY plane (PC-56 ADMIN-5d).
//
// A module of its own rather than a corner of compliance-ops, and the boundary is the security object. compliance-ops
// answers to a REGULATOR about what the platform did with data. This answers to a FARMER about what the platform did
// to them — a band that gates their bids, a device block that shuts them out, a weight that re-bands a few hundred
// people at once. Different permissions, different second-signature sites, and a different failure mode: a compliance
// mistake is reported late, a trust mistake stops somebody trading today.
import { Module } from '@nestjs/common';
import { TrustSafetyController } from './trust-safety.controller';
import { TrustSafetyRepository } from './repositories/trust-safety.repository';
import { BlocklistService } from './services/blocklist.service';
import { RiskRulesService } from './services/risk-rules.service';
import { RiskBoardService } from './services/risk-board.service';
import { TrustOverviewService } from './services/trust-overview.service';

@Module({
  controllers: [TrustSafetyController],
  providers: [TrustSafetyRepository, BlocklistService, RiskRulesService, RiskBoardService, TrustOverviewService],
})
export class TrustSafetyModule {}
