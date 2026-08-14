// PC-56 TENANT-4a · W143/W144 — the tenant's own wallet. The rules that decide what a money screen is
// ALLOWED to say, plus the isolation funnel pinned against the read-model's own SQL and 0142's own text.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  TENANT_ACCOUNT_CODES, TENANT_ACCOUNT_WRITERS, isTenantAccountCode, holdBasis, balanceVerdict,
  healthLines, escrowView, resolveLedgerWindow, entryDirection, LEDGER_IS_APPEND_ONLY,
  ORG_WALLET_GAPS, isNamedGap, LEDGER_WINDOW_MAX_DAYS, type AccountTruth,
} from '../domain/org-wallet';
import { entryHash, verifyChain, headMatches, type ChainEntry } from '../../../core/wallet/hash-chain';

const acct = (over: Partial<AccountTruth> = {}): AccountTruth => ({
  code: 'main', exists: true, cachedMinor: '100', ledgerSumMinor: '100', isFrozen: false, lastEntryHash: 'h1', ...over,
});

describe('TENANT-4a · the three accounts, and what each figure is allowed to be', () => {
  it('the chart of accounts is exactly the three the canon names', () => {
    expect([...TENANT_ACCOUNT_CODES]).toEqual(['main', 'commission', 'hold']);
    expect(isTenantAccountCode('commission')).toBe(true);
    expect(isTenantAccountCode('escrow')).toBe(false);      // a PLATFORM account is not the tenant's
    expect(isTenantAccountCode(undefined)).toBe(false);
  });

  it('THE FIGURE SHOWN IS THE LEDGER SUM, NEVER THE CACHE — and drift is stated, not hidden', () => {
    expect(balanceVerdict(acct())).toEqual({ kind: 'reconciled', minor: '100' });
    const drifted = balanceVerdict(acct({ cachedMinor: '9900', ledgerSumMinor: '100' }));
    expect(drifted.kind).toBe('drifted');
    // The figure is the BOOK's, and the difference is reported so nobody has to reconstruct it later.
    expect(drifted).toEqual({ kind: 'drifted', minor: '100', cachedMinor: '9900', driftMinor: '9800' });
  });

  it('an account that has never been used is never_used, not a zero that means "unknown"', () => {
    expect(balanceVerdict(acct({ exists: false }))).toEqual({ kind: 'never_used', minor: '0' });
    // ...and a used account that nets to zero is a DIFFERENT statement.
    expect(balanceVerdict(acct({ cachedMinor: '0', ledgerSumMinor: '0' }))).toEqual({ kind: 'reconciled', minor: '0' });
  });

  it('THE HOLD ACCOUNT HAS NO WRITER, AND THE REGISTRY SAYS SO RATHER THAN THE SCREEN GUESSING', () => {
    expect(TENANT_ACCOUNT_WRITERS.hold).toEqual([]);
    expect(TENANT_ACCOUNT_WRITERS.commission).toContain('orders.completed');
    expect(TENANT_ACCOUNT_WRITERS.main).toContain('dairy.milk_bill');
    expect(holdBasis('0')).toBe('no_freeze_path');
    // If somebody later builds a freeze path and forgets this registry, a non-zero balance still tells
    // the truth — the basis is derived from the money as well as from the list.
    expect(holdBasis('12820')).toBe('frozen_by_ledger');
  });
});

describe('TENANT-4a · ledger health says only what a TENANT can assert about its own book', () => {
  const chainOk = { kind: 'intact', checked: 12, lastHash: 'h9' } as const;

  it('platform-wide reconciliation is reported as not_ours_to_assert — never as a tick', () => {
    const lines = healthLines([acct()], chainOk, true);
    expect(lines.map((l) => l.check)).toEqual(['cached_vs_ledger', 'own_chain', 'platform_recon']);
    expect(lines[2]).toEqual({ check: 'platform_recon', state: 'not_ours_to_assert' });
    expect(lines[2].state).not.toBe('ok');
  });

  it('cached-vs-ledger is ok only when every used account agrees', () => {
    expect(healthLines([acct(), acct({ code: 'commission' })], chainOk, true)[0]).toEqual({ check: 'cached_vs_ledger', state: 'ok', detail: '2' });
    expect(healthLines([acct({ cachedMinor: '5' })], chainOk, true)[0]).toEqual({ check: 'cached_vs_ledger', state: 'attention', detail: '1' });
    expect(healthLines([acct({ exists: false })], chainOk, true)[0]).toEqual({ check: 'cached_vs_ledger', state: 'unverifiable', detail: 'no_accounts_yet' });
  });

  it('AN UNCHECKED CHAIN IS NEVER REPORTED AS INTACT', () => {
    expect(healthLines([acct()], null, null)[1].state).toBe('unverifiable');
    expect(healthLines([acct()], { kind: 'empty' }, null)[1]).toEqual({ check: 'own_chain', state: 'unverifiable', detail: 'no_entries' });
    expect(healthLines([acct()], { kind: 'incomplete', checked: 0, reason: 'window_opened_mid_chain' }, null)[1].state).toBe('unverifiable');
    expect(healthLines([acct()], { kind: 'hash_mismatch', checked: 3, atEntryId: '9' }, null)[1]).toEqual({ check: 'own_chain', state: 'attention', detail: 'hash_mismatch' });
  });

  it('a clean walk whose HEAD POINTER disagrees is attention — the truncation attack', () => {
    expect(healthLines([acct()], chainOk, false)[1]).toEqual({ check: 'own_chain', state: 'attention', detail: 'head_mismatch' });
    expect(healthLines([acct()], chainOk, true)[1]).toEqual({ check: 'own_chain', state: 'ok', detail: '12' });
  });
});

describe('TENANT-4a · the verifier computes the hash with THE WRITER\'S OWN FUNCTION', () => {
  // If this import ever stops resolving to the same function the writer uses, this file is the alarm.
  const writerSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'core', 'wallet', 'wallet.client.inprocess.ts'), 'utf8');
  it('the writer imports entryHash from core/wallet/hash-chain and defines no copy of its own', () => {
    expect(writerSrc).toContain("import { entryHash } from './hash-chain'");
    expect(writerSrc).not.toMatch(/function entryHash\s*\(/);
    expect(writerSrc).not.toContain("createHash('sha256')");
  });

  const chain = (n: number): ChainEntry[] => {
    const out: ChainEntry[] = [];
    let prev: string | null = null;
    let bal = 0n;
    for (let i = 0; i < n; i += 1) {
      const amt = 1000n * BigInt(i + 1);
      bal += amt;
      const h = entryHash(prev, `txn-${i}`, 'acct-1', amt, bal);
      out.push({ id: String(i + 1), txnId: `txn-${i}`, accountId: 'acct-1', amountMinor: amt.toString(), balanceAfterMinor: bal.toString(), prevHash: prev, entryHash: h, createdAt: `2026-08-0${(i % 9) + 1}T00:00:00.000Z` });
      prev = h;
    }
    return out;
  };

  it('a genesis-anchored chain verifies, and its head is the last entry hash', () => {
    const c = chain(4);
    const v = verifyChain(c);
    expect(v).toEqual({ kind: 'intact', checked: 4, lastHash: c[3].entryHash });
    expect(headMatches(v, c[3].entryHash)).toBe(true);
  });

  it('AN EDITED AMOUNT IS CAUGHT — the whole point of storing the hash', () => {
    const c = chain(4);
    c[2] = { ...c[2], amountMinor: '999999' };
    expect(verifyChain(c).kind).toBe('hash_mismatch');
  });

  it('a deleted middle entry is a chain_break, not a pass', () => {
    const c = chain(4);
    expect(verifyChain([c[0], c[1], c[3]]).kind).toBe('chain_break');
  });

  it('A WALK THAT STARTS MID-CHAIN IS INCOMPLETE, NOT INTACT — unverifiable is its own answer', () => {
    const c = chain(4);
    expect(verifyChain(c.slice(1))).toEqual({ kind: 'incomplete', checked: 0, reason: 'window_opened_mid_chain' });
    // ...unless the caller supplies the anchor it read separately.
    expect(verifyChain(c.slice(1), c[0].entryHash).kind).toBe('intact');
    expect(verifyChain(c.slice(1), 'not-the-anchor').kind).toBe('chain_break');
  });

  it('an empty account is empty, and headMatches refuses to judge a non-intact walk', () => {
    expect(verifyChain([])).toEqual({ kind: 'empty' });
    expect(headMatches({ kind: 'empty' }, 'x')).toBeNull();
  });

  it('a NULL prev hashes as the empty string, never the text "null"', () => {
    expect(entryHash(null, 't', 'a', 1n, 1n)).toBe(entryHash('', 't', 'a', 1n, 1n));
    // and it is NOT the same as chaining off the literal string "null", which is the bug this pins.
    expect(entryHash(null, 't', 'a', 1n, 1n)).not.toBe(entryHash('null', 't', 'a', 1n, 1n));
  });
});

describe('TENANT-4a · escrow is computed, and cannot be shown as money the tenant has', () => {
  it('the net of the tenant\'s escrow legs is what is held, with its basis named', () => {
    expect(escrowView('21460000', 9)).toEqual({ heldMinor: '21460000', orderCount: 9, basis: 'ledger_net_by_tenant' });
  });
  it('A NEGATIVE NET IS NOT HELD MONEY — it clamps and stops claiming orders', () => {
    expect(escrowView('-500', 3)).toEqual({ heldMinor: '0', orderCount: 0, basis: 'ledger_net_by_tenant' });
    expect(escrowView('0', 4)).toEqual({ heldMinor: '0', orderCount: 0, basis: 'ledger_net_by_tenant' });
  });
});

describe('TENANT-4a · the ledger window is bounded on the server, not just defaulted in the UI', () => {
  const now = new Date('2026-08-12T18:00:00Z');
  it('no dates means the last 30 days, as W144 says', () => {
    const w = resolveLedgerWindow(undefined, undefined, now);
    expect(w.days).toBe(30);
    expect(w.clamped).toBe(false);
    expect(w.toIso).toBe('2026-08-12T18:00:00.000Z');
  });
  it('a decade is CLAMPED and the clamp is reported, because a partitioned ledger will answer it', () => {
    const w = resolveLedgerWindow('2016-01-01', '2026-08-12', now);
    expect(w.clamped).toBe(true);
    expect(w.days).toBe(LEDGER_WINDOW_MAX_DAYS);
  });
  it('a junk date falls back rather than throwing at a money screen', () => {
    expect(resolveLedgerWindow('yesterday', undefined, now).days).toBe(30);
  });
});

describe('TENANT-4a · direction, append-only, and the gaps named in one vocabulary', () => {
  it('the sign decides the word, and zero is its own case', () => {
    expect(entryDirection('638')).toBe('credit');
    expect(entryDirection('-44660')).toBe('debit');
    expect(entryDirection('0')).toBe('zero');
  });
  it('the ledger is append-only, and the constant the screens assert against says so', () => {
    expect(LEDGER_IS_APPEND_ONLY).toBe(true);
  });
  it('every unbuilt affordance on W143 is named by code, in one list', () => {
    expect([...ORG_WALLET_GAPS]).toEqual(['add_funds', 'payout_bank_change', 'tenant_hold_freeze']);
    expect(isNamedGap('add_funds')).toBe(true);
    expect(isNamedGap('something_plausible')).toBe(false);
  });
});

describe('TENANT-4a · THE ISOLATION FUNNEL (the ledger has no RLS — these queries ARE the isolation)', () => {
  const rmPath = path.join(__dirname, '..', 'read-models', 'org-wallet.read-model.ts');
  const src = fs.readFileSync(rmPath, 'utf8');
  const sqlOnly = [...src.matchAll(/`([^`]*(?:SELECT|FROM)[^`]*)`/g)].map((m) => m[1]).join('\n');
  // Comments stripped: the funnel's own header DESCRIBES the parameters it refuses ("no owner id, no
  // viewAs"), so a prose-blind assertion would be satisfied by the promise instead of the code.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');

  it('every query that reads the tenant\'s accounts binds owner_tenant_id to the FIRST parameter', () => {
    const ownerClauses = [...sqlOnly.matchAll(/owner_tenant_id\s*=\s*\$(\d+)/g)].map((m) => m[1]);
    expect(ownerClauses.length).toBeGreaterThanOrEqual(4);
    expect(new Set(ownerClauses)).toEqual(new Set(['1']));           // always the tenant, never a client value
    // and every one of those joins pins owner_kind too, so a user account can never be picked up.
    expect((sqlOnly.match(/owner_kind\s*=\s*'tenant'/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('the ONE query that reads a platform account filters on the tenant of the money-event', () => {
    const escrow = sqlOnly.slice(sqlOnly.indexOf("owner_kind = 'platform'"));
    expect(escrow).toContain("account_code = 'escrow'");
    expect(escrow).toContain('e.tenant_id = $1');
  });

  it('NO ACCOUNT ID, OWNER ID OR ACCOUNT CODE IS EVER ACCEPTED FROM THE CALLER', () => {
    // The only account-id parameter in the file is the one chainOf() receives from accountTruth(),
    // which resolved it from the tenant context — the public methods take tenantId and options only.
    expect(code).toMatch(/async overview\(tenantId: string/);
    expect(code).toMatch(/async ledger\(\s*\n?\s*tenantId: string/);
    expect(code).toMatch(/private async chainOf\(accountId: string/);  // private, not reachable from HTTP
    expect(code).not.toMatch(/accountId\?:/);                          // no optional caller-supplied id
    expect(code).not.toMatch(/ownerUserId|viewAs|impersonat/i);
  });

  it('pagination is keyset, and there is no OFFSET anywhere in the file', () => {
    expect(sqlOnly).not.toMatch(/\bOFFSET\b/i);
    expect(sqlOnly).toContain('ORDER BY e.created_at DESC, e.id DESC');
  });

  it('the read-model reads the REPLICA, and writes nothing (Law 2/11)', () => {
    expect(code).toContain('this.pools.replica(0)');
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});

describe('TENANT-4a · 0142 says what the wave claims (comments stripped)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0142_tenant_wallet_read.sql'), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

  it('the org wallet gets a permission of its own, granted to tenant_admin', () => {
    expect(sql).toContain("('wallet.org_view'");
    expect(sql).toContain('INSERT INTO role_permissions');
    expect(sql).toContain("r.code = 'tenant_admin'");
  });

  it('IT DOES NOT START ENFORCING wallet.view, AND ADDS NO COLUMN FOR THE HOLD CARD', () => {
    // Retro-enforcing a grant nobody has audited would lock roles out of their own money.
    expect(sql).not.toMatch(/GRANT[\s\S]*wallet\.view/);
    // Naming the missing freeze beats storing a number the ledger would contradict (the ADMIN-6 shape).
    expect(sql).not.toMatch(/frozen_amount_minor|ADD COLUMN/i);
  });

  it('it adds the index the shared-escrow read needs, and nothing that writes money', () => {
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_ledger_tenant_account');
    expect(sql).toContain('ON ledger_entries (tenant_id, account_id, created_at DESC)');
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)/);
  });

  it('the column comment records that hold has never been written', () => {
    expect(sql).toContain('COMMENT ON COLUMN wallet_accounts.owner_tenant_id');
    expect(sql).toContain('hold has never been written');
  });
});

describe('TENANT-4a · the export is a document, so it refuses rather than truncating', () => {
  it('the cap and the refusal are named, and the CSV keeps money in minor units', async () => {
    const { ORG_LEDGER_EXPORT_CAP, OrgLedgerExportTooLargeError } = await import('../services/org-wallet-export.service');
    expect(ORG_LEDGER_EXPORT_CAP).toBe(20_000);
    const err = new OrgLedgerExportTooLargeError(ORG_LEDGER_EXPORT_CAP);
    expect(err.code).toBe('WALLET_EXPORT_TOO_LARGE');
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'org-wallet-export.service.ts'), 'utf8');
    expect(src).toContain("'amount_minor'");
    expect(src).toContain("'currency'");
    expect(src).toContain('window_clamped_to_366_days');   // a clamp is an omission on the receipt
  });
});
