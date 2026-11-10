// apps/web-gov/src/test/gov1-refusals.spec.ts · PC-56 GOV-1a · E5 — the GOV-1 registry (features/gov1/refusals.ts): ALL 21 canon files, one
// verdict each (1a decides its 9, 1b's 12 pending); the 17 chain files in exactly one group each; every refusal / chain key in en, hi and gu;
// the login chain's Back is /login. Plus the pure sign-in landing (features/gov1/login.ts) and the access offers (features/gov1/access.ts).
import { CHAIN_BACK, GOV1_CANON_FILES, GOV1_CHAIN_GROUPS, GOV1_CHAINS, GOV1_REFUSALS, GOV1_DELTAS, SURFACES_1A, SURFACES_1B, chain1State } from '../features/gov1/refusals';
import { landing, landingHref, LOGIN_ERRORS, loginErrorCode, loginStep, secondFactorInput, waitMinutes } from '../features/gov1/login';
import { ACCESS_ERRORS, approverFact, atUtc, canOfferApprove, canOfferRemove, canRequest, rowStatus, whoOf } from '../features/gov1/access';
import type { GovMe, GovMembership } from '@krishalaya/sdk-js';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;

describe('PC-56 GOV-1 · the registry', () => {
  it('21 canon files, each once, one verdict; 1a decides 9, 1b holds 12 pending', () => {
    expect(GOV1_CANON_FILES).toHaveLength(21);
    expect(new Set(GOV1_CANON_FILES.map((f) => f.file)).size).toBe(21);
    const a = GOV1_CANON_FILES.filter((f) => f.wave === '1a');
    expect(a).toHaveLength(9); expect(a.every((f) => f.verdict !== 'pending_1b')).toBe(true);
    const b = GOV1_CANON_FILES.filter((f) => f.wave === '1b');
    expect(b).toHaveLength(12); expect(b.every((f) => f.verdict === 'pending_1b')).toBe(true);
    expect(a.map((f) => f.file.split('-')[0]).sort()).toEqual(['W3198', 'W3199', 'W3200', 'W3229', 'W3230', 'W3231', 'W3232', 'W355', 'W359']);
  });
  it('17 chain files, each in exactly one group; each group\'s files are canon files of the same wave', () => {
    const all = GOV1_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(17); expect(new Set(all).size).toBe(17);
    for (const g of GOV1_CHAIN_GROUPS) for (const f of g.files) {
      const c = GOV1_CANON_FILES.find((x) => x.file.startsWith(`${f}-`));
      expect([f, c?.wave]).toEqual([f, g.wave]);
    }
    expect(GOV1_CANON_FILES.length - all.length).toBe(4);   // the four real screens
  });
  it('the built chains belong to 1a groups, and the login chain\'s Back is /login — never the dashboard', () => {
    for (const c of GOV1_CHAINS) expect(GOV1_CHAIN_GROUPS.find((g) => g.id === c.group)?.wave).toBe('1a');
    expect(CHAIN_BACK).toEqual({ login_form: '/login', access_act: '/access', access_reread: '/access' });
    expect(chain1State('login_form', { act: 'review' })).toBe('review'); expect(chain1State('login_form', { act: 'confirm' })).toBeNull();
    expect(chain1State('access_act', { act: ['success'] })).toBe('success');
  });
  it('every refusal id once, every refusal and chain key in en/hi/gu; 1a surfaces cover only 1a', () => {
    expect(new Set(GOV1_REFUSALS.map((r) => r.id)).size).toBe(GOV1_REFUSALS.length);
    expect(new Set(GOV1_DELTAS.map((d) => d.id)).size).toBe(GOV1_DELTAS.length);
    for (const [l, cat] of Object.entries(CATS)) {
      for (const r of GOV1_REFUSALS) expect([l, r.key, typeof cat[r.key]]).toEqual([l, r.key, 'string']);
      for (const c of GOV1_CHAINS) for (const k of [c.statement, c.backKey, c.rereadKey]) expect([l, k, typeof cat[k]]).toEqual([l, k, 'string']);
      for (const e of Object.values(LOGIN_ERRORS)) expect([l, e.key, typeof cat[e.key]]).toEqual([l, e.key, 'string']);
      for (const k of Object.values(ACCESS_ERRORS)) expect([l, k, typeof cat[k]]).toEqual([l, k, 'string']);
    }
    for (const r of GOV1_REFUSALS) for (const s of r.surfaces) expect([r.id, SURFACES_1A.includes(s) || SURFACES_1B.includes(s)]).toEqual([r.id, true]);
    expect(GOV1_REFUSALS.every((r) => r.surfaces.every((s) => SURFACES_1A.includes(s)))).toBe(true);   // 1b adds its own
  });
  it('every English refusal says no (the negative-word rule)', () => {
    const NEG = /\b(no|not|never|nobody|nothing|cannot|only)\b|n't\b/i;
    for (const r of GOV1_REFUSALS) expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
  });
});

describe('PC-56 GOV-1a · the sign-in landing (pure)', () => {
  it('a step: chooser, authenticator, set-up', () => {
    expect(landing('GOV_CHOICE_REQUIRED', 403, {})).toEqual({ kind: 'step', step: 'choose' });
    expect(landing('TWO_FACTOR_PENDING', 403, { challengeToken: 'x' })).toEqual({ kind: 'step', step: '2fa' });
    expect(landing('GOV_TWO_FACTOR_REQUIRED', 403, { enrolToken: 'x' })).toEqual({ kind: 'step', step: 'enrol' });
  });
  it('the code: wrong (tries left) / expired → form-error; locked (the wait, minutes up) → failure', () => {
    expect(landing('OTP_INVALID', 401, { reason: 'wrong', attemptsLeft: 2 })).toEqual({ kind: 'chain', act: 'form-error', error: 'OTP_WRONG', left: 2 });
    expect(landing('OTP_INVALID', 401, { reason: 'expired', attemptsLeft: 0 })).toEqual({ kind: 'chain', act: 'form-error', error: 'OTP_EXPIRED' });
    expect(landing('OTP_INVALID', 401, { reason: 'locked', attemptsLeft: 0, retryAfterSec: 61 })).toEqual({ kind: 'chain', act: 'failure', error: 'OTP_LOCKED', wait: 2 });
    expect(waitMinutes(0)).toBe(1); expect(waitMinutes(60)).toBe(1); expect(waitMinutes('x')).toBe(1);
  });
  it('named refusals keep their name; 429 → rate limited; 404 → switched off; anything else → the generic one', () => {
    expect(landing('GOV_ACCESS_NONE', 403, {})).toEqual({ kind: 'chain', act: 'failure', error: 'GOV_ACCESS_NONE' });
    expect(landing('TOTP_INVALID', 401, {})).toEqual({ kind: 'chain', act: 'form-error', error: 'TOTP_INVALID' });
    expect(landing('RATE_LIMITED', 429, {})).toEqual({ kind: 'chain', act: 'failure', error: 'RATE_LIMITED' });
    expect(landing('NOT_FOUND', 404, {})).toEqual({ kind: 'off' });
    expect(landing('BOOM', 500, {})).toEqual({ kind: 'chain', act: 'failure', error: 'LOGIN_FAILED' });
    expect(landing(null, null, null)).toEqual({ kind: 'chain', act: 'failure', error: 'LOGIN_FAILED' });
  });
  it('the address carries no phone and no token; a form-error keeps its step', () => {
    expect(landingHref({ kind: 'chain', act: 'form-error', error: 'OTP_WRONG', left: 2 }, 'verify')).toBe('/login?act=form-error&error=OTP_WRONG&step=verify&left=2');
    expect(landingHref({ kind: 'step', step: 'enrol' })).toBe('/login?step=enrol');
    expect(landingHref({ kind: 'off' })).toBe('/login');
    expect(loginErrorCode('NOPE')).toBe('LOGIN_FAILED'); expect(loginErrorCode(undefined)).toBeNull();
    expect(loginStep('2fa')).toBe('2fa'); expect(loginStep('sso')).toBe('phone');
    expect(secondFactorInput(' 123456 ')).toEqual({ code: '123456' }); expect(secondFactorInput('abcd-efgh-01')).toEqual({ recoveryCode: 'abcd-efgh-01' });
  });
});

describe('PC-56 GOV-1a · the access offers (pure; Q4-A)', () => {
  const HEAD: GovMe = { authority: { id: 'a', name: 'A', level: 'state' }, person: { userId: 'h1', roles: ['authority_head'], permissions: ['authority.members.approve', 'authority.members.read', 'authority.members.remove', 'authority.members.request'], phoneMasked: null, accessEndsAt: null }, realm: 'gov' };
  const OFF: GovMe = { ...HEAD, person: { ...HEAD.person, userId: 'o1', roles: ['authority_officer'], permissions: ['authority.members.read', 'authority.members.request'] } };
  const row = (o: Partial<GovMembership>): GovMembership => ({ membershipId: 'm', userId: 'x', name: null, phoneMasked: '••••••1', roleCode: 'authority_officer', status: 'requested', live: false, termMonths: 3,
    requestedBy: 'o1', requestedByPlatform: false, requestReason: 'r', requestedAt: null, approvedBy: null, approvedAt: null, expiresAt: null, removedBy: null, removedAt: null, removedReason: null, ...o });
  it('approve: a head, a pending row, neither the requester nor the grantee', () => {
    expect(canOfferApprove(row({}), HEAD)).toBe(true);
    expect(canOfferApprove(row({ requestedBy: 'h1' }), HEAD)).toBe(false);
    expect(canOfferApprove(row({ userId: 'h1' }), HEAD)).toBe(false);
    expect(canOfferApprove(row({ status: 'active', live: true }), HEAD)).toBe(false);
    expect(canOfferApprove(row({}), OFF)).toBe(false);
  });
  it('remove: a head, a pending or active row, never their own; request: every member', () => {
    expect(canOfferRemove(row({}), HEAD)).toBe(true); expect(canOfferRemove(row({ status: 'active', live: false }), HEAD)).toBe(true);
    expect(canOfferRemove(row({ userId: 'h1' }), HEAD)).toBe(false); expect(canOfferRemove(row({ status: 'removed' }), HEAD)).toBe(false);
    expect(canOfferRemove(row({}), OFF)).toBe(false);
    expect([canRequest(HEAD), canRequest(OFF)]).toEqual([true, true]);
  });
  it('status, who, the approver fact, UTC times', () => {
    expect(rowStatus(row({ status: 'active', live: false }))).toBe('ended'); expect(rowStatus(row({ status: 'active', live: true }))).toBe('active');
    expect(whoOf('h1', [], 'h1')).toEqual({ kind: 'you' }); expect(whoOf(null, [], 'h1', true)).toEqual({ kind: 'platform' });
    expect(whoOf('zz', [], 'h1')).toEqual({ kind: 'unlisted' }); expect(whoOf(null, [], 'h1')).toEqual({ kind: 'none' });
    const head = (u: string, live = true) => row({ userId: u, roleCode: 'authority_head', status: 'active', live });
    expect(approverFact([head('h1')], 'h1')).toBe('only_you'); expect(approverFact([head('h1'), head('h2')], 'h1')).toBeNull();
    expect(approverFact([head('h1', false)], 'o1')).toBe('none'); expect(approverFact([head('h1')], 'o1')).toBeNull();
    expect(atUtc('2027-01-02T03:04:05.000Z')).toBe('2027-01-02 03:04 UTC'); expect(atUtc('junk')).toBeNull();
  });
});
