// apps/admin-api/src/modules/farmer360/farmer360.module.ts · W109 (PC-56 ADMIN-SWEEP-b4).
//
// SEPARATE FROM platform-reports, because the security object differs by kind, not degree: that plane answers
// questions about POPULATIONS; this one opens ONE NAMED FARMER's whole life with the platform. Its permission is
// its own (`analytics.farmer360`), its every view writes an access row before it returns, and its assembly refuses
// rather than degrades — "no new tables" makes it a lens, and a lens must not silently lose an eye.
import { Module } from '@nestjs/common';
import { Farmer360Controller } from './farmer360.controller';
import { Farmer360Repository } from './repositories/farmer360.repository';
import { Farmer360Service } from './services/farmer360.service';

@Module({
  controllers: [Farmer360Controller],
  providers: [Farmer360Repository, Farmer360Service],
})
export class Farmer360Module {}
