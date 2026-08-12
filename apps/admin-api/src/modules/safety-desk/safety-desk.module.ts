// apps/admin-api/src/modules/safety-desk/safety-desk.module.ts · W058 (PC-56 ADMIN-SWEEP-b3).
//
// SEPARATE FROM support-oversight AND comm-hub, because this desk's security object is narrower than both: a
// protected-category case register (`safety.desk` — who may even see that a named person raised a women_safety
// alert), with an append-only step log in 0098's honest vocabulary. The desk records human acts; it performs none.
import { Module } from '@nestjs/common';
import { SafetyDeskController } from './safety-desk.controller';
import { SafetyDeskRepository } from './repositories/safety-desk.repository';
import { SafetyDeskService } from './services/safety-desk.service';

@Module({
  controllers: [SafetyDeskController],
  providers: [SafetyDeskRepository, SafetyDeskService],
})
export class SafetyDeskModule {}
