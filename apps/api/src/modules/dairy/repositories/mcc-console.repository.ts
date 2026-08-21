// modules/dairy/repositories/mcc-console.repository.ts · PC-56 TENANT-6d-2 · every read W171's board makes.
//
// Four bounded reads, not one join: the centres (with their operator and member count), their coolers, the tenant's
// membership totals, and the cycles that exist per preference. Splitting them is deliberate — a single query that
// aggregated coolers, memberships and cycles per centre would be one plan whose cost is impossible to reason about,
// and W171 is a board a village secretary opens on a 2G tablet.
//
// THE OPERATOR'S NAME AND PHONE ARE JOINED THROUGH A TENANCY CHECK. `mcc_centres.operator_user_id` references the
// PLATFORM-WIDE `users` table (0003), so before 0163 a uuid belonging to another cooperative's member could be written
// there — and this board is what would then print their name and their phone number. 0163's trigger stops new ones;
// the `EXISTS (user_tenant_roles …)` in the join is what stops the ones already stored from being read.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor } from '../../../core/database/unit-of-work';
import { scaledFromNumeric } from '../../../core/database/pg-numeric';
import { hhmm } from '../domain/mcc-console';

const TEMP_SCALE = 1;

export interface CentreBoardRow {
  id: string; code: string; name: string;
  isActive: boolean;
  capacityLitresShift: string | null;
  analyzerModel: string | null; analyzerSerial: string | null;
  /** The centre's own column. */
  operatorUserId: string | null;
  /** Null when the stored operator holds no active role in this tenant — the name is then deliberately unavailable. */
  operatorName: string | null;
  operatorPhone: string | null;
  /** The OPEN custody row, which is the record W171 says the assignment must be. */
  custodyOperatorUserId: string | null;
  custodyAssignedAt: Date | null;
  members: number;
  morningOpensAt: string | null; morningClosesAt: string | null;
  eveningOpensAt: string | null; eveningClosesAt: string | null;
}

export interface CentreTankRow {
  mccId: string; unitId: string;
  minDeci: number; targetDeci: number; toleranceDeci: number;
  lastTempDeci: number | null; lastAt: Date | null;
}

@Injectable()
export class MccConsoleRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * The board, one row per centre, ordered by the code a secretary reads down the page (`MCC-AND-01`, `-02`, `-03`).
   *
   * Ordered by CODE and not by `created_at`: W171's table is in code order, and a board whose rows move because
   * somebody edited a record is a board people stop trusting for reconciliation.
   */
  async board(x: SqlExecutor, tenantId: string, includeInactive: boolean, limit: number): Promise<CentreBoardRow[]> {
    const r = await x.query(
      `SELECT c.id, c.code, c.default_name, c.is_active, c.capacity_litres_shift, c.analyzer_model, c.analyzer_serial,
              c.operator_user_id, c.morning_opens_at, c.morning_closes_at, c.evening_opens_at, c.evening_closes_at,
              u.full_name AS operator_name, u.phone AS operator_phone,
              cu.operator_user_id AS custody_operator_user_id, cu.assigned_at AS custody_assigned_at,
              coalesce(mem.n, 0)::int AS members
         FROM mcc_centres c
         -- THE TENANCY CHECK IS IN THE JOIN, not in a WHERE that a later edit could drop: an operator who holds no
         -- active role in this cooperative yields NULL name and NULL phone, and the read-model reports the centre's
         -- custody as unrecorded rather than printing a stranger.
         LEFT JOIN users u
                ON u.id = c.operator_user_id
               AND u.deleted_at IS NULL
               AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                            WHERE utr.user_id = c.operator_user_id AND utr.tenant_id = c.tenant_id
                              AND utr.is_active AND utr.deleted_at IS NULL)
         LEFT JOIN LATERAL (
           SELECT a.operator_user_id, a.assigned_at
             FROM mcc_operator_assignments a
            WHERE a.tenant_id = c.tenant_id AND a.mcc_id = c.id AND a.ended_at IS NULL AND a.deleted_at IS NULL
            ORDER BY a.assigned_at DESC, a.id DESC LIMIT 1) cu ON true
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS n
             FROM dairy_memberships m
            WHERE m.tenant_id = c.tenant_id AND m.mcc_id = c.id AND m.is_active AND m.deleted_at IS NULL) mem ON true
        WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
          AND ($2::boolean OR c.is_active)
        ORDER BY c.code, c.id
        LIMIT $3`, [tenantId, includeInactive, limit]);

    return (r.rows as any[]).map((v) => ({
      id: v.id, code: String(v.code), name: String(v.default_name), isActive: Boolean(v.is_active),
      capacityLitresShift: v.capacity_litres_shift != null ? String(v.capacity_litres_shift) : null,
      analyzerModel: v.analyzer_model ?? null, analyzerSerial: v.analyzer_serial ?? null,
      operatorUserId: v.operator_user_id ?? null,
      operatorName: v.operator_name ?? null, operatorPhone: v.operator_phone ?? null,
      custodyOperatorUserId: v.custody_operator_user_id ?? null,
      custodyAssignedAt: v.custody_assigned_at ?? null,
      members: Number(v.members ?? 0),
      morningOpensAt: hhmm(v.morning_opens_at ?? null), morningClosesAt: hhmm(v.morning_closes_at ?? null),
      eveningOpensAt: hhmm(v.evening_opens_at ?? null), eveningClosesAt: hhmm(v.evening_closes_at ?? null),
    }));
  }

  /**
   * Every live cooler at every centre, with its latest reading — W171's *"active · BMC warm"*.
   *
   * The same LATERAL the BMC monitor uses (`ORDER BY recorded_at DESC, id DESC LIMIT 1`), because the two screens must
   * agree about which reading is the current one. The VERDICT is not computed here: `centreTank` in the domain calls
   * TENANT-6d-1's own `bandOf`/`readingVerdict`/`telemetryVerdict`, so there is one band rule on this platform and not
   * a second one written in SQL.
   */
  async tanks(x: SqlExecutor, tenantId: string): Promise<CentreTankRow[]> {
    const r = await x.query(
      `SELECT b.id, b.mcc_id, b.min_temp_c, b.target_temp_c, b.tolerance_c,
              l.temp_c AS last_temp_c, l.recorded_at AS last_at
         FROM bmc_units b
         LEFT JOIN LATERAL (
           SELECT temp_c, recorded_at FROM cold_chain_logs
            WHERE tenant_id = b.tenant_id AND subject_type = 'bmc_unit' AND subject_id = b.id
            ORDER BY recorded_at DESC, id DESC LIMIT 1) l ON true
        WHERE b.tenant_id = $1 AND b.is_active = true AND b.deleted_at IS NULL
        ORDER BY b.mcc_id, b.created_at, b.id`, [tenantId]);

    return (r.rows as any[]).map((v) => ({
      mccId: v.mcc_id, unitId: v.id,
      minDeci: Number(scaledFromNumeric(v.min_temp_c, TEMP_SCALE)),
      targetDeci: Number(scaledFromNumeric(v.target_temp_c, TEMP_SCALE)),
      toleranceDeci: Number(scaledFromNumeric(v.tolerance_c, TEMP_SCALE)),
      lastTempDeci: v.last_temp_c == null ? null : Number(scaledFromNumeric(v.last_temp_c, TEMP_SCALE)),
      lastAt: v.last_at ?? null,
    }));
  }

  /**
   * The tenant's active memberships, counted INDEPENDENTLY of the board.
   *
   * This is what makes W171's *"312 memberships total ✓"* a check rather than a caption: if it were summed from the
   * same rows the board shows, it could only ever agree with itself, and a membership routed to a deactivated centre
   * would vanish from both figures at once.
   */
  async membershipTotal(x: SqlExecutor, tenantId: string): Promise<number> {
    const r = await x.query(
      `SELECT count(*)::int AS n FROM dairy_memberships
        WHERE tenant_id = $1 AND is_active AND deleted_at IS NULL`, [tenantId]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }

  /** W171's preference panel: *"weekly 214 · fortnightly 64 · monthly 22 · daily 12"*, biggest first. */
  async preferenceCounts(x: SqlExecutor, tenantId: string): Promise<Array<{ paymentCycle: string; members: number }>> {
    const r = await x.query(
      `SELECT payment_cycle, count(*)::int AS n
         FROM dairy_memberships
        WHERE tenant_id = $1 AND is_active AND deleted_at IS NULL
        GROUP BY payment_cycle
        ORDER BY n DESC, payment_cycle`, [tenantId]);
    return (r.rows as any[]).map((v) => ({ paymentCycle: String(v.payment_cycle), members: Number(v.n ?? 0) }));
  }

  /**
   * The most recent cycle for each preference — what turns *"pays every Friday"* into this cooperative's own payday.
   *
   * `DISTINCT ON (payment_cycle)` ordered by `period_start DESC`: the newest window per preference, which is the one a
   * secretary is being paid out of or is about to be. A preference with no row at all is the honest `pending` state —
   * the cadence has not opened a cycle for those members yet, and the panel says so instead of printing the canon's
   * Friday over a cooperative that pays on Tuesdays.
   */
  async cyclesByPreference(x: SqlExecutor, tenantId: string): Promise<Array<{ paymentCycle: string; periodStart: string; periodEnd: string; payday: string; status: string }>> {
    const r = await x.query(
      `SELECT DISTINCT ON (payment_cycle)
              payment_cycle, period_start::text AS period_start, period_end::text AS period_end,
              payday::text AS payday, status
         FROM dairy_bill_cycles
        WHERE tenant_id = $1 AND deleted_at IS NULL
        ORDER BY payment_cycle, period_start DESC, id DESC`, [tenantId]);
    return (r.rows as any[]).map((v) => ({
      paymentCycle: String(v.payment_cycle), periodStart: String(v.period_start), periodEnd: String(v.period_end),
      payday: String(v.payday), status: String(v.status),
    }));
  }
}
