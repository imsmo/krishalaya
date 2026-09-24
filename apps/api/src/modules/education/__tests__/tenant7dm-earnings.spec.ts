// modules/education/__tests__/tenant7dm-earnings.spec.ts · PC-56 TENANT-7d-money · the pure logic of THE EARNINGS.
// Pins: the split (floors, the remainder to the tenant, never more than 2 minor units, nets to zero at any scale
// including a zero-decimal currency), the resolution (flag OFF / agreement / rule / no rule), the window, the payout
// refusals, the two state machines, the rule's proposal shape, the export rows and notes.
import {
  BPS_WHOLE, agreementNext, assertWholeShares, availableMinor, legacyShares, monthStartOf, proposalShares, resolveSplitShares, royaltyPayoutRefusals, ruleDecisionRefusals, ruleNext, splitRoyalty,
} from '../domain/royalty-split';
import { EARNINGS_EXPORT_HEADER, earningsExportNotes, earningsExportRow, minorText } from '../domain/instructor-earnings-export';
import { InvalidRoyaltyError } from '../domain/education.errors';

const DEFAULT = { instructorBps: 8000, tenantBps: 1800, platformBps: 200 };

describe('splitRoyalty — where the paisa goes', () => {
  it('₹149.00 at 80/18/2: instructor floored 11920, platform floored 298, the tenant takes the remainder 2682 — nets to zero', () => {
    const s = splitRoyalty(14900n, DEFAULT);
    expect(s).toEqual({ grossMinor: 14900n, instructorMinor: 11920n, tenantMinor: 2682n, platformMinor: 298n });
    expect(s.instructorMinor + s.tenantMinor + s.platformMinor).toBe(14900n);
  });
  it('an exact gross splits exactly (₹1.00 → 80 · 18 · 2)', () => {
    expect(splitRoyalty(100n, DEFAULT)).toEqual({ grossMinor: 100n, instructorMinor: 80n, tenantMinor: 18n, platformMinor: 2n });
  });
  it('the remainder assigned to the tenant is NEVER more than two minor units (two floors), over a sweep of odd grosses and shares', () => {
    for (const gross of [1n, 3n, 7n, 99n, 101n, 14900n, 999_999_999n, 12_345_678_901n]) {
      for (const shares of [DEFAULT, { instructorBps: 3333, tenantBps: 3333, platformBps: 3334 }, { instructorBps: 9999, tenantBps: 0, platformBps: 1 }, { instructorBps: 0, tenantBps: 10000, platformBps: 0 }]) {
        const s = splitRoyalty(gross, shares);
        expect(s.instructorMinor + s.tenantMinor + s.platformMinor).toBe(gross);
        const exactTenant = (gross * BigInt(shares.tenantBps)) / BigInt(BPS_WHOLE);
        expect(s.tenantMinor - exactTenant).toBeGreaterThanOrEqual(0n);
        expect(s.tenantMinor - exactTenant).toBeLessThanOrEqual(2n);
        expect(s.instructorMinor).toBe((gross * BigInt(shares.instructorBps)) / BigInt(BPS_WHOLE));   // floored, never rounded up
      }
    }
  });
  it('a zero-decimal currency is just integers: ¥5,160 at 80/18/2 → 4128 · 929 · 103 (the 0.2 yen of rounding lands on the tenant)', () => {
    const s = splitRoyalty(5160n, DEFAULT);
    expect(s).toEqual({ grossMinor: 5160n, instructorMinor: 4128n, tenantMinor: 929n, platformMinor: 103n });
  });
  it('a share of 100% to the instructor leaves the others zero; 0% to the instructor leaves them the gross', () => {
    expect(splitRoyalty(777n, { instructorBps: 10000, tenantBps: 0, platformBps: 0 })).toMatchObject({ instructorMinor: 777n, tenantMinor: 0n, platformMinor: 0n });
    expect(splitRoyalty(777n, { instructorBps: 0, tenantBps: 9000, platformBps: 1000 })).toMatchObject({ instructorMinor: 0n, tenantMinor: 700n, platformMinor: 77n });
  });
  it('refuses a non-positive gross, shares that do not sum to 10000, a negative share, a non-integer share, a share above 10000', () => {
    expect(() => splitRoyalty(0n, DEFAULT)).toThrow(InvalidRoyaltyError);
    expect(() => splitRoyalty(-1n, DEFAULT)).toThrow(InvalidRoyaltyError);
    expect(() => splitRoyalty(100n, { instructorBps: 8000, tenantBps: 1800, platformBps: 201 })).toThrow(InvalidRoyaltyError);
    expect(() => splitRoyalty(100n, { instructorBps: 8000, tenantBps: 1800, platformBps: 199 })).toThrow(InvalidRoyaltyError);
    expect(() => assertWholeShares({ instructorBps: -1, tenantBps: 10001, platformBps: 0 })).toThrow(InvalidRoyaltyError);
    expect(() => assertWholeShares({ instructorBps: 80.5, tenantBps: 1919.5, platformBps: 8000 })).toThrow(InvalidRoyaltyError);
    expect(() => assertWholeShares({ instructorBps: 10001, tenantBps: -1, platformBps: 0 })).toThrow(InvalidRoyaltyError);
  });
  it('a share object carrying extra keys (ruleId) is judged on its three shares only', () => {
    expect(() => assertWholeShares({ ...DEFAULT, ruleId: 'r1' } as any)).not.toThrow();
  });
});

describe('legacyShares · resolveSplitShares — which shares, which leg', () => {
  it('legacy: the row royalty to the instructor, the rest to the platform, nothing to the tenant', () => {
    expect(legacyShares(8000)).toEqual({ instructorBps: 8000, tenantBps: 0, platformBps: 2000 });
    expect(legacyShares(0)).toEqual({ instructorBps: 0, tenantBps: 0, platformBps: 10000 });
    expect(() => legacyShares(10001)).toThrow(InvalidRoyaltyError);
    expect(() => legacyShares(-5)).toThrow(InvalidRoyaltyError);
  });
  const rule = { ruleId: 'r1', ...DEFAULT };
  const agreement = { agreementId: 'a1', instructorBps: 8500, tenantBps: 1300, platformBps: 200 };
  it('flag OFF → legacy shape to MAIN, no rule and no agreement even if both exist', () => {
    expect(resolveSplitShares({ flagOn: false, royaltyBps: 7000, rule, agreement })).toEqual({ shares: { instructorBps: 7000, tenantBps: 0, platformBps: 3000 }, ruleId: null, agreementId: null, leg: 'main', state: 'paid_to_wallet' });
  });
  it('flag ON + accepted agreement → the agreement snapshot to MAIN (the rule is ignored)', () => {
    expect(resolveSplitShares({ flagOn: true, royaltyBps: 8000, rule, agreement })).toEqual({ shares: { instructorBps: 8500, tenantBps: 1300, platformBps: 200 }, ruleId: null, agreementId: 'a1', leg: 'main', state: 'paid_to_wallet' });
  });
  it('flag ON, no agreement → the rule in force, the instructor leg HELD', () => {
    expect(resolveSplitShares({ flagOn: true, royaltyBps: 8000, rule, agreement: null })).toEqual({ shares: DEFAULT, ruleId: 'r1', agreementId: null, leg: 'hold', state: 'held_pending_agreement' });
  });
  it('flag ON, no agreement, no rule → refused (never a guess); a malformed agreement or rule is refused too', () => {
    expect(() => resolveSplitShares({ flagOn: true, royaltyBps: 8000, rule: null, agreement: null })).toThrow(InvalidRoyaltyError);
    expect(() => resolveSplitShares({ flagOn: true, royaltyBps: 8000, rule, agreement: { agreementId: 'a', instructorBps: 5000, tenantBps: 5000, platformBps: 1 } })).toThrow(InvalidRoyaltyError);
    expect(() => resolveSplitShares({ flagOn: true, royaltyBps: 8000, rule: { ruleId: 'r', instructorBps: 1, tenantBps: 1, platformBps: 1 }, agreement: null })).toThrow(InvalidRoyaltyError);
  });
});

describe('monthStartOf — the cooperative\'s month', () => {
  it('the first of the month of the LOCAL day it is given', () => {
    expect(monthStartOf('2026-09-24')).toBe('2026-09-01');
    expect(monthStartOf('2026-01-01')).toBe('2026-01-01');
    expect(monthStartOf('2026-12-31')).toBe('2026-12-01');
  });
  it('refuses anything that is not a local day', () => {
    for (const bad of ['2026-9-24', '2026/09/24', '24-09-2026', '', 'today']) expect(() => monthStartOf(bad)).toThrow(InvalidRoyaltyError);
  });
});

describe('availableMinor · royaltyPayoutRefusals — what may be asked for', () => {
  const bal = { currencyCode: 'INR', releasedMinor: 100_000n, heldMinor: 5_000n, paidOutMinor: 30_000n };
  it('available = released − paid out; held is NOT available; a negative is reported, not clamped', () => {
    expect(availableMinor(bal)).toBe(70_000n);
    expect(availableMinor({ ...bal, paidOutMinor: 120_000n })).toBe(-20_000n);
  });
  it('a ready request has no refusals; each gate is named', () => {
    expect(royaltyPayoutRefusals({ hasInstructor: true, hasAcceptedAgreement: true, amountMinor: '70000', balance: bal })).toEqual([]);
    expect(royaltyPayoutRefusals({ hasInstructor: true, hasAcceptedAgreement: true, amountMinor: '70001', balance: bal })).toEqual(['ROYALTY_INSUFFICIENT']);
    expect(royaltyPayoutRefusals({ hasInstructor: true, hasAcceptedAgreement: false, amountMinor: '1', balance: bal })).toEqual(['AGREEMENT_NOT_ACCEPTED']);
    expect(royaltyPayoutRefusals({ hasInstructor: false, hasAcceptedAgreement: false, amountMinor: '0', balance: null })).toEqual(['NOT_INSTRUCTOR', 'AGREEMENT_NOT_ACCEPTED', 'AMOUNT_INVALID', 'CURRENCY_UNKNOWN']);
    for (const bad of ['0', '-1', '1.5', '01', 'abc', '']) expect(royaltyPayoutRefusals({ hasInstructor: true, hasAcceptedAgreement: true, amountMinor: bad, balance: bal })).toContain('AMOUNT_INVALID');
  });
  it('held money cannot be requested even when the agreement is accepted', () => {
    expect(royaltyPayoutRefusals({ hasInstructor: true, hasAcceptedAgreement: true, amountMinor: '75000', balance: bal })).toEqual(['ROYALTY_INSUFFICIENT']);
  });
});

describe('the agreement and the rule — two machines in one place', () => {
  it('agreement: offered → accepted | declined | superseded; accepted → superseded; declined and superseded are final', () => {
    expect(agreementNext('offered', 'accept')).toBe('accepted');
    expect(agreementNext('offered', 'decline')).toBe('declined');
    expect(agreementNext('offered', 'supersede')).toBe('superseded');
    expect(agreementNext('accepted', 'supersede')).toBe('superseded');
    expect(agreementNext('accepted', 'accept')).toBeNull();
    expect(agreementNext('accepted', 'decline')).toBeNull();
    expect(agreementNext('declined', 'accept')).toBeNull();
    expect(agreementNext('superseded', 'accept')).toBeNull();
  });
  it('rule: proposed → active | rejected; active → superseded; nothing leaves rejected or superseded', () => {
    expect(ruleNext('proposed', 'approve')).toBe('active');
    expect(ruleNext('proposed', 'reject')).toBe('rejected');
    expect(ruleNext('proposed', 'supersede')).toBeNull();
    expect(ruleNext('active', 'supersede')).toBe('superseded');
    expect(ruleNext('active', 'approve')).toBeNull();
    expect(ruleNext('rejected', 'approve')).toBeNull();
    expect(ruleNext('superseded', 'approve')).toBeNull();
  });
  it('the decision: a finance person who is not the proposer; a rejection needs a note of 3+ characters', () => {
    const base = { isDesk: true, proposedBy: 'maker', deciderUserId: 'checker', status: 'proposed' as const, act: 'approve' as const, note: null };
    expect(ruleDecisionRefusals(base)).toEqual([]);
    expect(ruleDecisionRefusals({ ...base, deciderUserId: 'maker' })).toEqual(['MAKER_IS_CHECKER']);
    expect(ruleDecisionRefusals({ ...base, isDesk: false })).toEqual(['NOT_DESK']);
    expect(ruleDecisionRefusals({ ...base, status: 'active' })).toEqual(['ILLEGAL_FROM_STATUS']);
    expect(ruleDecisionRefusals({ ...base, act: 'reject' })).toEqual(['REASON_REQUIRED']);
    expect(ruleDecisionRefusals({ ...base, act: 'reject', note: '  ab ' })).toEqual(['REASON_REQUIRED']);
    expect(ruleDecisionRefusals({ ...base, act: 'reject', note: 'too generous' })).toEqual([]);
  });
  it('a proposal chooses ONLY the instructor share: the platform\'s is copied, the tenant\'s is the remainder; below zero is refused', () => {
    expect(proposalShares({ instructorBps: 7500, platformBps: 200 })).toEqual({ instructorBps: 7500, tenantBps: 2300, platformBps: 200 });
    expect(proposalShares({ instructorBps: 9800, platformBps: 200 })).toEqual({ instructorBps: 9800, tenantBps: 0, platformBps: 200 });
    expect(() => proposalShares({ instructorBps: 9801, platformBps: 200 })).toThrow(InvalidRoyaltyError);
    expect(() => proposalShares({ instructorBps: -1, platformBps: 200 })).toThrow(InvalidRoyaltyError);
    expect(() => proposalShares({ instructorBps: 80.5, platformBps: 200 })).toThrow(InvalidRoyaltyError);
  });
});

describe('the export — one row per line, money at the line\'s own scale, no totals', () => {
  const line = { id: 'l1', occurredAt: new Date('2026-09-10T04:30:00Z'), courseId: 'c1', courseTitle: 'Silage', enrollmentId: 'e1', currencyCode: 'INR', minorUnits: 2, gross: '14900', instructor: '11920', tenant: '2682', platform: '298', instructorShareBps: 8000, state: 'paid_to_wallet', ledgerTxnId: 'tx1', releasedAt: null };
  it('minorText renders at the given scale, never a guessed two', () => {
    expect(minorText('14900', 2)).toBe('149.00');
    expect(minorText('5160', 0)).toBe('5160');
    expect(minorText('5', 2)).toBe('0.05');
    expect(minorText('1234', 3)).toBe('1.234');
    expect(() => minorText('-1', 2)).toThrow();
    expect(() => minorText('1', 7)).toThrow();
  });
  it('the row', () => {
    expect(EARNINGS_EXPORT_HEADER).toHaveLength(13);
    expect(earningsExportRow(line)).toEqual(['2026-09-10T04:30:00.000Z', 'Silage', 'c1', 'e1', 'INR', '149.00', '119.20', '26.82', '2.98', '8000', 'paid_to_wallet', 'tx1', '']);
    expect(earningsExportRow({ ...line, courseTitle: null, currencyCode: 'JPY', minorUnits: 0, gross: '5160', instructor: '4128', tenant: '929', platform: '103', state: 'released', releasedAt: new Date('2026-09-11T00:00:00Z') })).toEqual(['2026-09-10T04:30:00.000Z', '', 'c1', 'e1', 'JPY', '5160', '4128', '929', '103', '8000', 'released', 'tx1', '2026-09-11T00:00:00.000Z']);
  });
  it('the notes admit what the file cannot say, and name the held lines when there are any', () => {
    const n = earningsExportNotes({ timezone: 'Asia/Kolkata', currencies: ['INR'], heldLines: 0 });
    expect(n.some((x) => /no totals/.test(x))).toBe(true);
    expect(n.some((x) => /Asia\/Kolkata/.test(x))).toBe(true);
    expect(n.some((x) => /refunds are not rows/.test(x))).toBe(true);
    expect(n.some((x) => /held_pending_agreement/.test(x))).toBe(false);
    expect(earningsExportNotes({ timezone: 'Asia/Dubai', currencies: ['AED'], heldLines: 3 }).some((x) => /^3 line\(s\) are held_pending_agreement/.test(x))).toBe(true);
    expect(earningsExportNotes({ timezone: 'Asia/Dubai', currencies: ['AED'], heldLines: 1 }).some((x) => /^1 line\(s\) are held_pending_agreement/.test(x))).toBe(true);   // ONE held line is named too (a first-run survivor)
    expect(earningsExportNotes({ timezone: 'Asia/Kolkata', currencies: [], heldLines: 0 }).some((x) => /no paid enrollment yet/.test(x))).toBe(true);
  });
});
