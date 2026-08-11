// modules/market-ops/market-ops.module.ts · W107 (PC-56 ADMIN-SWEEP).
//
// The price-intelligence plane, and the quarantine that stops a typo becoming a farmer's selling decision. Every
// provider registered — the ADMIN-10 lesson about a module that imports and does not list.
import { Module } from '@nestjs/common';
import { MarketOpsController } from './market-ops.controller';
import { MarketOpsService } from './services/market-ops.service';
import { MandiPulseRepository } from './repositories/mandi-pulse.repository';

@Module({
  controllers: [MarketOpsController],
  providers: [MarketOpsService, MandiPulseRepository],
  exports: [MarketOpsService],
})
export class MarketOpsModule {}
