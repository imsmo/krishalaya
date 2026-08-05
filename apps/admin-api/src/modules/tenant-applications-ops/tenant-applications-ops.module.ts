// PC-55 A1 module (admin realm review queue for the public tenant intake).
import { Module } from '@nestjs/common';
import { TenantApplicationsOpsController } from './tenant-applications-ops.controller';
import { TenantApplicationsOpsService } from './tenant-applications-ops.service';

@Module({ controllers: [TenantApplicationsOpsController], providers: [TenantApplicationsOpsService] })
export class TenantApplicationsOpsModule {}
