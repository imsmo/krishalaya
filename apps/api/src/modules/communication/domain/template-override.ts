// modules/communication/domain/template-override.ts · PC-56 TENANT-8a · THE OVERRIDE — the lifecycle of a tenant's own
// wording for one event × channel × language, in ONE place (Law 5).
//
// WHY THIS FILE EXISTS. Before this wave a tenant "override" was a row whose `body` the tenant could replace in place
// and which NEVER SENT: `resolve()` reads the words of an APPROVED version through `serving_version_id`, and the tenant
// realm could write neither (F-1). An override is real now, and it is real in exactly one way:
//
//     draft ──submit──▶ submitted ──approve (a second person)──▶ approved  ── serving, the old serving version superseded
//       │                  │                              └────▶ submitted_to_provider   (SMS / WhatsApp: NEVER serves)
//       └──withdraw──┐     ├──reject (a second person)──▶ rejected
//                    └─────┴──withdraw (the author)────▶ rejected
//     (the override as a whole) ──retire──▶ inactive: sends fall back to the platform default, never to silence
//
//   • The approver is never the author — this verdict AND 0175's `trg_ntv_tenant_decision` (23514).
//   • SMS and WhatsApp words are registered with somebody else before they may be sent (DLT; Meta). This platform has no
//     tenant-side provider submission (ADMIN-11b-Q1 owns the provider; WhatsApp has no provider at all — F-15), so a
//     tenant checker's yes on those channels moves the version to `submitted_to_provider`, which is NOT sendable, and
//     the page says so by name. A green "approved" SMS row that fails at the operator is the claim-without-a-sender
//     class this programme keeps finding.
//   • Security copy (opt-out-locked or critical) takes no tenant override at all — ADMIN-11b's rule, kept.
//   • The channel must be one the event is actually sent on (F-11): `default_channels` is the fan-out's own list.

export const OVERRIDE_LIFECYCLES = ['draft', 'submitted', 'approved', 'submitted_to_provider', 'rejected', 'superseded'] as const;
export type OverrideLifecycle = (typeof OVERRIDE_LIFECYCLES)[number];

export const OVERRIDE_ACTS = ['submit', 'approve', 'reject', 'withdraw', 'retire'] as const;
export type OverrideAct = (typeof OVERRIDE_ACTS)[number];
export function isOverrideAct(s: string): s is OverrideAct { return (OVERRIDE_ACTS as readonly string[]).includes(s); }

/** Acts on the OPEN version (draft / submitted). `retire` acts on the override as a whole. */
export const VERSION_ACTS: ReadonlySet<OverrideAct> = new Set<OverrideAct>(['submit', 'approve', 'reject', 'withdraw']);

/** The versions a checker has not decided yet — at most one per override (0175's partial unique index). */
export const OPEN_LIFECYCLES: ReadonlySet<string> = new Set(['draft', 'submitted']);

/** Channels whose wording must be registered with a provider before it may be sent: DLT for SMS, Meta for WhatsApp. */
export const PROVIDER_CHANNELS = ['sms', 'whatsapp'] as const;
export function needsProvider(channel: string): boolean { return (PROVIDER_CHANNELS as readonly string[]).includes(channel); }

/** Where a tenant checker's approval takes a version. On a provider channel it never reaches `approved` from here. */
export function approvalTarget(channel: string): 'approved' | 'submitted_to_provider' {
  return needsProvider(channel) ? 'submitted_to_provider' : 'approved';
}

/** Only `approved` is ever sent. An unrecognised lifecycle is NOT sendable (ADMIN-11b's rule, the same in both realms). */
export function isServingLifecycle(lifecycle: string): boolean { return lifecycle === 'approved'; }

/** The transitions, as data (a lifecycle enforced by scattered ifs grows a hole the day a state is added). */
const TRANSITIONS: Record<string, Partial<Record<OverrideAct, readonly OverrideLifecycle[]>>> = {
  draft: { submit: ['submitted'], withdraw: ['rejected'] },
  submitted: { approve: ['approved', 'submitted_to_provider'], reject: ['rejected'], withdraw: ['rejected'] },
  approved: {},                  // → superseded only when a newer version is approved — never by hand
  submitted_to_provider: {},     // the provider's (ADMIN-11b-Q1) — nothing in the tenant realm moves it
  rejected: {},                  // final: a new wording is a new draft
  superseded: {},
};

/** The lifecycle an act moves a version to, or null when the act is not legal from there. */
export function nextLifecycle(from: string, act: OverrideAct, channel: string): OverrideLifecycle | null {
  const to = TRANSITIONS[from]?.[act];
  if (!to || to.length === 0) return null;
  if (act === 'approve') return approvalTarget(channel);
  return to[0];
}

/** Security copy — ADMIN-11b's definition, one sentence: a user cannot opt out of it, or it is critical. */
export function isSecurityCopy(e: { priority: string; userCanOptOut: boolean }): boolean {
  return e.userCanOptOut === false || e.priority === 'critical';
}

export const MIN_ACT_REASON = 3;
export const MAX_ACT_REASON = 300;

export type OverrideActRefusal =
  | 'NO_PERMISSION'            // the act needs notification.templates.manage (submit, withdraw) or .approve (approve, reject, retire)
  | 'SECURITY_COPY_PLATFORM_ONLY'
  | 'CHANNEL_NOT_DEFAULT'
  | 'NO_OPEN_VERSION'          // a version act with nothing waiting
  | 'VERSION_CHANGED'          // the version the confirm screen showed is no longer the open one
  | 'ILLEGAL_FROM_STATUS'
  | 'MAKER_IS_CHECKER'         // approve / reject by the version's own author
  | 'NOT_AUTHOR'               // withdraw by anybody but the author
  | 'NOTHING_SERVING'          // retire with no override serving
  | 'REASON_REQUIRED'
  | 'REASON_TOO_LONG';

export interface OverrideActInput {
  act: OverrideAct;
  canAuthor: boolean;          // notification.templates.manage
  canApprove: boolean;         // notification.templates.approve
  event: { priority: string; userCanOptOut: boolean } | null;
  channelIsDefault: boolean;
  channel: string;
  /** The open version (draft / submitted), or null when none is waiting. */
  open: { id: string; lifecycle: string; authoredByUserId: string | null } | null;
  /** The version id the confirm screen reviewed — a version act refuses VERSION_CHANGED when it is not the open one. */
  expectedVersionId?: string | null;
  actorUserId: string;
  /** Whether an override version is serving right now (the retire act's object). */
  serving: boolean;
  reason: string | null | undefined;
}

export interface OverrideActVerdict { act: OverrideAct; allowed: boolean; refusals: OverrideActRefusal[]; to: OverrideLifecycle | 'retired' | null }

/** Every reason this act would be refused, not the first — the confirm screen prints them all (6d-5's rule). */
export function overrideActVerdict(i: OverrideActInput): OverrideActVerdict {
  const refusals: OverrideActRefusal[] = [];
  const needsApprover = i.act === 'approve' || i.act === 'reject' || i.act === 'retire';
  if (needsApprover ? !i.canApprove : !i.canAuthor) refusals.push('NO_PERMISSION');
  if (i.event && isSecurityCopy(i.event) && i.act !== 'retire') refusals.push('SECURITY_COPY_PLATFORM_ONLY');
  if (!i.channelIsDefault && (i.act === 'submit' || i.act === 'approve')) refusals.push('CHANNEL_NOT_DEFAULT');

  let to: OverrideActVerdict['to'] = null;
  if (VERSION_ACTS.has(i.act)) {
    if (!i.open) refusals.push('NO_OPEN_VERSION');
    else {
      if (i.expectedVersionId && i.expectedVersionId !== i.open.id) refusals.push('VERSION_CHANGED');
      to = nextLifecycle(i.open.lifecycle, i.act, i.channel);
      if (to === null) refusals.push('ILLEGAL_FROM_STATUS');
      const isAuthor = i.open.authoredByUserId !== null && i.open.authoredByUserId === i.actorUserId;
      if ((i.act === 'approve' || i.act === 'reject') && isAuthor) refusals.push('MAKER_IS_CHECKER');
      if (i.act === 'withdraw' && !isAuthor) refusals.push('NOT_AUTHOR');
    }
  } else {
    // retire
    if (!i.serving) refusals.push('NOTHING_SERVING');
    else to = 'retired';
  }

  const reason = (i.reason ?? '').trim();
  if (reason.length < MIN_ACT_REASON) refusals.push('REASON_REQUIRED');
  else if (reason.length > MAX_ACT_REASON) refusals.push('REASON_TOO_LONG');
  return { act: i.act, allowed: refusals.length === 0, refusals, to };
}

/** A verdict with the reason's refusals set aside — for drawing W181's buttons, which exist before any reason does. */
export function ignoringReason(v: OverrideActVerdict): OverrideActVerdict {
  const refusals = v.refusals.filter((r) => r !== 'REASON_REQUIRED' && r !== 'REASON_TOO_LONG');
  return { ...v, refusals, allowed: refusals.length === 0 };
}

/** Every act's verdict for the confirm screen and W181's buttons, in the canon's order. */
export function allOverrideVerdicts(base: Omit<OverrideActInput, 'act'>): OverrideActVerdict[] {
  return OVERRIDE_ACTS.map((act) => overrideActVerdict({ ...base, act }));
}

/* ------------------------------------------------------------------------------------------------------------ */
/* WHAT SERVES                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

export type ServingSource = 'override' | 'platform' | 'none';

/**
 * Who answers this event × channel × language for THIS tenant at send time — `resolve()`'s own rule, stated as a
 * function the list can print. A tenant row answers only when it is active AND its serving version is approved (F-1:
 * a tenant row with `serving_version_id NULL` is NOT an active override, whatever `is_active` said before 0175); the
 * platform row answers otherwise; and when neither serves, the channel records `no_template` — silence, printed.
 */
export function servingSource(s: { overrideServes: boolean; platformServes: boolean }): ServingSource {
  if (s.overrideServes) return 'override';
  if (s.platformServes) return 'platform';
  return 'none';
}
