// modules/payments/__tests__/tenant9c-auditor-ledger.spec.ts · PC-56 TENANT-9c (F-10) · WHAT THE AUDITOR'S LEDGER MAY SAY,
// and THE FUNNEL pinned against the read model's own SQL (TENANT-4a's discipline: a ledger with no RLS is isolated by its
// queries and nothing else, so the queries are what the test reads).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { entryHash } from '../../../core/wallet/hash-chain';
import { balanceEqualsSum, footOf, hashLinkOf, integrityOf, legKind, viewLegs, type RawLeg } from '../domain/auditor-ledger';

const T = '01a0c000-0000-7000-8000-00000000000a';
const OTHER = '01a0c000-0000-7000-8000-00000000000b';
const ACC = '01a0c000-0000-7000-8000-0000000a0001';

function leg(over: Partial<RawLeg> = {}): RawLeg {
  const base = { entryId: '1', txnId: '01a0c000-0000-7000-8000-00000000f001', accountId: ACC, accountCode: 'main', ownerKind: 'tenant', ownerTenantId: T, ownerUserId: null, amountMinor: '-500', currencyCode: 'INR', balanceAfterMinor: '1500', prevHash: null as string | null, entryHash: '', createdAt: '2026-07-01T00:00:00.000Z', predecessorHash: null as string | null };
  const l = { ...base, ...over };
  if (!over.entryHash) l.entryHash = entryHash(l.prevHash, l.txnId, l.accountId, BigInt(l.amountMinor), BigInt(l.balanceAfterMinor));
  return l;
}

describe('F-10 · whose account a leg sits on decides what it may say', () => {
  it('from the account row only', () => {
    expect(legKind('tenant', T, T)).toBe('tenant_own');
    expect(legKind('tenant', OTHER, T)).toBe('other_tenant');
    expect(legKind('tenant', null, T)).toBe('other_tenant');
    expect(legKind('platform', null, T)).toBe('platform');
    expect(legKind('user', null, T)).toBe('member_wallet');
  });
  it('a tenant-own leg is LINKED when its hash recomputes and its prev is its predecessor (genesis says so)', () => {
    expect(hashLinkOf(leg(), 'tenant_own')).toMatchObject({ kind: 'linked', genesis: true });
    const prev = 'a'.repeat(64);
    expect(hashLinkOf(leg({ prevHash: prev, predecessorHash: prev }), 'tenant_own')).toMatchObject({ kind: 'linked', genesis: false, prevHash: prev });
  });
  it('AN EDITED AMOUNT IS A hash_mismatch; A REMOVED/INSERTED ENTRY IS A chain_break — two different investigations', () => {
    const good = leg();
    expect(hashLinkOf({ ...good, amountMinor: '-501' }, 'tenant_own').kind).toBe('hash_mismatch');
    expect(hashLinkOf({ ...good, balanceAfterMinor: '1501' }, 'tenant_own').kind).toBe('hash_mismatch');
    expect(hashLinkOf(leg({ prevHash: 'b'.repeat(64), predecessorHash: 'c'.repeat(64) }), 'tenant_own').kind).toBe('chain_break');
    expect(hashLinkOf(leg({ prevHash: null, predecessorHash: 'c'.repeat(64) }), 'tenant_own').kind).toBe('chain_break');
    expect(hashLinkOf(leg({ prevHash: 'b'.repeat(64), predecessorHash: null }), 'tenant_own').kind).toBe('chain_break');
  });
  it('A PLATFORM LEG\'S LINK IS WITHHELD BY NAME — never judged, never a tick (ADMIN-6: shared, striped)', () => {
    const p = leg({ ownerKind: 'platform', ownerTenantId: null, accountCode: 'escrow' });
    expect(hashLinkOf(p, 'platform')).toEqual({ kind: 'withheld', reason: 'shared_stripe' });
    expect(hashLinkOf(leg({ ownerKind: 'user', ownerTenantId: null }), 'member_wallet')).toEqual({ kind: 'withheld', reason: 'member_wallet' });
    expect(hashLinkOf(leg({ ownerTenantId: OTHER }), 'other_tenant')).toEqual({ kind: 'withheld', reason: 'other_tenant' });
    // even a leg whose hash WOULD recompute is not judged when it is not the tenant's to judge
    expect(hashLinkOf(leg(), 'platform').kind).toBe('withheld');
  });
});

describe('F-10 · the legs as W436 draws them', () => {
  const txn = '01a0c000-0000-7000-8000-00000000f002';
  const legs = [
    leg({ txnId: txn, entryId: '10', ownerKind: 'platform', ownerTenantId: null, accountCode: 'escrow', amountMinor: '-4466000', balanceAfterMinor: '999' }),
    leg({ txnId: txn, entryId: '11', ownerKind: 'platform', ownerTenantId: null, accountCode: 'fees', amountMinor: '134000', balanceAfterMinor: '5' }),
    leg({ txnId: txn, entryId: '12', ownerKind: 'user', ownerTenantId: null, accountId: '01a0c000-0000-7000-8000-00000000beef', accountCode: 'wallet', amountMinor: '4332000', balanceAfterMinor: '777' }),
  ];
  it('running balance, Dr/Cr by sign, masked member wallet, no balance on a shared or member account', () => {
    const v = viewLegs(legs, T);
    expect(v.map((l) => [l.n, l.side, l.amountMinor, l.runningMinor])).toEqual([[1, 'Dr', '-4466000', '-4466000'], [2, 'Cr', '134000', '-4332000'], [3, 'Cr', '4332000', '0']]);
    expect(v.map((l) => l.balanceAfterMinor)).toEqual([null, null, null]);
    expect(v[2].accountLabel).toBe('member ··beef');
    expect(v[2].accountLabel).not.toMatch(/Ramesh|wallet_accounts/);
    expect(viewLegs([leg()], T)[0].balanceAfterMinor).toBe('1500');
    expect(viewLegs([leg({ amountMinor: '0', balanceAfterMinor: '2000' })], T)[0].side).toBe('zero');
    expect(viewLegs([leg({ ownerTenantId: OTHER })], T)[0]).toMatchObject({ accountCode: 'other_tenant', accountLabel: 'withheld', balanceAfterMinor: null });
  });
  it('Σ = 0 only when EVERY leg is visible; a one-legged or partly-hidden transaction is incomplete, not "foots"', () => {
    expect(footOf(['-4466000', '134000', '4332000'], 3)).toEqual({ sumMinor: '0', foots: true, legsVisible: 3, legsTotal: 3, complete: true, terms: ['-4466000', '134000', '4332000'] });
    expect(footOf(['-4466000', '134000'], 3)).toMatchObject({ foots: false, complete: false });
    expect(footOf(['-5', '4'], 2)).toMatchObject({ sumMinor: '-1', foots: false, complete: true });
    expect(footOf(['0'], 1)).toMatchObject({ foots: false, complete: false });
    expect(footOf(['9007199254740993', '-9007199254740993'], 2)).toMatchObject({ sumMinor: '0', foots: true });   // bigint, never float
  });
  it('the integrity verdict counts what was checked and what was withheld — separately', () => {
    const own = viewLegs([leg(), leg({ entryId: '2', amountMinor: '-1', balanceAfterMinor: '1', prevHash: 'x'.repeat(64), predecessorHash: 'y'.repeat(64) })], T);
    const shared = viewLegs(legs, T);
    const v = integrityOf([{ foot: footOf(['0'], 1), legs: own }, { foot: footOf(['-4466000', '134000', '4332000'], 3), legs: shared }, { foot: footOf(['-1', '2'], 2), legs: [] }]);
    expect(v).toEqual({ zeroSum: { checked: 3, foot: 1, notFoot: 1, incomplete: 1 }, ownLinks: { checked: 2, linked: 1, broken: 1 }, withheld: { sharedStripe: 2, memberWallet: 1, otherTenant: 0 } });
    expect(integrityOf([{ foot: footOf(['1', '-1'], 2), legs: viewLegs([leg({ ownerTenantId: OTHER })], T) }]).withheld.otherTenant).toBe(1);
  });
  it('balance = Σ, with the drift as a number', () => {
    expect(balanceEqualsSum('1500', '1500')).toEqual({ equal: true, driftMinor: '0' });
    expect(balanceEqualsSum('1500', '1400')).toEqual({ equal: false, driftMinor: '100' });
  });
});

describe('F-10 · THE FUNNEL, read from its own SQL', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'read-models', 'auditor-ledger.read-model.ts'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const sqls = [...code.matchAll(/`(\s*(?:SELECT|WITH)[\s\S]*?)`/g)].map((m) => m[1]);
  it('every query is bound to the caller\'s tenant ($1), and a ledger_transactions read is bound by t.tenant_id = $1', () => {
    expect(sqls.length).toBeGreaterThanOrEqual(7);
    for (const q of sqls) expect(/\$1\b/.test(q)).toBe(true);
    for (const q of sqls.filter((x) => /FROM ledger_transactions t/.test(x))) expect(q).toMatch(/t\.tenant_id = \$1/);
  });
  it('a leg is read only when it carries the tenant\'s id (e.tenant_id = $1) — the legs query and the zero-sum', () => {
    const legsQ = sqls.find((q) => /predecessor_hash/.test(q))!;
    expect(legsQ).toMatch(/WHERE e\.tenant_id = \$1 AND e\.txn_id = ANY/);
    const zs = sqls.find((q) => /WITH txn AS/.test(q))!;
    expect(zs).toMatch(/FILTER \(WHERE e\.tenant_id = \$1\)/);
  });
  it('the predecessor (and so the hash link) is read ONLY for an account the tenant owns — guarded IN SQL', () => {
    expect(code).toMatch(/CASE WHEN a\.owner_kind = 'tenant' AND a\.owner_tenant_id = \$1 THEN \(\s*SELECT p\.entry_hash FROM ledger_entries p/);
  });
  it('the chain walk and the balance check touch tenant-owned accounts only; no method reads a platform account', () => {
    expect(code).toMatch(/WHERE a\.owner_kind = 'tenant' AND a\.owner_tenant_id = \$1 AND a\.currency_code = \$2/);
    expect(code).toMatch(/JOIN wallet_accounts a ON a\.id = e\.account_id AND a\.owner_kind = 'tenant' AND a\.owner_tenant_id = \$1\s+WHERE e\.account_id = \$2/);
    expect(code).toMatch(/private async walkOwn\(/);
    expect(code).not.toMatch(/owner_kind = 'platform'/);
    expect(code).not.toMatch(/last_entry_hash[\s\S]{0,80}platform/);
  });
  it('no public method takes an account id, account code, owner id or "viewAs"', () => {
    const publics = [...code.matchAll(/^\s{2}(?:async \*?)?(\w+)\(([^)]*)\)/gm)].filter((m) => !/private/.test(m[0]));
    for (const m of publics) expect(m[2]).not.toMatch(/accountId|accountCode|ownerTenantId|ownerUserId|viewAs/);
    expect(code).toMatch(/async page\(tenantId: string, win: AuditorWindow/);
    expect(code).toMatch(/async ownAccounts\(tenantId: string, currencyCode: string\)/);
  });
  it('read-only, keyset (no OFFSET), partition-key bounded entry reads (Law 8)', () => {
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    for (const q of sqls) expect(q).not.toMatch(/\bOFFSET\b/i);
    expect(code).toMatch(/const ENTRY_PRUNE = `e\.created_at >= /);
    expect((code.match(/\$\{ENTRY_PRUNE\}/g) ?? []).length).toBe(2);
    expect(code).toMatch(/decodeKeyset\(opts\.cursor, UUID_RE\)/);
  });
  it('the hash is the ONE formula (core/wallet/hash-chain) — the domain imports it and defines no copy', () => {
    const dom = fs.readFileSync(path.join(__dirname, '..', 'domain', 'auditor-ledger.ts'), 'utf8');
    expect(dom).toMatch(/import \{ entryHash \} from '\.\.\/\.\.\/\.\.\/core\/wallet\/hash-chain'/);
    expect(dom).not.toMatch(/createHash/);
  });
});
