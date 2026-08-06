// apps/admin-api/src/modules/consent-ops/consent-ops.module.ts · the CONSENT plane (PC-56 ADMIN-5b).
//
// Separate from compliance-ops because it is a different object: compliance-ops owns DECISIONS about one person's
// request, and this owns the LEGAL TEXT every person's consent was given against, plus a cross-tenant register of those
// consents. Its permissions, its maker-checker and its immutability rules are all its own.
import { Module } from '@nestjs/common';
import { ConsentOpsController } from './consent-ops.controller';
import { ConsentOpsRepository } from './repositories/consent-ops.repository';
import { ConsentPurposeService } from './services/consent-purpose.service';
import { ConsentRegistryService } from './services/consent-registry.service';

@Module({
  controllers: [ConsentOpsController],
  providers: [ConsentOpsRepository, ConsentPurposeService, ConsentRegistryService],
})
export class ConsentOpsModule {}
