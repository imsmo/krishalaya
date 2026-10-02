// modules/requirements/domain/requirements.events.ts · integration events (via outbox, Law 4).
export const RequirementEventType = {
  Posted:           'requirements.requirement_posted',
  Updated:          'requirements.requirement_updated',
  PartiallyMatched: 'requirements.requirement_partially_matched',
  Matched:          'requirements.requirement_matched',    // a freshly-published listing matches this OPEN requirement → nudge the buyer
  Fulfilled:        'requirements.requirement_fulfilled',
  Expired:          'requirements.requirement_expired',
  Closed:           'requirements.requirement_closed',
  ReminderDue:      'requirements.requirement_reminder',    // worker nudge: your OPEN requirement is approaching need_by
} as const;
export const ResponseEventType = {
  Submitted:   'requirements.response_submitted',
  Shortlisted: 'requirements.response_shortlisted',
  Accepted:    'requirements.quote_accepted',   // a quote is accepted → orders may create the order (downstream, Law 11)
  Rejected:    'requirements.response_rejected',
  Expired:     'requirements.response_expired',
} as const;
/** PC-56 TENANT-11d · the pooled quote (F-11). `requirement.group_quoted` reaches the buyer (catalogue 0189, copy seed 0007). */
export const GroupEventType = {
  Quoted:    'requirement.group_quoted',
  Accepted:  'requirements.group_accepted',
  Rejected:  'requirements.group_rejected',
  Withdrawn: 'requirements.group_withdrawn',
} as const;
export type DomainEvent = { type: string; payload: Record<string, unknown> };
