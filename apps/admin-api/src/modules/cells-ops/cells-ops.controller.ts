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
import { MapApprovalService } from './services/map-approval.service';
import {
  CreateCellSchema, CreateCellDto, UpdateCellSchema, UpdateCellDto, SetStatusSchema, SetStatusDto,
  SetDefaultSchema, SetDefaultDto, SetResidencyLockSchema, SetResidencyLockDto,
  CreateShardSchema, CreateShardDto, UpdateShardSchema, UpdateShardDto,
  PlaceTenantSchema, PlaceTenantDto, MoveTenantSchema, MoveTenantDto, RemovePlacementSchema, RemovePlacementDto,
  QueryCellsSchema, QueryCellsDto, QueryShardsSchema, QueryShardsDto, QueryPlacementsSchema, QueryPlacementsDto,
  QueryChangesSchema, QueryChangesDto,
  ProposeCellChangeSchema, ProposeCellChangeDto, ProposeShardChangeSchema, ProposeShardChangeDto,
  RejectProposalSchema, RejectProposalDto, QueryProposalsSchema, QueryProposalsDto,
  QueryMapHistorySchema, QueryMapHistoryDto,
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
    private readonly approvals: MapApprovalService,
  ) {}

  /* ==================== PC-56 ADMIN-8 · THE TWELFTH MAKER-CHECKER SITE ==================== */
  //
  // The canon names a checker on this map FIVE times (W029, W030, W031, W036, W038) and there was none. The existing
  // mutation routes above are left in place and untouched — their routing invariants are correct and this wave adds a
  // control rather than repairing one — and the GATED path is propose → apply below. What makes the ungated route unable
  // to bypass the gate is not this controller: it is 0116's `ck_cells_default_is_active` and its placement trigger, which
  // bind whichever path writes.
  //
  // NOTE THE ROUTE ORDER. These are declared BEFORE `/cells/:id` for the reason this file's header already gives: Nest
  // matches in declaration order, and `/cells/proposals` would otherwise be read as a cell whose id is "proposals".

  /** W029/W030's alert strip and the checker's queue. Reads on `cells.read`, because seeing what is proposed is part of
   *  watching the topology. */
  @Get('proposals') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  listProposals(@Req() req: any, @ZodQuery(QueryProposalsSchema) q: QueryProposalsDto) {
    return this.approvals.listProposals(admin(req), q).then((r) => ({
      data: r.items, meta: { nextCursor: r.nextCursor, awaitingChecker: r.awaitingChecker },
    }));
  }

  @Get('proposals/:id') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  getProposal(@Req() req: any, @Param('id') id: string) {
    return this.approvals.getProposal(admin(req), id).then((data) => ({ data }));
  }

  /** W035. Every change to the map in a window — which `CellsRepository.listChanges` structurally cannot answer, because
   *  it requires an entityId. */
  @Get('map-history') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  mapHistory(@Req() req: any, @ZodQuery(QueryMapHistorySchema) q: QueryMapHistoryDto) {
    return this.approvals.changeLog(admin(req), q).then((r) => ({
      data: r.items, meta: { nextCursor: r.nextCursor, window: r.window },
    }));
  }

  /** W036. Capacity, with the growth rate from REAL placement history and the projection deliberately absent (DELTA-013
   *  / ADMIN-8b), plus the three integrity findings this wave surfaces.
   *
   *  **A SEPARATE PATH FROM THE EXISTING `GET capacity`, AND THE COLLISION IS ITSELF A FINDING.** PC-54 built a route it
   *  calls "the CAPACITY PLANNER read", and it returns `SELECT cell_id, shard_id, COUNT(*) FROM tenant_placements GROUP
   *  BY …` — tenant counts with NO capacity comparison at all, so W036's entire subject (`placed_count` vs
   *  `capacity_tenants`, headroom, growth rate) was absent from the one route named for it.
   *
   *  More interesting: that route counts `tenant_placements` DIRECTLY while the placement guard compares against the
   *  denormalised `placed_count`. **So this platform already had two capacity sources that could disagree, and nothing
   *  compared them** — which is exactly the drift 0116's `placement_count_checks` now records. The old route is left in
   *  place because it has a caller and its numbers are the DERIVED half; this one carries the stored half, the caps, and
   *  the reconciliation verdict between them. Consolidating the two is ADMIN-8-Q2. */
  @Get('capacity/board') @RequireOwnerPermission(OwnerPermissions.CellsRead)
  capacityBoard() {
    return this.approvals.capacity().then((data) => ({ data }));
  }

  /** Reconcile the denormalised placement counts against `tenant_placements`. The capacity guard reads the denormalised
   *  number and nothing has ever compared it with the truth — ADMIN-6's cached-balance finding, one table over. */
  @Post('capacity/count-check')
  @RequireOwnerPermission(OwnerPermissions.CellsManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  countCheck(@Req() req: any) {
    return this.approvals.runCountCheck(admin(req)).then((data) => ({ data }));
  }

  /** Propose a cell change (the maker half). Hardware key + step-up even though nothing is applied yet: a proposal is
   *  what a checker will act on, and a forged one is a way of getting a colleague to sign your change. */
  @Post('cells/:id/proposals')
  @RequireOwnerPermission(OwnerPermissions.CellsManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  proposeCellChange(@Req() req: any, @Param('id') id: string, @ZodBody(ProposeCellChangeSchema) body: ProposeCellChangeDto) {
    return this.approvals.proposeCellChange(admin(req), id, body).then((data) => ({ data }));
  }

  @Post('shards/:id/proposals')
  @RequireOwnerPermission(OwnerPermissions.CellsManage)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  proposeShardChange(@Req() req: any, @Param('id') id: string, @ZodBody(ProposeShardChangeSchema) body: ProposeShardChangeDto) {
    return this.approvals.proposeShardChange(admin(req), id, body).then((data) => ({ data }));
  }

  /** Apply an approved change — the checker half, on the NEW `cells.approve` permission. Separate from `cells.manage`
   *  because W030 names it separately, and because an access review should be able to grant "may propose" without
   *  granting "may authorise": that separation is the only thing that makes the two-person rule administrable. */
  @Post('proposals/:id/apply')
  @RequireOwnerPermission(OwnerPermissions.CellsApprove)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  applyProposal(@Req() req: any, @Param('id') id: string) {
    return this.approvals.apply(admin(req), id).then((data) => ({ data }));
  }

  @Post('proposals/:id/reject')
  @RequireOwnerPermission(OwnerPermissions.CellsApprove)
  @UseGuards(HardwareKeyGuard, StepUpReauthGuard)
  rejectProposal(@Req() req: any, @Param('id') id: string, @ZodBody(RejectProposalSchema) body: RejectProposalDto) {
    return this.approvals.reject(admin(req), id, body.note).then((data) => ({ data }));
  }

  /** Mark a proposal stale. On `cells.manage` rather than `cells.approve`: noticing that the world moved is not a
   *  decision, and the maker themselves is usually the one who spots it. */
  @Post('proposals/:id/stale')
  @RequireOwnerPermission(OwnerPermissions.CellsManage)
  staleProposal(@Req() req: any, @Param('id') id: string) {
    return this.approvals.markStale(admin(req), id).then((data) => ({ data }));
  }


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
