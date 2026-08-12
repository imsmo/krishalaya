// apps/admin-api/src/modules/demand-map/demand-map.module.ts · W108 (PC-56 ADMIN-SWEEP-c3).
//
// SEPARATE FROM farmer360 AND platform-reports for the same reason those two are separate from each other: the
// security object differs by kind. platform-reports answers ad-hoc questions, farmer360 opens one named person,
// and this module publishes ONE fixed district-grain read whose whole design is DELTA-027's three warnings —
// search ≠ requirement (never blended), district aggregates only, k-anonymity floor before any file leaves.
import { Module } from '@nestjs/common';
import { DemandMapController } from './demand-map.controller';
import { DemandMapRepository } from './repositories/demand-map.repository';
import { DemandMapService } from './services/demand-map.service';

@Module({
  controllers: [DemandMapController],
  providers: [DemandMapRepository, DemandMapService],
})
export class DemandMapModule {}
