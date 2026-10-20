// modules/partner-api/domain/partner-webhook-projection.ts · PC-56 PARTNER-3a (founder Q7; survey F-3 / C-7 / C-8, P3-B2) — WHAT A PARTNER
// WEBHOOK MAY CARRY. PURE (no I/O).
//
// Ownership routing (partner-webhook.rules.ts) decides WHO is told; this file decides WHAT they are told. Before PARTNER-3a the fanout handed
// a partner the raw outbox payload (`data: event.payload`) — which for the insurer carried the claimant's user id, the survey report with its
// free-text notes, the decision note and the policy's payment id, though the console never shows any of them. Now every partner-bound payload
// is PROJECTED before enqueue through an allow-list PER EVENT TYPE: ids, statuses, event type codes, amounts as minor-unit strings,
// timestamps — and nothing else. Every value is TYPE-CHECKED as well as named (an id is a uuid, a status is a word of the platform's own state
// machine, an amount is an integer string, a timestamp an ISO instant), so a field that kept its name but changed its content cannot carry a
// person through. An event type with no projection answers `{}` — never the raw payload. Never a user id (`claimantUserId`,
// `applicantUserId`, `holderUserId`, `surveyorUserId`), a note, a report, a payment id, a description, a subject.
import { CLAIM_STATUSES } from '../../insurance/domain/insurance-claim.state';
import { POLICY_STATUSES } from '../../insurance/domain/insurance-policy.state';
import { APP_STATUSES } from '../../fintech/domain/loan-application.state';
import { LOAN_STATUSES } from '../../fintech/domain/loan.state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINOR = /^-?\d{1,19}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
/** A `claim_event` CODE as the platform vocabulary writes it (seed 0005: drought, flood, hail, pest, death, theft, fire, accident) — a short
 *  lower-case word, never free text. */
const EVENT_CODE = /^[a-z][a-z_]{1,39}$/;

type Kind = 'id' | 'minor' | 'iso' | 'eventCode' | 'claimStatus' | 'policyStatus' | 'appStatus' | 'loanStatus' | 'version';
const ok: Readonly<Record<Kind, (v: unknown) => boolean>> = Object.freeze({
  id: (v) => typeof v === 'string' && UUID.test(v),
  minor: (v) => typeof v === 'string' && MINOR.test(v),
  iso: (v) => typeof v === 'string' && ISO.test(v),
  eventCode: (v) => typeof v === 'string' && EVENT_CODE.test(v),
  claimStatus: (v) => typeof v === 'string' && (CLAIM_STATUSES as readonly string[]).includes(v),
  policyStatus: (v) => typeof v === 'string' && (POLICY_STATUSES as readonly string[]).includes(v),
  appStatus: (v) => typeof v === 'string' && (APP_STATUSES as readonly string[]).includes(v),
  loanStatus: (v) => typeof v === 'string' && (LOAN_STATUSES as readonly string[]).includes(v),
  version: (v) => Number.isInteger(v) && (v as number) > 0 && (v as number) < 100,
});

/** One output field: where it is read from in the payload (a top-level key, or `[key, subKey]` for one level of nesting) and its type. */
interface FieldSpec { from: string | readonly [string, string]; kind: Kind }
interface Projection { fields: Readonly<Record<string, FieldSpec>>; /** a status the event itself states (the event's name IS the transition). */ status?: string }

const f = (from: FieldSpec['from'], kind: Kind): FieldSpec => ({ from, kind });
const V = { v: f('v', 'version') } as const;

/** THE ALLOW-LIST — one entry per partner-deliverable event type (partner-webhook.rules.ts PARTNER_WEBHOOK_EVENTS, pinned equal by the spec). */
export const PARTNER_PAYLOAD_PROJECTIONS: Readonly<Record<string, Projection>> = Object.freeze({
  // lending servicing
  'fintech.loan_disbursed': { fields: { ...V, applicationId: f('applicationId', 'id'), loanId: f('loanId', 'id'), from: f('from', 'appStatus'), to: f('to', 'appStatus'),
    amountApprovedMinor: f('amountApprovedMinor', 'minor') } },
  'fintech.loan_repaid': { fields: { ...V, loanId: f('loanId', 'id'), amountMinor: f('amountMinor', 'minor'), outstandingMinor: f('outstandingMinor', 'minor'),
    status: f('status', 'loanStatus') } },
  'fintech.loan_closed': { fields: { ...V, loanId: f('loanId', 'id') }, status: 'closed' },
  // the insurance book — `policy_activated` carried the payment id (survey C-8): never again
  'insurance.policy_activated': { fields: { ...V, policyId: f('policyId', 'id') }, status: 'active' },
  'insurance.policy_cancelled': { fields: { ...V, policyId: f('policyId', 'id'), from: f('from', 'policyStatus') }, status: 'cancelled' },
  'insurance.policy_claimed': { fields: { ...V, policyId: f('policyId', 'id'), from: f('from', 'policyStatus') }, status: 'claimed' },
  // claims — never the claimant, the description, the survey report (nor its notes), the surveyor, the decision note
  'insurance.claim_filed': { fields: { ...V, claimId: f('claimId', 'id'), policyId: f('policyId', 'id'), eventTypeCode: f('eventTypeCode', 'eventCode') }, status: 'intimated' },
  'insurance.claim_surveyed': { fields: { ...V, claimId: f('claimId', 'id'), surveyedAt: f(['surveyReport', 'surveyedAt'], 'iso') }, status: 'surveyed' },
  'insurance.claim_decided': { fields: { ...V, claimId: f('claimId', 'id'), status: f('decision', 'claimStatus'), approvedMinor: f('approvedMinor', 'minor') } },
  'insurance.claim_settled': { fields: { ...V, claimId: f('claimId', 'id'), approvedMinor: f('approvedMinor', 'minor') }, status: 'paid' },
  'insurance.claim_closed': { fields: { ...V, claimId: f('claimId', 'id') }, status: 'closed' },
});

/** The payload a partner endpoint receives for this event: the allow-listed, type-checked fields only; `{}` for an event type with no
 *  projection (never the raw payload). Pure; never throws (a malformed payload simply projects fewer fields). */
export function projectPartnerPayload(eventType: string, payload: unknown): Record<string, string | number> {
  const p = Object.prototype.hasOwnProperty.call(PARTNER_PAYLOAD_PROJECTIONS, eventType) ? PARTNER_PAYLOAD_PROJECTIONS[eventType] : null;
  if (!p) return {};
  const src = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
  const out: Record<string, string | number> = {};
  for (const [name, spec] of Object.entries(p.fields)) {
    let v: unknown;
    if (typeof spec.from === 'string') v = src[spec.from];
    else {
      const inner = src[spec.from[0]];
      v = inner && typeof inner === 'object' && !Array.isArray(inner) ? (inner as Record<string, unknown>)[spec.from[1]] : undefined;
    }
    if (ok[spec.kind](v)) out[name] = v as string | number;
  }
  if (p.status && out.status === undefined) out.status = p.status;
  return out;
}
