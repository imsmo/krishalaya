// modules/insurance/domain/insurance.events.ts · integration events published by insurance (via outbox, Law 4).
export const InsuranceEventType = {
  PolicyProposed:  'insurance.policy_proposed',
  PolicyCancelled: 'insurance.policy_cancelled',
  // Reserved for DEV-23+ once premium collection / claims wire these transitions (Law 5: the state machine
  // already defines them; the event names are reserved here so no other batch invents a divergent string):
  PolicyActivated: 'insurance.policy_activated',
  PolicyLapsed:    'insurance.policy_lapsed',
  PolicyExpired:   'insurance.policy_expired',
  PolicyClaimed:   'insurance.policy_claimed',
} as const;
export type DomainEvent = { type: string; payload: Record<string, unknown> };

/** subject_type values (DDL comment, insurance_policies.subject_type): the polymorphic subject a policy covers. */
export const SUBJECT_TYPES = ['crop_season', 'animal', 'equipment', 'person', 'shipment'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/** modules/insurance claims events (DEV-23, KV-BL-054), published via outbox (Law 4). */
export const ClaimEventType = {
  Filed:            'insurance.claim_filed',
  EvidenceAdded:    'insurance.claim_evidence_added',
  DocumentsRequested: 'insurance.claim_documents_requested',
  SurveyScheduled:  'insurance.claim_survey_scheduled',
  Surveyed:         'insurance.claim_surveyed',
  Decided:          'insurance.claim_decided',
  Settled:          'insurance.claim_settled',
  Closed:           'insurance.claim_closed',
} as const;
