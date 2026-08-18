// PC-56 ADMIN-5b · the consent console helpers. Pure, framework-free.
// The two claims most at risk on this screen: "this person consented to v2" when v2's words were never stored, and
// "12/12 languages ✓" when the twelve is hardcoded and the notices are slogans.
import {
  CONSENT_CHANNELS, isConsentChannel, channelFilter, decisionKey, decisionTone, provenanceKey, provenanceTone,
  assistedShareText, coverageState, coverageTone, coverageText, optInText,
  versionKind, versionTone, showsSignature, openDraft, publishBlockedReason,
  reConsentTotal, reConsentNeeded, buildSaveNotice, buildOpenDraft, NOTICE_MIN_CHARS,
  type ConsentVersionRow, type PurposeRow,
} from '../features/compliance/consent';

const REAL_NOTICE = 'We use your farm location to plan pickups and to show you local weather. If you decline you can still trade.';

const purpose = (over: Partial<PurposeRow> = {}): PurposeRow => ({
  code: 'marketing', defaultName: 'Offers', isMandatory: false, currentVersion: 'v2',
  versionId: 'cpv-1', versionStatus: 'published', noticeNeverRecorded: false, noticeCount: 3, languageTotal: 3,
  isBackfilled: false, draftVersionId: null, draftVersion: null,
  optInPct: 61, grantedPrincipals: 61, decidedPrincipals: 100, ...over,
});

const version = (over: Partial<ConsentVersionRow> = {}): ConsentVersionRow => ({
  id: 'cpv-2', purposeCode: 'marketing', version: 'v3', status: 'draft',
  isMandatory: false, changeReason: 'clearer wording',
  draftedBy: 'op-author', draftedAt: null, publishedBy: null, publishedAt: null, checkerNote: null,
  isBackfilled: false, isSigned: false,
  notices: [{ languageCode: 'en', noticeText: REAL_NOTICE, toggleLabel: 'Offers' }],
  coverage: { covered: ['en'], missing: ['gu', 'hi'], total: 3, complete: false },
  ...over,
});

describe('ADMIN-5b console · withdrawn is not refused', () => {
  it('renders three decisions, not two', () => {
    expect(decisionKey('granted')).toBe('granted');
    expect(decisionKey('withdrawn')).toBe('withdrawn');
    expect(decisionKey('refused')).toBe('refused');
    expect(decisionKey('nonsense')).toBe('unknown');
  });
  it('a withdrawal is NOT a failure colour — somebody exercising a right is the system working', () => {
    expect(decisionTone('withdrawn')).toBe('neutral');
    expect(decisionTone('withdrawn')).not.toBe('danger');
    expect(decisionTone('refused')).toBe('neutral');
    expect(decisionTone('granted')).toBe('success');
  });
  it('an unrecognised decision is a warning, never quietly a grant', () => {
    expect(decisionTone('something_new')).toBe('warning');
    expect(decisionTone('something_new')).not.toBe('success');
  });
});

describe('ADMIN-5b console · can we produce the words?', () => {
  it('RESOLVED is the only state that gets a positive colour', () => {
    expect(provenanceKey({ kind: 'resolved', versionId: 'x', version: 'v2' })).toBe('resolved');
    expect(provenanceTone({ kind: 'resolved', versionId: 'x', version: 'v2' })).toBe('success');
  });
  it('WORDS NEVER RECORDED is a warning — the weakest record the platform holds', () => {
    // Every consent captured before 0108. Rendering it as fine would claim evidence of informed consent that we do not
    // have; rendering it as a failure would blame somebody for a schema that had nowhere to keep the words.
    expect(provenanceKey({ kind: 'words_never_recorded', version: 'v2' })).toBe('wordsLost');
    expect(provenanceTone({ kind: 'words_never_recorded', version: 'v2' })).toBe('warning');
    expect(provenanceTone({ kind: 'words_never_recorded', version: 'v2' })).not.toBe('success');
  });
  it('a MISSING provenance is not treated as resolved', () => {
    expect(provenanceKey(null)).toBe('unknown');
    expect(provenanceTone(null)).not.toBe('success');
  });
});

describe('ADMIN-5b console · the notice coverage cell', () => {
  it('NEVER RECORDED is its own state, not 0/N', () => {
    // Every purpose on this platform is in it. "0/3" makes it look like an authoring backlog; it is a gap in the legal
    // basis that cannot be filled retroactively, because the words are unknowable.
    expect(coverageState(purpose({ noticeNeverRecorded: true, noticeCount: 0 }))).toBe('never');
  });
  it('distinguishes complete, partial and none', () => {
    expect(coverageState(purpose({ noticeCount: 3, languageTotal: 3 }))).toBe('complete');
    expect(coverageState(purpose({ noticeCount: 1, languageTotal: 3 }))).toBe('partial');
    expect(coverageState(purpose({ noticeCount: 0, languageTotal: 3 }))).toBe('none');
  });
  it('no active languages is UNKNOWN, never complete', () => {
    // Otherwise a misconfigured platform reports every purpose fully covered.
    expect(coverageState(purpose({ languageTotal: 0 }))).toBe('unknown');
  });
  it('a MANDATORY gap is a FAILURE; the same gap on an optional purpose is a warning', () => {
    // is_mandatory gates onboarding: a missing language means somebody is asked to agree, as a condition of entry, to
    // words they cannot read.
    expect(coverageTone('partial', true)).toBe('danger');
    expect(coverageTone('partial', false)).toBe('warning');
    expect(coverageTone('never', true)).toBe('danger');
    expect(coverageTone('complete', true)).toBe('success');
    expect(coverageTone('unknown', true)).toBe('neutral');
  });
  it('coverage text counts against the ACTIVE languages, and is a dash when there are none', () => {
    expect(coverageText(purpose({ noticeCount: 1, languageTotal: 3 }))).toBe('1/3');
    expect(coverageText(purpose({ languageTotal: 0 }))).toBe('—');
  });
  it('opt-in is NULL when nobody has decided, never 0%', () => {
    // 0% would say everybody declined — impossible on a mandatory purpose, and a different fact from "nobody has been
    // asked yet" on an optional one.
    expect(optInText(purpose({ optInPct: null, decidedPrincipals: 0 })).known).toBe(false);
    expect(optInText(purpose({ optInPct: 0, decidedPrincipals: 40 }))).toEqual({ known: true, pct: 0, base: 40 });
    expect(optInText(purpose({ optInPct: 61, decidedPrincipals: 100 })).pct).toBe(61);
  });
  it('a PERCENTAGE WITH NO BASE is unknown — the function does not trust the server to be consistent', () => {
    // A mutation test caught that every case above was a state the SERVER produces (it returns null when nobody has
    // decided), so none of them exercised the guard itself. These are the states the function has to DEFEND against: a
    // percentage arriving with a zero base, and a non-finite one. Naming the pattern because it has now recurred several
    // times — testing the happy shapes the producer emits is not the same as testing the consumer's guard.
    expect(optInText(purpose({ optInPct: 61, decidedPrincipals: 0 })).known).toBe(false);
    expect(optInText(purpose({ optInPct: Number.NaN, decidedPrincipals: 40 })).known).toBe(false);
    expect(optInText(purpose({ optInPct: Number.POSITIVE_INFINITY, decidedPrincipals: 40 })).known).toBe(false);
  });
});

describe('ADMIN-5b console · the version ladder', () => {
  it('BACKFILLED is checked before status — it is published and unsigned', () => {
    expect(versionKind(version({ isBackfilled: true, status: 'published' }))).toBe('backfilled');
    expect(versionKind(version({ status: 'published', isBackfilled: false }))).toBe('current');
    expect(versionKind(version({ status: 'draft' }))).toBe('draft');
    expect(versionKind(version({ status: 'superseded' }))).toBe('superseded');
    expect(versionKind({ status: 'retired', isBackfilled: false })).toBe('unknown');
  });
  it('an unrecognised status is not styled as current', () => {
    expect(versionTone('unknown')).not.toBe('success');
    expect(versionTone('backfilled')).toBe('neutral');
    expect(versionTone('backfilled')).not.toBe('danger');
  });
  it('only a signed version gets a signature line', () => {
    expect(showsSignature(version({ isSigned: false }))).toBe(false);
    expect(showsSignature(version({ isSigned: true }))).toBe(true);
  });
  it('finds the open draft and only the draft', () => {
    expect(openDraft([version({ status: 'published' }), version({ id: 'd', status: 'draft' })])?.id).toBe('d');
    expect(openDraft([version({ status: 'published' })])).toBeNull();
  });
});

describe('ADMIN-5b console · Publish is ABSENT with the reason named', () => {
  it('no draft is its own reason', () => {
    expect(publishBlockedReason(null, 'op-x')).toBe('noDraft');
  });
  it('a draft with NO notices cannot publish — a version with no words is not a notice', () => {
    expect(publishBlockedReason(version({ notices: [] }), 'op-reviewer')).toBe('noNotices');
  });
  it('a MANDATORY purpose with a language missing cannot publish, and that outranks the author check', () => {
    // Not a permissions problem: the platform is declining to obtain consent under words somebody cannot read. Reported
    // even to the author, because it is what has to be fixed either way.
    const mandatoryPartial = version({ isMandatory: true, draftedBy: 'op-author' });
    expect(publishBlockedReason(mandatoryPartial, 'op-author')).toBe('mandatoryIncomplete');
    expect(publishBlockedReason(mandatoryPartial, 'op-reviewer')).toBe('mandatoryIncomplete');
  });
  it('the AUTHOR cannot approve their own words', () => {
    expect(publishBlockedReason(version(), 'op-author')).toBe('sameActor');
  });
  it('a different operator on an optional partial draft CAN publish', () => {
    // Nine language groups must not wait for three.
    expect(publishBlockedReason(version(), 'op-reviewer')).toBeNull();
  });
  it('an UNKNOWN viewer is not blocked — the safe direction is to let the server refuse', () => {
    expect(publishBlockedReason(version(), null)).toBeNull();
  });
  it('a mandatory draft with COMPLETE coverage is publishable by a second operator', () => {
    const full = version({ isMandatory: true, coverage: { covered: ['en', 'gu', 'hi'], missing: [], total: 3, complete: true } });
    expect(publishBlockedReason(full, 'op-reviewer')).toBeNull();
  });
});

describe('ADMIN-5b console · the re-consent backlog', () => {
  it('totals all three buckets and flags only a real backlog', () => {
    expect(reConsentTotal({ holdingCurrent: 900, holdingSuperseded: 120, unresolvable: 8000 })).toBe(9020);
    expect(reConsentTotal(null)).toBeNull();
    expect(reConsentNeeded({ holdingCurrent: 900, holdingSuperseded: 0, unresolvable: 8000 })).toBe(false);
    expect(reConsentNeeded({ holdingCurrent: 900, holdingSuperseded: 1, unresolvable: 0 })).toBe(true);
    expect(reConsentNeeded(null)).toBe(false);
  });
});

describe('ADMIN-5b console · the notice form', () => {
  const ok = { languageCode: 'gu', toggleLabel: 'Offers and scheme alerts', noticeText: REAL_NOTICE };

  it('accepts a real notice', () => {
    const r = buildSaveNotice(ok);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.languageCode).toBe('gu');
  });
  it('refuses a slogan in the notice field', () => {
    expect(NOTICE_MIN_CHARS).toBe(40);
    const r = buildSaveNotice({ ...ok, noticeText: 'Improve voice & grading AI' });
    expect(!r.ok && r.error).toBe('noticeTooShort');
  });
  it('checks MARKUP before length — a short notice full of tags should be told about the tags', () => {
    // It is also read aloud over IVR, where a tag is read out.
    const r = buildSaveNotice({ ...ok, noticeText: '<b>short</b>' });
    expect(!r.ok && r.error).toBe('markup');
  });
  it('refuses a notice that is just the label again, INCLUDING with trailing punctuation', () => {
    // The trailing-punctuation case is the one my own test caught: the normaliser collapsed punctuation to a space but did
    // not trim afterwards, so appending a full stop was enough to defeat the check.
    const label = 'We use your farm location to plan pickups and show local weather';
    expect(buildSaveNotice({ languageCode: 'en', toggleLabel: label, noticeText: label }).ok).toBe(false);
    const r = buildSaveNotice({ languageCode: 'en', toggleLabel: label.toUpperCase(), noticeText: `${label}.` });
    expect(!r.ok && r.error).toBe('noticeIsLabel');
  });
  it('refuses a bad language code and an empty or over-long label', () => {
    expect(buildSaveNotice({ ...ok, languageCode: 'gujarati' }).ok).toBe(false);
    expect(buildSaveNotice({ ...ok, toggleLabel: '' }).ok).toBe(false);
    expect(buildSaveNotice({ ...ok, toggleLabel: 'x'.repeat(151) }).ok).toBe(false);
  });
  it('accepts a BCP-47 regional code', () => {
    expect(buildSaveNotice({ ...ok, languageCode: 'bn-IN' }).ok).toBe(true);
  });
});

describe('ADMIN-5b console · opening a draft', () => {
  it('requires a reason', () => {
    expect(buildOpenDraft({ changeReason: 'x' }).ok).toBe(false);
    expect(buildOpenDraft({ changeReason: 'clearer wording after DPO review' }).ok).toBe(true);
  });
  it('OMITS isMandatory when blank rather than sending false', () => {
    // Sending false by accident would quietly make a compulsory purpose optional, and the DTO treats absent as "inherit".
    const r = buildOpenDraft({ changeReason: 'clearer wording' });
    expect(r.ok && 'isMandatory' in r.value).toBe(false);
    const t = buildOpenDraft({ changeReason: 'clearer wording', isMandatory: 'true' });
    expect(t.ok && t.value.isMandatory).toBe(true);
  });
  it('refuses a nonsense isMandatory rather than coercing it', () => {
    expect(buildOpenDraft({ changeReason: 'clearer wording', isMandatory: 'yes' }).ok).toBe(false);
  });
});

describe('ADMIN-5b console · filters and shares', () => {
  it('drops an unrecognised channel', () => {
    expect(channelFilter('ivr')).toBe('ivr');
    expect(channelFilter('sms')).toBeUndefined();
    expect(channelFilter(null)).toBeUndefined();
    for (const c of CONSENT_CHANNELS) expect(isConsentChannel(c)).toBe(true);
  });
  it('the assisted share is unknown rather than 0% when absent', () => {
    expect(assistedShareText(null).known).toBe(false);
    expect(assistedShareText(38)).toEqual({ known: true, pct: 38 });
    expect(assistedShareText(0)).toEqual({ known: true, pct: 0 });
  });
});
