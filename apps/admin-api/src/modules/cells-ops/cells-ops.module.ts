// apps/admin-api/src/modules/cells-ops/cells-ops.module.ts · the god-mode SHARD/CELL ROUTING-DIRECTORY plane
// (Law 8 + Law 11 + Law 12). Owns the platform topology as data: cells (per-country independent stacks — the DPDP
// residency boundary), shards (physical partitions the tenant→shard hash maps to), and tenant_placements (the
// authoritative tenant → cell + shard directory the edge gateway + core/sharding ShardRouter + core/cells
// cell-resolver read to route every request). Three services: cell-registry (topology + status lifecycle),
// tenant-cell-assignment (the fail-closed routing-directory writes), data-residency-rules (residency posture +
// lock). Mounts under AdminCoreModule (auth / RBAC / FIDO2 / step-up / audit @Global).
import { Module } from '@nestjs/common';
import { CellsOpsController } from './cells-ops.controller';
import { CellsRepository } from './repositories/cells.repository';
import { CellRegistryService } from './services/cell-registry.service';
import { TenantCellAssignmentService } from './services/tenant-cell-assignment.service';
import { DataResidencyRulesService } from './services/data-residency-rules.service';
import { MapApprovalRepository } from './repositories/map-approval.repository';
import { MapApprovalService } from './services/map-approval.service';
import { ResidencyMigrationRepository } from './repositories/residency-migration.repository';
import { ResidencyMigrationService } from './services/residency-migration.service';

@Module({
  controllers: [CellsOpsController],
  providers: [
    CellsRepository, CellRegistryService, TenantCellAssignmentService, DataResidencyRulesService,
    // PC-56 ADMIN-8 — the change-proposal gate, the map-wide history read, and capacity from real placement history.
    MapApprovalRepository, MapApprovalService,
    // PC-56 ADMIN-8b — the residency evidence log, the migration pipeline (DELTA-012), the plan (DELTA-013) and the
    // provisioning checklist.
    ResidencyMigrationRepository, ResidencyMigrationService,
  ],
})
export class CellsOpsModule {}
