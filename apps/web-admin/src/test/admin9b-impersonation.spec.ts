// apps/web-admin/src/test/admin9b-impersonation.spec.ts · PC-56 ADMIN-9b console spec.
//
// W008's copy made four promises that nothing kept — read-only enforcement, a per-request log, a hard expiry, and a
// notified tenant. The backend now keeps them; these tests hold the CONSOLE to describing the state of the enforcement
// rather than repeating the copy. Three assertions carry the weight:
//
//   * an UNKNOWN enforcement state is drawn as loudly as an absent one — a page that cannot tell you whether the
//     read-only rule is running must not imply that it is;
//   * an elapsed grant that still reads `active` says so, because that is what the missing expiry writer produced;
//   * "used after end" outranks "write blocked", because a token used past its window is the worse finding.
import {
  actionOutcomeClass, actionOutcomeKey, enforcementClass, enforcementKey, isElapsedButActive, minutesLeft, noticeKey,
  sessionShapeClass, sessionShapeKey, type ActionCounts, type EnforcementState,
} from '../features/impersonation/grant';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;
const NOW = Date.parse('2026-08-07T12:00:00Z');

const enforced = (over: Partial<EnforcementState> = {}): EnforcementState => ({
  verifierExists: true,
  readOnlyEnforcedAtRequestTime: true,
  perRequestLoggingByPlatform: true,
  revocationTakesEffect: 'the next request the operator makes',
  formatDuplicationOwner: 'ADMIN-9b-Q1',
  ...over,
});

const counts = (o: Partial<ActionCounts> = {}): ActionCounts => ({ served: 0, refusedWrite: 0, refusedGrant: 0, ...o });

describe('ADMIN-9b · the console reports what is ENFORCED, not what the copy says', () => {
  it('says fully enforced only when the verifier, the read-only rule and the platform log are all live', () => {
    expect(enforcementKey(enforced())).toBe('imp.enforce.full');
    expect(enforcementKey(enforced({ readOnlyEnforcedAtRequestTime: false }))).toBe('imp.enforce.partial');
    expect(enforcementKey(enforced({ perRequestLoggingByPlatform: false }))).toBe('imp.enforce.partial');
    // No verifier is the pre-ADMIN-9b world: a minted token did nothing at all.
    expect(enforcementKey(enforced({ verifierExists: false }))).toBe('imp.enforce.absent');
  });

  // **AN UNREADABLE STATE IS DRAWN AS LOUDLY AS AN ABSENT ONE.** The convenient rendering would be neutral; the honest
  // one is that a page which cannot verify the control must not imply it is running.
  it('treats an unknown enforcement state as dangerous', () => {
    expect(enforcementKey(null)).toBe('imp.enforce.unknown');
    expect(enforcementClass(null)).toContain('is-danger');
    expect(enforcementClass(enforced({ verifierExists: false }))).toContain('is-danger');
    expect(enforcementClass(enforced({ perRequestLoggingByPlatform: false }))).toContain('is-warn');
    expect(enforcementClass(enforced())).toContain('is-ok');
  });

  it('states each enforcement sentence in words a reader can act on', () => {
    expect(dict['imp.enforce.full']).toMatch(/refuses every write/i);
    expect(dict['imp.enforce.full']).toMatch(/next click/i);
    expect(dict['imp.enforce.absent']).toMatch(/a minted grant does nothing/i);
    expect(dict['imp.enforce.unknown']).toMatch(/unverified/i);
  });
});

describe('ADMIN-9b · expiry stopped being a decoration', () => {
  it('flags a grant whose window has elapsed while its status still says active', () => {
    expect(isElapsedButActive('active', '2026-08-07T11:00:00Z', NOW)).toBe(true);
    expect(isElapsedButActive('active', '2026-08-07T13:00:00Z', NOW)).toBe(false);
    // A terminal grant is not "elapsed but active" whatever its expiry says — it already ended.
    expect(isElapsedButActive('ended', '2026-08-07T11:00:00Z', NOW)).toBe(false);
    expect(isElapsedButActive('revoked', '2026-08-07T11:00:00Z', NOW)).toBe(false);
    expect(isElapsedButActive('active', null, NOW)).toBe(false);
    expect(isElapsedButActive('active', 'not-a-date', NOW)).toBe(false);
  });

  it('floors the time remaining, so a session is never described as having more than it has', () => {
    expect(minutesLeft('2026-08-07T12:14:59Z', NOW)).toBe(14);
    expect(minutesLeft('2026-08-07T12:15:00Z', NOW)).toBe(15);
    expect(minutesLeft('2026-08-07T11:00:00Z', NOW)).toBe(0);   // never negative
    expect(minutesLeft(null, NOW)).toBeNull();
    expect(minutesLeft('nonsense', NOW)).toBeNull();
  });

  it('explains what an unreconciled backlog means rather than just counting it', () => {
    expect(dict['imp.staleActive']).toMatch(/reading as ACTIVE/);
    expect(dict['imp.staleActive']).toMatch(/holding the one-active-grant/);
  });
});

describe('ADMIN-9b · what the session actually did', () => {
  it('reads a clean session as a count and nothing more', () => {
    expect(sessionShapeKey(counts())).toBe('imp.actions.none');
    expect(sessionShapeKey(counts({ served: 12 }))).toBe('imp.actions.served');
    expect(sessionShapeClass(counts({ served: 12 }))).not.toContain('is-warn');
  });

  it('surfaces blocked writes — W008 renders one as a first-class row', () => {
    expect(sessionShapeKey(counts({ served: 12, refusedWrite: 3 }))).toBe('imp.actions.blockedWrites');
    expect(sessionShapeClass(counts({ served: 12, refusedWrite: 3 }))).toContain('is-warn');
    expect(dict['imp.actions.blockedWrites']).toMatch(/tried to change something/);
  });

  // **USE-AFTER-END OUTRANKS A BLOCKED WRITE.** A blocked write is the control working; a request made after the grant
  // stopped being live is somebody still holding a token they should not be using.
  it('ranks use-after-end above everything else', () => {
    expect(sessionShapeKey(counts({ served: 40, refusedWrite: 5, refusedGrant: 1 }))).toBe('imp.actions.usedAfterEnd');
    expect(sessionShapeClass(counts({ refusedGrant: 1 }))).toContain('is-danger');
    expect(dict['imp.actions.usedAfterEnd']).toMatch(/first/);
  });

  it('says the counts are unknown rather than showing zero when they could not be read', () => {
    // Zero and unreadable are opposite findings: the first says nobody looked, the second says we cannot tell.
    expect(sessionShapeKey(null)).toBe('imp.actions.unknown');
    expect(sessionShapeKey(null)).not.toBe(sessionShapeKey(counts()));
  });

  it('labels every action outcome, and an unrecognised one visibly', () => {
    for (const o of ['served', 'refused_write', 'refused_grant']) expect(dict[actionOutcomeKey(o)]).toBeTruthy();
    expect(actionOutcomeKey('something_new')).toBe('imp.outcome.other');
    expect(actionOutcomeClass('refused_grant')).toContain('is-danger');
    expect(actionOutcomeClass('refused_write')).toContain('is-warn');
    expect(actionOutcomeClass('served')).not.toContain('is-danger');
  });

  // The sentence that distinguishes this log from the one that existed before.
  it('says who writes the log', () => {
    expect(dict['imp.actionsWrittenBy']).toMatch(/written by the server/i);
    expect(dict['imp.actionsWrittenBy']).toMatch(/is not evidence/);
  });
});

describe('ADMIN-9b · the notice to the impersonated person', () => {
  it('separates "not sent" from "not recorded"', () => {
    expect(noticeKey(true)).toBe('imp.notice.sent');
    expect(noticeKey(false)).toBe('imp.notice.none');
    // Sessions opened before this release were never notified and have no record of one — reading that absence as
    // "not sent" would be true, and reading it as a decision somebody made would not be.
    expect(noticeKey(null)).toBe('imp.notice.unknown');
    expect(noticeKey(undefined)).toBe('imp.notice.unknown');
    expect(dict['imp.notice.unknown']).toMatch(/never notified at all/);
  });

  it('describes the transparency the platform now actually provides', () => {
    expect(dict['imp.transparency']).toMatch(/notified when a session starts and when it ends/);
    expect(dict['imp.transparency']).toMatch(/page-by-page log/);
  });
});
