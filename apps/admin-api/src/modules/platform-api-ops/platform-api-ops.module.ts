// modules/platform-api-ops/platform-api-ops.module.ts · W106 / W007 (PC-56 ADMIN-11c).
//
// The oversight plane for two key registries, the outbound webhook pipeline, and the inbound receipts this wave gave
// the platform for the first time. Every provider registered — the ADMIN-10 lesson, where three services were imported
// and none listed: it compiled clean and 500'd at the first request.
import { Module } from '@nestjs/common';
import { PlatformApiOpsController } from './platform-api-ops.controller';
import { PlatformApiOpsService } from './services/platform-api-ops.service';
import { ApiOversightRepository } from './repositories/api-oversight.repository';

@Module({
  controllers: [PlatformApiOpsController],
  providers: [PlatformApiOpsService, ApiOversightRepository],
  exports: [PlatformApiOpsService],
})
export class PlatformApiOpsModule {}
