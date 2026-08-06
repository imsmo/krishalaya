// apps/admin-api/src/modules/billing-ops/domain/dunning-policy.ts · pure rules for a COLLECTIONS LADDER
// (PC-56 ADMIN-1b, closes ADMIN-1-Q6; tables in migration 0094). No I/O → unit-provable.
//
// A ladder is a promise about how the platform will treat a customer who owes money. The validations here are the
// ones that stop a ladder being cruel or being theatre:
//   • no duplicate rung (same day, same channel) — a tenant getting the same email twice on day 3 reads as a bug in
//     our system, not as diligence;
//   • sorted by day, so what is stored is what a human reads;
//   • suspension must come AFTER the last reminder — a ladder that suspends before it has finished asking is not a
//     collections process, it is a switch with extra steps;
//   • a `call` rung may have no template (a person says their own words) but a MESSAGING rung without one is a
//     silent step: it would fire and send nothing.
import { InvalidDunningPolicyError } from './billing-ops.errors';

export const POLICY_CHANNELS = ['email', 'sms', 'whatsapp', 'call', 'in_app'] as const;
export type PolicyChannel = (typeof POLICY_CHANNELS)[number];

/** Channels that send a MESSAGE and therefore need something to send. `call` and `in_app` are the exceptions:
 *  a call is a human speaking, and an in-app nudge is rendered by the app from the invoice itself. */
const NEEDS_TEMPLATE: ReadonlySet<PolicyChannel> = new Set<PolicyChannel>(['email', 'sms', 'whatsapp']);

export interface LadderStep {
  dayOffset: number;
  channel: PolicyChannel;
  templateCode: string | null;
  escalate: boolean;
}

export interface LadderStepInput {
  dayOffset: number;
  channel: string;
  templateCode?: string;
  escalate?: boolean;
}

/** Maximum rungs. Twenty is far more than any humane ladder needs; the point is to bound the object, not to design
 *  the process — and 0035's per-invoice attempt cap (12) is the real limit on how often anyone is actually contacted. */
export const MAX_LADDER_STEPS = 20;

/**
 * Validate and normalise a ladder. Returns the steps sorted by day then channel, so the stored order is the read
 * order and a diff between two versions is meaningful rather than an artefact of form order.
 */
export function assertLadder(steps: readonly LadderStepInput[], suspendAfterDays: number | null): LadderStep[] {
  if (steps.length === 0) throw new InvalidDunningPolicyError('a ladder needs at least one step');
  if (steps.length > MAX_LADDER_STEPS) throw new InvalidDunningPolicyError(`a ladder may have at most ${MAX_LADDER_STEPS} steps`);

  const seen = new Set<string>();
  const out: LadderStep[] = [];
  for (const raw of steps) {
    const day = Number(raw.dayOffset);
    if (!Number.isInteger(day) || day < 0 || day > 365) {
      throw new InvalidDunningPolicyError('every step needs a whole dayOffset between 0 and 365 (0 = the due date itself)');
    }
    if (!(POLICY_CHANNELS as readonly string[]).includes(raw.channel)) {
      throw new InvalidDunningPolicyError(`unknown channel '${raw.channel}'`);
    }
    const channel = raw.channel as PolicyChannel;
    const key = `${day}:${channel}`;
    if (seen.has(key)) {
      throw new InvalidDunningPolicyError(`two steps send on day ${day} by ${channel}; a tenant contacted twice the same way on the same day reads as a fault in our system`);
    }
    seen.add(key);

    const templateCode = raw.templateCode?.trim() || null;
    if (NEEDS_TEMPLATE.has(channel) && !templateCode) {
      throw new InvalidDunningPolicyError(`the ${channel} step on day ${day} has no templateCode, so it would send nothing`);
    }
    out.push({ dayOffset: day, channel, templateCode, escalate: raw.escalate === true });
  }

  out.sort((a, b) => (a.dayOffset - b.dayOffset) || (a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0));

  if (suspendAfterDays !== null) {
    const last = out[out.length - 1].dayOffset;
    if (suspendAfterDays <= last) {
      throw new InvalidDunningPolicyError(`suspendAfterDays (${suspendAfterDays}) must be after the last reminder on day ${last}; suspending before the ladder has finished asking is not a collections process`);
    }
  }
  return out;
}

/** The rung that applies at a given lateness — the LAST step whose day has passed. Used by the console to say what
 *  the policy expects, next to what was actually done. Null before the first rung is due. */
export function stepForDaysLate(steps: readonly LadderStep[], daysLate: number): LadderStep | null {
  let match: LadderStep | null = null;
  for (const s of steps) if (daysLate >= s.dayOffset) match = s;
  return match;
}

/** The next rung due after this lateness, so the console can say "then, on day N…". Null past the last rung. */
export function nextStepAfter(steps: readonly LadderStep[], daysLate: number): LadderStep | null {
  for (const s of steps) if (s.dayOffset > daysLate) return s;
  return null;
}

/** True when an invoice this late is past the suspension threshold. A LABEL for a human decision — nothing in this
 *  codebase suspends a tenant automatically (see the service header). */
export function suspensionDue(suspendAfterDays: number | null, daysLate: number): boolean {
  return suspendAfterDays !== null && daysLate >= suspendAfterDays;
}

/** Compare two ladders for the console's version view: which rungs were added, removed or changed. Diffing by
 *  (day, channel) rather than by index, because a rung's identity is when-and-how it contacts someone. */
export function diffLadders(before: readonly LadderStep[], after: readonly LadderStep[]): {
  added: LadderStep[]; removed: LadderStep[]; changed: Array<{ from: LadderStep; to: LadderStep }>;
} {
  const key = (s: LadderStep) => `${s.dayOffset}:${s.channel}`;
  const b = new Map(before.map((s) => [key(s), s]));
  const a = new Map(after.map((s) => [key(s), s]));
  const added: LadderStep[] = []; const removed: LadderStep[] = []; const changed: Array<{ from: LadderStep; to: LadderStep }> = [];
  for (const [k, s] of a) {
    const prev = b.get(k);
    if (!prev) added.push(s);
    else if (prev.templateCode !== s.templateCode || prev.escalate !== s.escalate) changed.push({ from: prev, to: s });
  }
  for (const [k, s] of b) if (!a.has(k)) removed.push(s);
  return { added, removed, changed };
}
