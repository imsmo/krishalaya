// apps/web-tenant/src/features/logistics/desk.ts · W225's and W244's rules as PURE functions (PC-56 TENANT-5d).
// No React, no I/O — unit- and mutation-tested; the API re-computes every verdict server-side.
//
// W225: *"Produce moving = money moving."* W244: *"Lanes, failure reasons, cost per quintal-km — the numbers that
// decide next quarter's routes and rates."* Which is exactly why most of this file is about the difference between a
// number this platform measured and a number the canon drew: a rate card set from a plausible figure is money.

import type {
  LogisticsAttention, LogisticsCostPerUnit, LogisticsFailureBreakdown, LogisticsHistory, LogisticsLane,
  LogisticsMechanism, LogisticsOnTime, LogisticsRate, LogisticsTransit, LogisticsTransitLoss,
} from '@krishalaya/sdk-js';

/* ------------------------------------------------------------------------------------------------------- */
/* THE TILES — MEASURED, OR REFUSED BY NAME                                                                */
/* ------------------------------------------------------------------------------------------------------- */

/** A rate for display, from integer basis points. Never computed in a template, and null when there was nothing to
 *  measure — because "0.0%" against zero deliveries is a claim about performance that nobody made. */
export function rateText(r: LogisticsRate): string | null {
  return r.kind === 'measured' ? `${(r.bps / 100).toFixed(1)}%` : null;
}

export function rateKey(r: LogisticsRate): string {
  return r.kind === 'measured' ? 'logistics.rate.measured' : 'logistics.rate.noDeliveries';
}

/**
 * W225's *"On-time delivery (30d) 95.1%"*.
 *
 * Nothing on this platform promises a delivery time — no promised-by column on a shipment, no SLA on a zone, none in
 * a charge definition — so "on time" has no denominator. The tile prints the refusal and what it would need, and the
 * FIRST-ATTEMPT rate takes its place: that one is measured, and it only became measurable when 5a made
 * `delivery_attempts` count something.
 */
export function onTimeKey(_o: LogisticsOnTime): string { void _o; return 'logistics.onTime.notPromised'; }
export function missingKey(input: string): string { return `logistics.missing.${input}`; }

/** W225's transit tile: a median with its coverage, or the honest "we cannot time these". */
export function transitKey(t: LogisticsTransit): string {
  return t.kind === 'measured' ? 'logistics.transit.median' : 'logistics.transit.notMeasurable';
}
export function transitHoursText(t: LogisticsTransit): string | null {
  return t.kind === 'measured' ? String(t.medianHours) : null;
}
/** True when some delivered shipments carry no pickup stamp, so the median covers only part of the window. A median
 *  over a third of the rows is a number an operator should distrust, and the screen says which third. */
export function transitPartial(t: LogisticsTransit): boolean {
  return t.missingPickupStamp > 0;
}

/** W225's "Transit loss (90d)" and W244's "Cost per qtl-km": both refused, both naming their inputs. One key for the
 *  sentence, and the inputs rendered from the payload so a new missing input appears without a code change. */
export function transitLossKey(_v: LogisticsTransitLoss): string { void _v; return 'logistics.transitLoss.notRecorded'; }
export function costPerQtlKmKey(_v: LogisticsCostPerUnit): string { void _v; return 'logistics.cost.notComputable'; }

/* ------------------------------------------------------------------------------------------------------- */
/* WHAT NEEDS YOU TODAY (W225)                                                                             */
/* ------------------------------------------------------------------------------------------------------- */

export function attentionKey(i: LogisticsAttention): string { return `logistics.attention.${i.kind}`; }

/** How loud the row is. A cold-chain breach is the only thing on this screen that spoils while you read it; a booked
 *  pickup with no driver is the only thing a person must fix before this afternoon. */
export function attentionTone(i: LogisticsAttention): 'bad' | 'warn' | 'ok' | 'muted' {
  if (i.kind === 'cold_chain_live') return i.breaches > 0 ? 'bad' : 'ok';
  if (i.kind === 'pickup_no_driver') return 'warn';
  if (i.kind === 'pickup_due') return 'muted';
  return 'muted';
}

/** The action a row offers, as a route this console actually has. A cold-chain row links to the shipment's own trail
 *  (5a built it); a village-run row links to the route board (5b); a driverless pickup links to the shipment, where
 *  the assign action lives. Null when there is nothing a person can do from here. */
export function attentionHref(i: LogisticsAttention): string | null {
  switch (i.kind) {
    case 'pickup_no_driver':
    case 'pickup_due':        return `/logistics/${encodeURIComponent(i.shipmentId)}`;
    case 'cold_chain_live':   return `/logistics/${encodeURIComponent(i.shipmentId)}`;
    default:                  return '/logistics/routes';
  }
}

/** W225's third row says "13 of 32 drop-point parcels consolidated at ambassadors". Nothing records a parcel arriving
 *  at a consolidation point, so the count is refused and the run itself — which IS real — is what the row states. */
export function consolidationKey(i: LogisticsAttention): string | null {
  return i.kind === 'village_run' ? 'logistics.attention.consolidationNotTracked' : null;
}

/** "loads in 5 days" — and "today" and "tomorrow" as their own sentences, because "loads in 0 days" is not English
 *  and an operator reading it on the morning of the run needs to see the word. */
export function daysAwayKey(daysAway: number | null): string {
  if (daysAway === null) return 'logistics.run.onDemand';
  if (daysAway === 0) return 'logistics.run.today';
  if (daysAway === 1) return 'logistics.run.tomorrow';
  return 'logistics.run.inDays';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE PHILOSOPHY BLOCK (W225)                                                                             */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * Three ticks in the canon; three claims about the software here.
 *
 * A tick is printed only for a mechanism that is actually ON. `partial` and `absent` get their own marks and their
 * own sentences, because this block is the one an FPO would quote in a dispute — "the platform proves possession at
 * both ends" is either true for this tenant or it is not.
 */
export function mechanismKey(m: LogisticsMechanism): string { return `logistics.mech.${m.key}.${m.state}`; }

export function mechanismMark(m: LogisticsMechanism): '✓' | '~' | '✕' {
  if (m.state === 'on') return '✓';
  if (m.state === 'partial') return '~';
  return '✕';
}

export function mechanismTone(m: LogisticsMechanism): 'ok' | 'warn' | 'muted' {
  if (m.state === 'on') return 'ok';
  if (m.state === 'partial') return 'warn';
  return 'muted';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE INSIGHTS (W244)                                                                                     */
/* ------------------------------------------------------------------------------------------------------- */

export const INSIGHT_WINDOWS = [30, 90, 180] as const;
export type InsightWindow = (typeof INSIGHT_WINDOWS)[number];
export const DEFAULT_WINDOW: InsightWindow = 90;

export function windowOf(raw: string | undefined): InsightWindow {
  const n = Number(raw);
  return (INSIGHT_WINDOWS as readonly number[]).includes(n) ? (n as InsightWindow) : DEFAULT_WINDOW;
}

export function insightsHref(window: InsightWindow): string {
  return window === DEFAULT_WINDOW ? '/logistics/insights' : `/logistics/insights?window=${window}`;
}
export function exportHref(window: InsightWindow): string {
  return `/logistics/insights/export?window=${window}`;
}

/** W244's "No data yet" / "Not enough history" / ready. The middle one is not an error state and must not read like
 *  one: "keep moving, the picture builds" is a different message from "something is broken". */
export function historyKey(h: LogisticsHistory): string {
  switch (h.kind) {
    case 'no_data':             return 'logistics.history.none';
    case 'not_enough_history':  return 'logistics.history.tooShort';
    default:                    return 'logistics.history.ready';
  }
}
export function historyBlocks(h: LogisticsHistory): boolean { return h.kind !== 'ready'; }

/** A failure slice's name comes from the VOCABULARY the API returned (Law 6), so a tenant's own added reason —
 *  "ferry missed" — is printed as itself rather than as a raw code or, worse, dropped. */
export function reasonName(names: readonly { code: string; name: string }[], code: string): string | null {
  return names.find((n) => n.code === code)?.name ?? null;
}
export function reasonKey(code: string): string { return `logistics.reason.${code}`; }

/** The share of a slice for display, of the CODED events. */
export function shareText(bps: number): string { return `${(bps / 100).toFixed(1)}%`; }

/**
 * The sentence W244 puts under its chart: *"Gate closed leads → the 30-min call-ahead pilot starts Monday on the
 * Rajkot lane; if first-attempt clears 95%, it becomes policy."*
 *
 * Printed only when the API says the top CODED slice is `gate_closed` and the history is not mostly unclassified —
 * a pilot justified by rows that predate the reason column is a decision made on arithmetic nobody performed. When it
 * is not printed, the screen says why rather than going quiet.
 */
export function callAheadKey(i: { callAhead: boolean; failures: LogisticsFailureBreakdown }): string | null {
  if (i.callAhead) return 'logistics.decide.callAhead';
  if (i.failures.total === 0) return null;
  if (i.failures.mostlyUnclassified) return 'logistics.decide.needCodedReasons';
  return null;
}

/** The unclassified slice's own sentence — every attempt recorded before the reason had a column at all. It is a fact
 *  about this platform's history, not about the tenant's operation, and the copy says so. */
export function unclassifiedKey(b: LogisticsFailureBreakdown): string | null {
  if (b.unclassified <= 0) return null;
  return b.mostlyUnclassified ? 'logistics.failures.mostlyUnclassified' : 'logistics.failures.someUnclassified';
}

/** W244's "candidate for fixed daily run" badge, and the honest label on the share it is computed from. */
export function laneCandidateKey(l: LogisticsLane): string | null { return l.candidate ? 'logistics.lane.candidate' : null; }
export function laneBasisKey(basis: 'shipments'): string { void basis; return 'logistics.lane.basisShipments'; }
export function laneName(l: LogisticsLane): string {
  const from = l.fromName ?? l.fromRegionId.slice(0, 8);
  const to = l.toName ?? l.toRegionId.slice(0, 8);
  return `${from} ↔ ${to}`;
}

/**
 * W244's "What the numbers decide" — three items in the canon, of which this platform can support one and a half.
 *
 * The lane candidate is real (counted). The route proposal is real and LINKED (5b's board — a proposal is a row an
 * operator can go and approve). The monsoon tarp standard rests on the transit-loss trend, which nothing measures.
 * Printing all three as decisions would put a quarter-end verdict on a number that does not exist.
 */
export const DECISIONS = ['laneCandidate', 'routeProposal', 'tarpStandard'] as const;
export type Decision = (typeof DECISIONS)[number];
export function decisionKey(d: Decision): string { return `logistics.decide.${d}`; }
export function decisionSupported(d: Decision, i: { hasCandidate: boolean }): boolean {
  if (d === 'laneCandidate') return i.hasCandidate;
  if (d === 'routeProposal') return true;
  return false;   // the tarp standard needs a transit-loss measurement, and there is none
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE EXPORT (W2385 · W2386)                                                                              */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W2385/W2386 promise an async job: *"queued with a position and ETA"*, *"audit-stamped receipt: file name, row
 * count, sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged."*
 *
 * **There is no export producer on this platform.** `data_export_jobs` (0015) is touched by exactly one plane —
 * admin-api's DPDP/offboarding approval flow — no tenant surface enqueues one, and no worker generates a file. So
 * this export is SYNCHRONOUS and BOUNDED: the tiles, the lanes and the failure breakdown of one window, which is
 * kilobytes. The screen says that instead of showing a queue position for a queue that does not exist, and instead of
 * a checksum receipt for a file nothing stamps.
 */
export function exportNoticeKey(): string { return 'logistics.export.synchronous'; }
export function exportFileName(window: InsightWindow, day: string): string {
  return `logistics-insights-${window}d-${day}.csv`;
}

/** The CSV, built here so the console and the screen cannot disagree about a number, and so the same rules are
 *  unit-tested. Money stays in MINOR UNITS with its currency in its own column — a spreadsheet that reads "₹11,840"
 *  cannot be summed, and a float in a CSV is how a rate card acquires a rounding error. */
export function insightsCsv(i: {
  window: number; windowFrom: string; windowTo: string;
  firstAttempt: LogisticsRate; transit: LogisticsTransit;
  failures: LogisticsFailureBreakdown; reasonNames: readonly { code: string; name: string }[];
  lanes: { lanes: readonly LogisticsLane[]; totalShipments: number; basis: 'shipments' };
  freightRecovered: readonly { currencyCode: string; recoveredMinor: string }[];
}): string {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows: string[][] = [];
  rows.push(['section', 'key', 'value', 'unit', 'basis']);
  rows.push(['window', 'days', String(i.window), 'days', `${i.windowFrom}..${i.windowTo}`]);
  rows.push(['delivery', 'first_attempt_bps', i.firstAttempt.kind === 'measured' ? String(i.firstAttempt.bps) : '',
    'bps', i.firstAttempt.kind === 'measured' ? `of ${i.firstAttempt.of} delivered` : 'no_deliveries']);
  rows.push(['delivery', 'median_transit_hours', i.transit.kind === 'measured' ? String(i.transit.medianHours) : '',
    'hours', i.transit.kind === 'measured' ? `of ${i.transit.of} timed` : 'not_measurable']);
  // The refusals travel INTO the export. A spreadsheet that silently omits "on-time delivery" invites somebody to
  // compute it themselves from the wrong columns.
  rows.push(['delivery', 'on_time_pct', '', 'pct', 'not_promised:no_promised_delivery_at']);
  rows.push(['cost', 'cost_per_qtl_km', '', 'currency_minor_per_qtl_km', 'not_computable:no_distance,no_weight,no_charge']);
  rows.push(['loss', 'transit_loss', '', 'currency_minor', 'not_recorded:no_loss_record']);
  for (const r of i.freightRecovered) rows.push(['freight', 'recovered_minor', r.recoveredMinor, r.currencyCode, 'resolved_disputes']);
  for (const s of i.failures.slices) {
    rows.push(['failures', s.code, String(s.events), 'events', `${(s.shareBps / 100).toFixed(1)}% of coded`]);
  }
  if (i.failures.unclassified > 0) {
    rows.push(['failures', 'unclassified', String(i.failures.unclassified), 'events', 'recorded before a coded reason existed']);
  }
  for (const l of i.lanes.lanes) {
    rows.push(['lanes', laneName(l), String(l.shipments), 'shipments', `${(l.shareBps / 100).toFixed(1)}% of ${i.lanes.totalShipments} (${i.lanes.basis})`]);
  }
  void i.reasonNames;   // names are for the screen; the CSV carries codes, which do not change with a language
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}

/* ------------------------------------------------------------------------------------------------------- */
/* STATES AND REFUSALS                                                                                     */
/* ------------------------------------------------------------------------------------------------------- */

/** The same split 5c established: the flag guard throws 404 by design (invisible when disabled, Law 10), a 403 is the
 *  restricted state, anything else is the load error — whose copy carries W225's own promise that riders and 3PLs
 *  keep moving while this view is down (Law 12). */
export type DeskViewState = 'ok' | 'flaggedOff' | 'restricted' | 'error';

export function deskState(code: string | null | undefined, status?: number): DeskViewState {
  if (!code && status === undefined) return 'ok';
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || status === 404) return 'flaggedOff';
  return 'error';
}
export function deskStateKey(s: DeskViewState, screen: 'overview' | 'insights'): string {
  return `logistics.${screen}.state.${s}`;
}

/** W225's "Transit is 45% of our wastage" — the sentence that justifies the desk existing, over a baseline nothing
 *  measures. Named, never printed as a figure. */
export function wastageShareKey(): string { return 'logistics.wastage.noBaseline'; }
