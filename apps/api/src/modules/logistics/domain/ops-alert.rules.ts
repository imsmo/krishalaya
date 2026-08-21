// modules/logistics/domain/ops-alert.rules.ts · PC-55 A6 — PURE alert logic.
// An alert that cries wolf gets muted by the humans who need it, so the rules here are about PRECISION:
// a validated threshold per kind, a deterministic dedupe key, and a severity that means something.
export const ALERT_KINDS = ['cold_chain_breach', 'device_silent', 'maintenance_due'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/**
 * HOW OFTEN THE EVALUATOR RUNS — one number, used by the job that schedules it AND by the screens that describe it.
 *
 * PC-56 TENANT-6d-5. A silence threshold is now expressible in MINUTES, which immediately raises the question the hour
 * version never had to answer: a rule set to two minutes is not checked every two minutes. Rather than cap what a
 * cooperative may ask for (a cap is a decision made for them), the cadence is stated — and stated ONCE, so the number
 * on the BMC monitor cannot drift from the number in `LogisticsModule`'s job factory.
 */
export const ALERT_EVALUATION_INTERVAL_MS = 10 * 60_000;
export const ALERT_EVALUATION_MINUTES = ALERT_EVALUATION_INTERVAL_MS / 60_000;

/** The default silence threshold, in minutes: twelve hours, which is what `{"silentHours": 12}` always meant. */
export const DEFAULT_SILENT_MINUTES = 720;

/**
 * The silence threshold in MINUTES, whichever unit the rule was written in.
 *
 * W170 asks for fifteen minutes and `device_silent` could only hold whole hours — 1..720 — while its evidence query
 * floored the measured gap to hours, so a fifteen-minute silence was `0` and no rule could fire on it. Minutes are the
 * canonical unit now; `silentHours` is still ACCEPTED and converted here, because renaming a key a caller may already
 * be sending is a trust cost with no upside, and because 0165 could only convert the rows that existed when it ran.
 *
 * ONE function knows both units. Two would be two answers to *"when does somebody get called"*.
 */
export function silentMinutesOf(threshold: Record<string, unknown> | null | undefined): number {
  const t = threshold ?? {};
  const mins = t.silentMinutes;
  if (typeof mins === 'number' && Number.isInteger(mins) && mins > 0) return mins;
  const hours = t.silentHours;
  if (typeof hours === 'number' && Number.isInteger(hours) && hours > 0) return hours * 60;
  return DEFAULT_SILENT_MINUTES;
}

/**
 * How a gap reads to a human: `25 min`, `3h 10m`, `2 days`.
 *
 * The old body said *"has not reported for ~0h"* for any silence under an hour — the floor of the measured gap — which
 * is the message a village operator would have received about the fifteen minutes this wave exists for, had the
 * threshold been reachable at all. No float: whole minutes, divided by integer division.
 */
export function silenceText(minutes: number): string {
  const m = Math.max(0, Math.trunc(minutes));
  if (m < 60) return `${m} min`;
  const days = Math.trunc(m / 1440);
  if (days >= 2) return `${days} days`;
  const h = Math.trunc(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/** Per-kind threshold validation. Unknown keys are rejected so a typo can never silently disable a rule. */
export function validateThreshold(kind: AlertKind, t: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  const keys = Object.keys(t);
  const allow = (...names: string[]) => keys.every((k) => names.includes(k));
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  switch (kind) {
    case 'cold_chain_breach':
      if (!allow('windowHours', 'minBreaches', 'subjectType')) return { ok: false, error: 'cold_chain_breach accepts windowHours, minBreaches, subjectType' };
      if (t.windowHours !== undefined && !int(t.windowHours, 1, 168)) return { ok: false, error: 'windowHours must be 1..168' };
      if (t.minBreaches !== undefined && !int(t.minBreaches, 1, 1000)) return { ok: false, error: 'minBreaches must be 1..1000' };
      if (t.subjectType !== undefined && typeof t.subjectType !== 'string') return { ok: false, error: 'subjectType must be a string' };
      return { ok: true };
    case 'device_silent':
      // MINUTES, with the legacy hours key still accepted — but never BOTH: two thresholds on one rule is a rule whose
      // meaning depends on which line of code reads it, and this validator exists to make that impossible.
      if (!allow('silentMinutes', 'silentHours')) return { ok: false, error: 'device_silent accepts silentMinutes (or the legacy silentHours) only' };
      if (t.silentMinutes !== undefined && t.silentHours !== undefined) {
        return { ok: false, error: 'device_silent takes silentMinutes OR silentHours, not both' };
      }
      // 1 minute to 30 days. The floor is ONE minute rather than the evaluator's cadence: a cooperative that wants to
      // know about a two-minute silence is not wrong, they will simply hear about it at the next tick, and the monitor
      // says so (ALERT_EVALUATION_MINUTES) instead of a validator refusing the number they asked for.
      if (t.silentMinutes !== undefined && !int(t.silentMinutes, 1, 43200)) return { ok: false, error: 'silentMinutes must be 1..43200' };
      if (t.silentHours !== undefined && !int(t.silentHours, 1, 720)) return { ok: false, error: 'silentHours must be 1..720' };
      return { ok: true };
    case 'maintenance_due':
      if (!allow('alert')) return { ok: false, error: 'maintenance_due accepts alert only' };
      if (t.alert !== undefined && !['service_due', 'needs_attention', 'any'].includes(String(t.alert))) {
        return { ok: false, error: "alert must be service_due | needs_attention | any" };
      }
      return { ok: true };
    default:
      return { ok: false, error: 'unknown kind' };
  }
}

/** Defaults chosen to be useful on day one without paging anyone at 3am for nothing. */
export function defaultsFor(kind: AlertKind): Record<string, unknown> {
  switch (kind) {
    case 'cold_chain_breach': return { windowHours: 6, minBreaches: 1 };
    case 'device_silent': return { silentMinutes: DEFAULT_SILENT_MINUTES };
    case 'maintenance_due': return { alert: 'any' };
  }
}

/** THE DEDUPE KEY: rule + subject + the cooldown BUCKET the event falls in. Bucketing (rather than storing a
 *  last-fired timestamp and comparing) makes the guard a UNIQUE-index race winner instead of a read-then-write,
 *  so N pods evaluating the same tick can never double-page a human. */
export function dedupeKey(ruleId: string, subjectRef: string | null, atMs: number, cooldownMinutes: number): string {
  const bucket = Math.floor(atMs / (cooldownMinutes * 60_000));
  return `${ruleId}:${subjectRef ?? '-'}:${bucket}`;
}

/** Severity from the evidence, not from the rule's mood: a cold-chain breach on medicine/vaccine cargo is
 *  critical; repeated breaches escalate; a silent device or due service is a warning until it is old. */
export function severityFor(kind: AlertKind, evidence: { breaches?: number; silentMinutes?: number; alert?: string }): AlertSeverity {
  if (kind === 'cold_chain_breach') return (evidence.breaches ?? 0) >= 5 ? 'critical' : 'warning';
  // Two days of silence, in the unit the evidence now arrives in. The threshold is unchanged in meaning: 48 hours.
  if (kind === 'device_silent') return (evidence.silentMinutes ?? 0) >= 48 * 60 ? 'critical' : 'warning';
  return evidence.alert === 'needs_attention' ? 'warning' : 'info';
}

/**
 * WHICH CATALOGUED EVENT CARRIES THIS ALERT — and therefore whether it may wake somebody.
 *
 * PC-56 TENANT-6d-5, and the defect it closes is the quietest in this file's history. `resolveChannels()` suppresses
 * every INTRUSIVE channel (push, sms, whatsapp, ivr) during a recipient's quiet hours unless the event is `critical`,
 * and `ops.alert_fired` is catalogued `important` — one constant for every ops alert ever raised. Severity, meanwhile,
 * lives on the FIRED ALERT. So `severityFor` has been correctly returning `critical` for a tank breaching five times or
 * a sensor silent for two days, and every one of those alerts was suppressed on every phone channel between 21:00 and
 * 06:00 while the screen reported the rule active and the operator as a recipient. Milk warms overnight.
 *
 * The fix is not a bypass — quiet hours are somebody's sleep and a platform that routes around them teaches people to
 * mute it. It is the catalogue telling the truth: a critical alert is a critical event, and a maintenance reminder is
 * not. One function decides, so the outbox type and the priority can never disagree.
 */
export const OPS_ALERT_OUTBOX_TYPE = 'ops.alert_fired';
export const OPS_ALERT_CRITICAL_OUTBOX_TYPE = 'ops.alert_fired_critical';
export function outboxTypeFor(severity: AlertSeverity): string {
  return severity === 'critical' ? OPS_ALERT_CRITICAL_OUTBOX_TYPE : OPS_ALERT_OUTBOX_TYPE;
}

/** Human-facing one-liners (the notification body renders from these; templates hold the layout). */
export function alertTitle(kind: AlertKind): string {
  return kind === 'cold_chain_breach' ? 'Cold-chain breach detected'
    : kind === 'device_silent' ? 'Sensor stopped reporting'
    : 'Equipment maintenance due';
}
