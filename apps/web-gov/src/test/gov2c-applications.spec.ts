// apps/web-gov/src/test/gov2c-applications.spec.ts · PC-56 GOV-2c — the application pages' PURE pieces (features/gov2/applications.ts):
// the filters (a status this realm never lists is dropped before the call — Q3-A / GOV-2a B1), the page states, the act OFFER (Q2-A, E4: a
// mirror of the API, never a grant — the checker, the applicant and the assister are never offered a decision when the facts say so; with no
// facts the API refuses by name), the lone-head fact, the named refusals ×3, and the chains' query states and Backs.
import { ACT_ERRORS, actErrorCode, actHref, actParam, appChainBack, appChainFor, applicationsState, applicationState, cursorParam, decisionFact,
  GOV_LISTED_STATUSES, listHref, offeredActs, REJECTION_CODES, schemeFilter, sentenceOk, shortId, statusFilter, statusKey } from '../features/gov2/applications';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, ME_OFFICER, ROWS, ROWS_LONE, ROWS_NO_HEAD, H1, O1 } from '../test-render/gov1a-fixtures';

const HEAD = { ...ME_HEAD, person: { ...ME_HEAD.person, permissions: [...ME_HEAD.person.permissions, 'authority.applications.verify', 'authority.applications.decide'] } };
const OFFICER = { ...ME_OFFICER, person: { ...ME_OFFICER.person, permissions: [...ME_OFFICER.person.permissions, 'authority.applications.verify'] } };
const READER = ME_OFFICER;
const ID = '0192d2c4-f000-7000-8000-00000000c001';
const CATS = { en, hi, gu } as const;
const NONE = { actorIsVerifier: false, actorIsApplicant: false, actorIsAssister: false };

describe('PC-56 GOV-2c · the filters — never an unsent application', () => {
  it('the listed statuses are the eight a SENT application has; an unsent status is not one of them', () => {
    expect([...GOV_LISTED_STATUSES]).toEqual(['submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed']);
    expect((GOV_LISTED_STATUSES as readonly string[]).includes('draft')).toBe(false);
  });
  it('statusFilter drops anything not listed (an unsent status included); schemeFilter takes a uuid only; the cursor is bounded', () => {
    expect(statusFilter('draft')).toBeUndefined(); expect(statusFilter(['draft'])).toBeUndefined(); expect(statusFilter('x')).toBeUndefined();
    expect(statusFilter('approved')).toBe('approved'); expect(statusFilter(['appealed', 'x'])).toBe('appealed');
    expect(schemeFilter(ID)).toBe(ID); expect(schemeFilter('../x')).toBeUndefined();
    expect(cursorParam('abc')).toBe('abc'); expect(cursorParam('x'.repeat(201))).toBeUndefined();
  });
  it('listHref carries the filters and the cursor; the bare list is /applications', () => {
    expect(listHref({})).toBe('/applications');
    expect(listHref({ status: 'approved', scheme: ID, cursor: 'c1' })).toBe(`/applications?scheme=${ID}&status=approved&cursor=c1`);
  });
  it('status words ×3 for each listed status; anything else the dash; the number is 8 characters of the id', () => {
    for (const st of GOV_LISTED_STATUSES) for (const [l, cat] of Object.entries(CATS)) expect([l, st, typeof cat[statusKey(st)]]).toEqual([l, st, 'string']);
    expect(statusKey('draft')).toBe('common.dash');
    expect(shortId(ID)).toBe('0192D2C4');
  });
});

describe('PC-56 GOV-2c · page states', () => {
  it('list: off / forbidden / error / empty / ok', () => {
    expect(applicationsState(null, { status: 404, code: 'NOT_FOUND' })).toBe('off'); expect(applicationsState(null, { status: 403, code: 'X' })).toBe('forbidden');
    expect(applicationsState(null, null)).toBe('error'); expect(applicationsState([], null)).toBe('empty'); expect(applicationsState([1], null)).toBe('ok');
  });
  it('one: GOV_APPLICATION_NOT_FOUND → not_found; another 404 → off', () => {
    expect(applicationState(null, { status: 404, code: 'GOV_APPLICATION_NOT_FOUND' })).toBe('not_found');
    expect(applicationState(null, { status: 404, code: 'NOT_FOUND' })).toBe('off'); expect(applicationState({}, null)).toBe('ok');
  });
});

describe('PC-56 GOV-2c · Q2-A — the act OFFER mirrors the API, never grants', () => {
  it('a reader (no verify) is offered nothing', () => {
    for (const st of GOV_LISTED_STATUSES) expect([st, offeredActs(READER, st, null)]).toEqual([st, []]);
  });
  it('an officer: check on submitted / appealed / under_verification; clarify on under_verification; never approve or reject', () => {
    expect(offeredActs(OFFICER, 'submitted', null)).toEqual(['verify']); expect(offeredActs(OFFICER, 'appealed', null)).toEqual(['verify']);
    expect(offeredActs(OFFICER, 'under_verification', null)).toEqual(['verify', 'clarify']);
    for (const st of ['approved', 'rejected', 'closed', 'disbursed', 'clarification_needed']) expect([st, offeredActs(OFFICER, st, null)]).toEqual([st, []]);
  });
  it('a head on under_verification: approve and reject when nothing says they checked, made or helped make it', () => {
    expect(offeredActs(HEAD, 'under_verification', NONE)).toEqual(['verify', 'clarify', 'approve', 'reject']);
    expect(offeredActs(HEAD, 'submitted', NONE)).toEqual(['verify']);
  });
  it('NEVER offered to the person who checked it, made it or helped make it', () => {
    for (const k of ['actorIsVerifier', 'actorIsApplicant', 'actorIsAssister'] as const) {
      const acts = offeredActs(HEAD, 'under_verification', { ...NONE, [k]: true });
      expect([k, acts.includes('approve'), acts.includes('reject')]).toEqual([k, false, false]);
    }
  });
  it('with no facts (the read gives none today) the decision is offered and the API refuses by name', () => {
    expect(offeredActs(HEAD, 'under_verification', null)).toEqual(['verify', 'clarify', 'approve', 'reject']);
  });
  it('act names; the 11 listed reasons in the DEFINER\'s order, each with words ×3; a sentence is 10–500 once trimmed', () => {
    expect(actParam('approve')).toBe('approve'); expect(actParam('close')).toBeNull(); expect(actParam(['reject'])).toBe('reject');
    expect(REJECTION_CODES).toHaveLength(11);
    for (const c of REJECTION_CODES) for (const [l, cat] of Object.entries(CATS)) expect([l, c, typeof cat[`gov2.reason.${c}`]]).toEqual([l, c, 'string']);
    expect(sentenceOk('too short')).toBe(false); expect(sentenceOk('  ten chars!  ')).toBe(true); expect(sentenceOk('x'.repeat(501))).toBe(false);
  });
});

describe('PC-56 GOV-2c · the lone-head fact (words of fact, from the members read)', () => {
  it('no live head → no_head; the viewer alone → alone; a second live person → none; no read → none', () => {
    expect(decisionFact(ROWS_NO_HEAD, O1)).toBe('no_head');
    expect(decisionFact(ROWS_LONE, H1)).toBe('alone');
    expect(decisionFact(ROWS, H1)).toBeNull();
    expect(decisionFact(null, H1)).toBeNull();
  });
});

describe('PC-56 GOV-2c · the named refusals ×3 and the chains', () => {
  it('every act refusal GOV-2a names has words in en / hi / gu (each its own); anything else → ACT_FAILED', () => {
    for (const code of ['GOV_DECIDER_IS_VERIFIER', 'GOV_DECIDER_IS_APPLICANT', 'GOV_DECIDER_IS_ASSISTER', 'GOV_NOT_VERIFIED', 'GOV_REASON_CODE_REQUIRED', 'GOV_REASON_REQUIRED', 'GOV_NOTE_REQUIRED', 'GOV_ACT_NOT_NOW'])
      expect([code, ACT_ERRORS[code]]).toEqual([code, `gov2.err.${code}`]);
    for (const k of Object.values(ACT_ERRORS)) for (const [l, cat] of Object.entries(CATS)) expect([l, k, typeof cat[k]]).toEqual([l, k, 'string']);
    for (const k of Object.values(ACT_ERRORS)) for (const cat of [hi, gu]) expect([k, cat[k] !== en[k]]).toEqual([k, true]);
    expect(en['gov2.err.GOV_DECIDER_IS_VERIFIER']).toBe('The person who checked this application does not decide it. Another person decides.');
    expect(en['gov2.err.GOV_DECIDER_IS_APPLICANT']).toBe('Nobody decides their own application.');
    expect(en['gov2.err.GOV_DECIDER_IS_ASSISTER']).toBe('Nobody decides an application they helped make.');
    expect(en['gov2.err.GOV_NOT_VERIFIED']).toBe('This application has not been checked. A decision follows a check by another person.');
    expect(actErrorCode('NOPE')).toBe('ACT_FAILED'); expect(actErrorCode('GOV_NOT_VERIFIED')).toBe('GOV_NOT_VERIFIED');
  });
  it('the list: do=file → the file chain, do=reread → the re-read; an application: reread, or an act name → the act chain', () => {
    expect(appChainFor({ do: 'file' }, false)).toBe('applications_file'); expect(appChainFor({ do: 'reread' }, false)).toBe('applications_reread');
    expect(appChainFor({ do: 'approve' }, false)).toBeNull();
    expect(appChainFor({ do: 'approve' }, true)).toBe('application_act'); expect(appChainFor({ do: 'reread' }, true)).toBe('application_reread');
    expect(appChainFor({ do: 'file' }, true)).toBeNull(); expect(appChainFor({}, true)).toBeNull();
  });
  it('Back → the application that opened it; the list (or a junk id) → /applications; the act link opens its confirm state', () => {
    expect(appChainBack(ID)).toBe(`/applications/${ID}`); expect(appChainBack(null)).toBe('/applications'); expect(appChainBack('../x')).toBe('/applications');
    expect(actHref(ID, 'reject')).toBe(`/applications/${ID}?do=reject&act=confirm`);
  });
});
