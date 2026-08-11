// @krishalaya/sdk-js · the worst-status reading every console shares (PC-56 TENANT-1b).
//
// **THE ONE-LINE FACT THIS FILE DEFENDS: A MEMBER'S KYC IS THE WORST OF THEIR ROLES, AND "WORST" IS AN EXPLICIT ORDER.**
//
// W153 says it twice — "KYC is per role, not per person" and "worst-status view — multi-role members count at their
// lowest role" — and TENANT-1 found the money gate reading it backwards: a verified WORKER could draw a farmer's crop
// settlement. 0125 fixed the gate. This is the reading the CONSOLE uses, and if the two disagree a tenant sees a member
// as compliant while the payout path refuses them, which is the worst kind of disagreement: staff stop trusting the
// screen and start ringing support.
import { kycSeverity, isFullyVerified, rosterKycLabel, REVEALABLE_MEMBER_FIELDS } from '../resources/members';

const role = (roleCode: string, kycStatus: string, isActive = true) => ({ roleCode, kycStatus, isActive });

describe('TENANT-1b · the severity order', () => {
  /**
   * **A STRING SORT WOULD GET THIS WRONG AND THE ERROR WOULD LOOK REASONABLE.** Alphabetically `expired` precedes
   * `pending` precedes `rejected` precedes `verified`, which ranks an EXPIRED verification as worse than a REJECTED one.
   * It is not: a rejection is a decision against the person, an expiry is a clock running out. A roster ordered the
   * other way sends a field officer to re-photograph an Aadhaar for somebody whose application was refused outright.
   */
  it('ranks a rejection below an expiry', () => {
    expect(kycSeverity('rejected')).toBeLessThan(kycSeverity('none'));
    expect(kycSeverity('none')).toBeLessThan(kycSeverity('expired'));
    expect(kycSeverity('expired')).toBeLessThan(kycSeverity('pending'));
    expect(kycSeverity('pending')).toBeLessThan(kycSeverity('verified'));
  });

  it('sorts an unrecognised status as the WORST, below rejected', () => {
    // Fifth wave running: a state this code cannot describe is a state whose safety it cannot assert — and on a column
    // that decides who staff chase, guessing "fine" is the wrong guess.
    expect(kycSeverity('under_review')).toBeLessThan(kycSeverity('rejected'));
    expect(kycSeverity('')).toBe(-1);
  });
});

describe('TENANT-1b · fully verified means EVERY active role', () => {
  it('counts a member only when all their active roles are verified', () => {
    expect(isFullyVerified([role('farmer', 'verified')])).toBe(true);
    expect(isFullyVerified([role('farmer', 'verified'), role('dairy_farmer', 'verified')])).toBe(true);
    // **THE CANON'S OWN EXPLOIT ROW.** Kanji Bhai R.: worker verified, farmer pending. Counting him as verified is
    // exactly the reading that let a worker verification open a farmer settlement.
    expect(isFullyVerified([role('worker', 'verified'), role('farmer', 'pending')])).toBe(false);
  });

  it('does not count a member with no active roles', () => {
    // There is no default capacity to be verified in. An empty roster row is not a compliant one.
    expect(isFullyVerified([])).toBe(false);
    expect(isFullyVerified([role('farmer', 'verified', false)])).toBe(false);
  });

  it('ignores INACTIVE roles when judging the active ones', () => {
    // A lapsed, never-verified role must not hold a current member back — and a lapsed VERIFIED role must not carry
    // them either, which is the direction that would matter to money.
    expect(isFullyVerified([role('farmer', 'verified'), role('worker', 'rejected', false)])).toBe(true);
    expect(isFullyVerified([role('farmer', 'pending'), role('worker', 'verified', false)])).toBe(false);
  });
});

describe('TENANT-1b · the roster cell', () => {
  it('renders W153’s two verified shapes', () => {
    // "verified" for Meera Ben J. (one role); "verified ×2" for Ramesh P. (farmer + dairy_farmer).
    expect(rosterKycLabel([role('farmer', 'verified')])).toEqual({ key: 'verifiedOne', count: 1, status: 'verified', roleCode: null });
    expect(rosterKycLabel([role('farmer', 'verified'), role('dairy_farmer', 'verified')]))
      .toEqual({ key: 'verifiedMany', count: 2, status: 'verified', roleCode: null });
  });

  /** **A MIXED MEMBER IS LABELLED BY THE ROLE THAT IS BEHIND**, because that is the one somebody has to act on. */
  it('names the role the refusal will turn on', () => {
    const label = rosterKycLabel([role('worker', 'verified'), role('farmer', 'pending')]);
    expect(label.key).toBe('mixed');
    expect(label.roleCode).toBe('farmer');
    expect(label.status).toBe('pending');
    expect(label.count).toBe(2);
  });

  it('picks the worst when several roles are behind', () => {
    // Savita Ben M. is `dairy_farmer: expired`; add a rejected role and the rejection is the one to show.
    const label = rosterKycLabel([role('dairy_farmer', 'expired'), role('worker', 'rejected'), role('farmer', 'verified')]);
    expect(label.roleCode).toBe('worker');
    expect(label.status).toBe('rejected');
  });

  it('says "no active role" rather than inventing a status', () => {
    expect(rosterKycLabel([]).key).toBe('noRoles');
    expect(rosterKycLabel([role('farmer', 'verified', false)]).key).toBe('noRoles');
  });

  it('lets an unknown status win, because it cannot be shown to be safe', () => {
    const label = rosterKycLabel([role('farmer', 'verified'), role('vyapari', 'under_review')]);
    expect(label.key).toBe('mixed');
    expect(label.roleCode).toBe('vyapari');
  });
});

describe('TENANT-1b · the revealable-field list is closed', () => {
  it('holds exactly the three fields and no vault reference', () => {
    // The console renders its field picker FROM this constant, so a leak here is a leak on the screen. The Aadhaar and
    // PAN vault references are not on it and the API's query does not even name them.
    expect([...REVEALABLE_MEMBER_FIELDS]).toEqual(['phone', 'email', 'aadhaar_last4']);
    expect(REVEALABLE_MEMBER_FIELDS as readonly string[]).not.toContain('aadhaar_vault_ref');
    expect(REVEALABLE_MEMBER_FIELDS as readonly string[]).not.toContain('pan_vault_ref');
  });
});
