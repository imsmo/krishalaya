// modules/dairy/repositories/dairy-diversion.repository.ts · PC-56 TENANT-6d-6 · `dairy_shift_diversions` (0166).
//
// APPEND-ONLY EXCEPT ITS TWO ENDINGS. `kv_app` holds `UPDATE (approved_*, cancelled_*, cancel_reason, updated_*)` and
// nothing else, so this repository cannot rewrite what was asked for, by whom, for which shift, or why — the columns an
// auditor reads to decide whether a village's milk was moved properly. Every writer here is fail-closed for the reason
// this programme has now applied to ten tables: a zero-row UPDATE means the row moved under us, and returning success
// would publish a state nothing holds.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { MilkShift } from '../domain/dairy.events';
import { pgDate } from '../../../core/database/pg-date';

const COLS = `id, tenant_id, from_mcc_id, to_mcc_id, diverted_on, shift, reason,
              requested_by, requested_at, approved_by, approved_at,
              cancelled_by, cancelled_at, cancel_reason, created_at`;

export interface DiversionRow {
  id: string;
  tenantId: string;
  fromMccId: string;
  toMccId: string;
  /** `YYYY-MM-DD` — a whole day, read as text so no timezone can move it (TENANT-6c-1's ruling on paydays). */
  divertedOn: string;
  shift: MilkShift;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

function toRow(r: any): DiversionRow {
  return {
    id: r.id, tenantId: r.tenant_id, fromMccId: r.from_mcc_id, toMccId: r.to_mcc_id,
    // THROUGH `pgDate`, not `String(v).slice(0,10)`. node-pg parses a `date` column into a JS Date at LOCAL midnight,
    // so the obvious one-liner yields `"Fri Aug 21"` — which then goes back into a query as a date and raises 22P02.
    // `core/database/pg-date` exists for exactly this and its own sweep guards against new instances; this repository
    // acquired one anyway, and the live run found it before the sweep did.
    divertedOn: pgDate(r.diverted_on), shift: String(r.shift) as MilkShift, reason: String(r.reason),
    requestedBy: r.requested_by, requestedAt: new Date(r.requested_at).toISOString(),
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    cancelledBy: r.cancelled_by ?? null,
    cancelledAt: r.cancelled_at ? new Date(r.cancelled_at).toISOString() : null,
    cancelReason: r.cancel_reason ?? null,
  };
}

@Injectable()
export class DairyDiversionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, input: {
    id: string; tenantId: string; fromMccId: string; toMccId: string; divertedOn: string; shift: MilkShift;
    reason: string; requestedBy: string;
  }): Promise<DiversionRow> {
    const r = await tx.query(
      `INSERT INTO dairy_shift_diversions
         (id, tenant_id, from_mcc_id, to_mcc_id, diverted_on, shift, reason, requested_by, created_by)
       VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$8)
       RETURNING ${COLS}`,
      [input.id, input.tenantId, input.fromMccId, input.toMccId, input.divertedOn, input.shift,
       input.reason, input.requestedBy]);
    return toRow(r.rows[0]);
  }

  async byId(x: SqlExecutor, tenantId: string, id: string): Promise<DiversionRow | null> {
    const r = await x.query(
      `SELECT ${COLS} FROM dairy_shift_diversions WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [tenantId, id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Locked, for an act that is about to change this row's ending. */
  async forUpdate(tx: TxContext, tenantId: string, id: string): Promise<DiversionRow | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM dairy_shift_diversions WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
      [tenantId, id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /**
   * THE COUNTER'S QUESTION, asked on every pour that names a centre other than the member's own: *"is this route
   * diverted tonight, and to where?"*
   *
   * LIVE only — signed and not cancelled. An unsigned diversion is a request, and a request moves no milk.
   */
  async liveFor(x: SqlExecutor, tenantId: string, fromMccId: string, on: string, shift: MilkShift): Promise<DiversionRow | null> {
    const r = await x.query(
      `SELECT ${COLS} FROM dairy_shift_diversions
        WHERE tenant_id=$1 AND from_mcc_id=$2 AND diverted_on=$3::date AND shift=$4
          AND approved_at IS NOT NULL AND cancelled_at IS NULL AND deleted_at IS NULL`,
      [tenantId, fromMccId, on, shift]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Any UNCANCELLED row for this centre-shift-day — signed or not. What `uq_dairy_diversion_live` refuses a second of. */
  async pendingOrLive(x: SqlExecutor, tenantId: string, fromMccId: string, on: string, shift: MilkShift): Promise<DiversionRow | null> {
    const r = await x.query(
      `SELECT ${COLS} FROM dairy_shift_diversions
        WHERE tenant_id=$1 AND from_mcc_id=$2 AND diverted_on=$3::date AND shift=$4
          AND cancelled_at IS NULL AND deleted_at IS NULL`,
      [tenantId, fromMccId, on, shift]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async approve(tx: TxContext, tenantId: string, id: string, byUserId: string, at: Date): Promise<void> {
    const r = await tx.query(
      `UPDATE dairy_shift_diversions
          SET approved_by=$3, approved_at=$4, updated_at=now(), updated_by=$3
        WHERE tenant_id=$1 AND id=$2 AND approved_at IS NULL AND cancelled_at IS NULL AND deleted_at IS NULL`,
      [tenantId, id, byUserId, at]);
    // FAIL CLOSED. A zero-row update here means the row was signed or cancelled between the verdict and the write —
    // and reporting success would tell a cooperative their milk may move on an authority that does not exist.
    if (r.rowCount === 0) throw new Error(`dairy diversion ${id} was not approved — already signed, cancelled or gone`);
  }

  async cancel(tx: TxContext, tenantId: string, id: string, byUserId: string, at: Date, reason: string): Promise<void> {
    const r = await tx.query(
      `UPDATE dairy_shift_diversions
          SET cancelled_by=$3, cancelled_at=$4, cancel_reason=$5, updated_at=now(), updated_by=$3
        WHERE tenant_id=$1 AND id=$2 AND cancelled_at IS NULL AND deleted_at IS NULL`,
      [tenantId, id, byUserId, at, reason]);
    if (r.rowCount === 0) throw new Error(`dairy diversion ${id} was not cancelled — already cancelled or gone`);
  }

  /**
   * How many members this diversion actually affects — W170's *"87 pourers"*.
   *
   * Counted from the ROUTE HISTORY as of the diverted day, never from today's routing: a member who moved last week is
   * not on tonight's list, and one who moved TO this centre is. TENANT-6d-3's argument, applied to a count nobody had
   * made before.
   */
  async affectedMembers(x: SqlExecutor, tenantId: string, fromMccId: string, on: string): Promise<number> {
    const r = await x.query(
      `SELECT count(*)::int AS n
         FROM dairy_membership_routes r
         JOIN dairy_memberships m ON m.id = r.membership_id AND m.tenant_id = r.tenant_id
                                 AND m.deleted_at IS NULL AND m.is_active = true
        WHERE r.tenant_id=$1 AND r.mcc_id=$2 AND r.deleted_at IS NULL
          AND r.valid_from <= $3::date AND (r.valid_to IS NULL OR r.valid_to >= $3::date)`,
      [tenantId, fromMccId, on]);
    return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
  }

  /** Pours already recorded at a centre for one shift of one day — what makes a diversion too late to sign. */
  async poursAt(x: SqlExecutor, tenantId: string, mccId: string, on: string, shift: MilkShift): Promise<number> {
    const r = await x.query(
      `SELECT count(*)::int AS n FROM milk_collections
        WHERE tenant_id=$1 AND mcc_id=$2 AND collected_on=$3::date AND shift=$4`,
      [tenantId, mccId, on, shift]);
    return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
  }

  /** Pours recorded UNDER a diversion — what makes it too late to cancel. */
  async poursUnder(x: SqlExecutor, tenantId: string, diversionId: string): Promise<number> {
    const r = await x.query(
      `SELECT count(*)::int AS n FROM milk_collections WHERE tenant_id=$1 AND diversion_id=$2`,
      [tenantId, diversionId]);
    return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
  }

  /** The register: this cooperative's diversions, newest shift first, with the two centres' codes. */
  async list(tenantId: string, q: { from?: string; to?: string; limit: number }): Promise<Array<DiversionRow & {
    fromCode: string; fromName: string; toCode: string; toName: string;
  }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS.split(', ').map((c) => `d.${c.trim()}`).join(', ')},
              f.code AS from_code, f.default_name AS from_name, t.code AS to_code, t.default_name AS to_name
         FROM dairy_shift_diversions d
         JOIN mcc_centres f ON f.id = d.from_mcc_id AND f.tenant_id = d.tenant_id
         JOIN mcc_centres t ON t.id = d.to_mcc_id AND t.tenant_id = d.tenant_id
        WHERE d.tenant_id=$1 AND d.deleted_at IS NULL
          AND ($2::date IS NULL OR d.diverted_on >= $2::date)
          AND ($3::date IS NULL OR d.diverted_on <= $3::date)
        ORDER BY d.diverted_on DESC, d.shift DESC, d.requested_at DESC
        LIMIT $4`,
      [tenantId, q.from ?? null, q.to ?? null, Math.min(Math.max(q.limit, 1), 200)]);
    return r.rows.map((x: any) => ({
      ...toRow(x),
      fromCode: String(x.from_code), fromName: String(x.from_name),
      toCode: String(x.to_code), toName: String(x.to_name),
    }));
  }

  /**
   * BOTH SIDES OF A DIVERSION, per centre, for the counter board's own day and shift.
   *
   * `divertedIn` — pours this centre RECEIVED from another centre's roll. `divertedOut` — members routed here whose
   * milk was taken elsewhere. The board prints these because a diverted evening otherwise looks exactly like a broken
   * counter: a roll with no pours at one centre, and pours from nobody's roll at the other.
   */
  async sidesFor(tenantId: string, on: string, shift: MilkShift): Promise<Map<string, { divertedIn: number; divertedOut: number }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH live AS (
         SELECT id, from_mcc_id, to_mcc_id FROM dairy_shift_diversions
          WHERE tenant_id=$1 AND diverted_on=$2::date AND shift=$3
            AND approved_at IS NOT NULL AND cancelled_at IS NULL AND deleted_at IS NULL
       ), poured AS (
         SELECT c.diversion_id, count(*)::int AS pours
           FROM milk_collections c
          WHERE c.tenant_id=$1 AND c.collected_on=$2::date AND c.shift=$3 AND c.diversion_id IS NOT NULL
          GROUP BY c.diversion_id
       )
       SELECT l.to_mcc_id AS mcc_id, coalesce(p.pours,0)::int AS in_count, 0 AS out_count
         FROM live l LEFT JOIN poured p ON p.diversion_id = l.id
       UNION ALL
       SELECT l.from_mcc_id AS mcc_id, 0 AS in_count, coalesce(p.pours,0)::int AS out_count
         FROM live l LEFT JOIN poured p ON p.diversion_id = l.id`,
      [tenantId, on, shift]);
    const out = new Map<string, { divertedIn: number; divertedOut: number }>();
    for (const row of r.rows as Array<{ mcc_id: string; in_count: number; out_count: number }>) {
      const cur = out.get(row.mcc_id) ?? { divertedIn: 0, divertedOut: 0 };
      cur.divertedIn += Number(row.in_count ?? 0);
      cur.divertedOut += Number(row.out_count ?? 0);
      out.set(row.mcc_id, cur);
    }
    return out;
  }
}
