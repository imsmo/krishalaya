// modules/templates-ops/domain/template-version.ts · the authoring rules (PC-56 ADMIN-11b).
//
// **THE RULE THIS FILE EXISTS FOR: AN EDIT DOES NOT TOUCH WHAT IS SENDING.** Before this wave the only write path
// replaced `body` in place, which made three things true at once — the delivery log pointed at words that had changed
// since the send, an edited SMS went out under a DLT ref approved for different content, and a template Meta had
// rejected kept sending because `resolve()` checks `is_active` and never the lifecycle.
//
// Versioning fixes all three WITHOUT EVER CREATING SILENCE, and that is the design constraint that shaped this file. The
// naive fix — refuse to send until the edit is re-approved — would mean an operator fixing a typo in the OTP template
// stops every one-time password on the platform until a colleague wakes up. So: an edit creates a DRAFT beside the
// approved version, the approved version keeps serving, and the pointer moves only on approval.
import { segmentsFor, exceedsSegmentBudget, renderWithSamples } from './sms-segments';

export type Lifecycle = 'draft' | 'submitted' | 'approved' | 'rejected' | 'superseded';

export interface EventFacts {
  code: string;
  priority: string;
  userCanOptOut: boolean;
  defaultChannels: string[];
}

export interface VariableDecl { name: string; sourceRef: string; sampleValue: string; isRequired: boolean }

/* ------------------------------------------------------------------------------------------------ */
/* SECURITY COPY                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

/**
 * **THE DEFINITION OF SECURITY COPY, IN ONE PLACE, BECAUSE THREE DIFFERENT RULES DEPEND ON IT.** It gates the second
 * person on approval (W102: "auth/dispute templates additionally need security sign-off"), it forbids a tenant override
 * (W101: "security copy stays platform-controlled"), and it exempts a body from the segment budget.
 *
 * An event is security copy when a user CANNOT opt out of it, or when it is critical. Those two are not the same test
 * and both are needed: `user_can_opt_out = false` is the platform saying "you will receive this whether you want it or
 * not", which is the strongest claim a notification can make on a person's attention, and `priority = 'critical'` is
 * the operational half. Either one alone is enough to mean the wording is not marketing.
 */
export function isSecurityCopy(e: Pick<EventFacts, 'priority' | 'userCanOptOut'>): boolean {
  return e.userCanOptOut === false || e.priority === 'critical';
}

/** Whether approving this version needs a different administrator. Sixteenth maker-checker site.
 *
 *  **AND ORDINARY COPY DELIBERATELY DOES NOT.** A checker on every wording change is a checker who rubber-stamps, and a
 *  rubber-stamped record is worse than no record because it looks like evidence. The second person is spent where it
 *  buys something: the messages a user is asked to trust. */
export function needsSecondPerson(e: Pick<EventFacts, 'priority' | 'userCanOptOut'>): boolean {
  return isSecurityCopy(e);
}

/** Whether a TENANT may author its own wording for this event at all. */
export function tenantMayOverride(e: Pick<EventFacts, 'priority' | 'userCanOptOut'>): boolean {
  return !isSecurityCopy(e);
}

/* ------------------------------------------------------------------------------------------------ */
/* VARIABLES — the typo that is invisible today                                                      */
/* ------------------------------------------------------------------------------------------------ */

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]{1,64})\s*\}\}/g;

/** Every distinct variable a body references, in order of first appearance. */
export function bodyTokens(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(TOKEN)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * Tokens the event does not declare. **This is the whole reason the catalogue exists.** `render()` turns an undeclared
 * token into an empty string — the right behaviour at send time, since leaking a literal `{{order_no}}` to a farmer is
 * worse — and the consequence is that an author who types `{{order_no}}` for `{{order_id}}` ships an SMS with a silent
 * hole in it, in a language they may not read, and finds out from a support ticket.
 *
 * **AN EMPTY CATALOGUE REFUSES NOTHING, AND SAYS SO.** For an event with no declared variables we cannot tell a typo
 * from a legitimate variable nobody has documented yet, and refusing every token would make the plane unusable for the
 * 200-odd events this wave does not have declarations for. Unknown is not zero: the console prints "variables not
 * declared for this event" instead of an empty Variables table, which reads as "this event has none".
 */
export function unknownTokens(body: string, declared: VariableDecl[]): string[] {
  if (declared.length === 0) return [];
  const names = new Set(declared.map((d) => d.name));
  return bodyTokens(body).filter((t) => !names.has(t));
}

/** Required variables the body never mentions. An OTP template with no `{{otp}}` in it is not a wording choice. */
export function missingRequired(body: string, declared: VariableDecl[]): string[] {
  const used = new Set(bodyTokens(body));
  return declared.filter((d) => d.isRequired && !used.has(d.name)).map((d) => d.name);
}

export function samplesOf(declared: VariableDecl[]): Record<string, string> {
  return Object.fromEntries(declared.map((d) => [d.name, d.sampleValue]));
}

/* ------------------------------------------------------------------------------------------------ */
/* THE PROVIDER REF — W102's third guard rail                                                        */
/* ------------------------------------------------------------------------------------------------ */

/** Channels whose wording is registered with somebody else before it may be sent: DLT for SMS, Meta for WhatsApp. On
 *  push, in-app and email nobody outside this platform approves the words, so nothing is staled by an edit. */
export const PROVIDER_APPROVED_CHANNELS = ['sms', 'whatsapp'] as const;

export function needsProviderApproval(channel: string): boolean {
  return (PROVIDER_APPROVED_CHANNELS as readonly string[]).includes(channel);
}

/**
 * **W102's THIRD GUARD RAIL, WHICH WAS TRUE OF NOTHING: "edits require re-approval of DLT ref before next send".**
 * The old upsert replaced the body and KEPT the ref, so an edited body went out under a registration granted for
 * different words — and DLT content scrubbing does not bounce a mismatch with a helpful error, it simply stops
 * delivering. On WhatsApp the equivalent is a paused template and a falling quality rating.
 *
 * A body change on a provider-approved channel therefore invalidates the ref: the new version starts at `draft` and
 * carries NO ref forward. Carrying it forward is the tempting shortcut and it is the actual defect, dressed as
 * convenience.
 */
export function refSurvivesEdit(channel: string, bodyChanged: boolean): boolean {
  if (!bodyChanged) return true;
  return !needsProviderApproval(channel);
}

/* ------------------------------------------------------------------------------------------------ */
/* WHAT MAY BE SENT                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

/**
 * Whether a version's words may go out. **`is_active = true` was the whole test before this wave**, which is why a
 * template rejected or paused by Meta stayed sendable — 0072 added the lifecycle column and no code ever read it.
 *
 * An unrecognised lifecycle is NOT sendable. Three waves running have made this correction and it is the same one every
 * time: a state this code cannot describe is a state whose safety it cannot assert.
 */
export function isSendable(lifecycle: string): boolean {
  return lifecycle === 'approved';
}

/** The lifecycle a NEW version starts in. Never 'approved', even for the operator who could approve it in the next
 *  breath: the two acts are recorded separately or the maker-checker record is a formality. */
export function initialLifecycle(): Lifecycle { return 'draft'; }

/** The transitions this plane performs. Written as data because a lifecycle enforced by scattered `if`s is a lifecycle
 *  that grows a hole the first time somebody adds a state. */
const TRANSITIONS: Record<string, Lifecycle[]> = {
  draft: ['submitted', 'approved', 'rejected'],   // approved directly where no provider registration is involved
  submitted: ['approved', 'rejected'],
  rejected: ['submitted', 'draft'],
  approved: ['superseded'],                        // only by a newer version being approved — never by hand
  superseded: [],
};

export function canTransition(from: string, to: Lifecycle): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** An SMS or WhatsApp version cannot be approved without the registration its channel requires. Approving one would
 *  produce a green row that fails at the operator — the "claim printed with nothing behind it" shape, in the one place
 *  where the claim costs deliveries rather than credibility. */
export function approvalBlockedByMissingRef(channel: string, providerTemplateRef: string | null): boolean {
  return needsProviderApproval(channel) && !providerTemplateRef;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE FULL AUTHORING VERDICT                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export interface DraftInput {
  eventCode: string;
  channel: string;
  languageCode: string;
  tenantId: string | null;
  subject: string | null;
  body: string;
  providerTemplateRef: string | null;
}

export interface AuthoringVerdict {
  ok: boolean;
  /** Machine-readable refusals, each with the lever the author can pull. */
  problems: { code: string; detail: string }[];
  /** Advisory, never blocking — a cost the author should see before saving. */
  warnings: { code: string; detail: string }[];
  segments: ReturnType<typeof segmentsFor> | null;
  renderedPreview: string;
  needsSecondPerson: boolean;
}

/**
 * Everything the authoring screen must decide before a version is written, in one function so the console and the
 * service cannot disagree — the ADMIN-11 lesson, where the admin plane's flag preview and the runtime evaluator
 * implemented the same rule differently and both were wrong.
 */
export function assessDraft(d: DraftInput, e: EventFacts, declared: VariableDecl[]): AuthoringVerdict {
  const problems: { code: string; detail: string }[] = [];
  const warnings: { code: string; detail: string }[] = [];

  if (d.body.trim().length === 0) problems.push({ code: 'body_empty', detail: 'A template with no words is not a template.' });

  if (d.tenantId !== null && !tenantMayOverride(e)) {
    problems.push({
      code: 'security_copy_platform_only',
      detail: `${e.code} is opt-out-locked or critical: its wording stays platform-controlled and takes no tenant override.`,
    });
  }

  const unknown = unknownTokens(d.body, declared);
  if (unknown.length > 0) {
    problems.push({
      code: 'unknown_variables',
      // Naming what IS declared, because "unknown variable" without the list is a refusal the author cannot act on.
      detail: `Not declared for ${e.code}: ${unknown.join(', ')}. Declared: ${declared.map((x) => x.name).join(', ') || 'none'}. An undeclared variable renders as an empty gap in the delivered message.`,
    });
  }
  const missing = missingRequired(d.body, declared);
  if (missing.length > 0) {
    problems.push({ code: 'missing_required_variables', detail: `Required by ${e.code} and absent from the body: ${missing.join(', ')}.` });
  }
  if (declared.length === 0) {
    warnings.push({ code: 'variables_not_declared', detail: `No variables are declared for ${e.code} yet, so nothing here can check the ones you used. That is unknown, not none.` });
  }

  const rendered = renderWithSamples(d.body, samplesOf(declared));
  const segments = d.channel === 'sms' ? segmentsFor(rendered) : null;
  if (segments && exceedsSegmentBudget(segments.segments, e.priority)) {
    problems.push({
      code: 'segment_budget',
      detail: `${segments.segments} SMS segments (${segments.encoding === 'ucs2' ? 'non-Latin script: 67 chars per segment' : '153 chars per segment'}). The budget is 2 for a ${e.priority} event — every extra segment is billed on every send, for ever.`,
    });
  }
  if (segments && segments.encoding === 'ucs2' && segments.segments === 1) {
    warnings.push({ code: 'ucs2', detail: 'Non-Latin script: 70 characters per segment rather than 160. One more sentence costs a second segment.' });
  }

  return {
    ok: problems.length === 0,
    problems,
    warnings,
    segments,
    renderedPreview: rendered,
    needsSecondPerson: needsSecondPerson(e),
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* COVERAGE — W101's "38 default channel without template"                                           */
/* ------------------------------------------------------------------------------------------------ */

export interface CoverageInput {
  events: EventFacts[];
  /** Languages the platform is LIVE in, not every language in the table: a gap against a language nobody has launched
   *  is not a gap, and counting it would put a number on the dashboard that can never reach zero. */
  liveLanguages: string[];
  /** Existing platform-default templates as `event|channel|language`. */
  present: Set<string>;
}

export interface CoverageGap { eventCode: string; channel: string; languageCode: string; priority: string }

/**
 * The gaps W101 counts. **A GAP IS A DEFAULT CHANNEL WITHOUT A PLATFORM TEMPLATE, NOT EVERY MISSING COMBINATION.** The
 * full cross-product of 214 events × 6 channels × every language is a number in the thousands that means nothing: most
 * events are never sent on most channels. `notification_events.default_channels` is the platform's own statement of
 * where an event goes, so a missing template on one of those channels is a message that will be attempted and cannot
 * be composed — which at send time is `markFailed('no_template')`, recorded and silent.
 */
export function coverageGaps(input: CoverageInput): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  for (const e of input.events) {
    for (const channel of e.defaultChannels) {
      for (const lang of input.liveLanguages) {
        if (!input.present.has(`${e.code}|${channel}|${lang}`)) {
          gaps.push({ eventCode: e.code, channel, languageCode: lang, priority: e.priority });
        }
      }
    }
  }
  return gaps;
}

/** A gap on a critical event is a different order of problem from a gap on a promotional one: the EN/HI fallback covers
 *  a missing Gujarati marketing body acceptably, and an OTP that falls back to a language the recipient cannot read is
 *  a login they cannot complete. */
export function severityOf(priority: string): 'critical' | 'important' | 'ordinary' {
  if (priority === 'critical') return 'critical';
  return priority === 'important' ? 'important' : 'ordinary';
}
