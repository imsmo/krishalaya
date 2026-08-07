// apps/admin-api/src/modules/compliance-ops/domain/posture.ts · W048's compliance overview. Pure, no I/O.
//
// W048 describes itself as "the page a regulator or enterprise buyer would ask to see". That is the whole design
// constraint: every number on it will be read by somebody with an incentive to check it, and the cost of one
// overstated tile is the credibility of the other five.
//
// So the rule here is stricter than elsewhere in the console: a tile whose inputs are incomplete reports INCOMPLETE
// rather than reporting a number. On an operational screen an approximate number is useful; on this one it is a claim.
import { InvalidRetentionPolicyError } from './compliance-ops.errors';

/* ------------------------------------------------------------------------------------------------------------ */
/* THE CERTIFICATION TRACK                                                                                      */
/* ------------------------------------------------------------------------------------------------------------ */

/** W048's own words: "No certification is claimed before it is held — the public trust page mirrors this list
 *  verbatim."
 *
 *  THIS LIST IS THE SOURCE, and that is the point of putting it in code rather than in two hand-maintained pages. Two
 *  lists drift, and the direction that matters is the public one claiming something the internal one does not. A
 *  certification the platform does not hold, stated on a page a buyer reads, is a misrepresentation — not a stale doc.
 */
export const CERTIFICATION_STATES = ['live', 'in_progress', 'planned', 'roadmap'] as const;
export type CertificationState = (typeof CERTIFICATION_STATES)[number];

export interface Certification { code: string; name: string; state: CertificationState; note: string }

export const CERTIFICATIONS: readonly Certification[] = Object.freeze([
  { code: 'dpdp_2023', name: 'DPDP Act 2023', state: 'live', note: 'Operational: rights requests, consent notices, breach register, retention policy.' },
  { code: 'soc2_type1', name: 'SOC 2 Type I', state: 'in_progress', note: 'Target Y2 per the PRD. Not held.' },
  { code: 'iso27001', name: 'ISO 27001', state: 'planned', note: 'Target Y3 per the PRD. Not held.' },
  { code: 'gdpr', name: 'GDPR profile', state: 'roadmap', note: 'With EU entry. Not held, and not required until then.' },
]);

/** Only `live` may ever be presented as held. Written as a function rather than left to each renderer, because the one
 *  mistake this list exists to prevent is a UI treating "in_progress" as a tick. */
export function isHeld(c: Certification): boolean { return c.state === 'live'; }

/** What a public page is allowed to say. Returns the same objects with a boolean nobody can misread — and deliberately
 *  does NOT filter the unheld ones out: a trust page that lists only what we hold looks curated, and one that lists the
 *  roadmap honestly reads as candid. The point is that neither page invents a state. */
export function publicCertificationView(): Array<Certification & { claimable: boolean }> {
  return CERTIFICATIONS.map((c) => ({ ...c, claimable: isHeld(c) }));
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE TILES                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

/** A tile is a number OR a reason there is no number. Never a number with a silent caveat. */
export type Tile =
  | { kind: 'value'; value: number; hint?: string }
  | { kind: 'unavailable'; reason: string };

export function tile(value: number | null | undefined, reasonIfMissing: string, hint?: string): Tile {
  return typeof value === 'number' && Number.isFinite(value)
    ? { kind: 'value', value, ...(hint ? { hint } : {}) }
    : { kind: 'unavailable', reason: reasonIfMissing };
}

/** W048's "Retention jobs (24h) · 61/61 ✓ · 03:00 run clean".
 *
 *  THE TILE THAT CANNOT BE BUILT HONESTLY YET, and it is worth being explicit about why rather than showing a
 *  plausible fraction. `apps/worker/src/jobs/retention-enforcer.job.ts` implements `action='delete'` ONLY — its own
 *  comment says anonymise and archive are "left to their dedicated pipelines (flagged)", and those pipelines do not
 *  exist. Of the thirteen policies 0107 seeded, four are `anonymise` and two are `archive`. A "61/61 ✓" over policies
 *  the platform has no pipeline for would be the single most reassuring false statement on a page written for
 *  regulators.
 */
export interface RetentionCoverage {
  runnable: number;
  unrunnable: number;
  total: number;
  /** The actions with no pipeline, so the screen can name them rather than hint. */
  unrunnableActions: string[];
  complete: boolean;
}

export function retentionCoverage(policies: Array<{ action: string; isActive: boolean }>): RetentionCoverage {
  const live = policies.filter((p) => p.isActive);
  const runnableActions = new Set(['delete', 'keep_forever']);
  const runnable = live.filter((p) => runnableActions.has(p.action));
  const unrunnable = live.filter((p) => !runnableActions.has(p.action));
  return {
    runnable: runnable.length,
    unrunnable: unrunnable.length,
    total: live.length,
    unrunnableActions: Array.from(new Set(unrunnable.map((p) => p.action))).sort(),
    complete: live.length > 0 && unrunnable.length === 0,
  };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* ATTENTION                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

/** W048's "Attention needed" list. Each item is something with a DEADLINE or a BLOCKED LAUNCH behind it — not a
 *  general to-do list, because a page that mixes statutory deadlines with housekeeping trains people to skim both. */
export type AttentionSeverity = 'overdue' | 'due_soon' | 'blocking' | 'info';
export interface AttentionItem { id: string; severity: AttentionSeverity; messageKey: string; params?: Record<string, string>; href?: string }

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { overdue: 0, blocking: 1, due_soon: 2, info: 3 };

/** Overdue first, then blocking, then due-soon. A list that ordered by recency would put a new informational item above
 *  a breach notification window that closed yesterday. */
export function orderAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || a.id.localeCompare(b.id));
}

/** "All quiet" is only claimable when every INPUT was readable.
 *
 *  The same rule as ADMIN-5's clean-record line, and for the same reason: an empty attention list assembled from
 *  registers that failed to load says "nothing needs attention" when the truth is "we could not look". On the page a
 *  regulator asks to see, that distinction is the whole difference.
 */
export function allQuietClaimable(items: AttentionItem[], sourcesRead: { dsr: boolean; breaches: boolean; retention: boolean; consent: boolean }): boolean {
  const everySourceRead = sourcesRead.dsr && sourcesRead.breaches && sourcesRead.retention && sourcesRead.consent;
  return items.length === 0 && everySourceRead;
}

export function assertPostureWindowDays(v: unknown): number {
  const n = Number(v ?? 30);
  if (!Number.isInteger(n) || n < 1 || n > 365) throw new InvalidRetentionPolicyError('window must be a whole number of days between 1 and 365');
  return n;
}
