// apps/admin-api/src/modules/partner-ops/partner-ops.module.ts · PC-56 PARTNER-1a (founder D2 + D3, migration 0226).
//
// The partner registry: the first surface in either realm that lists `financial_partners`, sets a partner's published
// decision SLA, and appoints a partner's FIRST administrator (the only partner-realm row kv_admin may create).
import { Module } from '@nestjs/common';
import { PartnerOpsController } from './partner-ops.controller';
import { PartnerOpsService } from './services/partner-ops.service';
import { PartnerOpsRepository } from './repositories/partner-ops.repository';

@Module({
  controllers: [PartnerOpsController],
  providers: [PartnerOpsService, PartnerOpsRepository],
})
export class PartnerOpsModule {}
