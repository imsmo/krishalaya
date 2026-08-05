// modules/partner-api/domain/partner-webhook.rules.ts · PC-55 A10. PURE rules deciding WHICH platform events a
// partner endpoint may be told about, and WHETHER a given event belongs to that partner.
//
// THE ONE RULE THAT MATTERS: ownership is resolved from the DATABASE, never from the event payload. An outbox payload
// is written by whichever service emitted it; if a partner's right to see a farmer's loan depended on a `partnerId`
// field in that payload, then any future emitter that forgot the field (or set it wrongly) would silently under- or
// OVER-share. So the fanout resolves the owning partner via the aggregate's own row (loans.partner_id, or
// policy → product → partner) and `deliverable()` below compares THAT to the endpoint's partner. Unresolvable
// ownership ⇒ NOT delivered. A farmer's data never leaves the platform on a guess.
//
// The allow-list is closed and every entry is a REAL event string taken from the emitting module's constants
// (FintechEventType / InsuranceEventType / ClaimEventType), so a rename there fails this file's spec rather than
// quietly stopping deliveries.

/** How the owning partner of an event's aggregate is found (the SQL lives in partner-api.repository.ts). */
export type PartnerOwnershipKind = 'loan' | 'insurance_policy' | 'insurance_claim';

/** eventType → the aggregate whose row proves ownership. */
export const PARTNER_WEBHOOK_EVENTS: Readonly<Record<string, PartnerOwnershipKind>> = Object.freeze({
  // lending servicing (FintechEventType, aggregateType 'loan')
  'fintech.loan_disbursed': 'loan',
  'fintech.loan_repaid': 'loan',
  'fintech.loan_closed': 'loan',
  // insurance book (InsuranceEventType, aggregateType 'insurance_policy')
  'insurance.policy_activated': 'insurance_policy',
  'insurance.policy_cancelled': 'insurance_policy',
  'insurance.policy_claimed': 'insurance_policy',
  // claims (ClaimEventType, aggregateType 'insurance_claim')
  'insurance.claim_filed': 'insurance_claim',
  'insurance.claim_surveyed': 'insurance_claim',
  'insurance.claim_decided': 'insurance_claim',
  'insurance.claim_settled': 'insurance_claim',
  'insurance.claim_closed': 'insurance_claim',
});

export const PARTNER_WEBHOOK_EVENT_TYPES = Object.keys(PARTNER_WEBHOOK_EVENTS) as readonly string[];

export function isPartnerWebhookEvent(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(PARTNER_WEBHOOK_EVENTS, code);
}
export function ownershipKindFor(code: string): PartnerOwnershipKind | null {
  return isPartnerWebhookEvent(code) ? PARTNER_WEBHOOK_EVENTS[code] : null;
}

export interface PartnerEndpoint { id: string; partnerId: string; eventTypes: readonly string[]; isActive: boolean }

/** All three must hold: the endpoint is live and subscribed, the event is allow-listed, and the DB-resolved owner IS
 *  this endpoint's partner. `resolvedPartnerId` is null when ownership could not be established — which is a NO. */
export function deliverable(endpoint: PartnerEndpoint, eventType: string, resolvedPartnerId: string | null): boolean {
  if (!endpoint.isActive) return false;
  if (!isPartnerWebhookEvent(eventType)) return false;
  if (!endpoint.eventTypes.includes(eventType)) return false;
  if (!resolvedPartnerId) return false;
  return resolvedPartnerId === endpoint.partnerId;
}
