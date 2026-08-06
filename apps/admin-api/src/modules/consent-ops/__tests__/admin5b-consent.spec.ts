// PC-56 ADMIN-5b · the consent notice plane. Pure domain only — no DB.
// The claims: a version label must point at words that can be produced, a notice must not be a slogan, and a mandatory
// purpose must never publish a notice somebody cannot read.
import {
  parseVersion, nextVersionLabel, assertNoticeText, assertToggleLabel, assertNoticeIsNotTheLabel,
  noticeCoverage, assertPublishable, assertNoOpenDraft, noticeProvenance, decisionKind, reConsentBacklog,
  isConsentChannel, CONSENT_CHANNELS, NOTICE_MIN_CHARS, IVR_EVIDENCE_GAP,
} from '../domain/consent-notice';
import {
  InvalidConsentInputError, NoticeLanguageMissingError, ConsentVersionNotDraftError, ConsentDraftExistsError,
} from '../domain/consent-ops.errors';
import { SecondPersonRequiredError } from '../../../core/approval/two-person-rule';

const REAL_NOTICE = 'We use your farm location to plan pickups and to show you local weather. If you decline, you can still sell and buy; we will ask for a pickup address each time.';
const LANGS = ['en', 'gu', 'hi'];

describe('ADMIN-5b · version labels', () => {
  it('parses the canon shape and rejects anything else', () => {
    expect(parseVersion('v2')).toBe(2);
    expect(parseVersion('v12')).toBe(12);
    expect(parseVersion('2')).toBeNull();
    expect(parseVersion('v')).toBeNull();
    expect(parseVersion('v2.1')).toBeNull();
    expect(parseVersion(2)).toBeNull();
  });
  it('takes the next label from the MAXIMUM ever used, including discarded drafts', () => {
    // A discarded v3 burned the label. Two different notice texts sharing a label would make every consent stamped with
    // it ambiguous — and the ambiguous thing would be what a person agreed to.
    expect(nextVersionLabel(['v1', 'v2', 'v3'])).toBe('v4');
    expect(nextVersionLabel(['v3', 'v1'])).toBe('v4');
    expect(nextVersionLabel([])).toBe('v1');
    expect(nextVersionLabel(['nonsense'])).toBe('v1');
  });
});

describe('ADMIN-5b · a notice is not a slogan', () => {
  it('refuses anything under the floor, and says why', () => {
    // "Improve voice & grading AI" is 25 characters and is a TOGGLE LABEL. The floor exists to stop the label being
    // pasted into the notice field, which is what a hurried author does.
    expect(NOTICE_MIN_CHARS).toBe(40);
    expect(() => assertNoticeText('Improve voice & grading AI', 'en')).toThrow(InvalidConsentInputError);
    try { assertNoticeText('short', 'gu'); } catch (e) { expect(String((e as Error).message)).toContain('toggle label'); }
  });
  it('accepts a real notice and normalises whitespace', () => {
    expect(assertNoticeText(REAL_NOTICE, 'en')).toBe(REAL_NOTICE);
    expect(assertNoticeText(`  ${REAL_NOTICE.replace(' ', '   ')}  `, 'en')).toBe(REAL_NOTICE);
  });
  it('refuses markup — a notice is also read aloud over IVR', () => {
    expect(() => assertNoticeText(`<p>${REAL_NOTICE}</p>`, 'en')).toThrow(InvalidConsentInputError);
    expect(() => assertToggleLabel('<b>Offers</b>', 'en')).toThrow(InvalidConsentInputError);
  });
  it('refuses a non-string and an over-long notice', () => {
    expect(() => assertNoticeText(42, 'en')).toThrow(InvalidConsentInputError);
    expect(() => assertNoticeText('x'.repeat(4001), 'en')).toThrow(InvalidConsentInputError);
  });
  it('requires a toggle label and bounds it', () => {
    expect(assertToggleLabel('  Offers and   scheme alerts ', 'en')).toBe('Offers and scheme alerts');
    expect(() => assertToggleLabel('', 'en')).toThrow(InvalidConsentInputError);
    expect(() => assertToggleLabel('x'.repeat(151), 'en')).toThrow(InvalidConsentInputError);
  });
  it('REFUSES a notice that is just the label again', () => {
    // The cheapest way to satisfy a length floor: paste the label, pad it, ship twelve languages of nothing.
    const label = 'We use your farm location to plan pickups and show local weather';
    expect(() => assertNoticeIsNotTheLabel(label, label, 'en')).toThrow(InvalidConsentInputError);
    // punctuation and case differences do not rescue it
    expect(() => assertNoticeIsNotTheLabel(`${label}.`, label.toUpperCase(), 'en')).toThrow(InvalidConsentInputError);
    expect(() => assertNoticeIsNotTheLabel(REAL_NOTICE, 'Farm location', 'en')).not.toThrow();
  });
});

describe('ADMIN-5b · coverage is against the ACTIVE languages', () => {
  it('counts against the list in force, not a hardcoded twelve', () => {
    // W047's header says twelve; the platform launches with three and a new one is an INSERT. A fixed denominator would
    // read 3/12 on a platform that speaks three languages perfectly.
    const c = noticeCoverage([{ languageCode: 'en', noticeText: REAL_NOTICE, toggleLabel: 'x' }], LANGS);
    expect(c.total).toBe(3);
    expect(c.covered).toEqual(['en']);
    expect(c.missing).toEqual(['gu', 'hi']);
    expect(c.complete).toBe(false);
  });
  it('complete means every active language', () => {
    const notices = LANGS.map((l) => ({ languageCode: l, noticeText: REAL_NOTICE, toggleLabel: 'x' }));
    expect(noticeCoverage(notices, LANGS).complete).toBe(true);
  });
  it('an EMPTY language list is not "complete"', () => {
    // Otherwise a misconfigured platform with no active languages would report every purpose fully covered.
    expect(noticeCoverage([], []).complete).toBe(false);
  });
  it('ignores a notice in a language that is not active', () => {
    const c = noticeCoverage([{ languageCode: 'ta', noticeText: REAL_NOTICE, toggleLabel: 'x' }], LANGS);
    expect(c.covered).toEqual([]);
    expect(c.missing).toEqual(LANGS);
  });
});

describe('ADMIN-5b · publishing', () => {
  const draft = { id: 'v-2', status: 'draft', isMandatory: false, draftedBy: 'op-author', purposeCode: 'marketing', version: 'v2' };
  const full = LANGS.map((l) => ({ languageCode: l, noticeText: REAL_NOTICE, toggleLabel: 'Offers' }));

  it('THROWS when the publisher is the author — the shared two-person rule', () => {
    expect(() => assertPublishable(draft, full, LANGS, 'op-author')).toThrow(SecondPersonRequiredError);
  });
  it('allows a different operator', () => {
    expect(() => assertPublishable(draft, full, LANGS, 'op-reviewer')).not.toThrow();
  });
  it('refuses anything that is not a draft', () => {
    expect(() => assertPublishable({ ...draft, status: 'published' }, full, LANGS, 'op-reviewer')).toThrow(ConsentVersionNotDraftError);
    expect(() => assertPublishable({ ...draft, status: 'superseded' }, full, LANGS, 'op-reviewer')).toThrow(ConsentVersionNotDraftError);
  });
  it('refuses a version with NO notices at all, mandatory or not', () => {
    // A version with no words is not a notice.
    expect(() => assertPublishable(draft, [], LANGS, 'op-reviewer')).toThrow(NoticeLanguageMissingError);
  });
  it('a MANDATORY purpose cannot publish with a language missing', () => {
    // `is_mandatory` gates onboarding: a missing Tamil notice means a Tamil speaker is asked to agree, as a condition of
    // creating an account, to words they cannot read.
    const mandatory = { ...draft, isMandatory: true, purposeCode: 'service_core' };
    const partial = [{ languageCode: 'en', noticeText: REAL_NOTICE, toggleLabel: 'Account' }];
    expect(() => assertPublishable(mandatory, partial, LANGS, 'op-reviewer')).toThrow(NoticeLanguageMissingError);
    expect(() => assertPublishable(mandatory, full, LANGS, 'op-reviewer')).not.toThrow();
  });
  it('an OPTIONAL purpose MAY publish partially, and reports the gap', () => {
    // 44% opt-in with 9 of 12 languages is real. Blocking it would make nine language groups wait for three.
    const partial = [{ languageCode: 'en', noticeText: REAL_NOTICE, toggleLabel: 'Offers' }];
    const cov = assertPublishable(draft, partial, LANGS, 'op-reviewer');
    expect(cov.complete).toBe(false);
    expect(cov.missing).toEqual(['gu', 'hi']);
  });
  it('refuses a second draft, naming the open one', () => {
    expect(() => assertNoOpenDraft('marketing', [{ id: 'v-9', status: 'draft', version: 'v3' }])).toThrow(ConsentDraftExistsError);
    expect(() => assertNoOpenDraft('marketing', [{ id: 'v-1', status: 'published', version: 'v1' }])).not.toThrow();
  });
});

describe('ADMIN-5b · what a consent record can tell you', () => {
  it('RESOLVED when the words can be produced', () => {
    expect(noticeProvenance({ version: 'v2', consentPurposeVersionId: 'cpv-1' })).toEqual({ kind: 'resolved', versionId: 'cpv-1', version: 'v2' });
  });
  it('WORDS NEVER RECORDED when there is a label but no version row', () => {
    // The state of every consent captured before 0108: the version pointed at a mutable column, so the words of any
    // superseded version were overwritten and are gone. Under DPDP a consent whose notice cannot be produced is not
    // evidence of informed consent.
    expect(noticeProvenance({ version: 'v2', consentPurposeVersionId: null })).toEqual({ kind: 'words_never_recorded', version: 'v2' });
  });
  it('UNVERSIONED when there is not even a label', () => {
    expect(noticeProvenance({ version: null, consentPurposeVersionId: null })).toEqual({ kind: 'unversioned' });
  });
});

describe('ADMIN-5b · withdrawn is not the same as refused', () => {
  it('a not-granted record WITH a prior grant is a withdrawal', () => {
    expect(decisionKind(false, true)).toBe('withdrawn');
  });
  it('a not-granted record with NO prior grant is a REFUSAL', () => {
    // Counting these as withdrawals would inflate every withdrawal figure with people who simply said no the first time,
    // making the platform look like it loses consent it never had.
    expect(decisionKind(false, false)).toBe('refused');
  });
  it('granted is granted regardless of history', () => {
    expect(decisionKind(true, false)).toBe('granted');
    expect(decisionKind(true, true)).toBe('granted');
  });
});

describe('ADMIN-5b · the re-consent backlog', () => {
  it('separates current, superseded and unresolvable', () => {
    const b = reConsentBacklog([
      { status: 'published', resolvable: true, n: 900 },
      { status: 'superseded', resolvable: true, n: 120 },
      { status: null, resolvable: false, n: 8000 },
    ]);
    expect(b).toEqual({ holdingCurrent: 900, holdingSuperseded: 120, unresolvable: 8000 });
  });
  it('an unresolvable row is NOT counted as superseded', () => {
    // They need different actions: somebody on a superseded version can be shown the new notice; somebody whose version
    // cannot be resolved cannot be asked to re-confirm "the same thing", because nobody knows what that was.
    const b = reConsentBacklog([{ status: 'superseded', resolvable: false, n: 5 }]);
    expect(b.unresolvable).toBe(5);
    expect(b.holdingSuperseded).toBe(0);
  });
  it('drops zero and negative counts', () => {
    expect(reConsentBacklog([{ status: 'published', resolvable: true, n: 0 }, { status: 'superseded', resolvable: true, n: -4 }]))
      .toEqual({ holdingCurrent: 0, holdingSuperseded: 0, unresolvable: 0 });
  });
});

describe('ADMIN-5b · channels', () => {
  it('recognises exactly the four W046 names', () => {
    expect([...CONSENT_CHANNELS]).toEqual(['app', 'web', 'ambassador_assisted', 'ivr']);
    for (const c of CONSENT_CHANNELS) expect(isConsentChannel(c)).toBe(true);
    expect(isConsentChannel('sms')).toBe(false);
    expect(isConsentChannel('')).toBe(false);
  });
  it('the IVR evidence gap declares itself unavailable', () => {
    expect(IVR_EVIDENCE_GAP.available).toBe(false);
  });
});
