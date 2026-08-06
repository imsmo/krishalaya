// apps/web-admin/src/features/support/policy.ts · the SUPPORT POLICY, console side (PC-56 ADMIN-2b, canon W054 + W057).
//
// WHAT THIS MODULE IS FOR, AND WHAT IT DELIBERATELY IS NOT. It parses the publish form into the exact object the server
// accepts, and it stops there. The FOUR COHERENCE RULES — an SLA with no chain behind it, a step that wakes somebody at
// an hour the desk is shut, targets that tighten as severity falls, an AI allowed to auto-answer a P0 — live in
// admin-api's `domain/support-policy.ts` and are NOT re-implemented here.
//
// That is a decision, not laziness. Two copies of a rule become one copy of the rule and one copy of last quarter's
// rule; the browser copy is the one that silently rots, and it is also the one nobody can trust anyway because a form
// can be bypassed. So the server is the single authority and its 422 message is shown verbatim — the operator reads the
// real reason ("P1 must have MORE first-response time than P0"), not a paraphrase.
//
// What IS checked here is SHAPE: is this a number, is that hour in range, did the operator leave a target blank. Those
// are typing accidents, and catching them without a round trip is a kindness rather than a duplicated rule.

/** The severities the platform accepts, most severe first. Fixed: adding one is a schema change (0097 CHECKs them). */
export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ROUTING_STRATEGIES = ['round_robin', 'least_loaded', 'manual'] as const;
export const AI_MODES = ['off', 'suggest', 'auto_reply'] as const;
export const ESCALATION_CHANNELS = ['email', 'sms', 'whatsapp', 'call', 'in_app', 'pager'] as const;
export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number];

/** Channels that RING A HUMAN as opposed to landing on a board. Mirrored from the server because the form uses it to
 *  warn BEFORE submitting — the warning is advisory; the refusal is the server's. */
const WAKES = new Set<EscalationChannel>(['sms', 'call', 'pager']);
export function wakesSomebody(channel: string): boolean { return WAKES.has(channel as EscalationChannel); }

/** How many blank chain rows the form offers beyond what exists. Three: enough to add a step to a severity without a
 *  page reload, few enough that the form is still readable. */
export const BLANK_STEP_ROWS = 3;

export interface SlaRow { severity: string; firstResponseMinutes: number; resolutionMinutes: number }
export interface ChainStep {
  severity: string; afterMinutes: number; channel: string; targetRole: string; notes?: string | null;
}
export interface PolicyView {
  id: string; version: number; name: string; effectiveFrom: string; isActive: boolean;
  openHourIst: number; closeHourIst: number; afterHoursSeverities: string[];
  routingStrategy: string; deskLanguages: string[];
  aiAssistMode: string; aiExcludedSeverities: string[];
  notes?: string | null;
}
export interface PolicyBundle {
  policy: PolicyView | null;
  slas: SlaRow[];
  escalations: ChainStep[];
  recentEvents: FiredEvent[];
  versions: Array<{ id: string; version: number; name: string; effectiveFrom: string; isActive: boolean; createdAt?: string }>;
  deliveryNote: string;
}
export interface FiredEvent {
  id: string; ticketId: string; ticketNo?: string | null; severity: string;
  afterMinutes: number; channel: string; targetRole: string;
  breachKind: string; breachedAt: string; firedAt: string; status: string; detail?: string | null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Minutes → the shortest honest phrase. Null in, null out: a missing target is not "0m". */
export function humanMinutes(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(Number(m))) return null;
  const n = Math.trunc(Number(m));
  if (n < 60) return `${n}m`;
  if (n % 60 === 0 && n < 1440) return `${n / 60}h`;
  if (n < 1440) return `${Math.floor(n / 60)}h ${n % 60}m`;
  const d = Math.floor(n / 1440); const rem = n % 1440;
  return rem === 0 ? `${d}d` : `${d}d ${Math.floor(rem / 60)}h`;
}

/** "09:00–21:00 IST", or null when there is no policy — the caller must not print a default day. */
export function deskHours(p: Pick<PolicyView, 'openHourIst' | 'closeHourIst'> | null | undefined): string | null {
  if (!p) return null;
  const pad = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${pad(p.openHourIst)}–${pad(p.closeHourIst)} IST`;
}

/** Steps for one severity, in the order they fire. */
export function chainFor(escalations: readonly ChainStep[], severity: string): ChainStep[] {
  return escalations.filter((e) => e.severity === severity).sort((a, b) => a.afterMinutes - b.afterMinutes);
}

/** SEVERITIES WITH A TARGET BUT NO CHAIN — the exact condition this wave existed to remove. Reported rather than
 *  assumed absent, because a policy published before a validator tightened can still be in this state. */
export function severitiesWithoutChain(slas: readonly SlaRow[], escalations: readonly ChainStep[]): string[] {
  const covered = new Set(escalations.map((e) => e.severity));
  return slas.map((s) => s.severity).filter((s) => !covered.has(s));
}

/** Steps that would ring a phone at an hour the same policy calls closed. Advisory on screen; refused by the server. */
export function afterHoursContradictions(
  escalations: readonly ChainStep[], afterHoursSeverities: readonly string[],
): ChainStep[] {
  const night = new Set(afterHoursSeverities);
  return escalations.filter((e) => wakesSomebody(e.channel) && !night.has(e.severity));
}

/** True when nothing in the chain can wake anybody outside desk hours. Not an error — a desk with no night shift is a
 *  legitimate policy — but it must be STATED on screen, because "P0 in 15 minutes" reads like a 24-hour promise. */
export function noNightCover(escalations: readonly ChainStep[], afterHoursSeverities: readonly string[]): boolean {
  if (afterHoursSeverities.length === 0) return true;
  return !escalations.some((e) => wakesSomebody(e.channel) && afterHoursSeverities.includes(e.severity));
}

/** Fired steps that were NOT actually delivered. The console must never let these read as pages that happened. */
export function undeliveredEvents(events: readonly FiredEvent[]): FiredEvent[] {
  return events.filter((e) => e.status === 'provider_pending' || e.status === 'failed');
}

/** Is the matrix internally ordered? Same question the server refuses on, asked here only to render a warning against a
 *  policy that predates the check. */
export function matrixIsCoherent(rows: readonly SlaRow[]): boolean {
  const order = SEVERITIES.filter((s) => rows.some((r) => r.severity === s));
  for (let i = 1; i < order.length; i += 1) {
    const prev = rows.find((r) => r.severity === order[i - 1]);
    const cur = rows.find((r) => r.severity === order[i]);
    if (!prev || !cur) continue;
    if (cur.firstResponseMinutes <= prev.firstResponseMinutes) return false;
    if (cur.resolutionMinutes <= prev.resolutionMinutes) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Writing: the publish form
// ---------------------------------------------------------------------------

export interface PublishPayload {
  name: string; effectiveFrom: string;
  openHourIst: number; closeHourIst: number; afterHoursSeverities: string[];
  routingStrategy: string; deskLanguages: string[];
  aiAssistMode: string; aiExcludedSeverities: string[];
  slas: SlaRow[];
  escalations: Array<{ severity: string; afterMinutes: number; channel: string; targetRole: string; notes?: string }>;
  notes?: string;
}
export type PublishResult =
  | { ok: true; value: PublishPayload }
  | { ok: false; error: string; at?: string };

/** A form is a bag of strings. This is the ONLY place that fact is dealt with. */
export type FormBag = (name: string) => string;
/** Multi-value fields (checkbox groups) need every value, not the first. */
export type FormMulti = (name: string) => string[];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A whole number from a form field, or null. Deliberately strict: "12abc" is a typo, not twelve. */
function intOrNull(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Parse the publish form. SHAPE ONLY — see the header. Errors are keys the page turns into sentences, plus an `at`
 * saying WHICH row was wrong, because "a target is missing" on a form with eight number boxes is not help.
 */
export function buildPolicy(get: FormBag, getAll: FormMulti): PublishResult {
  const name = get('name').trim();
  if (name.length < 3 || name.length > 120) return { ok: false, error: 'name' };

  const effectiveFrom = get('effectiveFrom').trim();
  if (!ISO_DATE.test(effectiveFrom)) return { ok: false, error: 'effectiveFrom' };

  const openHourIst = intOrNull(get('openHourIst'));
  const closeHourIst = intOrNull(get('closeHourIst'));
  if (openHourIst === null || openHourIst > 23) return { ok: false, error: 'openHour' };
  if (closeHourIst === null || closeHourIst < 1 || closeHourIst > 24) return { ok: false, error: 'closeHour' };
  // the one coherence check kept locally, because the DB CHECK would reject it with an opaque constraint name
  if (closeHourIst <= openHourIst) return { ok: false, error: 'hourOrder' };

  const routingStrategy = get('routingStrategy').trim();
  if (!(ROUTING_STRATEGIES as readonly string[]).includes(routingStrategy)) return { ok: false, error: 'routing' };

  const aiAssistMode = get('aiAssistMode').trim();
  if (!(AI_MODES as readonly string[]).includes(aiAssistMode)) return { ok: false, error: 'aiMode' };

  const afterHoursSeverities = getAll('afterHoursSeverities')
    .map((s) => s.trim()).filter((s) => (SEVERITIES as readonly string[]).includes(s));
  const aiExcludedSeverities = getAll('aiExcludedSeverities')
    .map((s) => s.trim()).filter((s) => (SEVERITIES as readonly string[]).includes(s));

  // Languages: a comma list, because the desk's languages are not the platform's registry and typing them is the
  // honest interface until a staffing model exists to pick from.
  const deskLanguages = Array.from(new Set(
    get('deskLanguages').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  ));
  if (deskLanguages.length === 0) return { ok: false, error: 'languages' };
  if (deskLanguages.length > 14) return { ok: false, error: 'tooManyLanguages' };
  const badLang = deskLanguages.find((l) => !/^[a-z]{2}(-[a-z0-9]{2,6})?$/.test(l));
  if (badLang) return { ok: false, error: 'language', at: badLang };

  // SLA targets: one row per severity, all eight boxes required. A blank box cannot default — a target nobody typed is
  // not a promise anybody made.
  const slas: SlaRow[] = [];
  for (const severity of SEVERITIES) {
    const fr = intOrNull(get(`fr_${severity}`));
    const res = intOrNull(get(`res_${severity}`));
    if (fr === null || fr < 1 || fr > 43200) return { ok: false, error: 'target', at: severity };
    if (res === null || res < 1 || res > 43200) return { ok: false, error: 'target', at: severity };
    if (res < fr) return { ok: false, error: 'resBeforeFr', at: severity };
    slas.push({ severity, firstResponseMinutes: fr, resolutionMinutes: res });
  }

  // The chain: indexed rows. A row is SKIPPED when its role is blank — that is how a step is removed, and it is why
  // there is no delete button: the form IS the whole chain, and publishing replaces it wholesale. (Publish-never-edit
  // means the previous version keeps its own steps for ever, so nothing is lost by omitting one here.)
  const escalations: PublishPayload['escalations'] = [];
  const count = intOrNull(get('stepCount')) ?? 0;
  if (count > 60) return { ok: false, error: 'tooManySteps' };
  for (let i = 0; i < count; i += 1) {
    const targetRole = get(`step_${i}_targetRole`).trim();
    const severity = get(`step_${i}_severity`).trim();
    const channel = get(`step_${i}_channel`).trim();
    const afterRaw = get(`step_${i}_afterMinutes`).trim();
    // an entirely blank row is an unused slot, not an error
    if (!targetRole && !afterRaw && !severity) continue;
    if (!targetRole) continue;                                  // cleared role = step removed
    if (!(SEVERITIES as readonly string[]).includes(severity)) return { ok: false, error: 'stepSeverity', at: String(i + 1) };
    if (!(ESCALATION_CHANNELS as readonly string[]).includes(channel)) return { ok: false, error: 'stepChannel', at: String(i + 1) };
    const afterMinutes = intOrNull(afterRaw === '' ? '0' : afterRaw);
    if (afterMinutes === null || afterMinutes > 10080) return { ok: false, error: 'stepAfter', at: String(i + 1) };
    if (targetRole.length < 2 || targetRole.length > 60) return { ok: false, error: 'stepRole', at: String(i + 1) };
    // A ROLE, not a person: caught here as well as on the server, because it is the mistake an operator makes by
    // reflex and the round trip is pure friction.
    if (targetRole.includes('@')) return { ok: false, error: 'stepPerson', at: String(i + 1) };
    const notes = get(`step_${i}_notes`).trim();
    escalations.push({ severity, afterMinutes, channel, targetRole, ...(notes ? { notes } : {}) });
  }
  if (escalations.length === 0) return { ok: false, error: 'noSteps' };

  // Duplicates: the DB has a unique constraint, and a 409 from a form the operator cannot see the conflict in is a
  // dead end. Named here with the row number.
  const seen = new Set<string>();
  for (let i = 0; i < escalations.length; i += 1) {
    const k = `${escalations[i].severity}|${escalations[i].afterMinutes}|${escalations[i].channel}`;
    if (seen.has(k)) return { ok: false, error: 'stepDuplicate', at: String(i + 1) };
    seen.add(k);
  }

  const notes = get('notes').trim();
  return {
    ok: true,
    value: {
      name, effectiveFrom, openHourIst, closeHourIst, afterHoursSeverities,
      routingStrategy, deskLanguages, aiAssistMode, aiExcludedSeverities,
      slas, escalations, ...(notes ? { notes } : {}),
    },
  };
}

/** The rows the publish form renders: every existing step, then blanks. Pre-filling from the ACTIVE version is what
 *  makes "publish a new version" an edit in practice without making it an edit in the data. */
export function formSteps(existing: readonly ChainStep[]): Array<ChainStep | null> {
  const ordered = SEVERITIES.flatMap((s) => chainFor(existing, s));
  return [...ordered, ...Array.from({ length: BLANK_STEP_ROWS }, () => null)];
}
