// apps/admin-api/src/modules/settings-ops/settings-ops.module.ts · W103 (PC-56 ADMIN-11).
//
// The typed platform registry. `setting_definitions` has existed since 0002 with a `scope` column whose 'platform' value
// was readable by NO surface in the monorepo; 0121 adds the value layer, the risk class and the history, and this module
// is the first code in either realm that can write a platform setting.
import { Module } from '@nestjs/common';
import { SettingsOpsController } from './settings-ops.controller';
import { SettingsOpsService } from './services/settings-ops.service';
import { SettingsRepository } from './repositories/settings.repository';

@Module({
  controllers: [SettingsOpsController],
  providers: [SettingsOpsService, SettingsRepository],
  exports: [SettingsOpsService],
})
export class SettingsOpsModule {}
