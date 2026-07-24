// core/wallet/__tests__/wallet.spec.ts · the money invariants of the in-process wallet client.
// Uses a fake LedgerRepository (in-memory accounts) — pure logic, no DB. The real-Postgres
// zero-sum + RLS proof lives in the payments integration test.
import { InProcessWalletClient } from '../wallet.client.inprocess';
import { LedgerNotBalancedError, InvalidLedgerTxnError, InsufficientWalletBalanceError, WalletFrozenError } from '../wallet.errors';
import { userMain, platform } from '../account-codes';

function fakeLedger() {
  const accounts = new Map<string, { id: string; bal: bigint; frozen: boolean; kind: string; lastHash: string | null }>();
  const txns = new Map<string, string>();   // idempotencyKey → txnId
  let seq = 0;
  const keyOf = (a: any) => `${a.kind}:${a.userId ?? a.tenantId ?? 'platform'}:${a.accountCode}:${a.currencyCode ?? 'INR'}`;
  return {
    accounts, txns,
    async txnTypeId() { return 'tt-1'; },
    async ensureAccountId(_tx: any, a: any) {
      const k = keyOf(a);
      if (!accounts.has(k)) accounts.set(k, { id: 'acc' + ++seq, bal: 0n, frozen: !!a._frozen, kind: a.kind, lastHash: null });
      return accounts.get(k)!.id;
    },
    async lockAccount(_tx: any, id: string) {
      const row = [...accounts.values()].find((x) => x.id === id)!;
      return { id, balanceMinor: row.bal, version: '0', lastHash: row.lastHash, isFrozen: row.frozen, kind: row.kind };
    },
    async insertTxnIdempotent(_tx: any, i: any) {
      if (txns.has(i.idempotencyKey)) return { id: txns.get(i.idempotencyKey)!, replayed: true };
      const id = 'txn' + ++seq; txns.set(i.idempotencyKey, id); return { id, replayed: false };
    },
    async appendEntry(_tx: any, e: any) {
      const row = [...accounts.values()].find((x) => x.id === e.accountId)!;
      row.bal = e.balanceAfter; row.lastHash = e.entryHash;
    },
    async balanceOf(_tx: any, id: string) { return [...accounts.values()].find((x) => x.id === id)!.bal; },
    // helper to preset state
    seed(a: any, bal: bigint, frozen = false) { accounts.set(keyOf(a), { id: 'acc' + ++seq, bal, frozen, kind: a.kind, lastHash: null }); },
  } as any;
}

// [DEV-02 2026-07-23] test-debt fix, BR-3 (DEV-01 P0 escalation, founder-authorized test-only repair):
// this fixture predates migration 0065 / wallet.client.inprocess.ts's SET LOCAL ROLE kv_wallet …
// RESET ROLE wrapper (see wallet.client.inprocess.ts:42,66,73,78), which calls tx.query() around
// every money-write and every balance read. `{} as any` had no .query(), so all 4 tests below that
// reach a real post() (balanced-txn, idempotent-replay, overdraw-refusal, frozen-account-refusal)
// failed with "tx.query is not a function" — test debt, not a money-logic regression (DEV-01
// diagnosis, DEV-01_BASELINE.md §7). The 2 tests that throw during validate() before tx.query is
// ever reached (unbalanced-legs, single-leg) were unaffected either way. No production code touched.
const tx = { query: async () => ({ rows: [], rowCount: 0 }) } as any;
const buyer = 'u-buyer';

describe('InProcessWalletClient — money invariants', () => {
  it('rejects unbalanced legs (would create/destroy money)', async () => {
    const w = new InProcessWalletClient(fakeLedger());
    await expect(w.post(tx, { tenantId: 't1', txnType: 'order_payment', idempotencyKey: 'k1',
      legs: [{ account: platform('escrow'), amountMinor: 100n }, { account: userMain(buyer), amountMinor: -90n }] }))
      .rejects.toBeInstanceOf(LedgerNotBalancedError);
  });

  it('rejects a single-leg or zero-amount transaction', async () => {
    const w = new InProcessWalletClient(fakeLedger());
    await expect(w.post(tx, { tenantId: 't1', txnType: 'order_payment', idempotencyKey: 'k', legs: [{ account: platform('escrow'), amountMinor: 100n }] }))
      .rejects.toBeInstanceOf(InvalidLedgerTxnError);
    await expect(w.post(tx, { tenantId: 't1', txnType: 'order_payment', idempotencyKey: 'k', legs: [{ account: platform('escrow'), amountMinor: 0n }, { account: userMain(buyer), amountMinor: 0n }] }))
      .rejects.toBeInstanceOf(InvalidLedgerTxnError);
  });

  it('posts a balanced txn and moves the balances (zero-sum)', async () => {
    const ledger = fakeLedger();
    const w = new InProcessWalletClient(ledger);
    // money-in: external funds arrive via the gateway (platform, may run negative) → escrow
    const r = await w.post(tx, { tenantId: 't1', txnType: 'order_payment', idempotencyKey: 'k2',
      legs: [{ account: platform('escrow'), amountMinor: 150000n }, { account: platform('gateway'), amountMinor: -150000n }] });
    expect(r.alreadyApplied).toBe(false);
    const bals = [...ledger.accounts.values()].map((a: any) => a.bal);
    expect(bals.reduce((s: bigint, b: bigint) => s + b, 0n)).toBe(0n);   // money conserved
  });

  it('is idempotent — replaying the key does not double-post', async () => {
    const ledger = fakeLedger();
    const w = new InProcessWalletClient(ledger);
    const legs = [{ account: platform('escrow'), amountMinor: 100n }, { account: platform('gateway'), amountMinor: -100n }];
    const a = await w.post(tx, { tenantId: 't1', txnType: 'order_payment', idempotencyKey: 'dup', legs });
    const b = await w.post(tx, { tenantId: 't1', txnType: 'order_payment', idempotencyKey: 'dup', legs });
    expect(a.alreadyApplied).toBe(false);
    expect(b.alreadyApplied).toBe(true);
    expect(b.txnId).toBe(a.txnId);
  });

  it('refuses to overdraw a user account', async () => {
    const ledger = fakeLedger();
    ledger.seed(userMain(buyer), 50n);                  // only ₹0.50
    const w = new InProcessWalletClient(ledger);
    await expect(w.post(tx, { tenantId: 't1', txnType: 'order_payment', idempotencyKey: 'k3',
      legs: [{ account: userMain(buyer), amountMinor: -100n }, { account: platform('escrow'), amountMinor: 100n }] }))
      .rejects.toBeInstanceOf(InsufficientWalletBalanceError);
  });

  it('refuses to debit a frozen account', async () => {
    const ledger = fakeLedger();
    ledger.seed(userMain(buyer), 100000n, true);        // frozen
    const w = new InProcessWalletClient(ledger);
    await expect(w.post(tx, { tenantId: 't1', txnType: 'order_payment', idempotencyKey: 'k4',
      legs: [{ account: userMain(buyer), amountMinor: -100n }, { account: platform('escrow'), amountMinor: 100n }] }))
      .rejects.toBeInstanceOf(WalletFrozenError);
  });
});
