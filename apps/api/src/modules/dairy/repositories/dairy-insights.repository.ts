// modules/dairy/repositories/dairy-insights.repository.ts · the reads behind W172 (PC-56 TENANT-6e-1).
//
// tenant_id in EVERY query (Law 1) + RLS, and every read of `milk_collections` carries a `collected_on` range so
// PostgreSQL prunes to the window's monthly partitions (Law 8). Nothing here is unbounded: the one question that
// naturally has no floor — "when did this member first ever pour?" — is bounded to the declared lookback and the
// domain reports the answer as "at least", which is the whole of 168.1.
//
// **THIS REPOSITORY IS DELIBERATELY SMALL.** W172 needs the premium-slab counts and the rate cards in force, and
// TENANT-6b-2 already wrote both (`DairyQualityRepository.premiumBandCounts` / `cardsInForce`) with the reasoning that
// makes them honest — the earned/would-qualify split, and returning every in-force card because nothing closes a
// superseded one. The read model composes those rather than this file re-deriving them: two dairy screens with two
// SQL statements over the same slab is how "184 pourers" comes to mean two different things.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { pgDate } from '../../../core/database/pg-date';

const big = (v: unknown): bigint => BigInt(String(v ?? 0));
const int = (v: unknown): number => Number(v ?? 0);

/** One window's totals. Litres are milli-litres by this desk's own convention (0155): `weight_kg numeric(8,3)` is a
 *  weight, milk is quoted in litre-equivalents, and no density factor is invented here. */
export interface WindowTotals {
  milli: bigint;
  amountMinor: bigint;
  bonusMinor: bigint;
  daysWithPours: number;
  pourers: number;
  pours: number;
}

export interface DayShiftVolume { collectedOn: string; shift: string; milli: bigint }

export interface CohortCounts { active: number; newcomers: number; winBacks: number }

export interface CycleFacts { closed: number; allBillsApproved: number }

/** The tenant's currency AND its scale. Both, together, because one without the other cannot render a rate: 5160
 *  minor units per litre is ₹51.60 at two decimals and ¥5160 at zero. */
export interface MoneyShape { currencyCode: string; minorUnits: number }

@Injectable()
export class DairyInsightsRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * Everything the two KPI tiles need for ONE window, in one statement — run twice (current, previous) rather than
   * joined, because a self-join over two ranges of a partitioned table defeats the pruning that makes either cheap.
   *
   * `sum(weight_kg * 1000)::bigint` is EXACT: the column is `numeric(8,3)`, so ×1000 is an integer and the cast
   * truncates nothing. Same expression as 6b-2's `dailyQuality`, on purpose.
   *
   * `days_with_pours` counts distinct COLLECTION DAYS, which the domain reports beside the average but never divides
   * by — the average is per calendar day (see `volumeInsight`). It is returned so the page can say "collected on 62 of
   * 90 days", which is the sentence that explains a low average without excusing it.
   */
  async windowTotals(tenantId: string, from: string, to: string): Promise<WindowTotals> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT coalesce(sum(weight_kg * 1000), 0)::bigint AS milli,
              coalesce(sum(amount_minor), 0)::bigint      AS amount_minor,
              coalesce(sum(bonus_minor), 0)::bigint       AS bonus_minor,
              count(DISTINCT collected_on)::int           AS days_with_pours,
              count(DISTINCT membership_id)::int          AS pourers,
              count(*)::int                               AS pours
         FROM milk_collections
        WHERE tenant_id=$1 AND collected_on >= $2::date AND collected_on <= $3::date`,
      [tenantId, from, to]);
    const x = (r.rows[0] ?? {}) as Record<string, unknown>;
    return {
      milli: big(x.milli), amountMinor: big(x.amount_minor), bonusMinor: big(x.bonus_minor),
      daysWithPours: int(x.days_with_pours), pourers: int(x.pourers), pours: int(x.pours),
    };
  }

  /**
   * The tenant's currency and its scale, or NULL — never a guess.
   *
   * `DairyCounterRepository.currencyCode` falls back to `'INR'`, which TENANT-6d-7 refused on the notice path for a
   * reason that applies identically to a screen: a rate rendered at two decimals for a currency that has none is wrong
   * by a factor of a hundred, and a Kuwaiti or Japanese cooperative would be shown a figure it could not reconcile.
   * Rule Zero binds a read as tightly as a write.
   *
   * NULL rather than a throw, because W172 has a state for this (*"couldn't build insights"*) and a page that names
   * the missing reference row is more useful than a 500 — and infinitely more useful than a plausible wrong number.
   */
  async moneyShape(tenantId: string): Promise<MoneyShape | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT co.currency_code, cu.minor_units
         FROM tenants t
         JOIN countries co ON co.code = t.country_code
         LEFT JOIN currencies cu ON cu.code = co.currency_code
        WHERE t.id=$1`, [tenantId]);
    const x = r.rows[0] as Record<string, unknown> | undefined;
    if (!x || x.currency_code == null || x.minor_units == null) return null;
    return { currencyCode: String(x.currency_code), minorUnits: Number(x.minor_units) };
  }

  /**
   * The earliest pour SINCE a floor — the history gate's input, bounded on purpose (168.1).
   *
   * `min(collected_on)` with no lower bound is a scan of every partition this tenant has ever had, and it gets slower
   * every season a cooperative survives; the gate needs at most 60 days of the answer, so 365 is offered and the
   * domain flags the result as a floor when it lands on it.
   */
  async firstPourSince(tenantId: string, since: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT min(collected_on) AS first_on
         FROM milk_collections
        WHERE tenant_id=$1 AND collected_on >= $2::date`,
      [tenantId, since]);
    const v = (r.rows[0] as Record<string, unknown> | undefined)?.first_on;
    return v == null ? null : pgDate(v);
  }

  /**
   * The chart's raw material: one row per day per shift. At most `window × shifts` rows (180 for the canon's 90 days),
   * so it is returned unbucketed and bucketed by the pure domain — an aggregate computed in SQL cannot be unit-tested
   * against the boundary cases that actually break weekly buckets, and those boundaries are where every off-by-one in
   * this kind of chart lives.
   *
   * `shift` is NOT constrained to the two the chart declares. A tenant with a third collection, or a future value of
   * the `milk_shift` enum, contributes to the bucket total and appears as its own key rather than vanishing from a
   * chart that claims to show volume.
   */
  async dailyByShift(tenantId: string, from: string, to: string): Promise<DayShiftVolume[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT collected_on, shift::text AS shift, coalesce(sum(weight_kg * 1000), 0)::bigint AS milli
         FROM milk_collections
        WHERE tenant_id=$1 AND collected_on >= $2::date AND collected_on <= $3::date
        GROUP BY collected_on, shift
        ORDER BY collected_on, shift`,
      [tenantId, from, to]);
    return (r.rows as Array<Record<string, unknown>>).map((x) => ({
      collectedOn: pgDate(x.collected_on), shift: String(x.shift), milli: big(x.milli),
    }));
  }

  /**
   * *"pourers active 312, +18 this quarter · 4 win-backs"* — three counts, one statement, three date bounds.
   *
   *   `cur`    — everyone who poured in the window.
   *   `prior`  — everyone who poured in the lookback BEFORE the window, with the last day they did.
   *
   * A NEWCOMER is absent from `prior` entirely: no pour in the year before this window. A WIN-BACK is in `prior` with
   * `last_on` strictly before the PREVIOUS window's start — which is exactly "poured with us once, then nothing for a
   * whole window, and now they are back". The two filters are disjoint by construction, and the domain still checks
   * that they sum inside `active`, because the next person to edit this statement will not have read this comment.
   *
   * `prior` is bounded at both ends: `>= lookbackFrom` for Law 8, `< windowFrom` because a pour inside the window is
   * what `cur` is for. Both bounds prune.
   */
  async cohortCounts(
    tenantId: string, windowFrom: string, windowTo: string, lookbackFrom: string, previousFrom: string,
  ): Promise<CohortCounts> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH cur AS (
         SELECT DISTINCT membership_id
           FROM milk_collections
          WHERE tenant_id=$1 AND collected_on >= $2::date AND collected_on <= $3::date),
       prior AS (
         SELECT membership_id, max(collected_on) AS last_on
           FROM milk_collections
          WHERE tenant_id=$1 AND collected_on >= $4::date AND collected_on < $2::date
          GROUP BY membership_id)
       SELECT count(*)::int                                                              AS active,
              count(*) FILTER (WHERE p.membership_id IS NULL)::int                       AS newcomers,
              count(*) FILTER (WHERE p.last_on IS NOT NULL AND p.last_on < $5::date)::int AS win_backs
         FROM cur c LEFT JOIN prior p ON p.membership_id = c.membership_id`,
      [tenantId, windowFrom, windowTo, lookbackFrom, previousFrom]);
    const x = (r.rows[0] ?? {}) as Record<string, unknown>;
    return { active: int(x.active), newcomers: int(x.newcomers), winBacks: int(x.win_backs) };
  }

  /**
   * The two facts that stand where the payout-streak tile is refused (168.2).
   *
   * `closed` — cycles whose window ended inside the insight window and which actually reached `closed`. Not "cycles
   * that should have closed": a cycle left open past its `closes_at` is a finding of its own (6c's job) and counting
   * it here would let a stalled platform look punctual.
   *
   * `all_bills_approved` — of those, the ones where every bill generated for the cycle reached `approved` or `paid`.
   * A cycle with a single disputed bill is NOT counted, because a member in dispute is precisely the person the
   * "on-time" claim is made to. `bills_generated = 0` is excluded too: a cycle that produced no bills approved nothing.
   */
  async cycleFacts(tenantId: string, from: string, to: string): Promise<CycleFacts> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH c AS (
         SELECT id, coalesce(bills_generated, 0) AS gen
           FROM dairy_bill_cycles
          WHERE tenant_id=$1 AND deleted_at IS NULL AND status='closed'
            AND period_end >= $2::date AND period_end <= $3::date)
       SELECT count(*)::int AS closed,
              count(*) FILTER (
                WHERE c.gen > 0 AND NOT EXISTS (
                  SELECT 1 FROM milk_bills b
                   WHERE b.cycle_id = c.id AND b.tenant_id=$1 AND b.deleted_at IS NULL
                     AND b.status NOT IN ('approved','paid'))
              )::int AS all_bills_approved
         FROM c`,
      [tenantId, from, to]);
    const x = (r.rows[0] ?? {}) as Record<string, unknown>;
    return { closed: int(x.closed), allBillsApproved: int(x.all_bills_approved) };
  }
}
