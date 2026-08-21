// modules/dairy/repositories/dairy-quality.repository.ts · the reads behind W168 (PC-56 TENANT-6b-2).
// tenant_id in EVERY query (Law 1) + RLS. `milk_collections` is RANGE-partitioned on `collected_on`, so every read here
// carries the window as a date bound and PostgreSQL prunes to the cycle's partitions (Law 8).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { pgDate } from '../../../core/database/pg-date';
import { DailyQuality, RateCardSummary } from '../domain/dairy-quality-desk';
import { parseBonusSlabs } from '../domain/milk-rate-card.entity';
import { AnimalType, PricingModel } from '../domain/dairy.events';

const big = (v: unknown): bigint => BigInt(String(v ?? 0));
const bigOrNull = (v: unknown): bigint | null => (v == null ? null : BigInt(String(v)));

@Injectable()
export class DairyQualityRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * One row per DAY of the cycle, litre-weighted — the input to W168's *"stable ±0.1 across 13 days"*.
   *
   * Weighted in SQL for the same reason the counter board's averages are (TENANT-6a): a mean of per-pour percentages
   * answers a different question than "what was the milk like", and they differ most exactly when one big pourer differs
   * from the rest. Days with no milk are simply absent, and the domain counts only days that carried milk — a centre
   * closed on Sunday is not an unstable Sunday.
   */
  async dailyQuality(tenantId: string, from: string, to: string): Promise<DailyQuality[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT collected_on,
              coalesce(sum(weight_kg * 1000), 0)::bigint AS weight_milli_kg,
              CASE WHEN sum(weight_kg) > 0 THEN round(sum(fat_pct * weight_kg) / sum(weight_kg) * 100)::bigint END AS fat_centi,
              CASE WHEN sum(weight_kg) > 0 THEN round(sum(snf_pct * weight_kg) / sum(weight_kg) * 100)::bigint END AS snf_centi
         FROM milk_collections
        WHERE tenant_id=$1 AND collected_on >= $2::date AND collected_on <= $3::date
        GROUP BY collected_on
        ORDER BY collected_on`, [tenantId, from, to]);
    return (r.rows as any[]).map((x) => ({
      day: pgDate(x.collected_on),
      weightMilliKg: big(x.weight_milli_kg),
      fatCentiPctWeighted: bigOrNull(x.fat_centi),
      snfCentiPctWeighted: bigOrNull(x.snf_centi),
    }));
  }

  /**
   * W168's *"Premium band pourers 184 / 312"*, both ways round — because the count means two different things
   * depending on one flag and the desk must not blur them (see `premiumBand` in the domain).
   *
   * `earned` counts members who were actually PAID a premium in the window: `bonus_minor > 0`, i.e. counted from money
   * that moved. `wouldQualify` counts members whose BEST pour in the window clears `minFatCentiPct` — the answer to
   * "what would this cost us if we switched it on", which is the only honest thing to show while it is off. Both are
   * counts of MEMBERS, not pours: W168's denominator is pourers.
   */
  async premiumBandCounts(tenantId: string, from: string, to: string, minFatCentiPct: number | null): Promise<{ pourers: number; earned: number; wouldQualify: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(DISTINCT membership_id)::int AS pourers,
              count(DISTINCT membership_id) FILTER (WHERE bonus_minor > 0)::int AS earned,
              count(DISTINCT membership_id) FILTER (WHERE $4::int IS NOT NULL AND fat_pct * 100 >= $4::int)::int AS would_qualify
         FROM milk_collections
        WHERE tenant_id=$1 AND collected_on >= $2::date AND collected_on <= $3::date`,
      [tenantId, from, to, minFatCentiPct]);
    const x = (r.rows[0] ?? {}) as any;
    return { pourers: Number(x.pourers ?? 0), earned: Number(x.earned ?? 0), wouldQualify: Number(x.would_qualify ?? 0) };
  }

  /**
   * Every rate card IN FORCE on `onDate` — deliberately not `LIMIT 1`.
   *
   * `MilkRateCardRepository.resolveActive` takes exactly one card per animal type with `ORDER BY effective_from DESC
   * LIMIT 1`, and because nothing on this platform closes a superseded card's `effective_to`, a tenant can have two
   * cards satisfying that predicate and never know which one is pricing their milk. This read returns them ALL so the
   * desk can say so. Same predicate as `resolveActive` otherwise, so what the desk shows and what the counter prices
   * with cannot diverge.
   */
  async cardsInForce(tenantId: string, onDate: string): Promise<RateCardSummary[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor,
              base_rate_per_litre_minor, bonus_rules, effective_from, effective_to
         FROM milk_rate_cards
        WHERE tenant_id=$1 AND is_active = true AND deleted_at IS NULL
          AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
        ORDER BY animal_type, effective_from DESC, id DESC`, [tenantId, onDate]);
    return (r.rows as any[]).map((x) => ({
      id: x.id,
      defaultName: String(x.default_name),
      animalType: x.animal_type as AnimalType,
      pricingModel: x.pricing_model as PricingModel,
      ratePerKgFatMinor: x.rate_per_kg_fat_minor == null ? null : String(x.rate_per_kg_fat_minor),
      ratePerKgSnfMinor: x.rate_per_kg_snf_minor == null ? null : String(x.rate_per_kg_snf_minor),
      baseRatePerLitreMinor: x.base_rate_per_litre_minor == null ? null : String(x.base_rate_per_litre_minor),
      slabs: parseBonusSlabs(x.bonus_rules),
      effectiveFrom: pgDate(x.effective_from),
      effectiveTo: x.effective_to == null ? null : pgDate(x.effective_to),
    }));
  }

  /** W168's *"buffalo routes"* — which animal types actually poured in the window, biggest first, so the desk names the
   *  herd it is talking about instead of assuming one. */
  async animalMix(tenantId: string, from: string, to: string): Promise<Array<{ animalType: string; pours: number }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT m.default_animal_type AS animal_type, count(*)::int AS pours
         FROM milk_collections c
         JOIN dairy_memberships m ON m.id = c.membership_id AND m.tenant_id = c.tenant_id
        WHERE c.tenant_id=$1 AND c.collected_on >= $2::date AND c.collected_on <= $3::date
        GROUP BY m.default_animal_type
        ORDER BY pours DESC, animal_type`, [tenantId, from, to]);
    return (r.rows as any[]).map((x) => ({ animalType: String(x.animal_type ?? 'mixed'), pours: Number(x.pours ?? 0) }));
  }

  /** A representative pour for the worked example: the window's BIGGEST pour on the given card, so the arithmetic the
   *  desk prints is one a farmer at this cooperative could actually recognise rather than the canon's invented 7.1 L. */
  async exemplarPour(tenantId: string, from: string, to: string, rateCardId: string): Promise<{ weightMilliKg: bigint; fatCentiPct: bigint; snfCentiPct: bigint } | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT (weight_kg * 1000)::bigint AS weight_milli_kg, (fat_pct * 100)::bigint AS fat_centi, (snf_pct * 100)::bigint AS snf_centi
         FROM milk_collections
        WHERE tenant_id=$1 AND collected_on >= $2::date AND collected_on <= $3::date AND rate_card_id = $4
        ORDER BY weight_kg DESC, id DESC LIMIT 1`, [tenantId, from, to, rateCardId]);
    const x = r.rows[0] as any;
    return x ? { weightMilliKg: big(x.weight_milli_kg), fatCentiPct: big(x.fat_centi), snfCentiPct: big(x.snf_centi) } : null;
  }

  /** Today, as the DATABASE's calendar day — the same discipline TENANT-6a set: a desk asked for "today" must not
   *  disagree with the day SQL `current_date` stamped on the pours. */
  async today(tenantId: string): Promise<string> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT current_date::text AS d`);
    return String((r.rows[0] as any)?.d ?? '');
  }

  /** The membership mix by payment cycle — the input TENANT-6a's window derivation needs, read here too so the quality
   *  desk shows the same cycle the counter board does rather than inventing its own. */
  async membershipCycleMix(tenantId: string): Promise<Array<{ paymentCycle: string; members: number }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT payment_cycle, count(*)::int AS n
         FROM dairy_memberships
        WHERE tenant_id=$1 AND is_active = true AND deleted_at IS NULL
        GROUP BY payment_cycle
        ORDER BY n DESC, payment_cycle`, [tenantId]);
    return (r.rows as any[]).map((x) => ({ paymentCycle: String(x.payment_cycle), members: Number(x.n ?? 0) }));
  }

  /**
   * The member code behind a review, for the masked identifier W168 prints — plus the centre's code, because the
   * panel's own title is *"Open flag — today, MCC-AND-02, morning"*.
   *
   * [PC-56 TENANT-6d-3] THE CODE IS RESOLVED AS OF THE DAY OF THE POUR. It was read from `dairy_memberships` as the
   * membership's CURRENT card, which was fine while nothing could move a membership and wrong the moment one could: a
   * flag from June would print the card the member was handed in August, and the whole point of a masked identifier on
   * a quality panel is that an operator can match it to the slip in their hand. The CENTRE was already right — a
   * review carries its own `mcc_id` (0156).
   *
   * The fallback to the membership's current code is deliberate and reported: `codeIsCurrent` tells the screen that
   * the route history does not reach that day, which happens for a back-dated pour and must not be presented as the
   * card that was actually carried.
   */
  async reviewContext(tenantId: string, membershipId: string, mccId: string, on: string): Promise<{ memberCode: string | null; mccCode: string | null; codeIsCurrent: boolean }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT (SELECT member_code FROM dairy_route_asof($1, $2, $4::date)) AS asof_code,
              (SELECT member_code FROM dairy_memberships WHERE id=$2 AND tenant_id=$1) AS member_code,
              (SELECT code FROM mcc_centres WHERE id=$3 AND tenant_id=$1) AS mcc_code`,
      [tenantId, membershipId, mccId, on]);
    const x = (r.rows[0] ?? {}) as any;
    const asof = x.asof_code == null ? null : String(x.asof_code);
    return {
      memberCode: asof ?? (x.member_code ?? null),
      mccCode: x.mcc_code ?? null,
      codeIsCurrent: asof === null,
    };
  }
}
