// apps/admin-api/src/modules/compliance-ops/domain/erasure-scope.ts · W042's erasure scope preview. Pure, no I/O.
//
// THIS IS THE MOST IMPORTANT SCREEN IN THE COMPLIANCE SUITE, because it is the only place a farmer is told the truth
// about what "delete my data" actually means. W042 puts it plainly: "legal-basis rows are excluded from deletion by law,
// and the farmer is told exactly this in plain language."
//
// The scope is COMPUTED from `data_retention_policies`, never stored as a per-request copy. A stored scope would be a
// snapshot of the law as it was understood when the request was filed, and it would drift silently from the policies the
// executor actually obeys — so a farmer would be shown one thing and have another done. Computing it means the preview
// and the execution read the same rows.
//
// AND THE EMPTY CASE IS A TRAP THAT THIS FILE EXISTS TO AVOID. `data_retention_policies` had NO SEED until 0107 — not
// one row, ever. On an empty table a naive implementation returns an empty list, and an empty scope list on a screen
// headed "Erasure scope preview" reads as "nothing of yours will be kept". That is the opposite of the truth: it means
// nobody has decided what happens to anything. `NO_POLICY` is a distinct, loud state for exactly that reason.
import { InvalidDsrInputError } from './compliance-ops.errors';

/** The four actions `data_retention_policies.action` allows (0015), plus what each means to a person. */
export const RETENTION_ACTIONS = ['delete', 'anonymise', 'archive', 'keep_forever'] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
export function isRetentionAction(v: string): v is RetentionAction {
  return (RETENTION_ACTIONS as readonly string[]).includes(v);
}

export interface RetentionPolicyRow {
  tableName: string;
  action: string;
  legalBasis: string | null;
  activeMonths: number;
  archiveMonths: number | null;
  isActive: boolean;
}

/** One row of W042's scope table. `rows` is null when we have not counted — see `ScopeCounts` below. */
export interface ScopeLine {
  dataClass: string;
  action: RetentionAction;
  legalBasis: string | null;
  /** TRUE when the law forbids deletion. The one column a farmer reads most carefully. */
  keptByLaw: boolean;
  /** How long the class is kept before it is archived or removed, in months. Null for keep_forever. */
  retainedMonths: number | null;
  /** Rows we would touch. NULL means NOT COUNTED, never 0 — see `withCounts`. */
  rows: number | null;
}

export type ScopeResult =
  /** The normal case: a computed scope over configured policies. */
  | { kind: 'scope'; lines: ScopeLine[]; keptByLawCount: number; deletableCount: number; unrunnable: RetentionAction[] }
  /** NO retention policy is configured at all. NOT "nothing will be kept" — nobody has decided anything. */
  | { kind: 'no_policy' }
  /** Policies exist but every one is inactive, which is a configuration state somebody has to explain. */
  | { kind: 'all_inactive'; policyCount: number };

/** Actions the platform has no pipeline for. Read from the worker's own honesty: `retention-enforcer.job.ts`
 *  implements `action='delete'` and says in its comment that anonymise and archive are "left to their dedicated
 *  pipelines (flagged)" — which do not exist. A scope line promising anonymisation that nothing performs is the same
 *  class of lie as a completed erasure that erased nothing, so the console is told which lines are unrunnable. */
export const ACTIONS_WITH_NO_PIPELINE: readonly RetentionAction[] = ['anonymise', 'archive'];
export function actionIsRunnable(a: RetentionAction): boolean {
  // keep_forever is trivially "runnable" — doing nothing is a thing the platform can reliably do.
  return a === 'delete' || a === 'keep_forever';
}

/** `keep_forever` is the only action that keeps data because the law says so. `archive` also keeps it, but temporarily
 *  and by a commercial rule, and telling a farmer their invoices are "kept by law for ever" when they are kept for 72
 *  months would be an overstatement in the direction that makes us look worse and them feel worse. */
export function isKeptByLaw(action: RetentionAction): boolean {
  return action === 'keep_forever';
}

/**
 * Build the scope from the retention policies.
 *
 * Ordered by how a person reads it — what is DELETED first, then anonymised, then archived, then kept for ever — and
 * NOT alphabetically or by row count. A farmer opening this wants "is anything actually going?" answered in the first
 * line, and a scope table that opens with `audit_log · keep_forever` reads as a refusal.
 */
const ACTION_ORDER: Record<RetentionAction, number> = { delete: 0, anonymise: 1, archive: 2, keep_forever: 3 };

export function computeScope(policies: RetentionPolicyRow[]): ScopeResult {
  if (policies.length === 0) return { kind: 'no_policy' };
  const live = policies.filter((p) => p.isActive);
  if (live.length === 0) return { kind: 'all_inactive', policyCount: policies.length };

  const lines: ScopeLine[] = live
    .filter((p) => isRetentionAction(p.action))     // an unknown action is DROPPED, not defaulted to delete
    .map((p) => {
      const action = p.action as RetentionAction;
      return {
        dataClass: p.tableName,
        action,
        legalBasis: p.legalBasis ?? null,
        keptByLaw: isKeptByLaw(action),
        retainedMonths: action === 'keep_forever' ? null : (p.archiveMonths ?? p.activeMonths),
        rows: null,                                  // not counted here; `withCounts` fills it if we counted
      };
    })
    .sort((a, b) => (ACTION_ORDER[a.action] - ACTION_ORDER[b.action]) || a.dataClass.localeCompare(b.dataClass));

  // An unknown action means the CHECK constraint moved ahead of this list. Dropping the line is right — we will not
  // guess what to do with a farmer's data — but it must not be silent, so the caller can see the count did not match.
  const unrunnable = Array.from(new Set(lines.filter((l) => !actionIsRunnable(l.action)).map((l) => l.action)));

  return {
    kind: 'scope',
    lines,
    keptByLawCount: lines.filter((l) => l.keptByLaw).length,
    deletableCount: lines.filter((l) => l.action === 'delete').length,
    unrunnable,
  };
}

/** Row counts per data class, when the caller was able to count them.
 *
 *  A MISSING count stays null and renders as "not counted". It is emphatically not 0: "0 records" beside `kyc_documents`
 *  tells a farmer they have no KYC on file, which for anybody who completed onboarding is false, and it is the kind of
 *  false that makes a person stop trusting the rest of the page.
 */
export type ScopeCounts = Record<string, number>;

export function withCounts(scope: ScopeResult, counts: ScopeCounts): ScopeResult {
  if (scope.kind !== 'scope') return scope;
  return {
    ...scope,
    lines: scope.lines.map((l) => {
      const n = counts[l.dataClass];
      return { ...l, rows: typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null };
    }),
  };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE COMPLETION GUARD — the point of the whole wave                                                           */
/* ------------------------------------------------------------------------------------------------------------ */

export interface RecordedAction { dataClass: string; action: string }

export type CompletionCheck =
  | { ok: true; classesEvidenced: number }
  /** Classes in scope with no recorded action. The erasure has not been performed for these. */
  | { ok: false; reason: 'missing_evidence'; missing: string[]; classesInScope: number }
  /** No scope could be computed, so "every in-scope class is evidenced" is not a question that has an answer. */
  | { ok: false; reason: 'no_scope' };

/**
 * May this erasure be marked `completed`?
 *
 * ONLY IF EVERY IN-SCOPE DATA CLASS HAS A RECORDED ACTION. Today no class ever will, because `identity.erasure_ready`
 * has no consumer and nothing writes `dsr_erasure_actions` — so this function currently REFUSES every erasure
 * completion, and that is the correct behaviour rather than a bug to work around. Before 0107 an operator could set
 * `status = 'completed'` with a free-text resolution while every row still existed; the platform recorded a discharged
 * statutory obligation that had not been discharged. A request honestly stuck in `in_progress` with a list of
 * unevidenced classes is recoverable. A dishonestly `completed` one is not, because nobody ever looks again.
 *
 * `keep_forever` classes STILL NEED A ROW — an `action: 'blocked_by_law'` one. That is deliberate and is the difference
 * between "we considered your ledger history and the RBI requires us to keep it" and "we never got to your ledger
 * history". A farmer is entitled to the first; the second is what silence means.
 */
export function assertErasureCompletable(scope: ScopeResult, recorded: RecordedAction[]): CompletionCheck {
  if (scope.kind !== 'scope') return { ok: false, reason: 'no_scope' };
  // A retracted claim does not count as evidence — that is what retracting it means.
  const evidenced = new Set(recorded.filter((r) => r.action !== 'retracted').map((r) => r.dataClass));
  const missing = scope.lines.map((l) => l.dataClass).filter((c) => !evidenced.has(c));
  if (missing.length > 0) return { ok: false, reason: 'missing_evidence', missing, classesInScope: scope.lines.length };
  return { ok: true, classesEvidenced: evidenced.size };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* REJECTION GROUNDS (W042)                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

/** The three lawful grounds W042 names, and nothing else. Coded because the data principal "receives the grounds
 *  verbatim and can appeal to the Data Protection Board" — a free-text ground is unappealable in practice and
 *  uncountable in aggregate, and an unlawful ground is exactly as easy to type as a lawful one. */
export const REJECTION_GROUNDS = ['identity_unverified', 'legal_hold', 'manifestly_unfounded'] as const;
export type RejectionGround = (typeof REJECTION_GROUNDS)[number];
export function isRejectionGround(v: unknown): v is RejectionGround {
  return typeof v === 'string' && (REJECTION_GROUNDS as readonly string[]).includes(v);
}

/** Which grounds the data principal can do something about. `identity_unverified` is fixable in minutes with an OTP
 *  re-auth; the other two are not fixable by them at all. Collapsing these into "rejected" tells a farmer nothing they
 *  can act on, which is how a lawful rejection becomes a grievance. */
export function groundIsFixableByPrincipal(g: RejectionGround): boolean {
  return g === 'identity_unverified';
}

export function assertRejectionGround(v: unknown): RejectionGround {
  if (!isRejectionGround(v)) {
    throw new InvalidDsrInputError(
      `rejection ground must be one of ${REJECTION_GROUNDS.join('|')} — a rights request may only be refused on a `
      + 'lawful ground, and the data principal receives it verbatim',
    );
  }
  return v;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE SLA CLOCKS (W041)                                                                                        */
/* ------------------------------------------------------------------------------------------------------------ */

/** W041 states them: "SLA: acknowledge 72h, resolve 30d". */
export const ACKNOWLEDGE_HOURS = 72;
export const RESOLVE_DAYS = 30;

export type SlaState =
  | { kind: 'met' }
  | { kind: 'due'; hoursLeft: number }
  | { kind: 'breached'; hoursOver: number }
  /** No acknowledgement timestamp exists for this request. Before 0107 this was EVERY request, and it is not the same
   *  as a met SLA — it is an unmeasured one, which is what a regulator finds first. */
  | { kind: 'unmeasured' };

const HOUR_MS = 3_600_000;

/** The 72-hour acknowledge clock. */
export function acknowledgeSla(createdAt: Date | null, acknowledgedAt: Date | null, now: Date): SlaState {
  if (!createdAt) return { kind: 'unmeasured' };
  const deadline = createdAt.getTime() + ACKNOWLEDGE_HOURS * HOUR_MS;
  if (acknowledgedAt) return acknowledgedAt.getTime() <= deadline ? { kind: 'met' } : { kind: 'breached', hoursOver: Math.ceil((acknowledgedAt.getTime() - deadline) / HOUR_MS) };
  const left = deadline - now.getTime();
  return left >= 0 ? { kind: 'due', hoursLeft: Math.floor(left / HOUR_MS) } : { kind: 'breached', hoursOver: Math.ceil(-left / HOUR_MS) };
}

/** The 30-day resolve clock. An erasure's cooling window is NOT a breach of it — the request is deliberately held open
 *  so the farmer can change their mind, which is a right rather than a delay, and counting it as a breach would create
 *  pressure to shorten the very window that protects them. */
export function resolveSla(createdAt: Date | null, resolvedAt: Date | null, coolingEndsAt: Date | null, now: Date): SlaState {
  if (!createdAt) return { kind: 'unmeasured' };
  const base = createdAt.getTime() + RESOLVE_DAYS * 24 * HOUR_MS;
  // The clock does not start running against us until the cooling window closes.
  const deadline = coolingEndsAt ? Math.max(base, coolingEndsAt.getTime() + RESOLVE_DAYS * 24 * HOUR_MS) : base;
  if (resolvedAt) return resolvedAt.getTime() <= deadline ? { kind: 'met' } : { kind: 'breached', hoursOver: Math.ceil((resolvedAt.getTime() - deadline) / HOUR_MS) };
  const left = deadline - now.getTime();
  return left >= 0 ? { kind: 'due', hoursLeft: Math.floor(left / HOUR_MS) } : { kind: 'breached', hoursOver: Math.ceil(-left / HOUR_MS) };
}

/** W041's "SLA breaches YTD · 0 · clean record". Counted from real clocks, and reporting how many requests could not be
 *  measured at all alongside it — a zero built on unmeasurable requests is not a clean record. */
export interface SlaSummary { breached: number; due: number; met: number; unmeasured: number }
export function summariseSla(states: SlaState[]): SlaSummary {
  const s: SlaSummary = { breached: 0, due: 0, met: 0, unmeasured: 0 };
  for (const x of states) {
    if (x.kind === 'breached') s.breached += 1;
    else if (x.kind === 'due') s.due += 1;
    else if (x.kind === 'met') s.met += 1;
    else s.unmeasured += 1;
  }
  return s;
}
