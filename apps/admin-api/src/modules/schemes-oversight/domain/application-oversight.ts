// apps/admin-api/src/modules/schemes-oversight/domain/application-oversight.ts · W074's pipeline rules. Pure, no I/O.
//
// W074 is a 9-state machine with a tab bar of counts, three filters, and a column of AI eligibility scores. The states
// are the DB enum (0011) verbatim — this module does not define a parallel list, it mirrors one and says so, because
// two lists of the same nine strings is how the tenth arrives in one of them.
import { InvalidOversightQueryError } from './schemes-oversight.errors';

/** The `application_status` enum from 0011, in the order W074's tab bar shows them (lifecycle order, not enum order —
 *  the enum has `rejected` before `disbursed`, which is right for storage and wrong for a pipeline an operator reads
 *  left to right). */
export const APPLICATION_STATES = [
  'draft', 'submitted', 'under_verification', 'clarification_needed', 'approved', 'disbursed', 'closed', 'rejected', 'appealed',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];
export function isApplicationState(v: string): v is ApplicationState {
  return (APPLICATION_STATES as readonly string[]).includes(v);
}

/** States where the platform is waiting on somebody INSIDE the system — the ones an operator can move today. Used to
 *  order the tab bar's emphasis, never to hide the others: W074's own empty state points out that
 *  "approved/disbursed tabs keep history". */
export const ACTIONABLE_STATES: readonly ApplicationState[] = ['submitted', 'under_verification', 'clarification_needed'];

/** Status pill class. `clarification_needed` is a WARNING and not a failure: the ball is with the farmer and the
 *  application is alive. `rejected` is muted rather than red — it is a finished outcome, and a wall of red on a
 *  history tab trains operators to ignore red. */
export function statusClass(s: string): string {
  switch (s) {
    case 'approved':
    case 'disbursed': return 'kv-status kv-status--ok';
    case 'clarification_needed': return 'kv-status kv-status--warn';
    case 'rejected': return 'kv-status kv-status--muted';
    case 'closed': return 'kv-status kv-status--muted';
    case 'appealed': return 'kv-status kv-status--warn';
    default: return 'kv-status';
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE TAB COUNTS                                                                                               */
/* ------------------------------------------------------------------------------------------------------------ */

/** Counts per state, plus the ones we could not get.
 *
 *  `null` for a state means THE COUNT IS UNKNOWN, and it is not the same as 0. The counts query is a separate
 *  cross-tenant aggregate that can fail on its own (Law 12, degrade-never-die), and a chip reading "0" beside a tab
 *  that has 1,842 applications in it is worse than a chip with no number: an operator skips the tab.
 */
export type StateCounts = Partial<Record<ApplicationState, number>>;

export function countsFrom(rows: Array<{ status: string; n: number }>): StateCounts {
  const out: StateCounts = {};
  for (const r of rows) {
    if (!isApplicationState(r.status)) continue;   // an unknown status is dropped, not summed into a neighbour
    const n = Number.isFinite(r.n) && r.n > 0 ? Math.floor(r.n) : 0;
    out[r.status] = (out[r.status] ?? 0) + n;
  }
  // Every KNOWN state the query returned is present, including at 0 — a state the aggregate reported as zero really is
  // zero. States the query did not mention are left ABSENT, which the console renders as "unknown", not as 0.
  return out;
}

/** Total across the states we know about. Null when we know nothing, so the "All" chip can be blank rather than 0. */
export function totalCount(c: StateCounts): number | null {
  const vals = APPLICATION_STATES.map((s) => c[s]).filter((v): v is number => typeof v === 'number');
  return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE AI ELIGIBILITY COLUMN                                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

/** W074 shows "eligible · 0.96", "eligible · 0.91", "uncertain · 0.58 → ambassador".
 *
 *  `scheme_applications.eligibility_check` is a free-form jsonb blob written by `Scheme.evaluate`, so this reads
 *  defensively and reports what it actually found. THE STATES ARE THREE, and the third one is the point: a row with no
 *  check at all is NOT "ineligible" and NOT 0.0 — it is an application nobody ran a check against, which is a fact
 *  about our pipeline rather than about the farmer.
 */
export type EligibilityView =
  | { kind: 'scored'; eligible: boolean; score: number }
  | { kind: 'unscored'; eligible: boolean }
  | { kind: 'never_checked' };

export function eligibilityView(check: unknown): EligibilityView {
  if (check === null || check === undefined || typeof check !== 'object' || Array.isArray(check)) return { kind: 'never_checked' };
  const o = check as Record<string, unknown>;
  if (Object.keys(o).length === 0) return { kind: 'never_checked' };
  const eligible = o.eligible === true;
  const raw = o.score ?? o.confidence;
  // A score outside 0..1 is treated as ABSENT rather than clamped. Clamping a 47 to 1.0 would render "eligible · 1.00",
  // the most confident cell on the screen, out of the most obviously broken value.
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1) {
    return { kind: 'scored', eligible, score: Math.round(raw * 100) / 100 };
  }
  return { kind: 'unscored', eligible };
}

/** Below this the canon routes the application to an ambassador ("uncertain · 0.58 → ambassador"). A THRESHOLD FOR A
 *  LABEL ONLY — nothing here routes anything, and no work is created by this module. Naming it as a constant rather
 *  than inlining 0.7 in a template is so that the day it becomes a real routing rule, there is one place to change. */
export const AMBASSADOR_REVIEW_BELOW = 0.7;
export function needsHumanLook(v: EligibilityView): boolean {
  return v.kind === 'scored' ? v.score < AMBASSADOR_REVIEW_BELOW : true;   // unscored and never-checked both need eyes
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE FILTERS                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

export interface OversightFilters {
  status?: ApplicationState;
  schemeId?: string;
  tenantId?: string;
  /** W074's "Assisted only" toggle → `assisted_by IS NOT NULL`. */
  assistedOnly?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate the query. THROWS on a bad status rather than silently ignoring it — an ignored filter shows an operator
 *  the whole platform's applications while the chip says "clarification_needed", and they will act on what they see. */
export function assertFilters(q: { status?: string; schemeId?: string; tenantId?: string; assistedOnly?: string | boolean }): OversightFilters {
  const out: OversightFilters = {};
  if (q.status !== undefined && q.status !== '' && q.status !== 'all') {
    if (!isApplicationState(q.status)) throw new InvalidOversightQueryError(`status must be one of ${APPLICATION_STATES.join('|')}`);
    out.status = q.status;
  }
  for (const [k, v] of [['schemeId', q.schemeId], ['tenantId', q.tenantId]] as const) {
    if (v !== undefined && v !== '') {
      if (!UUID_RE.test(v)) throw new InvalidOversightQueryError(`${k} must be a uuid`);
      (out as Record<string, unknown>)[k] = v;
    }
  }
  if (q.assistedOnly === true || q.assistedOnly === 'true') out.assistedOnly = true;
  else if (q.assistedOnly !== undefined && q.assistedOnly !== '' && q.assistedOnly !== 'false') {
    throw new InvalidOversightQueryError('assistedOnly must be true or false');
  }
  return out;
}

/** W074's lead line claims "61% filed ambassador-assisted". Derived, with its denominator, and null on an empty
 *  window — a headline share of an empty set is the easiest wrong number to publish. */
export function assistedShare(assisted: number, total: number): { pct: number | null; assisted: number; total: number } {
  if (!Number.isFinite(total) || total <= 0) return { pct: null, assisted: Math.max(0, assisted || 0), total: 0 };
  return { pct: Math.round((assisted / total) * 1000) / 10, assisted, total };
}
