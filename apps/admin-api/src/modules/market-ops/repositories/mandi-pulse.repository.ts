// modules/market-ops/repositories/mandi-pulse.repository.ts · W107 (PC-56 ADMIN-SWEEP).
//
// kv_admin, cross-tenant (Law 11) — `mandi_prices` is GLOBAL and deliberately has no tenant column: a mandi price is a
// fact about a market, not about a tenant. Every query here is bounded by `price_date`, which is the partition key
// (Law 8): this table is designed for billions of rows and an unbounded scan of it is the one mistake that would take
// the platform down rather than merely mislead somebody.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { QuarantinedRow, SourceMix } from '../domain/mandi-pulse';

@Injectable()
export class MandiPulseRepository {
  constructor(private readonly pool: AdminPool) {}

  /** W107's four tiles, plus the two the canon does not print and an operator needs. */
  async census(): Promise<{
    pointsToday: number; activeMandis: number; sourceMix: SourceMix[];
    lagsMinutes: number[]; staleMandis: number; heldToday: number; heldOpen: number; stampedToday: number;
  }> {
    const [today, lags, stale, held] = await Promise.all([
      this.pool.query(`
        SELECT COUNT(*)::int AS n, COUNT(DISTINCT mandi_id)::int AS mandis,
               COUNT(*) FILTER (WHERE ingested_at IS NOT NULL)::int AS stamped
          FROM mandi_prices WHERE price_date = CURRENT_DATE`),
      // The lag samples, from rows that HAVE an arrival stamp. 0124 does not backfill, so early days will return few or
      // none — and the console says "not measurable before this release" rather than showing a flattering zero.
      this.pool.query(`
        SELECT EXTRACT(EPOCH FROM (ingested_at - price_date::timestamptz)) / 60 AS lag_minutes
          FROM mandi_prices
         WHERE price_date >= CURRENT_DATE - 1 AND ingested_at IS NOT NULL
         LIMIT 5000`),
      // Stale = a mandi whose most recent observation is older than two days. Day-granular by construction, because
      // `price_date` is a DATE; the console states that rather than implying an hour-precision clock.
      this.pool.query(`
        SELECT COUNT(*)::int AS n FROM (
          SELECT mandi_id, MAX(price_date) AS last_seen
            FROM mandi_prices
           WHERE mandi_id IS NOT NULL AND price_date > CURRENT_DATE - 30
           GROUP BY mandi_id
        ) m WHERE m.last_seen < CURRENT_DATE - 2`),
      this.pool.query(`
        SELECT COUNT(*) FILTER (WHERE price_date = CURRENT_DATE)::int AS held_today,
               COUNT(*)::int AS held_open
          FROM mandi_prices
         WHERE anomaly_state = 'quarantined' AND price_date > CURRENT_DATE - 30`),
    ]);
    const mix = await this.pool.query(
      `SELECT source, COUNT(*)::int AS n FROM mandi_prices WHERE price_date = CURRENT_DATE GROUP BY source ORDER BY n DESC`);
    return {
      pointsToday: Number(today.rows[0].n), activeMandis: Number(today.rows[0].mandis),
      stampedToday: Number(today.rows[0].stamped),
      sourceMix: mix.rows.map((r) => ({ source: String(r.source), n: Number(r.n) })),
      lagsMinutes: lags.rows.map((r) => Number(r.lag_minutes)).filter((n) => Number.isFinite(n)),
      staleMandis: Number(stale.rows[0].n),
      heldToday: Number(held.rows[0].held_today), heldOpen: Number(held.rows[0].held_open),
    };
  }

  /** W107's "Movers today (modal, d/d)". Two bounded day-slices joined, never a window function over the whole table. */
  async movers(limit: number): Promise<{ productId: string; productName: string | null; regionName: string | null; modalMinor: string; prevModalMinor: string | null; changeBp: number | null; arrivalsQty: string | null }[]> {
    const r = await this.pool.query(`
      WITH t AS (
        SELECT product_id, region_id, modal_minor, arrivals_qty
          FROM mandi_prices
         WHERE price_date = CURRENT_DATE AND anomaly_state IN ('accepted','released')
      ), y AS (
        SELECT product_id, region_id, AVG(modal_minor)::bigint AS modal_minor
          FROM mandi_prices
         WHERE price_date = CURRENT_DATE - 1 AND anomaly_state IN ('accepted','released')
         GROUP BY product_id, region_id
      )
      SELECT t.product_id, p.default_name AS product_name, r.default_name AS region_name,
             t.modal_minor, y.modal_minor AS prev_modal_minor, t.arrivals_qty
        FROM t
        LEFT JOIN y ON y.product_id = t.product_id AND y.region_id IS NOT DISTINCT FROM t.region_id
        LEFT JOIN products p ON p.id = t.product_id
        LEFT JOIN admin_regions r ON r.id = t.region_id
       ORDER BY ABS(COALESCE(t.modal_minor - y.modal_minor, 0)) DESC
       LIMIT $1`, [limit]);
    return r.rows.map((x) => {
      const modal = BigInt(String(x.modal_minor));
      const prev = x.prev_modal_minor === null || x.prev_modal_minor === undefined ? null : BigInt(String(x.prev_modal_minor));
      return {
        productId: String(x.product_id),
        productName: (x.product_name as string | null) ?? null,
        regionName: (x.region_name as string | null) ?? null,
        modalMinor: modal.toString(),
        prevModalMinor: prev?.toString() ?? null,
        // Integer basis points, computed in bigint — a day-over-day move on money is not float arithmetic (Law 2).
        changeBp: prev && prev > 0n ? Number(((modal - prev) * 10_000n) / prev) : null,
        arrivalsQty: x.arrivals_qty === null || x.arrivals_qty === undefined ? null : String(x.arrivals_qty),
      };
    });
  }

  /** The quarantine worklist: oldest first, because a review queue is a FIFO or it is a pile. */
  async quarantined(q: { includeDecided?: boolean; limit: number }): Promise<QuarantinedRow[]> {
    const states = q.includeDecided ? ['quarantined', 'released', 'rejected'] : ['quarantined'];
    const r = await this.pool.query(`
      SELECT mp.id::text, mp.price_date::text AS price_date, mp.product_id::text, p.default_name AS product_name,
             r.default_name AS region_name, m.default_name AS mandi_name, mp.source, mp.modal_minor,
             mp.reference_modal_minor, mp.deviation_bp, mp.anomaly_state, mp.ingested_at
        FROM mandi_prices mp
        LEFT JOIN products p ON p.id = mp.product_id
        LEFT JOIN admin_regions r ON r.id = mp.region_id
        LEFT JOIN mandis m ON m.id = mp.mandi_id
       WHERE mp.anomaly_state = ANY($1::text[]) AND mp.price_date > CURRENT_DATE - 60
       ORDER BY mp.price_date ASC, mp.id ASC
       LIMIT $2`, [states, q.limit]);
    return r.rows.map((x): QuarantinedRow => ({
      id: String(x.id), priceDate: String(x.price_date), productId: String(x.product_id),
      productName: (x.product_name as string | null) ?? null,
      regionName: (x.region_name as string | null) ?? null,
      mandiName: (x.mandi_name as string | null) ?? null,
      source: String(x.source), modalMinor: String(x.modal_minor),
      referenceModalMinor: x.reference_modal_minor === null || x.reference_modal_minor === undefined ? null : String(x.reference_modal_minor),
      deviationBp: x.deviation_bp === null || x.deviation_bp === undefined ? null : Number(x.deviation_bp),
      anomalyState: String(x.anomaly_state),
      ingestedAt: x.ingested_at ? new Date(String(x.ingested_at)).toISOString() : null,
    }));
  }

  async forUpdate(client: PoolClient, id: string, priceDate: string): Promise<{ id: string; anomalyState: string; modalMinor: string } | null> {
    // The partition key travels with the id (Law 8) — `WHERE id = $1` alone would scan every monthly partition of a
    // billions-of-rows table to lock one observation.
    const r = await client.query(
      `SELECT id::text, anomaly_state, modal_minor FROM mandi_prices WHERE id = $1 AND price_date = $2::date FOR UPDATE`,
      [id, priceDate]);
    const x = r.rows[0];
    return x ? { id: String(x.id), anomalyState: String(x.anomaly_state), modalMinor: String(x.modal_minor) } : null;
  }

  /** Record the reviewer's decision on the observation AND close its queue row, in the caller's transaction (Law 4). */
  async decide(client: PoolClient, d: {
    id: string; priceDate: string; to: 'released' | 'rejected'; adminId: string; note: string;
  }): Promise<void> {
    await client.query(
      `UPDATE mandi_prices
          SET anomaly_state = $3, anomaly_decided_at = now(), anomaly_decided_by_user_id = $4, anomaly_note = $5
        WHERE id = $1 AND price_date = $2::date AND anomaly_state = 'quarantined'`,
      [d.id, d.priceDate, d.to, d.adminId, d.note.slice(0, 300)]);
    // `accepted` on the queue means "the reviewer accepted the observation" — the queue's own vocabulary since 0013,
    // which is not the same word as the price's `released`. Kept distinct rather than renamed: two planes, two nouns.
    await client.query(
      `UPDATE ai_review_queue
          SET status = $3, reviewer_user_id = NULL, decision_note = $4, resolved_at = now(), updated_at = now()
        WHERE subject_kind = 'mandi_price' AND subject_bigint_id = $1 AND subject_date = $2::date AND status = 'pending'`,
      [d.id, d.priceDate, d.to === 'released' ? 'accepted' : 'rejected', d.note.slice(0, 300)]);
  }
}
