// modules/twin/read-models/twin-facts.read-model.ts · PC-56 TENANT-12 · THE GROUND TRUTH THE TWIN READS (W420), and its as-ofs.
//
// A READ MODEL over other modules' tables (the 9d `EsgFactsReadModel` precedent — never their repositories, Law 11 of the module
// blueprint): land_parcels, soil_tests, crop_seasons (land-soil-weather), mandi_prices (market-intel), weather_alerts (platform),
// twin_devices (ours). Every number here is a COUNT or a DATE of recorded rows, read under the caller's tenant (RLS on), and each
// carries the as-of it was computed from — a figure without an as-of is not shown (W420's own law, the 9d `Freshness` pattern).
// `twin_feeds.as_of_query_key` picks one of the FIXED reads below (a whitelist): the as-of is computed on every read, never typed.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { HarvestRow } from '../domain/twin-rules';

const MAPPED = `(lp.boundary_geojson IS NOT NULL AND lp.boundary_geojson->>'type' IN ('Polygon','MultiPolygon') AND jsonb_typeof(lp.boundary_geojson->'coordinates') = 'array')`;
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export interface ParcelFacts { registered: number; mapped: number; asOf: string | null }
export interface SoilFacts { tests: number; parcelsTested: number; latestSampledOn: string | null; asOf: string | null }
export interface SeasonFacts { open: number; harvested: number; abandoned: number; lastClosed: { season: string; year: number; status: string; at: string } | null; asOf: string | null }
export interface DeviceFacts { soilPods: number; weatherMasts: number; retired: number; withReading: number; asOf: string | null }
export interface MandiFacts { platformRows: number; platformAsOf: string | null; tenantObservations: number; tenantAsOf: string | null }
export interface AlertFacts { recent: number; lastIngestedAt: string | null }
export interface FeedRegistryRow { code: string; asOfQueryKey: string; sourceTables: string[]; sortOrder: number }

@Injectable()
export class TwinFactsReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async feeds(tenantId: string): Promise<FeedRegistryRow[]> {
    const r = await this.replica.forTenant(tenantId).query<{ code: string; as_of_query_key: string; source_tables: string[]; sort_order: number }>(
      `SELECT code, as_of_query_key, source_tables, sort_order FROM twin_feeds WHERE is_active ORDER BY sort_order, code`);
    return r.rows.map((x) => ({ code: x.code, asOfQueryKey: x.as_of_query_key, sourceTables: x.source_tables, sortOrder: x.sort_order }));
  }

  /** Parcels registered in THIS tenant, and how many carry a real boundary (the same predicate the validator accepts). */
  async parcels(tenantId: string): Promise<ParcelFacts> {
    const r = await this.replica.forTenant(tenantId).query<{ registered: number; mapped: number; as_of: unknown }>(
      `SELECT count(*)::int AS registered, count(*) FILTER (WHERE ${MAPPED})::int AS mapped, max(lp.updated_at) AS as_of
         FROM land_parcels lp WHERE lp.tenant_id = $1 AND lp.deleted_at IS NULL`, [tenantId]);
    const x = r.rows[0];
    return { registered: x?.registered ?? 0, mapped: x?.mapped ?? 0, asOf: iso(x?.as_of) };
  }

  async soil(tenantId: string): Promise<SoilFacts> {
    const r = await this.replica.forTenant(tenantId).query<{ tests: number; parcels: number; latest: string | null; as_of: unknown }>(
      `SELECT count(*)::int AS tests, count(DISTINCT parcel_id)::int AS parcels, to_char(max(sampled_on), 'YYYY-MM-DD') AS latest, max(created_at) AS as_of
         FROM soil_tests WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]);
    const x = r.rows[0];
    return { tests: x?.tests ?? 0, parcelsTested: x?.parcels ?? 0, latestSampledOn: x?.latest ?? null, asOf: iso(x?.as_of) };
  }

  async seasons(tenantId: string): Promise<SeasonFacts> {
    const db = this.replica.forTenant(tenantId);
    const c = await db.query<{ open: number; harvested: number; abandoned: number; as_of: unknown }>(
      `SELECT count(*) FILTER (WHERE status IN ('planned','sown'))::int AS open, count(*) FILTER (WHERE status = 'harvested')::int AS harvested,
              count(*) FILTER (WHERE status = 'abandoned')::int AS abandoned, max(updated_at) AS as_of
         FROM crop_seasons WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]);
    const l = await db.query<{ season: string; year: number; status: string; at: unknown }>(
      `SELECT season, year, status, updated_at AS at FROM crop_seasons WHERE tenant_id = $1 AND deleted_at IS NULL AND status IN ('harvested','abandoned')
        ORDER BY year DESC, updated_at DESC, id DESC LIMIT 1`, [tenantId]);
    const x = c.rows[0];
    return { open: x?.open ?? 0, harvested: x?.harvested ?? 0, abandoned: x?.abandoned ?? 0,
      lastClosed: l.rows[0] ? { season: l.rows[0].season, year: l.rows[0].year, status: l.rows[0].status, at: iso(l.rows[0].at)! } : null, asOf: iso(x?.as_of) };
  }

  async devices(tenantId: string): Promise<DeviceFacts> {
    const r = await this.replica.forTenant(tenantId).query<{ pods: number; masts: number; retired: number; read: number; as_of: unknown }>(
      `SELECT count(*) FILTER (WHERE kind_code = 'soil_pod' AND status = 'registered')::int AS pods,
              count(*) FILTER (WHERE kind_code = 'weather_mast' AND status = 'registered')::int AS masts,
              count(*) FILTER (WHERE status = 'retired')::int AS retired,
              count(*) FILTER (WHERE last_reading_at IS NOT NULL)::int AS read,
              max(updated_at) AS as_of
         FROM twin_devices WHERE tenant_id = $1`, [tenantId]);
    const x = r.rows[0];
    return { soilPods: x?.pods ?? 0, weatherMasts: x?.masts ?? 0, retired: x?.retired ?? 0, withReading: x?.read ?? 0, asOf: iso(x?.as_of) };
  }

  /** Platform rows (tenant NULL, from a feed: agmarknet / enam) vs this tenant's own typed observations — never conflated (F-4). */
  async mandi(tenantId: string): Promise<MandiFacts> {
    const r = await this.replica.forTenant(tenantId).query<{ p_rows: number; p_asof: string | null; t_rows: number; t_asof: string | null }>(
      `SELECT count(*) FILTER (WHERE tenant_id IS NULL AND source IN ('agmarknet','enam'))::int AS p_rows,
              to_char(max(price_date) FILTER (WHERE tenant_id IS NULL AND source IN ('agmarknet','enam')), 'YYYY-MM-DD') AS p_asof,
              count(*) FILTER (WHERE tenant_id = $1)::int AS t_rows,
              to_char(max(price_date) FILTER (WHERE tenant_id = $1), 'YYYY-MM-DD') AS t_asof
         FROM mandi_prices WHERE price_date >= (now() - interval '400 days')::date`, [tenantId]);
    const x = r.rows[0];
    return { platformRows: x?.p_rows ?? 0, platformAsOf: x?.p_asof ?? null, tenantObservations: x?.t_rows ?? 0, tenantAsOf: x?.t_asof ?? null };
  }

  /** Ingested advisories in the last 30 days (the partition-pruned window the land module reads). */
  async alerts(tenantId: string): Promise<AlertFacts> {
    const r = await this.replica.forTenant(tenantId).query<{ n: number; last: unknown }>(
      `SELECT count(*)::int AS n, max(created_at) AS last FROM weather_alerts WHERE created_at >= now() - interval '30 days'`);
    return { recent: r.rows[0]?.n ?? 0, lastIngestedAt: iso(r.rows[0]?.last) };
  }

  /** Every harvested season of one crop in this tenant, with its parcel's area — the inputs of the one W422 fact (B9). */
  async harvests(tenantId: string, productId: string): Promise<HarvestRow[]> {
    const r = await this.replica.forTenant(tenantId).query<{ owner: string; year: number; season: string; at: string; actual: string | null; yunit: string | null; area: string; aunit: string }>(
      `SELECT lp.owner_user_id AS owner, cs.year, cs.season, to_char(cs.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at,
              cs.actual_yield::text AS actual, cs.yield_unit_code AS yunit, lp.area_value::text AS area, lp.area_unit AS aunit
         FROM crop_seasons cs JOIN land_parcels lp ON lp.id = cs.parcel_id AND lp.tenant_id = cs.tenant_id AND lp.deleted_at IS NULL
        WHERE cs.tenant_id = $1 AND cs.product_id = $2 AND cs.status = 'harvested' AND cs.deleted_at IS NULL AND cs.actual_yield IS NOT NULL
        ORDER BY cs.year DESC, cs.updated_at DESC LIMIT 5000`, [tenantId, productId]);
    return r.rows.map((x) => ({ ownerUserId: x.owner, year: x.year, season: x.season, harvestedAt: x.at, actualYield: x.actual, yieldUnit: x.yunit, area: x.area, areaUnit: x.aunit }));
  }

  async conversions(tenantId: string): Promise<Array<{ from: string; to: string; factor: string }>> {
    const r = await this.replica.forTenant(tenantId).query<{ from_unit: string; to_unit: string; factor: string }>(
      `SELECT from_unit, to_unit, factor::text AS factor FROM unit_conversions WHERE deleted_at IS NULL`);
    return r.rows.map((x) => ({ from: x.from_unit, to: x.to_unit, factor: x.factor }));
  }
}
