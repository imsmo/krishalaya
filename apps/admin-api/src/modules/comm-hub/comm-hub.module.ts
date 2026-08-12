// apps/admin-api/src/modules/comm-hub/comm-hub.module.ts · W050 (PC-56 ADMIN-SWEEP-b2).
//
// SEPARATE FROM support-oversight, and the split is the permission surface: that module is the WINDOW
// (`support.oversight.*` — queues, SLA boards, tenant health, coaching), this one is the WORKBENCH (`support.hub`
// — claim, presence, the per-principal cross-tenant thread). Folding them together would hand every NOC viewer the
// deepest per-person support read on the platform.
import { Module } from '@nestjs/common';
import { CommHubController } from './comm-hub.controller';
import { CommHubRepository } from './repositories/comm-hub.repository';
import { CommHubService } from './services/comm-hub.service';

@Module({
  controllers: [CommHubController],
  providers: [CommHubRepository, CommHubService],
})
export class CommHubModule {}
