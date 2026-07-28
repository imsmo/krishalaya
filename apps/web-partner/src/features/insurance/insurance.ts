// apps/web-partner/src/features/insurance/insurance.ts · PURE helpers for the INSURER partner console (KV-BL-056,
// DEV-24). Mirrors apps/api's modules/insurance domain EXACTLY (insurance-claim.state.ts / insurance-policy.state.ts
// / insurance-claim-actions.dto.ts) — statuses + transition gates copied verbatim, never invented. No I/O, no React.
// Money is bigint MINOR-UNIT strings (Law 2): the insurer's approved-claim amount is entered as whole rupees and
// converted to paise with BigInt (never a float multiply), same discipline as features/lending/application.ts.
//
// SCOPING NOTE (disclosed, not invented around): unlike fintech's `loan.manage` (RLS-scoped to the lender's OWN
// book), the API's `insurance.manage` permission (apps/api/src/modules/insurance/policies/insurance.policies.ts)
// is TENANT-WIDE — InsuranceClaimRepository.listFor / InsurancePolicyRepository.listFor take NO partnerId filter,
// so an `insurance.manage` caller sees every claim/policy in the tenant regardless of which insurance partner the
// underlying product belongs to. This console reflects that reality (the insurer queue below is the full tenant
// queue) rather than fabricating a per-partner filter the API does not expose.

// ---- claim state machine (mirror insurance-claim.state.ts) --------------------------------------------------------
export const CLAIM_STATUSES = [
  'intimated', 'docs_pending', 'survey_scheduled', 'surveyed',
  'approved', 'partially_approved', 'rejected', 'paid', 'closed',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export function isClaimStatus(v: string | undefined): v is ClaimStatus {
  return !!v && (CLAIM_STATUSES as readonly string[]).includes(v);
}
export function claimStatusKey(status: string): string {
  return isClaimStatus(status) ? `claim.st.${status}` : 'claim.st.unknown';
}
export function claimStatusTone(status: string): 'ok' | 'warn' | 'info' | 'danger' | 'muted' {
  if (status === 'paid' || status === 'closed') return 'ok';
  if (status === 'approved' || status === 'partially_approved') return 'ok';
  if (status === 'rejected') return 'danger';
  if (status === 'surveyed' || status === 'survey_scheduled') return 'info';
  return 'warn'; // intimated / docs_pending
}
export function isClaimTerminal(s: ClaimStatus): boolean {
  return s === 'closed';
}

// ---- insurer-side action gates (mirror InsuranceClaim's own assertTransition calls exactly) -----------------------
/** requestDocuments(): assertTransition(from, 'docs_pending') — only 'docs_pending' is in intimated's next list. */
export function canRequestDocuments(status: ClaimStatus): boolean { return status === 'intimated'; }
/** scheduleSurvey(): assertTransition(from, 'survey_scheduled') — legal wherever 'survey_scheduled' is a next
 *  state: intimated, docs_pending, survey_scheduled (reassign a 2nd surveyor), surveyed (manual re-schedule). */
export function canScheduleSurvey(status: ClaimStatus): boolean {
  return status === 'intimated' || status === 'docs_pending' || status === 'survey_scheduled' || status === 'surveyed';
}
/** recordSurvey(): assertTransition(from, 'surveyed') — only legal once a survey has been scheduled. */
export function canRecordSurvey(status: ClaimStatus): boolean { return status === 'survey_scheduled'; }
/** decide(approved|partially_approved): only 'surveyed' carries those in its next-state list (screen 293's
 *  normal flow: survey -> decide). */
export function canDecideAfterSurvey(status: ClaimStatus): boolean { return status === 'surveyed'; }
/** decide(rejected) early — the domain's own documented "fraud / not-on-cover / duplicate" pre-survey path:
 *  legitimate from intimated OR docs_pending (both carry 'rejected' in their next-state list), in addition to
 *  the normal post-survey reject (canDecideAfterSurvey already covers 'surveyed'). */
export function canRejectEarly(status: ClaimStatus): boolean { return status === 'intimated' || status === 'docs_pending'; }
/** settle(): legal once a positive approvedMinor exists, i.e. approved | partially_approved. */
export function canSettle(status: ClaimStatus): boolean { return status === 'approved' || status === 'partially_approved'; }
/** close(): assertTransition(from, 'closed') — legal from rejected or paid. */
export function canClose(status: ClaimStatus): boolean { return status === 'rejected' || status === 'paid'; }

// ---- policy state (mirror insurance-policy.state.ts; READ-ONLY here — enrol/cancel are the holder's own actions,
// not exposed to the insurer console this batch) --------------------------------------------------------------------
export const POLICY_STATUSES = ['proposed', 'active', 'lapsed', 'cancelled', 'expired', 'claimed'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export function isPolicyStatus(v: string | undefined): v is PolicyStatus {
  return !!v && (POLICY_STATUSES as readonly string[]).includes(v);
}
export function policyStatusKey(status: string): string {
  return isPolicyStatus(status) ? `policy.st.${status}` : 'policy.st.unknown';
}
export function policyStatusTone(status: string): 'ok' | 'warn' | 'info' | 'danger' | 'muted' {
  if (status === 'active') return 'ok';
  if (status === 'proposed') return 'warn';
  if (status === 'claimed') return 'info';
  if (status === 'lapsed' || status === 'cancelled') return 'danger';
  return 'muted'; // expired / unknown
}
export function isOnCover(status: string): boolean { return status === 'active'; }

// ---- money: ₹ whole rupees → paise minor-unit string (BigInt, float-free; mirrors lending/application.ts) --------
const RUPEES_RE = /^\d{1,13}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InsuranceInputError extends Error {
  constructor(public readonly fieldKey: string) { super(fieldKey); this.name = 'InsuranceInputError'; }
}

function rupeesToPaiseMinor(rawRupees: string): string {
  const v = (rawRupees ?? '').trim();
  if (!RUPEES_RE.test(v)) throw new InsuranceInputError('badAmount');
  return (BigInt(v) * 100n).toString();
}

export interface DecideBody { decision: 'approved' | 'partially_approved' | 'rejected'; approvedMinor?: string; note?: string; }
/** Build the decide() body: rejected carries no amount; approved/partially_approved requires a positive ₹ amount
 *  (converted to paise via BigInt). `note` is optional, ≤2000 chars (mirrors DecideClaimSchema). */
export function buildDecide(rawDecision: string, rawRupees: string | undefined, rawNote: string | undefined): DecideBody {
  if (rawDecision !== 'approved' && rawDecision !== 'partially_approved' && rawDecision !== 'rejected') {
    throw new InsuranceInputError('decision');
  }
  const note = (rawNote ?? '').trim();
  if (note.length > 2000) throw new InsuranceInputError('note');
  if (rawDecision === 'rejected') {
    return note ? { decision: 'rejected', note } : { decision: 'rejected' };
  }
  const approvedMinor = rupeesToPaiseMinor(rawRupees ?? '');
  if (BigInt(approvedMinor) <= 0n) throw new InsuranceInputError('badAmount');
  return note ? { decision: rawDecision, approvedMinor, note } : { decision: rawDecision, approvedMinor };
}

export interface ScheduleSurveyBody { surveyorUserId: string; }
/** Build the scheduleSurvey() body: a valid UUID surveyor user id (mirrors ScheduleSurveySchema). */
export function buildScheduleSurvey(rawSurveyorUserId: string): ScheduleSurveyBody {
  const v = (rawSurveyorUserId ?? '').trim();
  if (!UUID_RE.test(v)) throw new InsuranceInputError('surveyorUserId');
  return { surveyorUserId: v };
}

export interface RecordSurveyBody { damagePercent: number; notes?: string; }
/** Build the recordSurvey() body: damagePercent 0-100 (whole or decimal, parsed as a Number — this is a
 *  PERCENTAGE, not money, so a plain float parse is fine here; Law 2 governs money fields only), notes ≤2000
 *  chars (mirrors RecordSurveySchema; `surveyedAt` is left to the server's own `new Date().toISOString()` default). */
export function buildRecordSurvey(rawDamagePercent: string, rawNotes: string | undefined): RecordSurveyBody {
  const n = Number((rawDamagePercent ?? '').trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new InsuranceInputError('damagePercent');
  const notes = (rawNotes ?? '').trim();
  if (notes.length > 2000) throw new InsuranceInputError('notes');
  return notes ? { damagePercent: n, notes } : { damagePercent: n };
}

// ---- list queries (keyset; mirror QueryInsuranceClaimsSchema / QueryInsurancePoliciesSchema) ----------------------
export interface ClaimListQuery { status?: ClaimStatus; policyId?: string; cursor?: string; limit: number; }
export function buildClaimListQuery(raw: { status?: string; policyId?: string; cursor?: string }): ClaimListQuery {
  const status = isClaimStatus(raw.status) ? raw.status : undefined;
  const policyId = (raw.policyId ?? '').trim();
  const cursor = (raw.cursor ?? '').trim() || undefined;
  return { status, policyId: UUID_RE.test(policyId) ? policyId : undefined, cursor, limit: 50 };
}
/** Preserves `policyId` (a context filter set only via the policy-detail "view claims" link, never a user-facing
 *  status chip) alongside status + the keyset cursor. */
export function claimsHref(status?: ClaimStatus, cursor?: string, policyId?: string): string {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (policyId) p.set('policyId', policyId);
  if (cursor) p.set('cursor', cursor);
  const qs = p.toString();
  return qs ? `/insurance-claims?${qs}` : '/insurance-claims';
}

export interface PolicyListQuery { status?: PolicyStatus; cursor?: string; limit: number; }
export function buildPolicyListQuery(raw: { status?: string; cursor?: string }): PolicyListQuery {
  const status = isPolicyStatus(raw.status) ? raw.status : undefined;
  const cursor = (raw.cursor ?? '').trim() || undefined;
  return { status, cursor, limit: 50 };
}
export function policiesHref(status?: PolicyStatus, cursor?: string): string {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (cursor) p.set('cursor', cursor);
  const qs = p.toString();
  return qs ? `/insurance-policies?${qs}` : '/insurance-policies';
}

// ---- read-model types (mirror the insurance claim/policy toJSON shapes) --------------------------------------------
export interface ClaimRow {
  id: string; policyId: string; claimantUserId: string; eventDate: string; description: string | null;
  status: string; approvedMinor: string | null; createdAt?: string;
}
export interface ClaimDetail extends ClaimRow {
  eventTypeId: string; intimatedWithin72h: boolean; surveyorUserId: string | null;
  surveyReport: Record<string, unknown> | null; payoutId: string | null; closedAt: string | null;
}
export interface PolicyRow {
  id: string; holderUserId: string; productId: string; policyNo: string | null; subjectType: string;
  sumInsuredMinor: string; premiumMinor: string; status: string; validFrom: string; validUntil: string; createdAt?: string;
}
