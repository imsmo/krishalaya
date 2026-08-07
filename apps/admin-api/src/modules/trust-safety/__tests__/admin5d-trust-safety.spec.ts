// PC-56 ADMIN-5d · the risk & blocklist plane. Pure domain only.
// The central claims: a weight change cannot ship without a dry run somebody saw, a block cannot be indefinite
// without a review date, and no screen may report a number the platform does not actually produce.
import {
  IDENTIFIER_TYPES, isIdentifierType, normaliseIdentifier, assertRawIdentifier, hashIdentifier,
  displayIdentifier, assertExpiryOrReview, assertReason, blockState, reviewDue, attemptsBlocked,
  assertLiftable, typeCounts, ATTEMPTS_UNCOUNTED, REASON_MIN, type BlocklistRow,
} from '../domain/blocklist';
import {
  assertProposedWeight, assertDryRun, isDryRunFresh, approvalState, assertApprovable, weightDrift,
  ruleCoverage, bandLadderDrift, OBSERVED_PRODUCERS, WEIGHT_MIN, WEIGHT_MAX, DRY_RUN_MAX_AGE_HOURS,
  type RiskRuleRow,
} from '../domain/risk-rules';
import {
  RISK_BANDS, isRiskBand, canonBand, codeBand, readBand, factorPanel, BAND_EFFECTS, anyEffectEnforced,
  assertBandChange, bandCensus, bandShare, maskSubject,
} from '../domain/risk-profile';
import {
  tile, rate, medianHours, reasonBreakdown, slaState, orderAttention, allQuiet, unreadSources,
  LOW_SAMPLE_BELOW, REPORT_SLA_HOURS, type AttentionItem, type SourcesRead,
} from '../domain/trust-overview';
import { InvalidBlocklistEntryError, InvalidRiskRuleChangeError, DryRunRequiredError, InvalidBandChangeError } from '../domain/trust-safety.errors';
import { SecondPersonRequiredError } from '../../../core/approval/two-person-rule';

const HOUR = 3_600_000;
const NOW = new Date('2026-08-07T10:00:00.000Z');
const future = (h: number) => new Date(NOW.getTime() + h * HOUR);
const past = (h: number) => new Date(NOW.getTime() - h * HOUR);

const block = (over: Partial<BlocklistRow> = {}): BlocklistRow => ({
  id: 'b1', identifierType: 'device', identifierHash: 'a'.repeat(64), originRef: 'RSK-CL-0711-01',
  reason: 'fake listing ring device', expiresAt: future(24 * 90).toISOString(), reviewAt: null,
  attemptsBlocked: 0, status: 'active', auditNote: 'confirmed cluster', createdBy: 'op-a',
  createdAt: past(24).toISOString(), checkedBy: null, checkedAt: null,
  liftedAt: null, liftedBy: null, liftReason: null, ...over,
});

const rule = (over: Partial<RiskRuleRow> = {}): RiskRuleRow => ({
  eventCode: 'dispute_lost', weight: -12, notes: null, isActive: true,
  proposedWeight: -15, proposedBy: 'op-a', proposedAt: past(2).toISOString(),
  checkedBy: null, checkedAt: null,
  dryRunAt: past(2).toISOString(), dryRunBandDrops: 312, dryRunNewRestricted: 41, dryRunPopulation: 78_204, ...over,
});

/* ================================================================================================ */
describe('ADMIN-5d · the blocklist identifier — where a block silently matches nothing', () => {
  it('REFUSES an already-hashed identifier, which is the mistake the screen invites', () => {
    // The list shows `dev_a41f…88`. Pasting a displayed value back into Add produces a hash of a hash: a row that
    // looks like a block, matches no real device, and is indistinguishable from a good one ever after.
    expect(() => assertRawIdentifier('device', 'f'.repeat(64))).toThrow(InvalidBlocklistEntryError);
    expect(() => assertRawIdentifier('device', 'abc123def456')).not.toThrow();
  });
  it('NORMALISES before hashing, so one identifier is one block', () => {
    // uq_platform_blocklists_active compares hashes. Without normalisation the same range typed two ways is two
    // rows with two expiry dates, and lifting one leaves the other enforcing.
    expect(hashIdentifier('ip_range', ' 103.24.0.0/29 ')).toBe(hashIdentifier('ip_range', '103.24.0.0/29'));
    expect(hashIdentifier('ip_range', '103.24.0.0/29\n')).toBe(hashIdentifier('ip_range', '103.24.0.0/29'));
    expect(hashIdentifier('phone_hash', '+91 98123 45210')).toBe(hashIdentifier('phone_hash', '+919812345210'));
    expect(hashIdentifier('phone_hash', '+91-98123-45210')).toBe(hashIdentifier('phone_hash', '+919812345210'));
  });
  it('a DIFFERENT identifier is a different hash, and the TYPE is part of it', () => {
    expect(hashIdentifier('device', 'abc123')).not.toBe(hashIdentifier('device', 'abc124'));
    // The same string as a device id and as a phone must not collide into one block.
    expect(hashIdentifier('device', '919812345210')).not.toBe(hashIdentifier('phone_hash', '919812345210'));
  });
  it('refuses an empty, absurd or malformed identifier per type', () => {
    expect(() => assertRawIdentifier('device', '   ')).toThrow(InvalidBlocklistEntryError);
    expect(() => assertRawIdentifier('device', 42 as unknown)).toThrow(InvalidBlocklistEntryError);
    expect(() => assertRawIdentifier('device', 'x'.repeat(201))).toThrow(InvalidBlocklistEntryError);
    expect(() => assertRawIdentifier('phone_hash', 'not-a-phone')).toThrow(InvalidBlocklistEntryError);
    expect(() => assertRawIdentifier('phone_hash', '12345')).toThrow(InvalidBlocklistEntryError);      // too short
    expect(() => assertRawIdentifier('ip_range', 'hello world')).toThrow(InvalidBlocklistEntryError);
    expect(() => assertRawIdentifier('ip_range', '103.24.0.0/29')).not.toThrow();
  });
  it('DISPLAYS from the hash and never discloses the address', () => {
    // The canon draws `ip_103.24.…/29` — real octets. On a range that narrows the search space for anybody reading
    // the screen, which is the disclosure the hashing exists to prevent.
    const h = hashIdentifier('ip_range', '103.24.0.0/29');
    const shown = displayIdentifier('ip_range', h);
    expect(shown).not.toContain('103.24');
    expect(shown.startsWith('ip_')).toBe(true);
    expect(displayIdentifier('device', h).startsWith('dev_')).toBe(true);
    expect(displayIdentifier('phone_hash', h).startsWith('ph_')).toBe(true);
    // A short or absent hash must not throw or slice into nonsense on a page somebody is reading during an incident.
    expect(displayIdentifier('device', '')).toBe('dev_…');
    expect(displayIdentifier('device', undefined as unknown as string)).toBe('dev_…');

    // THE GUARD ITSELF, and it needed a mutation test to find — THIRD WAVE RUNNING for the identical reason.
    // '' and undefined are shapes the CALLER produces; the length guard exists for a SHORT NON-EMPTY string, and
    // dropping it left both of those cases returning 'dev_…' unchanged. On a 3-character value the mutant returns
    // 'dev_abc…bc' — the whole identifier, twice, wearing the truncation ellipsis that is supposed to mean it was
    // withheld. That is the exact disclosure the hashing exists to prevent, rendered in the shape of a redaction.
    //
    // ADMIN-5b found this in `optInText`, ADMIN-5c in `tile`, and I fixed BOTH by adding cases to those functions.
    // The lesson generalises to the CLASS OF GUARD, not to the function that happened to fail: wherever a function
    // has a floor, a range or a finiteness check, the test must feed it a value inside the guard's reach — not the
    // empty and null cases the caller usually sends.
    expect(displayIdentifier('device', 'abc')).toBe('dev_…');
    expect(displayIdentifier('ip_range', '0123456')).toBe('ip_…');       // 7 chars — one under the floor
    expect(displayIdentifier('ip_range', '01234567')).toBe('ip_0123…67'); // 8 — the first length that may be shown
  });
  it('recognises exactly the three types', () => {
    expect([...IDENTIFIER_TYPES]).toEqual(['device', 'ip_range', 'phone_hash']);
    expect(isIdentifierType('email')).toBe(false);
    expect(isIdentifierType(null)).toBe(false);
  });
  it('normalise leaves a device id otherwise untouched', () => {
    expect(normaliseIdentifier('device', 'AbC-123')).toBe('abc-123');
  });
});

describe('ADMIN-5d · the expiry rule — W096 says indefinite blocks without review are prohibited', () => {
  it('REFUSES a block with neither an expiry nor a review date', () => {
    expect(() => assertExpiryOrReview(null, null, NOW)).toThrow(InvalidBlocklistEntryError);
  });
  it('REFUSES a date in the PAST, which the DB CHECK cannot express', () => {
    // ck_platform_blocklists_expiry_or_review is satisfied by any non-null value. A block created today "for review
    // last March" passes the constraint and is a permanent ban wearing a date.
    expect(() => assertExpiryOrReview(past(1), null, NOW)).toThrow(InvalidBlocklistEntryError);
    expect(() => assertExpiryOrReview(null, past(1), NOW)).toThrow(InvalidBlocklistEntryError);
    expect(() => assertExpiryOrReview(NOW, null, NOW)).toThrow(InvalidBlocklistEntryError);   // exactly now is not future
  });
  it('ACCEPTS either one alone', () => {
    expect(() => assertExpiryOrReview(future(1), null, NOW)).not.toThrow();
    expect(() => assertExpiryOrReview(null, future(1), NOW)).not.toThrow();
  });
  it('a reason under the floor is refused — the identifier is hashed, so this is the only account of it', () => {
    expect(REASON_MIN).toBe(12);
    expect(() => assertReason('fraud')).toThrow(InvalidBlocklistEntryError);
    expect(() => assertReason('   spam      ')).toThrow(InvalidBlocklistEntryError);   // trimmed, then measured
    expect(() => assertReason(null)).toThrow(InvalidBlocklistEntryError);
    expect(() => assertReason('x'.repeat(301))).toThrow(InvalidBlocklistEntryError);
    expect(assertReason('  credential-stuffing source  ')).toBe('credential-stuffing source');
  });
});

describe('ADMIN-5d · a lapsed block is not an enforcing block', () => {
  it('an ACTIVE row past its expiry renders EXPIRED', () => {
    // Nothing writes status='expired' — there is no sweeper — so the column lies by omission.
    expect(blockState(block({ expiresAt: past(1).toISOString() }), NOW)).toBe('expired');
    expect(blockState(block({ expiresAt: future(1).toISOString() }), NOW)).toBe('active');
  });
  it('a row with NEITHER date is UNBOUNDED, not active', () => {
    expect(blockState(block({ expiresAt: null, reviewAt: null }), NOW)).toBe('unbounded');
  });
  it('an UNPARSEABLE expiry is unbounded, never a permanent block', () => {
    // Treating a corrupt date as "no expiry" silently promotes a broken row to a forever-ban.
    expect(blockState(block({ expiresAt: 'not-a-date' }), NOW)).toBe('unbounded');
  });
  it('lifted and expired statuses are respected as stored', () => {
    expect(blockState(block({ status: 'lifted' }), NOW)).toBe('lifted');
    expect(blockState(block({ status: 'expired', expiresAt: future(99).toISOString() }), NOW)).toBe('expired');
  });
  it('a review date that has arrived is reported', () => {
    expect(reviewDue([block({ expiresAt: null, reviewAt: past(1).toISOString() })], NOW)).toEqual(['b1']);
    expect(reviewDue([block({ expiresAt: null, reviewAt: future(1).toISOString() })], NOW)).toEqual([]);
    expect(reviewDue([block({ expiresAt: null, reviewAt: 'nonsense' })], NOW)).toEqual([]);
    expect(reviewDue([block({ status: 'lifted', reviewAt: past(1).toISOString() })], NOW)).toEqual([]);
  });
  it('ATTEMPTS BLOCKED IS UNKNOWN, NOT ZERO — nothing reads this list', () => {
    // "0 attempts blocked" says the block is installed and nobody has tried. The truth is nothing checks.
    expect(attemptsBlocked(block({ attemptsBlocked: 0 }))).toEqual({ known: false, reason: ATTEMPTS_UNCOUNTED });
    // Even a non-zero stored value is not reported, because no code path could have produced it honestly.
    expect(attemptsBlocked(block({ attemptsBlocked: 1204 })).known).toBe(false);
  });
  it('lifting needs its own reason and cannot be done twice', () => {
    expect(() => assertLiftable(block(), 'x')).toThrow(InvalidBlocklistEntryError);
    expect(() => assertLiftable(block({ status: 'lifted' }), 'appeal upheld on review')).toThrow(InvalidBlocklistEntryError);
    expect(assertLiftable(block(), 'appeal upheld on review')).toBe('appeal upheld on review');
  });
  it('tab counts cover ACTIVE rows only and every type appears', () => {
    const counts = typeCounts([
      block({ identifierType: 'device' }), block({ identifierType: 'device' }),
      block({ identifierType: 'ip_range' }), block({ identifierType: 'phone_hash', status: 'lifted' }),
    ]);
    expect(counts).toEqual({ device: 2, ip_range: 1, phone_hash: 0 });
  });
});

/* ================================================================================================ */
describe('ADMIN-5d · THE DRY-RUN GATE — the point of the wave', () => {
  it('REFUSES to approve with no dry run', () => {
    const r = rule({ dryRunAt: null, dryRunBandDrops: null });
    expect(approvalState(r, NOW)).toEqual({ ok: false, reason: 'no_dry_run' });
    expect(() => assertApprovable(r, 'op-b', NOW)).toThrow(DryRunRequiredError);
  });
  it('REFUSES to approve on a STALE dry run, and says how old', () => {
    // W095: "dry-run against YESTERDAY's population". Figures from three weeks ago describe a platform that has moved.
    const r = rule({ dryRunAt: past(DRY_RUN_MAX_AGE_HOURS + 5).toISOString() });
    const s = approvalState(r, NOW);
    expect(s.ok).toBe(false);
    expect(!s.ok && s.reason === 'stale_dry_run' && s.ageHours).toBe(DRY_RUN_MAX_AGE_HOURS + 5);
    expect(() => assertApprovable(r, 'op-b', NOW)).toThrow(DryRunRequiredError);
  });
  it('a dry run dated in the FUTURE is not fresh', () => {
    // Clock skew or a fabricated timestamp would otherwise sail through a one-sided age check.
    expect(isDryRunFresh(future(5), NOW)).toBe(false);
    expect(isDryRunFresh(past(1), NOW)).toBe(true);
    expect(isDryRunFresh(past(DRY_RUN_MAX_AGE_HOURS + 0.5), NOW)).toBe(false);
  });
  it('REFUSES to approve with no proposal, and refuses to approve twice', () => {
    expect(approvalState(rule({ proposedWeight: null }), NOW)).toEqual({ ok: false, reason: 'no_proposal' });
    expect(approvalState(rule({ checkedBy: 'op-b', checkedAt: NOW.toISOString() }), NOW)).toEqual({ ok: false, reason: 'already_checked' });
    expect(() => assertApprovable(rule({ proposedWeight: null }), 'op-b', NOW)).toThrow(InvalidRiskRuleChangeError);
  });
  it('REFUSES the PROPOSER approving their own weight change', () => {
    expect(() => assertApprovable(rule({ proposedBy: 'op-a' }), 'op-a', NOW)).toThrow(SecondPersonRequiredError);
  });
  it('ALLOWS a different operator on a fresh, dry-run-backed proposal', () => {
    expect(assertApprovable(rule(), 'op-b', NOW)).toEqual({ from: -12, to: -15 });
  });
  it('an UNKNOWN proposer does not create a permanent dead end', () => {
    // The two-person rule's documented null escape: nobody could ever approve a backfilled row otherwise.
    expect(() => assertApprovable(rule({ proposedBy: null }), 'op-b', NOW)).not.toThrow();
  });
  it('an unidentifiable APPROVER is refused', () => {
    expect(() => assertApprovable(rule(), '', NOW)).toThrow(SecondPersonRequiredError);
  });
});

describe('ADMIN-5d · the dry run itself must be a real measurement', () => {
  const good = { bandDrops: 312, newRestricted: 41, population: 78_204, computedAt: past(2) };
  it('accepts a proper one', () => { expect(assertDryRun(good)).toEqual(good); });
  it('REFUSES a missing or malformed dry run', () => {
    expect(() => assertDryRun(null)).toThrow(DryRunRequiredError);
    expect(() => assertDryRun({ ...good, computedAt: undefined })).toThrow(DryRunRequiredError);
    expect(() => assertDryRun({ ...good, bandDrops: undefined })).toThrow(DryRunRequiredError);
  });
  it('REFUSES a dry run over NOBODY — it demonstrates nothing', () => {
    // W095's own failure state: "yesterday's population snapshot unavailable — changes cannot ship without a dry run".
    expect(() => assertDryRun({ ...good, population: 0, bandDrops: 0, newRestricted: 0 })).toThrow(DryRunRequiredError);
  });
  it('REFUSES arithmetic that cannot be true', () => {
    // A dry run that moves more people than exist looks checked while being broken, which is worse than absent.
    expect(() => assertDryRun({ ...good, bandDrops: 99_999 })).toThrow(InvalidRiskRuleChangeError);
    expect(() => assertDryRun({ ...good, newRestricted: 99_999 })).toThrow(InvalidRiskRuleChangeError);
    expect(() => assertDryRun({ ...good, bandDrops: -1 })).toThrow(InvalidRiskRuleChangeError);
    expect(() => assertDryRun({ ...good, population: 1.5 })).toThrow(InvalidRiskRuleChangeError);
  });
  it('a proposed weight must be a bounded whole number and must actually change something', () => {
    expect(assertProposedWeight(-12, -15)).toBe(-15);
    expect(() => assertProposedWeight(-12, -12)).toThrow(InvalidRiskRuleChangeError);        // no-op
    expect(() => assertProposedWeight(-12, -12.5)).toThrow(InvalidRiskRuleChangeError);
    expect(() => assertProposedWeight(-12, Number.NaN)).toThrow(InvalidRiskRuleChangeError);
    expect(() => assertProposedWeight(-12, WEIGHT_MIN - 1)).toThrow(InvalidRiskRuleChangeError);
    expect(() => assertProposedWeight(-12, WEIGHT_MAX + 1)).toThrow(InvalidRiskRuleChangeError);
    expect(() => assertProposedWeight(-12, '-15' as unknown)).toThrow(InvalidRiskRuleChangeError);
  });
});

describe('ADMIN-5d · THE DRIFT — the configuration is not the behaviour', () => {
  const seeded = [
    { eventCode: 'same_ip_bidding', weight: -30, isActive: true },
    { eventCode: 'fake_listing', weight: -40, isActive: true },
    { eventCode: 'duplicate_kyc', weight: -35, isActive: true },
    { eventCode: 'dispute_lost', weight: -12, isActive: true },
    { eventCode: 'clean_history_bonus', weight: 8, isActive: true },
  ];
  it('names the rule whose configured weight the code does not use', () => {
    const d = weightDrift(seeded);
    const mismatch = d.filter((x) => x.kind === 'weight_mismatch');
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toMatchObject({ eventCode: 'dispute_lost', configured: -12, observed: -15 });
  });
  it('names the rules NOTHING EMITS — three of the five have no producer at all', () => {
    const orphans = weightDrift(seeded).filter((x) => x.kind === 'no_producer').map((x) => x.eventCode);
    expect(orphans).toEqual(['clean_history_bonus', 'duplicate_kyc', 'fake_listing', 'same_ip_bidding']);
  });
  it('names the event the platform fires that is not configured at all', () => {
    const un = weightDrift(seeded).filter((x) => x.kind === 'unconfigured');
    expect(un).toHaveLength(1);
    expect(un[0]).toMatchObject({ eventCode: 'order_completed', configured: null, observed: 2 });
  });
  it('orders by how much it misleads: a wrong number before a dead rule before a gap', () => {
    // A rule that fires the WRONG weight is worse than one that never fires, because it makes the table look obeyed.
    expect(weightDrift(seeded).map((x) => x.kind)[0]).toBe('weight_mismatch');
    expect(weightDrift(seeded).map((x) => x.kind).at(-1)).toBe('unconfigured');
  });
  it('an INACTIVE rule is not reported as drifting', () => {
    const d = weightDrift([{ eventCode: 'fake_listing', weight: -40, isActive: false }]);
    expect(d.filter((x) => x.kind === 'no_producer')).toHaveLength(0);
  });
  it('a rule whose weight MATCHES the code is not reported', () => {
    // Asserted per-code rather than as an empty array: with only `order_completed` configured, `dispute_lost` is
    // genuinely unconfigured and SHOULD be reported. My first version of this test expected [] and failed — the
    // function was right and the expectation was a sloppy shorthand for "order_completed is clean".
    const d = weightDrift([{ eventCode: 'order_completed', weight: 2, isActive: true }]);
    expect(d.filter((x) => x.eventCode === 'order_completed')).toEqual([]);
    expect(d.map((x) => x.eventCode)).toEqual(['dispute_lost']);
  });
  it('records what the code actually does, with the file it was read from', () => {
    expect(OBSERVED_PRODUCERS.dispute_lost.weight).toBe(-15);
    expect(OBSERVED_PRODUCERS.dispute_lost.source).toContain('dispute-resolved.handler');
  });
  it('the BAND LADDER drift is reported at every boundary that differs', () => {
    // canon 70/50/30/10 vs code 80/60/40/20 — the code is harsher everywhere except the floor.
    const d = bandLadderDrift();
    expect(d.map((x) => x.band)).toEqual(['trusted', 'standard', 'caution', 'restricted']);
    expect(d[0]).toEqual({ band: 'trusted', canonFloor: 70, codeFloor: 80 });
  });
  it('coverage reports never-fired codes, and UNAVAILABLE counts are not never-fired', () => {
    const counts = new Map([['dispute_lost', 211]]);
    expect(ruleCoverage(seeded, counts)).toEqual({
      total: 5, fired: 1,
      neverFired: ['clean_history_bonus', 'duplicate_kyc', 'fake_listing', 'same_ip_bidding'],
      countsUnavailable: false,
    });
    // "we could not count" must not render as "these rules have never fired".
    expect(ruleCoverage(seeded, null)).toEqual({ total: 5, fired: 0, neverFired: [], countsUnavailable: true });
  });
});

/* ================================================================================================ */
describe('ADMIN-5d · the score arithmetic W094 promises', () => {
  it('CLOSES when the parts add up', () => {
    const f = { base: 78, factors: [{ event: 'same_ip_bidding', weight: -30 }, { event: 'dispute_lost', weight: -12 }, { event: 'clean_history_bonus', weight: 8 }] };
    expect(factorPanel(44, f)).toMatchObject({ kind: 'closed', base: 78, score: 44 });
  });
  it('REFUSES to print an equation that does not close', () => {
    // The operator reads the total on the right — the one that decides what happens to the person — and it is not
    // the total of the terms beside it. An equation with a wrong answer is worse than no equation.
    const f = { base: 78, factors: [{ event: 'dispute_lost', weight: -12 }] };
    expect(factorPanel(44, f)).toMatchObject({ kind: 'does_not_close', sum: 66, score: 44 });
  });
  it('accepts a legitimately CLAMPED total — the entity clamps 0–100', () => {
    const f = { base: 70, factors: [{ event: 'fake_listing', weight: -400 }] };
    expect(factorPanel(0, f).kind).toBe('closed');
    const g = { base: 70, factors: [{ event: 'order_completed', weight: 400 }] };
    expect(factorPanel(100, g).kind).toBe('closed');
  });
  it('names WHY there is no breakdown, which is the state of every real row today', () => {
    // The recompute job stores a weighted total, not the events. The panel has never had data behind it.
    expect(factorPanel(44, { window_days: 180, weighted_total: -26 }))
      .toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('weighted total') });
  });
  it('refuses to guess when the base was not recorded', () => {
    expect(factorPanel(44, { factors: [{ event: 'x', weight: -1 }] }).kind).toBe('unavailable');
  });
  it('refuses malformed factor entries rather than skipping them', () => {
    // Skipping an unreadable term would produce an equation missing a line and a total that then looks wrong.
    expect(factorPanel(44, { base: 78, factors: [{ event: 'x' }] }).kind).toBe('unavailable');
    expect(factorPanel(44, { base: 78, factors: [{ event: 'x', weight: Number.NaN }] }).kind).toBe('unavailable');
    expect(factorPanel(44, { base: 78, factors: ['nope'] }).kind).toBe('unavailable');
  });
  it('a missing or non-finite score has no panel', () => {
    expect(factorPanel(null, { base: 1, factors: [] }).kind).toBe('unavailable');
    expect(factorPanel(Number.NaN, { base: 1, factors: [{ event: 'x', weight: 0 }] }).kind).toBe('unavailable');
    expect(factorPanel(44, null).kind).toBe('unavailable');
    expect(factorPanel(44, [1, 2]).kind).toBe('unavailable');
  });
});

describe('ADMIN-5d · reading a stored band honestly', () => {
  it('agrees when the stored band matches both ladders', () => {
    expect(readBand({ score: 85, band: 'trusted' })).toEqual({ kind: 'agreed', band: 'trusted', score: 85 });
  });
  it('reports LADDER DRIFT when the canon would band this person differently', () => {
    // 75 is `standard` to the code and `trusted` to the specification. 35 is `restricted` to the code and `caution`
    // to the specification — and `restricted` is the band that carries the payout delay.
    expect(readBand({ score: 75, band: 'standard' })).toEqual({ kind: 'ladder_drift', band: 'standard', canon: 'trusted', score: 75 });
    expect(readBand({ score: 35, band: 'restricted' })).toEqual({ kind: 'ladder_drift', band: 'restricted', canon: 'caution', score: 35 });
  });
  it('reports INCONSISTENT when the row disagrees with the platform own ladder', () => {
    expect(readBand({ score: 85, band: 'blocked' })).toEqual({ kind: 'inconsistent', band: 'blocked', expected: 'trusted', score: 85 });
  });
  it('an unknown band or missing score is UNKNOWN, never defaulted to standard', () => {
    expect(readBand({ score: null, band: 'trusted' }).kind).toBe('unknown');
    expect(readBand({ score: Number.NaN, band: 'trusted' }).kind).toBe('unknown');
    expect(readBand({ score: 50, band: 'gold' }).kind).toBe('unknown');
    expect(readBand({ score: 50, band: null }).kind).toBe('unknown');
  });
  it('the two ladders differ exactly where bandLadderDrift says they do', () => {
    expect(canonBand(75)).toBe('trusted');
    expect(codeBand(75)).toBe('standard');
    expect(canonBand(Number.NaN)).toBeNull();
    expect([...RISK_BANDS]).toEqual(['trusted', 'standard', 'caution', 'restricted', 'blocked']);
    expect(isRiskBand('gold')).toBe(false);
  });
});

describe('ADMIN-5d · band effects are labelled with whether they happen', () => {
  it('NO restriction on the platform is enforced', () => {
    for (const band of RISK_BANDS) {
      for (const e of BAND_EFFECTS[band]) {
        if (e.key === 'walletStillWithdrawable') continue;
        expect(e.enforced).toBe(false);
      }
      expect(anyEffectEnforced(band)).toBe(false);
    }
  });
  it('the money-is-never-confiscated promise IS true and is shown as such', () => {
    // W094: "wallet funds remain withdrawable (money is never confiscated)" — the one line a blocked person most
    // needs, and the only effect on the panel the platform actually honours.
    const wallet = BAND_EFFECTS.blocked.find((e) => e.key === 'walletStillWithdrawable');
    expect(wallet?.enforced).toBe(true);
    // …and it must not make the ladder look enforced.
    expect(anyEffectEnforced('blocked')).toBe(false);
  });
});

describe('ADMIN-5d · changing a band by hand', () => {
  const base = { from: 'caution', reason: 'confirmed same-IP bidding ring across two auctions', actor: 'op-b', previousActor: 'op-a' as string | null };
  it('BLOCKED needs a second operator; other bands do not', () => {
    expect(() => assertBandChange({ ...base, to: 'blocked', actor: 'op-a' })).toThrow(SecondPersonRequiredError);
    expect(() => assertBandChange({ ...base, to: 'blocked', actor: 'op-b' })).not.toThrow();
    // Restricting is a single-operator act — the canon gates only the bottom of the ladder.
    expect(() => assertBandChange({ ...base, to: 'restricted', actor: 'op-a' })).not.toThrow();
  });
  it('an unknown previous actor does not block a needed block', () => {
    expect(() => assertBandChange({ ...base, to: 'blocked', previousActor: null })).not.toThrow();
  });
  it('refuses an unknown band, a no-op change, and a thin reason', () => {
    expect(() => assertBandChange({ ...base, to: 'gold' })).toThrow(InvalidBandChangeError);
    expect(() => assertBandChange({ ...base, to: 'caution' })).toThrow(InvalidBandChangeError);
    expect(() => assertBandChange({ ...base, to: 'restricted', reason: 'fraud' })).toThrow(InvalidBandChangeError);
    expect(() => assertBandChange({ ...base, to: 'restricted', reason: null })).toThrow(InvalidBandChangeError);
    expect(() => assertBandChange({ ...base, to: 'restricted', reason: 'x'.repeat(1001) })).toThrow(InvalidBandChangeError);
  });
});

describe('ADMIN-5d · the board census and its denominator', () => {
  it('counts an UNRECOGNISED band rather than dropping it', () => {
    // Discarding it would make the census add up to less than the population while looking complete.
    const c = bandCensus([{ band: 'trusted' }, { band: 'gold' }, { band: null }]);
    expect(c).toMatchObject({ trusted: 1, unrecognised: 2, total: 3 });
  });
  it('a share is NULL without a real active-user denominator', () => {
    // W093 labels the percentage "of active users". Dividing by the SCORED population instead would overstate the
    // platform's health by however many accounts have never been scored — and the job that scores them never runs.
    expect(bandShare(100, 200, null)).toBeNull();
    expect(bandShare(100, 200, 0)).toBeNull();
    expect(bandShare(100, 200, Number.NaN)).toBeNull();
    expect(bandShare(100, 200, 1000)).toEqual({ pct: 10, of: 'active' });
  });
  it('refuses to combine figures that cannot have come from the same read', () => {
    expect(bandShare(300, 200, 1000)).toBeNull();   // more in one band than scored in total
    expect(bandShare(-1, 200, 1000)).toBeNull();
  });
  it('masks the subject, and NULL is passed through rather than masked', () => {
    expect(maskSubject({ fullName: 'Vipul Trivedi', phone: '+919312344448' }).phone).toContain('•');
    expect(maskSubject({ fullName: null, phone: null })).toEqual({ name: null, phone: null });
  });
});

/* ================================================================================================ */
describe('ADMIN-5d · the overview and insights tiles', () => {
  it('a tile with no value reports a REASON, never 0', () => {
    expect(tile(null, 'the register could not be read')).toEqual({ kind: 'unavailable', reason: 'the register could not be read' });
    expect(tile(undefined, 'x')).toEqual({ kind: 'unavailable', reason: 'x' });
    expect(tile(0, 'x', 'count')).toEqual({ kind: 'value', value: 0, unit: 'count' });
  });
  it('a NON-FINITE value is unavailable — the guard, not just the null path', () => {
    // The weakness a mutation test found in ADMIN-5b and again in ADMIN-5c: null/undefined/0 are all shapes the
    // PRODUCER emits, none of them the guard exists for. Covered from the start here.
    expect(tile(Number.NaN, 'x')).toEqual({ kind: 'unavailable', reason: 'x' });
    expect(tile(Number.POSITIVE_INFINITY, 'x')).toEqual({ kind: 'unavailable', reason: 'x' });
  });
  it('a rate over an EMPTY denominator is null, not 0%', () => {
    // "0% overturned" says we act and are never wrong. An empty appeals register says nobody has appealed, or nobody
    // can. Different platforms.
    expect(rate(0, 0)).toEqual({ pct: null, lowSample: true, denominator: 0 });
    expect(rate(3, 100)).toEqual({ pct: 3, lowSample: false, denominator: 100 });
    expect(rate(1, 5)).toEqual({ pct: 20, lowSample: true, denominator: 5 });
    expect(LOW_SAMPLE_BELOW).toBe(20);
  });
  it('a rate from unreadable or impossible inputs is null', () => {
    expect(rate(null, 100).pct).toBeNull();
    expect(rate(Number.NaN, 100).pct).toBeNull();
    expect(rate(5, Number.POSITIVE_INFINITY).pct).toBeNull();
    expect(rate(-1, 100).pct).toBeNull();
  });
  it('the median of nothing is NULL, not zero', () => {
    // "no report has ever been actioned" and "every report is actioned instantly" are opposite facts about a desk.
    expect(medianHours([])).toBeNull();
    expect(medianHours([Number.NaN, -3])).toBeNull();
    expect(medianHours([1, 2, 3])).toBe(2);
    expect(medianHours([1, 2, 3, 4])).toBe(2.5);
  });
  it('an UNRESOLVED reason is not folded into `other`', () => {
    // `other` is a reason somebody chose from the list; an unresolvable id is a broken join. Merging them makes a
    // data fault look like a user's choice — the ADMIN-4b rejection-code finding, in a new place.
    const b = reasonBreakdown([{ code: 'misleading_photos', count: 9 }, { code: 'other', count: 2 }, { code: null, count: 4 }]);
    expect(b.reasons).toEqual([{ code: 'misleading_photos', count: 9 }, { code: 'other', count: 2 }]);
    expect(b.unresolved).toBe(4);
    expect(b.total).toBe(15);
  });
});

describe('ADMIN-5d · SLA age', () => {
  it('breaches past the window and warns near it', () => {
    expect(slaState(past(5).toISOString(), REPORT_SLA_HOURS, NOW)).toEqual({ kind: 'breached', overHours: 1 });
    expect(slaState(past(3.5).toISOString(), REPORT_SLA_HOURS, NOW)).toEqual({ kind: 'due_soon', ageHours: 3.5 });
    expect(slaState(past(1).toISOString(), REPORT_SLA_HOURS, NOW)).toEqual({ kind: 'ok', ageHours: 1 });
  });
  it('UNMEASURED is not ok — an item with no age cannot be shown to be inside its SLA', () => {
    expect(slaState(null, REPORT_SLA_HOURS, NOW)).toEqual({ kind: 'unmeasured' });
    expect(slaState('not-a-date', REPORT_SLA_HOURS, NOW)).toEqual({ kind: 'unmeasured' });
  });
  it('an item timestamped in the FUTURE is unmeasured, not comfortably inside the window', () => {
    expect(slaState(future(2).toISOString(), REPORT_SLA_HOURS, NOW)).toEqual({ kind: 'unmeasured' });
  });
});

describe('ADMIN-5d · all quiet', () => {
  const READ: SourcesRead = { reports: true, appeals: true, blocklist: true, risk: true };
  const item: AttentionItem = { id: 'x', severity: 'info', messageKey: 'y' };
  it('needs an empty list AND every register read', () => {
    expect(allQuiet([], READ)).toBe(true);
    expect(allQuiet([], { ...READ, risk: false })).toBe(false);
    expect(allQuiet([item], READ)).toBe(false);
    expect(allQuiet(null, READ)).toBe(false);
    expect(allQuiet([], null)).toBe(false);
  });
  it('names the registers that could not be read', () => {
    expect(unreadSources({ ...READ, appeals: false, risk: false })).toEqual(['appeals', 'risk']);
    expect(unreadSources(READ)).toEqual([]);
    expect(unreadSources(null)).toEqual(['reports', 'appeals', 'blocklist', 'risk']);
  });
  it('orders worst-first and stably within a severity', () => {
    const out = orderAttention([
      { id: 'b', severity: 'info', messageKey: 'i' },
      { id: 'z', severity: 'overdue', messageKey: 'o' },
      { id: 'a', severity: 'info', messageKey: 'i' },
      { id: 'c', severity: 'blocking', messageKey: 'b' },
    ]);
    expect(out.map((x) => x.id)).toEqual(['z', 'c', 'a', 'b']);
  });
});
