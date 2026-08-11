// apps/admin-api/src/modules/templates-ops/templates-ops.module.ts · W101/W102 (PC-56 ADMIN-11b).
//
// The plane that makes three written-down rules true: security copy is platform-controlled, a published wording is never
// edited, and an edit re-enters provider approval before it can be sent.
//
// **EVERY PROVIDER IS REGISTERED HERE, and the reason is a defect this programme has hit before**: ADMIN-10 found three
// services imported into a module and never listed, which compiles clean and 500s at the first request.
import { Module } from '@nestjs/common';
import { TemplatesOpsController } from './templates-ops.controller';
import { TemplatesOpsService } from './services/templates-ops.service';
import { TemplatesRepository } from './repositories/templates.repository';

@Module({
  controllers: [TemplatesOpsController],
  providers: [TemplatesOpsService, TemplatesRepository],
  exports: [TemplatesOpsService],
})
export class TemplatesOpsModule {}
