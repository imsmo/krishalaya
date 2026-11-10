// apps/web-ops/src/features/ops5/alerts.ts · PC-56 OPS-5a · THE ALERTS — PURE helpers for `/iot/alert-rules` (W402), its REAL change chain
// (W3292–W3294, `?act=`), and `/iot/alert-incident?id=` (W403, a READ of one breach; its chain PARITY-DECOR).
//
// What the desk SEES (founder doors, lead-applied 2026-11-10: Q1-A, Q3-A): each alert rule as it is — its kind and threshold in words, HOW MANY
// people it names (never who), its cooldown, on or paused, when the server last evaluated it, and its last recorded change (when, and whether it
// was you — never a name); its open proposal (which fields, which way, when, proposed by you or not — never the reason); what each rule fired (when,
// how many were told, acknowledged or not); the breach alerts, each linked to its own file. One breach's facts and the server's timeline.
// NOTHING here sums, averages or ranks: a count printed is a number the server sent or the length of a list the server sent (people named, told).
// The ONE arithmetic is a breach's duration in seconds split into minutes and seconds for reading (`durationParts`).
import { ALERT_KINDS, MAINTENANCE_ALERTS, buildThreshold, parseRecipients, REASON_MAX, REASON_MIN, COOLDOWN_MAX, COOLDOWN_MIN, type AlertKind } from '../devices/alerting';
import { SUBJECT_TYPES, uuidParam, type SubjectType } from '../ops4/iot';

export const ALERTS = { rules: '/iot/alert-rules', incident: '/iot/alert-incident' } as const;
/** next.config.js `redirects()` mirrors these as REAL 307s (permanent: false); pinned equal by test/ops5a-pages.spec.ts. The OW-7 pages, their
 *  server actions (including "Run the rules now" — E6) and their `iot.` keys are deleted. */
export const OPS5A_REDIRECTS: ReadonlyArray<{ source: string; destination: string }> = [
  { source: '/devices/rules', destination: ALERTS.rules },
  { source: '/devices/alerts', destination: ALERTS.rules },
];
export { uuidParam };

/** W403's address for one breach (the edges the canon never drew: W400's last breach, W401's breaches, W402's breach alerts). */
export function incidentHref(breachId: string): string { return `${ALERTS.incident}?id=${encodeURIComponent(breachId)}`; }

// ══ W402 · the rules as the server sends them ══
export interface RuleChangeField { field: string; direction: string }
export interface RuleRow {
  id: string; kind: string; ruleName: string; threshold: Record<string, unknown>; recipientCount: number; cooldownMinutes: number | null;
  isActive: boolean; lastEvaluatedAt: string | null;
  lastChange: { action: 'created' | 'updated' | 'change_confirmed' | 'unknown'; at: string | null; byYou: boolean } | null;
  openChange: { id: string; proposedAt: string | null; proposedByYou: boolean; changes: RuleChangeField[] } | null;
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const LAST_ACTIONS = new Set(['created', 'updated', 'change_confirmed']);
export const CHANGE_FIELDS = ['isActive', 'recipientsRemoved', 'recipientsAdded', 'cooldownMinutes', 'minBreaches', 'windowHours', 'subjectType', 'silentMinutes', 'alert', 'ruleName', 'channelHint'] as const;
export const DIRECTIONS = ['quieter', 'louder', 'neutral'] as const;
/**
 * The server's rule row, narrowed to what the page may print. The recipients become a COUNT here, and the person ids (recipients, author,
 * proposer, confirmer) are dropped — they never reach the view (survey E15). The proposal's free-text reason is dropped too.
 */
export function asRules(raw: unknown): RuleRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x: Record<string, unknown>) => {
    const id = uuidParam(str(x?.id) ?? undefined);
    if (!id) return [];
    const oc = x.openChange as Record<string, unknown> | null | undefined;
    const lc = x.lastChange as Record<string, unknown> | null | undefined;
    const changes = Array.isArray(oc?.changes) ? (oc?.changes as Array<Record<string, unknown>>)
      .filter((c) => (CHANGE_FIELDS as readonly string[]).includes(String(c?.field)) && (DIRECTIONS as readonly string[]).includes(String(c?.direction)))
      .map((c) => ({ field: String(c.field), direction: String(c.direction) })) : [];
    return [{
      id, kind: String(x.kind ?? ''), ruleName: String(x.ruleName ?? ''),
      threshold: x.threshold && typeof x.threshold === 'object' ? (x.threshold as Record<string, unknown>) : {},
      recipientCount: Array.isArray(x.recipientUserIds) ? x.recipientUserIds.length : 0,
      cooldownMinutes: typeof x.cooldownMinutes === 'number' ? x.cooldownMinutes : null,
      isActive: x.isActive !== false, lastEvaluatedAt: str(x.lastEvaluatedAt),
      lastChange: lc ? { action: (LAST_ACTIONS.has(String(lc.action)) ? String(lc.action) : 'unknown') as NonNullable<RuleRow['lastChange']>['action'], at: str(lc.at), byYou: lc.byYou === true } : null,
      openChange: oc && uuidParam(str(oc.id) ?? undefined)
        ? { id: String(oc.id), proposedAt: str(oc.proposedAt), proposedByYou: oc.proposedByYou === true, changes } : null,
    }];
  });
}

/** A rule's kind in words (the server's three kinds); anything else is said to be unknown. */
export function kindKey(kind: unknown): string {
  return (ALERT_KINDS as readonly string[]).includes(String(kind)) ? `ops5.alerts.kind.${String(kind)}` : 'ops5.alerts.kind.unknown';
}
const posInt = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null);
/**
 * A rule's threshold IN WORDS, as the server applies it (`ops-alert.service.ts` evidenceFor): the breach rule counts out-of-band readings of
 * EITHER source in its window (defaults 6 hours, 1 reading); the silence rule judges a registered logger's last SIGNED reading (minutes, or the
 * older hours key as written — never converted here); the maintenance rule a breakdown, a service due by the organisation's day, or either.
 * A subject filter the server does not know (it is typed) is said to be set, never printed.
 */
export function thresholdWords(kind: unknown, th: Record<string, unknown>): { key: string; vars: Record<string, string | number> } {
  if (kind === 'cold_chain_breach') {
    const n = posInt(th.minBreaches) ?? 1; const h = posInt(th.windowHours) ?? 6;
    const st = th.subjectType;
    if (st === undefined || st === null || st === '') return { key: 'ops5.alerts.th.breach', vars: { n, h } };
    return (SUBJECT_TYPES as readonly string[]).includes(String(st))
      ? { key: 'ops5.alerts.th.breachOnly', vars: { n, h, type: `ops4.iot.type.${String(st)}` } }
      : { key: 'ops5.alerts.th.breachFiltered', vars: { n, h } };
  }
  if (kind === 'device_silent') {
    const m = posInt(th.silentMinutes);
    if (m !== null) return { key: 'ops5.alerts.th.silentMinutes', vars: { m } };
    const hrs = posInt(th.silentHours);
    return hrs !== null ? { key: 'ops5.alerts.th.silentHours', vars: { h: hrs } } : { key: 'ops5.alerts.th.unknown', vars: {} };
  }
  if (kind === 'maintenance_due') {
    const a = th.alert === undefined ? 'any' : String(th.alert);
    return (MAINTENANCE_ALERTS as readonly string[]).includes(a) ? { key: `ops5.alerts.th.maintenance.${a}`, vars: {} } : { key: 'ops5.alerts.th.unknown', vars: {} };
  }
  return { key: 'ops5.alerts.th.unknown', vars: {} };
}

/** True when no ACTIVE breach rule exists — then, by 0201's own SQL, a breach is told to nobody but a shipment's driver (`no_recipient` otherwise). */
export function noActiveBreachRule(rules: readonly RuleRow[]): boolean {
  return !rules.some((r) => r.kind === 'cold_chain_breach' && r.isActive && r.recipientCount > 0);
}

// ══ W402 · what was fired ══
export interface FiredRow { id: string; ruleId: string | null; kind: string; severity: string; firedAt: string | null; told: number; acknowledgedAt: string | null; breachId: string | null }
/** The feed narrowed: the count of people told (never who), no subject label, no acknowledging person, the breach's id for its own file. */
export function asFired(raw: unknown): FiredRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x: Record<string, unknown>) => {
    const id = uuidParam(str(x?.id) ?? undefined);
    if (!id) return [];
    const detail = x.detail && typeof x.detail === 'object' ? (x.detail as Record<string, unknown>) : {};
    return [{ id, ruleId: uuidParam(str(x.ruleId) ?? undefined), kind: String(x.kind ?? ''), severity: String(x.severity ?? ''), firedAt: str(x.firedAt),
      told: Array.isArray(x.recipients) ? x.recipients.length : 0, acknowledgedAt: str(x.acknowledgedAt), breachId: uuidParam(str(detail.breachId) ?? undefined) }];
  });
}
/** The fired rows of ONE rule, in the server's order (newest first) — a filter, never a count. */
export function firedFor(rows: readonly FiredRow[], ruleId: string): FiredRow[] { return rows.filter((r) => r.ruleId === ruleId); }
/** The breaches' own alerts (rule_id NULL, kind cold_chain_breach, a breach id) — each links to W403. */
export function breachAlerts(rows: readonly FiredRow[]): FiredRow[] { return rows.filter((r) => r.ruleId === null && r.kind === 'cold_chain_breach' && r.breachId !== null); }
/** The silences' own alerts (rule_id NULL, kind device_silent) — told on W404. */
export function silenceAlerts(rows: readonly FiredRow[]): FiredRow[] { return rows.filter((r) => r.ruleId === null && r.kind === 'device_silent'); }
export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export function severityKey(s: unknown): string { return (SEVERITIES as readonly string[]).includes(String(s)) ? `ops5.alerts.severity.${String(s)}` : 'ops5.alerts.severity.unknown'; }

// ══ W402's REAL change chain (W3292–W3294, `?act=`) ══
/** The named refusals the change act answers with (the API's codes, in this page's words). Anything else is the act's plain failure. */
export const CHANGE_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  ALERT_RULE_CONFIRMER_IS_PROPOSER: 'confirmerIsProposer', ALERT_RULE_CHANGE_ALREADY_OPEN: 'changeAlreadyOpen', ALERT_RULE_CHANGE_NOT_OPEN: 'changeNotOpen',
  ALERT_RULE_CHANGED_SINCE_PROPOSAL: 'changedSinceProposal', ALERT_RULE_WITHDRAW_NOT_PROPOSER: 'withdrawNotProposer', ALERT_RECIPIENT_NOT_MEMBER: 'recipientNotMember',
  REASON_REQUIRED: 'reasonRequired', ALERT_RULE_CHANGE_NOT_FOUND: 'changeNotFound',
});
export const FAILURES = ['confirmerIsProposer', 'changeAlreadyOpen', 'changeNotOpen', 'changedSinceProposal', 'withdrawNotProposer', 'recipientNotMember', 'reasonRequired',
  'changeNotFound', 'forbidden', 'notFound', 'refused', 'form', 'save'] as const;
export type ChangeFailure = (typeof FAILURES)[number];
/** The API's answer to a failed act, by name (status, code) — never a guess. */
export function changeFailure(status: number | null, code: string | null): ChangeFailure {
  if (code && CHANGE_REFUSALS[code]) return CHANGE_REFUSALS[code] as ChangeFailure;
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 400 || status === 409 || status === 422) return 'refused';
  return 'save';
}
export function parseFailure(v: unknown): ChangeFailure {
  const s = Array.isArray(v) ? v[0] : v;
  return (FAILURES as readonly string[]).includes(String(s)) ? (s as ChangeFailure) : 'save';
}
/** What the act did, as the SERVER said (the 202 `proposed` / 200 `applied` of an edit; a create; a confirmation; a withdrawal). */
export const DONE = ['proposed', 'applied', 'created', 'confirmed', 'withdrawn'] as const;
export type ChangeDone = (typeof DONE)[number];
export function parseDone(v: unknown): ChangeDone | null {
  const s = Array.isArray(v) ? v[0] : v;
  return (DONE as readonly string[]).includes(String(s)) ? (s as ChangeDone) : null;
}

const one = (v: unknown): string => { const s = Array.isArray(v) ? v[0] : v; return typeof s === 'string' ? s : ''; };
/** A change to ONE rule as the form posts it. Recipients are typed as ids to ADD or REMOVE — the page never prints the ids the rule holds. */
export interface ChangeDraft { isActive: '' | 'pause' | 'resume'; ruleName: string; cooldownMinutes: string; add: string; remove: string; windowHours: string; minBreaches: string;
  subjectType: string; silentHours: string; maintenanceAlert: string; reason: string }
export function changeDraft(f: (k: string) => unknown): ChangeDraft {
  const ia = one(f('isActive'));
  return { isActive: ia === 'pause' || ia === 'resume' ? ia : '', ruleName: one(f('ruleName')).trim(), cooldownMinutes: one(f('cooldownMinutes')).trim(), add: one(f('add')),
    remove: one(f('remove')), windowHours: one(f('windowHours')).trim(), minBreaches: one(f('minBreaches')).trim(), subjectType: one(f('subjectType')).trim(),
    silentHours: one(f('silentHours')).trim(), maintenanceAlert: one(f('maintenanceAlert')).trim(), reason: one(f('reason')).trim() };
}
export type ChangeFormError = 'empty' | 'name' | 'cooldown' | 'recipients' | 'recipientId' | 'tooManyRecipients' | 'lastRecipient' | 'reason' | `threshold_${string}`;
/**
 * The PATCH body for one rule, from the form and the rule's CURRENT state (read by the server action, never sent to the browser): the people
 * after = the current people, plus those added, minus those removed; the threshold = the current one with only the filled keys replaced. The
 * SERVER decides whether it applies at once (louder) or becomes a proposal (anything that could make an alert quieter) — never guessed here.
 */
export function buildChange(kind: AlertKind, current: { recipientUserIds: readonly string[]; threshold: Record<string, unknown> }, d: ChangeDraft):
  { ok: true; value: Record<string, unknown> } | { ok: false; error: ChangeFormError } {
  const out: Record<string, unknown> = {};
  if (d.isActive) out.isActive = d.isActive === 'resume';
  if (d.ruleName) { if (d.ruleName.length < 3 || d.ruleName.length > 150) return { ok: false, error: 'name' }; out.ruleName = d.ruleName; }
  if (d.cooldownMinutes) {
    if (!/^\d{1,5}$/.test(d.cooldownMinutes)) return { ok: false, error: 'cooldown' };
    const n = Number.parseInt(d.cooldownMinutes, 10);
    if (n < COOLDOWN_MIN || n > COOLDOWN_MAX) return { ok: false, error: 'cooldown' };
    out.cooldownMinutes = n;
  }
  const add = d.add.trim() ? parseRecipients(d.add) : { ok: true as const, value: [] as string[] };
  if (!add.ok) return { ok: false, error: add.error };
  const remove = d.remove.trim() ? parseRecipients(d.remove) : { ok: true as const, value: [] as string[] };
  if (!remove.ok) return { ok: false, error: remove.error };
  if (add.value.length || remove.value.length) {
    const next = [...new Set([...current.recipientUserIds, ...add.value])].filter((u) => !remove.value.includes(u));
    if (next.length === 0) return { ok: false, error: 'lastRecipient' };
    out.recipientUserIds = next;
  }
  const filled = d.windowHours || d.minBreaches || d.subjectType || d.silentHours || d.maintenanceAlert;
  if (filled) {
    const th = buildThreshold(kind, { windowHours: d.windowHours, minBreaches: d.minBreaches, subjectType: d.subjectType, silentHours: d.silentHours, maintenanceAlert: d.maintenanceAlert });
    if (!th.ok) return { ok: false, error: `threshold_${th.error}` };
    out.threshold = kind === 'cold_chain_breach' ? { ...current.threshold, ...th.value } : th.value;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'empty' };
  if (d.reason.length < REASON_MIN || d.reason.length > REASON_MAX) return { ok: false, error: 'reason' };
  out.reason = d.reason;
  return { ok: true, value: out };
}
export const FORM_ERRORS = ['empty', 'name', 'cooldown', 'recipients', 'recipientId', 'tooManyRecipients', 'lastRecipient', 'reason', 'kind',
  'threshold_windowHours', 'threshold_minBreaches', 'threshold_subjectType', 'threshold_silentHours', 'threshold_maintenanceAlert'] as const;
export function parseFormError(v: unknown): (typeof FORM_ERRORS)[number] | null {
  const s = Array.isArray(v) ? v[0] : v;
  return (FORM_ERRORS as readonly string[]).includes(String(s)) ? (s as (typeof FORM_ERRORS)[number]) : null;
}
/** An Idempotency-Key minted when the form is shown (a double submit replays the same answer — the OPS-4b shape). */
export function keyParam(v: unknown): string | null { return uuidParam(one(v) || undefined); }

// ══ W403 · one breach ══
export const OUTCOMES = ['accepted', 'accepted_with_test', 'rejected', 'loss_recorded', 'none'] as const;
export const DECISIONS = ['accept', 'accept_with_test', 'reject'] as const;
export function outcomeKey(o: unknown): string { return (OUTCOMES as readonly string[]).includes(String(o)) ? `ops5.incident.outcome.${String(o)}` : 'ops5.incident.outcome.unknown'; }
export function decisionKey(d: unknown): string { return (DECISIONS as readonly string[]).includes(String(d)) ? `ops5.incident.decision.${String(d)}` : 'ops5.incident.decision.unknown'; }
/** A breach's duration as the server recorded it (whole seconds), split for reading — the one arithmetic of OPS-5a. */
export function durationParts(seconds: unknown): { min: number; sec: number } | null {
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0) return null;
  return { min: Math.floor(seconds / 60), sec: seconds % 60 };
}
/** The server's timeline of one breach: each step it recorded, with its time, in time order (the server's ISO-8601 UTC strings compare as text — no clock
 *  arithmetic; a tie keeps the steps' natural order). A step with no time is not shown. */
export type TimelineStep = 'firstOut' | 'opened' | 'acknowledged' | 'action' | 'buyerOffered' | 'buyerDecided' | 'backInRange' | 'outcome';
export function timeline(b: { firstOutAt?: string | null; openedAt?: string | null; acknowledgedAt?: string | null; actionAt?: string | null; closedAt?: string | null; outcomeAt?: string | null;
  buyer?: { offeredAt?: string | null; decidedAt?: string | null } | null }): Array<{ step: TimelineStep; at: string }> {
  const steps: Array<[TimelineStep, string | null | undefined]> = [
    ['firstOut', b.firstOutAt], ['opened', b.openedAt], ['acknowledged', b.acknowledgedAt], ['action', b.actionAt],
    ['buyerOffered', b.buyer?.offeredAt], ['buyerDecided', b.buyer?.decidedAt], ['backInRange', b.closedAt], ['outcome', b.outcomeAt],
  ];
  return steps.filter((s): s is [TimelineStep, string] => typeof s[1] === 'string').map(([step, at], i) => ({ step, at, i }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i)).map(({ step, at }) => ({ step, at }));
}
/** A loss as the server recorded it: a minor-unit string and its OWN currency (never a default). */
export function lossOf(loss: unknown): { minor: string; currency: string } | null {
  const l = loss as { minor?: unknown; currency?: unknown } | null;
  return l && typeof l.minor === 'string' && /^\d{1,15}$/.test(l.minor) && typeof l.currency === 'string' && /^[A-Z]{3}$/.test(l.currency) ? { minor: l.minor, currency: l.currency } : null;
}
export type IncidentType = SubjectType;
