// modules/dairy/repositories/mcc-operator-assignment.repository.ts · PC-56 TENANT-6d-2 · the custody register.
//
// W171: *"operator assignment is recorded (custody of member milk)"*. 0163's `mcc_operator_assignments` is APPEND-ONLY
// except for its ending (`GRANT UPDATE (ended_at, ended_by, …)` and nothing else), so this repository can insert and it
// can close — it cannot rewrite who held a centre in June, and neither can anything else that connects as `kv_app`.
import { Injectable, Inject } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';

export interface CustodyRow {
  id: string; mccId: string; operatorUserId: string;
  assignedAt: Date; assignedBy: string | null;
  endedAt: Date | null; endedBy: string | null;
  reason: string | null;
}

function toRow(r: any): CustodyRow {
  return { id: r.id, mccId: r.mcc_id, operatorUserId: r.operator_user_id,
    assignedAt: r.assigned_at, assignedBy: r.assigned_by ?? null,
    endedAt: r.ended_at ?? null, endedBy: r.ended_by ?? null, reason: r.reason ?? null };
}

const COLS = `id, mcc_id, operator_user_id, assigned_at, assigned_by, ended_at, ended_by, reason`;

@Injectable()
export class MccOperatorAssignmentRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The one open custody row for a centre, if there is one. `uq_mcc_custody_open` guarantees at most one. */
  async open(tx: TxContext, tenantId: string, mccId: string): Promise<CustodyRow | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM mcc_operator_assignments
        WHERE tenant_id=$1 AND mcc_id=$2 AND ended_at IS NULL AND deleted_at IS NULL
        FOR UPDATE`, [tenantId, mccId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /**
   * Close the open custody row.
   *
   * FAIL-CLOSED, and the reason is the whole point of the table: if this matched nothing, the centre's column has just
   * been handed to somebody while the register still shows the previous holder as current. Two open rows would then be
   * impossible (the partial unique index refuses the next insert), so the visible symptom would be that no handover
   * can ever be recorded at that centre again — a corruption that only shows up weeks later.
   */
  async close(tx: TxContext, tenantId: string, id: string, endedBy: string, at: Date): Promise<void> {
    const r = await tx.query(
      `UPDATE mcc_operator_assignments
          SET ended_at=$4, ended_by=$3, updated_at=now(), updated_by=$3
        WHERE id=$2 AND tenant_id=$1 AND ended_at IS NULL AND deleted_at IS NULL`,
      [tenantId, id, endedBy, at]);
    if (r.rowCount === 0) {
      throw new Error(`custody row ${id} could not be closed — it was already closed or removed inside this transaction`);
    }
  }

  /** Open a new custody. `assignedAt` is passed in so a handover's close and open share ONE instant. */
  async openNew(tx: TxContext, input: {
    tenantId: string; mccId: string; operatorUserId: string; assignedAt: Date; assignedBy: string; reason: string | null;
  }): Promise<CustodyRow> {
    const id = uuidv7();
    const r = await tx.query(
      `INSERT INTO mcc_operator_assignments (id, tenant_id, mcc_id, operator_user_id, assigned_at, assigned_by, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$6)
       RETURNING ${COLS}`,
      [id, input.tenantId, input.mccId, input.operatorUserId, input.assignedAt, input.assignedBy, input.reason]);
    return toRow(r.rows[0]);
  }

  /**
   * The custody history of one centre, newest first — bounded, because "who has ever held this centre" is a register
   * and not a feed, and an unbounded read of it would be the one query on this screen with no ceiling.
   */
  async history(tenantId: string, mccId: string, limit: number): Promise<CustodyRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM mcc_operator_assignments
        WHERE tenant_id=$1 AND mcc_id=$2 AND deleted_at IS NULL
        ORDER BY assigned_at DESC, id DESC LIMIT $3`, [tenantId, mccId, limit]);
    return (r.rows as any[]).map(toRow);
  }
}
