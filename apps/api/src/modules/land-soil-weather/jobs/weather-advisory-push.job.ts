// modules/land-soil-weather/jobs/weather-advisory-push.job.ts · PC-56 TENANT-12 (F-5, F-6) — THE ADVISORY PUSH, ACTUALLY WIRED.
//
// Before this wave the pipeline was dead at every joint (survey F-5): the job had NO caller; its SQL could not even parse (the
// query used `$2` while `$1` — the tenant id it was handed — appeared nowhere: `could not determine data type of parameter $1`,
// 42P18, proven by PREPARE); its event named no recipient, so the notification fan-out dropped it; `weather.alert` /
// `weather.alert_severe` were catalogued and emitted by nothing; `weather_prefs` were stored and read by nothing.
//
// NOW
//   • it is a `ScheduledJob`, REGISTERED in `SCHEDULED_JOB_REGISTRY` (the 10b / 11a / 11d pattern): the runner hands it the
//     kv_relay pool, from which it reads ONLY `tenants`; every claim and emit runs per tenant in kv_app's unit of work (RLS on);
//   • a tenant whose `land_soil_weather` flag is off is skipped (the module's kill-switch reaches its job too);
//   • the SQL binds exactly the parameters it uses (`$1` tenant, `$2` limit) — PREPARE succeeds (the D proof);
//   • RECIPIENTS are resolved here: the owners of this tenant's parcels whose region lies UNDER the alert's region
//     (`admin_regions.path <@`), minus those whose weather prefs ask for severe alerts only when this one is not severe. The
//     payload carries `recipientUserIds`, so the fan-out delivers (`weather.alert` / `weather.alert_severe`, notification map);
//   • the alert's NAME travels as a per-language map (`ui_messages weather.alert_type.*`, seed 0023) — a Gujarati notice never
//     carries an English code; an alert type with no English row is NOT sent and is counted (fails closed);
//   • idempotent: one event per (tenant, alert) — the dedup is on this tenant's own outbox rows; an alert with no recipient in a
//     tenant emits nothing there (a parcel registered later, while it is still active, is announced on a later tick).
// It emits nothing it cannot ground in a real ingested alert. INGESTION ITSELF (IMD / Skymet → weather_alerts) IS REFUSED BY
// NAME: nothing writes weather_alerts but kv_ingest, and no ingestion path is connected — the twin overview says so.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { ScheduledJob } from '../../../core/jobs/scheduled-job';
import { UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OutboxWriter } from '../../../core/outbox/outbox.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';

export const WEATHER_ADVISORY_JOB = 'land-weather-advisory-push';
export const ADVISORY_EVENT = { active: 'land.weather_advisory_active', severe: 'land.weather_advisory_severe' } as const;
export const ALERT_NAME_PREFIX = 'weather.alert_type.';

/** The claim: currently-valid alerts this tenant has not announced yet. Exactly two parameters, both used. */
export const DUE_ALERTS_SQL = `
  SELECT a.id, a.region_id, a.severity, lv.code AS alert_code, ar.default_name AS region_name,
         to_char(a.valid_to AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS valid_to_ist
    FROM weather_alerts a
    JOIN admin_regions ar ON ar.id = a.region_id
    LEFT JOIN lookup_values lv ON lv.id = a.alert_type_id
   WHERE a.created_at >= now() - interval '30 days'
     AND a.valid_from <= now() AND a.valid_to >= now()
     AND NOT EXISTS (
       SELECT 1 FROM outbox_events o
        WHERE o.tenant_id = $1::uuid AND o.aggregate_type = 'weather_alert' AND o.aggregate_id = a.id
          AND o.event_type IN ('land.weather_advisory_active', 'land.weather_advisory_severe'))
   ORDER BY a.valid_to DESC, a.id
   LIMIT $2::int`;

/** Who hears it: parcel owners under the alert's region, honouring `severe_only`. */
export const RECIPIENTS_SQL = `
  SELECT DISTINCT lp.owner_user_id
    FROM land_parcels lp
    JOIN admin_regions pr ON pr.id = lp.region_id
    LEFT JOIN weather_prefs wp ON wp.tenant_id = lp.tenant_id AND wp.user_id = lp.owner_user_id AND wp.deleted_at IS NULL
   WHERE lp.tenant_id = $1::uuid AND lp.deleted_at IS NULL
     AND pr.path <@ (SELECT path FROM admin_regions WHERE id = $2::uuid)
     AND ($3::text = 'severe' OR COALESCE(wp.severe_only, false) = false)
   ORDER BY lp.owner_user_id`;

export interface AdvisoryTickResult { emitted: number; unnamed: number; noRecipients: number }

export class WeatherAdvisoryPushJob implements ScheduledJob {
  readonly name = WEATHER_ADVISORY_JOB;
  private readonly log = new Logger(WeatherAdvisoryPushJob.name);
  constructor(readonly intervalMs: number, private readonly uow: UnitOfWork, private readonly outbox: OutboxWriter,
              private readonly flags: FlagsService, private readonly ui: UiMessageRepository, private readonly limit = 200) {}

  /** One tenant, one kv_app transaction: claim → resolve recipients → emit (dedup is the outbox row itself). */
  async runForTenant(tenantId: string): Promise<AdvisoryTickResult> {
    const names = await this.ui.mapsUnder(ALERT_NAME_PREFIX);
    return this.uow.run(tenantId, async (tx: TxContext) => {
      const due = await tx.query<{ id: string; region_id: string; severity: string; alert_code: string | null; region_name: string; valid_to_ist: string }>(DUE_ALERTS_SQL, [tenantId, this.limit]);
      const out: AdvisoryTickResult = { emitted: 0, unnamed: 0, noRecipients: 0 };
      for (const a of due.rows) {
        const alertName = a.alert_code ? names.get(`${ALERT_NAME_PREFIX}${a.alert_code}`) : undefined;
        if (!alertName) { out.unnamed++; continue; }
        const rec = await tx.query<{ owner_user_id: string }>(RECIPIENTS_SQL, [tenantId, a.region_id, a.severity]);
        const recipientUserIds = rec.rows.map((r) => r.owner_user_id);
        if (recipientUserIds.length === 0) { out.noRecipients++; continue; }
        const severe = a.severity === 'severe';
        await this.outbox.write(tx, {
          tenantId, aggregateType: 'weather_alert', aggregateId: a.id, eventType: severe ? ADVISORY_EVENT.severe : ADVISORY_EVENT.active,
          payload: { v: 2, recipientUserIds, alertCode: a.alert_code, alertName, region: a.region_name, regionId: a.region_id, severity: a.severity, validTo: a.valid_to_ist },
        });
        out.emitted++;
      }
      return out;
    }, { userId: 'system' });
  }

  async sweep(pool: Pool): Promise<{ tenants: number; emitted: number; failed: number; skipped: number }> {
    const tenants = (await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id`)).rows.map((r) => r.id);
    let emitted = 0, failed = 0, skipped = 0;
    for (const tenantId of tenants) {
      try {
        if (!(await this.flags.isEnabled('land_soil_weather', { tenantId }))) { skipped++; continue; }
        emitted += (await this.runForTenant(tenantId)).emitted;
      } catch (e) { failed++; this.log.warn(`${this.name}: tenant ${tenantId} failed: ${(e as Error)?.message ?? e}`); }
    }
    return { tenants: tenants.length, emitted, failed, skipped };
  }

  async run(pool: Pool): Promise<void> {
    const r = await this.sweep(pool);
    if (r.emitted > 0 || r.failed > 0) this.log.log(`${this.name}: ${r.emitted} advisory event(s), ${r.failed} failed, across ${r.tenants} tenant(s)`);
  }
}
