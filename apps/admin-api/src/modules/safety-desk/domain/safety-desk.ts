// apps/admin-api/src/modules/safety-desk/domain/safety-desk.ts · W058 pure rules (PC-56 ADMIN-SWEEP-b3). No I/O.
//
// THE DESK RECORDS WHAT HUMANS DO AND REFUSES TO CLAIM WHAT MACHINES CANNOT. No paging provider, no alerting
// service, no vet lat/lng and no SQL distance exist (the survey's precondition, answered in 0134's header) — so a
// protocol step is either a documented HUMAN act ('recorded', detail mandatory: the platform is the register, not
// the actor) or 0098's `provider_pending` (the protocol says page; nothing can page; the row says so in words).
import { maskName, maskPhone } from '../../../core/pii/mask';

export const EMERGENCY_CATEGORIES = ['women_safety', 'emergency_vet', 'safety'] as const;
export type EmergencyCategory = (typeof EMERGENCY_CATEGORIES)[number];

export function isEmergencyCategory(code: string | null | undefined): code is EmergencyCategory {
  return (EMERGENCY_CATEGORIES as readonly string[]).includes(code ?? '');
}

/* ------------------------------------------------------------------ the protocol vocabularies (W058, verbatim intent) */

export type StepKind = 'human' | 'would_page';

/** Per-category steps. `human` steps demand who/what in the detail; `would_page` steps ALWAYS log
 *  provider_pending — the one step W058 draws as automatic ("nearest partner vet paged") is exactly the one the
 *  platform cannot perform, and the register must never read as though it did. */
export const PROTOCOLS: Readonly<Record<EmergencyCategory, readonly { code: string; kind: StepKind }[]>> = Object.freeze({
  women_safety: [
    { code: 'female_agent_engaged', kind: 'human' },      // "female agent preferred" — record who took the case
    { code: 'authority_protocol_offered', kind: 'human' },// "local authority protocol WITH CONSENT" — record the consent
    { code: 'follow_up_scheduled', kind: 'human' },       // "follow-up within 24h" — record when and by whom
  ],
  emergency_vet: [
    { code: 'page_vet', kind: 'would_page' },             // the canon's automatic step — honest as provider_pending
    { code: 'vet_contacted', kind: 'human' },             // the call a HUMAN made, on the vet's published emergency offer
    { code: 'location_shared_with_responder', kind: 'human' }, // "share location only with responder" — record with whom
    { code: 'fee_waiver_noted', kind: 'human' },          // "fee waived on emergency call-outs"
    { code: 'outcome_logged', kind: 'human' },            // "outcome logged for livestock record"
  ],
  safety: [
    { code: 'incident_report_filed', kind: 'human' },     // mandi/transport/equipment incident
    { code: 'tenant_briefed', kind: 'human' },
  ],
});

export class SafetyRuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const STEP_DETAIL_MIN = 20;   // 0134's CHECK is the database copy

/** Validate a step against ITS case's category. An unknown step is refused by name with the category's real
 *  vocabulary — the next move is in the sentence. */
export function assertStep(category: string, stepCode: string): { code: string; kind: StepKind } {
  if (!isEmergencyCategory(category)) {
    throw new SafetyRuleError('SAFETY_NOT_EMERGENCY_CASE',
      `This ticket's category (${category || 'none'}) is not a protected emergency category — the desk works women_safety, emergency_vet and safety cases only. The main support queue owns everything else.`);
  }
  const step = PROTOCOLS[category].find((s) => s.code === stepCode);
  if (!step) {
    throw new SafetyRuleError('SAFETY_UNKNOWN_STEP',
      `'${stepCode}' is not a ${category} protocol step. This category's steps: ${PROTOCOLS[category].map((s) => s.code).join(', ')}.`);
  }
  return step;
}

export function assertStepDetail(kind: StepKind, detail: unknown): string {
  if (kind === 'would_page') {
    // Composed, never author-supplied: the honesty text must not be editable into a claim of delivery.
    return 'the protocol says page the nearest partner vet; no paging, call or alerting provider is configured in this deployment — nothing was sent. Call the vet on their published emergency number and record vet_contacted.';
  }
  const d = typeof detail === 'string' ? detail.trim() : '';
  if (d.length < STEP_DETAIL_MIN) {
    throw new SafetyRuleError('SAFETY_DETAIL_TOO_SHORT',
      `A protocol step is a record of a human act — write at least ${STEP_DETAIL_MIN} characters of who/what (this register may be read in an inquiry).`);
  }
  return d;
}

export function stepStatus(kind: StepKind): 'recorded' | 'provider_pending' {
  return kind === 'would_page' ? 'provider_pending' : 'recorded';
}

/* ------------------------------------------------------------------ identity + age */

/** Requester identity, masked at the one shaping point — same rule as the hub. For a women_safety case the
 *  requester's identity is the most protected fact on this console. */
export function requesterView(v: { userId: string | null; fullName: string | null; phone: string | null; languageCode: string | null; gender: string | null }) {
  return {
    userId: v.userId,
    name: maskName(v.fullName),
    phone: maskPhone(v.phone),
    languageCode: v.languageCode,
    // surfaced because the women_safety protocol is "female agent preferred" — a routing fact, not decoration
    gender: v.gender,
  };
}

/** "Age ▴" — minutes under an hour, hours after, days after that. */
export function caseAge(createdAt: string, now: Date): string {
  const m = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000));
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

/** Every active protected-category case is worked at P0 REGARDLESS of the ticket's own severity field (W058:
 *  "P0 regardless of reporter") — the desk does not rewrite tenant data, it refuses to sort by it. */
export function deskOrder(): string { return 'created_at DESC'; }
