// modules/insurance/__tests__/insurance-policy.state.spec.ts · the state machine is correctness-critical (Law 5).
import { canTransition, assertTransition, allowedNext, isTerminal, isOnCover, IllegalPolicyTransitionError, POLICY_STATUSES } from '../domain/insurance-policy.state';

describe('insurance-policy state machine', () => {
  it('allows proposed→active (premium paid, screen 283) and proposed→cancelled (withdraw)', () => {
    expect(canTransition('proposed', 'active')).toBe(true);
    expect(canTransition('proposed', 'cancelled')).toBe(true);
    expect(canTransition('proposed', 'expired')).toBe(true);
  });
  it('forbids proposed→claimed (must go through active first)', () => {
    expect(canTransition('proposed', 'claimed')).toBe(false);
  });
  it('active can lapse, expire, be cancelled, or be claimed', () => {
    expect(canTransition('active', 'lapsed')).toBe(true);
    expect(canTransition('active', 'expired')).toBe(true);
    expect(canTransition('active', 'cancelled')).toBe(true);
    expect(canTransition('active', 'claimed')).toBe(true);
    expect(canTransition('active', 'proposed')).toBe(false);
  });
  it('lapsed can only be cancelled — no invented reinstatement (renewal is a NEW policy)', () => {
    expect(canTransition('lapsed', 'cancelled')).toBe(true);
    expect(canTransition('lapsed', 'active')).toBe(false);
  });
  it('cancelled/expired/claimed are terminal', () => {
    expect(allowedNext('cancelled')).toHaveLength(0);
    expect(allowedNext('expired')).toHaveLength(0);
    expect(allowedNext('claimed')).toHaveLength(0);
    expect(isTerminal('cancelled')).toBe(true); expect(isTerminal('expired')).toBe(true); expect(isTerminal('claimed')).toBe(true);
    expect(isTerminal('proposed')).toBe(false); expect(isTerminal('active')).toBe(false);
  });
  it('assertTransition throws a typed, coded error on an illegal move', () => {
    expect(() => assertTransition('proposed', 'claimed')).toThrow(IllegalPolicyTransitionError);
    try { assertTransition('cancelled', 'active'); fail('should have thrown'); }
    catch (e: any) { expect(e.code).toBe('INSURANCE_POLICY_ILLEGAL_TRANSITION'); expect(e.httpStatus).toBe(409); }
  });
  it('only active is on-cover (screen 286 renders coverage only for a live policy)', () => {
    expect(isOnCover('active')).toBe(true);
    for (const s of POLICY_STATUSES) if (s !== 'active') expect(isOnCover(s)).toBe(false);
  });
  it('every status is a member of the DDL enum verbatim (policy_status, 0011_fintech_schemes.sql)', () => {
    expect(POLICY_STATUSES).toEqual(['proposed', 'active', 'lapsed', 'cancelled', 'expired', 'claimed']);
  });
});
