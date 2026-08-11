// modules/market-intel/repositories/mandi-price.repository.ts · mandi_prices (GLOBAL, PARTITIONED by price_date;
// billions of rows). Append-only observations. Lists are KEYSET on (price_date, id) DESC — never OFFSET — backed
// by idx_mandi_prices_lookup; queries bound product_id (and region/date) so PG prunes partitions (Law 8).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { MandiPrice } from '../domain/mandi-price.entity';
import { PriceSource } from '../domain/market-intel.events';

const COLS = `id, mandi_id, region_id, product_id, grade_option_id, price_date::text AS price_date, min_minor, max_minor, modal_minor, unit_code, arrivals_qty, source, currency_code`;
function toDomain(r: any): MandiPrice {
  return MandiPrice.rehydrate({ id: String(r.id), mandiId: r.mandi_id, regionId: r.region_id, productId: r.product_id, gradeOptionId: r.grade_option_id, priceDate: r.price_date,
    minMinor: r.min_minor != null ? BigInt(r.min_minor) : null, maxMinor: r.max_minor != null ? BigInt(r.max_minor) : null, modalMinor: BigInt(r.modal_minor),
    unitCode: r.unit_code, arrivalsQty: r.arrivals_qty != null ? String(r.arrivals_qty) : null, source: r.source as PriceSource, currencyCode: r.currency_code });
}
export interface PriceListQuery { productId: string; regionId?: string; mandiId?: string; fromDate?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class MandiPriceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  /**
   * Append an observation WITH its anomaly verdict (PC-56 ADMIN-SWEEP, 0124).
   *
   * **THE VERDICT IS WRITTEN IN THE SAME STATEMENT AS THE PRICE**, not in a follow-up UPDATE: a row that exists for even
   * one statement without its state would be a row the alert loop could read as accepted, and the alert loop runs a few
   * lines later in the same transaction.
   *
   * Returns the id + price_date so the caller can enqueue a review row that points at it (Law 8: the partition key
   * travels with the id).
   */
  async insert(tx: TxContext, m: MandiPrice, verdict?: {
    state: 'accepted' | 'quarantined'; deviationBp: number | null; referenceModalMinor: bigint | null;
  }): Promise<{ id: string; priceDate: string }> {
    const p = m.toProps();
    const r = await tx.query(
      `INSERT INTO mandi_prices (mandi_id, region_id, product_id, grade_option_id, price_date, min_minor, max_minor, modal_minor, unit_code, arrivals_qty, source, currency_code,
                                 anomaly_state, deviation_bp, reference_modal_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, price_date::text AS price_date`,
      [p.mandiId, p.regionId, p.productId, p.gradeOptionId, p.priceDate, p.minMinor?.toString() ?? null, p.maxMinor?.toString() ?? null, p.modalMinor.toString(), p.unitCode, p.arrivalsQty, p.source, p.currencyCode,
        verdict?.state ?? 'accepted', verdict?.deviationBp ?? null, verdict?.referenceModalMinor?.toString() ?? null]);
    return { id: String(r.rows[0].id), priceDate: String(r.rows[0].price_date) };
  }

  /**
   * The reference modal a manual report is judged against: the most recent ACCEPTED observation for this
   * product × region, from a trusted source, inside a short window.
   *
   * **IT MUST NOT READ QUARANTINED OR REJECTED ROWS.** Judging one bad price against the last bad price is how a typo
   * becomes the new normal — two 10× entries in a row would agree with each other and both sail through.
   *
   * Read on the WRITER inside the caller's transaction, not the replica: an observation inserted seconds ago on a
   * volatile day may not have reached a replica, and a stale reference makes the gate wrong in the permissive direction.
   */
  async referenceModal(tx: TxContext, productId: string, regionId: string | null, priceDate: string, windowDays = 14): Promise<bigint | null> {
    const params: unknown[] = [productId, priceDate, windowDays];
    let where = `product_id = $1 AND price_date <= $2::date AND price_date > $2::date - ($3 || ' days')::interval
                 AND anomaly_state IN ('accepted','released')
                 AND source IN ('agmarknet','enam','platform_txn')`;
    if (regionId) { params.push(regionId); where += ` AND region_id = $${params.length}`; }
    const r = await tx.query(
      `SELECT modal_minor FROM mandi_prices WHERE ${where} ORDER BY price_date DESC, id DESC LIMIT 1`, params);
    return r.rows[0] ? BigInt(String(r.rows[0].modal_minor)) : null;
  }

  /** Enqueue the human review for a quarantined observation, on the queue that has carried a `price_anomaly` kind since
   *  migration 0013 and has been enqueued by nobody. */
  async enqueueAnomalyReview(tx: TxContext, q: {
    tenantId: string; priceId: string; priceDate: string; deviationBp: number | null;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO ai_review_queue (tenant_id, queue_kind, priority, status, subject_kind, subject_bigint_id, subject_date, decision_note)
       VALUES ($1, 'price_anomaly', $2, 'pending', 'mandi_price', $3, $4::date, $5)`,
      [q.tenantId,
        // A wilder deviation is a higher priority: lower number sorts first in this table's convention, and a 10× typo
        // needs looking at before a 25% one.
        q.deviationBp !== null && q.deviationBp >= 10_000 ? 10 : 50,
        q.priceId, q.priceDate,
        q.deviationBp === null ? 'quarantined with no computable deviation' : `deviation ${q.deviationBp} bp from reference modal`]);
  }
  /** Latest observation for product (+region/mandi). */
  async latest(tenantId: string, productId: string, regionId: string | null): Promise<MandiPrice | null> {
    const params: unknown[] = [productId]; let where = `product_id=$1`;
    if (regionId) { params.push(regionId); where += ` AND region_id=$2`; }
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM mandi_prices WHERE ${where} ORDER BY price_date DESC, id DESC LIMIT 1`, params);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async listFor(tenantId: string, q: PriceListQuery): Promise<MandiPrice[]> {
    const params: unknown[] = [q.productId]; let where = `product_id=$1`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.regionId) where += ` AND region_id=${p(q.regionId)}`;
    if (q.mandiId) where += ` AND mandi_id=${p(q.mandiId)}`;
    if (q.fromDate) where += ` AND price_date >= ${p(q.fromDate)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (price_date < ${cc} OR (price_date=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM mandi_prices WHERE ${where} ORDER BY price_date DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** Recent modal observations for the baseline band (bounded window + cap). */
  async recentModals(tenantId: string, productId: string, regionId: string, fromDate: string, max = 500): Promise<bigint[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT modal_minor FROM mandi_prices WHERE product_id=$1 AND region_id=$2 AND price_date >= $3 ORDER BY price_date DESC, id DESC LIMIT ${max}`, [productId, regionId, fromDate]);
    return r.rows.map((x: any) => BigInt(x.modal_minor));
  }
}
