// modules/insurance/gateway/surveyor-dispatch.port.ts
// Port to an EXTERNAL surveyor-network dispatch/scheduling service (DEV-25, KV-BL-057, Wave 7). When an
// insurer schedules (or RE-schedules, per the claim state machine's own survey_scheduled→survey_scheduled
// reassignment loop — DEV-23's farmer-disagreement re-survey path) a surveyor visit, this port notifies the
// external network so the visit is actually staffed/tracked outside our own user directory. Krishalaya
// owns the CLAIM aggregate + the internal `surveyor_user_id` (an existing platform user); the external
// network is only told WHICH claim/surveyor/visit-window to action — no claimant PII beyond what the
// network needs to route the dispatch.
//
// Mirrors modules/communication/gateway/notification-gateway.port.ts byte-for-byte in shape and honesty
// contract: adapters are resilience-wrapped and DEGRADE (return a 'failed'/'unavailable' outcome) rather
// than throw — a hung 3rd-party network must never cascade into the claim's own already-committed state
// transition (Law 12). No named surveyor-network partner is contracted in this environment (§8).
export const SURVEYOR_DISPATCH_GATEWAY = Symbol('SURVEYOR_DISPATCH_GATEWAY');

export interface SurveyorDispatchInput {
  idempotencyKey: string;         // the external network MUST dedup on this (Law 3)
  tenantId: string;
  claimId: string;
  policyId: string;
  surveyorUserId: string;         // our own platform user id (not the network's own surveyor id)
  isReassignment: boolean;        // true when this rides the survey_scheduled→survey_scheduled re-survey loop
}

export interface SurveyorDispatchResult {
  status: 'dispatched' | 'unavailable';
  providerDispatchRef?: string;
  failureReason?: string;         // present iff status === 'unavailable'
}

export interface SurveyorDispatchGateway {
  readonly providerCode: string;
  dispatch(input: SurveyorDispatchInput): Promise<SurveyorDispatchResult>;
}
