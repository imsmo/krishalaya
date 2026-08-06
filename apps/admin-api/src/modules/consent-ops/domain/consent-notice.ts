// apps/admin-api/src/modules/consent-ops/domain/consent-notice.ts · the rules of the consent NOTICE plane (0108).
// Pure, no I/O.
//
// A consent notice is not a label. It is the words a person read before agreeing to let us process their data, and it is
// the entire legal basis for that processing. Everything in this file follows from one consequence of that: once one
// person has consented under a version, its words can never change — so a version is published-never-edited, and a
// notice belongs to a version rather than to a purpose.
//
// THE PLATFORM'S FOURTH PUBLISHED-NEVER-EDITED OBJECT, and deliberately the same shape as 0105's scheme versions so an
// operator who has published one recognises the other. It is also the FIRST consumer of the two-person rule extracted in
// ADMIN-5 — W047 says "version bumps are maker-checker" and this is where that is enforced.
import { assertSecondPerson } from '../../../core/approval/two-person-rule';
import {
  InvalidConsentInputError, NoticeLanguageMissingError, ConsentVersionNotDraftError, ConsentDraftExistsError,
} from './consent-ops.errors';

export type ConsentVersionStatus = 'draft' | 'published' | 'superseded';

export interface NoticeRow { languageCode: string; noticeText: string; toggleLabel: string }

export interface ConsentVersionRow {
  id: string;
  purposeCode: string;
  version: string;
  status: ConsentVersionStatus | string;
  isMandatory: boolean;
  changeReason: string;
  draftedBy: string | null;
  draftedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  checkerNote: string | null;
  isBackfilled: boolean;
  notices: NoticeRow[];
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE VERSION LABEL                                                                                            */
/* ------------------------------------------------------------------------------------------------------------ */

const VERSION_RE = /^v([0-9]{1,4})$/;

export function parseVersion(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = VERSION_RE.exec(v.trim());
  return m ? Number(m[1]) : null;
}

/** The next label after every one ever used for this purpose.
 *
 *  Computed from the MAXIMUM ever seen rather than from the current published version — a discarded v3 burned the label,
 *  and two different notice texts sharing a label would make every consent stamped with it ambiguous for good. The same
 *  reasoning as `maxVersionEverUsed` on the scheme plane, and it matters more here: the ambiguous thing would be what a
 *  person agreed to.
 */
export function nextVersionLabel(everUsed: string[]): string {
  const max = everUsed.reduce((m, v) => Math.max(m, parseVersion(v) ?? 0), 0);
  return `v${max + 1}`;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE NOTICE ITSELF                                                                                            */
/* ------------------------------------------------------------------------------------------------------------ */

/** Long enough to be an explanation rather than a slogan.
 *
 *  Not an arbitrary number: "Improve voice & grading AI" is 25 characters and is a TOGGLE LABEL, which the notice is not.
 *  A notice has to say what data, for what, and what happens if you decline. Forty characters is the floor at which that
 *  is even possible, and the point of the floor is to stop the toggle label being pasted into the notice field — which is
 *  exactly what a hurried author does, and which would make W047's coverage column read 12/12 over twelve slogans.
 */
export const NOTICE_MIN_CHARS = 40;
export const NOTICE_MAX_CHARS = 4000;
export const TOGGLE_LABEL_MAX = 150;

const HAS_MARKUP = /<[a-zA-Z/]/;

export function assertNoticeText(v: unknown, languageCode: string): string {
  if (typeof v !== 'string') throw new InvalidConsentInputError(`notice text for ${languageCode} must be a string`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length < NOTICE_MIN_CHARS) {
    throw new InvalidConsentInputError(
      `the ${languageCode} notice is ${s.length} characters — a consent notice has to say what data, for what purpose, `
      + `and what happens if the person declines. Under ${NOTICE_MIN_CHARS} characters that is a toggle label, not a notice`);
  }
  if (s.length > NOTICE_MAX_CHARS) throw new InvalidConsentInputError(`the ${languageCode} notice exceeds ${NOTICE_MAX_CHARS} characters`);
  // A notice is rendered into an app screen, an SMS and an IVR script. Markup that survives into a voice prompt is read
  // aloud to a farmer.
  if (HAS_MARKUP.test(s)) throw new InvalidConsentInputError(`the ${languageCode} notice must be plain text — it is also read aloud over IVR`);
  return s;
}

export function assertToggleLabel(v: unknown, languageCode: string): string {
  if (typeof v !== 'string') throw new InvalidConsentInputError(`toggle label for ${languageCode} must be a string`);
  const s = v.trim().replace(/\s+/g, ' ');
  if (!s) throw new InvalidConsentInputError(`the ${languageCode} toggle label is required`);
  if (s.length > TOGGLE_LABEL_MAX) throw new InvalidConsentInputError(`the ${languageCode} toggle label exceeds ${TOGGLE_LABEL_MAX} characters`);
  if (HAS_MARKUP.test(s)) throw new InvalidConsentInputError(`the ${languageCode} toggle label must be plain text`);
  return s;
}

/** The notice and the label must not be the same words.
 *
 *  This is the check that stops the cheapest way to satisfy the length floor: paste the label, append a sentence, ship
 *  twelve languages of nothing. If they are identical the author has not written a notice, and the coverage column would
 *  report a completed translation of a slogan.
 */
export function assertNoticeIsNotTheLabel(noticeText: string, toggleLabel: string, languageCode: string): void {
  // TRIMMED AFTER the punctuation collapse, not only before it. Without the second trim, "Offers." normalises to
  // "offers " and "Offers" to "offers", they compare unequal, and appending a full stop is enough to pass a check whose
  // whole job is to catch exactly that. My own test found this.
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s.,;:!?—–-]+/g, ' ').trim();
  if (norm(noticeText) === norm(toggleLabel)) {
    throw new InvalidConsentInputError(`the ${languageCode} notice repeats the toggle label — the notice has to explain the purpose, not name it`);
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* LANGUAGE COVERAGE (W047's "12/12 ✓" column)                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

export interface Coverage {
  /** Languages with a notice on this version. */
  covered: string[];
  /** Active platform languages with NO notice on this version. */
  missing: string[];
  total: number;
  complete: boolean;
}

/** Coverage against the ACTIVE PLATFORM LANGUAGES, not against a hardcoded twelve.
 *
 *  W047's header says "12 languages" and the platform's language list is DATA (`languages`, from 0001) — it launches with
 *  three and a new one is an INSERT. A hardcoded 12 would read "3/12" on a platform that speaks three languages
 *  perfectly, and "12/12 ✓" on the day a thirteenth is added. Coverage is only meaningful against the list in force.
 */
export function noticeCoverage(notices: NoticeRow[], activeLanguages: string[]): Coverage {
  const have = new Set(notices.map((n) => n.languageCode));
  const covered = activeLanguages.filter((l) => have.has(l));
  const missing = activeLanguages.filter((l) => !have.has(l));
  return { covered, missing, total: activeLanguages.length, complete: activeLanguages.length > 0 && missing.length === 0 };
}

/** A MANDATORY purpose cannot publish without every language.
 *
 *  W047: "is_mandatory gates onboarding" — a farmer cannot create an account without agreeing to `service_core`. If its
 *  notice is missing in Tamil, a Tamil speaker is asked to agree to something they cannot read as a CONDITION OF ENTRY.
 *  That is not a coverage gap, it is consent obtained without a notice, and it is the one case where the platform should
 *  refuse to ship rather than ship partial.
 *
 *  An OPTIONAL purpose may publish partially — 44% opt-in on `ai_training` with 9 of 12 languages is real, and the honest
 *  handling is to show the gap and let speakers of the missing three simply not be asked. Blocking it would mean nine
 *  language groups wait for three.
 */
export function assertPublishable(
  v: { id: string; status: string; isMandatory: boolean; draftedBy: string | null; purposeCode: string; version: string },
  notices: NoticeRow[],
  activeLanguages: string[],
  actorUserId: string,
): Coverage {
  if (v.status !== 'draft') throw new ConsentVersionNotDraftError(v.id, v.status);
  // The maker-checker gate, via the shared helper — first consumer since it was extracted.
  assertSecondPerson(
    `publishing ${v.purposeCode} ${v.version}`, v.draftedBy, actorUserId,
    'the operator who drafted a consent notice cannot also approve it.',
  );
  const cov = noticeCoverage(notices, activeLanguages);
  if (notices.length === 0) throw new NoticeLanguageMissingError(v.purposeCode, cov.missing, true);
  if (v.isMandatory && !cov.complete) throw new NoticeLanguageMissingError(v.purposeCode, cov.missing, true);
  return cov;
}

/** Guard for opening a draft. A second draft of the same purpose would be a rival notice, and whichever published second
 *  would silently discard the other author's legal text. */
export function assertNoOpenDraft(purposeCode: string, versions: Array<{ id: string; status: string; version: string }>): void {
  const d = versions.find((x) => x.status === 'draft');
  if (d) throw new ConsentDraftExistsError(purposeCode, d.id, d.version);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* WHAT A CONSENT RECORD CAN AND CANNOT TELL YOU                                                                */
/* ------------------------------------------------------------------------------------------------------------ */

export type NoticeProvenance =
  /** The words this person agreed to can be produced. */
  | { kind: 'resolved'; versionId: string; version: string }
  /** The version label is recorded but its words were never stored — every consent given before 0108. */
  | { kind: 'words_never_recorded'; version: string }
  /** No version at all. */
  | { kind: 'unversioned' };

/** Whether we can show a person the words they agreed to.
 *
 *  THE THREE OUTCOMES ARE NOT COSMETIC. `words_never_recorded` is the honest state of every consent captured before this
 *  migration: `consents.version` pointed at `consent_purposes.current_version`, a mutable column, so the words of any
 *  superseded version were overwritten and are gone. Rendering that as "v2" beside a tick would claim a record we do not
 *  have — under DPDP a consent whose notice cannot be produced is not evidence of informed consent at all, and the
 *  console has to say so rather than let a green row imply otherwise.
 */
export function noticeProvenance(c: { version: string | null; consentPurposeVersionId: string | null }): NoticeProvenance {
  if (c.consentPurposeVersionId) return { kind: 'resolved', versionId: c.consentPurposeVersionId, version: c.version ?? '' };
  if (c.version) return { kind: 'words_never_recorded', version: c.version };
  return { kind: 'unversioned' };
}

/** W046's display rule, written down because it is a subtlety somebody will get wrong: the schema stores `granted
 *  boolean` append-only, so "withdrawn" is not a state — it is a `granted: false` event SUPERSEDING an earlier grant.
 *
 *  Which means a `granted: false` row with NO prior grant is not a withdrawal at all; it is a refusal, and calling it a
 *  withdrawal would inflate every withdrawal number on the screen with people who simply said no the first time.
 */
export type DecisionKind = 'granted' | 'withdrawn' | 'refused';
export function decisionKind(granted: boolean, hadPriorGrant: boolean): DecisionKind {
  if (granted) return 'granted';
  return hadPriorGrant ? 'withdrawn' : 'refused';
}

/** How many principals hold a SUPERSEDED version — the size of the re-consent job W047 promises and nothing performs.
 *  Returned as a count with its denominator so the console cannot render a share without the base. */
export interface ReConsentBacklog { holdingSuperseded: number; holdingCurrent: number; unresolvable: number }
export function reConsentBacklog(rows: Array<{ status: string | null; resolvable: boolean; n: number }>): ReConsentBacklog {
  const out: ReConsentBacklog = { holdingSuperseded: 0, holdingCurrent: 0, unresolvable: 0 };
  for (const r of rows) {
    const n = Number.isFinite(r.n) && r.n > 0 ? Math.floor(r.n) : 0;
    if (n === 0) continue;
    if (!r.resolvable) { out.unresolvable += n; continue; }
    if (r.status === 'published') out.holdingCurrent += n;
    else out.holdingSuperseded += n;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE CHANNELS (W046)                                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

export const CONSENT_CHANNELS = ['app', 'web', 'ambassador_assisted', 'ivr'] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export function isConsentChannel(v: string): v is ConsentChannel {
  return (CONSENT_CHANNELS as readonly string[]).includes(v);
}

/** An IVR consent's evidence is the recording, and `consents` has no column for a voice-log reference.
 *
 *  Named rather than silently absent: W046 shows "(voice log ref)" in that cell, and an IVR consent with no retrievable
 *  recording is the weakest consent record on the platform — it is the one where the person never saw the notice at all,
 *  only heard it. Not added as a column speculatively because it needs the voice provider that does not exist, and an
 *  empty column would imply one.
 */
export const IVR_EVIDENCE_GAP = {
  available: false as const,
  reason: 'no_voice_log_reference_column_and_no_voice_provider' as const,
} as const;
