// apps/web-admin/src/features/moderation/appeals.ts · W097 + W1953–W1955 pure logic (PC-56 ADMIN-SWEEP-b1).
//
// Pure and framework-free so the gates are unit-testable: what the server actions send, what the queue prints for an
// SLA clock, and which sentence explains a refusal. The console REFLECTS the server's rules and grants nothing
// (Law 6): every gate here has a stricter twin in admin-api, and these exist so an operator is told BEFORE the
// round-trip — never instead of it.
//
// DEV-60 (UI Port Program batch 3, Part 1, slice B): the 2 `kv-status`-returning helpers below (slaClass/
// effectClass) now return a `StatusTone` per the founder's pill-vs-text ruling (`spec_dev60.md` CONTINUATION
// block) — disposition (c). DISCLOSED DEAD-CSS FIX: `slaClass`'s `kv-status--err` branch (breached SLA) has no
// matching CSS rule anywhere in `globals.css` (only `--ok`/`--warn`/`--muted`/`--danger` exist) — this call site is
// one of the 4 named in `spec_dev60.md`'s bonus finding. `--err` maps to `danger` here, a real visual fix: a
// breached appeal SLA has rendered with NO colour at all until this swap.

import type { StatusTone } from '@krishalaya/ui';

export const DECISION_REASON_MIN = 20;   // admin-api's DECISION_REASON_MIN; 0132's CHECK is the database copy
export const APPEAL_SLA_HOURS = 48;      // W097: "SLA 48h"

export const APPEAL_STATUSES = ['pending', 'upheld', 'overturned'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export type AppealSla =
  | { kind: 'running'; hoursLeft: number }
  | { kind: 'breached'; overHours: number }
  | null;

/** The queue's first column: "28h" while running, "12h over" once breached. */
export function slaLabel(sla: AppealSla): { key: 'left' | 'over' | 'none'; hours: number } {
  if (!sla) return { key: 'none', hours: 0 };
  return sla.kind === 'running' ? { key: 'left', hours: sla.hoursLeft } : { key: 'over', hours: sla.overHours };
}

export function slaTone(sla: AppealSla): StatusTone {
  if (!sla) return 'neutral';
  if (sla.kind === 'breached') return 'danger';
  return sla.hoursLeft < 8 ? 'warning' : 'success';
}

/** Which sentence explains why THIS row offers no Decide control. Order matters: the strongest disqualification
 *  (your own original call) is the one the operator must hear even when another also applies. */
export function decideBlockedKey(v: {
  status: string; assignedTo: string | null; originalReviewerId: string | null; viewer: string | null;
}): 'decided' | 'ownOriginalCall' | 'unassigned' | 'assignedElsewhere' | null {
  if (v.status !== 'pending') return 'decided';
  if (v.viewer && v.originalReviewerId && v.originalReviewerId === v.viewer) return 'ownOriginalCall';
  if (!v.assignedTo) return 'unassigned';
  if (v.assignedTo !== v.viewer) return 'assignedElsewhere';
  return null;
}

/** W097's "(≠ original ✓)" cell. `unknown` when origin is unresolved — printed as such, never as a tick: a check
 *  mark the platform has not actually made is the claim-with-nothing-behind-it again, one table cell at a time. */
export function neOriginalMark(assignedTo: string | null, originalReviewerId: string | null): 'ok' | 'unknown' | null {
  if (!assignedTo) return null;
  if (originalReviewerId === null) return 'unknown';
  return assignedTo !== originalReviewerId ? 'ok' : null;   // '=' cannot exist server-side; null draws nothing
}

/* ------------------------------------------------------------------ the decide form's builder */

export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

/** Client-side twin of admin-api's assertDecisionReason + language requirement. The reason is written TO the
 *  appellant in THEIR language — the form says so; this gate only refuses what the server certainly will. */
export function buildDecide(v: { outcome: string; reason: string; languageCode: string }): Built<{ outcome: 'upheld' | 'overturned'; reason: string; languageCode: string }> {
  if (v.outcome !== 'upheld' && v.outcome !== 'overturned') return { ok: false, error: 'outcome' };
  const reason = v.reason.trim();
  if (reason.length < DECISION_REASON_MIN) return { ok: false, error: 'reason' };
  if (!v.languageCode.trim()) return { ok: false, error: 'language' };
  return { ok: true, value: { outcome: v.outcome, reason, languageCode: v.languageCode.trim() } };
}

/* ------------------------------------------------------------------ the overturn effects, honestly labelled */

/** The four effects W097 promises, keyed for the i18n catalogue. The page draws all four with their real provider
 *  state so the confirm step states consequences that are true (W1953's whole point). */
export const OVERTURN_EFFECT_KEYS = ['restoreSubject', 'reverseRisk', 'notifyAppellant', 'coachReviewer'] as const;

/** Effect-outcome → status class, for the success page's per-effect report. */
export function effectTone(state: string): StatusTone {
  if (state === 'done') return 'success';
  if (state === 'nothing_to_do') return 'neutral';
  return 'warning';   // subject_gone: true, and worth an operator's eye
}

/* ------------------------------------------------------------------ cursor + misc */

export function statusTab(s: string | undefined): AppealStatus {
  return (APPEAL_STATUSES as readonly string[]).includes(s ?? '') ? (s as AppealStatus) : 'pending';
}
