// modules/gov-console/__tests__/gov-membership.rules.spec.ts · PC-56 GOV-0 — the pure membership machine, the expiry rule, the two-person rule.
import {
  GOV_PERMISSIONS, GOV_ROLE_MATRIX, approvalRefusal, chooseAuthority, clampGovLimit, maskPhoneTail, membershipLive, nextStatus, reasonRefusal,
  removalRefusal, termRefusal, MembershipFacts,
} from '../domain/gov-membership.rules';
import { GOV_CODES, govRefused, namedGovRefusal } from '../domain/gov-console.errors';

const B = 'b0000000-0000-7000-8000-000000000001';
const C = 'c0000000-0000-7000-8000-000000000001';
const D = 'd0000000-0000-7000-8000-000000000001';
const req = (o: Partial<MembershipFacts> = {}): MembershipFacts => ({ status: 'requested', userId: D, requestedBy: B, expiresAt: null, ...o });

describe('PC-56 GOV-0 · the role matrix', () => {
  it('the head holds every authority permission; the officer reads and requests, never approves or removes', () => {
    expect([...GOV_ROLE_MATRIX.authority_head].sort()).toEqual([...GOV_PERMISSIONS].sort());
    expect(GOV_ROLE_MATRIX.authority_officer).toEqual(['authority.applications.read', 'authority.members.read', 'authority.members.request']);
    expect(GOV_ROLE_MATRIX.authority_officer).not.toContain('authority.members.approve');
    expect(GOV_ROLE_MATRIX.authority_officer).not.toContain('authority.members.remove');
  });
});

describe('PC-56 GOV-0 · the two-person rule (Q4-A)', () => {
  it('B requests, B approves → GOV_APPROVER_IS_REQUESTER', () => {
    expect(approvalRefusal(req(), B)).toBe('GOV_APPROVER_IS_REQUESTER');
  });
  it('the grantee approving their own request → GOV_APPROVER_IS_GRANTEE', () => {
    expect(approvalRefusal(req(), D)).toBe('GOV_APPROVER_IS_GRANTEE');
  });
  it('C (neither requester nor grantee) approving a pending request → allowed', () => {
    expect(approvalRefusal(req(), C)).toBeNull();
  });
  it('a request that is not pending, or no row at all, is refused before the person checks', () => {
    expect(approvalRefusal(req({ status: 'active' }), C)).toBe('GOV_REQUEST_NOT_PENDING');
    expect(approvalRefusal(req({ status: 'removed' }), B)).toBe('GOV_REQUEST_NOT_PENDING');
    expect(approvalRefusal(null, C)).toBe('GOV_MEMBERSHIP_NOT_FOUND');
  });
  it('a platform appointment (no requester) still never lets the grantee approve', () => {
    expect(approvalRefusal(req({ requestedBy: null }), D)).toBe('GOV_APPROVER_IS_GRANTEE');
  });
});

describe('PC-56 GOV-0 · the membership machine (Law 5)', () => {
  it('requested → active by approval only; requested/active → removed; removed is final', () => {
    expect(nextStatus('requested', 'approve')).toBe('active');
    expect(nextStatus('active', 'approve')).toBeNull();
    expect(nextStatus('removed', 'approve')).toBeNull();
    expect(nextStatus('requested', 'remove')).toBe('removed');
    expect(nextStatus('active', 'remove')).toBe('removed');
    expect(nextStatus('removed', 'remove')).toBeNull();
  });
  it('removal is one person, never your own row, never a removed row', () => {
    expect(removalRefusal(req({ status: 'active' }), C)).toBeNull();
    expect(removalRefusal(req({ status: 'active' }), D)).toBe('GOV_REMOVE_SELF');
    expect(removalRefusal(req({ status: 'removed' }), C)).toBe('GOV_MEMBERSHIP_NOT_FOUND');
    expect(removalRefusal(null, C)).toBe('GOV_MEMBERSHIP_NOT_FOUND');
  });
});

describe('PC-56 GOV-0 · the expiry rule', () => {
  const now = Date.parse('2026-11-10T06:00:00Z');
  it('an active row resolves permissions only while its end is ahead', () => {
    expect(membershipLive({ status: 'active', expiresAt: '2026-11-10T06:00:01Z' }, now)).toBe(true);
    expect(membershipLive({ status: 'active', expiresAt: '2026-11-10T06:00:00Z' }, now)).toBe(false);
    expect(membershipLive({ status: 'active', expiresAt: '2026-01-01T00:00:00Z' }, now)).toBe(false);
  });
  it('an active row with no end, a pending request and a removed row resolve nothing', () => {
    expect(membershipLive({ status: 'active', expiresAt: null }, now)).toBe(false);
    expect(membershipLive({ status: 'requested', expiresAt: '2027-01-01T00:00:00Z' }, now)).toBe(false);
    expect(membershipLive({ status: 'removed', expiresAt: '2027-01-01T00:00:00Z' }, now)).toBe(false);
  });
  it('the term is 1–12 whole months', () => {
    for (const ok of [1, 6, 12]) expect(termRefusal(ok)).toBeNull();
    for (const bad of [0, 13, 1.5, -1, '6', null, undefined]) expect(termRefusal(bad)).toBe('GOV_TERM_INVALID');
  });
  it('a reason is 10–500 characters', () => {
    expect(reasonRefusal('left the department')).toBeNull();
    expect(reasonRefusal('   short   ')).toBe('GOV_REASON_REQUIRED');
    expect(reasonRefusal('x'.repeat(501))).toBe('GOV_REASON_REQUIRED');
    expect(reasonRefusal(undefined)).toBe('GOV_REASON_REQUIRED');
  });
});

describe('PC-56 GOV-0 · sign-in chooser, masks, limits, named refusals', () => {
  it('none / one / several; a request for an authority the person is not in answers like none', () => {
    expect(chooseAuthority([])).toEqual({ kind: 'none' });
    expect(chooseAuthority([B])).toEqual({ kind: 'one', authorityId: B });
    expect(chooseAuthority([C, B, B])).toEqual({ kind: 'choose', authorityIds: [B, C] });
    expect(chooseAuthority([B], C)).toEqual({ kind: 'none' });
    expect(chooseAuthority([B, C], C)).toEqual({ kind: 'one', authorityId: C });
  });
  it('the phone mask keeps the last 3 digits only', () => {
    expect(maskPhoneTail('+919712345318')).toBe('••••••318');
    expect(maskPhoneTail(null)).toBeNull();
  });
  it('limits clamp to 1..100 with a default of 25', () => {
    expect(clampGovLimit(undefined)).toBe(25); expect(clampGovLimit(500)).toBe(100); expect(clampGovLimit(7)).toBe(7);
  });
  it('every refusal message states a fact (no "please", no exclamation) and a 0239 trigger code is named', () => {
    for (const [code, v] of Object.entries(GOV_CODES)) {
      expect(code).toMatch(/^GOV_[A-Z_]+$/);
      expect(v.message).not.toMatch(/please|sorry|!/i);
    }
    const e = namedGovRefusal(new Error('[GOV_APPROVER_IS_REQUESTER] the approver asked for this — PC-56 GOV-0')) as { code: string; httpStatus: number };
    expect(e.code).toBe('GOV_APPROVER_IS_REQUESTER'); expect(e.httpStatus).toBe(403);
    const race = namedGovRefusal(Object.assign(new Error('duplicate key value violates unique constraint "uq_am_live"'), { code: '23505' })) as { code: string };
    expect(race.code).toBe('GOV_ALREADY_REQUESTED');
    expect(govRefused('GOV_APPLICATION_NOT_FOUND').httpStatus).toBe(404);
  });
});
