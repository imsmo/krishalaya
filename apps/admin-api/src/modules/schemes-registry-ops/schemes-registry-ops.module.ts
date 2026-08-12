// apps/admin-api/src/modules/schemes-registry-ops/schemes-registry-ops.module.ts · the god-mode GOVERNMENT-SCHEME
// MASTER plane (Law 11). Owns scheme_authorities (issuing bodies) + the code-keyed, versioned schemes catalogue
// (0011) the apps/api schemes module reads READ-ONLY and snapshots into scheme_applications.scheme_version.
// Three services: scheme-crud (authority + scheme identity/lifecycle), eligibility-rules-editor (version-bumping
// eligibility/benefit/fee/doc/region edits), window-calendar (application window + open-on-date reads). Mounts
// under AdminCoreModule (auth / RBAC / FIDO2 / step-up / audit @Global).
import { SchemesDepthService } from './depth.service';
import { Module } from '@nestjs/common';
import { SchemesRegistryOpsController } from './schemes-registry-ops.controller';
import { SchemesRegistryRepository } from './repositories/schemes-registry.repository';
import { SchemeCrudService } from './services/scheme-crud.service';
import { EligibilityRulesEditorService } from './services/eligibility-rules-editor.service';
import { WindowCalendarService } from './services/window-calendar.service';
import { SchemeVersionService } from './services/scheme-version.service';
import { AuthorityPortalService } from './services/authority-portal.service';
import { SchemeExportService } from './services/scheme-export.service';
import { PortalSyncService } from './services/portal-sync.service';

@Module({
  controllers: [SchemesRegistryOpsController],
  providers: [SchemesRegistryRepository, SchemeCrudService, EligibilityRulesEditorService, WindowCalendarService, SchemesDepthService, SchemeVersionService, AuthorityPortalService, SchemeExportService, PortalSyncService],
})
export class SchemesRegistryOpsModule {}
