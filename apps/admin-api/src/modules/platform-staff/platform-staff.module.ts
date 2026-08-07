// apps/admin-api/src/modules/platform-staff/platform-staff.module.ts · PC-56 ADMIN-9.
//
// The realm's own operators: the roster W104 had no source for, the role matrix W105 can honestly show as a READ, the
// my-work session strip of W438 and the security page of W439. The repository lives in core (`OperatorRegistryRepository`)
// because `AdminAuthGuard` reads it on every request — one mapper for these four tables, so the console and the door can
// never disagree about who is suspended.
import { Module } from '@nestjs/common';
import { PlatformStaffController } from './platform-staff.controller';
import { PlatformStaffService } from './services/platform-staff.service';
import { RoleCatalogueService } from './services/role-catalogue.service';

@Module({
  controllers: [PlatformStaffController],
  providers: [PlatformStaffService, RoleCatalogueService],
  exports: [PlatformStaffService],
})
export class PlatformStaffModule {}
