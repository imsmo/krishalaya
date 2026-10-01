// modules/communication/domain/template-override-review.ts · PC-56 TENANT-8a · the review of a tenant override — the
// FORM chain's API-computed review (W2779–W2782 "Save (re-verifies DLT)" and W2786–W2789 "New override").
//
// A REVIEW BUILT FROM WHAT THE AUTHOR TYPED IS AN ECHO (shared/form-review.ts). This one shows what the platform WILL
// WRITE and what a member WILL RECEIVE:
//   • the event, from the catalogue — unknown refused, security copy refused (ADMIN-11b's rule);
//   • the channel, one the event is actually sent on (F-11: `default_channels`, the fan-out's own list);
//   • the language, one this tenant speaks (`tenant_languages`, or the platform's active registry when it declared none
//     — the education module's house rule, Law 6: never a free string);
//   • the body against the event's declared variables (`notification_event_variables`, 0122): a token the event does not
//     declare renders as an EMPTY GAP at send time (`render()` never leaks `{{x}}`), so it is refused here by name; a
//     required variable the body never mentions is refused — *"a member never gets a blank where money should be"*
//     (W181). An event with NO declared variables refuses no token and SAYS it cannot check (unknown is not none);
//   • the rendered preview, made by the REAL `NotificationTemplate.render()` over the declared `sample_value`s — the one
//     interpolation site in the platform, so the preview cannot disagree with the send;
//   • for SMS, the segment count of the RENDERED text (GSM-7 160/153 · UCS-2 70/67), refused above two segments;
//   • whether the words will serve after a second person approves them — never on SMS / WhatsApp, which go to the
//     provider (ADMIN-11b-Q1) and are printed as such;
//   • the diff against what members receive TODAY (the serving override, else the serving platform default).
import { NotificationTemplate } from './notification-template.entity';
import { NOTIF_CHANNELS, NotifChannel } from './communication.events';
import { ReviewField, ReviewRefusal, ReviewResult, WriterIssue, WRITER_REFUSALS, field, reviewResult, trimOrNull, writerRefusals } from '../../../shared/form-review';
import { SegmentCount, exceedsSegmentBudget, segmentsFor, SEGMENT_BUDGET } from './sms-segments';
import { isSecurityCopy, needsProvider, ServingSource } from './template-override';

export const OVERRIDE_FORM_FIELDS = ['eventCode', 'channel', 'languageCode', 'subject', 'body', 'reason'] as const;
export type OverrideFormField = (typeof OVERRIDE_FORM_FIELDS)[number];
/** The rows the review shows that the form never asked. */
export const OVERRIDE_DERIVED_ROWS = ['version', 'lifecycle'] as const;

export const OVERRIDE_REVIEW_REFUSALS = [
  'NO_PERMISSION', 'OPEN_VERSION_EXISTS',
  'EVENT_REQUIRED', 'EVENT_UNKNOWN', 'SECURITY_COPY_PLATFORM_ONLY',
  'CHANNEL_REQUIRED', 'CHANNEL_UNKNOWN', 'CHANNEL_NOT_DEFAULT',
  'LANGUAGE_REQUIRED', 'LANGUAGE_NOT_TENANT',
  'BODY_REQUIRED', 'UNKNOWN_VARIABLES', 'MISSING_REQUIRED_VARIABLES', 'SEGMENT_BUDGET', 'BODY_UNCHANGED',
  'REASON_REQUIRED', ...WRITER_REFUSALS,
] as const;
export type OverrideReviewRefusal = (typeof OVERRIDE_REVIEW_REFUSALS)[number];

export const MIN_OVERRIDE_REASON = 3;
export const MAX_OVERRIDE_REASON = 300;

export interface EventFacts { code: string; priority: string; userCanOptOut: boolean; defaultChannels: readonly string[] }
export interface VariableDecl { name: string; sourceRef: string; sampleValue: string; isRequired: boolean }

export interface OverrideReviewInput {
  canAuthor: boolean;
  /** The catalogue row for the entered code, or null when the code is unknown (or blank). */
  event: EventFacts | null;
  declared: readonly VariableDecl[];
  tenantLanguages: readonly string[];
  entered: Partial<Record<OverrideFormField, string | null | undefined>>;
  /** What members receive today for this slot, if anything serves. */
  servingToday: { source: ServingSource; versionNo: number | null; subject: string | null; body: string | null };
  /** This tenant's override for the slot, if a row exists. */
  override: { templateId: string; nextVersionNo: number; open: { versionNo: number; lifecycle: string } | null; servingBody: string | null; servingSubject: string | null } | null;
  writerIssues?: readonly WriterIssue[];
}

export interface OverridePreview {
  rendered: { subject: string | null; body: string } | null;
  segments: SegmentCount | null;
  segmentBudget: number | null;
  variables: Array<{ name: string; sampleValue: string; isRequired: boolean; used: boolean }>;
  /** False when the event declares no variables — the page prints "not declared", never an empty table. */
  variablesDeclared: boolean;
  unknownTokens: string[];
  missingRequired: string[];
  /** Whether the words serve once a second person approves them. False on SMS / WhatsApp (the provider's). */
  servesAfterApproval: boolean;
  provider: 'none' | 'dlt' | 'whatsapp';
  nextVersionNo: number;
  servingToday: OverrideReviewInput['servingToday'];
}

export interface OverrideReview extends ReviewResult { preview: OverridePreview }

/* ------------------------------------------------------------------------------------------------------------ */
/* VARIABLES — the typo that is invisible at send time                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]{1,64})\s*\}\}/g;

/** Every distinct variable a text references, in order of first appearance. */
export function bodyTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** Tokens the event does not declare. An event with no declarations refuses nothing (unknown is not none). */
export function unknownTokens(text: string, declared: readonly VariableDecl[]): string[] {
  if (declared.length === 0) return [];
  const names = new Set(declared.map((d) => d.name));
  return bodyTokens(text).filter((t) => !names.has(t));
}

/** Required variables the text never mentions. */
export function missingRequired(text: string, declared: readonly VariableDecl[]): string[] {
  const used = new Set(bodyTokens(text));
  return declared.filter((d) => d.isRequired && !used.has(d.name)).map((d) => d.name);
}

export function samplesOf(declared: readonly VariableDecl[]): Record<string, string> {
  return Object.fromEntries(declared.map((d) => [d.name, d.sampleValue]));
}

/** The real render — the platform's ONE interpolation site — over the declared samples. */
export function renderPreview(channel: string, languageCode: string, subject: string | null, body: string, declared: readonly VariableDecl[]): { subject: string | null; body: string } {
  return NotificationTemplate.rehydrate({
    id: 'preview', eventCode: 'preview', channel: channel as NotifChannel, languageCode, tenantId: null,
    subject, body, providerTemplateRef: null, isActive: true,
  }).render(samplesOf(declared));
}

export function providerOf(channel: string): OverridePreview['provider'] {
  if (channel === 'sms') return 'dlt';
  if (channel === 'whatsapp') return 'whatsapp';
  return 'none';
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE REVIEW                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

export interface OverrideStored { eventCode: string; channel: string; languageCode: string; subject: string | null; body: string; reason: string }

/** What the writer will store — the same normalisation the review shows. */
export function storedOverride(entered: OverrideReviewInput['entered']): OverrideStored {
  return {
    eventCode: (trimOrNull(entered.eventCode) ?? ''),
    channel: (trimOrNull(entered.channel) ?? '').toLowerCase(),
    languageCode: (trimOrNull(entered.languageCode) ?? '').toLowerCase(),
    subject: trimOrNull(entered.subject),
    body: (entered.body ?? '').trim(),
    reason: (trimOrNull(entered.reason) ?? ''),
  };
}

export function reviewOverride(i: OverrideReviewInput): OverrideReview {
  const refusals: ReviewRefusal[] = [];
  const s = storedOverride(i.entered);

  if (!i.canAuthor) refusals.push({ field: null, code: 'NO_PERMISSION' });
  if (i.override?.open) refusals.push({ field: null, code: 'OPEN_VERSION_EXISTS' });

  // THE EVENT
  if (s.eventCode.length === 0) refusals.push({ field: 'eventCode', code: 'EVENT_REQUIRED' });
  else if (!i.event) refusals.push({ field: 'eventCode', code: 'EVENT_UNKNOWN' });
  else if (isSecurityCopy(i.event)) refusals.push({ field: 'eventCode', code: 'SECURITY_COPY_PLATFORM_ONLY' });

  // THE CHANNEL — one the event is sent on (F-11)
  if (s.channel.length === 0) refusals.push({ field: 'channel', code: 'CHANNEL_REQUIRED' });
  else if (!(NOTIF_CHANNELS as readonly string[]).includes(s.channel)) refusals.push({ field: 'channel', code: 'CHANNEL_UNKNOWN' });
  else if (i.event && !i.event.defaultChannels.includes(s.channel)) refusals.push({ field: 'channel', code: 'CHANNEL_NOT_DEFAULT' });

  // THE LANGUAGE — one this tenant speaks
  if (s.languageCode.length === 0) refusals.push({ field: 'languageCode', code: 'LANGUAGE_REQUIRED' });
  else if (!i.tenantLanguages.includes(s.languageCode)) refusals.push({ field: 'languageCode', code: 'LANGUAGE_NOT_TENANT' });

  // THE WORDS
  const words = `${s.subject ?? ''}\n${s.body}`;
  const unknown = unknownTokens(words, i.declared);
  const missing = missingRequired(words, i.declared);
  let rendered: OverridePreview['rendered'] = null;
  let segments: SegmentCount | null = null;
  if (s.body.length === 0) refusals.push({ field: 'body', code: 'BODY_REQUIRED' });
  else {
    if (unknown.length > 0) refusals.push({ field: 'body', code: 'UNKNOWN_VARIABLES' });
    if (missing.length > 0) refusals.push({ field: 'body', code: 'MISSING_REQUIRED_VARIABLES' });
    rendered = renderPreview(s.channel || 'inapp', s.languageCode || 'en', s.subject, s.body, i.declared);
    if (s.channel === 'sms') {
      segments = segmentsFor(rendered.body);
      if (exceedsSegmentBudget(segments.segments, i.event?.priority ?? 'important')) refusals.push({ field: 'body', code: 'SEGMENT_BUDGET' });
    }
    const unchanged = i.override !== null && i.override.servingBody !== null
      && i.override.servingBody === s.body && (i.override.servingSubject ?? null) === s.subject;
    if (unchanged) refusals.push({ field: 'body', code: 'BODY_UNCHANGED' });
  }

  // THE REASON — the audit sentence the version carries (0122: `reason text NOT NULL`)
  if (s.reason.length < MIN_OVERRIDE_REASON) refusals.push({ field: 'reason', code: 'REASON_REQUIRED' });

  const rows = [...OVERRIDE_FORM_FIELDS, ...OVERRIDE_DERIVED_ROWS];
  for (const r of writerRefusals(i.writerIssues ?? [], rows, refusals)) refusals.push(r);

  const nextVersionNo = i.override?.nextVersionNo ?? 1;
  const fields: ReviewField[] = [
    field('eventCode', i.entered.eventCode ?? null, s.eventCode || null),
    field('channel', i.entered.channel ?? null, s.channel || null),
    field('languageCode', i.entered.languageCode ?? null, s.languageCode || null),
    field('subject', i.entered.subject ?? null, s.subject),
    field('body', i.entered.body ?? null, s.body || null),
    field('reason', i.entered.reason ?? null, s.reason || null),
    // Two rows the form never asked: which version this becomes, and that it is born a DRAFT — nothing is sent from a
    // draft, and the page says whose yes it waits for.
    { name: 'version', entered: null, stored: `v${nextVersionNo}`, normalised: false },
    { name: 'lifecycle', entered: null, stored: 'draft', normalised: false },
  ];

  const today = i.servingToday;
  const diff = today.body === null ? null : [
    ...(today.subject !== s.subject ? [{ field: 'subject', before: today.subject, after: s.subject }] : []),
    ...(today.body !== s.body ? [{ field: 'body', before: today.body, after: s.body || null }] : []),
  ];

  const used = new Set(bodyTokens(words));
  const preview: OverridePreview = {
    rendered, segments, segmentBudget: s.channel === 'sms' ? SEGMENT_BUDGET : null,
    variables: i.declared.map((d) => ({ name: d.name, sampleValue: d.sampleValue, isRequired: d.isRequired, used: used.has(d.name) })),
    variablesDeclared: i.declared.length > 0,
    unknownTokens: unknown, missingRequired: missing,
    servesAfterApproval: s.channel.length > 0 && !needsProvider(s.channel),
    provider: providerOf(s.channel),
    nextVersionNo,
    servingToday: today,
  };
  return { ...reviewResult('notification_template', fields, refusals, diff), preview };
}
