// PC-56 ADMIN-6 · the ledger console helpers. Pure, framework-free.
// Three rules: a hash claim is worth the last time somebody checked, a broken chain is a P0 rather than a retry, and a
// Σ over stripes says how much of the money it is confident about.
import {
  formatMinor, shortHash, referenceText, txnTypeCell, magnitudeText, windowTooWide, MAX_LIVE_WINDOW_DAYS,
  balanceClass, balanceLabel, legDirection, legClass,
  outcomeClass, verifyMessageKey, isIncident, claimClass, claimKey,
  sumWarningKey, sumClass, chainCoverage, driftClass, driftDirection,
  type TxnBalance, type VerifyResult, type ChainClaim, type Confidence, type AccountGroup, type BalanceCheck,
} from '../features/ledger/ledger';

const NOW = new Date('2026-08-07T10:00:00.000Z');
const verified = (over: Partial<VerifyResult> = {}): VerifyResult => ({
  verificationId: 'v1', accountId: 'a1', accountCode: 'escrow',
  outcome: 'intact', entriesChecked: 40, fromGenesis: true, truncated: false, walkLimit: 5000,
  headCheck: { kind: 'matches' }, p0: false, ...over,
});

/* ================================================================================================ */
describe('ADMIN-6 console · money and hashes for display', () => {
  it('formats from a STRING, en-IN grouped, exact past float precision', () => {
    expect(formatMinor('864124800')).toBe('₹86,41,248.00');
    expect(formatMinor('-4860000')).toBe('−₹48,600.00');
    expect(formatMinor('9007199254740993')).toBe('₹9,00,71,99,25,47,409.93');
    expect(formatMinor('5')).toBe('₹0.05');
  });
  it('an unreadable amount is a dash, never 0', () => {
    expect(formatMinor(null)).toBe('—');
    expect(formatMinor('12.50')).toBe('—');
    expect(formatMinor('lots')).toBe('—');
  });
  it('truncates a hash for display and refuses to slice a short one into nonsense', () => {
    expect(shortHash('a'.repeat(64))).toBe('aaaa…aa');
    expect(shortHash('abc')).toBe('—');
    expect(shortHash('')).toBe('—');
    expect(shortHash(null)).toBe('—');
  });
  it('a reference needs BOTH halves — a bare id says nothing about what it is', () => {
    expect(referenceText({ referenceType: 'statement', referenceId: 'ST-1' })).toBe('statement/ST-1');
    expect(referenceText({ referenceType: null, referenceId: 'ST-1' })).toBe('—');
    expect(referenceText({ referenceType: 'statement', referenceId: null })).toBe('—');
  });
  it('an UNRESOLVED txn type is a data fault, not a transaction without a type', () => {
    // `txn_type_id` is a NOT NULL FK, so a missing code means the join failed. A blank cell would read as the second.
    expect(txnTypeCell({ txnType: 'settlement', txnTypeResolved: true })).toEqual({ known: true, text: 'settlement' });
    expect(txnTypeCell({ txnType: null, txnTypeResolved: false }).known).toBe(false);
    expect(txnTypeCell({ txnType: 'x', txnTypeResolved: false }).known).toBe(false);
  });
  it('MAGNITUDE is never a Σ — a healthy transaction sums to zero', () => {
    // A sum column would read ₹0.00 on every row and tell an operator scanning for a large movement nothing.
    expect(magnitudeText({ magnitudeMinor: '4860000', magnitudeText: '₹48,600.00' })).toBe('₹48,600.00');
    expect(magnitudeText({ magnitudeMinor: '4860000', magnitudeText: null })).toBe('₹48,600.00');
    expect(magnitudeText({ magnitudeMinor: null, magnitudeText: null })).toBe('—');
  });
  it('REFUSES a window wider than the live limit before the query is sent', () => {
    expect(MAX_LIVE_WINDOW_DAYS).toBe(31);
    expect(windowTooWide('2026-01-01T00:00:00.000Z', undefined, NOW)).toBe(true);
    expect(windowTooWide('2026-07-20T00:00:00.000Z', undefined, NOW)).toBe(false);
    expect(windowTooWide(undefined, undefined, NOW)).toBe(false);
    expect(windowTooWide('not-a-date', undefined, NOW)).toBe(false);
  });
});

describe('ADMIN-6 console · W065 the balance readout', () => {
  const bal = (over: Partial<TxnBalance> = {}): TxnBalance => ({
    balanced: true, sumMinor: '0', sumText: '₹0.00', legCount: 4, tooFewLegs: false, equation: 'x', ...over,
  });
  it('BALANCED is the only green state; unbalanced is a FAILURE', () => {
    // An unbalanced ledger transaction means money was created or destroyed — W006's alert calls it page-immediately.
    expect(balanceClass(bal())).toContain('ok');
    expect(balanceClass(bal({ balanced: false, sumText: '₹1.00' }))).toContain('danger');
    expect(balanceClass(null)).toContain('muted');
  });
  it('labels the three states distinctly', () => {
    expect(balanceLabel(bal())).toBe('Σ = 0 verified');
    expect(balanceLabel(bal({ balanced: false, sumText: '₹1.00' }))).toBe('Σ = ₹1.00 ≠ 0');
    expect(balanceLabel(bal({ balanced: false, tooFewLegs: true }))).toBe('fewer than two legs');
    expect(balanceLabel(null)).toBe('—');
  });
  it('reads a leg SIGN from the string, not from a parsed number', () => {
    // The sign of a beyond-precision amount must not depend on a lossy conversion.
    expect(legDirection('9007199254740993')).toBe('credit');
    expect(legDirection('-9007199254740993')).toBe('debit');
    expect(legDirection('4738500')).toBe('credit');
    expect(legDirection('-4860000')).toBe('debit');
  });
  it('a ZERO or unreadable leg is UNKNOWN and a failure colour', () => {
    // `amount_minor <> 0` is a CHECK, so a zero leg appearing here is a data fault on the one table that must not
    // have them — not a neutral value to render quietly.
    expect(legDirection('0')).toBe('unknown');
    expect(legDirection('-0')).toBe('unknown');
    expect(legDirection('000')).toBe('unknown');
    expect(legDirection('12.50')).toBe('unknown');
    expect(legDirection(null)).toBe('unknown');
    expect(legClass('unknown')).toContain('danger');
    expect(legClass('credit')).toContain('ok');
    expect(legClass('debit')).toContain('warn');
  });
  it('a signed zero is UNKNOWN, whichever way the guards are ordered', () => {
    // Kept for the BEHAVIOUR, not for the reason I first gave it. Two mutants survived on this function — the numeric
    // sign test, and swapping the zero and sign checks — and both are genuinely equivalent over the integer strings the
    // regex admits, because `-0 < 0` is false. My first version of this test claimed the ordering prevented `-0`
    // becoming a credit; it does not, and asserting a guarantee the code does not provide is worse than the
    // equivalence. `-0` must be `unknown` and `-1` must be `debit`; that is the whole claim.
    expect(legDirection('-0')).toBe('unknown');
    expect(legDirection('-00')).toBe('unknown');
    expect(legDirection('-1')).toBe('debit');
  });
});

/* ================================================================================================ */
describe('ADMIN-6 console · the chain verification result', () => {
  it('BROKEN is a failure and INCOMPLETE is a warning — different next moves', () => {
    // Broken means raise an incident; incomplete means widen the window and run it again.
    expect(outcomeClass('broken')).toContain('danger');
    expect(outcomeClass('incomplete')).toContain('warn');
    expect(outcomeClass('intact')).toContain('ok');
    expect(outcomeClass(null)).toContain('muted');
  });
  it('splits BROKEN by kind — an edited row and a missing row are different investigations', () => {
    expect(verifyMessageKey(verified({ outcome: 'broken', kind: 'hash_mismatch' }))).toBe('hashMismatch');
    expect(verifyMessageKey(verified({ outcome: 'broken', kind: 'chain_break' }))).toBe('chainBreak');
  });
  it('a CLEAN WALK with a DIFFERING HEAD is still reported — it is the only truncation signal', () => {
    // A tamperer who deleted the tail and rewrote last_entry_hash passes the walk and fails only here.
    const r = verified({ outcome: 'intact', headCheck: { kind: 'differs', walked: 'a', claimed: 'b' } });
    expect(verifyMessageKey(r)).toBe('headDiffers');
    expect(isIncident(r)).toBe(true);
  });
  it('a head that DIFFERS outranks an incomplete walk in the message', () => {
    const r = verified({ outcome: 'incomplete', headCheck: { kind: 'differs', walked: 'a', claimed: 'b' } });
    expect(verifyMessageKey(r)).toBe('headDiffers');
  });
  it('an INCOMPLETE walk with an unknown head is not an incident', () => {
    const r = verified({ outcome: 'incomplete', headCheck: { kind: 'unknown', reason: 'bounded' } });
    expect(verifyMessageKey(r)).toBe('incomplete');
    expect(isIncident(r)).toBe(false);
  });
  it('a BROKEN outcome is always an incident, whatever the head says', () => {
    expect(isIncident(verified({ outcome: 'broken', kind: 'hash_mismatch' }))).toBe(true);
    expect(isIncident(verified({ outcome: 'broken', kind: 'chain_break', headCheck: { kind: 'matches' } }))).toBe(true);
  });
  it('no result is not an incident, and has no message', () => {
    expect(isIncident(null)).toBe(false);
    expect(verifyMessageKey(null)).toBe('none');
    expect(verifyMessageKey(undefined)).toBe('none');
  });
});

describe('ADMIN-6 console · the chain CLAIM W006 and W059 printed on faith', () => {
  it('NEVER VERIFIED is a WARNING, not muted — and was the true state of every account', () => {
    // Both screens printed "intact" while nothing on the platform read prev_hash. An unverified chain is not neutral.
    expect(claimClass(null)).toContain('warn');
    expect(claimClass({ kind: 'never' })).toContain('warn');
    expect(claimKey(null)).toBe('never');
    expect(claimKey({ kind: 'never' })).toBe('never');
  });
  it('BROKEN is a failure; INTACT is the only green; INCOMPLETE stays a warning', () => {
    const broken: ChainClaim = { kind: 'broken', at: 'x', entryId: '7' };
    expect(claimClass(broken)).toContain('danger');
    expect(claimKey(broken)).toBe('broken');
    expect(claimClass({ kind: 'verified', outcome: 'intact', at: 'x', entriesChecked: 1 })).toContain('ok');
    expect(claimClass({ kind: 'verified', outcome: 'incomplete', at: 'x', entriesChecked: 1 })).toContain('warn');
    expect(claimKey({ kind: 'verified', outcome: 'incomplete', at: 'x', entriesChecked: 1 })).toBe('incomplete');
  });
  it('reports COVERAGE — 16 stripes with 1 verification is not "intact"', () => {
    // The claim would cover a sixteenth of the money, and the fraction is the honest rendering.
    expect(chainCoverage({ accountCode: 'escrow', claim: { kind: 'never' }, stripesVerified: 1, stripeCount: 16 }))
      .toEqual({ known: true, verified: 1, total: 16 });
    expect(chainCoverage(null)).toEqual({ known: false, verified: 0, total: 0 });
    expect(chainCoverage({ accountCode: 'x', claim: { kind: 'never' }, stripesVerified: 0, stripeCount: 0 }).known).toBe(false);
  });
});

describe('ADMIN-6 console · Σ over stripes, with its confidence', () => {
  const group = (over: Partial<AccountGroup> = {}): AccountGroup => ({
    accountCode: 'escrow', currencyCode: 'INR', stripeCount: 16,
    totalMinor: '864124800', totalText: '₹86,41,248.00', frozenStripes: 0,
    shardNumbers: [0, 1], missingStripes: [], confidence: { trustworthy: true, stripeCount: 16 },
    chain: null, ...over,
  });
  it('a TRUSTWORTHY Σ carries no warning', () => {
    expect(sumWarningKey(group().confidence)).toBeNull();
    expect(sumClass(group().confidence)).toContain('ok');
  });
  it('a HOLE in the stripe set is a failure with its own message', () => {
    // A missing stripe row means money landed somewhere the query did not look, and a confident total would
    // under-report the platform's money with nothing on screen admitting it.
    const c: Confidence = { trustworthy: false, reason: 'missing_stripes', missing: [7] };
    expect(sumWarningKey(c)).toBe('missingStripes');
    expect(sumClass(c)).toContain('danger');
  });
  it('FEWER stripes than configured is its own message, not the same one', () => {
    const c: Confidence = { trustworthy: false, reason: 'fewer_than_configured', found: 2, configured: 16 };
    expect(sumWarningKey(c)).toBe('fewerThanConfigured');
    expect(sumClass(c)).toContain('danger');
  });
  it('an absent confidence is treated as fine — the server always sends one', () => {
    expect(sumWarningKey(null)).toBeNull();
    expect(sumClass(undefined)).toContain('ok');
  });
});

describe('ADMIN-6 console · the balance drift check', () => {
  const chk = (over: Partial<BalanceCheck> = {}): BalanceCheck => ({
    accountId: 'a', accountCode: 'main', ownerKind: 'user', shardNo: 0,
    cachedMinor: '71565', cachedText: '₹715.65', ledgerMinor: '71565', ledgerText: '₹715.65',
    deltaMinor: '0', deltaText: '₹0.00', matches: true, truthSource: 'ledger_entries', ...over,
  });
  it('a match is green and a DRIFT is a failure', () => {
    expect(driftClass(chk())).toContain('ok');
    expect(driftClass(chk({ matches: false, deltaMinor: '100' }))).toContain('danger');
    expect(driftClass(null)).toContain('muted');
  });
  it('OVER means the holder was shown money they do not have', () => {
    // The direction is the whole message: over means somebody's app says they have more than the ledger does.
    expect(driftDirection('100')).toBe('over');
    expect(driftDirection('-100')).toBe('under');
    expect(driftDirection('0')).toBe('none');
  });
  it('the direction is EXACT past float precision', () => {
    expect(driftDirection('9007199254740993')).toBe('over');
    expect(driftDirection('-9007199254740993')).toBe('under');
  });
  it('an unreadable delta is UNKNOWN, never none', () => {
    // "none" would say the balances agree, which is the one thing an unreadable delta cannot establish.
    expect(driftDirection(null)).toBe('unknown');
    expect(driftDirection('12.50')).toBe('unknown');
    expect(driftDirection('lots')).toBe('unknown');
  });
});
