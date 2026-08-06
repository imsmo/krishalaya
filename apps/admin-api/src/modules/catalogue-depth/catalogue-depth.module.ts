// apps/admin-api/src/modules/catalogue-depth/catalogue-depth.module.ts · PC-54 W54-11 slice 1,
// deepened by PC-56 ADMIN-3 (the EAV definition plane gains its write path, its repository and its audit trail).
import { Module } from '@nestjs/common';
import { CatalogueDepthController } from './catalogue-depth.controller';
import { CatalogueDepthService } from './catalogue-depth.service';
import { EavRepository } from './repositories/eav.repository';
import { EavAdminService } from './services/eav-admin.service';

@Module({
  controllers: [CatalogueDepthController],
  providers: [
    // the original read-only service still serves the crops lens (W023, whose two DELTAs are ADMIN-3c's)
    CatalogueDepthService,
    // PC-56 ADMIN-3: attributes, options, bindings, units and conversions — every mutation in ONE transaction with a
    // mandatory reason and a catalogue_changes row, which is the standard the sibling global-catalogue-ops module has
    // always held and this one did not.
    EavRepository, EavAdminService,
  ],
})
export class CatalogueDepthModule {}
