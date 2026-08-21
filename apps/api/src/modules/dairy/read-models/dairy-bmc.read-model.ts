// modules/dairy/read-models/dairy-bmc.read-model.ts · W170 (BMC monitor) composed · PC-56 TENANT-6d-1.
//
// W170: *"Warm milk is money evaporating — alerts fire to the operator's phone before the dairy loses a rupee."*
//
// THE MONITOR SAYS FOUR KINDS OF THING, and keeps them apart on purpose:
//   1. **what the tank is doing** — the latest reading against the tank's own band, with the reading's AGE, because a
//      sensor that stopped reporting forty minutes ago is not a cold tank;
//   2. **what the platform will DO about it** — the playbook, at this tenant's thresholds, with every step marked as
//      not built, since a diversion is an act on memberships and a union pickup is a phone call;
//   3. **who would be told** — the ops-alert rules that exist for this tenant, because W170's central promise is a
//      phone ringing, and a monitor that shows a warm tank while no rule names anybody is showing half the story;
//   4. **what it cannot measure** — the quarter's *"0 L milk lost to temperature"*, which nothing on this platform can
//      produce, and the fifteen-minute call, which `ops_alert_rules` cannot express at all.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { OpsAlertRepository } from '../../logistics/repositories/ops-alert.repository';
import { BmcUnitRepository } from '../repositories/bmc-unit.repository';
import { DairyForbiddenError } from '../domain/dairy.errors';
import {
  Band, LitresLostVerdict, PlaybookItem, ReadingVerdict, TelemetryVerdict, bandOf, cOfDeci, fillPct,
  litresLostVerdict, playbook, readingVerdict, telemetryVerdict, timeInRangeBp,
} from '../domain/bmc';
import { CompressorState } from '../domain/bmc-unit.entity';
import { DairyActor } from '../services/mcc-centre.service';
import { ALERT_EVALUATION_MINUTES, silentMinutesOf } from '../../logistics/domain/ops-alert.rules';
import { BMC_CALL_FLAG } from '../domain/bmc-call.flags';
import { DIVERSION_FLAG } from '../domain/dairy-diversion.flags';

export const BMC_MONITOR_FLAG = 'dairy_bmc_monitor';

/** One cooler as W170's tile shows it. */
export interface BmcTile {
  unitId: string;
  mccId: string;
  mccCode: string;
  mccName: string;
  operatorUserId: string | null;
  /** `"3.8"` — one decimal, from the integer, never a float. Null when no reading has ever arrived. */
  tempC: string | null;
  verdict: ReadingVerdict | null;
  telemetry: TelemetryVerdict;
  band: { minC: string; targetC: string; maxC: string };
  capacityLitres: string;
  volumeLitres: string | null;
  fillPct: number | null;
  volumeAt: string | null;
  /** An operator's statement about the machine, or `unknown` — never inferred from the temperature. */
  compressor: { state: CompressorState; at: string | null };
  deviceRef: string | null;
  model: string | null;
  serialNo: string | null;
  readings24h: number;
  breaches24h: number;
}

export interface BmcMonitorView {
  /** The DATABASE's clock, so a reading's age is not measured against a browser. */
  now: string;
  units: BmcTile[];
  /** How many tanks are above their band right now — W170's header badge. */
  aboveBand: number;
  /** The tank the screen opens on (the warmest one that is out of band, else the first), and its recent readings. */
  focus: {
    unitId: string;
    hours: number;
    points: Array<{ atMinutesAgo: number; at: string; tempC: string; isBreach: boolean }>;
    /** The playbook for THIS tank, at this tenant's thresholds. */
    playbook: PlaybookItem[];
  } | null;
  thresholds: { divertC: string; condemnC: string; silenceMinutes: number };
  /** W170's *"This quarter"* card. `timeInRangeBp` is null when there are no readings — never 100%. */
  quarter: { days: number; readings: number; breaches: number; units: number; timeInRangeBp: number | null; litresLost: LitresLostVerdict };
  /**
   * WHO WOULD BE TOLD. The `ops_alert_rules` this tenant has for cold-chain breaches and silent sensors, with their
   * recipients counted — plus the two findings this wave could not fix from here.
   */
  alerting: {
    breachRules: number;
    silentRules: number;
    recipients: number;
    /**
     * **THE THRESHOLD A RULE ACTUALLY WATCHES FOR, IN MINUTES** — the tightest active `device_silent` rule, or null when
     * no rule watches silence at all.
     *
     * TENANT-6d-1 reported `silenceExpressible: false` here, because `device_silent` could only hold whole hours and
     * W170's fifteen minutes was therefore unreachable by any rule. TENANT-6d-5 made the threshold MINUTES, so the
     * honest field is no longer *"can this be said"* but *"what does this cooperative actually watch for"* — and
     * whether that number is the one the screen calls a gap.
     */
    silenceRuleMinutes: number | null;
    /**
     * Does the rule's threshold match the gap the SCREEN uses (`dairy.bmc_silence_minutes`)? Null when no rule exists.
     *
     * Not forced equal, because a cooperative may legitimately show a gap sooner than they wake somebody — but two
     * numbers for one promise is how a cooperative comes to believe an operator was called at fifteen minutes when the
     * rule was left at twelve hours, so the screen says which is which.
     */
    silenceMatchesGap: boolean | null;
    /**
     * How often the evaluator runs. A rule may now ask for two minutes; it is still checked on this cadence, and a
     * screen that printed the threshold without the cadence would be promising a precision nothing has.
     */
    evaluationMinutes: number;
    /** Is `ops.alert_fired` catalogued at all? 0086 created it; a deployment behind that migration has no alerts. */
    eventCatalogued: boolean;
    /**
     * **CAN THE SMS LEG ACTUALLY RENDER?**
     *
     * The alert's default channels are `["push","sms"]` (0086) and no SMS template was ever seeded, so every ops alert
     * since PC-55 has produced a push and a FAILED SMS row (`no_template`, fail-closed). A dairy operator in a village
     * has a feature phone; this is the channel that matters, and the screen must say when it cannot be sent rather
     * than promising a call.
     */
    smsDeliverable: boolean;
    /**
     * **IS THE CRITICAL ALERT CATALOGUED, AND CAN IT SPEAK?**
     *
     * TENANT-6d-5's finding: `resolveChannels()` suppresses push, SMS, WhatsApp and voice inside a recipient's quiet
     * hours unless the CATALOGUE event is `critical`, and `ops.alert_fired` is catalogued `important` — so every
     * critical ops alert this platform has ever raised was held until morning. 0165 catalogues `ops.alert_critical`
     * (`critical`, unmutable, push + SMS + voice) and the fired alert's own severity chooses it. These two reads are
     * how the SCREEN knows: a deployment behind the migration says so instead of promising a phone call at 2am.
     */
    criticalCatalogued: boolean;
    /** An `ivr` template for the critical alert — W170's *"operator alerted (SMS + call)"* is about this leg, and a
     *  channel with no template is recorded as `no_template` and sent nowhere (TENANT-6d-1's finding, twice over). */
    criticalVoiceDeliverable: boolean;
  };
  /** Whether *"Call MCC-AND-03 operator"* is switched on for this cooperative (`dairy_bmc_call`, default OFF). The
   *  monitor offers the button or says the act is not enabled — it never draws a button that 404s. */
  callEnabled: boolean;
  /** Whether the playbook's *"divert evening shift"* is switched on (`dairy_shift_diversion`, default OFF). The
   *  playbook's own `built` flag carries it too; this is the screen's shorthand for offering the act. */
  diversionEnabled: boolean;
}

@Injectable()
export class DairyBmcReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly units: BmcUnitRepository,
    private readonly alerts: OpsAlertRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async view(tenantId: string, actor: DairyActor, q: { unitId?: string; hours?: number } = {}): Promise<BmcMonitorView> {
    if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
    return timed(this.metrics, 'dairy.bmc_monitor', { tenant: tenantId }, async () => {
      const x = this.replica.forTenant(tenantId);
      const hours = Math.min(Math.max(q.hours ?? 6, 1), 168);

      const [nowRow, rows, thresholds, quarter, rules, delivery, callEnabled, diversionEnabled] = await Promise.all([
        x.query(`SELECT now() AS n`),
        this.units.monitor(tenantId, 24),
        this.units.thresholds(x, tenantId),
        this.units.windowCounts(tenantId, 90),
        this.alerts.listRules(tenantId).catch(() => []),
        this.opsAlertDelivery(x),
        // Read rather than assumed: the monitor must not draw a button whose route answers not-found (TENANT-6d-2's
        // ruling on the flag guard — a 404 from a flag is indistinguishable from a broken screen).
        this.flags.isEnabled(BMC_CALL_FLAG, { tenantId }),
        this.flags.isEnabled(DIVERSION_FLAG, { tenantId }),
      ]);
      const now = (nowRow.rows[0] as { n: Date }).n;

      const units: BmcTile[] = rows.map((r) => {
        const p = r.unit.toProps();
        const band = bandOf(p);
        return {
          unitId: p.id, mccId: p.mccId, mccCode: r.mccCode, mccName: r.mccName, operatorUserId: r.operatorUserId,
          tempC: r.lastTempDeci === null ? null : cOfDeci(r.lastTempDeci),
          verdict: r.lastTempDeci === null ? null : readingVerdict(r.lastTempDeci, band),
          telemetry: telemetryVerdict(r.lastAt, now, thresholds.silenceMinutes),
          band: { minC: cOfDeci(band.minDeci), targetC: cOfDeci(band.targetDeci), maxC: cOfDeci(band.maxDeci) },
          capacityLitres: litres(p.capacityCenti),
          volumeLitres: p.volumeCenti === null ? null : litres(p.volumeCenti),
          fillPct: fillPct(p.volumeCenti, p.capacityCenti),
          volumeAt: p.volumeAt?.toISOString() ?? null,
          compressor: { state: p.compressorState, at: p.compressorStateAt?.toISOString() ?? null },
          deviceRef: p.iotDeviceRef, model: p.model, serialNo: p.serialNo,
          readings24h: r.readings24h, breaches24h: r.breaches24h,
        };
      });

      // WHICH TANK THE SCREEN OPENS ON: the warmest one that is out of band, because that is the one an operator came
      // to look at — W170 draws the chart of MCC-AND-03, the tank at 6.9°C, not of the first centre alphabetically.
      // A stale tile cannot win: a tank whose sensor died an hour ago is a connectivity problem, not a warm tank.
      const focusRow = q.unitId
        ? rows.find((r) => r.unit.id === q.unitId) ?? null
        : pickFocus(rows, units);

      let focus: BmcMonitorView['focus'] = null;
      if (focusRow) {
        const p = focusRow.unit.toProps();
        const series = await this.units.series(tenantId, p.id, hours, 500);
        focus = {
          unitId: p.id, hours,
          points: series.map((s) => ({
            atMinutesAgo: Math.max(Math.floor((now.getTime() - s.at.getTime()) / 60_000), 0),
            at: s.at.toISOString(), tempC: cOfDeci(s.tempDeci), isBreach: s.isBreach,
          })),
          // [TENANT-6d-6] The playbook's second step is BUILT for a cooperative that has the override switched on, and
          // says so per tenant rather than as a constant — a screen must not offer a button whose route 404s.
          playbook: playbook(focusRow.lastTempDeci,
            { divertDeci: thresholds.divertDeci, condemnDeci: thresholds.condemnDeci },
            { divert: diversionEnabled }),
        };
      }

      const breachRules = rules.filter((r: any) => r.kind === 'cold_chain_breach');
      const silentRules = rules.filter((r: any) => r.kind === 'device_silent');
      const recipients = new Set<string>();
      for (const r of [...breachRules, ...silentRules]) for (const u of (r.recipientUserIds ?? [])) recipients.add(String(u));

      return {
        now: now.toISOString(),
        units,
        aboveBand: units.filter((u) => u.verdict === 'above_band' && u.telemetry.state === 'live').length,
        focus,
        thresholds: {
          divertC: cOfDeci(thresholds.divertDeci), condemnC: cOfDeci(thresholds.condemnDeci),
          silenceMinutes: thresholds.silenceMinutes,
        },
        quarter: {
          days: 90, readings: quarter.readings, breaches: quarter.breaches, units: quarter.units,
          timeInRangeBp: timeInRangeBp(quarter.readings - quarter.breaches, quarter.readings),
          litresLost: litresLostVerdict(),
        },
        alerting: {
          breachRules: breachRules.length, silentRules: silentRules.length, recipients: recipients.size,
          // The TIGHTEST active silence rule, in minutes — through `silentMinutesOf`, so a rule still written in the
          // legacy `silentHours` key is reported in the unit the screen speaks rather than ignored.
          silenceRuleMinutes: silentRules.length === 0
            ? null
            : Math.min(...silentRules.map((r: any) => silentMinutesOf(r.threshold as Record<string, unknown>))),
          silenceMatchesGap: silentRules.length === 0
            ? null
            : Math.min(...silentRules.map((r: any) => silentMinutesOf(r.threshold as Record<string, unknown>))) === thresholds.silenceMinutes,
          evaluationMinutes: ALERT_EVALUATION_MINUTES,
          eventCatalogued: delivery.catalogued, smsDeliverable: delivery.sms,
          criticalCatalogued: delivery.criticalCatalogued, criticalVoiceDeliverable: delivery.criticalIvr,
        },
        callEnabled,
        diversionEnabled,
      };
    });
  }

  /**
   * CAN AN OPS ALERT ACTUALLY BE DELIVERED ON THIS DEPLOYMENT — and by SMS?
   *
   * Read rather than assumed, and the reading is the finding: 0086 catalogued `ops.alert_fired` with
   * `default_channels = ["push","sms"]` and seeded push and inapp templates only, so `deliver()` recorded every SMS leg
   * as `no_template` and sent nothing. TENANT-6d-1 seeds the three SMS templates; this read is how the SCREEN knows,
   * so a deployment that has not run the seed says *"the operator will not get a text"* instead of promising one.
   */
  private async opsAlertDelivery(x: { query: (sql: string, params?: readonly unknown[]) => Promise<{ rows: unknown[] }> }): Promise<{ catalogued: boolean; sms: boolean; criticalCatalogued: boolean; criticalIvr: boolean }> {
    const r = await x.query(
      `SELECT (SELECT count(*) FROM notification_events WHERE code = 'ops.alert_fired')::int AS ev,
              (SELECT count(*) FROM notification_templates
                WHERE event_code = 'ops.alert_fired' AND channel = 'sms' AND is_active = true AND deleted_at IS NULL)::int AS sms,
              -- TENANT-6d-5: the alert that is allowed to wake somebody, and whether its VOICE leg can render. A
              -- template row is not enough on its own — 0122's send-time gate INNER JOINs the serving version, and a
              -- template with none resolves to nothing and is recorded as no_template — so the version is checked here
              -- rather than assumed. That is the defect TENANT-6c-2 found and TENANT-6d-1 hit again.
              (SELECT count(*) FROM notification_events WHERE code = 'ops.alert_critical')::int AS crit_ev,
              (SELECT count(*) FROM notification_templates
                WHERE event_code = 'ops.alert_critical' AND channel = 'ivr' AND is_active = true
                  AND serving_version_id IS NOT NULL AND deleted_at IS NULL)::int AS crit_ivr`);
    const row = (r.rows[0] ?? {}) as { ev?: number; sms?: number; crit_ev?: number; crit_ivr?: number };
    return {
      catalogued: Number(row.ev ?? 0) > 0, sms: Number(row.sms ?? 0) > 0,
      criticalCatalogued: Number(row.crit_ev ?? 0) > 0, criticalIvr: Number(row.crit_ivr ?? 0) > 0,
    };
  }
}

/** Litres from hundredths, by string: `200000n` → `"2000.00"`. */
function litres(centi: bigint): string {
  const neg = centi < 0n;
  const abs = neg ? -centi : centi;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/**
 * The tank the operator came to look at: warmest above its band, then any out-of-band tank, then the first.
 *
 * A tank with no reading at all cannot be the focus of a temperature chart — its problem is registration, which the
 * tile already says.
 */
function pickFocus<T extends { unit: { id: string }; lastTempDeci: number | null }>(rows: T[], tiles: BmcTile[]): T | null {
  const byId = new Map(tiles.map((t) => [t.unitId, t]));
  const out = rows
    .filter((r) => r.lastTempDeci !== null && byId.get(r.unit.id)?.verdict === 'above_band')
    .sort((a, b) => (b.lastTempDeci as number) - (a.lastTempDeci as number));
  if (out.length > 0) return out[0];
  return rows.find((r) => r.lastTempDeci !== null) ?? rows[0] ?? null;
}

/** Re-exported for the controller's flag guard so the key has exactly one spelling. */
export type { Band };
