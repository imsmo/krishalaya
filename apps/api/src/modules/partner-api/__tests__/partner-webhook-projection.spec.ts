// modules/partner-api/__tests__/partner-webhook-projection.spec.ts · PC-56 PARTNER-3a (founder Q7; survey F-3, P3-B2) — every partner-bound
// webhook payload is PROJECTED through an allow-list per event type before enqueue. Walks EVERY allow-listed event with a POISONED payload
// (every identity field present, each carrying a recognisable person value) and asserts none survives; an unknown event type answers `{}`;
// the fanout handler sends the projection, never `event.payload` (M4 kills here and in the live spec).
import { PARTNER_PAYLOAD_PROJECTIONS, projectPartnerPayload } from '../domain/partner-webhook-projection';
import { PARTNER_WEBHOOK_EVENTS, PARTNER_WEBHOOK_EVENT_TYPES } from '../domain/partner-webhook.rules';
import { PartnerWebhookFanoutHandler } from '../events/handlers/partner-webhook-fanout.handler';

const ID = (n: number) => `0192d2c4-${String(n).padStart(4, '0')}-7000-8000-00000000000${n % 10}`;
const PERSON = '0192d2c4-dead-7000-8000-00000000beef';
const NOTE = 'Kesar Ben said the vet came late; phone +91 94000 00229; village Bilkha';
/** Every identity / free-text field any emitter writes or could write — each with a value a deep search can find. */
const POISON: Record<string, unknown> = {
  claimantUserId: PERSON, applicantUserId: PERSON, holderUserId: PERSON, surveyorUserId: PERSON, userId: PERSON, actorUserId: PERSON,
  createdBy: PERSON, updatedBy: PERSON, subjectId: PERSON, paymentId: PERSON, payoutId: PERSON, premiumPaymentId: PERSON, tenantId: PERSON,
  note: NOTE, notes: NOTE, description: NOTE, reason: NOTE, name: 'Kesar Ben V.', fullName: 'Kesar Ben V.', phone: '+919400000229',
  surveyReport: { damagePercent: 62, notes: NOTE, surveyedAt: '2026-10-19T10:00:00.000Z', surveyor: PERSON },
  vetCertRef: 'VET-123', mediaIds: [PERSON], village: 'Bilkha', parcelId: PERSON,
};
const FORBIDDEN = /claimant|applicant|holder|surveyor|userId|createdBy|updatedBy|subject|payment|payout|tenant|note|description|reason|name|phone|report|vet|media|village|parcel|damage/i;
/** The fields each event legitimately carries (valid values), merged OVER the poison so every allowed field is present too. */
const REAL: Record<string, Record<string, unknown>> = {
  'fintech.loan_disbursed': { v: 1, applicationId: ID(1), from: 'approved', to: 'disbursed', amountApprovedMinor: '5000000' },
  'fintech.loan_repaid': { v: 1, loanId: ID(2), amountMinor: '5000', outstandingMinor: '45000' },
  'fintech.loan_closed': { v: 1, loanId: ID(3) },
  'insurance.policy_activated': { v: 1, policyId: ID(4), paymentId: PERSON },
  'insurance.policy_cancelled': { v: 1, policyId: ID(5), from: 'proposed' },
  'insurance.policy_claimed': { v: 1, policyId: ID(6), from: 'active' },
  'insurance.claim_filed': { v: 1, claimId: ID(7), policyId: ID(4), claimantUserId: PERSON, eventTypeId: ID(8), eventTypeCode: 'flood' },
  'insurance.claim_surveyed': { v: 1, claimId: ID(7), surveyReport: { damagePercent: 62, notes: NOTE, surveyedAt: '2026-10-19T10:00:00.000Z' } },
  'insurance.claim_decided': { v: 1, claimId: ID(7), decision: 'partially_approved', approvedMinor: '2850000', note: NOTE },
  'insurance.claim_settled': { v: 1, claimId: ID(7), approvedMinor: '2850000' },
  'insurance.claim_closed': { v: 1, claimId: ID(7) },
};
const deepKeys = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) { for (const x of v) deepKeys(x, out); return out; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { out.push(k); deepKeys(x, out); }
  return out;
};

describe('PC-56 PARTNER-3a · the partner webhook projection (founder Q7)', () => {
  it('every partner-deliverable event type has a projection, and no projection exists for an event that is not deliverable', () => {
    expect(Object.keys(PARTNER_PAYLOAD_PROJECTIONS).sort()).toEqual([...PARTNER_WEBHOOK_EVENT_TYPES].sort());
    expect(Object.keys(REAL).sort()).toEqual(Object.keys(PARTNER_WEBHOOK_EVENTS).sort());
  });

  it.each(Object.keys(REAL))('%s: a POISONED payload (every identity field present) projects to ids, statuses, codes, amounts and timestamps only', (eventType) => {
    const out = projectPartnerPayload(eventType, { ...POISON, ...REAL[eventType] });
    expect(deepKeys(out).filter((k) => FORBIDDEN.test(k))).toEqual([]);
    const json = JSON.stringify(out);
    for (const needle of [PERSON, 'Kesar', '+91', '9400000229', 'Bilkha', 'VET-123', 'vet came late']) expect([eventType, needle, json.includes(needle)]).toEqual([eventType, needle, false]);
    for (const v of Object.values(out)) expect(typeof v === 'string' || typeof v === 'number').toBe(true);   // flat: no object, no array
    expect(out.v).toBe(1);
  });

  it('the legitimate facts survive: ids, the status, the event code, minor-unit amounts, the survey time', () => {
    const p = (t: string) => projectPartnerPayload(t, { ...POISON, ...REAL[t] });
    expect(p('insurance.claim_filed')).toEqual({ v: 1, claimId: ID(7), policyId: ID(4), eventTypeCode: 'flood', status: 'intimated' });
    expect(p('insurance.claim_surveyed')).toEqual({ v: 1, claimId: ID(7), surveyedAt: '2026-10-19T10:00:00.000Z', status: 'surveyed' });
    expect(p('insurance.claim_decided')).toEqual({ v: 1, claimId: ID(7), status: 'partially_approved', approvedMinor: '2850000' });
    expect(p('insurance.claim_settled')).toEqual({ v: 1, claimId: ID(7), approvedMinor: '2850000', status: 'paid' });
    expect(p('insurance.claim_closed')).toEqual({ v: 1, claimId: ID(7), status: 'closed' });
    expect(p('insurance.policy_activated')).toEqual({ v: 1, policyId: ID(4), status: 'active' });
    expect(p('insurance.policy_cancelled')).toEqual({ v: 1, policyId: ID(5), from: 'proposed', status: 'cancelled' });
    expect(p('fintech.loan_disbursed')).toEqual({ v: 1, applicationId: ID(1), from: 'approved', to: 'disbursed', amountApprovedMinor: '5000000' });
    expect(p('fintech.loan_repaid')).toEqual({ v: 1, loanId: ID(2), amountMinor: '5000', outstandingMinor: '45000' });
  });

  it('a field that keeps its NAME but carries a person is dropped by its type check (an id that is a note, a status that is a sentence, an amount that is a float)', () => {
    expect(projectPartnerPayload('insurance.claim_decided', { v: 1, claimId: NOTE, decision: NOTE, approvedMinor: 2850000.5 })).toEqual({ v: 1 });
    expect(projectPartnerPayload('insurance.claim_filed', { claimId: ID(7), policyId: 'Kesar Ben', eventTypeCode: 'Kesar Ben V. lost her cow' })).toEqual({ claimId: ID(7), status: 'intimated' });
    expect(projectPartnerPayload('insurance.claim_surveyed', { claimId: ID(7), surveyReport: { surveyedAt: NOTE } })).toEqual({ claimId: ID(7), status: 'surveyed' });
    expect(projectPartnerPayload('insurance.claim_surveyed', { claimId: ID(7), surveyReport: [NOTE] })).toEqual({ claimId: ID(7), status: 'surveyed' });
  });

  it('an unknown event type answers {} — never the raw payload; a non-object payload projects nothing', () => {
    for (const t of ['insurance.claim_evidence_added', 'insurance.claim_survey_scheduled', 'insurance.policy_proposed', 'fintech.application_submitted', 'made.up', '__proto__', 'constructor']) {
      expect([t, projectPartnerPayload(t, { ...POISON, claimId: ID(7) })]).toEqual([t, {}]);
    }
    expect(projectPartnerPayload('insurance.claim_closed', null)).toEqual({ status: 'closed' });
    expect(projectPartnerPayload('insurance.claim_closed', 'Kesar')).toEqual({ status: 'closed' });
  });

  it('200 generated payloads per event (random poison + random valid fields): no identity key or value ever survives', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (const t of Object.keys(REAL)) {
      for (let i = 0; i < 200; i++) {
        const payload: Record<string, unknown> = { ...REAL[t] };
        for (const [k, v] of Object.entries(POISON)) if (rnd() < 0.7) payload[k] = v;
        const out = projectPartnerPayload(t, payload);
        expect(deepKeys(out).filter((k) => FORBIDDEN.test(k))).toEqual([]);
        expect(JSON.stringify(out).includes(PERSON)).toBe(false);
      }
    }
  });

  it('the fanout handler enqueues the PROJECTION as `data` — never event.payload (M4)', async () => {
    const webhooks = { enqueue: jest.fn(async () => undefined) };
    const partners = { resolveOwnerPartner: jest.fn(async () => 'p-1'), activeEndpointsForPartner: jest.fn(async () => [{ id: 'e1', partnerId: 'p-1', eventTypes: ['insurance.claim_filed'], isActive: true }]) };
    const uow = { run: jest.fn(async (_t: string, fn: (x: unknown) => Promise<unknown>) => fn({})) };
    const h = new PartnerWebhookFanoutHandler('insurance.claim_filed', partners as never, webhooks as never, uow as never);
    const payload = { ...POISON, ...REAL['insurance.claim_filed'] };
    await h.handle({ id: '9', tenantId: 't-1', aggregateType: 'insurance_claim', aggregateId: ID(7), eventType: 'insurance.claim_filed', payload } as never, {} as never);
    const [, d] = (webhooks.enqueue as jest.Mock).mock.calls[0] as [unknown, { payload: { data: unknown } }];
    expect(d.payload.data).toEqual(projectPartnerPayload('insurance.claim_filed', payload));
    expect(JSON.stringify(d.payload)).not.toContain(PERSON);
  });
});
