// PC-56 ADMIN-6 · the hash-chain verifier and the stripe sum. Pure domain only.
// The central claims: the verifier agrees byte-for-byte with the two money writers, it tells "a row was edited" apart
// from "a row is missing", and a Σ over stripes says how much of the money it is confident about.
import { createHash } from 'node:crypto';
import {
  entryHash, verifyChain, checkHead, txnBalance, balanceEquation, HASH_PREIMAGE, WRITER_SOURCES,
  type ChainEntry,
} from '../domain/hash-chain';
import {
  OWNER_KINDS, PLATFORM_ACCOUNT_CODES, groupStripes, missingStripes, sumConfidence, chainClaim,
  formatMinor, parseMinor, type StripeRow,
} from '../domain/accounts';
import { InvalidLedgerQueryError } from '../domain/ledger-ops.errors';

const ACC = '11111111-1111-1111-1111-111111111111';
const TXN = '22222222-2222-2222-2222-222222222222';

/** Build a well-formed chain of `n` entries, each hashed exactly as the writers do. */
function chain(n: number, over: Partial<ChainEntry>[] = []): ChainEntry[] {
  const out: ChainEntry[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i += 1) {
    const amount = BigInt((i + 1) * 100);
    const balance = BigInt((i + 1) * 100);
    const e: ChainEntry = {
      id: String(i + 1), txnId: TXN, accountId: ACC,
      amountMinor: amount, balanceAfterMinor: balance,
      prevHash: prev, entryHash: entryHash(prev, TXN, ACC, amount, balance),
      createdAt: new Date(Date.UTC(2026, 7, 7, 0, i)).toISOString(),
      ...(over[i] ?? {}),
    };
    out.push(e);
    prev = e.entryHash;
  }
  return out;
}

const stripe = (over: Partial<StripeRow> = {}): StripeRow => ({
  id: 's1', ownerKind: 'platform', accountCode: 'escrow', currencyCode: 'INR', shardNo: 0,
  cachedBalanceMinor: 1_000n, balanceVersion: 1n, lastEntryHash: 'a'.repeat(64),
  isFrozen: false, freezeReason: null, ...over,
});

/* ================================================================================================ */
describe('ADMIN-6 · THE VERIFIER MUST AGREE WITH THE WRITERS', () => {
  it('reproduces the writers formula EXACTLY, computed independently here', () => {
    // A verifier that disagrees with the writers is worse than none: it pages P0 over a healthy ledger, and a team
    // that has been paged for a formula mismatch learns to ignore the alarm. So this test recomputes the preimage
    // from the documented spec rather than calling the same helper twice.
    const expected = createHash('sha256').update('prev|txn|acct|-500|1200').digest('hex');
    expect(entryHash('prev', 'txn', 'acct', -500n, 1200n)).toBe(expected);
  });
  it('a NULL prev becomes the EMPTY STRING, not the text "null"', () => {
    // The genesis entry of an account's chain. Hashing the literal 'null' would make every account's first entry
    // verify as broken.
    expect(entryHash(null, 'txn', 'acct', 1n, 1n))
      .toBe(createHash('sha256').update('|txn|acct|1|1').digest('hex'));
    expect(entryHash(null, 'txn', 'acct', 1n, 1n)).not.toBe(entryHash('null', 'txn', 'acct', 1n, 1n));
  });
  it('bigints are base-10 with a leading minus, and survive past float precision', () => {
    // A balance of 9007199254740993 minor units hashed after a lossy conversion would report a tamper that did not
    // happen — which is the failure mode that makes a verifier untrustworthy rather than merely wrong.
    const big = 9_007_199_254_740_993n;
    expect(entryHash(null, 'txn', 'acct', big, big))
      .toBe(createHash('sha256').update(`|txn|acct|${big}|${big}`).digest('hex'));
    expect(entryHash(null, 'txn', 'acct', big, big)).not.toBe(entryHash(null, 'txn', 'acct', big - 1n, big));
  });
  it('names both writer sources, so a formula change cannot silently diverge', () => {
    expect(WRITER_SOURCES).toHaveLength(2);
    expect(WRITER_SOURCES[0]).toContain('wallet-service');
    expect(WRITER_SOURCES[1]).toContain('wallet.client.inprocess');
    expect(HASH_PREIMAGE).toContain('balance_after_minor');
  });
});

describe('ADMIN-6 · walking a chain', () => {
  it('an INTACT chain from genesis verifies', () => {
    const r = verifyChain(chain(4), true);
    expect(r.outcome).toBe('intact');
    expect(r.entriesChecked).toBe(4);
  });
  it('detects an EDITED row as a hash_mismatch, and names the entry and both hashes', () => {
    // Somebody changed an amount in place. The stored hash no longer matches the stored fields.
    const c = chain(4);
    c[2] = { ...c[2], amountMinor: 999_999n };
    const r = verifyChain(c, true);
    expect(r.outcome).toBe('broken');
    expect(r.outcome === 'broken' && r.kind).toBe('hash_mismatch');
    expect(r.outcome === 'broken' && r.brokenAtEntryId).toBe('3');
    expect(r.outcome === 'broken' && r.storedHash).toBe(c[2].entryHash);
    expect(r.outcome === 'broken' && r.expectedHash).not.toBe(c[2].entryHash);
  });
  it('detects a REMOVED row as a chain_break — a DIFFERENT finding from an edit', () => {
    // Deleting entry 2 leaves entry 3's prev_hash pointing at something no longer present. Collapsing this into
    // "broken" would send the same page for "a row was altered" and "a row is missing", which are different
    // investigations.
    const c = chain(4);
    const withHole = [c[0], c[2], c[3]];
    const r = verifyChain(withHole, true);
    expect(r.outcome).toBe('broken');
    expect(r.outcome === 'broken' && r.kind).toBe('chain_break');
    expect(r.outcome === 'broken' && r.brokenAtEntryId).toBe('3');
  });
  it('detects a TRUNCATED start as a chain_break when genesis was expected', () => {
    // The caller says this is the account's first entry and it carries a prev_hash, so earlier entries existed.
    const c = chain(4);
    const r = verifyChain([c[1], c[2], c[3]], true);
    expect(r.outcome).toBe('broken');
    expect(r.outcome === 'broken' && r.kind).toBe('chain_break');
    expect(r.outcome === 'broken' && r.brokenAtEntryId).toBe('2');
  });
  it('a bounded window starting mid-chain is INCOMPLETE, never intact', () => {
    // The first entry's link cannot be confirmed — it points outside the window. Claiming intact would be exactly the
    // overstatement this module exists to remove.
    const c = chain(4);
    const r = verifyChain([c[1], c[2], c[3]], false);
    expect(r.outcome).toBe('incomplete');
    expect(r.entriesChecked).toBe(3);
    expect(r.outcome === 'incomplete' && r.reason).toContain('mid-chain');
  });
  it('an incomplete window STILL reports a hash mismatch found further along', () => {
    // The downgrade must not swallow a real finding: the walk continues past the unanchored first entry.
    const c = chain(4);
    c[2] = { ...c[2], balanceAfterMinor: 42n };
    const r = verifyChain([c[1], c[2], c[3]], false);
    expect(r.outcome).toBe('broken');
    expect(r.outcome === 'broken' && r.kind).toBe('hash_mismatch');
  });
  it('checks the FIRST entry hash even when the window is unanchored', () => {
    // An edited genesis row would otherwise pass unexamined in a mid-chain window.
    const c = chain(3);
    c[0] = { ...c[0], amountMinor: 7n };
    const r = verifyChain([c[0], c[1], c[2]], false);
    expect(r.outcome).toBe('broken');
    expect(r.outcome === 'broken' && r.brokenAtEntryId).toBe('1');
  });
  it('an EMPTY window is incomplete — claiming intact would be a claim about nothing', () => {
    expect(verifyChain([], true)).toEqual({ outcome: 'incomplete', entriesChecked: 0, headHash: null, reason: 'no entries in the window' });
  });
  it('a genesis entry with a non-null prev is broken, and reports the offending value', () => {
    const c = chain(1, [{ prevHash: 'deadbeef' }]);
    // Rehash so the row is internally consistent — otherwise this would trip the hash check instead of the link check,
    // which is the ordering trap this asserts against.
    c[0] = { ...c[0], entryHash: entryHash('deadbeef', c[0].txnId, c[0].accountId, c[0].amountMinor, c[0].balanceAfterMinor) };
    const r = verifyChain(c, true);
    expect(r.outcome === 'broken' && r.kind).toBe('chain_break');
    expect(r.outcome === 'broken' && r.storedHash).toBe('deadbeef');
  });
});

describe('ADMIN-6 · the head check is separate, and weak on its own', () => {
  it('MATCHES when the walk reached the end and the head agrees', () => {
    expect(checkHead('abc', 'abc', true)).toEqual({ kind: 'matches' });
  });
  it('DIFFERS is the only thing that notices a TRUNCATED ledger', () => {
    // A tamperer who deleted the tail and rewrote last_entry_hash would pass the walk — the remaining entries are
    // perfectly consistent — and fail only here.
    expect(checkHead('abc', 'xyz', true)).toEqual({ kind: 'differs', walked: 'abc', claimed: 'xyz' });
  });
  it('is UNKNOWN on a bounded walk — its last entry is not meant to be the head', () => {
    expect(checkHead('abc', 'xyz', false).kind).toBe('unknown');
  });
  it('is UNKNOWN when the account records no head at all', () => {
    expect(checkHead('abc', null, true).kind).toBe('unknown');
  });
});

describe('ADMIN-6 · W065 the transaction balance', () => {
  it('recomputes Σ from the legs and prints the arithmetic', () => {
    const legs = [-4_860_000n, 72_900n, 48_600n, 4_738_500n];
    expect(txnBalance(legs)).toEqual({ balanced: true, sumMinor: 0n, legCount: 4 });
    expect(balanceEquation(legs)).toBe('-4860000 + 72900 + 48600 + 4738500 = 0');
  });
  it('an UNBALANCED transaction reports the real Σ', () => {
    const r = txnBalance([-100n, 99n]);
    expect(r.balanced).toBe(false);
    expect(r.sumMinor).toBe(-1n);
  });
  it('ONE leg is never balanced even at zero — a transaction is a transfer', () => {
    const r = txnBalance([0n]);
    expect(r.balanced).toBe(false);
    expect('tooFewLegs' in r && r.tooFewLegs).toBe(true);
    expect(txnBalance([]).balanced).toBe(false);
  });
  it('the equation shows a negative continuation as a minus, not a double sign', () => {
    expect(balanceEquation([100n, -100n])).toBe('100 − 100 = 0');
    expect(balanceEquation([])).toBe('');
  });
});

/* ================================================================================================ */
describe('ADMIN-6 · Σ OVER STRIPES — the balance the console was not showing', () => {
  it('sums stripes per account_code and reports the count beside the total', () => {
    // The console returned ONE row by id, so a platform escrow balance was roughly 1/16th of the money.
    const rows = [0, 1, 2, 3].map((n) => stripe({ id: `s${n}`, shardNo: n, cachedBalanceMinor: 250n }));
    const [g] = groupStripes(rows);
    expect(g.totalMinor).toBe(1_000n);
    expect(g.stripeCount).toBe(4);
    expect(g.shardNumbers).toEqual([0, 1, 2, 3]);
  });
  it('sums EXACTLY past float precision', () => {
    const rows = [0, 1].map((n) => stripe({ id: `s${n}`, shardNo: n, cachedBalanceMinor: 9_007_199_254_740_993n }));
    expect(groupStripes(rows)[0].totalMinor).toBe(18_014_398_509_481_986n);
  });
  it('groups by (account_code, currency) and orders stably', () => {
    const g = groupStripes([
      stripe({ accountCode: 'fees', shardNo: 0 }),
      stripe({ accountCode: 'escrow', shardNo: 0 }),
      stripe({ accountCode: 'escrow', currencyCode: 'USD', shardNo: 0 }),
    ]);
    expect(g.map((x) => `${x.accountCode}/${x.currencyCode}`)).toEqual(['escrow/INR', 'escrow/USD', 'fees/INR']);
  });
  it('reports a HOLE in the stripe set rather than absorbing it into the sum', () => {
    // A missing stripe row means money landed somewhere this query did not look, and a confident Σ over the rows that
    // do exist would under-report the platform's money with nothing on screen saying so.
    const g = groupStripes([0, 1, 3].map((n) => stripe({ id: `s${n}`, shardNo: n })));
    expect(missingStripes(g[0])).toEqual([2]);
    expect(sumConfidence(g[0], null)).toEqual({ trustworthy: false, reason: 'missing_stripes', missing: [2] });
  });
  it('the range walked is the HIGHEST shard present, not the COUNT of them', () => {
    // A MUTATION TEST CAUGHT THIS. Replacing `shardNumbers[length - 1]` with `length - 1` left the case above passing,
    // because with [0,1,3] both give a range that happens to contain the one hole. The realistic failure is a stripe
    // set that wrote 0, 1 and 15 and stopped: the count says walk 0..2 and finds one gap, the true top says walk 0..15
    // and finds twelve. Deriving a RANGE from a COUNT is only ever correct on a set with no holes — which is the one
    // case this function does not exist for.
    const g = groupStripes([0, 1, 15].map((n) => stripe({ id: `s${n}`, shardNo: n })));
    expect(missingStripes(g[0])).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
  it('reports FEWER stripes than configured when the count is known', () => {
    const g = groupStripes([0, 1].map((n) => stripe({ id: `s${n}`, shardNo: n })));
    expect(sumConfidence(g[0], 16)).toEqual({ trustworthy: false, reason: 'fewer_than_configured', found: 2, configured: 16 });
  });
  it('is TRUSTWORTHY only with no holes, and reports the count it is confident about', () => {
    const g = groupStripes([0, 1].map((n) => stripe({ id: `s${n}`, shardNo: n })));
    expect(sumConfidence(g[0], null)).toEqual({ trustworthy: true, stripeCount: 2 });
    expect(sumConfidence(g[0], 2)).toEqual({ trustworthy: true, stripeCount: 2 });
  });
  it('counts frozen stripes and stripes that have ever been written', () => {
    const g = groupStripes([
      stripe({ id: 'a', shardNo: 0, isFrozen: true }),
      stripe({ id: 'b', shardNo: 1, lastEntryHash: null }),
    ]);
    expect(g[0].frozenStripes).toBe(1);
    expect(g[0].stripesWithHead).toBe(1);
  });
  it('names the eight platform codes W059 lists', () => {
    expect([...PLATFORM_ACCOUNT_CODES]).toEqual(['escrow', 'fees', 'gateway', 'payouts', 'gst_payable', 'tds_payable', 'promo_liability', 'suspense']);
    expect([...OWNER_KINDS]).toEqual(['user', 'tenant', 'platform']);
  });
});

describe('ADMIN-6 · the chain claim W006 and W059 print', () => {
  it('NEVER VERIFIED is the default, and was the true state of every account', () => {
    // Both screens printed "intact" with nothing behind them. The replacement is not a better guess.
    expect(chainClaim(null)).toEqual({ kind: 'never' });
    expect(chainClaim(undefined)).toEqual({ kind: 'never' });
  });
  it('a verification carries its DATE — a tamper claim is worth the last time somebody checked', () => {
    expect(chainClaim({ outcome: 'intact', createdAt: '2026-08-07T10:00:00.000Z', entriesChecked: 40, brokenAtEntryId: null }))
      .toEqual({ kind: 'verified', outcome: 'intact', at: '2026-08-07T10:00:00.000Z', entriesChecked: 40 });
  });
  it('INCOMPLETE is reported as verified-but-incomplete, not as intact', () => {
    const c = chainClaim({ outcome: 'incomplete', createdAt: 'x', entriesChecked: 5, brokenAtEntryId: null });
    expect(c.kind === 'verified' && c.outcome).toBe('incomplete');
  });
  it('BROKEN names the entry', () => {
    expect(chainClaim({ outcome: 'broken', createdAt: 'x', entriesChecked: 3, brokenAtEntryId: '77' }))
      .toEqual({ kind: 'broken', at: 'x', entryId: '77' });
  });
  it('an UNRECOGNISED outcome is never read as verified', () => {
    // The safe direction on a tamper-evidence claim is to say nothing.
    expect(chainClaim({ outcome: 'probably_fine', createdAt: 'x', entriesChecked: 1, brokenAtEntryId: null })).toEqual({ kind: 'never' });
  });
});

describe('ADMIN-6 · money never becomes a JavaScript number', () => {
  it('REFUSES a number outright rather than coercing it', () => {
    expect(() => parseMinor(1_000)).toThrow(InvalidLedgerQueryError);
    expect(() => parseMinor(0)).toThrow(InvalidLedgerQueryError);
  });
  it('and the number branch EXPLAINS ITSELF — the message is the point of having it', () => {
    // A MUTATION TEST CAUGHT THIS TOO, and it is the subtler of the pair. Deleting the number branch entirely still
    // threw, because a number is not a string and the next check catches it — so asserting only the error TYPE proved
    // nothing about a branch whose entire purpose is the sentence it produces. The generic message ("could not be read
    // as a whole number") sends a developer looking for a formatting bug; this one tells them why a number can never
    // be right here.
    expect(() => parseMinor(1_000)).toThrow(/JavaScript number/);
    expect(() => parseMinor(1_000)).toThrow(/precision/);
    // …and a non-number still gets the generic one, so the two branches stay distinguishable.
    expect(() => parseMinor('12.50')).toThrow(/whole number of minor units/);
  });
  it('accepts a string of minor units and a bigint, exactly', () => {
    expect(parseMinor('9007199254740993')).toBe(9_007_199_254_740_993n);
    expect(parseMinor('-1245000')).toBe(-1_245_000n);
    expect(parseMinor(42n)).toBe(42n);
  });
  it('refuses decimals, junk and absurd lengths', () => {
    expect(() => parseMinor('12.50')).toThrow(InvalidLedgerQueryError);
    expect(() => parseMinor('1,000')).toThrow(InvalidLedgerQueryError);
    expect(() => parseMinor('')).toThrow(InvalidLedgerQueryError);
    expect(() => parseMinor(null)).toThrow(InvalidLedgerQueryError);
    expect(() => parseMinor('1'.repeat(20))).toThrow(InvalidLedgerQueryError);
  });
  it('formats en-IN, which is the grouping this platform reads', () => {
    expect(formatMinor(864_124_800n)).toBe('₹86,41,248.00');
    expect(formatMinor(-1_245_000n)).toBe('−₹12,450.00');
    expect(formatMinor(5n)).toBe('₹0.05');
    expect(formatMinor(9_007_199_254_740_993n)).toBe('₹9,00,71,99,25,47,409.93');
  });
});
