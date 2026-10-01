// modules/communication/domain/whatsapp-policy.ts · PC-56 TENANT-8e · WHAT THIS PLATFORM CAN HONESTLY SAY ABOUT WHATSAPP. PURE.
//
// F-15, by name: no provider adapter (no Meta Cloud API, no BSP), no inbound sink, zero WhatsApp templates, no business
// number, no opt-in record; `apps/whatsapp-bot` exits 1. So every WhatsApp surface the canon draws (W425–W430) is either a
// refusal that says what exists instead and who owns the gap, or — W430's one honest field — the cooperative's OPT-IN
// POLICY: the consent sources it intends to use (`whatsapp_optin_source`, Law 6) and the statement a member will be shown,
// recorded beside the fact that consent is NOT being collected (0179 constrains `collection_state` to `not_collected`).
//
// THE REFUSED-BY-NAME REGISTER is here (one list, read by the console's spec), each entry with what exists instead and the
// owner of the gap. It is data the pages print, never a feature flag pretending to be a feature.
import { ReviewDiffRow, ReviewField, ReviewRefusal, field } from '../../../shared/form-review';

export const OPTIN_STATEMENT_MIN = 20;
export const OPTIN_STATEMENT_MAX = 600;
export const OPTIN_COLLECTION_STATES = ['not_collected'] as const;
export const OPTIN_FORM_FIELDS = ['sources', 'consentStatement'] as const;
export const OPTIN_FORM_REFUSALS = [
  'NO_PERMISSION', 'NOTHING_CHANGED', 'SOURCES_REQUIRED', 'SOURCE_UNKNOWN', 'SOURCE_REPEATED', 'TOO_MANY_SOURCES',
  'STATEMENT_REQUIRED', 'STATEMENT_TOO_SHORT', 'STATEMENT_TOO_LONG', 'TEXT_HAS_MARKUP',
] as const;
export type OptinRefusal = (typeof OPTIN_FORM_REFUSALS)[number];

/** Who owns each gap — printed on the page beside the refusal. */
export const GAP_OWNERS = ['founder_provider_decision', 'admin_11b_q1', 'tenant_support_desk', 'platform_whatsapp_bot'] as const;
export type GapOwner = (typeof GAP_OWNERS)[number];

/**
 * Every WhatsApp clickable / surface of W425–W430 and W2845's acts that this platform REFUSES, with what exists instead
 * (`instead` — a console route, or null when nothing does) and the owner. `code` is the i18n tail.
 */
export const WHATSAPP_REFUSED: ReadonlyArray<{ code: string; owner: GapOwner; instead: string | null }> = [
  { code: 'inbox', owner: 'platform_whatsapp_bot', instead: '/inbox' },                          // W425 queue — no inbound sink
  { code: 'window', owner: 'founder_provider_decision', instead: null },                         // the 24h session window
  { code: 'assign', owner: 'tenant_support_desk', instead: null },                               // conversations have no assignee
  { code: 'markResolved', owner: 'tenant_support_desk', instead: null },
  { code: 'conversation', owner: 'platform_whatsapp_bot', instead: '/inbox' },                   // W426 — the in-app thread exists
  { code: 'freeformSend', owner: 'founder_provider_decision', instead: '/inbox' },
  { code: 'aiDraft', owner: 'founder_provider_decision', instead: null },                        // is_ai_generated written false by every insert
  { code: 'templateCategory', owner: 'admin_11b_q1', instead: '/content/templates' },             // W427/W428 — no category, header, footer, buttons
  { code: 'metaSubmission', owner: 'admin_11b_q1', instead: '/content/templates' },               // "Submit for review" to Meta
  { code: 'qualityRating', owner: 'admin_11b_q1', instead: null },
  { code: 'marketingOptin', owner: 'founder_provider_decision', instead: '/channels/whatsapp/settings' },
  { code: 'businessNumber', owner: 'founder_provider_decision', instead: null },                  // W430 connect / disconnect
  { code: 'channelToggle', owner: 'founder_provider_decision', instead: null },
  { code: 'messagingLimits', owner: 'founder_provider_decision', instead: null },
  { code: 'webhookHealth', owner: 'founder_provider_decision', instead: null },
  { code: 'whatsappBroadcast', owner: 'founder_provider_decision', instead: '/comms' },           // W429 — the in-app announcement exists
  { code: 'whatsappExport', owner: 'founder_provider_decision', instead: '/comms' },              // W2839 — no WhatsApp dataset
];

export interface OptinInput { sources?: readonly string[]; consentStatement?: string }
export interface OptinFacts { canManage: boolean; vocabulary: readonly string[]; existing: { sources: readonly string[]; consentStatement: string } | null }
export interface OptinReview {
  ready: boolean; fields: ReviewField[]; refusals: ReviewRefusal[]; diff: ReviewDiffRow[] | null; entityType: 'whatsapp_optin_policy';
  stored: { sources: string[]; consentStatement: string | null }; mode: 'create' | 'update'; collectionState: 'not_collected';
}

/** Trim, lower-case, drop blanks; keep the order the author gave (repeats are refused, not silently merged). */
export function normaliseSources(raw: readonly string[] | undefined): string[] {
  return (raw ?? []).map((s) => String(s).trim().toLowerCase()).filter((s) => s.length > 0);
}

export function reviewOptinPolicy(input: OptinInput, f: OptinFacts): OptinReview {
  const refusals: ReviewRefusal[] = [];
  const refuse = (fieldName: 'sources' | 'consentStatement' | null, code: OptinRefusal) => {
    if (!refusals.some((r) => r.field === fieldName && r.code === code)) refusals.push({ field: fieldName, code });
  };
  if (!f.canManage) refuse(null, 'NO_PERMISSION');
  const sources = normaliseSources(input.sources);
  if (sources.length === 0) refuse('sources', 'SOURCES_REQUIRED');
  if (new Set(sources).size !== sources.length) refuse('sources', 'SOURCE_REPEATED');
  if (sources.some((s) => !f.vocabulary.includes(s))) refuse('sources', 'SOURCE_UNKNOWN');
  if (new Set(sources).size > 3) refuse('sources', 'TOO_MANY_SOURCES');
  const st = (input.consentStatement ?? '').replace(/[ \t]+/g, ' ').trim();
  const statement = st.length === 0 ? null : st;
  if (statement === null) refuse('consentStatement', 'STATEMENT_REQUIRED');
  else {
    if (statement.length < OPTIN_STATEMENT_MIN) refuse('consentStatement', 'STATEMENT_TOO_SHORT');
    if (statement.length > OPTIN_STATEMENT_MAX) refuse('consentStatement', 'STATEMENT_TOO_LONG');
    if (/[<>]/.test(statement)) refuse('consentStatement', 'TEXT_HAS_MARKUP');
  }
  const fields = [
    field('sources', (input.sources ?? []).join(', ') || null, sources.length ? sources.join(', ') : null),
    field('consentStatement', input.consentStatement ?? null, statement),
  ];
  let diff: ReviewDiffRow[] | null = null;
  if (f.existing) {
    diff = [];
    const before = [...f.existing.sources].join(', '); const after = sources.join(', ');
    if (before !== after) diff.push({ field: 'sources', before, after });
    if (f.existing.consentStatement !== statement) diff.push({ field: 'consentStatement', before: f.existing.consentStatement, after: statement });
    if (diff.length === 0) refuse(null, 'NOTHING_CHANGED');
  }
  return {
    ready: refusals.length === 0, fields, refusals, diff, entityType: 'whatsapp_optin_policy',
    stored: { sources, consentStatement: statement }, mode: f.existing ? 'update' : 'create', collectionState: 'not_collected',
  };
}
