// modules/payments/__tests__/tenant1-payout-kyc-domain.spec.ts · PC-56 TENANT-1.
//
// The pure rules behind the money gate and behind W153's roster column. Two things worth stating before the tests:
//
//   • **"KYC is per role, not per person" is W153's sentence, and the money path read it as "any role".** A member
//     verified as a worker could draw a farmer settlement.
//   • **The worst-status order is explicit rather than alphabetical.** A string sort puts 'expired' before 'pending'
//     before 'rejected', which would rank an expiry as worse than a rejection. It is not: a rejection is a decision
//     against the person, an expiry is a clock running out, and a roster that got this backwards would send staff to
//     the wrong member first.
import {
  isFullyVerified, kycVerdictFor, rosterKycLabel, severityOf, worstKycStatus, type RoleKyc,
} from '../domain/payout-kyc';

const role = (roleCode: string, kycStatus: string, isActive = true): RoleKyc => ({ roleCode, kycStatus, isActive });
const SELLER = ['farmer', 'dairy_farmer', 'pashupalak', 'vyapari', 'organic_store'];

describe('TENANT-1 · the gate accepts the RIGHT role, not any role', () => {
  it('passes a verified holder of an eligible role', () => {
    const v = kycVerdictFor(SELLER, [role('farmer', 'verified')]);
    expect(v.allowed).toBe(true);
    expect(v.reason).toBe('eligible_role_verified');
    expect(v.decidingRole).toBe('farmer');
  });

  // The canon's own row: worker verified, farmer pending, drawing a settlement.
  it('refuses a worker verification on settlement money, and names the farmer role', () => {
    const v = kycVerdictFor(SELLER, [role('worker', 'verified'), role('farmer', 'pending')]);
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('eligible_role_unverified');
    expect(v.decidingRole).toBe('farmer');
    expect(v.decidingStatus).toBe('pending');
  });

  it('separates "holds no eligible role" from "holds it unverified"', () => {
    // Two different problems: one is a capacity question, the other is a paperwork question, and the member has to be
    // told which. Collapsing them is why "KYC required" was useless.
    expect(kycVerdictFor(SELLER, [role('ambassador', 'verified')]).reason).toBe('no_eligible_role_held');
    expect(kycVerdictFor(SELLER, [role('farmer', 'none')]).reason).toBe('eligible_role_unverified');
  });

  it('ignores inactive roles entirely', () => {
    // A revoked farmer role that was once verified is not a capacity to receive money in.
    expect(kycVerdictFor(SELLER, [role('farmer', 'verified', false)]).allowed).toBe(false);
    expect(kycVerdictFor(SELLER, [role('farmer', 'verified', false), role('farmer2', 'x')]).reason).toBe('no_eligible_role_held');
  });

  it('refuses a member with no active roles at all', () => {
    expect(kycVerdictFor(SELLER, []).reason).toBe('no_active_roles');
    expect(kycVerdictFor(SELLER, [role('farmer', 'verified', false)]).allowed).toBe(false);
  });

  it('names the WORST eligible role when several are unverified', () => {
    // A rejected farmer beside a pending dairy role: the rejection is what staff need to see first.
    const v = kycVerdictFor(SELLER, [role('farmer', 'rejected'), role('dairy_farmer', 'pending')]);
    expect(v.decidingRole).toBe('farmer');
    expect(v.decidingStatus).toBe('rejected');
  });
});

describe('TENANT-1 · an unmapped purpose fails STRICT', () => {
  it('requires every active role verified', () => {
    expect(kycVerdictFor([], [role('farmer', 'verified'), role('worker', 'pending')]).allowed).toBe(false);
    expect(kycVerdictFor([], [role('farmer', 'verified'), role('worker', 'pending')]).reason)
      .toBe('unmapped_purpose_some_role_unverified');
    expect(kycVerdictFor([], [role('farmer', 'verified'), role('worker', 'verified')]).allowed).toBe(true);
  });

  it('does NOT fall back to "any role verified"', () => {
    // This is the exact inversion the wave exists to remove. One verified role must not carry an unmapped purpose.
    expect(kycVerdictFor([], [role('worker', 'verified'), role('farmer', 'none')]).allowed).toBe(false);
  });
});

describe('TENANT-1 · the worst-status order W153 depends on', () => {
  it('ranks a rejection as worse than an expiry, and both as worse than pending', () => {
    expect(severityOf('rejected')).toBeLessThan(severityOf('none'));
    expect(severityOf('none')).toBeLessThan(severityOf('expired'));
    expect(severityOf('expired')).toBeLessThan(severityOf('pending'));
    expect(severityOf('pending')).toBeLessThan(severityOf('verified'));
  });

  it('sorts an unrecognised status as the very worst', () => {
    // Fifth wave running: a state this code cannot describe is a state whose safety it cannot assert — and on a roster
    // that decides who staff chase, guessing "fine" is the wrong guess.
    expect(severityOf('quarantined')).toBeLessThan(severityOf('rejected'));
    expect(severityOf('')).toBeLessThan(severityOf('rejected'));
  });

  it('takes the worst status across a member’s active roles', () => {
    expect(worstKycStatus([role('worker', 'verified'), role('farmer', 'pending')]))
      .toEqual({ status: 'pending', roleCode: 'farmer' });
    expect(worstKycStatus([role('farmer', 'verified'), role('dairy_farmer', 'verified')]))
      .toEqual({ status: 'verified', roleCode: 'farmer' });
    // Inactive roles do not drag the roster down: a revoked role is not an outstanding task.
    expect(worstKycStatus([role('farmer', 'verified'), role('worker', 'rejected', false)]).status).toBe('verified');
    expect(worstKycStatus([])).toEqual({ status: 'none', roleCode: null });
  });

  // W153's headline: "Fully verified members · 1,146 · 89% (worst-status view)". A member counts only when EVERY active
  // role is verified — which is the number that was impossible to compute while the gate thought one role was enough.
  it('counts a member as fully verified only when every active role is', () => {
    expect(isFullyVerified([role('farmer', 'verified'), role('dairy_farmer', 'verified')])).toBe(true);
    expect(isFullyVerified([role('worker', 'verified'), role('farmer', 'pending')])).toBe(false);
    expect(isFullyVerified([])).toBe(false);
    expect(isFullyVerified([role('farmer', 'verified'), role('worker', 'pending', false)])).toBe(true);
  });
});

describe('TENANT-1 · the roster cell', () => {
  it('renders "verified ×2" for a fully verified multi-role member', () => {
    // W153's Ramesh P. row: farmer + dairy_farmer, "verified ×2".
    expect(rosterKycLabel([role('farmer', 'verified'), role('dairy_farmer', 'verified')]))
      .toMatchObject({ key: 'verifiedMany', count: 2, status: 'verified' });
    expect(rosterKycLabel([role('farmer', 'verified')])).toMatchObject({ key: 'verifiedOne', count: 1 });
  });

  it('labels a mixed member by the role that is BEHIND', () => {
    // W153's Kanji Bhai row shows both statuses; the label leads with the one somebody has to act on.
    expect(rosterKycLabel([role('worker', 'verified'), role('farmer', 'pending')]))
      .toMatchObject({ key: 'mixed', status: 'pending', roleCode: 'farmer' });
  });

  it('says when a person holds no active role rather than showing a blank', () => {
    expect(rosterKycLabel([])).toMatchObject({ key: 'noRoles', count: 0 });
    expect(rosterKycLabel([role('farmer', 'verified', false)])).toMatchObject({ key: 'noRoles' });
  });
});
