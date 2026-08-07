// apps/admin-api/src/modules/cells-ops/services/map-approval.service.ts · W029/W030/W031/W035/W036 (PC-56 ADMIN-8).
//
// THE CHECKER THE CANON NAMES FIVE TIMES. `CellRegistryService` is left in place and untouched — it is the only code that
// has ever written this map, its routing invariants are correct, and replacing it wholesale in the wave that adds an
// approval gate would mix two risks. This service is the gated path: propose → apply, with the map write delegated back to
// the existing service so there is exactly one implementation of each transition.
import { Injectable, Logger } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import type { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { CellsRepository } from '../repositories/cells.repository';
import { MapApprovalRepository } from '../repositories/map-approval.repository';
import {
  approvalState, assertApplicable, assertReason, assertRejectable, diffOf, isNoOp, needsChecker,
  stalenessOf, type ProposalRow, type Staleness,
} from '../domain/map-approval';
import {
  countVerdict, defaultCellBlocksStatusChange, driftIsUrgent, growthRate, headroomOf, needsScalePlan,
  secretRefDisplay, weeksToFull,
} from '../domain/map-integrity';
import { CellNotFoundError, InvalidCellsInputError, ShardNotFoundError } from '../domain/cells-ops.errors';

/** W035's default window, and its own copy: "Last 7 days". The change log is not partitioned, so this is a convenience
 *  rather than a refusal — but it is capped, because `cell_map_changes` grows with every placement on the platform and an
 *  unbounded scan of it from a console page is the shape of read that gets slower every month until somebody notices. */
export const MAX_CHANGE_WINDOW_DAYS = 90;
export const DEFAULT_CHANGE_WINDOW_DAYS = 7;

/** W036's rate window. Eight weeks, so a seasonal cohort (a Kharif onboarding surge is the canon's own example) is
 *  visible rather than averaged away, and short enough that last year's growth does not describe this month's. */
export const RATE_WINDOW_WEEKS = 8;

@Injectable()
export class MapApprovalService {
  private readonly log = new Logger(MapApprovalService.name);

  constructor(
    private readonly pool: AdminPool,
    private readonly repo: MapApprovalRepository,
    private readonly cells: CellsRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* PROPOSING                                                              */
  /* ---------------------------------------------------------------------- */

  /** Propose a change to a CELL. The maker records what they observed, which is what makes the checker's signature mean
   *  something later — see `stalenessOf`. */
  async proposeCellChange(actor: AdminRequestContext, cellId: string, body: {
    action: 'status_changed' | 'updated';
    status?: string;
    capacityTenants?: number | null;
    isDefault?: boolean;
    residencyLocked?: boolean;
    reason: string;
  }) {
    const reason = assertReason(body.reason, 'a cell change');
    const cell = await this.cells.getCell(cellId);
    if (!cell) throw new CellNotFoundError(cellId);
    const j = cell.toJSON();

    const patch: Record<string, unknown> = {};
    const observed: Record<string, unknown> = {};
    if (body.action === 'status_changed') {
      if (!body.status) throw new InvalidCellsInputError('a status change needs a target status');
      // **THE DEFAULT-CELL GUARD, at proposal time as well as at apply time.** W030 says "blocked while is_default=true",
      // and refusing here means an operator is told before a colleague is fetched rather than after.
      const blocked = defaultCellBlocksStatusChange(j.isDefault, body.status);
      if (blocked) throw new InvalidCellsInputError(blocked);
      patch.status = body.status;
      observed.status = j.status;
    } else {
      if (body.capacityTenants !== undefined) { patch.capacityTenants = body.capacityTenants; observed.capacityTenants = j.capacityTenants; }
      if (body.isDefault !== undefined) { patch.isDefault = body.isDefault; observed.isDefault = j.isDefault; }
      if (body.residencyLocked !== undefined) { patch.residencyLocked = body.residencyLocked; observed.residencyLocked = j.residencyLocked; }
      // **A DEFAULT FLAG BEING SET ON A NON-ACTIVE CELL is the same defect from the other direction** and would satisfy
      // no constraint 0116 adds: `ck_cells_default_is_active` refuses it, and refusing here gives the operator a sentence.
      if (body.isDefault === true && j.status !== 'active') {
        throw new InvalidCellsInputError(
          `this cell is '${j.status}', so it cannot become the default landing cell — new tenants would be routed to a `
          + 'cell that refuses placements.');
      }
    }
    if (Object.keys(patch).length === 0) throw new InvalidCellsInputError('nothing was proposed');
    if (isNoOp(observed, patch)) {
      throw new InvalidCellsInputError(
        'this proposal changes nothing. Nobody should be asked to sign a no-op — a checker\'s attention is the scarce '
        + 'resource this mechanism spends.');
    }

    return this.open(actor, 'cell', cellId, body.action, patch, observed, reason);
  }

  /** Propose a change to a SHARD. W031: "Weight/status changes need `cells.write` + checker; they shift the placement hash
   *  for new tenants." */
  async proposeShardChange(actor: AdminRequestContext, shardId: string, body: {
    action: 'status_changed' | 'updated';
    status?: string;
    weight?: number;
    reason: string;
  }) {
    const reason = assertReason(body.reason, 'a shard change');
    const shard = await this.cells.getShard(shardId);
    if (!shard) throw new ShardNotFoundError(shardId);
    const j = shard.toJSON();

    const patch: Record<string, unknown> = {};
    const observed: Record<string, unknown> = {};
    if (body.action === 'status_changed') {
      if (!body.status) throw new InvalidCellsInputError('a status change needs a target status');
      patch.status = body.status;
      observed.status = j.status;
    } else {
      if (body.weight === undefined) throw new InvalidCellsInputError('a shard update needs a weight');
      patch.weight = body.weight;
      observed.weight = j.weight;
    }
    if (isNoOp(observed, patch)) throw new InvalidCellsInputError('this proposal changes nothing');

    return this.open(actor, 'shard', shardId, body.action, patch, observed, reason);
  }

  private async open(
    actor: AdminRequestContext, entityType: string, entityId: string, action: string,
    patch: Record<string, unknown>, observed: Record<string, unknown>, reason: string,
  ) {
    // A change the canon does NOT gate should not be routed through here at all — it would make a proposal object for an
    // act that needs no second person, and the queue's value is that everything in it genuinely needs a colleague.
    if (!needsChecker(entityType, action)) {
      throw new InvalidCellsInputError(
        `${entityType}/${action} is not a checker-gated change; apply it directly and it will be recorded with your reason`);
    }
    return this.pool.withTx(async (c) => {
      let id: string;
      try {
        id = await this.repo.insertProposal(c, { entityType, entityId, action, patch, observed, reason, proposedByAdminId: actor.userId });
      } catch (e) {
        // `uq_cmp_one_open_per_entity`. Two open proposals on one object would let a checker approve the one nobody meant —
        // and on this map the two are plausibly "drain it" and "raise its capacity", which are opposite intentions.
        if (String((e as { code?: string }).code) === '23505') {
          throw new InvalidCellsInputError(
            'this object already has a change awaiting a checker. Withdraw or decide that one first — two open proposals '
            + 'would let a checker approve the one nobody meant.');
        }
        throw e;
      }
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.map.change_proposed', entityType, entityId,
        newValue: { proposalId: id, action, patch }, reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, entityType, entityId, action, patch, observed, status: 'open' as const, diff: diffOf(observed, patch) };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* READING                                                               */
  /* ---------------------------------------------------------------------- */

  async listProposals(actor: AdminRequestContext, q: { status?: string; entityType?: string; cursor?: string; limit: number }) {
    const rows = await this.repo.listProposals({ ...q, cursor: decodeCursor(q.cursor), limit: q.limit });
    const last = rows[rows.length - 1];
    const decorated = await Promise.all(rows.map(async (p) => this.decorate(actor, p)));
    return {
      items: decorated,
      nextCursor: rows.length === q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
      awaitingChecker: (await this.repo.awaitingChecker()).map((p) => ({
        id: p.id, entityType: p.entityType, entityId: p.entityId, action: p.action,
        proposedByAdminId: p.proposedByAdminId, proposedAt: p.proposedAt, reason: p.reason,
      })),
    };
  }

  async getProposal(actor: AdminRequestContext, id: string) {
    const p = await this.repo.getProposal(id);
    if (!p) return null;
    return this.decorate(actor, p);
  }

  /** Attach the diff and the LIVE staleness verdict, so a checker sees both what was proposed and whether it still
   *  applies. Computed on read rather than stored, because staleness is a property of now. */
  private async decorate(actor: AdminRequestContext, p: ProposalRow) {
    const staleness = p.status === 'open' ? await this.stalenessFor(p) : { stale: false as const };
    return {
      id: p.id, entityType: p.entityType, entityId: p.entityId, action: p.action,
      patch: p.patch, observed: p.observed, reason: p.reason, status: p.status,
      proposedByAdminId: p.proposedByAdminId, proposedAt: p.proposedAt,
      decidedByAdminId: p.decidedByAdminId, decidedAt: p.decidedAt, decisionNote: p.decisionNote,
      appliedChangeId: p.appliedChangeId,
      diff: diffOf(p.observed, p.patch),
      staleness,
      approval: approvalState({
        status: p.status, proposedByAdminId: p.proposedByAdminId, viewerAdminId: actor.userId, staleness,
      }),
    };
  }

  private async stalenessFor(p: ProposalRow): Promise<Staleness> {
    if (p.entityType === 'cell') {
      const cell = await this.cells.getCell(p.entityId);
      return stalenessOf(p.observed, cell ? (cell.toJSON() as unknown as Record<string, unknown>) : null);
    }
    if (p.entityType === 'shard') {
      const shard = await this.cells.getShard(p.entityId);
      return stalenessOf(p.observed, shard ? (shard.toJSON() as unknown as Record<string, unknown>) : null);
    }
    // A placement proposal's current state. Not built in this wave — the move pipeline is DELTA-012 / ADMIN-8b — so it is
    // reported as entity_missing rather than silently fresh, which keeps the gate closed on a path nothing can apply yet.
    return { stale: true, reason: 'entity_missing' };
  }

  /* ---------------------------------------------------------------------- */
  /* DECIDING                                                              */
  /* ---------------------------------------------------------------------- */

  /** Apply an approved change — the checker half of the TWELFTH maker-checker site.
   *
   *  ONE TRANSACTION: the proposal is locked, staleness is re-checked INSIDE it against the row the write will commit
   *  over, the two-person rule is asserted, the map row is updated, the change row is written, the proposal is marked
   *  applied with that change's id, and the audit row lands. All or nothing.
   */
  async apply(actor: AdminRequestContext, id: string) {
    const result = await this.pool.withTx(async (c) => {
      const p = await this.repo.getProposalForUpdate(c, id);
      if (!p) throw new InvalidCellsInputError('no such proposal');

      const staleness = await this.stalenessFor(p);
      assertApplicable({
        status: p.status, proposedByAdminId: p.proposedByAdminId, approverAdminId: actor.userId, staleness,
      });

      // THE MAP WRITE. Delegated through the repository the existing service uses, so there is exactly one SQL statement
      // per transition on this platform rather than a second copy inside the approval path — ADMIN-6's duplicate-logic
      // finding applied before it could happen.
      if (p.entityType === 'cell') {
        const cell = await this.cells.getCellForUpdate(c, p.entityId);
        if (!cell) throw new CellNotFoundError(p.entityId);
        const j = cell.toJSON();
        const nextStatus = (p.patch.status as string | undefined) ?? j.status;
        // Re-asserted at APPLY time, not only at proposal: the default flag can have moved onto this cell since.
        const blocked = defaultCellBlocksStatusChange(
          (p.patch.isDefault as boolean | undefined) ?? j.isDefault, nextStatus);
        if (blocked) throw new InvalidCellsInputError(blocked);

        await this.cells.updateCell(c, p.entityId, {
          displayName: j.displayName,
          status: nextStatus,
          isDefault: (p.patch.isDefault as boolean | undefined) ?? j.isDefault,
          residencyLocked: (p.patch.residencyLocked as boolean | undefined) ?? j.residencyLocked,
          capacityTenants: p.patch.capacityTenants !== undefined ? (p.patch.capacityTenants as number | null) : j.capacityTenants,
          notes: j.notes,
          actorUserId: actor.userId,
        });
      } else if (p.entityType === 'shard') {
        const shard = await this.cells.getShardForUpdate(c, p.entityId);
        if (!shard) throw new ShardNotFoundError(p.entityId);
        // `toJSON()` exposes only `hasDsn` — the entity's header is explicit that the raw ref "is NEVER emitted", which is
        // right and is why the update reads `persist` instead. A service that had to reach for `toJSON().dsnSecretRef`
        // would have been a service quietly asking the entity to leak, and it does not compile: the guard worked.
        const j = shard.toJSON();
        const keep = shard.persist;
        await this.cells.updateShard(c, p.entityId, {
          status: (p.patch.status as string | undefined) ?? j.status,
          weight: p.patch.weight !== undefined ? (p.patch.weight as number) : j.weight,
          dsnSecretRef: keep.dsnSecretRef,
          notes: keep.notes,
          actorUserId: actor.userId,
        });
      } else {
        throw new InvalidCellsInputError(
          'placement moves are not applied through this path yet — the move pipeline is a background job the schema does '
          + 'not have (DELTA-012)');
      }

      // The change row, and its id is written onto the proposal in the same transaction so `ck_cmp_decision_evidence`
      // holds at the moment `applied` is set.
      const changeId = await this.repo.insertChangeReturningId(c, {
        entityType: p.entityType, entityId: p.entityId, action: p.action,
        oldValue: p.observed, newValue: p.patch,
        // THE REASON CARRIES BOTH NAMES. `cell_map_changes.reason` is the only free-text field an auditor reading the map
        // history sees, and "who signed this" is the question this wave exists to answer.
        reason: `${p.reason} [proposed ${p.proposedByAdminId.slice(0, 8)}, approved ${actor.userId.slice(0, 8)}]`,
        actorUserId: actor.userId,
      });

      const moved = await this.repo.markApplied(c, id, actor.userId, changeId);
      if (!moved) {
        throw new InvalidCellsInputError(
          'this proposal was decided by another operator while you were reviewing it — reload to see who and when');
      }

      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.map.change_applied', entityType: p.entityType, entityId: p.entityId,
        oldValue: p.observed, newValue: p.patch,
        reason: p.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: 'applied' as const, changeId, entityType: p.entityType, entityId: p.entityId };
    });

    this.log.warn(`cell map change ${id} applied by ${actor.userId} → change ${result.changeId}`);
    return result;
  }

  async reject(actor: AdminRequestContext, id: string, note: string) {
    return this.pool.withTx(async (c) => {
      const p = await this.repo.getProposalForUpdate(c, id);
      if (!p) throw new InvalidCellsInputError('no such proposal');
      assertRejectable({ status: p.status, note, deciderAdminId: actor.userId });
      const moved = await this.repo.markRejected(c, id, actor.userId, note);
      if (!moved) throw new InvalidCellsInputError('this proposal was already decided');
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.map.change_rejected', entityType: p.entityType, entityId: p.entityId,
        newValue: { proposalId: id, note: note.trim() }, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: 'rejected' as const };
    });
  }

  /** Mark a proposal stale. Recorded with NO decider, because staleness is detected rather than decided. */
  async markStale(actor: AdminRequestContext, id: string) {
    return this.pool.withTx(async (c) => {
      const p = await this.repo.getProposalForUpdate(c, id);
      if (!p) throw new InvalidCellsInputError('no such proposal');
      const staleness = await this.stalenessFor(p);
      if (!staleness.stale) throw new InvalidCellsInputError('this proposal still matches the current state');
      const detail = staleness.reason === 'entity_missing'
        ? 'the object no longer exists'
        : `changed since proposed: ${staleness.fields.join(', ')}`;
      await this.repo.markStale(c, id, detail);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.map.change_stale', entityType: p.entityType, entityId: p.entityId,
        newValue: { proposalId: id, detail }, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: 'stale' as const, detail };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* W035 · THE CHANGE LOG                                                  */
  /* ---------------------------------------------------------------------- */

  async changeLog(actor: AdminRequestContext, q: {
    days?: number; entityType?: string; action?: string; cursor?: string; limit: number;
  }) {
    const days = Math.min(Math.max(q.days ?? DEFAULT_CHANGE_WINDOW_DAYS, 1), MAX_CHANGE_WINDOW_DAYS);
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const rows = await this.repo.listAllChanges({
      from: from.toISOString(), to: to.toISOString(),
      entityType: q.entityType, action: q.action,
      cursor: decodeCursor(q.cursor), limit: q.limit,
    });
    const last = rows[rows.length - 1];
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'cells.map.history_read', entityType: 'cell_map_changes', entityId: null,
      newValue: { days, entityType: q.entityType ?? null }, ip: actor.ip, requestId: actor.requestId || null,
    });
    return {
      items: rows.map((r) => ({
        ...r,
        // W035 shows the change as a diff. Built from the stored old/new rather than recomputed, because for an APPLIED
        // change those are the record — and a diff recomputed from the current row would show nothing once a later change
        // landed on top.
        diff: diffOf(
          (r.oldValue ?? {}) as Record<string, unknown>,
          (r.newValue ?? {}) as Record<string, unknown>,
        ),
      })),
      nextCursor: rows.length === q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
      window: { from: from.toISOString(), to: to.toISOString(), days, maxDays: MAX_CHANGE_WINDOW_DAYS },
    };
  }

  /* ---------------------------------------------------------------------- */
  /* W036 · CAPACITY                                                        */
  /* ---------------------------------------------------------------------- */

  /** The capacity board, with the growth rate computed from REAL placement history and the projection deliberately
   *  absent — see the note on `growthRate`. Plus the three integrity findings this wave surfaces. */
  async capacity() {
    const to = new Date();
    const from = new Date(to.getTime() - RATE_WINDOW_WEEKS * 7 * 86_400_000);
    const [board, events, checks, defaultsNotActive, zeroWeight] = await Promise.all([
      this.repo.capacityBoard(),
      this.repo.placementEvents(from.toISOString(), to.toISOString()),
      this.repo.newestCountChecks(),
      this.repo.defaultCellsNotActive(),
      this.repo.zeroWeightActiveShards(),
    ]);

    // The rate PER CELL. A platform-wide rate would tell an operator nothing about which cell to grow — and W036's whole
    // layout is one rate per cell.
    const cellOf = (v: unknown): string | null => {
      const o = (v ?? {}) as Record<string, unknown>;
      const id = o.cellId ?? o.cell_id;
      return typeof id === 'string' ? id : null;
    };

    const cells = board.map((cell) => {
      const mine = events.filter((e) => cellOf(e.newValue) === cell.id || cellOf(e.oldValue) === cell.id);
      const rate = growthRate(mine, RATE_WINDOW_WEEKS);
      const head = headroomOf(cell.placedCount, cell.capacityTenants);
      const check = checks.get(`cell:${cell.id}`);
      return {
        id: cell.id, code: cell.code, countryCode: cell.countryCode, status: cell.status, isDefault: cell.isDefault,
        placedCount: cell.placedCount, capacityTenants: cell.capacityTenants,
        headroom: head,
        rate,
        weeksToFull: weeksToFull(cell.placedCount, cell.capacityTenants, rate),
        needsPlan: needsScalePlan(head),
        // The count claim. NULL means NEVER CHECKED, which is the state of every node on the platform today — the
        // ADMIN-6 chain-claim rule: an unverified figure says so rather than implying verification.
        countCheck: check
          ? { ...countVerdict(check.stored, check.derived), at: check.at, urgent: driftIsUrgent(countVerdict(check.stored, check.derived), cell.capacityTenants) }
          : null,
        shards: cell.shards.map((s) => ({
          id: s.id, shardIndex: s.shardIndex, status: s.status, weight: s.weight, placedCount: s.placedCount,
          // W031: "Raw DSNs never appear here." A guard rather than a fix — 0043 stores a reference and the module treats
          // it as one — but the failure would be silent and total, so the display refuses anything that is not a vault ref.
          drainingByWeight: s.status === 'active' && s.weight === 0,
        })),
      };
    });

    return {
      cells,
      rateWindow: { weeks: RATE_WINDOW_WEEKS, from: from.toISOString(), to: to.toISOString(), events: events.length },
      // THE THREE FINDINGS, surfaced where an operator planning capacity will see them.
      findings: {
        // A default cell that is not active means a country whose new registrations all fail at placement.
        defaultCellsNotActive: defaultsNotActive,
        // Shards whose weight said "drain" while their count rose, because nothing read the column until 0116.
        zeroWeightActiveShards: zeroWeight,
        // Nodes nobody has reconciled. Every one, today.
        nodesNeverCountChecked: board.filter((c) => !checks.has(`cell:${c.id}`)).length,
      },
      // W037's own trigger figure, so this screen can flag a cell before the planner exists (ADMIN-8b).
      planTriggerPercentUsed: 70,
    };
  }

  /** Run the placement-count reconciliation now, and record it. W036's guard reads the denormalised count; this is the
   *  first code that compares it with the truth. */
  async runCountCheck(actor: AdminRequestContext) {
    const audit = await this.repo.countAudit();
    return this.pool.withTx(async (c) => {
      let drifted = 0;
      for (const cell of audit.cells) {
        await this.repo.recordCountCheck(c, {
          nodeType: 'cell', nodeId: cell.id, stored: cell.stored, derived: cell.derived, checkedByAdminId: actor.userId,
        });
        if (cell.stored !== cell.derived) drifted += 1;
      }
      for (const s of audit.shards) {
        await this.repo.recordCountCheck(c, {
          nodeType: 'shard', nodeId: s.id, stored: s.stored, derived: s.derived, checkedByAdminId: actor.userId,
        });
        if (s.stored !== s.derived) drifted += 1;
      }
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'cells.placement_counts_checked', entityType: 'cells', entityId: null,
        newValue: { cells: audit.cells.length, shards: audit.shards.length, drifted },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      if (drifted > 0) {
        this.log.warn(`placement count drift on ${drifted} nodes — the capacity guard is reading a wrong number`);
      }
      return {
        checked: audit.cells.length + audit.shards.length,
        drifted,
        cells: audit.cells.map((x) => ({ id: x.id, code: x.code, ...countVerdict(x.stored, x.derived), urgent: driftIsUrgent(countVerdict(x.stored, x.derived), x.capacity) })),
        shards: audit.shards.map((x) => ({ id: x.id, cellId: x.cellId, shardIndex: x.shardIndex, ...countVerdict(x.stored, x.derived) })),
      };
    });
  }

  /** The DSN display guard, exposed so the shard reads go through it rather than each page remembering to. */
  secretRef(ref: string | null) { return secretRefDisplay(ref); }
}

function decodeCursor(c?: string): { c: string; id: string } | undefined {
  if (!c) return undefined;
  const [ts, id] = Buffer.from(c, 'base64').toString('utf8').split('|');
  return ts && id ? { c: ts, id } : undefined;
}
