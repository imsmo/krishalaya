// modules/twin/twin.module.ts · PC-56 TENANT-12 · THE DIGITAL TWIN — THE HONEST FRAME (founder decision 2026-10-03: HONEST FRAME, NO
// MODEL · DEVICE REGISTRY ONLY, READINGS REFUSED · LICENSED BY FEATURE FLAG PER PLAN).
//
// W420 overview (ground truth with as-ofs, read where it lives — `TwinFactsReadModel`, never another module's repository), W421
// scenarios (cited assumptions with history; the run refused by the gate and RECORDED), W422 results ("Too few runs — no registered
// model"; the one measured fact). The device registry. The Locked page's one idempotent ask. Tables: 0190. Behind `digital_twin`
// (OFF); `twin.view` / `twin.run` / `twin.devices.manage`. No job. No money path. No model — and no figure a model would print.
import { Module } from '@nestjs/common';
import { TwinController } from './controllers/v1/twin.controller';
import { TwinAccessController } from './controllers/v1/twin-access.controller';
import { TwinService } from './services/twin.service';
import { TwinDevicesService } from './services/twin-devices.service';
import { TwinAccessService } from './services/twin-access.service';
import { TwinRepository } from './repositories/twin.repository';
import { TwinFactsReadModel } from './read-models/twin-facts.read-model';

@Module({
  controllers: [TwinAccessController, TwinController],
  providers: [TwinService, TwinDevicesService, TwinAccessService, TwinRepository, TwinFactsReadModel],
  // PC-56 TENANT-SW-e: logistics registers its cold-chain loggers into 12's registry through this public service (never the repository).
  exports: [TwinDevicesService],
})
export class TwinModule {}
