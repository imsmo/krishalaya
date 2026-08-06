// apps/web-ops/src/features/devices/alerting.ts · PURE rules for OW-7 (PC-55 B4). Framework-free, and a faithful
// MIRROR of the server's own alert logic (modules/logistics/domain/ops-alert.rules.ts, PC-55 A6). The API remains
// authoritative; mirroring exists so a typo in a threshold is refused at the keystroke instead of after a round trip.
//
// THE ONE IDEA BEHIND ALL OF IT: an alert that cries wolf gets muted by the humans who need it. Every rule below
// serves precision — a validated threshold per kind, no unknown keys, and a cooldown that is a real number of
// minutes rather than a vague "don't spam me".
//
// TWO THINGS THIS CONSOLE MUST NOT PRETEND:
//   1. THE FLEET IS NOT A REGISTRY. `GET cold-chain/devices` derives the fleet from LEDGERED READINGS over the last
//      30 days — a device that never reported does not appear, because the platform has no evidence it exists. So
//      "3 devices" means "3 devices we have heard from", and the page says exactly that instead of implying an
//      inventory nobody maintains.
//   2. A CHANNEL HINT IS NOT A DELIVERY GUARANTEE. Firing rides the existing notification spine, where each
//      recipient's own preferences and QUIET HOURS still apply. `channelHint` is a preference; it can never
//      bypass a person's night. The rule form says so.

export const ALERT_KINDS = ['cold_chain_breach', 'device_silent', 'maintenance_due'] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export const CHANNEL_HINTS = ['push', 'sms', 'whatsapp', 'email', 'inapp'] as const;
export type ChannelHint = (typeof CHANNEL_HINTS)[number];
export const MAINTENANCE_ALERTS = ['service_due', 'needs_attention', 'any'] as const;

export const COOLDOWN_MIN = 5;
export const COOLDOWN_MAX = 10080;   // one week, matching the API's own bound
export const MAX_RECIPIENTS = 50;

export function isAlertKind(v: string | undefined | null): v is AlertKind {
  return !!v && (ALERT_KINDS as readonly string[]).includes(v);
}
export function isAlertSeverity(v: string | undefined | null): v is AlertSeverity {
  return !!v && (ALERT_SEVERITIES as readonly string[]).includes(v);
}
export function isChannelHint(v: string | undefined | null): v is ChannelHint {
  return !!v && (CHANNEL_HINTS as readonly string[]).includes(v);
}

/** The threshold keys each kind accepts — mirrored from validateThreshold so the FORM can only offer real ones. */
export const THRESHOLD_KEYS: Readonly<Record<AlertKind, readonly string[]>> = Object.freeze({
  cold_chain_breach: ['windowHours', 'minBreaches', 'subjectType'],
  device_silent: ['silentHours'],
  maintenance_due: ['alert'],
});

/** The API's own day-one defaults (useful without paging anyone at 3am for nothing). */
export function defaultsFor(kind: AlertKind): Record<string, unknown> {
  if (kind === 'cold_chain_breach') return { windowHours: 6, minBreaches: 1 };
  if (kind === 'device_silent') return { silentHours: 12 };
  return { alert: 'any' };
}

export type ThresholdResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** Build + validate a threshold from the form, per kind. Empty fields fall back to the API's defaults rather than
 *  being sent as nulls, so a half-filled form produces a WORKING rule instead of a silently disabled one. */
export function buildThreshold(kind: AlertKind, raw: { windowHours: string; minBreaches: string; subjectType: string; silentHours: string; maintenanceAlert: string }): ThresholdResult {
  const intIn = (s: string, lo: number, hi: number): number | null => {
    const t = s.trim();
    if (!/^\d{1,4}$/.test(t)) return null;           // digits only — '6.5' hours is refused, never truncated
    const n = Number.parseInt(t, 10);
    return n >= lo && n <= hi ? n : null;
  };

  if (kind === 'cold_chain_breach') {
    const out: Record<string, unknown> = {};
    if (raw.windowHours.trim()) {
      const n = intIn(raw.windowHours, 1, 168);
      if (n === null) return { ok: false, error: 'windowHours' };
      out.windowHours = n;
    }
    if (raw.minBreaches.trim()) {
      const n = intIn(raw.minBreaches, 1, 1000);
      if (n === null) return { ok: false, error: 'minBreaches' };
      out.minBreaches = n;
    }
    const subjectType = raw.subjectType.trim();
    if (subjectType) {
      if (subjectType.length > 30) return { ok: false, error: 'subjectType' };
      out.subjectType = subjectType;
    }
    return { ok: true, value: Object.keys(out).length ? out : defaultsFor(kind) };
  }

  if (kind === 'device_silent') {
    if (!raw.silentHours.trim()) return { ok: true, value: defaultsFor(kind) };
    const n = intIn(raw.silentHours, 1, 720);
    if (n === null) return { ok: false, error: 'silentHours' };
    return { ok: true, value: { silentHours: n } };
  }

  const alert = raw.maintenanceAlert.trim();
  if (!alert) return { ok: true, value: defaultsFor(kind) };
  if (!(MAINTENANCE_ALERTS as readonly string[]).includes(alert)) return { ok: false, error: 'maintenanceAlert' };
  return { ok: true, value: { alert } };
}

export interface AlertRuleInput {
  kind: AlertKind; ruleName: string; threshold: Record<string, unknown>;
  recipientUserIds: string[]; channelHint?: ChannelHint; cooldownMinutes?: number;
}
export type RuleFormError = 'kind' | 'name' | 'recipients' | 'recipientId' | 'tooManyRecipients' | 'cooldown' | 'channel' | `threshold_${string}`;
export type RuleFormResult = { ok: true; value: AlertRuleInput } | { ok: false; error: RuleFormError };

const UUID = /^[0-9a-fA-F-]{36}$/;

/** Parse the recipients box: one id per line or comma-separated. Duplicates are collapsed (paging the same person
 *  twice for one event is exactly how an alert channel earns being muted). */
export function parseRecipients(raw: string): { ok: true; value: string[] } | { ok: false; error: 'recipients' | 'recipientId' | 'tooManyRecipients' } {
  const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: 'recipients' };
  for (const p of parts) if (!UUID.test(p)) return { ok: false, error: 'recipientId' };
  const uniq = [...new Set(parts)];
  if (uniq.length > MAX_RECIPIENTS) return { ok: false, error: 'tooManyRecipients' };
  return { ok: true, value: uniq };
}

export function buildAlertRule(raw: {
  kind: string; ruleName: string; recipients: string; channelHint: string; cooldownMinutes: string;
  windowHours: string; minBreaches: string; subjectType: string; silentHours: string; maintenanceAlert: string;
}): RuleFormResult {
  if (!isAlertKind(raw.kind)) return { ok: false, error: 'kind' };
  const ruleName = raw.ruleName.trim();
  if (ruleName.length < 3 || ruleName.length > 150) return { ok: false, error: 'name' };

  const recipients = parseRecipients(raw.recipients);
  if (!recipients.ok) return { ok: false, error: recipients.error };

  const threshold = buildThreshold(raw.kind, raw);
  if (!threshold.ok) return { ok: false, error: `threshold_${threshold.error}` as RuleFormError };

  const value: AlertRuleInput = { kind: raw.kind, ruleName, threshold: threshold.value, recipientUserIds: recipients.value };

  const channel = raw.channelHint.trim();
  if (channel) {
    if (!isChannelHint(channel)) return { ok: false, error: 'channel' };
    value.channelHint = channel;
  }
  const cooldown = raw.cooldownMinutes.trim();
  if (cooldown) {
    if (!/^\d{1,5}$/.test(cooldown)) return { ok: false, error: 'cooldown' };
    const n = Number.parseInt(cooldown, 10);
    if (n < COOLDOWN_MIN || n > COOLDOWN_MAX) return { ok: false, error: 'cooldown' };
    value.cooldownMinutes = n;
  }
  return { ok: true, value };
}

export type RulePatchResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: RuleFormError | 'empty' };

/** A PATCH must carry at least one real change (the API refuses an empty body), and every field it does carry is
 *  validated by the same rules as creation — an edit is not a back door around them. */
export function buildRulePatch(raw: { isActive?: string; cooldownMinutes?: string; ruleName?: string; recipients?: string }): RulePatchResult {
  const out: Record<string, unknown> = {};
  if (raw.isActive === '1' || raw.isActive === '0') out.isActive = raw.isActive === '1';
  const name = (raw.ruleName ?? '').trim();
  if (name) {
    if (name.length < 3 || name.length > 150) return { ok: false, error: 'name' };
    out.ruleName = name;
  }
  const cooldown = (raw.cooldownMinutes ?? '').trim();
  if (cooldown) {
    if (!/^\d{1,5}$/.test(cooldown)) return { ok: false, error: 'cooldown' };
    const n = Number.parseInt(cooldown, 10);
    if (n < COOLDOWN_MIN || n > COOLDOWN_MAX) return { ok: false, error: 'cooldown' };
    out.cooldownMinutes = n;
  }
  const recipients = (raw.recipients ?? '').trim();
  if (recipients) {
    const parsed = parseRecipients(recipients);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    out.recipientUserIds = parsed.value;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'empty' };
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Reading the fleet honestly
// ---------------------------------------------------------------------------
export interface DeviceRow { deviceRef?: string; lastSeen?: string | null; readings24h?: number | null; breaches24h?: number | null; lastTempC?: string | null }

export function hoursSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 3_600_000));
}

/** What a device's own readings say about it. Ordered so the WORST truth wins: a sensor that has gone quiet is
 *  reported as silent even if its last readings were breaching, because a silent sensor means we no longer know
 *  what the cargo is doing — which is the more dangerous ignorance.
 *  `silentAfterHours` defaults to 12, matching the API's own device_silent default; it is a parameter so a console
 *  view can align with whatever threshold the tenant's rule actually uses instead of guessing. */
export function deviceHealth(d: DeviceRow, nowMs: number, silentAfterHours = 12): 'silent' | 'breaching' | 'ok' | 'unknown' {
  const age = hoursSince(d.lastSeen, nowMs);
  if (age === null) return 'unknown';
  if (age >= silentAfterHours) return 'silent';
  if ((d.breaches24h ?? 0) > 0) return 'breaching';
  return 'ok';
}

/** Fleet counters for the page header — derived from the rows on screen, and labelled as such (this is a 30-day
 *  reporting window, not an equipment inventory). */
export function fleetSummary(rows: readonly DeviceRow[], nowMs: number, silentAfterHours = 12): { total: number; silent: number; breaching: number; ok: number } {
  let silent = 0, breaching = 0, ok = 0;
  for (const d of rows) {
    const h = deviceHealth(d, nowMs, silentAfterHours);
    if (h === 'silent' || h === 'unknown') silent += 1;
    else if (h === 'breaching') breaching += 1;
    else ok += 1;
  }
  return { total: rows.length, silent, breaching, ok };
}

export interface FiredAlertRow { id?: string; kind?: string | null; severity?: string | null; acknowledgedAt?: string | null; firedAt?: string | null; subjectRef?: string | null; title?: string | null; evidence?: Record<string, unknown> | null }

/** An alert needs acknowledging only while nobody has. Mirrors the API, which refuses a second acknowledge. */
export function needsAck(a: FiredAlertRow): boolean { return !a.acknowledgedAt; }

/** Sort for the feed: unacknowledged first, then critical before warning before info, then newest. A human opening
 *  this page should find the thing that is still on fire at the top without filtering. */
export function feedOrder(a: FiredAlertRow, b: FiredAlertRow): number {
  const ack = Number(!needsAck(a)) - Number(!needsAck(b));
  if (ack !== 0) return ack;
  const rank = (s: string | null | undefined) => (s === 'critical' ? 0 : s === 'warning' ? 1 : 2);
  const sev = rank(a.severity) - rank(b.severity);
  if (sev !== 0) return sev;
  return String(b.firedAt ?? '').localeCompare(String(a.firedAt ?? ''));
}
