// modules/logistics/domain/ops-alert.rules.ts · PC-55 A6 — PURE alert logic.
// An alert that cries wolf gets muted by the humans who need it, so the rules here are about PRECISION:
// a validated threshold per kind, a deterministic dedupe key, and a severity that means something.
export const ALERT_KINDS = ['cold_chain_breach', 'device_silent', 'maintenance_due'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

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
      if (!allow('silentHours')) return { ok: false, error: 'device_silent accepts silentHours only' };
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
    case 'device_silent': return { silentHours: 12 };
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
export function severityFor(kind: AlertKind, evidence: { breaches?: number; silentHours?: number; alert?: string }): AlertSeverity {
  if (kind === 'cold_chain_breach') return (evidence.breaches ?? 0) >= 5 ? 'critical' : 'warning';
  if (kind === 'device_silent') return (evidence.silentHours ?? 0) >= 48 ? 'critical' : 'warning';
  return evidence.alert === 'needs_attention' ? 'warning' : 'info';
}

/** Human-facing one-liners (the notification body renders from these; templates hold the layout). */
export function alertTitle(kind: AlertKind): string {
  return kind === 'cold_chain_breach' ? 'Cold-chain breach detected'
    : kind === 'device_silent' ? 'Sensor stopped reporting'
    : 'Equipment maintenance due';
}
