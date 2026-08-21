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
  // PC-56 TENANT-6c-1 · the cycle's own facts. Two, not three: a cycle row APPEARING is bookkeeping nothing outside
  // the module can act on, so it publishes nothing (an event with no possible subscriber is a defect this programme
  // has now found four times). A cycle SHUTTING and its bills being BUILT are facts a cooperative's own systems
  // legitimately want — they ride the generic outbox → webhook path like every other dairy event. Neither carries a
  // member userId, because neither is news for a member: what a member must be told is the PREVIEW of their own bill,
  // and that act does not exist yet (TENANT-6c-2 builds it, with the notification row).
  CycleClosed:       'dairy.cycle_closed',
  CycleBillsGenerated: 'dairy.cycle_bills_generated',
  // PC-56 TENANT-6c-2 · the cycle-level act, and the two MEMBER-facing facts it produces. `BillPreviewed` already
  // existed as a type and was emitted by a transition nothing called with a recipient in the payload; it now carries
  // the farmer's userId and the figures the SMS interpolates, which is what turns a map row into a message.
  CyclePreviewed:    'dairy.cycle_previewed',
  // PC-56 TENANT-6c-3 · the second signature. No member-facing notification: the member was told at PREVIEW what they
  // are owed, and "two of our staff have now agreed with each other" is not news for them. The event carries both
  // humans so a cooperative's own systems (and an auditor) can see who signed.
  CycleApproved:     'dairy.cycle_approved',
  BillDisputeResolved: 'dairy.bill_dispute_resolved',
  BillVoided:        'dairy.bill_voided',
  // PC-56 TENANT-6c-4 · the deduction's destination.
  //
  // `MemberCreditIssued` and `MemberCreditRecovered` are the receivable's own two facts — a cooperative's accounting
  // system legitimately wants both, and the second is how a member's feed debt is seen to fall.
  // `BillDeductionApplied` is per LINE, because W169's promise is "each line itemised" and one bill can pay a feed
  // credit AND a loan in the same movement.
  // `BillDeductionConsentRequired` is the one that carries a member userId: it is the ONLY way a member learns that
  // their bill is waiting on them. A consent gate with no notification is a bill that silently never pays — the same
  // shape as a window nothing wrote (TENANT-6c-2), one layer up.
  MemberCreditIssued:  'dairy.member_credit_issued',
  MemberCreditRecovered: 'dairy.member_credit_recovered',
  BillDeductionApplied: 'dairy.bill_deduction_applied',
  BillDeductionConsentRequired: 'dairy.bill_deduction_consent_required',
  BillDeductionConsentRecorded: 'dairy.bill_deduction_consent_recorded',
  // PC-56 TENANT-6c-5 · the standing instruction W169 contrasts fresh consent against. Both carry the MEMBER's userId:
  // an arrangement about a family's future milk money is the kind of thing they must hear about when it starts and
  // when it ends, and an arrangement recorded silently is indistinguishable from software helping itself.
  DeductionInstructionAuthorised: 'dairy.deduction_instruction_authorised',
  DeductionInstructionRevoked: 'dairy.deduction_instruction_revoked',
  // PC-56 TENANT-6d-1 · W170. The cooler becomes a thing with a history: registered, its band changed, its compressor
  // spoken about, retired. NOT one event per temperature reading — a tank reports every few minutes and the outbox is
  // not a telemetry bus (`cold_chain_logs` is append-only for exactly that reason, and breach ALERTING is the ops-alert
  // rule's job).
  BmcRegistered: 'dairy.bmc_registered',
  BmcBandChanged: 'dairy.bmc_band_changed',
  BmcCompressorStated: 'dairy.bmc_compressor_stated',
  BmcRetired: 'dairy.bmc_retired',
  // The cycle's own assembly pass. No member userId: what a member is told is their BILL (the preview), not that a
  // batch job ran — and a per-member notice here would double every preview message.
  CycleDeductionsAssembled: 'dairy.cycle_deductions_assembled',
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
