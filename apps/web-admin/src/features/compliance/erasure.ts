// apps/web-admin/src/features/compliance/erasure.ts · PURE, framework-free helpers for the DSR / erasure plane
// (PC-56 ADMIN-5). No fetch, no React → unit-tested.
//
// This screen is read by a DPO deciding what happens to one named person's data, and by an auditor deciding whether we
// did what we said. So the rule that governs every function here is: NEVER RENDER A REASSURING DEFAULT. An unmeasured
// SLA is not a met one, an empty scope is not "nothing will be kept", and an unevidenced erasure is not a completed one.

/* ===================== the request ===================== */

export const DSR_TYPES = ['access', 'erasure', 'correction', 'portability'] as const;
export type DsrType = (typeof DSR_TYPES)[number];
export const DSR_STATUSES = ['open', 'in_progress', 'completed', 'rejected'] as const;
export type DsrStatus = (typeof DSR_STATUSES)[number];

export const REJECTION_GROUNDS = ['identity_unverified', 'legal_hold', 'manifestly_unfounded'] as const;
export type RejectionGround = (typeof REJECTION_GROUNDS)[number];
export function isRejectionGround(v: string | null | undefined): v is RejectionGround {
  return (REJECTION_GROUNDS as readonly string[]).includes((v ?? '').trim());
}
/** `identity_unverified` is fixable by the farmer in minutes with an OTP re-auth; the other two are not fixable by them
 *  at all. The console labels the difference, because "rejected" on its own tells somebody nothing they can act on and
 *  is how a lawful refusal becomes a grievance. */
export function groundIsFixableByPrincipal(g: RejectionGround): boolean { return g === 'identity_unverified'; }

/* ===================== the SLA clocks ===================== */

export type SlaState =
  | { kind: 'met' }
  | { kind: 'due'; hoursLeft: number }
  | { kind: 'breached'; hoursOver: number }
  /** No acknowledgement timestamp exists. Before migration 0107 this was EVERY request. */
  | { kind: 'unmeasured' };

/** `unmeasured` is styled as a WARNING, not as a pass and not as a failure.
 *
 *  Not a pass, because "SLA breaches: 0" computed over requests whose clock cannot be read is the single most
 *  misleading number a compliance screen can show — it is an absent measurement wearing a clean record's clothes.
 *  Not a failure either, because nobody breached anything; the platform simply did not record the acknowledgement.
 */
export function slaClass(s: SlaState | null | undefined): string {
  if (!s) return 'kv-status kv-status--muted';
  switch (s.kind) {
    case 'met': return 'kv-status kv-status--ok';
    case 'breached': return 'kv-status kv-status--danger';
    case 'due': return s.hoursLeft <= 12 ? 'kv-status kv-status--danger' : s.hoursLeft <= 24 ? 'kv-status kv-status--warn' : 'kv-status kv-status--ok';
    default: return 'kv-status kv-status--warn';
  }
}
export function slaKey(s: SlaState | null | undefined): 'met' | 'due' | 'breached' | 'unmeasured' {
  return s ? s.kind : 'unmeasured';
}

export interface SlaSummary { breached: number; due: number; met: number; unmeasured: number }

/** Whether the "clean record" claim W041 makes is one this data supports.
 *
 *  Zero breaches is only a clean record if everything was MEASURED. With unmeasured requests in the window the honest
 *  statement is "no breach recorded, and N requests we cannot measure" — which is what a regulator would ask about
 *  first, so the screen says it before being asked.
 */
export function cleanRecordClaimable(s: SlaSummary | null | undefined): boolean {
  return !!s && s.breached === 0 && s.unmeasured === 0;
}

/* ===================== the erasure scope ===================== */

export type RetentionAction = 'delete' | 'anonymise' | 'archive' | 'keep_forever';

export interface ScopeLine {
  dataClass: string;
  action: RetentionAction;
  legalBasis: string | null;
  keptByLaw: boolean;
  retainedMonths: number | null;
  rows: number | null;
}
export type ScopeResult =
  | { kind: 'scope'; lines: ScopeLine[]; keptByLawCount: number; deletableCount: number; unrunnable: RetentionAction[] }
  | { kind: 'no_policy' }
  | { kind: 'all_inactive'; policyCount: number };

/** Which key the scope panel renders. `no_policy` is its OWN state and not an empty table.
 *
 *  This is the trap the whole module exists to avoid: `data_retention_policies` had no seed until 0107, and an empty
 *  table rendered as an empty list under the heading "Erasure scope preview" reads as "nothing of yours will be kept".
 *  The truth is the opposite — nobody has decided what happens to anything.
 */
export function scopeKey(s: ScopeResult | null | undefined): 'scope' | 'noPolicy' | 'allInactive' | 'unknown' {
  if (!s) return 'unknown';
  if (s.kind === 'scope') return 'scope';
  if (s.kind === 'no_policy') return 'noPolicy';
  return 'allInactive';
}

/** `keep_forever` is NOT a failure colour. A farmer's ledger history being retained under RBI rules is the law working,
 *  not the platform refusing — and colouring five rows red on a page somebody reads while anxious about their data is a
 *  choice about how they feel, not just how it looks. `delete` is the reassuring one and gets the positive colour. */
export function actionClass(a: RetentionAction): string {
  switch (a) {
    case 'delete': return 'kv-status kv-status--ok';
    case 'anonymise': return 'kv-status kv-status--ok';
    case 'archive': return 'kv-status kv-status--warn';
    default: return 'kv-status kv-status--muted';
  }
}

/** Row count text. NULL renders as "not counted" and NEVER as 0 — "0 records" beside `kyc_documents` tells a farmer who
 *  completed onboarding that they have no KYC on file, which is false in the way that makes somebody distrust the whole
 *  page. */
export function rowsText(n: number | null | undefined): { known: boolean; n: number } {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? { known: true, n } : { known: false, n: 0 };
}

/** Actions the platform has no pipeline for (`anonymise`, `archive` — the retention worker implements `delete` only and
 *  says so in its own comment). A scope line promising anonymisation that nothing performs is the same class of lie as a
 *  completed erasure that erased nothing, so the console names them. */
export function hasUnrunnableActions(s: ScopeResult | null | undefined): boolean {
  return !!s && s.kind === 'scope' && s.unrunnable.length > 0;
}

/* ===================== the evidence ledger ===================== */

export const ERASURE_ACTIONS = ['deleted', 'anonymised', 'archived', 'blocked_by_law', 'retracted'] as const;
export type ErasureActionKind = (typeof ERASURE_ACTIONS)[number];

export interface ErasureActionRow {
  dataClass: string; action: string; rowsAffected: number;
  legalBasis: string | null; executedBy: string; executedAt: string | null; note: string | null;
}

export type CompletionCheck =
  | { ok: true; classesEvidenced: number }
  | { ok: false; reason: 'missing_evidence'; missing: string[]; classesInScope: number }
  | { ok: false; reason: 'no_scope' };

/** Whether to OFFER the Complete control.
 *
 *  MAKER-CHECKER BY ABSENCE, applied to a guard rather than to a person: when the erasure is not evidenced the control
 *  is NOT RENDERED, and the missing classes are listed instead. A Complete button that always 409s teaches an operator
 *  that the guard is noise; an absent one beside the list of outstanding classes teaches them what the work is.
 */
export function completeOfferable(c: CompletionCheck | null | undefined, requestType: string): boolean {
  if (requestType !== 'erasure') return true;      // only erasures carry the evidence requirement
  return !!c && c.ok === true;
}

/** How much of the erasure has been evidenced, for the progress line. Guards divide-by-zero (the ADMIN-3c lesson). */
export function evidenceProgressPct(c: CompletionCheck | null | undefined): number {
  if (!c) return 0;
  if (c.ok) return 100;
  if (c.reason !== 'missing_evidence' || c.classesInScope <= 0) return 0;
  const done = c.classesInScope - c.missing.length;
  return Math.max(0, Math.min(100, Math.round((done / c.classesInScope) * 100)));
}

/** `blocked_by_law` is not a failure — it is the record stating we considered a class and the statute forbade deletion.
 *  Styling it red would tell an auditor we failed at something we did correctly. */
export function evidenceClass(action: string): string {
  switch (action) {
    case 'deleted':
    case 'anonymised': return 'kv-status kv-status--ok';
    case 'archived': return 'kv-status kv-status--warn';
    case 'blocked_by_law': return 'kv-status kv-status--muted';
    case 'retracted': return 'kv-status kv-status--danger';
    default: return 'kv-status kv-status--muted';
  }
}

/* ===================== the forms ===================== */

export type RejectResult =
  | { ok: true; value: { action: 'reject'; resolution: string; rejectionGround: RejectionGround } }
  | { ok: false; error: 'ground' | 'resolution' };

/** Rejecting a rights request. The GROUND is checked first and it is mandatory.
 *
 *  Checked first on purpose — the same ordering decision as the crop-calendar's source rule. A rejection with a good
 *  explanation and no lawful ground is unlawful; a rejection with a ground and a thin explanation is merely unhelpful.
 *  Reporting the resolution length first would hide the one that matters.
 */
export function buildReject(raw: { ground?: string; resolution?: string }): RejectResult {
  const ground = (raw.ground ?? '').trim();
  if (!isRejectionGround(ground)) return { ok: false, error: 'ground' };
  const resolution = (raw.resolution ?? '').trim();
  if (resolution.length < 3 || resolution.length > 2000) return { ok: false, error: 'resolution' };
  return { ok: true, value: { action: 'reject', resolution, rejectionGround: ground } };
}

export type RecordActionResult =
  | { ok: true; value: { dataClass: string; action: ErasureActionKind; rowsAffected: number; note?: string } }
  | { ok: false; error: 'dataClass' | 'action' | 'rowsAffected' | 'note' | 'lawMismatch' };

/** Recording what was actually done to one data class.
 *
 *  `lawMismatch` is its own error key rather than a generic one, because it catches the single most consequential
 *  mistake available on this screen: recording a `deleted` against a class the law requires us to keep. The server
 *  refuses it too — this stops the round trip AND tells the operator which rule they hit.
 */
export function buildRecordAction(raw: { dataClass?: string; action?: string; rowsAffected?: string; note?: string }, scope: ScopeResult | null): RecordActionResult {
  const dataClass = (raw.dataClass ?? '').trim();
  if (!/^[a-z0-9_]{2,100}$/.test(dataClass)) return { ok: false, error: 'dataClass' };
  const action = (raw.action ?? '').trim();
  if (!(ERASURE_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: 'action' };

  const line = scope && scope.kind === 'scope' ? scope.lines.find((l) => l.dataClass === dataClass) : undefined;
  if (line) {
    if (line.keptByLaw && action !== 'blocked_by_law') return { ok: false, error: 'lawMismatch' };
    if (!line.keptByLaw && action === 'blocked_by_law') return { ok: false, error: 'lawMismatch' };
  }

  const rawRows = (raw.rowsAffected ?? '').trim();
  // Blank means zero, and zero is LEGITIMATE: a class the farmer had no rows in was still checked, and recording that
  // is the difference between "nothing there" and "never looked".
  if (rawRows && !/^[0-9]{1,10}$/.test(rawRows)) return { ok: false, error: 'rowsAffected' };
  const rowsAffected = rawRows ? Number(rawRows) : 0;

  const note = (raw.note ?? '').trim();
  if (note.length > 1000) return { ok: false, error: 'note' };
  return { ok: true, value: { dataClass, action: action as ErasureActionKind, rowsAffected, ...(note ? { note } : {}) } };
}

/** The queue's type filter. An unrecognised value is dropped rather than passed through — a silently ignored filter
 *  shows a DPO every rights request on the platform while the chip claims one type. */
export function queueTypeFilter(v: string | null | undefined): DsrType | undefined {
  const s = (v ?? '').trim();
  return (DSR_TYPES as readonly string[]).includes(s) ? (s as DsrType) : undefined;
}
export function queueStatusFilter(v: string | null | undefined): DsrStatus | undefined {
  const s = (v ?? '').trim();
  return (DSR_STATUSES as readonly string[]).includes(s) ? (s as DsrStatus) : undefined;
}
