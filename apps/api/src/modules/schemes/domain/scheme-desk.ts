// modules/schemes/domain/scheme-desk.ts · PC-56 TENANT-SW-b · D — THE SCHEMES DESK (W202 / W203), AS RULES. PURE.
//
// "Who qualifies?" is a query, not a guess (canon W202): the eligibility sweep evaluates a scheme's machine-readable rules over the tenant's
// members through the SAME per-person evaluator the eligibility checker uses (Scheme.evaluate) — and produces a CALL LIST, never an
// application ("The eligibility sweep never auto-applies: it produces a call list, and a human asks the member first").
// Every figure on the desk is read: benefits landed = SUM of DBT transfers credited in the Indian financial year (April–March, IST), net of
// bounces that were not re-credited — a FACT with its method printed; with no transfer recorded it says so, never ₹0 as a claim.
import { ApplicantProfile } from './schemes.events';

/** The Indian financial year containing `now` (IST): [YYYY-04-01, (YYYY+1)-04-01). */
export function fyBounds(now: Date): { start: string; end: string; label: string } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear(); const m = ist.getUTCMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-04-01`, label: `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}` };
}
export const BENEFITS_METHOD = 'SUM(dbt_transfers.amount_minor) credited_on within the financial year (April–March, IST), minus transfers with an open or abandoned bounce (dbt_bounces); a re-credit counts as its own transfer.';

/** The pipeline tabs (W203). Three of them are routed to `chain-mutate:scheme` in the canon (F-22 defect) — here they are filters. */
export const PIPELINE_GROUPS = ['under_verification', 'clarification_needed', 'submitted', 'draft', 'approved_disbursed_fy', 'rejected_appealed'] as const;
export type PipelineGroup = (typeof PIPELINE_GROUPS)[number];
export function groupStatuses(g: PipelineGroup): string[] {
  if (g === 'approved_disbursed_fy') return ['approved', 'disbursed'];
  if (g === 'rejected_appealed') return ['rejected', 'appealed'];
  return [g];
}

export type BlockerCode = 'not_submitted' | 'awaiting_verification' | 'authority_queue' | 'clarification_needed' | 'awaiting_dbt' | 'rejected' | 'appeal_pending' | 'dbt_bounced';
export interface Blocker { code: BlockerCode; note: string | null; reasonCode: string | null }
/** The "Blocker" column, derived from the state machine + the last clarification note + an open DBT bounce — never typed by anyone. */
export function deriveBlocker(app: { status: string; rejectionReasonCode: string | null; clarificationNote: string | null; openBounceReason: string | null }): Blocker | null {
  if (app.openBounceReason) return { code: 'dbt_bounced', note: null, reasonCode: app.openBounceReason };
  switch (app.status) {
    case 'draft': return { code: 'not_submitted', note: null, reasonCode: null };
    case 'submitted': return { code: 'awaiting_verification', note: null, reasonCode: null };
    case 'under_verification': return { code: 'authority_queue', note: null, reasonCode: null };
    case 'clarification_needed': return { code: 'clarification_needed', note: app.clarificationNote, reasonCode: null };
    case 'approved': return { code: 'awaiting_dbt', note: null, reasonCode: null };
    case 'rejected': return { code: 'rejected', note: null, reasonCode: app.rejectionReasonCode };
    case 'appealed': return { code: 'appeal_pending', note: null, reasonCode: app.rejectionReasonCode };
    default: return null;   // disbursed / closed: nothing blocks
  }
}

/** Land area → acres, only for units this platform can convert honestly. Anything else is UNKNOWN (the evaluator then skips the rule). */
const ACRES_PER: Record<string, number> = { acre: 1, acres: 1, ac: 1, hectare: 2.47105, hectares: 2.47105, ha: 2.47105 };
export function landAcres(parcels: Array<{ value: number | string | null; unit: string | null }>): number | undefined {
  let total = 0; let known = false;
  for (const p of parcels) {
    const per = ACRES_PER[(p.unit ?? '').trim().toLowerCase()];
    const v = Number(p.value);
    if (per === undefined || !Number.isFinite(v)) return undefined;     // one unconvertible parcel makes the holding unknown, not smaller
    total += v * per; known = true;
  }
  return known ? Math.round(total * 100) / 100 : undefined;
}
/** Whole years between a date of birth and `asOf` (IST calendar). */
export function ageOn(dob: string | null, asOf: Date): number | undefined {
  if (!dob) return undefined;
  const d = String(dob).slice(0, 10);
  const today = new Date(asOf.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  let age = +today.slice(0, 4) - +d.slice(0, 4);
  if (today.slice(5) < d.slice(5)) age--;
  return age >= 0 && age < 150 ? age : undefined;
}
/** The profile the per-person evaluator reads, from what the platform records about a member (unknown attributes stay undefined). */
export function memberProfile(m: { roles: string[]; gender: string | null; dob: string | null; parcels: Array<{ value: number | string | null; unit: string | null }> }, asOf: Date): { profile: ApplicantProfile; inputs: Record<string, unknown> } {
  const landholdingAcres = m.parcels.length > 0 ? landAcres(m.parcels) : undefined;
  const age = ageOn(m.dob, asOf);
  const gender = m.gender === 'male' || m.gender === 'female' || m.gender === 'other' ? m.gender : undefined;
  return {
    profile: { roles: m.roles, landholdingAcres, gender, age },
    inputs: { roles: m.roles, landholdingAcres: landholdingAcres ?? null, landholdingKnown: landholdingAcres !== undefined, genderKnown: gender !== undefined, ageKnown: age !== undefined },
  };
}
/** "Waiting" in whole days since the application last changed state. */
export function waitingDays(since: Date, now: Date): number { return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000)); }
export const MIN_REVEAL_REASON = 20;
