// apps/admin-api/src/modules/compliance-ops/domain/breach-notification.ts · W043's notification checklist (0109).
// Pure, no I/O.
//
// W043: "Moving to notified requires all three ticked + DPO sign-off — recorded immutably."
//
// Before 0109 `notify` required two strings in the request body. An operator typed two dates and the register stated
// that the Data Protection Board had been notified. This module is the difference between that and a record somebody
// could stand behind — and it is the same shape as ADMIN-5's erasure guard, deliberately, because it is the same
// failure: a status claiming a statutory act nobody evidenced.
import { InvalidBreachUpdateError } from './compliance-ops.errors';

/** The three acts W043 lists, in the order they are done. Not a free-text list: a fourth step invented to pad a count
 *  would make the checklist meaningless, and three is what the statute and the screen both say. */
export const NOTIFICATION_STEPS = ['board_filing', 'principals_notified', 'tenant_briefed'] as const;
export type NotificationStep = (typeof NOTIFICATION_STEPS)[number];
export function isNotificationStep(v: string): v is NotificationStep {
  return (NOTIFICATION_STEPS as readonly string[]).includes(v);
}

export const STEP_OUTCOMES = ['done', 'not_applicable', 'retracted'] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

export interface StepRow {
  step: string;
  outcome: string;
  evidenceRef: string | null;
  reachedCount: number | null;
  channel: string | null;
  note: string | null;
  performedBy: string;
  performedAt: string | null;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE 72-HOUR CLOCK                                                                                            */
/* ------------------------------------------------------------------------------------------------------------ */

/** DPDP requires notification "without delay"; the canon works to 72 hours from DETECTION, which is what W043's
 *  "Notification decision — severity assessment in progress (72h window) · due 14 Jul" counts from. */
export const NOTIFY_WINDOW_HOURS = 72;
const HOUR_MS = 3_600_000;

export type NotifyClock =
  | { kind: 'met'; hoursTaken: number }
  | { kind: 'due'; hoursLeft: number }
  | { kind: 'breached'; hoursOver: number }
  /** No detection timestamp. Not the same as a met window — it is an unread clock, and on a breach register that is
   *  the thing a regulator asks about first. */
  | { kind: 'unmeasured' };

/** The clock runs from DETECTION and stops when the notification is complete.
 *
 *  It deliberately does NOT stop at containment. Containing a breach in 25 minutes is excellent and is a different
 *  achievement; the statutory duty is to tell people, and a register that stopped the clock at containment would let a
 *  contained-but-unreported breach sit past its window showing green.
 */
export function notifyClock(detectedAt: Date | null, notifiedAt: Date | null, now: Date): NotifyClock {
  if (!detectedAt) return { kind: 'unmeasured' };
  const deadline = detectedAt.getTime() + NOTIFY_WINDOW_HOURS * HOUR_MS;
  if (notifiedAt) {
    const taken = Math.round((notifiedAt.getTime() - detectedAt.getTime()) / HOUR_MS);
    return notifiedAt.getTime() <= deadline
      ? { kind: 'met', hoursTaken: Math.max(0, taken) }
      : { kind: 'breached', hoursOver: Math.ceil((notifiedAt.getTime() - deadline) / HOUR_MS) };
  }
  const left = deadline - now.getTime();
  return left >= 0 ? { kind: 'due', hoursLeft: Math.floor(left / HOUR_MS) } : { kind: 'breached', hoursOver: Math.ceil(-left / HOUR_MS) };
}

/** W043 shows containment as its own achievement — "Contained — all 64 sessions revoked ... 11 Jul 23:05 (25 min)".
 *  Reported separately from the notify clock for the reason above. */
export function containmentMinutes(detectedAt: Date | null, containedAt: Date | null): number | null {
  if (!detectedAt || !containedAt) return null;
  return Math.max(0, Math.round((containedAt.getTime() - detectedAt.getTime()) / 60_000));
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE CHECKLIST                                                                                                */
/* ------------------------------------------------------------------------------------------------------------ */

export interface ChecklistLine { step: NotificationStep; outcome: StepOutcome | null; evidenceRef: string | null; reachedCount: number | null; channel: string | null; note: string | null; performedBy: string | null; performedAt: string | null }

/** The checklist as the screen renders it: every required step, present or not. A step with no row is `outcome: null`
 *  and NOT "not done" — the distinction matters because `not_applicable` is a recorded decision and an absent row is
 *  nobody having looked. */
export function checklist(steps: StepRow[]): ChecklistLine[] {
  const live = new Map<string, StepRow>();
  for (const s of steps) if (s.outcome !== 'retracted') live.set(s.step, s);
  return NOTIFICATION_STEPS.map((step) => {
    const r = live.get(step);
    return r
      ? { step, outcome: r.outcome as StepOutcome, evidenceRef: r.evidenceRef, reachedCount: r.reachedCount, channel: r.channel, note: r.note, performedBy: r.performedBy, performedAt: r.performedAt }
      : { step, outcome: null, evidenceRef: null, reachedCount: null, channel: null, note: null, performedBy: null, performedAt: null };
  });
}

export type NotifyReadiness =
  | { ok: true; steps: number }
  | { ok: false; reason: 'steps_outstanding'; outstanding: NotificationStep[] }
  | { ok: false; reason: 'no_dpo_signoff' };

/**
 * May this breach be moved to `notified`?
 *
 * ONLY IF ALL THREE STEPS HAVE A RECORDED OUTCOME AND A DPO HAS SIGNED OFF. Both halves are load-bearing:
 *   • The steps are the evidence. Without them `notified` is two typed timestamps, which is what it was.
 *   • The sign-off is a SECOND PERSON. The individual who declared the breach at 22:40 is the individual most motivated
 *     to see it closed, and the database refuses a sign-off by them (`ck_breach_signoff_ne_opener`).
 *
 * `not_applicable` counts as a recorded outcome. A breach of synthetic staging data affects nobody and has no tenant;
 * demanding a fabricated "notified 0 principals" row would teach operators to type something untrue to pass a gate,
 * which is a worse habit than the gate is worth.
 */
export function assertNotifiable(steps: StepRow[], dpoSignedOffBy: string | null): NotifyReadiness {
  const lines = checklist(steps);
  const outstanding = lines.filter((l) => l.outcome === null).map((l) => l.step);
  if (outstanding.length > 0) return { ok: false, reason: 'steps_outstanding', outstanding };
  if (!dpoSignedOffBy) return { ok: false, reason: 'no_dpo_signoff' };
  return { ok: true, steps: lines.length };
}

/** Validate one recorded step.
 *
 *  `done` requires evidence; `not_applicable` requires a reason. Both are enforced by CHECK constraints in 0109 as well,
 *  and both exist here so the refusal is a 422 that names the missing field rather than a constraint violation.
 */
export function assertStep(v: { step: string; outcome: string; evidenceRef?: unknown; reachedCount?: unknown; channel?: unknown; note?: unknown }): {
  step: NotificationStep; outcome: StepOutcome; evidenceRef: string | null; reachedCount: number | null; channel: string | null; note: string | null;
} {
  if (!isNotificationStep(v.step)) throw new InvalidBreachUpdateError(`step must be one of ${NOTIFICATION_STEPS.join('|')}`);
  if (!(STEP_OUTCOMES as readonly string[]).includes(v.outcome)) throw new InvalidBreachUpdateError(`outcome must be one of ${STEP_OUTCOMES.join('|')}`);
  const outcome = v.outcome as StepOutcome;

  const text = (x: unknown, max: number) => {
    if (x === undefined || x === null || x === '') return null;
    if (typeof x !== 'string') throw new InvalidBreachUpdateError('expected a string');
    const s = x.trim();
    if (s.length > max) throw new InvalidBreachUpdateError(`value exceeds ${max} characters`);
    // A breach register is read by regulators and exported. Same rule as `affected_data`: no raw contact details.
    if (/@/.test(s) || /[0-9]{6,}/.test(s)) {
      throw new InvalidBreachUpdateError('this field must not contain an email address or a long digit run — the breach register records categories and references, never the affected values themselves');
    }
    return s || null;
  };

  const evidenceRef = text(v.evidenceRef, 200);
  const note = text(v.note, 2000);
  const channel = text(v.channel, 40);

  if (outcome === 'done' && !evidenceRef) {
    throw new InvalidBreachUpdateError(
      'a completed notification step needs its evidence — the Board filing acknowledgement number, the channel the '
      + 'principals were reached on, or who at the tenant was briefed. Without it this is a tick with nothing behind it, '
      + 'which is what the two typed timestamps were.');
  }
  if (outcome === 'not_applicable' && !note) {
    throw new InvalidBreachUpdateError('a step marked not applicable needs a reason — without one it is indistinguishable from skipping it');
  }

  let reachedCount: number | null = null;
  if (v.reachedCount !== undefined && v.reachedCount !== null && v.reachedCount !== '') {
    const n = Number(v.reachedCount);
    if (!Number.isInteger(n) || n < 0) throw new InvalidBreachUpdateError('reachedCount must be a whole number of people, or omitted');
    reachedCount = n;
  }
  // NULL is not zero. Omitting the count means nobody counted; zero means we counted and reached none. On a
  // notification those are different statements and the register keeps them apart.
  return { step: v.step, outcome, evidenceRef, reachedCount, channel, note };
}

/** Sum of people actually reached across the steps that recorded a count. NULL when nothing was counted — reporting 0
 *  would say we reached nobody, when the truth is that nobody wrote the number down. */
export function totalReached(steps: StepRow[]): number | null {
  const counted = steps.filter((s) => s.outcome === 'done' && typeof s.reachedCount === 'number');
  if (counted.length === 0) return null;
  return counted.reduce((n, s) => n + (s.reachedCount ?? 0), 0);
}

/** W043's "64 principals" against what the notification actually reached. A shortfall is the number that matters and it
 *  is NULL rather than 0 when either side is unknown — a fabricated "0 unreached" on a breach register is the worst
 *  possible rounding. */
export function unreached(affectedCount: number | null, reached: number | null): number | null {
  if (typeof affectedCount !== 'number' || typeof reached !== 'number') return null;
  return Math.max(0, affectedCount - reached);
}
