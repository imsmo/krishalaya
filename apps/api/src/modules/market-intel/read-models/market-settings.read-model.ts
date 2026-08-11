// modules/market-intel/read-models/market-settings.read-model.ts · PC-56 ADMIN-SWEEP.
//
// Reads the two platform settings the anomaly gate needs (0124). **THEY ARE SETTINGS AND NOT CONSTANTS** because a guard
// on a farmer's selling decision must be tightenable after an incident without waiting for a deploy — which is what
// ADMIN-11 built `platform_setting_values` for.
//
// **AND AN UNREADABLE SETTING FALLS BACK TO THE STRICTER SHIPPED DEFAULT, NEVER TO AN OPEN GATE.** A cache miss or a
// replica blip must not be the reason a 10× typo reaches a farmer, so every failure path here lands on
// DEFAULT_THRESHOLD_BP and DEFAULT_GATED_SOURCES — the opposite of the fail-safe direction ADMIN-11 chose for feature
// flags, and for the opposite reason: there, serving a stale flag keeps a feature working; here, an open gate ships bad
// prices.
import { Injectable, Logger } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import {
  DEFAULT_GATED_SOURCES, DEFAULT_THRESHOLD_BP, gatedSourcesFrom, thresholdFrom,
} from '../domain/price-anomaly';

const THRESHOLD_KEY = 'market.price_anomaly_threshold_bp';
const SOURCES_KEY = 'market.price_anomaly_gated_sources';
/** Sixty seconds. Long enough that the gate does not query per observation on an ingest burst, short enough that
 *  tightening the threshold after an incident takes effect while the incident is still open. */
const TTL_MS = 60_000;

export interface AnomalyPolicy { thresholdBp: number; gatedSources: string[]; usedDefaults: boolean }

@Injectable()
export class MarketSettingsReadModel {
  private readonly log = new Logger(MarketSettingsReadModel.name);
  private cached: { at: number; policy: AnomalyPolicy } | null = null;

  constructor(private readonly pools: PgPoolProvider) {}

  async anomalyPolicy(): Promise<AnomalyPolicy> {
    if (this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.policy;
    const fallback: AnomalyPolicy = {
      thresholdBp: DEFAULT_THRESHOLD_BP, gatedSources: [...DEFAULT_GATED_SOURCES], usedDefaults: true,
    };
    try {
      // The platform layer first, the shipped default behind it — the two-column separation 0121 exists for. kv_app has
      // SELECT on `platform_setting_values` and can never write one.
      const r = await this.pools.replica(0).query<{ key: string; value: unknown }>(
        `SELECT d.key, COALESCE(v.value, d.default_value) AS value
           FROM setting_definitions d
           LEFT JOIN platform_setting_values v ON v.key = d.key AND v.deleted_at IS NULL
          WHERE d.key = ANY($1::text[])`, [[THRESHOLD_KEY, SOURCES_KEY]]);
      const byKey = new Map(r.rows.map((x) => [x.key, x.value]));
      const t = thresholdFrom(byKey.get(THRESHOLD_KEY));
      const g = gatedSourcesFrom(byKey.get(SOURCES_KEY));
      const policy: AnomalyPolicy = {
        thresholdBp: t.bp, gatedSources: g.sources, usedDefaults: t.usedDefault || g.usedDefault,
      };
      this.cached = { at: Date.now(), policy };
      return policy;
    } catch (err) {
      // Loud, because running on defaults is a fact an operator should learn from the logs rather than from an incident.
      this.log.warn(`anomaly policy unreadable, using shipped defaults: ${(err as Error)?.message ?? err}`);
      return fallback;
    }
  }
}
