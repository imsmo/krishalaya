// apps/web-tenant/src/features/dairy/bmc.ts · W170 (BMC monitor) view-model — PC-56 TENANT-6d-1.
//
// Pure. Every sentence the monitor can say is a KEY chosen here, and the two judgements that matter most are about
// what NOT to say:
//
//   • a stale sensor is never reported as a temperature. *"Sensors buffer locally; a gap is a connectivity issue, not a
//     temperature unknown"* — so the tile leads with the gap and its age, and the number goes grey;
//   • *"compressor healthy"* is only ever printed when a human said so. `unknown` is the state of a machine nobody has
//     spoken about, and it is the honest one on a screen whose whole job is trust.
import type { DairyBmcMonitor, DairyBmcTile } from '@krishalaya/sdk-js';

export const BMC_HREF = '/dairy/bmc';
/** *"Add BMC"* — W2517–W2520's chain, built in TENANT-6d-4. Declared here so the monitor and its tests cannot disagree
 *  about where the register lives. */
export const BMC_NEW_HREF = '/dairy/bmc/new';
/** *"Call MCC-AND-03 operator"* — W2521–W2523's chain, built in TENANT-6d-5. The unit travels in the query string
 *  because the chain's confirm step must be re-openable after a phone rings, exactly like the form chain's review. */
export const BMC_CALL_HREF = '/dairy/bmc/call';
export function callHref(unitId: string): string {
  return `${BMC_CALL_HREF}?step=confirm&unitId=${encodeURIComponent(unitId)}`;
}
export function bmcHref(unitId?: string | null, hours?: number | null): string {
  const q = new URLSearchParams();
  if (unitId) q.set('unit', unitId);
  if (hours && hours !== 6) q.set('hours', String(hours));
  const s = q.toString();
  return s ? `${BMC_HREF}?${s}` : BMC_HREF;
}

/* --------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

export type BmcViewState = 'ok' | 'flaggedOff' | 'restricted' | 'error';

export function bmcState(code: string | null | undefined, status?: number): BmcViewState {
  if (!code && status === undefined) return 'ok';
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOT_FOUND' || status === 404) return 'flaggedOff';
  return 'error';
}
export function bmcStateKey(s: BmcViewState): string { return `dairy.bmc.state.${s}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE TILE                                                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * What a tile LEADS with. The order is the whole point: a gap outranks a temperature, because a number from forty
 * minutes ago presented as "now" is the one thing that would get a tank of milk thrown away.
 */
export function tileHeadlineKey(t: Pick<DairyBmcTile, 'telemetry' | 'verdict'>): string {
  if (t.telemetry.state === 'never') return 'dairy.bmc.tile.noReadings';
  if (t.telemetry.state === 'stale') return 'dairy.bmc.tile.gap';
  if (t.verdict === 'above_band') return 'dairy.bmc.tile.aboveBand';
  if (t.verdict === 'below_min') return 'dairy.bmc.tile.belowMin';
  return 'dairy.bmc.tile.inRange';
}

/** Amber for a gap (a connectivity problem), red for a real breach, grey when nothing has ever reported. */
export function tileTone(t: Pick<DairyBmcTile, 'telemetry' | 'verdict'>): 'ok' | 'warn' | 'bad' | 'muted' {
  if (t.telemetry.state === 'never') return 'muted';
  if (t.telemetry.state === 'stale') return 'warn';
  if (t.verdict === 'above_band' || t.verdict === 'below_min') return 'bad';
  return 'ok';
}

/** Is this tile's temperature safe to READ as the tank's current state? */
export function tempIsCurrent(t: Pick<DairyBmcTile, 'telemetry' | 'tempC'>): boolean {
  return t.telemetry.state === 'live' && t.tempC !== null;
}

export function compressorKey(t: Pick<DairyBmcTile, 'compressor'>): string {
  return `dairy.bmc.compressor.${t.compressor.state}`;
}
/** `unknown` is grey, not red: nobody has said anything, which is not the same as somebody saying it is bad. */
export function compressorTone(t: Pick<DairyBmcTile, 'compressor'>): 'ok' | 'warn' | 'muted' {
  if (t.compressor.state === 'healthy') return 'ok';
  if (t.compressor.state === 'attention') return 'warn';
  return 'muted';
}

/** *"2,000 L capacity · 41% full"* — and null when the platform has never been told how full the tank is. */
export function fillText(t: Pick<DairyBmcTile, 'fillPct' | 'volumeLitres'>): { pct: number; litres: string } | null {
  return t.fillPct === null || t.volumeLitres === null ? null : { pct: t.fillPct, litres: t.volumeLitres };
}

/** A tank with a sensor reference is watched automatically; one without is read by hand, and the screen says which. */
export function readingSourceKey(t: Pick<DairyBmcTile, 'deviceRef'>): string {
  return t.deviceRef ? 'dairy.bmc.source.sensor' : 'dairy.bmc.source.byHand';
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE PLAYBOOK                                                                                              */
/* --------------------------------------------------------------------------------------------------------- */

export function playbookStepKey(step: string): string { return `dairy.bmc.playbook.${step}`; }

/**
 * Every step is DUE or not, and NONE of them is performed by this platform.
 *
 * W170 calls the card *"Playbook (auto-suggested)"*, and the honest reading of "suggested" is that a human does it: a
 * diversion moves 87 memberships to another centre (TENANT-6d-2's surface) and the union pickup is a phone call. A
 * screen that showed these as actions would be offering buttons that do nothing.
 */
export function playbookNoteKey(): string { return 'dairy.bmc.playbook.humanOnly'; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE QUARTER, AND WHAT IT CANNOT SAY                                                                       */
/* --------------------------------------------------------------------------------------------------------- */

/** `9920` → `"99.2"`. Integer basis points to one decimal, by string: a share printed from a float drifts. */
export function pctOfBp(bp: number): string {
  const neg = bp < 0;
  const abs = Math.abs(bp);
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${Math.floor((abs % 100) / 10)}`;
}

/** *"99.2% time in range"* — refused when there are no readings, because a share of nothing is not 100%. */
export function timeInRangeText(q: DairyBmcMonitor['quarter']): { pct: string; readings: number } | null {
  return q.timeInRangeBp === null ? null : { pct: pctOfBp(q.timeInRangeBp), readings: q.readings };
}

/** W170's *"0 L milk lost to temperature"*: not measurable here, and the tile says so rather than printing a zero. */
export function litresLostKey(): string { return 'dairy.bmc.quarter.litresLostUnknown'; }

/* --------------------------------------------------------------------------------------------------------- */
/* WHO WOULD BE TOLD — the promise this screen is really about                                               */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * *"Alerts fire to the operator's phone before the dairy loses a rupee."*
 *
 * FIVE different truths, and an operator needs to know WHICH one they are living in — the order runs from "nothing can
 * be sent at all" to "the promise is kept":
 *   • the event is not catalogued (a deployment behind migration 0086 — no ops alert can be delivered);
 *   • it is catalogued and the SMS leg cannot render, which is what PC-55 shipped and TENANT-6d-1 fixed: a village
 *     operator's feature phone was the channel that mattered and the only one with no template;
 *   • no rule exists for this tenant (the machinery is fine and nobody has been named);
 *   • rules exist but name nobody;
 *   • rules exist with recipients.
 */
export function alertingKey(a: DairyBmcMonitor['alerting']): string {
  if (!a.eventCatalogued) return 'dairy.bmc.alerting.notCatalogued';
  if (!a.smsDeliverable) return 'dairy.bmc.alerting.noSmsTemplate';
  if (a.breachRules === 0) return 'dairy.bmc.alerting.noRules';
  if (a.recipients === 0) return 'dairy.bmc.alerting.noRecipients';
  return 'dairy.bmc.alerting.ok';
}
export function alertingTone(a: DairyBmcMonitor['alerting']): 'ok' | 'warn' | 'bad' {
  if (!a.eventCatalogued || !a.smsDeliverable) return 'bad';
  if (a.breachRules === 0 || a.recipients === 0) return 'warn';
  return 'ok';
}

/**
 * WHAT ACTUALLY HAPPENS AFTER FIFTEEN MINUTES OF SILENCE — PC-56 TENANT-6d-5.
 *
 * TENANT-6d-1 printed one sentence here: *the threshold cannot be expressed*, because `device_silent` held whole hours
 * and W170's fifteen minutes was unreachable by any rule. That is fixed, and the honest replacement is not a cheerful
 * tick — it is the three things that can still be true and were previously hidden behind the one that was not:
 *
 *   • **no rule watches silence at all.** The screen calls a reading a gap after fifteen minutes and NOBODY is paged,
 *     because paging is a rule a cooperative writes and this platform will not invent one for them (0165 §165.7).
 *   • **the rule's threshold is not the screen's.** Both numbers are legitimate — a gap shown sooner than a phone call
 *     is a reasonable choice — but a cooperative reading *"operator called automatically after 15 min"* off a screen
 *     whose rule says twelve hours is a cooperative that believes something untrue.
 *   • **the threshold is tighter than the evaluator's cadence.** A two-minute rule is checked when the evaluator next
 *     runs, so the call is late by up to that cadence. Said out loud rather than implied by a number.
 *
 * Returns null only when a rule exists, matches the screen's own gap, and is no tighter than the cadence — which is the
 * only state in which the canon's sentence is true as written.
 */
export function silenceGapKey(a: DairyBmcMonitor['alerting'], thresholds: DairyBmcMonitor['thresholds']): string | null {
  if (a.silenceRuleMinutes === null) return 'dairy.bmc.alerting.noSilenceRule';
  if (!a.silenceMatchesGap) return 'dairy.bmc.alerting.silenceRuleDiffers';
  if (a.silenceRuleMinutes < a.evaluationMinutes) return 'dairy.bmc.alerting.silenceUnderCadence';
  void thresholds;
  return null;
}

/**
 * CAN THE ALERT WAKE SOMEBODY — the finding TENANT-6d-5 opened with.
 *
 * A recipient's quiet hours suppress push, SMS and voice unless the CATALOGUE event is `critical`, and every ops alert
 * was catalogued `important`. Two things have to be true for a warm tank at 2am to reach a phone: the critical event has
 * to be catalogued (0165), and its voice leg has to have copy (the seed) — the same two-part question TENANT-6d-1 asked
 * about SMS, for the same reason: a channel with no template is recorded as sent-nowhere.
 */
export function quietHoursKey(a: DairyBmcMonitor['alerting']): string | null {
  if (!a.criticalCatalogued) return 'dairy.bmc.alerting.criticalNotCatalogued';
  if (!a.criticalVoiceDeliverable) return 'dairy.bmc.alerting.criticalNoVoice';
  return null;
}

/**
 * The *"Call MCC-AND-03 operator"* link, or the reason there is not one.
 *
 * Never a button that 404s: the monitor reads the flag (TENANT-6d-2's ruling — a route hidden by a flag answers
 * not-found, which is indistinguishable from a broken screen), and a tank whose centre nobody holds says so on the
 * confirm step rather than here, because that is a fact about custody and this is a fact about the module.
 */
export function callOfferKey(m: Pick<DairyBmcMonitor, 'callEnabled'>): string | null {
  return m.callEnabled ? null : 'dairy.bmc.call.notEnabled';
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE CHART                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * The polyline for the focus tank, as an SVG path over a fixed viewBox — server-rendered, because this console ships
 * no client JS and a chart that needs a bundle is a chart a 2G tablet does not draw.
 *
 * Returns null under two points: a line between one reading and itself is a shape that implies a trend.
 */
export function chartPath(points: Array<{ atMinutesAgo: number; tempC: string }>, box = { w: 600, h: 150 }): { path: string; minC: string; maxC: string } | null {
  if (points.length < 2) return null;
  const deci = points.map((p) => Math.round(Number(p.tempC) * 10));
  const lo = Math.min(...deci);
  const hi = Math.max(...deci);
  // A flat series must not be drawn as a line at the very top of the box: pad a degree either way when it is flat.
  const span = hi - lo === 0 ? 20 : hi - lo;
  const base = hi - lo === 0 ? lo - 10 : lo;
  const oldest = Math.max(...points.map((p) => p.atMinutesAgo));
  const xs = oldest === 0 ? 1 : oldest;
  const path = points
    .map((p, i) => {
      const x = box.w - (p.atMinutesAgo / xs) * box.w;
      const y = box.h - ((deci[i] - base) / span) * box.h;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return { path, minC: (base / 10).toFixed(1), maxC: ((base + span) / 10).toFixed(1) };
}
