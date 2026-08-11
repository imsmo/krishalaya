// modules/identity/repositories/member-suspension.repository.ts · PC-56 TENANT-1b-2.
//
// `tenant_member_suspensions` (0127). HAS `tenant_id` ⇒ RLS applies, and every query ALSO binds it at the app layer
// (Law 1: the policy is the net, the bound parameter is the intent).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { SuspensionRecord } from '../domain/member-suspension';

const COLS = `id, user_id, reason, suspended_by, created_at, lifted_at, lifted_by, lift_reason`;

interface Row {
  id: string; user_id: string; reason: string; suspended_by: string; created_at: Date;
  lifted_at: Date | null; lifted_by: string | null; lift_reason: string | null;
}

const toDomain = (r: Row): SuspensionRecord => ({
  id: String(r.id),
  userId: String(r.user_id),
  reason: String(r.reason),
  suspendedBy: String(r.suspended_by),
  createdAt: new Date(r.created_at).toISOString(),
  liftedAt: r.lifted_at ? new Date(r.lifted_at).toISOString() : null,
  liftedBy: r.lifted_by ? String(r.lifted_by) : null,
  liftReason: r.lift_reason ?? null,
});

@Injectable()
export class MemberSuspensionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * The live episode, locked.
   *
   * **`FOR UPDATE` BECAUSE TWO STAFF MEMBERS CLICKING AT ONCE IS THE ORDINARY CASE, NOT THE EXOTIC ONE.** Without the
   * lock, two concurrent suspends both read "not suspended" and one loses to `uq_tms_live` with a constraint error the
   * console cannot explain. With it, the second waits and correctly reports "already suspended".
   */
  async liveForUpdate(tx: TxContext, tenantId: string, userId: string): Promise<SuspensionRecord | null> {
    const r = await tx.query<Row>(
      `SELECT ${COLS} FROM tenant_member_suspensions
        WHERE tenant_id = $1 AND user_id = $2 AND lifted_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`,
      [tenantId, userId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async insert(tx: TxContext, input: { id: string; tenantId: string; userId: string; reason: string; suspendedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO tenant_member_suspensions (id, tenant_id, user_id, reason, suspended_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.id, input.tenantId, input.userId, input.reason, input.suspendedBy]);
  }

  /**
   * Close the episode.
   *
   * **THE `lifted_at IS NULL` PREDICATE IS IN THE WHERE, NOT ONLY IN THE READ.** The row was locked, so this is
   * belt-and-braces — and it is the belt that matters: a future caller who skips `liveForUpdate` cannot overwrite the
   * lift reason of an episode somebody already closed, which would rewrite a record a member may be disputing.
   */
  async lift(tx: TxContext, input: { tenantId: string; id: string; liftedBy: string; liftReason: string }): Promise<number> {
    const r = await tx.query(
      `UPDATE tenant_member_suspensions
          SET lifted_at = now(), lifted_by = $3, lift_reason = $4, updated_at = now()
        WHERE id = $1 AND tenant_id = $2 AND lifted_at IS NULL AND deleted_at IS NULL`,
      [input.id, input.tenantId, input.liftedBy, input.liftReason]);
    return r.rowCount ?? 0;
  }

  /** Is this member suspended right now? Read on the enforcement paths; uses `idx_tms_live_lookup`. */
  async isSuspended(tenantId: string, userId: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query<{ ok: boolean }>(
      `SELECT true AS ok FROM tenant_member_suspensions
        WHERE tenant_id = $1 AND user_id = $2 AND lifted_at IS NULL AND deleted_at IS NULL
        LIMIT 1`,
      [tenantId, userId]);
    return r.rows.length > 0;
  }

  /**
   * Every episode for one member, newest first — the history W154 shows.
   *
   * **THE HISTORY IS THE POINT OF A TABLE RATHER THAN A FLAG.** A member suspended three times over two seasons is a
   * different conversation from one suspended once, and a boolean column would have told staff neither.
   */
  async historyFor(tenantId: string, userId: string, limit = 10): Promise<SuspensionRecord[]> {
    const r = await this.replica.forTenant(tenantId).query<Row>(
      `SELECT ${COLS} FROM tenant_member_suspensions
        WHERE tenant_id = $1 AND user_id = $2 AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT $3`,
      [tenantId, userId, limit]);
    return r.rows.map(toDomain);
  }
}
