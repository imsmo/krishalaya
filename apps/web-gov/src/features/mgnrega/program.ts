// apps/web-gov/src/features/mgnrega/program.ts · PURE gates + builders for GW-5 (PC-55 B2).
// Framework-free, so the statutory arithmetic the console DISPLAYS is unit-provable. The API computes the clock
// authoritatively (labour/domain/mgnrega.rules.ts); these helpers only shape and label it, and where a number is
// re-derived here the spec pins it to the same boundaries so the two can never drift apart by a day.

export const DEMAND_STATUSES = ['demanded', 'allotted', 'withdrawn', 'closed'] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];
export function isDemandStatus(v: string | undefined | null): v is DemandStatus {
  return !!v && (DEMAND_STATUSES as readonly string[]).includes(v);
}

export const WORK_STATUSES = ['planned', 'active', 'completed', 'suspended'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];
export function isWorkStatus(v: string | undefined | null): v is WorkStatus {
  return !!v && (WORK_STATUSES as readonly string[]).includes(v);
}

export const EXPORT_REPORTS = ['job_cards', 'works', 'demands'] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];
export function isExportReport(v: string | undefined | null): v is ExportReport {
  return !!v && (EXPORT_REPORTS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// How a demand row is DISPLAYED
// ---------------------------------------------------------------------------
export interface DemandRow {
  status?: string | null; demandedOn?: string | null; dueBy?: string | null;
  daysUntilDue?: number | null; overdue?: boolean | null; allowanceDue?: boolean | null;
  allottedWorkId?: string | null;
}

/** The three states a reader must be able to tell apart at a glance:
 *  • 'overdue'  — the 15 days have passed with no work. The state owes an unemployment allowance.
 *  • 'due_soon' — 3 days or fewer remain. Worth acting on today.
 *  • 'open' / 'closed' — everything else.
 *  Anything the API did not tell us (a missing `overdue`) is NOT guessed into 'open': we re-derive from
 *  daysUntilDue when present, and otherwise say 'open' only because the row is still 'demanded'. */
export function demandUrgency(d: DemandRow): 'overdue' | 'due_soon' | 'open' | 'closed' {
  if (d.status !== 'demanded') return 'closed';
  if (d.overdue === true) return 'overdue';
  const left = typeof d.daysUntilDue === 'number' ? d.daysUntilDue : null;
  if (left !== null && left < 0) return 'overdue';
  if (left !== null && left <= 3) return 'due_soon';
  return 'open';
}

/** Allotment is offered only on an open demand — mirroring the API (canAllotDemand). */
export function canAllot(d: DemandRow): boolean { return d.status === 'demanded'; }
export function canEnd(d: DemandRow): boolean { return d.status === 'demanded'; }

export type DemandFormResult =
  | { ok: true; value: { jobCardId: string; demandedOn: string; daysRequested: number; applicants?: number; note?: string } }
  | { ok: false; error: 'jobCard' | 'date' | 'future' | 'days' | 'applicants' };

/** Build the demand write. The date is the day the HOUSEHOLD asked, never "today" — that date starts the legal
 *  clock, so a desk operator entering last week's demand must be able to say so, and a future date is refused
 *  because a clock cannot start before the ask. */
export function buildDemand(raw: { jobCardId: string; demandedOn: string; daysRequested: string; applicants: string; note: string }, todayIso: string): DemandFormResult {
  const jobCardId = raw.jobCardId.trim();
  if (!/^[0-9a-fA-F-]{36}$/.test(jobCardId)) return { ok: false, error: 'jobCard' };
  const demandedOn = raw.demandedOn.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(demandedOn)) return { ok: false, error: 'date' };
  if (demandedOn > todayIso) return { ok: false, error: 'future' };
  // Digits ONLY: Number.parseInt('10.5') would be 10, silently recording a different entitlement than the one the
  // operator typed. A statutory day count must never be truncated behind someone's back.
  const daysRaw = raw.daysRequested.trim();
  if (!/^\d{1,3}$/.test(daysRaw)) return { ok: false, error: 'days' };
  const daysRequested = Number.parseInt(daysRaw, 10);
  if (daysRequested < 1 || daysRequested > 100) return { ok: false, error: 'days' };
  const out: { jobCardId: string; demandedOn: string; daysRequested: number; applicants?: number; note?: string } = { jobCardId, demandedOn, daysRequested };
  const applicantsRaw = raw.applicants.trim();
  if (applicantsRaw) {
    if (!/^\d{1,2}$/.test(applicantsRaw)) return { ok: false, error: 'applicants' };
    const applicants = Number.parseInt(applicantsRaw, 10);
    if (applicants < 1 || applicants > 20) return { ok: false, error: 'applicants' };
    out.applicants = applicants;
  }
  const note = raw.note.trim();
  if (note) out.note = note.slice(0, 2000);
  return { ok: true, value: out };
}

export type AllotResult =
  | { ok: true; value: { to: 'allotted'; workId: string; allottedOn?: string } }
  | { ok: true; value: { to: 'withdrawn' | 'closed'; reason?: string } }
  | { ok: false; error: 'to' | 'workId' | 'reason' };

/** Allotment MUST name a work (the API and 0091's CHECK both refuse an empty promise), and closing a demand
 *  without work MUST carry a reason — that record is the household's only account of what happened to a right
 *  they exercised. A withdrawal is the household's own act, so its reason is optional. */
export function buildDemandTransition(raw: { to: string; workId: string; allottedOn: string; reason: string }): AllotResult {
  const reason = raw.reason.trim();
  if (raw.to === 'allotted') {
    const workId = raw.workId.trim();
    if (!/^[0-9a-fA-F-]{36}$/.test(workId)) return { ok: false, error: 'workId' };
    const allottedOn = raw.allottedOn.trim();
    return { ok: true, value: allottedOn ? { to: 'allotted', workId, allottedOn } : { to: 'allotted', workId } };
  }
  if (raw.to === 'withdrawn') return { ok: true, value: reason ? { to: 'withdrawn', reason } : { to: 'withdrawn' } };
  if (raw.to === 'closed') {
    if (!reason) return { ok: false, error: 'reason' };
    return { ok: true, value: { to: 'closed', reason } };
  }
  return { ok: false, error: 'to' };
}

// ---------------------------------------------------------------------------
// Honest labelling of the state ledger + the 100-day cap
// ---------------------------------------------------------------------------
export interface StateLedgerFacts { available?: boolean | null; provider?: string | null; note?: string | null; fetchedAt?: string | null }

/** What the console may claim about the numbers on screen.
 *  'platform_only' — no state sync is wired/available, so these are OUR observations and nothing more.
 *  'synced'        — a real provider answered, so a mirrored figure exists alongside ours.
 *  Never a third, comfortable state: an unavailable provider must not read as "up to date". */
export function ledgerClaim(s: StateLedgerFacts | undefined | null): 'platform_only' | 'synced' {
  return s?.available === true ? 'synced' : 'platform_only';
}

/** The cap presentation for a card ledger: whichever count is HIGHER protects the worker's 100-day cap, which is
 *  exactly what the API's daysRemaining does — re-derived here only to render the two numbers side by side. */
export function capView(observedDays: number, mirroredDays: number | null, guaranteeDays = 100): { usedForCap: number; remaining: number; higher: 'platform' | 'state' | 'equal' } {
  const mirrored = mirroredDays ?? 0;
  const usedForCap = Math.max(observedDays, mirrored);
  const higher = observedDays > mirrored ? 'platform' : mirrored > observedDays ? 'state' : 'equal';
  return { usedForCap, remaining: Math.max(0, guaranteeDays - Math.floor(usedForCap)), higher };
}

/** Sum a works-by-status map without inventing a total for statuses we did not receive. */
export function totalWorks(works: Record<string, number> | undefined | null): number {
  if (!works) return 0;
  return Object.values(works).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}
