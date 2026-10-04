// modules/ambassadors/domain/ambassadors.events.ts · integration events (via outbox) + vocab.
export const AmbassadorEventType = {
  AmbassadorEnrolled:  'ambassadors.enrolled',
  AmbassadorSuspended: 'ambassadors.suspended',
  ReferralCreated:     'ambassadors.referral_created',
  ReferralActivated:   'ambassadors.referral_activated',
  EarningAccrued:      'ambassadors.earning_accrued',
  EarningsPaidOut:     'ambassadors.earnings_paid_out',
  VisitLogged:         'ambassadors.visit_logged',
  TargetSet:           'ambassadors.target_set',
  AssistedOnboarded:   'ambassadors.assisted_onboarded',
} as const;
export type AmbassadorEventType = (typeof AmbassadorEventType)[keyof typeof AmbassadorEventType];
export type DomainEvent = { type: string; payload: Record<string, unknown> };

export const REFERRAL_STATUSES = ['invited', 'signed_up', 'activated', 'rewarded'] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
/** PC-56 TENANT-SW-b: the member desk's per-person message (mapped to the `ambassador.message` notification, en/hi/gu). */
export const AMBASSADOR_MESSAGE_EVENT = 'ambassadors.message';
