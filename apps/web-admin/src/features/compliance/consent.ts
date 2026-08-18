// apps/web-admin/src/features/compliance/consent.ts · PURE, framework-free helpers for the CONSENT plane
// (PC-56 ADMIN-5b: W046 registry, W047 purposes). No fetch, no React → unit-tested.
//
// The admin console has never seen the consent tables. Everything here exists to stop the first view of them saying
// something the data does not support — and the two claims most at risk are "this person consented to v2" (when v2's
// words were never stored) and "12/12 languages ✓" (when the twelve is a hardcoded number and the notices are slogans).
//
// DEV-60 (UI Port Program batch 3, Part 1, Slice A): `decisionClass`/`provenanceClass`/`coverageClass`/`versionClass`
// now return a `StatusTone` instead of a raw `kv-status kv-status--X` string — disposition (c), same pattern as
// `ai-governance.ts`. Call sites render `<StatusPill tone={...} label={...} />`.

import type { StatusTone } from '@krishalaya/ui';

/* ===================== the registry (W046) ===================== */

export const CONSENT_CHANNELS = ['app', 'web', 'ambassador_assisted', 'ivr'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export function isConsentChannel(v: string | null | undefined): v is ConsentChannel {
  return (CONSENT_CHANNELS as readonly string[]).includes((v ?? '').trim());
}

export interface MaskedPrincipal { userId: string; nameMasked: string | null; phoneMasked: string | null; masked: boolean }

export type NoticeProvenance =
  | { kind: 'resolved'; versionId: string; version: string }
  | { kind: 'words_never_recorded'; version: string }
  | { kind: 'unversioned' };

export type DecisionKind = 'granted' | 'withdrawn' | 'refused';

export interface ConsentEventRow {
  id: string;
  principal: MaskedPrincipal;
  purposeCode: string;
  version: string | null;
  granted: boolean;
  decision: DecisionKind | string;
  channel: string;
  assistedBy: string | null;
  provenance: NoticeProvenance;
  at: string | null;
}

/** W046's display rule, as a label. THREE outcomes, not two.
 *
 *  The schema stores `granted boolean` append-only, so a withdrawal is a `granted:false` event SUPERSEDING an earlier
 *  grant — and a `granted:false` with no prior grant is a REFUSAL. Rendering both as "withdrawn" would inflate every
 *  withdrawal figure on the screen with people who simply said no the first time, which is the opposite of a trust
 *  signal: it would make the platform look like it loses consent it never had.
 */
export function decisionKey(d: DecisionKind | string): 'granted' | 'withdrawn' | 'refused' | 'unknown' {
  return d === 'granted' || d === 'withdrawn' || d === 'refused' ? d : 'unknown';
}
/** A withdrawal is NOT a failure colour. Somebody exercising a right is the system working; colouring it red would
 *  train an operator to read consent withdrawal as a problem to fix. A REFUSAL is not a failure either. */
export function decisionTone(d: DecisionKind | string): StatusTone {
  switch (decisionKey(d)) {
    case 'granted': return 'success';
    case 'withdrawn': return 'neutral';
    case 'refused': return 'neutral';
    default: return 'warning';
  }
}

/** Can we show this person the words they agreed to?
 *
 *  `words_never_recorded` is the honest state of EVERY consent captured before migration 0108: `consents.version` was a
 *  label pointing at `consent_purposes.current_version`, a mutable column, so the words of any superseded version were
 *  overwritten and are gone. Rendering "v2" beside a tick would claim a record of informed consent that does not exist —
 *  and under DPDP a consent whose notice cannot be produced is not evidence of informed consent at all.
 */
export function provenanceKey(p: NoticeProvenance | null | undefined): 'resolved' | 'wordsLost' | 'unversioned' | 'unknown' {
  if (!p) return 'unknown';
  if (p.kind === 'resolved') return 'resolved';
  if (p.kind === 'words_never_recorded') return 'wordsLost';
  return 'unversioned';
}
export function provenanceTone(p: NoticeProvenance | null | undefined): StatusTone {
  const k = provenanceKey(p);
  if (k === 'resolved') return 'success';
  // A warning, not a failure: nobody did anything wrong, the platform simply had nowhere to keep the words. But it must
  // not read as fine, because it is the weakest kind of consent record the platform holds.
  return 'warning';
}

/** The assisted share W046 shows. Labelled as an EVENT share because that is what it is — the canon's "38% assisted" is
 *  events, and calling it a share of people would be a different and smaller number. */
export function assistedShareText(pct: number | null | undefined): { known: boolean; pct: number } {
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 ? { known: true, pct } : { known: false, pct: 0 };
}

/** The registry filters. An unrecognised channel is DROPPED rather than passed through — a silently ignored filter shows
 *  every consent event on the platform while the chip claims one channel, and somebody will read the screen and believe
 *  it. */
export function channelFilter(v: string | null | undefined): ConsentChannel | undefined {
  const s = (v ?? '').trim();
  return isConsentChannel(s) ? s : undefined;
}

/* ===================== purposes and notices (W047) ===================== */

export interface PurposeRow {
  code: string;
  defaultName: string;
  isMandatory: boolean;
  currentVersion: string;
  versionId: string | null;
  versionStatus: string | null;
  noticeNeverRecorded: boolean;
  noticeCount: number;
  languageTotal: number;
  isBackfilled: boolean;
  draftVersionId: string | null;
  draftVersion: string | null;
  optInPct: number | null;
  grantedPrincipals: number;
  decidedPrincipals: number;
}

export interface Coverage { covered: string[]; missing: string[]; total: number; complete: boolean }

/** W047's "Notice text (12 languages)" column, as a STATE rather than a fraction.
 *
 *  `never` is the one that matters and it is the state of every purpose this platform currently has: `consent_purposes`
 *  had no notice-text column at all before 0108, so the words the existing consents were given against were never
 *  recorded anywhere. Rendering that as "0/3" makes it look like an authoring backlog. It is not a backlog — it is a
 *  gap in the legal basis for processing that cannot be filled retroactively, because the words are unknowable.
 */
export type NoticeCoverageState = 'never' | 'complete' | 'partial' | 'none' | 'unknown';

export function coverageState(p: Pick<PurposeRow, 'noticeNeverRecorded' | 'noticeCount' | 'languageTotal'>): NoticeCoverageState {
  if (p.noticeNeverRecorded) return 'never';
  if (!Number.isFinite(p.languageTotal) || p.languageTotal <= 0) return 'unknown';
  if (p.noticeCount <= 0) return 'none';
  return p.noticeCount >= p.languageTotal ? 'complete' : 'partial';
}

/** A MANDATORY purpose with an incomplete notice is a FAILURE, not a warning.
 *
 *  W047: "is_mandatory gates onboarding" — a farmer cannot create an account without agreeing to it. If its notice is
 *  missing in Tamil, a Tamil speaker is asked to agree to something they cannot read AS A CONDITION OF ENTRY. That is
 *  consent obtained without a notice, and it deserves the strongest colour on the screen. The same gap on an OPTIONAL
 *  purpose is a warning: speakers of the missing languages simply are not asked, which is a real cost but not a wrong.
 */
export function coverageTone(state: NoticeCoverageState, isMandatory: boolean): StatusTone {
  if (state === 'complete') return 'success';
  if (state === 'unknown') return 'neutral';
  return isMandatory ? 'danger' : 'warning';
}

/** Coverage as text, against the ACTIVE platform languages rather than a hardcoded twelve.
 *
 *  W047's header says "12 languages" and the platform's language list is DATA — it launches with three and a new one is
 *  an INSERT. A fixed 12 would read "3/12" on a platform that speaks three languages perfectly, and "12/12 ✓" on the day
 *  a thirteenth is added.
 */
export function coverageText(p: Pick<PurposeRow, 'noticeCount' | 'languageTotal'>): string {
  if (!Number.isFinite(p.languageTotal) || p.languageTotal <= 0) return '—';
  return `${Math.max(0, p.noticeCount)}/${p.languageTotal}`;
}

/** Opt-in rate. NULL when nobody has decided — 0% would say everybody declined, which on a mandatory purpose is
 *  impossible and on an optional one is a different fact from "nobody has been asked yet". */
export function optInText(p: Pick<PurposeRow, 'optInPct' | 'decidedPrincipals'>): { known: boolean; pct: number; base: number } {
  return typeof p.optInPct === 'number' && Number.isFinite(p.optInPct) && p.decidedPrincipals > 0
    ? { known: true, pct: p.optInPct, base: p.decidedPrincipals }
    : { known: false, pct: 0, base: 0 };
}

/* ===================== the version ladder ===================== */

export interface ConsentVersionRow {
  id: string; purposeCode: string; version: string; status: string;
  isMandatory: boolean; changeReason: string;
  draftedBy: string | null; draftedAt: string | null;
  publishedBy: string | null; publishedAt: string | null; checkerNote: string | null;
  isBackfilled: boolean; isSigned: boolean;
  notices: Array<{ languageCode: string; noticeText: string; toggleLabel: string }>;
  coverage: Coverage;
}

export type VersionKind = 'draft' | 'current' | 'superseded' | 'backfilled' | 'unknown';
export function versionKind(v: Pick<ConsentVersionRow, 'status' | 'isBackfilled'>): VersionKind {
  // Checked FIRST: a backfilled row is `published` and unsigned, and calling it "current" would claim a human approved
  // words that were never written.
  if (v.isBackfilled) return 'backfilled';
  if (v.status === 'draft') return 'draft';
  if (v.status === 'published') return 'current';
  if (v.status === 'superseded') return 'superseded';
  return 'unknown';
}
export function versionTone(k: VersionKind): StatusTone {
  switch (k) {
    case 'current': return 'success';
    case 'draft': return 'warning';
    // Not a failure colour. A backfilled version is the platform being honest that versioning arrived after the consents
    // did — but it carries no notice, which the coverage cell reports separately and loudly.
    default: return 'neutral';
  }
}
/** Only a version a human actually signed gets a signature line. `ck_cpv_backfill` guarantees a backfilled row names no
 *  publisher, so there would be no name to print — and a blank one reads as a rendering fault rather than as "nobody
 *  approved this". */
export function showsSignature(v: Pick<ConsentVersionRow, 'isSigned'>): boolean { return v.isSigned === true; }

/** Why Publish is not offered. `null` means it is.
 *
 *  MAKER-CHECKER BY ABSENCE for `sameActor`, and a HARD refusal for a mandatory purpose with gaps: the second is not a
 *  permissions problem at all, it is the platform declining to obtain consent under a notice somebody cannot read.
 */
export type PublishBlock = 'noDraft' | 'sameActor' | 'noNotices' | 'mandatoryIncomplete' | null;
export function publishBlockedReason(draft: ConsentVersionRow | null, viewerUserId: string | null): PublishBlock {
  if (!draft) return 'noDraft';
  if (draft.notices.length === 0) return 'noNotices';
  if (draft.isMandatory && !draft.coverage.complete) return 'mandatoryIncomplete';
  // Null viewer is NOT blocked: `adminUserId` reads an unverified claim, and the safe direction for a display decision is
  // to show the control and let the server refuse.
  if (draft.draftedBy && viewerUserId && draft.draftedBy === viewerUserId) return 'sameActor';
  return null;
}

export function openDraft(rows: ConsentVersionRow[]): ConsentVersionRow | null {
  return rows.find((r) => r.status === 'draft') ?? null;
}

/* ===================== the re-consent backlog ===================== */

export interface ReConsentBacklog { holdingSuperseded: number; holdingCurrent: number; unresolvable: number }

/** The size of the job W047's fourth rung promises ("re-consent prompts roll out") and nothing performs.
 *
 *  Reported as three separate numbers because they need three different actions: people on a superseded version need a
 *  prompt, people on the current one need nothing, and people whose version cannot be resolved at all cannot be prompted
 *  meaningfully — nobody knows what they agreed to, so asking them to re-confirm "the same thing" is not possible.
 */
export function reConsentTotal(b: ReConsentBacklog | null | undefined): number | null {
  if (!b) return null;
  return b.holdingSuperseded + b.holdingCurrent + b.unresolvable;
}
export function reConsentNeeded(b: ReConsentBacklog | null | undefined): boolean {
  return !!b && b.holdingSuperseded > 0;
}

/* ===================== the notice form ===================== */

/** Mirrors the server floor. A notice under this length is a toggle label, and the point of the floor is to stop the
 *  label being pasted into the notice field — which is what a hurried author does, and which would make the coverage
 *  column read complete over twelve slogans. */
export const NOTICE_MIN_CHARS = 40;
export const NOTICE_MAX_CHARS = 4000;

export type SaveNoticeResult =
  | { ok: true; value: { languageCode: string; noticeText: string; toggleLabel: string } }
  | { ok: false; error: 'languageCode' | 'toggleLabel' | 'noticeTooShort' | 'noticeTooLong' | 'markup' | 'noticeIsLabel' };

const HAS_MARKUP = /<[a-zA-Z/]/;
// Trimmed AFTER the punctuation collapse as well as before — otherwise "Offers." and "Offers" differ by a trailing
// space and appending a full stop defeats the check. Mirrors the server, and both are asserted against the same cases.
const norm = (s: string) => s.trim().toLowerCase().replace(/[\s.,;:!?—–-]+/g, ' ').trim();

export function buildSaveNotice(raw: { languageCode?: string; noticeText?: string; toggleLabel?: string }): SaveNoticeResult {
  const languageCode = (raw.languageCode ?? '').trim();
  if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(languageCode)) return { ok: false, error: 'languageCode' };

  const toggleLabel = (raw.toggleLabel ?? '').trim().replace(/\s+/g, ' ');
  if (!toggleLabel || toggleLabel.length > 150) return { ok: false, error: 'toggleLabel' };

  const noticeText = (raw.noticeText ?? '').trim().replace(/\s+/g, ' ');
  // Markup is checked BEFORE length: a notice is also read aloud over IVR, and a short one full of tags should be told
  // about the tags rather than about its length.
  if (HAS_MARKUP.test(noticeText) || HAS_MARKUP.test(toggleLabel)) return { ok: false, error: 'markup' };
  if (noticeText.length < NOTICE_MIN_CHARS) return { ok: false, error: 'noticeTooShort' };
  if (noticeText.length > NOTICE_MAX_CHARS) return { ok: false, error: 'noticeTooLong' };
  if (norm(noticeText) === norm(toggleLabel)) return { ok: false, error: 'noticeIsLabel' };

  return { ok: true, value: { languageCode, noticeText, toggleLabel } };
}

export type OpenDraftResult =
  | { ok: true; value: { changeReason: string; isMandatory?: boolean } }
  | { ok: false; error: 'changeReason' | 'isMandatory' };

export function buildOpenDraft(raw: { changeReason?: string; isMandatory?: string }): OpenDraftResult {
  const changeReason = (raw.changeReason ?? '').trim();
  if (changeReason.length < 3 || changeReason.length > 1000) return { ok: false, error: 'changeReason' };
  const m = (raw.isMandatory ?? '').trim();
  if (m && m !== 'true' && m !== 'false') return { ok: false, error: 'isMandatory' };
  // Omitted when blank rather than defaulted: the DTO treats absent as "inherit the purpose's current value", and
  // sending `false` by accident would quietly make a compulsory purpose optional.
  return { ok: true, value: { changeReason, ...(m ? { isMandatory: m === 'true' } : {}) } };
}
