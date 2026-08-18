// apps/web-admin/src/features/compliance/breach-notification.ts · PURE helpers for W043's notification checklist and
// W048's posture page (PC-56 ADMIN-5c). No fetch, no React → unit-tested.
//
// W048 calls itself "the page a regulator or enterprise buyer would ask to see", and W043 is the register that page
// summarises. Both are read by people with an incentive to check them, so the rule throughout is stricter than
// elsewhere: a tile whose inputs could not be read says so, and "all quiet" is only claimable when everything was
// actually looked at.
//
// DEV-60 (UI Port Program batch 3, Part 1, Slice A): `stepClass`/`clockClass`/`retentionClass`/`attentionClass`/
// `certificationClass` now return a `StatusTone` instead of a raw `kv-status kv-status--X` string — disposition
// (c), same pattern as `ai-governance.ts`. Call sites render `<StatusPill tone={...} label={...} />`. This file's
// own `stepClass` and `attentionClass` are unrelated to the identically-named exports in `support/emergency.ts`
// and `trust/trust-safety.ts` respectively — different files, different vocabularies, out of this slice's scope.

import type { StatusTone } from '@krishalaya/ui';

/* ===================== the checklist (W043) ===================== */

export const NOTIFICATION_STEPS = ['board_filing', 'principals_notified', 'tenant_briefed'] as const;
export type NotificationStep = (typeof NOTIFICATION_STEPS)[number];
export type StepOutcome = 'done' | 'not_applicable' | 'retracted';

export interface ChecklistLine {
  step: NotificationStep;
  outcome: StepOutcome | null;
  evidenceRef: string | null;
  reachedCount: number | null;
  channel: string | null;
  note: string | null;
  performedBy: string | null;
  performedAt: string | null;
}

/** How a step renders. FOUR states, and the difference between the last two is the point:
 *    done            — evidenced.
 *    not_applicable  — a recorded DECISION that this act does not apply (a synthetic-data breach has no principals).
 *    outstanding     — nobody has looked. NOT the same as not-applicable, and it is what blocks the notification.
 *    retracted       — a claim that was made and withdrawn, which stays visible because it is a fact somebody may have
 *                      to explain.
 */
export function stepState(l: Pick<ChecklistLine, 'outcome'>): 'done' | 'notApplicable' | 'outstanding' | 'retracted' {
  if (l.outcome === 'done') return 'done';
  if (l.outcome === 'not_applicable') return 'notApplicable';
  if (l.outcome === 'retracted') return 'retracted';
  return 'outstanding';
}

/** `not_applicable` is NOT a failure colour — it is a decision somebody recorded with a reason. `outstanding` is a
 *  warning rather than a failure too: nobody has done anything wrong yet, they simply have work left. A RETRACTED claim
 *  IS a failure colour, because a withdrawn statutory claim is the one state on this screen that needs explaining. */
export function stepTone(l: Pick<ChecklistLine, 'outcome'>): StatusTone {
  switch (stepState(l)) {
    case 'done': return 'success';
    case 'notApplicable': return 'neutral';
    case 'retracted': return 'danger';
    default: return 'warning';
  }
}

export type Notifiable =
  | { ok: true; steps: number }
  | { ok: false; reason: 'steps_outstanding'; outstanding: string[] }
  | { ok: false; reason: 'no_dpo_signoff' };

/** Whether to OFFER the Notify control.
 *
 *  ABSENT rather than disabled when the checklist is short or unsigned — the standing doctrine, and it matters most
 *  here: a Notify button that always 409s teaches an operator that the checklist is paperwork, which is exactly the
 *  attitude that let two typed timestamps stand in for a statutory act.
 */
export function notifyOfferable(n: Notifiable | null | undefined): boolean {
  return !!n && n.ok === true;
}
export function notifyBlockedKey(n: Notifiable | null | undefined): 'outstanding' | 'signOff' | 'unknown' | null {
  if (!n) return 'unknown';
  if (n.ok) return null;
  return n.reason === 'steps_outstanding' ? 'outstanding' : 'signOff';
}

/** Whether to offer the DPO sign-off to this viewer.
 *
 *  Not offered to whoever DECLARED the breach — they are the person most motivated to see it closed, usually at the
 *  worst hour of the night. Display gating only; `ck_breach_signoff_ne_opener` and the service both refuse. An unknown
 *  viewer IS offered the control, because the safe direction for a display decision is to let the server refuse.
 */
export function signOffOfferable(openedBy: string | null | undefined, viewerUserId: string | null, alreadySigned: boolean): boolean {
  if (alreadySigned) return false;
  if (!viewerUserId || !openedBy) return true;
  return openedBy !== viewerUserId;
}

/* ===================== the clocks ===================== */

export type NotifyClock =
  | { kind: 'met'; hoursTaken: number }
  | { kind: 'due'; hoursLeft: number }
  | { kind: 'breached'; hoursOver: number }
  | { kind: 'unmeasured' };

/** `unmeasured` is a WARNING, not a pass. A breach with no detection time cannot be shown to have been notified in
 *  time, and on a register a regulator reads that is the first thing they ask about. */
export function clockTone(c: NotifyClock | null | undefined): StatusTone {
  if (!c) return 'neutral';
  switch (c.kind) {
    case 'met': return 'success';
    case 'breached': return 'danger';
    // Under 24 hours left on a 72-hour statutory window is urgent, not merely noteworthy.
    case 'due': return c.hoursLeft <= 24 ? 'danger' : 'warning';
    default: return 'warning';
  }
}
export function clockKey(c: NotifyClock | null | undefined): 'met' | 'due' | 'breached' | 'unmeasured' {
  return c ? c.kind : 'unmeasured';
}

/** The reach shortfall — how many affected people were NOT reached.
 *
 *  NULL when either side is unknown, and that is deliberate: a fabricated "0 unreached" on a breach register is the
 *  worst possible rounding, because it converts "nobody counted" into "everybody was told".
 */
export function reachShortfall(affected: number | null | undefined, reached: number | null | undefined): { known: boolean; missing: number } {
  if (typeof affected !== 'number' || typeof reached !== 'number' || !Number.isFinite(affected) || !Number.isFinite(reached)) {
    return { known: false, missing: 0 };
  }
  return { known: true, missing: Math.max(0, affected - reached) };
}

/* ===================== the step form ===================== */

export type RecordStepResult =
  | { ok: true; value: { step: NotificationStep; outcome: 'done' | 'not_applicable'; evidenceRef?: string; reachedCount?: number; channel?: string; note?: string } }
  | { ok: false; error: 'step' | 'outcome' | 'evidenceRef' | 'note' | 'reachedCount' | 'looksLikePii' };

/** A breach register is read by regulators, shared with tenants and exported. Same rule as `affected_data`: references
 *  and categories, never the affected values. Shape-based rather than clever — an '@' or a run of six digits. */
const LOOKS_LIKE_PII = /@|[0-9]{6,}/;

export function buildRecordStep(raw: { step?: string; outcome?: string; evidenceRef?: string; reachedCount?: string; channel?: string; note?: string }): RecordStepResult {
  const step = (raw.step ?? '').trim();
  if (!(NOTIFICATION_STEPS as readonly string[]).includes(step)) return { ok: false, error: 'step' };
  const outcome = (raw.outcome ?? '').trim();
  if (outcome !== 'done' && outcome !== 'not_applicable') return { ok: false, error: 'outcome' };

  const evidenceRef = (raw.evidenceRef ?? '').trim();
  const note = (raw.note ?? '').trim();
  const channel = (raw.channel ?? '').trim();

  // The PII shape check runs BEFORE the required-field checks: a filing reference that is actually a pasted phone
  // number should be told about the phone number, not about being present.
  for (const v of [evidenceRef, note, channel]) if (v && LOOKS_LIKE_PII.test(v)) return { ok: false, error: 'looksLikePii' };

  if (outcome === 'done' && !evidenceRef) return { ok: false, error: 'evidenceRef' };
  if (outcome === 'not_applicable' && !note) return { ok: false, error: 'note' };
  if (evidenceRef.length > 200) return { ok: false, error: 'evidenceRef' };
  if (note.length > 2000) return { ok: false, error: 'note' };

  const rawCount = (raw.reachedCount ?? '').trim();
  // Blank is OMITTED rather than zero. Omitting means nobody counted; zero means we counted and reached none — on a
  // breach notification those are different statements and the register keeps them apart.
  if (rawCount && !/^[0-9]{1,10}$/.test(rawCount)) return { ok: false, error: 'reachedCount' };

  return {
    ok: true,
    value: {
      step: step as NotificationStep,
      outcome,
      ...(evidenceRef ? { evidenceRef } : {}),
      ...(rawCount ? { reachedCount: Number(rawCount) } : {}),
      ...(channel ? { channel } : {}),
      ...(note ? { note } : {}),
    },
  };
}

/* ===================== W048 posture ===================== */

export type Tile = { kind: 'value'; value: number; hint?: string } | { kind: 'unavailable'; reason: string };

export function tileValue(t: Tile | null | undefined): { known: boolean; value: number } {
  return t && t.kind === 'value' ? { known: true, value: t.value } : { known: false, value: 0 };
}

export type RetentionTile =
  | { kind: 'coverage'; runnable: number; unrunnable: number; total: number; unrunnableActions: string[]; complete: boolean }
  | { kind: 'unavailable'; reason: string };

/** The retention tile is NEVER a fraction with a tick.
 *
 *  W048 shows "61/61 ✓". The retention worker implements `action='delete'` only — its own comment says anonymise and
 *  archive are left to pipelines that do not exist — and six of the thirteen seeded policies are those two. A green
 *  fraction over policies nothing can run would be the single most reassuring false statement on a page written for
 *  regulators.
 */
export function retentionKey(t: RetentionTile | null | undefined): 'complete' | 'partial' | 'none' | 'unavailable' {
  if (!t || t.kind === 'unavailable') return 'unavailable';
  if (t.total <= 0) return 'none';
  return t.complete ? 'complete' : 'partial';
}
export function retentionTone(t: RetentionTile | null | undefined): StatusTone {
  const k = retentionKey(t);
  if (k === 'complete') return 'success';
  if (k === 'unavailable') return 'neutral';
  return 'warning';
}

export type AttentionSeverity = 'overdue' | 'blocking' | 'due_soon' | 'info';
export interface AttentionItem { id: string; severity: AttentionSeverity; messageKey: string; params?: Record<string, string>; href?: string }

export function attentionTone(s: AttentionSeverity): StatusTone {
  switch (s) {
    case 'overdue': return 'danger';
    case 'blocking': return 'danger';
    case 'due_soon': return 'warning';
    default: return 'neutral';
  }
}

export interface SourcesRead { dsr: boolean; breaches: boolean; retention: boolean; consent: boolean }

/** "All quiet" is only claimable when EVERY source was read.
 *
 *  The same rule as ADMIN-5's clean-record line and for the same reason: an empty attention list assembled from
 *  registers that failed to load says "nothing needs attention" when the truth is "we could not look". On the page a
 *  regulator asks to see, that distinction is the whole difference between candour and a comfortable dashboard.
 */
export function allQuiet(items: AttentionItem[] | null | undefined, read: SourcesRead | null | undefined): boolean {
  if (!items || !read) return false;
  return items.length === 0 && read.dsr && read.breaches && read.retention && read.consent;
}

export function unreadSources(read: SourcesRead | null | undefined): string[] {
  if (!read) return ['dsr', 'breaches', 'retention', 'consent'];
  return (['dsr', 'breaches', 'retention', 'consent'] as const).filter((k) => !read[k]);
}

/* ===================== certifications ===================== */

export type CertificationState = 'live' | 'in_progress' | 'planned' | 'roadmap';
export interface Certification { code: string; name: string; state: CertificationState; note: string; claimable: boolean }

/** Only `live` may render as held. W048: "No certification is claimed before it is held."
 *
 *  The console trusts `claimable` from the server rather than re-deriving it from `state`, so there is ONE place that
 *  decides — and it defaults to NOT claimable when the flag is missing, because the failure direction that matters is
 *  a page claiming a certification the platform does not hold.
 */
export function certificationHeld(c: Pick<Certification, 'claimable'> | null | undefined): boolean {
  return c?.claimable === true;
}
export function certificationTone(c: Certification): StatusTone {
  return certificationHeld(c) ? 'success' : 'neutral';
}

/* ===================== the export receipt (all surfaces) ===================== */

export interface ExportReceipt {
  id: string; report: string; generatedAt: string; generatedBy: string;
  rowCount: number; truncated: boolean; fileName?: string;
  contentSha256?: string; digestBasis?: string; piiMasked?: boolean;
}

/** A receipt WITHOUT a digest is now an old receipt, and the console says so rather than hiding the field.
 *
 *  Five export surfaces shipped without one between ADMIN-1d and ADMIN-4b, against a chain screen that names sha256 in
 *  every module. Anything still returning no digest is a surface that has not been updated, and a blank cell would make
 *  that invisible.
 */
export function digestState(r: ExportReceipt | null | undefined): 'present' | 'absent' | 'unknown' {
  if (!r) return 'unknown';
  return typeof r.contentSha256 === 'string' && /^[0-9a-f]{64}$/.test(r.contentSha256) ? 'present' : 'absent';
}
