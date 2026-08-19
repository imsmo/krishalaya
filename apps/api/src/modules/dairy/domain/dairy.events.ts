// modules/dairy/domain/dairy.events.ts · integration events published by dairy (via outbox, Law 4).
export const DairyEventType = {
  MccCreated:        'dairy.mcc_created',
  MembershipCreated: 'dairy.membership_created',
  RateCardCreated:   'dairy.rate_card_created',
  CollectionRecorded:'dairy.collection_recorded',
  BillGenerated:     'dairy.bill_generated',
  BillPreviewed:     'dairy.bill_previewed',
  BillApproved:      'dairy.bill_approved',
  BillPaid:          'dairy.bill_paid',
  BillDisputed:      'dairy.bill_disputed',
  // PC-56 TENANT-6b-1 · W168's flag protocol. `QualityFlagOpened` carries the FARMER's userId, so the notification
  // spine can keep the canon's own promise ("member notified in Gujarati") — ADMIN-6b's finding was a map row pointing
  // at a payload with no recipient, which looks like a fix and sends nothing.
  QualityFlagOpened: 'dairy.quality_flag_opened',
  QualityFlagDecided:'dairy.quality_flag_decided',
} as const;
export type DomainEvent = { type: string; payload: Record<string, unknown> };

export const ANIMAL_TYPES = ['cow', 'buffalo', 'mixed'] as const;
export type AnimalType = (typeof ANIMAL_TYPES)[number];
export const PAYMENT_CYCLES = ['daily', 'weekly', 'fortnightly', 'monthly'] as const;
export type PaymentCycle = (typeof PAYMENT_CYCLES)[number];
export const PRICING_MODELS = ['two_axis', 'fat_pooled', 'snf_pooled'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];
export const MILK_SHIFTS = ['morning', 'evening'] as const;
export type MilkShift = (typeof MILK_SHIFTS)[number];
