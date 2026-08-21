// modules/dairy/repositories/dairy-membership-route.repository.ts · PC-56 TENANT-6d-3 · the route history.
//
// 0164's `dairy_membership_routes` is APPEND-ONLY for `kv_app` except its closing date (`GRANT UPDATE (valid_to, …)`
// and nothing else), so this repository can open a period and close one — it cannot rewrite where a member poured in
// June, and neither can anything else that connects as the application role.
//
// Every as-of read goes through 0164's `dairy_route_asof(tenant, membership, day)` rather than repeating its date
// predicate: three copies of `valid_from <= d AND (valid_to IS NULL OR valid_to >= d)` is how three screens come to
// disagree about the day a member moved.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Route } from '../domain/dairy-membership-move';

export interface RouteRow extends Route {
  id: string;
  membershipId: string;
  movedBy: string | null;
  reason: string | null;
}

const COLS = `id, membership_id, mcc_id, member_code, valid_from::text AS valid_from, valid_to::text AS valid_to, moved_by, reason`;

function toRow(r: any): RouteRow {
  return { id: r.id, membershipId: r.membership_id, mccId: r.mcc_id, memberCode: String(r.member_code),
    validFrom: String(r.valid_from), validTo: r.valid_to == null ? null : String(r.valid_to),
    movedBy: r.moved_by ?? null, reason: r.reason ?? null };
}

@Injectable()
export class DairyMembershipRouteRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The route in force now, locked. `uq_dairy_route_current` guarantees at most one. */
  async current(tx: TxContext, tenantId: string, membershipId: string): Promise<RouteRow | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM dairy_membership_routes
        WHERE tenant_id=$1 AND membership_id=$2 AND valid_to IS NULL AND deleted_at IS NULL
        FOR UPDATE`, [tenantId, membershipId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /**
   * Close the open period.
   *
   * FAIL-CLOSED. A silent no-op here leaves the old route open while the new one is inserted — which the exclusion
   * constraint would then refuse, so the visible symptom is that the member can never be moved again. Worse, if the
   * insert somehow succeeded the register would have two answers for the same day.
   */
  async close(tx: TxContext, tenantId: string, id: string, validTo: string, actorUserId: string): Promise<void> {
    const r = await tx.query(
      `UPDATE dairy_membership_routes
          SET valid_to=$4::date, updated_at=now(), updated_by=$3
        WHERE id=$2 AND tenant_id=$1 AND valid_to IS NULL AND deleted_at IS NULL`,
      [tenantId, id, actorUserId, validTo]);
    if (r.rowCount === 0) {
      throw new Error(`route ${id} could not be closed — it was already closed or removed inside this transaction`);
    }
  }

  /** Open a period. The exclusion constraints are the guard; this just says what happened, and why. */
  async open(tx: TxContext, input: {
    tenantId: string; membershipId: string; mccId: string; memberCode: string;
    validFrom: string; movedBy: string; reason: string | null;
  }): Promise<RouteRow> {
    const id = uuidv7();
    const r = await tx.query(
      `INSERT INTO dairy_membership_routes (id, tenant_id, membership_id, mcc_id, member_code, valid_from, moved_by, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$7)
       RETURNING ${COLS}`,
      [id, input.tenantId, input.membershipId, input.mccId, input.memberCode, input.validFrom, input.movedBy, input.reason]);
    return toRow(r.rows[0]);
  }

  /** Everywhere this membership has poured, oldest first. Bounded: a register, not a feed. */
  async trail(x: SqlExecutor, tenantId: string, membershipId: string, limit: number): Promise<RouteRow[]> {
    const r = await x.query(
      `SELECT ${COLS} FROM dairy_membership_routes
        WHERE tenant_id=$1 AND membership_id=$2 AND deleted_at IS NULL
        ORDER BY valid_from, id LIMIT $3`, [tenantId, membershipId, limit]);
    return (r.rows as any[]).map(toRow);
  }

  /** Which centre and which card, on one day — through 0164's function, so every caller shares one boundary rule. */
  async asOf(x: SqlExecutor, tenantId: string, membershipId: string, on: string): Promise<Route | null> {
    const r = await x.query(
      `SELECT mcc_id, member_code, valid_from::text AS valid_from, valid_to::text AS valid_to
         FROM dairy_route_asof($1, $2, $3::date)`, [tenantId, membershipId, on]);
    const v = r.rows[0] as any;
    return v ? { mccId: v.mcc_id, memberCode: String(v.member_code), validFrom: String(v.valid_from), validTo: v.valid_to == null ? null : String(v.valid_to) } : null;
  }

  /**
   * Has this card been held by anybody at this centre on or after a date?
   *
   * The check behind `CODE_HELD_AT_DESTINATION`. 0164's `ex_dairy_route_card_once` would refuse the insert anyway, but
   * a constraint violation is a 500 and a village operator re-issuing a departed member's card number deserves a
   * sentence: *"card 108 was held at Vanthali until March."* Excludes this membership's own history, because a member
   * returning to a centre may legitimately be given back the card they had.
   */
  async codeHeldInPeriod(tx: TxContext, tenantId: string, mccId: string, memberCode: string, from: string, exceptMembershipId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM dairy_membership_routes
        WHERE tenant_id=$1 AND mcc_id=$2 AND member_code=$3 AND membership_id <> $5 AND deleted_at IS NULL
          AND (valid_to IS NULL OR valid_to >= $4::date)
        LIMIT 1`, [tenantId, mccId, memberCode, from, exceptMembershipId]);
    return r.rows.length > 0;
  }

  /**
   * The per-centre roll AS OF a day — TENANT-6a's *"104 pourers against a roll of 108"*, for a board whose day is a
   * parameter.
   *
   * It read `GROUP BY mcc_id FROM dairy_memberships`, i.e. today's routing, for any day the operator asked about. That
   * was merely imprecise while nobody could move; a transfer makes it wrong.
   *
   * ONE RESIDUAL, NAMED: `is_active` is still the membership's CURRENT flag, because no history of it exists. A member
   * who left the cooperative in July is absent from June's roll. That is a narrower error than the routing one and
   * fixing it means versioning membership activity, which is not this wave.
   */
  async rollAsOf(x: SqlExecutor, tenantId: string, day: string): Promise<Array<{ mccId: string; members: number }>> {
    const r = await x.query(
      `SELECT r.mcc_id, count(*)::int AS n
         FROM dairy_membership_routes r
         JOIN dairy_memberships m ON m.id = r.membership_id AND m.tenant_id = r.tenant_id
                                 AND m.is_active = true AND m.deleted_at IS NULL
        WHERE r.tenant_id=$1 AND r.deleted_at IS NULL
          AND r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to >= $2::date)
        GROUP BY r.mcc_id`, [tenantId, day]);
    return (r.rows as any[]).map((v) => ({ mccId: v.mcc_id, members: Number(v.n ?? 0) }));
  }

  /** How many memberships have ever moved — the centres board's own count of W171's sentence being used. */
  async movedCount(x: SqlExecutor, tenantId: string): Promise<number> {
    const r = await x.query(
      `SELECT count(*)::int AS n FROM (
         SELECT membership_id FROM dairy_membership_routes
          WHERE tenant_id=$1 AND deleted_at IS NULL
          GROUP BY membership_id HAVING count(*) > 1) t`, [tenantId]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }

  /** The trail for a whole page of memberships, for a screen that lists them. Bounded by the caller's ids. */
  async trailsFor(tenantId: string, membershipIds: readonly string[]): Promise<Map<string, RouteRow[]>> {
    const out = new Map<string, RouteRow[]>();
    if (membershipIds.length === 0) return out;
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM dairy_membership_routes
        WHERE tenant_id=$1 AND membership_id = ANY($2::uuid[]) AND deleted_at IS NULL
        ORDER BY membership_id, valid_from, id`, [tenantId, membershipIds]);
    for (const raw of r.rows as any[]) {
      const row = toRow(raw);
      const list = out.get(row.membershipId) ?? [];
      list.push(row);
      out.set(row.membershipId, list);
    }
    return out;
  }
}
