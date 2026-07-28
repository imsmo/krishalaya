// modules/insurance/domain/insurance-policy.state.ts · THE state machine for insurance_policies.status
// (Law 5 — the ONLY place transitions are defined). Statuses copied VERBATIM from the DDL's `policy_status`
// enum (db/migrations/0011_fintech_schemes.sql) — never invented:
//   CREATE TYPE policy_status AS ENUM ('proposed','active','lapsed','cancelled','expired','claimed');
//
// Transition rules are not in the DDL (an enum carries no transition graph) — derived from canon screens
// 282-287's own text, cited per transition below, and kept deliberately conservative:
//   - screen 283: "Policy starts as proposed and becomes active once your ₹X is paid" → proposed→active is a
//     real, screen-confirmed transition, but the ACT of paying (premium collection) is KV-BL-053/DEV-23's job,
//     strictly sequenced after this batch (051→052→053→054, 02_BACKEND_BACKLOG.md §E5). This batch defines the
//     transition here (Law 5: one true source) but does NOT wire a controller endpoint to it — DEV-23 calls
//     InsurancePolicy.activate() once premium collection lands.
//   - screen 283's enrol cutoff ("Enroll by 31 Jul 2026") → proposed→expired (the enrolment window lapses
//     before the farmer pays) is real but, like activate(), not wired to an endpoint this batch (no scheduled
//     job exists yet to fire it — flagged as follow-up, not invented as live behaviour).
//   - screen 287: a distinct "Cancelled" example card exists (proposed/active→cancelled = withdraw/surrender).
//     THIS batch wires proposed→cancelled (withdraw before payment); active→cancelled (surrender) is left in
//     the map for completeness (schema-correct) but not exposed via HTTP this batch — surrender flow is
//     screen 473 ("policy-cancel-surrender"), explicitly out of scope (canon cites it as "illustrative only").
//   - screen 286/287: "ends 30 Nov 2026 … no auto-renewal, you decide each season" → active→expired is natural
//     end-of-season expiry (terminal; renewal is a NEW enrolment/policy, never a transition of this row).
//   - screen 287: "Lapsed … Renew for Kharif 2026?" → active→lapsed (premium/renewal missed); renewal is again
//     a NEW policy, so lapsed is terminal-except-cancel here (no invented reinstatement rule).
//   - active→claimed is the mirror of insurance_claims reaching a paid/closed outcome — DEV-23/24's claims
//     state machine owns firing it; defined here for Law-5 completeness, not wired to an endpoint this batch.
import { DomainError } from '../../../shared/errors/app-error';

export const POLICY_STATUSES = ['proposed', 'active', 'lapsed', 'cancelled', 'expired', 'claimed'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

const TRANSITIONS: Readonly<Record<PolicyStatus, readonly PolicyStatus[]>> = Object.freeze({
  proposed:  ['active', 'cancelled', 'expired'],
  active:    ['lapsed', 'expired', 'cancelled', 'claimed'],
  lapsed:    ['cancelled'],
  cancelled: [],
  expired:   [],
  claimed:   [],
});

export class IllegalPolicyTransitionError extends DomainError {
  constructor(from: string, to: string) { super('INSURANCE_POLICY_ILLEGAL_TRANSITION', `Cannot move insurance policy ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: PolicyStatus, to: PolicyStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: PolicyStatus, to: PolicyStatus): void { if (!canTransition(from, to)) throw new IllegalPolicyTransitionError(from, to); }
export function allowedNext(from: PolicyStatus): readonly PolicyStatus[] { return TRANSITIONS[from] ?? []; }
export function isTerminal(s: PolicyStatus): boolean { return TRANSITIONS[s]?.length === 0; }
/** Only an active policy is currently on-cover (screen 286's "what this policy covers" only renders live). */
export function isOnCover(status: PolicyStatus): boolean { return status === 'active'; }
