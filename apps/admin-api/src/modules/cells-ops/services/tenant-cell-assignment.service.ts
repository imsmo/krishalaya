// apps/admin-api/src/modules/cells-ops/services/tenant-cell-assignment.service.ts · the routing DIRECTORY writes
// — the safety-critical path. place / move / remove a tenant's (cell, shard), and read the directory. EVERY route
// guard fails CLOSED (a misroute = a tenant's data on the wrong stack / wrong country): the target cell AND shard
// must be `active` (acceptsPlacement), the shard must belong to the target cell, residency may not cross a border
// when either cell is residency-locked (DPDP), and a capped cell may not be overfilled. One ACID tx per write:
// lock the placement + nodes FOR UPDATE → guards → write the directory row → maintain placed_count on both nodes →
// cell_map_changes row → audit_log row, atomic.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { CellsRepository, PlacementListQuery } from '../repositories/cells.repository';
import {
  CellNotFoundError, ShardNotFoundError, PlacementNotFoundError, AlreadyPlacedError, ShardCellMismatchError,
  NodeNotAcceptingError, CapacityExceededError, ResidencyViolationError, CellsAlreadyInStateError,
} from '../domain/cells-ops.errors';
import { acceptsPlacement } from '../domain/node.state';
import { hasRoom, sameResidency } from '../domain/routing';
import { PlaceTenantDto, MoveTenantDto, RemovePlacementDto } from '../dto/cells-ops.dto';

const tsCursor = (createdAt: any, id: string) => Buffer.from(`${createdAt?.toISOString?.() ?? createdAt}|${id}`).toString('base64');

@Injectable()
export class TenantCellAssignmentService {
  constructor(private readonly pool: AdminPool, private readonly audit: AdminAuditWriter, private readonly repo: CellsRepository) {}

  private audited(actor: AdminRequestContext, action: string, entityId: string, oldValue: unknown, newValue: unknown, reason: string) {
    return { actorUserId: actor.userId, actorRole: actor.roles[0] ?? null, action, entityType: 'tenant_placement', entityId, oldValue, newValue, reason, ip: actor.ip, requestId: actor.requestId || null };
  }

  async getPlacement(tenantId: string) {
    const p = await this.repo.getPlacement(tenantId);
    if (!p) throw new PlacementNotFoundError(tenantId);
    return p;
  }
  async listPlacements(q: PlacementListQuery) {
    const items = await this.repo.listPlacements(q);
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === q.limit && last ? tsCursor(last.createdAt, last.tenantId) : null };
  }

  async place(actor: AdminRequestContext, dto: PlaceTenantDto) {
    return this.pool.withTx(async (client) => {
      if (await this.repo.getPlacementForUpdate(client, dto.tenantId)) throw new AlreadyPlacedError(dto.tenantId);
      const cell = await this.repo.getCellForUpdate(client, dto.cellId);
      if (!cell) throw new CellNotFoundError(dto.cellId);
      const shard = await this.repo.getShardForUpdate(client, dto.shardId);
      if (!shard) throw new ShardNotFoundError(dto.shardId);
      if (shard.cellId !== dto.cellId) throw new ShardCellMismatchError();
      if (!acceptsPlacement(cell.status)) throw new NodeNotAcceptingError('cell', cell.status);
      if (!acceptsPlacement(shard.status)) throw new NodeNotAcceptingError('shard', shard.status);
      if (!hasRoom(cell.placedCount, cell.capacityTenants)) throw new CapacityExceededError('cell', cell.capacityTenants ?? 0);

      await this.repo.insertPlacement(client, { tenantId: dto.tenantId, cellId: dto.cellId, shardId: dto.shardId, pinned: dto.pinned, actorUserId: actor.userId });
      await this.repo.bumpCellPlaced(client, dto.cellId, +1, actor.userId);
      await this.repo.bumpShardPlaced(client, dto.shardId, +1, actor.userId);
      const newValue = { cellId: dto.cellId, shardId: dto.shardId, pinned: dto.pinned };
      await this.repo.insertChange(client, { entityType: 'placement', entityId: dto.tenantId, action: 'placed', oldValue: null, newValue, reason: dto.reason, actorUserId: actor.userId });
      await this.audit.write(client, this.audited(actor, 'cells.placement.placed', dto.tenantId, null, newValue, dto.reason));
      return { tenantId: dto.tenantId, ...newValue };
    });
  }

  async move(actor: AdminRequestContext, tenantId: string, dto: MoveTenantDto) {
    return this.pool.withTx(async (client) => {
      const placement = await this.repo.getPlacementForUpdate(client, tenantId);
      if (!placement) throw new PlacementNotFoundError(tenantId);
      if (placement.cellId === dto.cellId && placement.shardId === dto.shardId) throw new CellsAlreadyInStateError('placement');

      const fromCell = await this.repo.getCellForUpdate(client, placement.cellId);
      if (!fromCell) throw new CellNotFoundError(placement.cellId);
      const toCell = await this.repo.getCellForUpdate(client, dto.cellId);
      if (!toCell) throw new CellNotFoundError(dto.cellId);
      const toShard = await this.repo.getShardForUpdate(client, dto.shardId);
      if (!toShard) throw new ShardNotFoundError(dto.shardId);
      if (toShard.cellId !== dto.cellId) throw new ShardCellMismatchError();
      if (!acceptsPlacement(toCell.status)) throw new NodeNotAcceptingError('cell', toCell.status);
      if (!acceptsPlacement(toShard.status)) throw new NodeNotAcceptingError('shard', toShard.status);
      // DPDP: a locked cell's tenants may never cross a residency border.
      if ((fromCell.residencyLocked || toCell.residencyLocked) && !sameResidency(fromCell.countryCode, toCell.countryCode)) {
        throw new ResidencyViolationError(fromCell.countryCode, toCell.countryCode);
      }
      const cellChanged = dto.cellId !== placement.cellId;
      const shardChanged = dto.shardId !== placement.shardId;
      if (cellChanged && !hasRoom(toCell.placedCount, toCell.capacityTenants)) throw new CapacityExceededError('cell', toCell.capacityTenants ?? 0);

      const pinned = dto.pinned ?? placement.pinned;
      await this.repo.updatePlacement(client, tenantId, { cellId: dto.cellId, shardId: dto.shardId, pinned, actorUserId: actor.userId });
      if (cellChanged) { await this.repo.bumpCellPlaced(client, placement.cellId, -1, actor.userId); await this.repo.bumpCellPlaced(client, dto.cellId, +1, actor.userId); }
      if (shardChanged) { await this.repo.bumpShardPlaced(client, placement.shardId, -1, actor.userId); await this.repo.bumpShardPlaced(client, dto.shardId, +1, actor.userId); }
      const oldValue = { cellId: placement.cellId, shardId: placement.shardId, pinned: placement.pinned };
      const newValue = { cellId: dto.cellId, shardId: dto.shardId, pinned };
      await this.repo.insertChange(client, { entityType: 'placement', entityId: tenantId, action: 'moved', oldValue, newValue, reason: dto.reason, actorUserId: actor.userId });
      await this.audit.write(client, this.audited(actor, 'cells.placement.moved', tenantId, oldValue, newValue, dto.reason));
      return { tenantId, ...newValue };
    });
  }

  async remove(actor: AdminRequestContext, tenantId: string, dto: RemovePlacementDto) {
    return this.pool.withTx(async (client) => {
      const placement = await this.repo.getPlacementForUpdate(client, tenantId);
      if (!placement) throw new PlacementNotFoundError(tenantId);
      await this.repo.softDeletePlacement(client, tenantId, actor.userId);
      await this.repo.bumpCellPlaced(client, placement.cellId, -1, actor.userId);
      await this.repo.bumpShardPlaced(client, placement.shardId, -1, actor.userId);
      const oldValue = { cellId: placement.cellId, shardId: placement.shardId, pinned: placement.pinned };
      await this.repo.insertChange(client, { entityType: 'placement', entityId: tenantId, action: 'removed', oldValue, newValue: null, reason: dto.reason, actorUserId: actor.userId });
      await this.audit.write(client, this.audited(actor, 'cells.placement.removed', tenantId, oldValue, null, dto.reason));
      return { tenantId, removed: true };
    });
  }

  /** PC-54 W54-11 slice 3 `capacity planner`: tenants per cell/shard from the placement ledger — the
   *  planning read the placements list can't answer without client-side fan-out. */
  async capacity() {
    const r = await this.pool.query(
      `SELECT cell_id, shard_id, COUNT(*)::int AS tenants FROM tenant_placements
        WHERE deleted_at IS NULL GROUP BY cell_id, shard_id ORDER BY cell_id, shard_id`);
    return r.rows;
  }
}
