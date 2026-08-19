// modules/logistics/read-models/logistics-desk.read-model.ts · W225 (Logistics overview) and W244 (Logistics
// insights) — PC-56 TENANT-5d. A READ model: replica-only, no writes, and every judgement comes from
// `domain/logistics-desk.ts` so the two screens, the API and the export cannot disagree about what a number means.
//
// The shape of everything here is the same: a figure arrives as a VERDICT — measured, with its basis and coverage,
// or refused, with the inputs it is missing named. W225 and W244 print fourteen figures between them and this
// platform can honestly produce eight of them; a desk that presented all fourteen identically would teach an
// operator to trust the six that are decoration.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { LogisticsDeskRepository } from '../repositories/logistics-desk.repository';
import { FreightInvoiceRepository } from '../repositories/freight-invoice.repository';
import {
  AttentionItem, CostPerUnitVerdict, FailureBreakdown, HistoryVerdict, InsightWindow, LaneShare, MechanismVerdict,
  OnTimeVerdict, RateVerdict, TransitLossVerdict, TransitVerdict,
  activeCount, callAheadCandidate, costPerQtlKmVerdict, daysUntilWeekday, failureBreakdown, firstAttemptVerdict,
  historyVerdict, isLaneCandidate, laneShares, mechanisms, onTimeVerdict, orderAttention, transitLossVerdict,
  transitVerdict,
} from '../domain/logistics-desk';

/** 5a's flag. The pickup half of W225's "OTP at pickup AND delivery" promise only exists behind it. */
export const PICKUP_OTP_FLAG = 'logistics_pickup_otp';
/** This wave's own switch (Law 10, OFF). Both screens, one flag — see 0154's own comment. */
export const DESK_INSIGHTS_FLAG = 'logistics_desk_insights';

/** How far ahead the attention list looks. A pickup tomorrow morning is today's problem for an FPO that has to find
 *  a driver tonight, so this is a day rather than "until midnight". */
const ATTENTION_HOURS = 24;

export interface LogisticsOverview {
  /** W225's lead counts. */
  activeShipments: number;
  pickupsToday: number;
  byStatus: Record<string, number>;
  /** W225's "Needs you today", ordered by what spoils or leaves first. */
  attention: AttentionItem[];
  /** Delivered-performance tiles: what is measured, and the on-time tile's refusal. */
  onTime: OnTimeVerdict;
  firstAttempt: RateVerdict;
  transit: TransitVerdict;
  /** "Transit loss (90d)" — refused, with the nearest signal named. */
  transitLoss: TransitLossVerdict;
  /** Cold chain: breach count over the canon's own 7-day window, and how many reefer runs are live. */
  coldChain: { breaches7d: number; liveReeferShipments: number };
  /** The philosophy block, resolved against what is switched on for THIS tenant. */
  mechanisms: MechanismVerdict[];
  /** The next committed weekly run, or null when this tenant has none. */
  nextRun: { routeId: string; routeName: string; runWeekday: number | null; daysAway: number | null; villages: number } | null;
  windowDays: number;
}

export interface LogisticsInsights {
  window: InsightWindow;
  windowFrom: string;
  windowTo: string;
  history: HistoryVerdict;
  firstAttempt: RateVerdict;
  transit: TransitVerdict;
  failures: FailureBreakdown;
  /** The vocabulary the codes belong to, so a tenant's own added reason is named rather than printed raw. */
  reasonNames: Array<{ code: string; name: string }>;
  callAhead: boolean;
  lanes: { lanes: Array<LaneShare & { candidate: boolean }>; totalShipments: number; basis: 'shipments' };
  /** "Cost per qtl-km" — refused, with all three missing inputs named. */
  costPerQtlKm: CostPerUnitVerdict;
  transitLoss: TransitLossVerdict;
  /** 5c's figure, one per currency: what recon actually recovered in the window. */
  freightRecovered: Array<{ currencyCode: string; recoveredMinor: string }>;
}

@Injectable()
export class LogisticsDeskReadModel {
  constructor(
    private readonly repo: LogisticsDeskRepository,
    private readonly freight: FreightInvoiceRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /** W225. One tenant, one moment: what is moving, what needs a person, and which of the canon's three promises are
   *  actually switched on. */
  async overview(tenantId: string): Promise<LogisticsOverview> {
    return timed(this.metrics, 'logistics.desk_overview', { tenant: tenantId }, async () => {
      const [byStatus, pickupsToday, due, reefer, stats, run, routes, dow, otpOn] = await Promise.all([
        this.repo.statusCounts(tenantId, 90),
        this.repo.pickupsToday(tenantId),
        this.repo.pickupsDue(tenantId, ATTENTION_HOURS, 10),
        this.repo.coldChainInTransit(tenantId, 10),
        this.repo.deliveryStats(tenantId, 30),
        this.repo.nextWeeklyRun(tenantId),
        this.repo.activeRouteCount(tenantId),
        this.repo.todayDow(tenantId),
        // Fails CLOSED: a flag store that cannot answer must not let the screen claim a safety mechanism is on.
        this.flags.isEnabled(PICKUP_OTP_FLAG, { tenantId }).catch(() => false),
      ]);

      const attention: AttentionItem[] = [];
      for (const d of due) {
        // A 3PL shipment carries its own driver, so "no driver" is only a gap on an OWN-fleet run — the distinction
        // 5a drew and W225 prints ("tempo assigned, no driver yet").
        if (!d.hasRider && !d.hasPartner) {
          attention.push({ kind: 'pickup_no_driver', shipmentId: d.id, orderId: d.orderId, at: d.scheduledPickupAt, hasVehicle: d.hasVehicle });
        } else {
          attention.push({ kind: 'pickup_due', shipmentId: d.id, orderId: d.orderId, at: d.scheduledPickupAt });
        }
      }
      for (const r of reefer) {
        attention.push({
          kind: 'cold_chain_live', shipmentId: r.shipmentId, orderId: r.orderId,
          lastTempC: r.lastTempC, lastAt: r.lastAt, breaches: r.breaches,
        });
      }
      if (run) {
        attention.push({
          kind: 'village_run', routeId: run.id, routeName: run.name,
          dayKey: run.runWeekday === null ? null : `route.day.${['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][run.runWeekday]}`,
          daysAway: daysUntilWeekday(dow, run.runWeekday),
          // Nothing records a parcel arriving at a consolidation point (5b: the event has no subscriber and the job
          // is instantiated nowhere), so the canon's "13 of 32 consolidated" has no source and says so.
          consolidation: 'not_tracked',
        });
      }

      return {
        activeShipments: activeCount(byStatus),
        pickupsToday,
        byStatus,
        attention: orderAttention(attention),
        onTime: onTimeVerdict(),
        firstAttempt: firstAttemptVerdict(stats),
        transit: transitVerdict(stats),
        transitLoss: transitLossVerdict(),
        coldChain: {
          breaches7d: reefer.reduce((a, r) => a + r.breaches, 0),
          liveReeferShipments: reefer.length,
        },
        mechanisms: mechanisms({ pickupOtpEnabled: otpOn, routesActive: routes }),
        nextRun: run
          ? { routeId: run.id, routeName: run.name, runWeekday: run.runWeekday, daysAway: daysUntilWeekday(dow, run.runWeekday), villages: run.villages }
          : null,
        windowDays: 30,
      };
    });
  }

  /** W244. The numbers that decide next quarter's routes and rates — and, for three of the canon's four tiles, the
   *  reason this platform cannot produce them yet. */
  async insights(tenantId: string, window: InsightWindow): Promise<LogisticsInsights> {
    return timed(this.metrics, 'logistics.desk_insights', { tenant: tenantId, window: String(window) }, async () => {
      const [stats, failures, vocab, lanes, days, bounds, recovered] = await Promise.all([
        this.repo.deliveryStats(tenantId, window),
        this.repo.failureReasons(tenantId, window),
        this.repo.failureReasonVocabulary(tenantId),
        this.repo.lanes(tenantId, window, 10),
        this.repo.historyDays(tenantId),
        this.repo.windowBounds(tenantId, window),
        // 5c's own read, in the same module and through its repository — the recovery figure W244 quotes is the one
        // the freight desk computes, per currency, and duplicating that sum here would be two mechanisms over one fact.
        this.freight.recoveredSince(tenantId, new Date(Date.now() - window * 86_400_000).toISOString()),
      ]);
      const breakdown = failureBreakdown(failures);
      const shares = laneShares(lanes);
      return {
        window,
        windowFrom: bounds.from,
        windowTo: bounds.to,
        history: historyVerdict(days),
        firstAttempt: firstAttemptVerdict(stats),
        transit: transitVerdict(stats),
        failures: breakdown,
        reasonNames: vocab.map((v) => ({ code: v.code, name: v.name })),
        callAhead: callAheadCandidate(breakdown),
        lanes: { ...shares, lanes: shares.lanes.map((l) => ({ ...l, candidate: isLaneCandidate(l) })) },
        costPerQtlKm: costPerQtlKmVerdict(),
        transitLoss: transitLossVerdict(),
        freightRecovered: recovered,
      };
    });
  }
}
