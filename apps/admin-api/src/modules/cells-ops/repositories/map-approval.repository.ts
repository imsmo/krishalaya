// apps/admin-api/src/modules/cells-ops/repositories/map-approval.repository.ts (PC-56 ADMIN-8)
//
// Separate from `CellsRepository`, which owns the map rows and predates this wave. This one owns what ADMIN-8 adds: the
// change proposal, the placement-count reconciliation, and the two cross-map reads (the whole change log, and the
// placement history W036's growth rate is computed from) that the existing repository has no shape for.
//
// WHY `listChanges` COULD NOT BE REUSED: it takes `entityType` AND `entityId` as required parameters — right for one
// object's history, and structurally unable to answer W035's question, which is "every change to the map in the last 7
// days". `idx_cell_map_changes` (0043) leads with those two columns for the same reason, so the new read needed its own
// index too (0116 §5).
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import type { ProposalRow } from '../domain/map-approval';

const PROPOSAL_COLS = `id, entity_type, entity_id, action, patch, observed, reason, status,
  proposed_by_admin_id, proposed_at, decided_by_admin_id, decided_at, decision_note, applied_change_id, created_at`;

function toProposal(r: Record<string, unknown>): ProposalRow {
  return {
    id: String(r.id),
    entityType: String(r.entity_type),
    entityId: String(r.entity_id),
    action: String(r.action),
    patch: (r.patch ?? {}) as Record<string, unknown>,
    observed: (r.observed ?? {}) as Record<string, unknown>,
    reason: String(r.reason),
    status: String(r.status),
    proposedByAdminId: String(r.proposed_by_admin_id),
    proposedAt: String(r.proposed_at),
    decidedByAdminId: (r.decided_by_admin_id as string | null) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    appliedChangeId: (r.applied_change_id as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

@Injectable()
export class MapApprovalRepository {
  constructor(private readonly db: AdminPool) {}

  /* ---------------------------------------------------------------------- */
  /* PROPOSALS                                                              */
  /* ---------------------------------------------------------------------- */

  async listProposals(o: { status?: string; entityType?: string; cursor?: { c: string; id: string }; limit: number }): Promise<ProposalRow[]> {
    const p: unknown[] = [];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = 'deleted_at IS NULL';
    if (o.status) where += ` AND status = ${b(o.status)}`;
    if (o.entityType) where += ` AND entity_type = ${b(o.entityType)}`;
    if (o.cursor) {
      const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (created_at < ${cc} OR (created_at = ${cc} AND id < ${ci}))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT ${PROPOSAL_COLS} FROM cell_map_proposals WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, p);
    return r.rows.map(toProposal);
  }

  async getProposal(id: string): Promise<ProposalRow | null> {
    const r = await this.db.query(`SELECT ${PROPOSAL_COLS} FROM cell_map_proposals WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toProposal(r.rows[0]) : null;
  }

  /** FOR UPDATE, because the decision is made from this row and then committed over it. A decision taken against a
   *  snapshot the transaction did not lock is a decision about a state that may already have moved — and on a routing map
   *  the two competing decisions are plausibly "drain it" and "raise its capacity". */
  async getProposalForUpdate(c: PoolClient, id: string): Promise<ProposalRow | null> {
    const r = await c.query(`SELECT ${PROPOSAL_COLS} FROM cell_map_proposals WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toProposal(r.rows[0]) : null;
  }

  async insertProposal(c: PoolClient, v: {
    entityType: string; entityId: string; action: string;
    patch: Record<string, unknown>; observed: Record<string, unknown>;
    reason: string; proposedByAdminId: string;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO cell_map_proposals (entity_type, entity_id, action, patch, observed, reason, proposed_by_admin_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$7,$7) RETURNING id`,
      [v.entityType, v.entityId, v.action, JSON.stringify(v.patch), JSON.stringify(v.observed), v.reason, v.proposedByAdminId]);
    return String(r.rows[0].id);
  }

  /** Mark applied, CONDITIONALLY on the proposal still being open, and record the change row it produced.
   *
   *  The conditional WHERE is the concurrency control: two checkers pressing Apply would otherwise both succeed and the
   *  second would overwrite the first's name on a routing change they did not authorise. And `applied_change_id` is
   *  written in the SAME statement as the status, so `ck_cmp_decision_evidence` is satisfied at the moment `applied` is
   *  set — two UPDATEs would leave a window in which the constraint was violated inside the transaction. */
  async markApplied(c: PoolClient, id: string, deciderAdminId: string, changeId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE cell_map_proposals
          SET status = 'applied', decided_by_admin_id = $2, decided_at = now(), applied_change_id = $3,
              updated_by = $2, updated_at = now()
        WHERE id = $1 AND status = 'open' AND deleted_at IS NULL`,
      [id, deciderAdminId, changeId]);
    return (r.rowCount ?? 0) > 0;
  }

  async markRejected(c: PoolClient, id: string, deciderAdminId: string, note: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE cell_map_proposals
          SET status = 'rejected', decided_by_admin_id = $2, decided_at = now(), decision_note = $3,
              updated_by = $2, updated_at = now()
        WHERE id = $1 AND status = 'open' AND deleted_at IS NULL`,
      [id, deciderAdminId, note.trim()]);
    return (r.rowCount ?? 0) > 0;
  }

  /** A proposal found to be out of date. NO DECIDER IS RECORDED, and `ck_cmp_decision_evidence` permits that on purpose:
   *  staleness is DETECTED rather than decided — possibly by the maker themselves reloading the page — and attributing it
   *  to whoever happened to open the screen would put a decision in somebody's name that they did not make. */
  async markStale(c: PoolClient, id: string, detail: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE cell_map_proposals
          SET status = 'stale', decided_at = now(), decision_note = $2, updated_at = now()
        WHERE id = $1 AND status = 'open' AND deleted_at IS NULL`,
      [id, detail]);
    return (r.rowCount ?? 0) > 0;
  }

  /** W029/W030's alert strip: proposals awaiting a checker, read across the WHOLE map rather than the current page —
   *  ADMIN-5f's rule, and here it matters because a proposal to drain the default cell is the single most consequential
   *  thing this console can hold. */
  async awaitingChecker(limit = 5): Promise<ProposalRow[]> {
    const r = await this.db.query(
      `SELECT ${PROPOSAL_COLS} FROM cell_map_proposals
        WHERE status = 'open' AND deleted_at IS NULL ORDER BY proposed_at ASC LIMIT $1`, [limit]);
    return r.rows.map(toProposal);
  }

  /** The change row a proposal produced, so the console can link a signature to its effect. */
  async insertChangeReturningId(c: PoolClient, v: {
    entityType: string; entityId: string; action: string;
    oldValue: unknown; newValue: unknown; reason: string; actorUserId: string;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO cell_map_changes (entity_type, entity_id, action, old_value, new_value, reason, actor_user_id)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING id`,
      [v.entityType, v.entityId, v.action,
        v.oldValue != null ? JSON.stringify(v.oldValue) : null,
        v.newValue != null ? JSON.stringify(v.newValue) : null,
        v.reason, v.actorUserId]);
    return String(r.rows[0].id);
  }

  /* ---------------------------------------------------------------------- */
  /* W035 · THE WHOLE CHANGE LOG                                            */
  /* ---------------------------------------------------------------------- */

  /** Every change to the map in a window, filterable by entity type. What `CellsRepository.listChanges` structurally
   *  cannot answer, because it requires an `entityId`. */
  async listAllChanges(o: {
    from: string; to: string; entityType?: string; action?: string;
    cursor?: { c: string; id: string }; limit: number;
  }): Promise<Array<{
    id: string; entityType: string; entityId: string; action: string;
    oldValue: unknown; newValue: unknown; reason: string; actorUserId: string; createdAt: string;
  }>> {
    const p: unknown[] = [o.from, o.to];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = 'created_at >= $1 AND created_at < $2';
    if (o.entityType) where += ` AND entity_type = ${b(o.entityType)}`;
    if (o.action) where += ` AND action = ${b(o.action)}`;
    if (o.cursor) {
      const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (created_at < ${cc} OR (created_at = ${cc} AND id < ${ci}))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT id, entity_type, entity_id, action, old_value, new_value, reason, actor_user_id, created_at
         FROM cell_map_changes WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, p);
    return r.rows.map((x) => ({
      id: String(x.id), entityType: String(x.entity_type), entityId: String(x.entity_id), action: String(x.action),
      oldValue: x.old_value ?? null, newValue: x.new_value ?? null,
      reason: String(x.reason), actorUserId: String(x.actor_user_id), createdAt: String(x.created_at),
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* W036 · CAPACITY, AND THE RATE FROM REAL HISTORY                         */
  /* ---------------------------------------------------------------------- */

  /** Every cell with its counts, and the shard breakdown W036's balance chart draws. */
  async capacityBoard(): Promise<Array<{
    id: string; code: string; countryCode: string; status: string; isDefault: boolean;
    placedCount: number; capacityTenants: number | null;
    shards: Array<{ id: string; shardIndex: number; status: string; weight: number; placedCount: number }>;
  }>> {
    const cells = await this.db.query(
      `SELECT id, code, country_code, status, is_default, placed_count, capacity_tenants
         FROM cells WHERE deleted_at IS NULL ORDER BY code`);
    const shards = await this.db.query(
      `SELECT id, cell_id, shard_index, status, weight, placed_count
         FROM shards WHERE deleted_at IS NULL ORDER BY cell_id, shard_index`);
    const byCell = new Map<string, Array<{ id: string; shardIndex: number; status: string; weight: number; placedCount: number }>>();
    for (const s of shards.rows) {
      const arr = byCell.get(String(s.cell_id)) ?? [];
      arr.push({
        id: String(s.id), shardIndex: Number(s.shard_index), status: String(s.status),
        weight: Number(s.weight), placedCount: Number(s.placed_count),
      });
      byCell.set(String(s.cell_id), arr);
    }
    return cells.rows.map((c) => ({
      id: String(c.id), code: String(c.code), countryCode: String(c.country_code), status: String(c.status),
      isDefault: c.is_default === true,
      placedCount: Number(c.placed_count),
      capacityTenants: c.capacity_tenants == null ? null : Number(c.capacity_tenants),
      shards: byCell.get(String(c.id)) ?? [],
    }));
  }

  /** THE GROWTH RATE'S INPUT, and it is a COUNT rather than a forecast. `cell_map_changes` has held every placement since
   *  0043; W036's "+38/week" is arithmetic over it. `idx_cell_map_changes_placed` (0116) makes it a range scan.
   *
   *  Returned as EVENTS rather than as a number, so the pure `growthRate` does the arithmetic and can be tested without a
   *  database — the same division ADMIN-6 used for the hash chain. */
  async placementEvents(from: string, to: string): Promise<Array<{ action: string; newValue: unknown; oldValue: unknown }>> {
    const r = await this.db.query(
      `SELECT action, new_value, old_value FROM cell_map_changes
        WHERE entity_type = 'placement' AND action IN ('placed','moved','removed')
          AND created_at >= $1 AND created_at < $2
        ORDER BY created_at ASC`, [from, to]);
    return r.rows.map((x) => ({ action: String(x.action), newValue: x.new_value ?? null, oldValue: x.old_value ?? null }));
  }

  /* ---------------------------------------------------------------------- */
  /* THE COUNT NOBODY VERIFIED                                              */
  /* ---------------------------------------------------------------------- */

  /** Stored versus derived, for every cell and every shard, in two queries.
   *
   *  The derived figure is `count(*)` over LIVE placements — `deleted_at IS NULL`, matching exactly what the placement
   *  path increments and decrements. A derived count that included soft-deleted rows would report drift on every cell
   *  that has ever released a tenant, which is the kind of false positive that gets a reconciliation switched off. */
  async countAudit(): Promise<{
    cells: Array<{ id: string; code: string; stored: number; derived: number; capacity: number | null }>;
    shards: Array<{ id: string; cellId: string; shardIndex: number; stored: number; derived: number }>;
  }> {
    const cells = await this.db.query(
      `SELECT c.id, c.code, c.placed_count AS stored, c.capacity_tenants,
              (SELECT count(*) FROM tenant_placements p WHERE p.cell_id = c.id AND p.deleted_at IS NULL)::int AS derived
         FROM cells c WHERE c.deleted_at IS NULL ORDER BY c.code`);
    const shards = await this.db.query(
      `SELECT s.id, s.cell_id, s.shard_index, s.placed_count AS stored,
              (SELECT count(*) FROM tenant_placements p WHERE p.shard_id = s.id AND p.deleted_at IS NULL)::int AS derived
         FROM shards s WHERE s.deleted_at IS NULL ORDER BY s.cell_id, s.shard_index`);
    return {
      cells: cells.rows.map((x) => ({
        id: String(x.id), code: String(x.code), stored: Number(x.stored), derived: Number(x.derived),
        capacity: x.capacity_tenants == null ? null : Number(x.capacity_tenants),
      })),
      shards: shards.rows.map((x) => ({
        id: String(x.id), cellId: String(x.cell_id), shardIndex: Number(x.shard_index),
        stored: Number(x.stored), derived: Number(x.derived),
      })),
    };
  }

  async recordCountCheck(c: PoolClient, v: {
    nodeType: 'cell' | 'shard'; nodeId: string; stored: number; derived: number; checkedByAdminId: string | null;
  }): Promise<void> {
    await c.query(
      `INSERT INTO placement_count_checks (node_type, node_id, stored_count, derived_count, drift, checked_by_admin_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [v.nodeType, v.nodeId, v.stored, v.derived, v.stored - v.derived, v.checkedByAdminId]);
  }

  /** The newest check per node, for the console's claim. NULL means never checked — which is the state of every node on
   *  the platform today, and the honest default (the ADMIN-6 chain-claim rule). */
  async newestCountChecks(): Promise<Map<string, { stored: number; derived: number; drift: number; at: string }>> {
    const r = await this.db.query(
      `SELECT DISTINCT ON (node_type, node_id) node_type, node_id, stored_count, derived_count, drift, created_at
         FROM placement_count_checks ORDER BY node_type, node_id, created_at DESC, id DESC`);
    const m = new Map<string, { stored: number; derived: number; drift: number; at: string }>();
    for (const x of r.rows) {
      m.set(`${String(x.node_type)}:${String(x.node_id)}`, {
        stored: Number(x.stored_count), derived: Number(x.derived_count),
        drift: Number(x.drift), at: String(x.created_at),
      });
    }
    return m;
  }

  /** Cells whose default flag sits on a non-active status — the violations of `ck_cells_default_is_active`, which 0116
   *  landed NOT VALID so this read could exist. Nothing has ever forbidden the state, so it may be present today, and a
   *  default cell that is draining means a country whose new registrations all fail. */
  async defaultCellsNotActive(): Promise<Array<{ id: string; code: string; countryCode: string; status: string }>> {
    const r = await this.db.query(
      `SELECT id, code, country_code, status FROM cells
        WHERE deleted_at IS NULL AND is_default AND status <> 'active' ORDER BY country_code, code`);
    return r.rows.map((x) => ({
      id: String(x.id), code: String(x.code), countryCode: String(x.country_code), status: String(x.status),
    }));
  }

  /** Shards at weight 0 that are still `active` — the state 0116's trigger now refuses placements onto, and the one
   *  W031 describes as draining. Surfaced because until this wave those shards WERE receiving tenants, so the platform
   *  may hold shards whose weight said drain while their count rose. */
  async zeroWeightActiveShards(): Promise<Array<{ id: string; cellId: string; shardIndex: number; placedCount: number }>> {
    const r = await this.db.query(
      `SELECT id, cell_id, shard_index, placed_count FROM shards
        WHERE deleted_at IS NULL AND status = 'active' AND weight = 0 ORDER BY cell_id, shard_index`);
    return r.rows.map((x) => ({
      id: String(x.id), cellId: String(x.cell_id), shardIndex: Number(x.shard_index), placedCount: Number(x.placed_count),
    }));
  }
}
