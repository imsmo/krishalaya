// apps/admin-api/src/modules/schemes-oversight/schemes-oversight.module.ts · the cross-tenant scheme OVERSIGHT plane
// (PC-56 ADMIN-4b). Separate from schemes-registry-ops because it is a different security object: the registry is
// global data with no person in it, and this module reads FARMERS across every tenant.
//
// Read-only by design. No maker-checker, no FIDO2/step-up on any route — those exist to control CHANGES, and nothing
// here changes anything. The controls that matter on a read plane are different: a permission per data class, a mask
// by default, an audit row on disclosure, and a column law for the fields that must never appear.
import { Module } from '@nestjs/common';
import { SchemesOversightController } from './schemes-oversight.controller';
import { SchemesOversightRepository } from './repositories/schemes-oversight.repository';
import { ApplicationOversightService } from './services/application-oversight.service';
import { DbtMonitorService } from './services/dbt-monitor.service';
import { SchemePerformanceService } from './services/scheme-performance.service';
import { OversightExportService } from './services/oversight-export.service';

@Module({
  controllers: [SchemesOversightController],
  providers: [SchemesOversightRepository, ApplicationOversightService, DbtMonitorService, SchemePerformanceService, OversightExportService],
})
export class SchemesOversightModule {}
