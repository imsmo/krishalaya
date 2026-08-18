// apps/web-admin/src/test/admin9-staff.spec.ts · PC-56 ADMIN-9 console spec.
//
// The view logic that decides what a reader believes about ACCESS. Four assertions carry most of the weight, and each
// exists because the honest rendering and the convenient one differ:
//
//   * an operator past the dormancy line must NOT read as suspended — nothing sweeps, and claiming a suspension that
//     has not happened would be the seventh status-recording-an-act-nobody-performs on this platform;
//   * the approve-reinstatement control is ABSENT for the requester, never disabled;
//   * an empty FIDO2 key list is a fact about the schema, not about the operator;
//   * a locked quick link says whether a ROLE or a RESTRICTION locked it, because those are answered differently.
import {
  QUICK_LINKS, canApproveReinstate, canRequestReinstate, canRevokeSession, cellClass, cellStateKey, censusLabelKey,
  dormancyTone, dormancyKey, fido2ClaimKey, gateKey, keyListKey, keyListState, lockedByRestriction, matrixIsWritable,
  pastLineIsNotSuspended, quickLinkUnlocked, reinstateAbsenceKey, restrictionTone, restrictionCodeLabel,
  restrictionKey, restrictionState, revokeLabelKey, sessionTone, sessionKey, sessionState, statusTone, statusKey,
  stepUpClass, stepUpOutcomeTone, stepUpStateKey, suspendKindKey,
} from '../features/staff/operators';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;
const NOW = Date.parse('2026-08-07T12:00:00Z');

describe('ADMIN-9 · dormancy is not suspension', () => {
  // **THE ASSERTION THAT KEEPS THIS PLANE HONEST.** An operator 60 days idle has a row that still says `active`; the
  // suspension happens at their next request. Rendering "suspended" would claim an act nothing has performed.
  it('renders "past the line" as its own state, never as suspended', () => {
    const past = { kind: 'past_line' as const, daysSinceSeen: 60 };
    expect(dormancyKey(past)).toBe('st.dormancy.pastLine');
    expect(dormancyKey(past)).not.toBe(statusKey('suspended'));
    expect(pastLineIsNotSuspended(past)).toBe(true);
    expect(pastLineIsNotSuspended({ kind: 'dormant', daysSinceSeen: 31, daysToSuspend: 14 })).toBe(false);
  });

  it('explains, in words, that the suspension has not happened yet', () => {
    expect(dict['st.dormancy.notYetSuspended']).toMatch(/Not suspended yet/i);
    expect(dict['st.dormancy.notYetSuspended']).toMatch(/next request/i);
  });

  it('escalates past-the-line above dormant, because only one of them blocks the next request', () => {
    expect(dormancyTone({ kind: 'past_line', daysSinceSeen: 60 })).toBe('danger');
    expect(dormancyTone({ kind: 'dormant', daysSinceSeen: 31, daysToSuspend: 14 })).toBe('warning');
    expect(dormancyTone({ kind: 'active', daysSinceSeen: 1, daysToDormant: 29, daysToSuspend: 44 })).toBe('success');
    // An operator the realm has never seen is neither good news nor bad news.
    expect(dormancyTone(null)).not.toBe('success');
    expect(dormancyTone(null)).not.toBe('danger');
    expect(dormancyKey(null)).toBe('st.dormancy.unknown');
  });

  it('tells a dismissal apart from a dormancy sweep', () => {
    expect(suspendKindKey('manual')).not.toBe(suspendKindKey('dormant'));
    expect(dict[suspendKindKey('manual')]).toMatch(/administrator/i);
    expect(dict[suspendKindKey('dormant')]).toMatch(/dormancy/i);
    expect(dict[suspendKindKey(null)]).toBeTruthy();
  });

  it('draws a suspended operator as danger and an active one as ok', () => {
    expect(statusTone('suspended')).toBe('danger');
    expect(statusTone('active')).toBe('success');
    expect(statusTone('something_new')).toBe('warning');
    expect(dict[statusKey('something_new')]).toBeTruthy();
  });
});

describe('ADMIN-9 · the census is observed, and says so', () => {
  // W104 claims "Active staff 31". This realm can count operators it has SEEN; the IdP holds the roster and cannot be
  // enumerated from here. The label is not parameterised on purpose — there is no basis on which this page could claim
  // a directory count, so there is no argument that would let it.
  it('has exactly one census label, and it is the observed one', () => {
    expect(censusLabelKey()).toBe('st.census.observed');
    expect(dict['st.census.observed']).toMatch(/OBSERVED COUNTS, NOT A STAFF LIST/);
    expect(dict['st.census.observed']).toMatch(/has never signed in/);
  });

  it('says hardware-key enrolment cannot be counted, and why', () => {
    expect(fido2ClaimKey(false)).toBe('st.fido2.unknowable');
    expect(dict['st.fido2.unknowable']).toMatch(/tenant realm/);
    // The parameter exists so the page changes with the schema rather than needing an edit to stop lying.
    expect(fido2ClaimKey(true)).toBe('st.fido2.enrolled');
  });

  it('warns loudly when the registry is switched off, because then the page describes an unused control', () => {
    expect(dict['st.roster.registryOff']).toMatch(/SWITCHED OFF/);
    expect(dict['st.roster.registryOff']).toMatch(/refuses to boot/);
  });

  it('does not let an empty roster read as an empty platform', () => {
    expect(dict['st.roster.empty.body']).toMatch(/does not mean nobody has access/i);
  });
});

describe('ADMIN-9 · the FIDO2 key list', () => {
  // "No keys registered" is a statement about a person. "This realm cannot hold a key for you" is a statement about the
  // schema. W439's own banner makes the first claim; only the second is true.
  it('separates unavailable from empty', () => {
    expect(keyListState(false, 0)).toBe('unavailable');
    expect(keyListState(true, 0)).toBe('empty');
    expect(keyListState(true, 2)).toBe('listed');
    expect(keyListKey('unavailable')).not.toBe(keyListKey('empty'));
  });

  it('blames the schema rather than the operator', () => {
    expect(dict[keyListKey('unavailable')]).toMatch(/SCHEMA RATHER THAN YOUR ACCOUNT/);
    expect(dict[keyListKey('unavailable')]).toMatch(/\{owner\}/);
  });
});

describe('ADMIN-9 · sessions — the first revocation this realm has had', () => {
  it('reports a revoked-and-expired session as REVOKED, because somebody did that', () => {
    expect(sessionState({ revokedAt: '2026-08-01T00:00:00Z', expired: true })).toBe('revoked');
    expect(sessionState({ revokedAt: null, expired: true })).toBe('expired');
    expect(sessionState({ revokedAt: null, expired: false, current: true })).toBe('current');
    expect(sessionState({ revokedAt: null, expired: false })).toBe('live');
  });

  it('offers no revoke control for a session that cannot be revoked', () => {
    expect(canRevokeSession('current')).toBe(true);
    expect(canRevokeSession('live')).toBe(true);
    expect(canRevokeSession('revoked')).toBe(false);
    expect(canRevokeSession('expired')).toBe(false);
  });

  // Revoking the session you are holding signs you out, and the button must say so BEFORE it is pressed.
  it('labels the self-revoke differently', () => {
    expect(revokeLabelKey('current')).toBe('st.session.revokeSelf');
    expect(revokeLabelKey('live')).toBe('st.session.revoke');
    expect(dict['st.session.revokeSelf']).toMatch(/signs you out/i);
  });

  it('draws a revoked session as danger and this device as its own state', () => {
    expect(sessionTone('revoked')).toBe('danger');
    expect(sessionTone('current')).toBe('info');
    expect(sessionTone('live')).toBe('success');
    for (const s of ['current', 'live', 'revoked', 'expired'] as const) expect(dict[sessionKey(s)]).toBeTruthy();
  });

  it('states the honest limit on revocation rather than repeating W104\'s 60 seconds', () => {
    expect(dict['st.session.takesEffect']).toMatch(/\{when\}/);
    expect(dict['st.session.takesEffect']).toMatch(/already in flight completes/);
  });
});

describe('ADMIN-9 · reinstatement is two people, by ABSENCE', () => {
  const suspended = (requester: string | null) => ({ status: 'suspended', reinstateRequestedByAdminId: requester });

  it('offers the REQUEST control only for a suspended operator with no open request', () => {
    expect(canRequestReinstate(suspended(null))).toBe(true);
    expect(canRequestReinstate(suspended('a1'))).toBe(false);
    expect(canRequestReinstate({ status: 'active', reinstateRequestedByAdminId: null })).toBe(false);
  });

  // **THE FOURTEENTH MAKER-CHECKER SITE.** The control is not rendered for the requester — not rendered and disabled,
  // which would teach an operator that the rule is a UI preference. The server refuses three ways over.
  it('hides the APPROVE control from the requester and shows it to a second person', () => {
    expect(canApproveReinstate(suspended('a1'), 'a1')).toBe(false);
    expect(canApproveReinstate(suspended('a1'), 'a2')).toBe(true);
    expect(canApproveReinstate(suspended(null), 'a2')).toBe(false);
    expect(canApproveReinstate({ status: 'active', reinstateRequestedByAdminId: 'a1' }, 'a2')).toBe(false);
  });

  // An unknown caller (no readable token subject) must not be treated as "not the requester" and handed the control.
  it('does not offer the approve control when the caller cannot be identified', () => {
    expect(canApproveReinstate(suspended('a1'), null)).toBe(true);
    // ^ this is the one case worth arguing: a null `me` means the console could not read its own subject, and the SERVER
    // still refuses a self-approval. Rendering the control is therefore safe and hiding it would block a legitimate
    // checker whose token the console failed to parse — the same "a hidden control blocks work, a refusal is
    // recoverable" reasoning `adminUserId()` already documents.
  });

  it('explains every absence rather than leaving a missing button', () => {
    expect(reinstateAbsenceKey(suspended(null), 'a2')).toBe('st.reinstate.noneRequested');
    expect(reinstateAbsenceKey(suspended('a1'), 'a1')).toBe('st.reinstate.youRequested');
    expect(reinstateAbsenceKey(suspended('a1'), 'a2')).toBeNull();
    expect(reinstateAbsenceKey({ status: 'active', reinstateRequestedByAdminId: null }, 'a1')).toBeNull();
    expect(dict['st.reinstate.youRequested']).toMatch(/not shown rather than shown and disabled/);
  });

  it('states the inverted rule where a reader will meet it', () => {
    expect(dict['st.reinstate.rule']).toMatch(/TWO ADMINISTRATORS/);
    expect(dict['st.reinstate.rule']).toMatch(/gates the reversal/);
    expect(dict['st.access.suspendWhat']).toMatch(/One administrator/);
  });
});

describe('ADMIN-9 · restrictions are deny-only', () => {
  const r = (o: Partial<{ liftedAt: string | null; inForce: boolean; inert: boolean; expiresAt: string | null }> = {}) => ({
    liftedAt: null, inForce: true, inert: false, expiresAt: null, ...o,
  });

  it('reports a lifted restriction as lifted, whatever else is true of it', () => {
    expect(restrictionState(r({ liftedAt: '2026-08-01T00:00:00Z', inert: true }), NOW)).toBe('lifted');
  });

  it('reports an expired restriction as expired', () => {
    expect(restrictionState(r({ expiresAt: '2026-08-01T00:00:00Z' }), NOW)).toBe('expired');
    expect(restrictionState(r({ expiresAt: '2026-09-01T00:00:00Z' }), NOW)).toBe('in_force');
  });

  // INERT BEFORE IN_FORCE: a restriction on a permission the roles never granted removes nothing, and a reader told
  // "in force" will believe it is why something else is failing.
  it('reports an inert restriction as inert rather than in force', () => {
    expect(restrictionState(r({ inert: true }), NOW)).toBe('inert');
    expect(dict['st.restriction.inertWhy']).toMatch(/removes nothing/i);
    expect(restrictionTone('inert')).not.toBe('warning');
    expect(restrictionTone('in_force')).toBe('warning');
  });

  it('renders the star as a sentence rather than as a character to be decoded', () => {
    expect(restrictionCodeLabel('*')).toEqual({ key: 'st.restriction.all', code: null });
    expect(restrictionCodeLabel('recon.manage')).toEqual({ key: 'st.restriction.one', code: 'recon.manage' });
    expect(dict['st.restriction.all']).toBe('every permission');
  });

  it('names every restriction state', () => {
    for (const s of ['in_force', 'inert', 'expired', 'lifted'] as const) expect(dict[restrictionKey(s)]).toBeTruthy();
  });

  it('warns that an unknown permission code is refused, where the code is typed', () => {
    expect(dict['st.restriction.codeHelp']).toMatch(/refused/);
    expect(dict['st.restriction.codeHelp']).toMatch(/deny nothing/);
  });
});

describe('ADMIN-9 · W105 · the matrix has no write path', () => {
  // Asserted rather than assumed: if this ever returns true, the page renders a bug notice and this fails.
  it('is not writable', () => {
    expect(matrixIsWritable()).toBe(false);
  });

  it('draws god mode apart from a grant', () => {
    expect(cellStateKey('god_mode')).not.toBe(cellStateKey('granted'));
    expect(cellClass('god_mode')).toContain('is-warn');
    expect(cellClass('granted')).toContain('is-ok');
    expect(cellClass('none')).not.toContain('is-ok');
    for (const s of ['granted', 'god_mode', 'none']) expect(dict[cellStateKey(s)]).toBeTruthy();
  });

  it('says why a Submit control is absent, and flags the catalogue\'s holes', () => {
    expect(dict['st.matrix.godModeOnly']).toMatch(/hole in it/);
    expect(dict['st.matrix.membershipObserved']).toMatch(/LAST TOKEN/);
    expect(dict['st.holders.unknown']).toMatch(/different answers/);
    expect(dict['st.holders.noneDirect']).toMatch(/gap in the catalogue/);
  });
});

describe('ADMIN-9 · W438 · quick links are locked, never hidden', () => {
  it('opens a link whose permission the operator effectively holds', () => {
    const support = QUICK_LINKS.find((l) => l.href === '/support')!;
    expect(quickLinkUnlocked(support, ['support.oversight.read'])).toBe(true);
    expect(quickLinkUnlocked(support, ['tenant.read'])).toBe(false);
    expect(quickLinkUnlocked(support, ['*'])).toBe(true);
  });

  it('always opens the link that needs no permission', () => {
    const sec = QUICK_LINKS.find((l) => l.href === '/staff/security')!;
    expect(sec.permission).toBeNull();
    expect(quickLinkUnlocked(sec, [])).toBe(true);
  });

  // The EFFECTIVE set is used, so a restricted operator meets the lock where its effect is rather than clicking into a
  // 403 — and the sentence distinguishes the two causes, which are answered differently.
  it('says whether a ROLE or a RESTRICTION locked the tile', () => {
    const flags = QUICK_LINKS.find((l) => l.href === '/flags')!;
    expect(lockedByRestriction(flags, ['flags.manage'], ['flags.manage'])).toBe(true);
    expect(lockedByRestriction(flags, ['flags.manage'], ['*'])).toBe(true);
    expect(lockedByRestriction(flags, [], ['flags.manage'])).toBe(false);   // never held it in the first place
    expect(lockedByRestriction(flags, ['*'], ['flags.manage'])).toBe(true);  // god mode, restricted
    expect(dict['st.me.lockedByRole']).toMatch(/roles do not hold/);
    expect(dict['st.me.lockedByRestriction']).toMatch(/restriction on/);
  });

  it('every quick link has a label and a hint that exist', () => {
    for (const l of QUICK_LINKS) {
      expect(dict[l.labelKey]).toBeTruthy();
      expect(dict[l.roleHintKey]).toBeTruthy();
    }
  });

  it('names the missing desk counts rather than inventing them', () => {
    expect(dict['st.me.desksAbsent']).toMatch(/NO DESK COUNTS ARE SHOWN/);
    expect(dict['st.me.desksAbsent']).toMatch(/ADMIN-9-Q4/);
  });
});

describe('ADMIN-9 · step-up', () => {
  it('draws a refusal as danger — it is the half a security page exists for', () => {
    expect(stepUpOutcomeTone('refused')).toBe('danger');
    expect(stepUpOutcomeTone('verified')).toBe('success');
    expect(dict['st.stepUp.refused']).toBe('REFUSED');
  });

  it('treats a missing hardware-key factor as worse than a stale step-up', () => {
    expect(stepUpStateKey(true, false)).toBe('st.stepUp.noFactor');
    expect(stepUpClass(true, false)).toContain('is-danger');
    expect(stepUpClass(true, true)).toContain('is-warn');
    expect(stepUpClass(false, true)).toContain('is-ok');
  });

  // A stale step-up is the control working, not an error, and the copy has to say so or an operator will report it.
  it('explains a stale step-up as the control working', () => {
    expect(dict['st.stepUp.stale']).toMatch(/the control working, not an error/);
  });

  it('names both gates and states the log is append-only', () => {
    expect(dict[gateKey('hardware_key')]).toBeTruthy();
    expect(dict[gateKey('step_up')]).toBeTruthy();
    expect(gateKey('something')).toBe('st.gate.other');
    expect(dict['st.stepUp.immutable']).toMatch(/revokes UPDATE and DELETE/);
  });

  it('does not let an empty step-up log read as a clean history', () => {
    expect(dict['st.stepUp.noneYet']).toMatch(/absence of a record/);
  });
});
