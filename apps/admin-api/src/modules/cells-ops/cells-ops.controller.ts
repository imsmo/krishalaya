// apps/admin-api/src/modules/cells-ops/cells-ops.controller.ts · god-mode shard/cell routing-directory plane
// (Law 8 + Law 11 + Law 12). Every route: AdminAuthGuard + OwnerPermissionsGuard. Reads need cells.read; every
// MUTATION (the topology / routing directory governs where every tenant's data physically lives) needs
// cells.manage + HardwareKeyGuard (FIDO2) + StepUpReauthGuard. validate (zod) → authorize → delegate ONLY.
// Static/sub routes (residency-report, placements, shards) are declared before /cells/:id so Nest matches them first.
import { Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AdminAuthGuard, AdminRequestContext } from '../../core/auth/admin-auth.guard';
import { HardwareKeyGuard } from '../../core/auth/hardware-key.guard';
import { StepUpReauthGuard } from '../../core/auth/step-up-reauth.guard';
import { OwnerPermissionsGuard, RequireOwnerPermission, OwnerPermissions } from '../../core/rbac/owner-roles';
import { ZodBody, ZodQuery } from '../../core/http/zod.pipe';
import { CellRegistryService } from './services/cell-registry.service';
import { TenantCellAssignmentService } from './services/tenant-cell-assignment.service';
import { DataResidencyRulesService } from './services/data-residency-rules.service';
import {
  CreateCellSchema, CreateCellDto, UpdateCellSchema, UpdateCellDto, SetStatusSchema, SetStatusDto,
  SetDefaultSchema, SetDefaultDto, SetResidencyLockSchema, SetResidencyLockDto,
  CreateShardSchema, CreateShardDto, UpdateShardSchema, UpdateShardDto,
  PlaceTenantSchema, PlaceTenantDto, MoveTenantSchema, MoveTenantDto, RemovePlacementSchema, RemovePlacementDto,
  QueryCellsSchema, QueryCellsDto, QueryShardsSchema, QueryShardsDto, QueryPlacementsSchema, QueryPlacementsDto,
  QueryChangesSchema, QueryChangesDto,
} from './dto/cells-ops.dto';

const admin = (req: any): AdminRequestContext => req.admin;
const decodeTsCursor = (c?: string) => { if (!c) return undefined; const [cc, id] = Buffer.from(c, 'base64').toString().split('|'); return cc && id ? { c: cc, id } : undefined; };
const MANAGE = [HardwareKeyGuard, StepUpReauthGuard] as const;

@Controller({ path: 'cells', version: '1' })
@UseGuards(AdminAuthGuard, OwnerPermissionsGuard)
export class CellsOpsController {
  constructor(
    private readonly registry: CellRegistryService,
    private readonly assignment: TenantCellAssignmentService,
    private readonly residency: DataResidencyRulesService,
  ) {}

  /* ======================= residency report (static, before :id) ======================= */
  @Get('residency-report') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  residencyReport() { return this.residency.report().then((r) => ({ data: r.items })); }

  /* ======================= placements (static, before /cells/:id) ======================= */
  @Get('placements') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  listPlacements(@ZodQuery(QueryPlacementsSchema) q: QueryPlacementsDto) {
    return this.assignment.listPlacements({ cellId: q.cellId, shardId: q.shardId, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Post('placements') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  place(@Req() req: any, @ZodBody(PlaceTenantSchema) dto: PlaceTenantDto) {
    return this.assignment.place(admin(req), dto).then((data) => ({ data }));
  }
  @Get('placements/:tenantId') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  getPlacement(@Param('tenantId') tenantId: string) { return this.assignment.getPlacement(tenantId).then((data) => ({ data })); }
  @Post('placements/:tenantId/move') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  move(@Req() req: any, @Param('tenantId') tenantId: string, @ZodBody(MoveTenantSchema) dto: MoveTenantDto) {
    return this.assignment.move(admin(req), tenantId, dto).then((data) => ({ data }));
  }
  @Delete('placements/:tenantId') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  removePlacement(@Req() req: any, @Param('tenantId') tenantId: string, @ZodBody(RemovePlacementSchema) dto: RemovePlacementDto) {
    return this.assignment.remove(admin(req), tenantId, dto).then((data) => ({ data }));
  }

  /* ======================= shards (static, before /cells/:id) ======================= */
  // PC-54 W54-11 slice 3: the CAPACITY PLANNER read — tenants per cell/shard vs configured limits.
  @Get('capacity') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  capacity() { return this.assignment.capacity().then((data: unknown) => ({ data })); }

  @Get('shards') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  listShards(@ZodQuery(QueryShardsSchema) q: QueryShardsDto) {
    return this.registry.listShards({ cellId: q.cellId, status: q.status, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Post('shards') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  createShard(@Req() req: any, @ZodBody(CreateShardSchema) dto: CreateShardDto) {
    return this.registry.createShard(admin(req), dto).then((data) => ({ data }));
  }
  @Get('shards/:id') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  getShard(@Param('id') id: string) { return this.registry.getShard(id).then((data) => ({ data })); }
  @Get('shards/:id/history') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  shardHistory(@Param('id') id: string, @ZodQuery(QueryChangesSchema) q: QueryChangesDto) {
    return this.registry.shardHistory({ entityId: id, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Patch('shards/:id') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  updateShard(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateShardSchema) dto: UpdateShardDto) {
    return this.registry.updateShard(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('shards/:id/status') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  setShardStatus(@Req() req: any, @Param('id') id: string, @ZodBody(SetStatusSchema) dto: SetStatusDto) {
    return this.registry.setShardStatus(admin(req), id, dto).then((data) => ({ data }));
  }

  /* ======================= cells ======================= */
  @Get('cells') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  listCells(@ZodQuery(QueryCellsSchema) q: QueryCellsDto) {
    return this.registry.listCells({ countryCode: q.countryCode, status: q.status, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Post('cells') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  createCell(@Req() req: any, @ZodBody(CreateCellSchema) dto: CreateCellDto) {
    return this.registry.createCell(admin(req), dto).then((data) => ({ data }));
  }
  @Get('cells/:id') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  getCell(@Param('id') id: string) { return this.registry.getCell(id).then((data) => ({ data })); }
  @Get('cells/:id/history') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  cellHistory(@Param('id') id: string, @ZodQuery(QueryChangesSchema) q: QueryChangesDto) {
    return this.registry.cellHistory({ entityId: id, cursor: decodeTsCursor(q.cursor), limit: q.limit }).then((r) => ({ data: r.items, meta: { nextCursor: r.nextCursor } }));
  }
  @Patch('cells/:id') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  updateCell(@Req() req: any, @Param('id') id: string, @ZodBody(UpdateCellSchema) dto: UpdateCellDto) {
    return this.registry.updateCell(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('cells/:id/status') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  setCellStatus(@Req() req: any, @Param('id') id: string, @ZodBody(SetStatusSchema) dto: SetStatusDto) {
    return this.registry.setCellStatus(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('cells/:id/default') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  setCellDefault(@Req() req: any, @Param('id') id: string, @ZodBody(SetDefaultSchema) dto: SetDefaultDto) {
    return this.registry.setCellDefault(admin(req), id, dto).then((data) => ({ data }));
  }
  @Post('cells/:id/residency-lock') @RequireOwnerPermission(OwnerPermissions.CellsManage) @UseGuards(...MANAGE)
  setResidencyLock(@Req() req: any, @Param('id') id: string, @ZodBody(SetResidencyLockSchema) dto: SetResidencyLockDto) {
    return this.residency.setResidencyLock(admin(req), id, dto).then((data) => ({ data }));
  }
}
