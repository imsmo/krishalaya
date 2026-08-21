// modules/dairy/repositories/dairy-counter.repository.ts · the reads behind W167 (Dairy — collections).
// PC-56 TENANT-6a. Replica-only, tenant-scoped, and bounded by the DAY or the cycle window in every statement.
//
// `milk_collections` is PARTITIONED BY RANGE (collected_on), so every query here carries a `collected_on` predicate —
// a day for the board, a window for the accrual. That is not tuning: it is what stops one shift's board from touching
// every month the platform will ever hold (Law 8, and 5b/5c/5d each learned a version of it the hard way).
//
// **THERE WAS NO WAY TO READ A DAY'S COLLECTIONS.** `MilkCollectionRepository.listFor` requires a `membershipId` and
// the SDK's `listCollections` demands one too — so before this wave a centre's own shift could not be listed at all,
// let alone a tenant's three centres side by side, which is the whole of W167.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { CentreShiftRow, Shift } from '../domain/dairy-counter';
import { hhmm } from '../domain/mcc-console';

const big = (v: unknown): bigint => BigInt(String(v ?? '0'));
const bigOrNull = (v: unknown): bigint | null => (v == null ? null : BigInt(String(v)));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export interface FlagRow { waterFlag: boolean; adulterationFlags: string[] }

@Injectable()
export class DairyCounterRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * W167's table: one row per centre for one day and shift, with its analyzer on file and its membership roll.
   *
   * The averages are WEIGHTED BY LITRES inside the database (`sum(fat×weight)/sum(weight)`) rather than averaged as
   * percentages, because a mean of per-pour percentages answers a different question than "what was this centre's
   * milk like" — and the two differ most exactly when one big pourer differs from the rest.
   *
   * Centres with NO pours this shift are still returned (LEFT JOIN from `mcc_centres`): a centre missing from the
   * board reads as "no centre", and an operator needs to see the one that has collected nothing by 09:00.
   */
  async centreShiftRows(tenantId: string, day: string, shift: Shift): Promise<CentreShiftRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH pours AS (
         SELECT c.mcc_id,
                count(*)::int                                   AS pours,
                count(DISTINCT c.membership_id)::int            AS pourers,
                coalesce(sum(c.weight_kg * 1000), 0)::bigint    AS weight_milli_kg,
                CASE WHEN sum(c.weight_kg) > 0
                     THEN round(sum(c.fat_pct * c.weight_kg) / sum(c.weight_kg) * 100)::bigint END AS fat_centi,
                CASE WHEN sum(c.weight_kg) > 0
                     THEN round(sum(c.snf_pct * c.weight_kg) / sum(c.weight_kg) * 100)::bigint END AS snf_centi,
                coalesce(sum(c.amount_minor), 0)::bigint        AS amount_minor,
                count(*) FILTER (WHERE c.water_flag OR jsonb_array_length(coalesce(c.adulteration_flags,'[]'::jsonb)) > 0)::int AS flags
           FROM milk_collections c
          WHERE c.tenant_id=$1 AND c.collected_on = $2::date AND c.shift = $3
          GROUP BY c.mcc_id
       ), roll AS (
         -- [PC-56 TENANT-6d-3] THE ROLL AS OF THIS BOARD'S DAY, not as of today.
         --
         -- This counted dairy_memberships GROUP BY mcc_id — the CURRENT routing — for a board whose day is a
         -- parameter, so last Tuesday's "104 pourers against a roll of 108" was measured against this morning's roll.
         -- Merely imprecise while no membership could move; wrong at the wrong centre once one can.
         --
         -- ONE RESIDUAL, NAMED: is_active is still the membership's current flag, because no history of it exists,
         -- so a member who left in July is absent from June's roll. Narrower than the routing error, and fixing it
         -- means versioning membership activity, which is not this wave.
         SELECT r.mcc_id, count(*)::int AS memberships
           FROM dairy_membership_routes r
           JOIN dairy_memberships m ON m.id = r.membership_id AND m.tenant_id = r.tenant_id
                                   AND m.is_active = true AND m.deleted_at IS NULL
          WHERE r.tenant_id=$1 AND r.deleted_at IS NULL
            AND r.valid_from <= $2::date AND (r.valid_to IS NULL OR r.valid_to >= $2::date)
          GROUP BY r.mcc_id
       )
       SELECT m.id AS mcc_id, m.code, m.default_name, m.analyzer_model, m.analyzer_serial,
              -- [TENANT-6d-2] The hours for THE SHIFT BEING SHOWN, from the centre (0163). Selected by the shift
              -- parameter rather than fetched as four columns and chosen in TypeScript, so a board of the evening can
              -- never print a morning window.
              CASE WHEN $3 = 'morning' THEN m.morning_opens_at  ELSE m.evening_opens_at  END AS shift_opens_at,
              CASE WHEN $3 = 'morning' THEN m.morning_closes_at ELSE m.evening_closes_at END AS shift_closes_at,
              coalesce(p.pours,0)::int AS pours, coalesce(p.pourers,0)::int AS pourers,
              coalesce(p.weight_milli_kg,0)::bigint AS weight_milli_kg,
              p.fat_centi, p.snf_centi,
              coalesce(p.amount_minor,0)::bigint AS amount_minor,
              coalesce(p.flags,0)::int AS flags,
              coalesce(roll.memberships,0)::int AS memberships
         FROM mcc_centres m
         LEFT JOIN pours p ON p.mcc_id = m.id
         LEFT JOIN roll   ON roll.mcc_id = m.id
        WHERE m.tenant_id=$1 AND m.deleted_at IS NULL AND m.is_active = true
        ORDER BY m.code`, [tenantId, day, shift]);
    return (r.rows as any[]).map((x) => ({
      mccId: x.mcc_id, code: String(x.code), name: String(x.default_name),
      analyzerModel: x.analyzer_model ?? null, analyzerSerial: x.analyzer_serial ?? null,
      pours: Number(x.pours ?? 0), pourers: Number(x.pourers ?? 0),
      weightMilliKg: big(x.weight_milli_kg),
      fatCentiPctWeighted: bigOrNull(x.fat_centi), snfCentiPctWeighted: bigOrNull(x.snf_centi),
      amountMinor: big(x.amount_minor), flags: Number(x.flags ?? 0),
      membershipsEnrolled: Number(x.memberships ?? 0),
      shiftWindow: shiftWindowOf(x.shift_opens_at ?? null, x.shift_closes_at ?? null),
    }));
  }

  /** The flag rows themselves, for the day AND SHIFT — a handful by construction, and needed for their KINDS (W167
   *  prints "water_flag", not "1 flag"). Bounded hard: a day with hundreds of flags is a different emergency and the
   *  desk says the count rather than listing them.
   *
   *  [PC-56 TENANT-6a LIVE FINDING] This read was day-wide while the table beside it is shift-wide, so the flag TILE
   *  counted the evening's flags into the morning board and disagreed with the sum of its own rows. The board is a
   *  shift, so the tile is a shift; the suite asserts the tile equals the rows' sum. */
  async flagsForDay(tenantId: string, day: string, shift: Shift, limit = 50): Promise<FlagRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT water_flag, adulteration_flags
         FROM milk_collections
        WHERE tenant_id=$1 AND collected_on = $2::date AND shift = $3
          AND (water_flag = true OR jsonb_array_length(coalesce(adulteration_flags,'[]'::jsonb)) > 0)
        LIMIT ${Math.max(1, Math.min(500, Math.trunc(limit)))}`, [tenantId, day, shift]);
    return (r.rows as any[]).map((x) => ({
      waterFlag: x.water_flag === true,
      adulterationFlags: Array.isArray(x.adulteration_flags) ? x.adulteration_flags.map((f: unknown) => String(f)) : [],
    }));
  }

  /**
   * The cycle-to-date accrual: what the window's pours are worth, how many MEMBERS poured, and how many of the rate
   * cards that priced them carry bonus rules the engine ignores.
   *
   * That last count is the point of the query: `milk_rate_cards.bonus_rules` is read by nothing in this codebase, so
   * a tenant whose card promises "fat ≥ 6.5 → +₹0.50/L" has been paying without it. The desk cannot fix that (the
   * rate card is TENANT-6b's) and it can refuse to present the total as though the premium were inside it.
   */
  async accrual(tenantId: string, from: string, to: string): Promise<{ amountMinor: bigint; membersWithPours: number; cardsWithBonusRules: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT coalesce(sum(c.amount_minor),0)::bigint AS amount_minor,
              count(DISTINCT c.membership_id)::int    AS members,
              count(DISTINCT c.rate_card_id) FILTER (
                WHERE rc.bonus_rules IS NOT NULL AND rc.bonus_rules <> '{}'::jsonb AND rc.bonus_rules <> '[]'::jsonb
              )::int AS cards_with_bonus
         FROM milk_collections c
         LEFT JOIN milk_rate_cards rc ON rc.id = c.rate_card_id AND rc.tenant_id = c.tenant_id
        WHERE c.tenant_id=$1 AND c.collected_on >= $2::date AND c.collected_on <= $3::date`, [tenantId, from, to]);
    const x = (r.rows[0] ?? {}) as any;
    return {
      amountMinor: big(x.amount_minor),
      membersWithPours: Number(x.members ?? 0),
      cardsWithBonusRules: Number(x.cards_with_bonus ?? 0),
    };
  }

  /**
   * How many milk bills actually EXIST for the window.
   *
   * W167 prints "312 milk_bills building".
   *
   * [PC-56 TENANT-6c-6] THIS COMMENT WAS STALE. It said *"nothing builds them on a clock: `MilkBillCycleCloseJob` is
   * instantiated nowhere"* — true when TENANT-6a wrote it, false since TENANT-6c-1 replaced that dead class with
   * `DairyCycleCloseCadenceJob` and REGISTERED it. What remains true is the shape of the number: a bill is built when
   * the window SHUTS, so mid-cycle this count is legitimately zero while 312 members are pouring, and the desk shows
   * it beside the count of members who poured. The gap is no longer a finding — it is the cycle's own design (0157:
   * a money record that changes under the member is worse than one that arrives on the Thursday), and W169's console
   * is where the same two numbers are read with the cycle's stage beside them.
   */
  async billsInWindow(tenantId: string, from: string, to: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS n FROM milk_bills
        WHERE tenant_id=$1 AND deleted_at IS NULL AND period_start >= $2::date AND period_end <= $3::date`,
      [tenantId, from, to]);
    return Number((r.rows[0] as any)?.n ?? 0);
  }

  /**
   * The BMC each centre has, its target, and its latest reading — the column W167 draws.
   *
   * `bmc_units` has had no application code since 0007, and `cold_chain_logs` accepts `subject_type='bmc_unit'` while
   * nothing has ever written one, so the LEFT JOIN to the readings is expected to come back empty on every tenant
   * today. Written as a real read anyway rather than a hardcoded "not recorded": the day TENANT-6d starts the stream,
   * this desk lights up without a code change, and the probe proves the join works against a reading it inserts.
   */
  async bmcForCentres(tenantId: string): Promise<Array<{ mccId: string; unitId: string | null; targetC: string | null; tempC: string | null; recordedAt: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT m.id AS mcc_id, b.id AS unit_id, b.target_temp_c::text AS target_c,
              l.temp_c::text AS temp_c, l.recorded_at
         FROM mcc_centres m
         LEFT JOIN bmc_units b ON b.mcc_id = m.id AND b.tenant_id = m.tenant_id AND b.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT temp_c, recorded_at FROM cold_chain_logs
            WHERE tenant_id = m.tenant_id AND subject_type = 'bmc_unit' AND subject_id = b.id
              AND recorded_at >= (now() - interval '24 hours')
            ORDER BY recorded_at DESC, id DESC LIMIT 1
         ) l ON true
        WHERE m.tenant_id=$1 AND m.deleted_at IS NULL AND m.is_active = true
        ORDER BY m.code`, [tenantId]);
    return (r.rows as any[]).map((x) => ({
      mccId: x.mcc_id, unitId: x.unit_id ?? null, targetC: x.target_c ?? null,
      tempC: x.temp_c ?? null, recordedAt: iso(x.recorded_at),
    }));
  }

  /** The membership mix by payment cycle — the preference W171 counts, and the input the cycle window is derived
   *  from. Returned as counts so the desk can say WHICH window it is showing and how many members it does not fit. */
  async membershipCycleMix(tenantId: string): Promise<Array<{ paymentCycle: string; members: number }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT payment_cycle, count(*)::int AS n
         FROM dairy_memberships
        WHERE tenant_id=$1 AND is_active = true AND deleted_at IS NULL
        GROUP BY payment_cycle
        ORDER BY n DESC, payment_cycle`, [tenantId]);
    return (r.rows as any[]).map((x) => ({ paymentCycle: String(x.payment_cycle), members: Number(x.n ?? 0) }));
  }

  /** The tenant's own currency for this desk's money, read from the rate card that priced the window rather than
   *  assumed: `milk_rate_cards` carries no currency column, so this returns the tenant's country currency and the
   *  read model states the basis. (Rule Zero: a hardcoded ₹ caps the platform to one country.) */
  async currencyCode(tenantId: string): Promise<string> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT co.currency_code
         FROM tenants t JOIN countries co ON co.code = t.country_code
        WHERE t.id=$1`, [tenantId]);
    return String((r.rows[0] as any)?.currency_code ?? 'INR');
  }

  /** Today, as the DATABASE's calendar day — so a board asked for "today" cannot disagree with the day the pours
   *  were stamped with by SQL `current_date` at the counter. */
  async today(tenantId: string): Promise<string> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT current_date::text AS d`);
    return String((r.rows[0] as any)?.d ?? '');
  }
}

/**
 * A shift's window, or null. Both ends or neither — `ck_mcc_shift_*` makes half a window impossible in the database,
 * and this treats a half as UNRECORDED rather than repairing it (TENANT-6d-2's ruling: an invented closing time sends
 * a farmer to a closed door).
 */
function shiftWindowOf(opens: string | null, closes: string | null): { opens: string; closes: string } | null {
  const o = hhmm(opens); const c = hhmm(closes);
  return o !== null && c !== null ? { opens: o, closes: c } : null;
}
