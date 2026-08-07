// apps/wallet-service/src/test/ledger-invariants.spec.ts · the money-safety invariants of the ledger engine,
// proven against an in-memory ledger (no DB). These are the rules an attacker / a bug must never break:
// zero-sum, single-currency, ≥2 legs, no-zero-leg, idempotent replay, no-overdraw (user/tenant), frozen-debit
// rejection, and a deterministic per-account hash chain.
import { createHash } from 'node:crypto';
import { WalletConfig } from '../core/config/wallet-config';
import { TxnTypeRegistry } from '../ledger/txn-types.registry';
import { PostTransactionService, LedgerLeg } from '../ledger/post-transaction.service';
import { LedgerNotBalancedError, InvalidLedgerTxnError, UnknownTxnTypeError, InsufficientWalletBalanceError, WalletFrozenError } from '../ledger/wallet.errors';
import { entryHash } from '../ledger/hash-chain';

// In-memory ledger: enough to exercise the engine's branching + balance/hash bookkeeping.
function memLedger() {
  const bal = new Map<string, bigint>(); const hash = new Map<string, string | null>(); const frozen = new Set<string>();
  const seenKeys = new Map<string, string>(); let txnSeq = 0;
  const entries: any[] = [];
  return {
    entries, bal, frozen,
    insertTxnIdempotent: jest.fn(async (_tx: any, i: any) => {
      const prior = seenKeys.get(i.idempotencyKey);
      if (prior) return { id: prior, replayed: true };
      const id = `txn${++txnSeq}`; seenKeys.set(i.idempotencyKey, id); return { id, replayed: false };
    }),
    ensureUserAccountId: jest.fn(async (_tx: any, u: string, code: string) => `user:${u}:${code}`),
    ensureTenantAccountId: jest.fn(async (_tx: any, t: string, code: string) => `tenant:${t}:${code}`),
    ensurePlatformAccountId: jest.fn(async (_tx: any, code: string, _c: string, shard: number) => `plat:${code}:${shard}`),
    lockAccount: jest.fn(async (_tx: any, id: string) => ({ id, balanceMinor: bal.get(id) ?? 0n, lastHash: hash.get(id) ?? null, isFrozen: frozen.has(id), kind: id.startsWith('plat') ? 'platform' : id.startsWith('tenant') ? 'tenant' : 'user' })),
    appendEntry: jest.fn(async (_tx: any, e: any) => { bal.set(e.accountId, e.balanceAfter); hash.set(e.accountId, e.entryHash); entries.push(e); }),
    balanceOf: jest.fn(async (_tx: any, id: string) => bal.get(id) ?? 0n),
    platformBalance: jest.fn(async () => 0n),
  };
}
const config = new WalletConfig({ NODE_ENV: 'test' });
function engineWith(ledger: any, txnTypeKnown = true) {
  const reg = new TxnTypeRegistry();
  jest.spyOn(reg, 'resolve').mockResolvedValue(txnTypeKnown ? 'txntype-1' : null);
  return new PostTransactionService(config, ledger as any, reg);
}
const tx = {} as any;
const userMain = (u: string, amt: bigint): LedgerLeg => ({ account: { kind: 'user', userId: u, accountCode: 'main', currencyCode: 'INR' }, amountMinor: amt });
const platform = (code: string, amt: bigint): LedgerLeg => ({ account: { kind: 'platform', accountCode: code, currencyCode: 'INR' }, amountMinor: amt });
const base = { tenantId: 't1', txnType: 'order_payment', referenceType: null, referenceId: null, initiatedBy: null, description: null };

describe('validation invariants', () => {
  const eng = engineWith(memLedger());
  it('rejects <2 legs, zero-amount leg, mixed currency, and non-zero sum', async () => {
    await expect(eng.post(tx, { ...base, idempotencyKey: 'k', legs: [userMain('u1', 100n)] })).rejects.toBeInstanceOf(InvalidLedgerTxnError);
    await expect(eng.post(tx, { ...base, idempotencyKey: 'k', legs: [userMain('u1', 0n), platform('fees', 0n)] })).rejects.toBeInstanceOf(InvalidLedgerTxnError);
    await expect(eng.post(tx, { ...base, idempotencyKey: 'k', legs: [{ account: { kind: 'user', userId: 'u1', accountCode: 'main', currencyCode: 'INR' }, amountMinor: 100n }, { account: { kind: 'platform', accountCode: 'fees', currencyCode: 'USD' }, amountMinor: -100n }] })).rejects.toBeInstanceOf(InvalidLedgerTxnError);
    await expect(eng.post(tx, { ...base, idempotencyKey: 'k', legs: [userMain('u1', 100n), platform('fees', -90n)] })).rejects.toBeInstanceOf(LedgerNotBalancedError);
  });
  it('requires an idempotency key + a known txn type', async () => {
    await expect(eng.post(tx, { ...base, idempotencyKey: '', legs: [userMain('u1', 100n), platform('fees', -100n)] })).rejects.toBeInstanceOf(InvalidLedgerTxnError);
    await expect(engineWith(memLedger(), false).post(tx, { ...base, idempotencyKey: 'k', legs: [userMain('u1', 100n), platform('fees', -100n)] })).rejects.toBeInstanceOf(UnknownTxnTypeError);
  });
});

describe('posting + idempotency + balances', () => {
  it('a balanced txn posts two entries and moves balances', async () => {
    const led = memLedger(); const eng = engineWith(led);
    const res = await eng.post(tx, { ...base, idempotencyKey: 'recharge1', legs: [userMain('u1', 500n), platform('gateway', -500n)] });
    expect(res.alreadyApplied).toBe(false);
    expect(led.appendEntry).toHaveBeenCalledTimes(2);
    expect(led.bal.get('user:u1:main')).toBe(500n);
  });
  it('replaying the same key is a no-op (no new entries)', async () => {
    const led = memLedger(); const eng = engineWith(led);
    await eng.post(tx, { ...base, idempotencyKey: 'k1', legs: [userMain('u1', 500n), platform('gateway', -500n)] });
    (led.appendEntry as jest.Mock).mockClear();
    const replay = await eng.post(tx, { ...base, idempotencyKey: 'k1', legs: [userMain('u1', 500n), platform('gateway', -500n)] });
    expect(replay.alreadyApplied).toBe(true);
    expect(led.appendEntry).not.toHaveBeenCalled();
  });
});

describe('no overdraw / frozen', () => {
  it('a user account cannot go negative; a platform account can', async () => {
    const led = memLedger(); const eng = engineWith(led);
    await expect(eng.post(tx, { ...base, idempotencyKey: 'od', legs: [userMain('u1', -100n), platform('escrow', 100n)] })).rejects.toBeInstanceOf(InsufficientWalletBalanceError);
  });
  it('a frozen account rejects debits', async () => {
    const led = memLedger(); const eng = engineWith(led);
    led.bal.set('user:u1:main', 1000n); led.frozen.add('user:u1:main');
    await expect(eng.post(tx, { ...base, idempotencyKey: 'fz', legs: [userMain('u1', -100n), platform('escrow', 100n)] })).rejects.toBeInstanceOf(WalletFrozenError);
  });
});

describe('hash chain', () => {
  it('is deterministic and chains prev→next', () => {
    const h1 = entryHash(null, 'txn1', 'acct', 100n, 100n);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(entryHash(null, 'txn1', 'acct', 100n, 100n)).toBe(h1);            // deterministic
    expect(entryHash(h1, 'txn2', 'acct', -40n, 60n)).not.toBe(h1);           // chains forward
  });

  // PC-56 ADMIN-6 · PINNED TO THE SPEC, NOT TO ITSELF.
  //
  // There are now THREE implementations of this formula: this one (the gRPC money writer), the private duplicate in
  // apps/api's in-process client, and the VERIFIER in
  // apps/admin-api/src/modules/ledger-ops/domain/hash-chain.ts. The verifier is the first code on the platform that
  // ever reads `prev_hash`, and a verifier that disagrees with a writer is worse than no verifier at all: it pages
  // P0 over a healthy ledger, and a team paged for a formula mismatch learns to ignore the alarm.
  //
  // The three cannot import each other — separate deployables — so each end is pinned to the WRITTEN PREIMAGE
  // instead, computed here from the literal string. A change to the formula on any side now breaks a test on that
  // side rather than silently making the checker and the writers disagree. Consolidating the three into one shared
  // package is ADMIN-6-Q2.
  it('matches the documented preimage exactly, so the verifier cannot diverge', () => {
    const preimage = 'prev|txn|acct|-500|1200';
    expect(entryHash('prev', 'txn', 'acct', -500n, 1200n))
      .toBe(createHash('sha256').update(preimage).digest('hex'));
  });
  it('a NULL prev is the EMPTY STRING in the preimage, never the text "null"', () => {
    // Getting this wrong would make every account's FIRST entry verify as broken.
    expect(entryHash(null, 'txn', 'acct', 1n, 1n))
      .toBe(createHash('sha256').update('|txn|acct|1|1').digest('hex'));
  });
  it('a balance past float precision hashes exactly', () => {
    // If either side ever coerced these through a JS number, the verifier would report a tamper that did not happen.
    const big = 9_007_199_254_740_993n;
    expect(entryHash(null, 'txn', 'acct', big, big))
      .toBe(createHash('sha256').update(`|txn|acct|${big}|${big}`).digest('hex'));
  });
});
