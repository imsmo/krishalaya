// apps/web-admin/src/features/templates/template.ts · W101 / W102 view logic (PC-56 ADMIN-11b).
//
// **THE THREE PAIRS THIS CONSOLE MUST KEEP APART**, each of which rendered identically before the wave:
//   • "this template is active" and "this template will actually send" — `is_active` was the whole test, so a template
//     WhatsApp had REJECTED sat in the list looking live;
//   • "the wording that is serving" and "the wording somebody is drafting" — one column, so an unapproved edit WAS the
//     live copy the moment it was saved;
//   • "no tenant has overridden this" and "no tenant MAY" — a zero next to security copy, where the answer is never.

export type Channel = 'push' | 'sms' | 'whatsapp' | 'email' | 'inapp' | 'ivr';
export type Lifecycle = 'draft' | 'submitted' | 'approved' | 'rejected' | 'superseded';

export interface TemplateListRow {
  id: string;
  eventCode: string;
  channel: string;
  languageCode: string;
  tenantId: string | null;
  tenantName: string | null;
  body: string;
  providerTemplateRef: string | null;
  isActive: boolean;
  lifecycle: string | null;
  servingVersionNo: number | null;
  currentVersionNo: number;
  priority: string;
  securityCopy: boolean;
  sendable: boolean;
  providerRefRequired: boolean;
  overrideCount: number;
}

/* ------------------------------------------------------------------------------------------------ */
/* WOULD THIS ACTUALLY SEND?                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The status stripe. **THREE STATES WHERE THE OLD SCHEMA COULD ONLY EXPRESS TWO**, and the middle one is the finding:
 * a row that is `is_active = true` with no approved version is ACTIVE AND SILENT — `resolve()` used to pick it up and
 * send an unapproved body, and after 0122 it resolves to nothing and the event falls back to another language.
 */
export function sendStateKey(r: Pick<TemplateListRow, 'isActive' | 'lifecycle' | 'sendable'>): string {
  if (r.sendable) return 'tp11.state.sending';
  if (r.lifecycle === 'rejected') return 'tp11.state.rejected';
  if (r.lifecycle === 'submitted') return 'tp11.state.submitted';
  if (r.lifecycle === 'draft' || r.lifecycle === null) return r.isActive ? 'tp11.state.activeButUnapproved' : 'tp11.state.draft';
  return 'tp11.state.notSending';
}

export function sendStateClass(r: Pick<TemplateListRow, 'isActive' | 'lifecycle' | 'sendable'>): string {
  if (r.sendable) return 'kv-badge is-ok';
  // **ACTIVE-BUT-UNAPPROVED IS DANGER, NOT NEUTRAL.** It is the state in which an operator believes wording is live and
  // the platform is sending something else, or nothing.
  if (r.isActive && !r.sendable) return 'kv-badge is-danger';
  return r.lifecycle === 'rejected' ? 'kv-badge is-danger' : 'kv-badge';
}

/** Whether the drafted version differs from the one serving — the sentence W102's header needs and could not say.
 *  `currentVersionNo` is the newest authored, `servingVersionNo` is the one going out. */
export function hasUnservedDraft(r: Pick<TemplateListRow, 'currentVersionNo' | 'servingVersionNo'>): boolean {
  if (r.servingVersionNo === null) return r.currentVersionNo > 0;
  return r.currentVersionNo > r.servingVersionNo;
}

export function draftNoticeKey(r: Pick<TemplateListRow, 'currentVersionNo' | 'servingVersionNo'>): string | null {
  if (!hasUnservedDraft(r)) return null;
  // The reassurance an author needs at 2 a.m.: your edit is not live and nothing went quiet while you worked.
  return r.servingVersionNo === null ? 'tp11.draft.nothingServing' : 'tp11.draft.serving';
}

/* ------------------------------------------------------------------------------------------------ */
/* SECURITY COPY                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

/** The overrides column. **A ZERO AND A NEVER ARE DIFFERENT**: on `auth.otp` the answer is not "no tenant has bothered
 *  yet", it is "no tenant can", and W101 says so in words this column has to carry. */
export function overridesKey(r: Pick<TemplateListRow, 'securityCopy' | 'overrideCount'>): string {
  if (r.securityCopy) return 'tp11.over.locked';
  return r.overrideCount === 0 ? 'tp11.over.none' : 'tp11.over.count';
}

/** Whether the console offers a "tenant override" control at all. Absent, never disabled — a control that always 403s
 *  teaches an operator that the rule is a UI preference rather than the platform's position on OTP copy. */
export function canOverridePerTenant(r: Pick<TemplateListRow, 'securityCopy'>): boolean {
  return !r.securityCopy;
}

export function securityNoticeKey(r: Pick<TemplateListRow, 'securityCopy'>): string | null {
  return r.securityCopy ? 'tp11.security.locked' : null;
}

/* ------------------------------------------------------------------------------------------------ */
/* THE APPROVAL CONTROLS — absence, again                                                            */
/* ------------------------------------------------------------------------------------------------ */

export interface VersionRow {
  id: string;
  versionNo: number;
  body: string;
  providerTemplateRef: string | null;
  bodySha256: string;
  lifecycle: string;
  needsSecondPerson: boolean;
  authoredByAdminId: string | null;
  approvedByAdminId: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  reason: string;
  createdAt: string;
}

/**
 * Whether THIS viewer may approve THIS version. **Sixteenth maker-checker site, rendered by ABSENCE**: on security copy
 * the author does not see an approve button at all, because a button that always refuses is how an operator learns to
 * read the rule as a suggestion.
 */
export function canApprove(v: Pick<VersionRow, 'lifecycle' | 'needsSecondPerson' | 'authoredByAdminId'>, viewerAdminId: string): boolean {
  if (v.lifecycle !== 'draft' && v.lifecycle !== 'submitted') return false;
  if (!v.needsSecondPerson) return true;
  // **AN AUTHORLESS SECURITY-COPY VERSION IS NOT APPROVABLE HERE.** Unknown is not "somebody else" — the fifth wave in
  // which unknown decides a control's presence.
  if (!v.authoredByAdminId) return false;
  return v.authoredByAdminId !== viewerAdminId;
}

export function approveWithheldKey(v: Pick<VersionRow, 'lifecycle' | 'needsSecondPerson' | 'authoredByAdminId'>, viewerAdminId: string): string | null {
  if (canApprove(v, viewerAdminId)) return null;
  if (v.lifecycle === 'approved') return 'tp11.approve.alreadyApproved';
  if (v.lifecycle === 'superseded') return 'tp11.approve.superseded';
  if (v.lifecycle === 'rejected') return 'tp11.approve.rejected';
  if (!v.authoredByAdminId) return 'tp11.approve.noAuthor';
  return 'tp11.approve.ownWork';
}

/** A provider-approved channel with no registration cannot be approved. The refusal is shown BEFORE the button is
 *  pressed, because the alternative is a 409 the operator has to decode. */
export function refBlocksApproval(channel: string, providerTemplateRef: string | null): boolean {
  return (channel === 'sms' || channel === 'whatsapp') && !providerTemplateRef;
}

/* ------------------------------------------------------------------------------------------------ */
/* PROVENANCE                                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export function lifecycleKey(lifecycle: string | null): string {
  const known = ['draft', 'submitted', 'approved', 'rejected', 'superseded'];
  if (lifecycle === null) return 'tp11.life.unversioned';
  return known.includes(lifecycle) ? `tp11.life.${lifecycle}` : 'tp11.life.other';
}

/** **AN UNVERSIONED ROW IS A FINDING, NOT A BLANK.** After 0122's backfill it means a row written by a path that
 *  predates this plane — a send whose words cannot be reconstructed. Drawn as a warning so it is not read as "new". */
export function lifecycleClass(lifecycle: string | null): string {
  if (lifecycle === null) return 'kv-badge is-warn';
  if (lifecycle === 'approved') return 'kv-badge is-ok';
  if (lifecycle === 'rejected') return 'kv-badge is-danger';
  return 'kv-badge';
}

export function channelKey(channel: string): string {
  const known = ['push', 'sms', 'whatsapp', 'email', 'inapp', 'ivr'];
  return known.includes(channel) ? `tp11.ch.${channel}` : 'tp11.ch.other';
}

/* ------------------------------------------------------------------------------------------------ */
/* SEGMENTS AND COST — the number an author must see before saving                                    */
/* ------------------------------------------------------------------------------------------------ */

export interface Segments { encoding: string; units: number; segments: number; perSegment: number; characters: number }

/** W102's sentence: "84 chars rendered → 2 segments (Gujarati = UCS-2 concatenated, 67 chars/segment)". */
export function segmentKey(s: Segments | null | undefined): string | null {
  if (!s) return null;
  if (s.segments === 0) return 'tp11.seg.empty';
  return s.encoding === 'ucs2' ? 'tp11.seg.ucs2' : 'tp11.seg.gsm7';
}

/** Over the budget is DANGER because it is a permanent cost on every send of that event, not a one-off. */
export function segmentClass(s: Segments | null | undefined, priority: string): string {
  if (!s) return 'kv-note';
  if (priority === 'critical') return 'kv-note';
  if (s.segments > 2) return 'kv-note is-danger';
  return s.segments === 2 ? 'kv-note is-warn' : 'kv-note';
}

/* ------------------------------------------------------------------------------------------------ */
/* COVERAGE                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

export function gapSeverityKey(severity: string): string {
  const known = ['critical', 'important', 'ordinary'];
  return known.includes(severity) ? `tp11.gap.${severity}` : 'tp11.gap.ordinary';
}

export function gapClass(severity: string): string {
  if (severity === 'critical') return 'kv-badge is-danger';
  return severity === 'important' ? 'kv-badge is-warn' : 'kv-badge';
}

/** The census tile for tenant rows on security copy. **ZERO IS THE ONLY ACCEPTABLE NUMBER AND IT IS PRINTED EITHER
 *  WAY**: a tile that appears only when it is non-zero is a tile nobody trusts when it is absent. */
export function securityOverrideKey(n: number): string {
  return n === 0 ? 'tp11.census.noSecurityOverrides' : 'tp11.census.securityOverrides';
}

export function securityOverrideClass(n: number): string {
  return n === 0 ? 'kv-note' : 'kv-note is-danger';
}

/** Rows no version points at — sends whose wording cannot be reconstructed. */
export function unversionedKey(n: number): string {
  return n === 0 ? 'tp11.census.allVersioned' : 'tp11.census.unversioned';
}
