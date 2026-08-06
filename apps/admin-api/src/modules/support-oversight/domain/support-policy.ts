// apps/admin-api/src/modules/support-oversight/domain/support-policy.ts · pure rules for the SUPPORT POLICY
// (PC-56 ADMIN-2b, closes ADMIN-2-Q2 + ADMIN-2-Q4; tables in migration 0097). No I/O → unit-provable.
//
// ONE OBJECT, NOT FOUR SCREENS. The canon separates the escalation matrix (W054) from support settings (W057), but
// "we answer P0 in 15 minutes, we page the support head at breach, we are open 09:00–21:00, and after hours only P0
// wakes anyone" is a SINGLE operating promise. Validating it as one object is what makes contradictions impossible —
// and the contradictions are the whole risk here: a chain that pages someone at 03:00 while the hours say the desk is
// shut, or an AI allowed to auto-answer a severity the desk itself treats as human-only.
import { InvalidSupportPolicyError } from './support-oversight.errors';
import { SEVERITIES, type Severity } from './sla';

export const ROUTING_STRATEGIES = ['round_robin', 'least_loaded', 'manual'] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export const AI_MODES = ['off', 'suggest', 'auto_reply'] as const;
export type AiMode = (typeof AI_MODES)[number];

export const ESCALATION_CHANNELS = ['email', 'sms', 'whatsapp', 'call', 'in_app', 'pager'] as const;
export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number];

/** Channels that WAKE A PERSON. The distinction matters for the after-hours check below: an in-app signal on a board
 *  nobody is looking at is not a page, and treating it as one would let a policy claim night cover it does not have. */
const WAKES_SOMEBODY: ReadonlySet<EscalationChannel> = new Set<EscalationChannel>(['call', 'sms', 'pager']);
export function wakesSomebody(channel: string): boolean {
  return WAKES_SOMEBODY.has(channel as EscalationChannel);
}

export interface SlaInput { severity: string; firstResponseMinutes: number; resolutionMinutes: number }
export interface EscalationInput { severity: string; afterMinutes: number; channel: string; targetRole: string; notes?: string }

export interface PolicyInput {
  name: string;
  effectiveFrom: string;
  openHourIst: number;
  closeHourIst: number;
  afterHoursSeverities: string[];
  routingStrategy: string;
  deskLanguages: string[];
  aiAssistMode: string;
  aiExcludedSeverities: string[];
  slas: SlaInput[];
  escalations: EscalationInput[];
  notes?: string;
}

export interface Policy {
  name: string; effectiveFrom: string; openHourIst: number; closeHourIst: number;
  afterHoursSeverities: Severity[]; routingStrategy: RoutingStrategy; deskLanguages: string[];
  aiAssistMode: AiMode; aiExcludedSeverities: Severity[];
  slas: Array<{ severity: Severity; firstResponseMinutes: number; resolutionMinutes: number }>;
  escalations: Array<{ severity: Severity; afterMinutes: number; channel: EscalationChannel; targetRole: string; notes: string | null }>;
  notes: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LANG_RE = /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/;

/**
 * Validate a whole policy.
 *
 * The checks are ordered cheapest-first so an author sees the obvious mistake before the subtle one, and every message
 * says which rule was broken. The four that matter most are marked below — they are the ones that would otherwise
 * produce a policy that reads fine and behaves wrongly.
 */
export function assertPolicy(input: PolicyInput): Policy {
  const name = input.name.trim();
  if (name.length < 3 || name.length > 120) throw new InvalidSupportPolicyError('the version needs a name of 3–120 characters');
  if (!DATE_RE.test(input.effectiveFrom)) throw new InvalidSupportPolicyError('effectiveFrom must be YYYY-MM-DD');

  // ---- hours ----
  if (!Number.isInteger(input.openHourIst) || input.openHourIst < 0 || input.openHourIst > 23) {
    throw new InvalidSupportPolicyError('openHourIst must be a whole hour between 0 and 23');
  }
  if (!Number.isInteger(input.closeHourIst) || input.closeHourIst < 1 || input.closeHourIst > 24) {
    throw new InvalidSupportPolicyError('closeHourIst must be a whole hour between 1 and 24');
  }
  if (input.closeHourIst <= input.openHourIst) {
    throw new InvalidSupportPolicyError('the desk must close after it opens; a zero-length day would silently mean "never open"');
  }

  const routingStrategy = input.routingStrategy as RoutingStrategy;
  if (!(ROUTING_STRATEGIES as readonly string[]).includes(routingStrategy)) {
    throw new InvalidSupportPolicyError(`routingStrategy must be one of ${ROUTING_STRATEGIES.join(', ')}`);
  }
  const aiAssistMode = input.aiAssistMode as AiMode;
  if (!(AI_MODES as readonly string[]).includes(aiAssistMode)) {
    throw new InvalidSupportPolicyError(`aiAssistMode must be one of ${AI_MODES.join(', ')}`);
  }

  // ---- desk languages ----
  const deskLanguages = [...new Set(input.deskLanguages.map((l) => l.trim().toLowerCase()).filter(Boolean))];
  if (deskLanguages.length === 0) {
    throw new InvalidSupportPolicyError('the desk must answer in at least one language');
  }
  const badLang = deskLanguages.find((l) => !LANG_RE.test(l));
  if (badLang) throw new InvalidSupportPolicyError(`'${badLang}' is not a language code`);

  const afterHoursSeverities = assertSeverityList(input.afterHoursSeverities, 'afterHoursSeverities');
  const aiExcludedSeverities = assertSeverityList(input.aiExcludedSeverities, 'aiExcludedSeverities');

  // ---- SLAs: one per severity, all four, ordered ----
  const slas = assertSlas(input.slas);

  // ---- the chain ----
  const escalations = assertEscalations(input.escalations);

  // (1) EVERY SEVERITY THE DESK PROMISES TO ANSWER NEEDS A CHAIN STEP. A severity with an SLA and no escalation is a
  //     promise with nothing behind it — exactly the state ADMIN-2 had to report on screen.
  const covered = new Set(escalations.map((e) => e.severity));
  const uncovered = slas.map((s) => s.severity).filter((s) => !covered.has(s));
  if (uncovered.length > 0) {
    throw new InvalidSupportPolicyError(`no escalation step for ${uncovered.join(', ')} — an SLA with no chain is a promise nobody is paged about`);
  }

  // (2) THE CHAIN MUST NOT PROMISE NIGHT COVER THE HOURS DENY. If a severity is not in `afterHoursSeverities`, a step
  //     that WAKES somebody is a contradiction: at 03:00 the policy says the desk is shut and the chain rings a phone.
  const afterHours = new Set(afterHoursSeverities);
  const contradiction = escalations.find((e) => wakesSomebody(e.channel) && !afterHours.has(e.severity));
  if (contradiction) {
    throw new InvalidSupportPolicyError(
      `the ${contradiction.severity} chain wakes somebody by ${contradiction.channel}, but ${contradiction.severity} is not in afterHoursSeverities — the policy would ring a phone at an hour it says the desk is shut`,
    );
  }

  // (3) AN AI MAY NOT AUTO-ANSWER A SEVERITY THE DESK TREATS AS HUMAN-ONLY.
  if (aiAssistMode === 'auto_reply') {
    const stillHuman = SEVERITIES.filter((s) => !aiExcludedSeverities.includes(s));
    if (stillHuman.length === SEVERITIES.length) {
      throw new InvalidSupportPolicyError('auto_reply with no excluded severities would let the AI answer a P0 about somebody\'s money before a human reads it; exclude at least P0');
    }
  }

  return {
    name, effectiveFrom: input.effectiveFrom,
    openHourIst: input.openHourIst, closeHourIst: input.closeHourIst,
    afterHoursSeverities, routingStrategy, deskLanguages, aiAssistMode, aiExcludedSeverities,
    slas, escalations, notes: input.notes?.trim() || null,
  };
}

function assertSeverityList(raw: readonly string[], field: string): Severity[] {
  const list = [...new Set(raw.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const bad = list.find((s) => !(SEVERITIES as readonly string[]).includes(s));
  if (bad) throw new InvalidSupportPolicyError(`${field} contains '${bad}', which is not a severity`);
  // sorted by urgency so the stored list reads the way a human would write it
  return (SEVERITIES as readonly string[]).filter((s) => list.includes(s)) as Severity[];
}

function assertSlas(raw: readonly SlaInput[]): Policy['slas'] {
  const seen = new Map<Severity, { firstResponseMinutes: number; resolutionMinutes: number }>();
  for (const s of raw) {
    const severity = s.severity.trim().toUpperCase() as Severity;
    if (!(SEVERITIES as readonly string[]).includes(severity)) throw new InvalidSupportPolicyError(`'${s.severity}' is not a severity`);
    if (seen.has(severity)) throw new InvalidSupportPolicyError(`two SLA rows for ${severity}`);
    const fr = Number(s.firstResponseMinutes); const res = Number(s.resolutionMinutes);
    if (!Number.isInteger(fr) || fr < 1 || fr > 43_200) throw new InvalidSupportPolicyError(`${severity} first response must be 1–43200 minutes`);
    if (!Number.isInteger(res) || res < 1 || res > 43_200) throw new InvalidSupportPolicyError(`${severity} resolution must be 1–43200 minutes`);
    // a promise to FIX it before answering is not a promise
    if (res < fr) throw new InvalidSupportPolicyError(`${severity} resolution (${res}m) cannot be sooner than its first response (${fr}m)`);
    seen.set(severity, { firstResponseMinutes: fr, resolutionMinutes: res });
  }
  const missing = SEVERITIES.filter((s) => !seen.has(s));
  if (missing.length > 0) throw new InvalidSupportPolicyError(`no SLA for ${missing.join(', ')} — every severity the platform accepts needs a target`);

  const ordered = SEVERITIES.map((severity) => ({ severity, ...(seen.get(severity) as { firstResponseMinutes: number; resolutionMinutes: number }) }));

  // (4) TARGETS MUST LOOSEN AS SEVERITY FALLS. A P1 given less time than a P0 mis-prioritises every ticket, and nothing
  //     downstream would notice — the queue would simply sort wrongly for ever.
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].firstResponseMinutes <= ordered[i - 1].firstResponseMinutes) {
      throw new InvalidSupportPolicyError(`${ordered[i].severity} must have MORE first-response time than ${ordered[i - 1].severity}`);
    }
    if (ordered[i].resolutionMinutes <= ordered[i - 1].resolutionMinutes) {
      throw new InvalidSupportPolicyError(`${ordered[i].severity} must have MORE resolution time than ${ordered[i - 1].severity}`);
    }
  }
  return ordered;
}

function assertEscalations(raw: readonly EscalationInput[]): Policy['escalations'] {
  if (raw.length === 0) throw new InvalidSupportPolicyError('a policy needs at least one escalation step');
  if (raw.length > 40) throw new InvalidSupportPolicyError('at most 40 escalation steps');
  const seen = new Set<string>();
  const out: Policy['escalations'] = [];
  for (const e of raw) {
    const severity = e.severity.trim().toUpperCase() as Severity;
    if (!(SEVERITIES as readonly string[]).includes(severity)) throw new InvalidSupportPolicyError(`'${e.severity}' is not a severity`);
    const channel = e.channel.trim().toLowerCase() as EscalationChannel;
    if (!(ESCALATION_CHANNELS as readonly string[]).includes(channel)) throw new InvalidSupportPolicyError(`'${e.channel}' is not an escalation channel`);
    const afterMinutes = Number(e.afterMinutes);
    if (!Number.isInteger(afterMinutes) || afterMinutes < 0 || afterMinutes > 10_080) {
      throw new InvalidSupportPolicyError('afterMinutes must be 0 (at breach) to 10080 (a week)');
    }
    const targetRole = e.targetRole.trim();
    // A ROLE, never a person: naming a person means the chain breaks the day they leave, and nobody finds out until the
    // next breach at 02:00.
    if (targetRole.length < 2 || targetRole.length > 60) throw new InvalidSupportPolicyError('targetRole must be 2–60 characters (a role, not a person)');
    if (targetRole.includes('@')) throw new InvalidSupportPolicyError('targetRole looks like an address; name a ROLE so the chain survives someone leaving');

    const key = `${severity}:${afterMinutes}:${channel}`;
    if (seen.has(key)) throw new InvalidSupportPolicyError(`two ${channel} steps for ${severity} at +${afterMinutes}m`);
    seen.add(key);
    out.push({ severity, afterMinutes, channel, targetRole, notes: e.notes?.trim() || null });
  }
  return out.sort((a, b) => {
    const bySeverity = SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
    return bySeverity !== 0 ? bySeverity : a.afterMinutes - b.afterMinutes;
  });
}

/** Is the desk open at this IST hour? Used by the console to say what after-hours means in practice, and (later) by the
 *  pager to decide whether a step should fire now or wait. */
export function deskIsOpen(policy: { openHourIst: number; closeHourIst: number }, hourIst: number): boolean {
  return hourIst >= policy.openHourIst && hourIst < policy.closeHourIst;
}

/** The steps that apply to a breach of this severity at this many minutes past it — ordered, so a caller fires them in
 *  sequence rather than all at once. */
export function stepsDueAt(escalations: readonly Policy['escalations'][number][], severity: Severity, minutesPastBreach: number) {
  return escalations.filter((e) => e.severity === severity && e.afterMinutes <= minutesPastBreach);
}

/** A one-line human summary, for the console and for the audit row — so the record says what the policy DOES rather
 *  than listing twenty columns a reader has to reassemble. */
export function describePolicy(p: Pick<Policy, 'openHourIst' | 'closeHourIst' | 'routingStrategy' | 'aiAssistMode' | 'afterHoursSeverities'>): string {
  const hours = `${String(p.openHourIst).padStart(2, '0')}:00–${String(p.closeHourIst).padStart(2, '0')}:00 IST`;
  const night = p.afterHoursSeverities.length ? p.afterHoursSeverities.join('/') : 'nothing';
  return `open ${hours}, ${p.routingStrategy} routing, AI ${p.aiAssistMode}, after hours ${night} wakes somebody`;
}
