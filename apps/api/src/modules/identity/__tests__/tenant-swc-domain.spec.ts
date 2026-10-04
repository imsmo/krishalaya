// modules/identity/__tests__/tenant-swc-domain.spec.ts · PC-56 TENANT-SW-c · the PURE domain of the verification desk and the team:
// skip reasons, the median rule, name / phone masking, conflicts, seats, invite tokens, TOTP (RFC 6238 vectors), recovery codes,
// maker-checker pairs, removal refusals, the posture verdict, and the trigger-code naming. Each list a second copy (0199, the seeds)
// also holds is compared against that copy.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CLAIM_MINUTES, INVITE_DAYS, MAKER_CHECKER_RULES, OVERRIDE_CHECKER_CODES, SEAT_DEFAULTS, SESSION_POSTURE_CACHE_SECONDS, STAFF_ROLE_CODES,
  conflictRefusals, inviteLink, inviteTokenHash, isPrivilegedAction, looksLikeInviteToken, makerCheckerPairs, maskName, maskPhone, medianLabel,
  newInviteToken, overrideNeedsChecker, reasonRefusal, removeRefusals, seatState, skipRefusal,
} from '../domain/verification-team';
import {
  hashRecoveryCode, looksLikeRecoveryCode, matchedStep, newRecoveryCodes, newTotpSecret, normaliseRecoveryCode, otpauthUri, stepAt, totpCodeAt,
} from '../domain/totp';
import { SWC_CODES, SwcRefusedError, namedSwcRefusal } from '../domain/swc.errors';
import { SESSION_POSTURE_CACHE_SECONDS as GUARD_CACHE_SECONDS, postureVerdict } from '../../../core/auth/session-posture.guard';

const repo = (rel: string) => fs.readFileSync(path.join(__dirname, '../../../../../..', rel), 'utf8');
const MIG = () => repo('db/migrations/0199_verification_team.sql');
const A = '01a0c000-0000-7000-8000-0000000000a1';
const B = '01a0c000-0000-7000-8000-0000000000b2';

describe('A · the desk', () => {
  it('a skip needs a known reason, and words for "other"', () => {
    expect(skipRefusal('language', '')).toBeNull();
    expect(skipRefusal('bored', '')).toBe('SKIP_REASON_REQUIRED');
    expect(skipRefusal('other', 'short')).toBe('SKIP_REASON_REQUIRED');
    expect(skipRefusal('other', 'the scan is from a different person')).toBeNull();
    expect(skipRefusal('language', 'x'.repeat(301))).toBe('SKIP_REASON_REQUIRED');
  });
  it('the claim window and the skip reasons are the migration\'s', () => {
    expect(CLAIM_MINUTES).toBe(15);
    expect(MIG()).toMatch(/interval '15 minutes'/);
    for (const r of ['needs_specialist', 'evidence_unclear', 'language', 'conflict_to_declare', 'other']) expect(MIG()).toContain(`'${r}'`);
  });
  it('the median: minutes under an hour, hours under two days, else days; null when there is nothing', () => {
    expect(medianLabel(null)).toBeNull();
    expect(medianLabel(Number.NaN)).toBeNull();
    expect(medianLabel(10)).toEqual({ value: 1, unit: 'minutes' });
    expect(medianLabel(1500)).toEqual({ value: 25, unit: 'minutes' });
    expect(medianLabel(7200)).toEqual({ value: 2, unit: 'hours' });
    expect(medianLabel(86_400 * 5)).toEqual({ value: 5, unit: 'days' });
  });
  it('a claimer\'s name is masked to an initial', () => {
    expect(maskName('Ramesh Patel')).toBe('R•••••');
    expect(maskName('Al')).toBe('A••');
    expect(maskName('')).toBe('••••');
    expect(maskName(null)).toBe('••••');
  });
  it('conflicts: relation, reason, a member who is not the declarer', () => {
    expect(conflictRefusals({ relation: 'family', reason: 'my cousin on the board', memberUserId: B, staffUserId: A })).toEqual([]);
    expect(conflictRefusals({ relation: 'surname', reason: 'x', memberUserId: 'nope' })).toEqual(['CONFLICT_RELATION', 'REASON_REQUIRED', 'CONFLICT_MEMBER_REQUIRED']);
    expect(conflictRefusals({ relation: 'other', relationNote: '', reason: 'we share a tractor', memberUserId: B })).toEqual(['CONFLICT_RELATION_NOTE']);
    expect(conflictRefusals({ relation: 'family', reason: 'this is myself somehow', memberUserId: A, staffUserId: A })).toEqual(['CONFLICT_SELF']);
  });
});

describe('B · seats, invites, 2FA', () => {
  it('the staff set and the seat defaults are the migration\'s and the seed\'s', () => {
    const m = /UPDATE roles SET is_staff = true WHERE code IN \(([^)]+)\)/.exec(MIG())!;
    expect([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...STAFF_ROLE_CODES]);
    const rulesDir = path.join(__dirname, '../../../../../../db/seeds/rules');
    const seed = fs.readFileSync(path.join(rulesDir, fs.readdirSync(rulesDir).find((f) => f.startsWith('0201'))!), 'utf8');
    const seats = [...seed.matchAll(/'staff_seats',true,'\{"seats": (\d+|null)\}'/g)].map((x) => (x[1] === 'null' ? null : Number(x[1])));
    expect(seats).toEqual(Object.values(SEAT_DEFAULTS));
  });
  it('the seat state is words over read numbers', () => {
    expect(seatState(2, { planName: 'Starter', seats: 3, defined: true })).toEqual({ kind: 'limited', used: 2, seats: 3, planName: 'Starter', full: false });
    expect(seatState(3, { planName: 'Starter', seats: 3, defined: true })).toMatchObject({ kind: 'limited', full: true });
    expect(seatState(40, { planName: 'Enterprise', seats: null, defined: true })).toEqual({ kind: 'unlimited', used: 40, planName: 'Enterprise' });
    expect(seatState(1, { planName: 'Legacy', seats: null, defined: false })).toEqual({ kind: 'not_defined', used: 1, planName: 'Legacy' });
    expect(seatState(1, null)).toEqual({ kind: 'no_plan', used: 1 });
  });
  it('an invite token is 32 random bytes (43 base64url chars); only its sha256 is kept', () => {
    const a = newInviteToken(); const b = newInviteToken();
    expect(looksLikeInviteToken(a.token)).toBe(true);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(inviteTokenHash(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(looksLikeInviteToken('short')).toBe(false);
    expect(INVITE_DAYS).toBe(7);
    expect(MIG()).toMatch(/interval '7 days'/);
  });
  it('a phone is masked everywhere it is read or audited', () => {
    expect(maskPhone('+919876543412')).toBe('+91 98•••••412');
    expect(maskPhone('+919876543412')).not.toContain('9876543412');
    expect(maskPhone('garbage')).toBe('•••');
    expect(maskPhone(null)).toBe('');
  });
  it('the accept link only for an http(s) console base, else null (the SMS carries the code)', () => {
    expect(inviteLink('https://console.example.org/', 'tok')).toBe('https://console.example.org/invite?t=tok');
    expect(inviteLink('', 'tok')).toBeNull();
    expect(inviteLink('javascript:alert(1)', 'tok')).toBeNull();
  });
  it('TOTP is RFC 6238 (SHA-1, 30 s, 6 digits) — the RFC\'s own vectors', () => {
    const rfc = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';   // base32("12345678901234567890")
    expect(totpCodeAt(rfc, 59_000)).toBe('287082');
    expect(totpCodeAt(rfc, 1_111_111_109_000)).toBe('081804');
    expect(totpCodeAt(rfc, 1_234_567_890_000)).toBe('005924');
  });
  it('a code matches its own step and ±1 step only', () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    const now = 1_760_000_000_000;
    const code = totpCodeAt(s, now);
    expect(matchedStep(code, s, now)).toBe(stepAt(now));
    expect(matchedStep(code, s, now + 30_000)).toBe(stepAt(now));
    expect(matchedStep(code, s, now + 90_000)).toBeNull();
    expect(matchedStep('12345', s, now)).toBeNull();
    expect(matchedStep('abcdef', s, now)).toBeNull();
  });
  it('the otpauth URI names the issuer and a name — never a phone', () => {
    const u = otpauthUri('ABCDEFGHIJKLMNOP', 'Asha: Patel');
    expect(u.startsWith('otpauth://totp/')).toBe(true);
    expect(u).toContain('issuer=Krishalaya');
    expect(u).toContain('secret=ABCDEFGHIJKLMNOP');
  });
  it('recovery codes: ten, distinct, xxxxx-xxxxx, hashed with the pepper, normalised', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) { expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/); expect(looksLikeRecoveryCode(c)).toBe(true); }
    expect(normaliseRecoveryCode('ABCDE-FGHJK')).toBe('abcdefghjk');
    expect(hashRecoveryCode('p', 'ABCDE-FGHJK')).toBe(hashRecoveryCode('p', 'abcde fghjk'));
    expect(hashRecoveryCode('p', 'abcde-fghjk')).not.toBe(hashRecoveryCode('q', 'abcde-fghjk'));
  });
  it('the TOTP secret column is an encrypted envelope (never plaintext)', () => {
    expect(MIG()).toMatch(/secret_enc/);
    expect(MIG()).not.toMatch(/\bsecret\s+(text|varchar)/i);
  });
});

describe('C · overrides, removal, sessions', () => {
  it('the checker codes are the migration\'s, class for class', () => {
    const block = MIG().slice(MIG().indexOf('INSERT INTO override_checker_codes'), MIG().indexOf(';', MIG().indexOf('INSERT INTO override_checker_codes')));
    const rows = Object.fromEntries([...block.matchAll(/\('([a-z_.0-9]+)',\s*'(money|pii)'/g)].map((m) => [m[1], m[2]]));
    expect(rows).toEqual({ ...OVERRIDE_CHECKER_CODES });
    expect(overrideNeedsChecker('payout.prepare')).toBe(true);
    expect(overrideNeedsChecker('listing.publish')).toBe(false);
    expect(overrideNeedsChecker('toString')).toBe(false);
  });
  it('maker-checker pairs: live only with a checker who is not the only maker', () => {
    const rule = MAKER_CHECKER_RULES.find((r) => r.code === 'privileged_overrides')!;
    const one = [{ userId: A, name: 'A', permissions: new Set(['user.approve']), roles: ['tenant_admin'] }];
    expect(makerCheckerPairs(one, [rule])[0].live).toBe(false);
    const two = [...one, { userId: B, name: 'B', permissions: new Set(['user.approve']), roles: ['tenant_admin'] }];
    expect(makerCheckerPairs(two, [rule])[0]).toMatchObject({ code: 'privileged_overrides', live: true });
    const notAdmin = [...one, { userId: B, name: 'B', permissions: new Set(['user.approve']), roles: ['tenant_staff'] }];
    expect(makerCheckerPairs(notAdmin, [rule])[0].checkers.map((c) => c.userId)).toEqual([A]);
    expect(new Set(MAKER_CHECKER_RULES.map((r) => r.code)).size).toBe(MAKER_CHECKER_RULES.length);
  });
  it('removal: a reason, never yourself, never the last admin', () => {
    expect(removeRefusals({ actorUserId: A, targetUserId: B, targetIsAdmin: false, activeAdmins: 1, reason: 'left the cooperative' })).toEqual([]);
    expect(removeRefusals({ actorUserId: A, targetUserId: A, targetIsAdmin: true, activeAdmins: 1, reason: '' })).toEqual(['REASON_REQUIRED', 'REMOVE_SELF', 'LAST_ADMIN']);
    expect(removeRefusals({ actorUserId: A, targetUserId: B, targetIsAdmin: true, activeAdmins: 2, reason: 'moved to the district office' })).toEqual([]);
    expect(reasonRefusal('   too   short ')).toBe('REASON_REQUIRED');
    expect(reasonRefusal('x'.repeat(501))).toBe('REASON_REQUIRED');
  });
  it('the posture verdict: a token issued at or before the cut-off is revoked; staff without 2FA when required are stopped', () => {
    const base = { cutoffMs: null, isStaff: true, required: false, confirmed: false, exempt: false };
    expect(postureVerdict({ ...base, issuedAtSec: 100 })).toBe('pass');
    expect(postureVerdict({ ...base, issuedAtSec: 100, cutoffMs: 100_000 })).toBe('SESSION_REVOKED');
    expect(postureVerdict({ ...base, issuedAtSec: 101, cutoffMs: 100_000 })).toBe('pass');
    expect(postureVerdict({ ...base, issuedAtSec: 101, required: true })).toBe('TWO_FACTOR_REQUIRED');
    expect(postureVerdict({ ...base, issuedAtSec: 101, required: true, exempt: true })).toBe('pass');
    expect(postureVerdict({ ...base, issuedAtSec: 101, required: true, confirmed: true })).toBe('pass');
    expect(postureVerdict({ ...base, issuedAtSec: 101, required: true, isStaff: false })).toBe('pass');
    expect(postureVerdict({ ...base, issuedAtSec: 50, cutoffMs: 100_000, exempt: true })).toBe('SESSION_REVOKED');
    expect(GUARD_CACHE_SECONDS).toBe(SESSION_POSTURE_CACHE_SECONDS);
  });
  it('privileged actions are prefixes of audit actions', () => {
    expect(isPrivilegedAction('role.revoked')).toBe(true);
    expect(isPrivilegedAction('kyc.document.verified')).toBe(true);
    expect(isPrivilegedAction('listing.created')).toBe(false);
  });
});

describe('every refusal by name', () => {
  it('a trigger\'s [CODE] becomes the named 4xx; a unique-index race is named; anything else passes through', () => {
    const e = namedSwcRefusal(new Error('[STAFF_SEATS_EXHAUSTED] 3 of 3')) as SwcRefusedError;
    expect(e).toBeInstanceOf(SwcRefusedError);
    expect(e.code).toBe('STAFF_SEATS_EXHAUSTED');
    expect(e.httpStatus).toBe(409);
    const race = Object.assign(new Error('duplicate key value violates unique constraint "uq_si_one_pending"'), { code: '23505' });
    expect((namedSwcRefusal(race) as SwcRefusedError).code).toBe('INVITE_PENDING_EXISTS');
    const other = new Error('[NOT_OURS] x');
    expect(namedSwcRefusal(other)).toBe(other);
  });
  it('every [CODE] the 0199 triggers raise has a status and a sentence', () => {
    const raised = new Set([...MIG().matchAll(/RAISE EXCEPTION '\[([A-Z_]+)\]/g)].map((m) => m[1]));
    expect(raised.size).toBeGreaterThan(20);
    for (const c of raised) expect(`${c}:${Boolean(SWC_CODES[c])}`).toBe(`${c}:true`);
  });
});
