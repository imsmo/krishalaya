// PC-56 TENANT-4a · W143's cards and W144's ledger view — the console rules, and the pages' own promises
// pinned against their source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ORG_ACCOUNTS, accountFilter, cardMinor, cardState, chainPhraseKey, defaultWindow, direction,
  escrowNoteKey, exportBlockedBy, exportRefusalKey, gapNoteKey, healthIcon, healthLabelKey, holdNoteKey,
  isAllowedWindow, isGapNamed, isIsoDate, needsDriftNotice, referenceHref, windowDays, LEDGER_HAS_NO_EDIT,
  WINDOW_MAX_DAYS,
} from '../features/wallet/org-console';

describe('TENANT-4a · a card prints the LEDGER, and says so when the cache disagrees', () => {
  it('the ledger sum is the figure, whatever the cache says', () => {
    expect(cardMinor({ kind: 'reconciled', minor: '864410' })).toBe('864410');
    expect(cardMinor({ kind: 'drifted', minor: '864410', cachedMinor: '900000', driftMinor: '35590' })).toBe('864410');
    expect(cardMinor({ kind: 'never_used', minor: '0' })).toBe('0');
  });
  it('drift is the only state that raises a notice, and never_used is its own word', () => {
    expect(needsDriftNotice({ kind: 'drifted', minor: '1', cachedMinor: '2', driftMinor: '1' })).toBe(true);
    expect(needsDriftNotice({ kind: 'reconciled', minor: '1' })).toBe(false);
    expect(cardState({ kind: 'never_used', minor: '0' })).toBe('never_used');
  });
  it('THE HOLD CARD SAYS WHY IT IS ZERO — no code path freezes tenant money', () => {
    expect(holdNoteKey('no_freeze_path')).toBe('wal.holdNoFreezePath');
    expect(holdNoteKey('frozen_by_ledger')).toBe('wal.holdFrozen');
  });
});

describe('TENANT-4a · ledger health has four vocabularies, and one of them is not a tick', () => {
  it('an unverifiable check never renders with the ok mark', () => {
    expect(healthIcon('ok')).toBe('✓');
    expect(healthIcon('attention')).toBe('!');
    expect(healthIcon('unverifiable')).toBe('?');
    expect(healthIcon('not_ours_to_assert')).toBe('·');
    expect(healthIcon('unverifiable')).not.toBe(healthIcon('ok'));
  });
  it('each check has its own label key, including the one the platform owns', () => {
    expect(healthLabelKey('cached_vs_ledger')).toBe('wal.health.cached_vs_ledger');
    expect(healthLabelKey('own_chain')).toBe('wal.health.own_chain');
    expect(healthLabelKey('platform_recon')).toBe('wal.health.platform_recon');
  });
  it('"intact" is printable ONLY when the head pointer agrees — the truncation attack', () => {
    expect(chainPhraseKey('intact', true)).toBe('wal.chain.intact');
    expect(chainPhraseKey('intact', null)).toBe('wal.chain.intact');
    expect(chainPhraseKey('intact', false)).toBe('wal.chain.headMismatch');
    expect(chainPhraseKey('hash_mismatch', null)).toBe('wal.chain.hashMismatch');
    expect(chainPhraseKey('chain_break', null)).toBe('wal.chain.chainBreak');
    expect(chainPhraseKey('incomplete', null)).toBe('wal.chain.incomplete');
    expect(chainPhraseKey('empty', null)).toBe('wal.chain.empty');
  });
});

describe('TENANT-4a · escrow and the named gaps', () => {
  it('zero escrow is a sentence of its own, not an omitted card', () => {
    expect(escrowNoteKey('21460000')).toBe('wal.escrowHeld');
    expect(escrowNoteKey('0')).toBe('wal.escrowNone');
    expect(escrowNoteKey('')).toBe('wal.escrowNone');
  });
  it('every unbuilt affordance has a key, and an invented one is not honoured', () => {
    expect(gapNoteKey('add_funds')).toBe('wal.gap.add_funds');
    expect(gapNoteKey('payout_bank_change')).toBe('wal.gap.payout_bank_change');
    expect(isGapNamed(['add_funds'], 'add_funds')).toBe(true);
    expect(isGapNamed(['add_funds'], 'payout_bank_change')).toBe(false);
  });
});

describe('TENANT-4a · the ledger view is date-bounded and keyset-only', () => {
  it('the default window is the last 30 days, as W144 says', () => {
    expect(defaultWindow(new Date('2026-08-12T18:00:00Z'))).toEqual({ from: '2026-07-13', to: '2026-08-12' });
  });
  it('a window longer than 366 days is refused before the round trip', () => {
    expect(WINDOW_MAX_DAYS).toBe(366);
    expect(isAllowedWindow('2026-07-13', '2026-08-12')).toBe(true);
    expect(isAllowedWindow('2016-01-01', '2026-08-12')).toBe(false);
    expect(isAllowedWindow('2026-08-12', '2026-07-13')).toBe(false);   // reversed is not a window
    expect(windowDays('2026-08-01', '2026-08-12')).toBe(11);
    expect(windowDays('nope', '2026-08-12')).toBeNull();
    expect(isIsoDate('2026-08-12')).toBe(true);
    expect(isIsoDate('12/08/2026')).toBe(false);
  });
  it('the account filter accepts the three codes and degrades on anything else', () => {
    expect([...ORG_ACCOUNTS]).toEqual(['main', 'commission', 'hold']);
    expect(accountFilter('commission')).toBe('commission');
    expect(accountFilter('escrow')).toBeNull();                        // a platform account is not offered
    expect(accountFilter(undefined)).toBeNull();
  });
  it('the direction word follows the sign, and zero is not called a credit', () => {
    expect(direction('638')).toBe('credit');
    expect(direction('-44660')).toBe('debit');
    expect(direction('0')).toBe('zero');
  });
  it('A REFERENCE ONLY LINKS WHERE A ROUTE EXISTS — never to a 404', () => {
    expect(referenceHref('order', 'ORD-1')).toBe('/orders/ORD-1');
    expect(referenceHref('payout', 'P-1')).toBe('/payouts/P-1');
    expect(referenceHref('settlement', 'S-1')).toBeNull();             // no built route yet → plain text
    expect(referenceHref('order', null)).toBeNull();
    expect(referenceHref(null, 'ORD-1')).toBeNull();
  });
  it('the append-only promise is a constant the page asserts against', () => {
    expect(LEDGER_HAS_NO_EDIT).toBe(true);
  });
});

describe('TENANT-4a · the export control states its own precondition', () => {
  const win = { from: '2026-07-13', to: '2026-08-12' };
  it('permission first, then the window, then whether there is anything to export', () => {
    expect(exportBlockedBy({ rowsInView: 5, window: win }, { canView: false })).toBe('noPermission');
    expect(exportBlockedBy({ rowsInView: 5, window: { from: '2016-01-01', to: '2026-08-12' } }, { canView: true })).toBe('windowTooWide');
    expect(exportBlockedBy({ rowsInView: 0, window: win }, { canView: true })).toBe('nothingToExport');
    expect(exportBlockedBy({ rowsInView: 5, window: win }, { canView: true })).toBeNull();
  });
  it('the refusal is translated by NAME, so nobody presses it again on the same decade', () => {
    expect(exportRefusalKey('WALLET_EXPORT_TOO_LARGE')).toBe('wal.err.exportTooLarge');
    expect(exportRefusalKey('WALLET_EXPORT_FAILED')).toBe('wal.err.exportFailed');
  });
});

describe('TENANT-4a · the pages state their own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('W143 reads the ORGANISATION wallet, not the signed-in user\'s personal one', () => {
    const s = read('app', 'wallet', 'page.tsx');
    expect(s).toContain('orgWallet.overview()');
    expect(s).not.toMatch(/wallet\.balance\(|wallet\.ledger\(/);
    // and it says whose money this is, so nobody wonders where their personal balance went.
    expect(s).toContain('wal.notYourPersonalWallet');
  });

  it('it is permission-gated by 0142\'s key, and reflects the gate rather than showing an empty screen', () => {
    const s = read('app', 'wallet', 'page.tsx');
    expect(s).toContain("tenantHasPerm('wallet.org_view')");
    expect(s).toContain('wal.restricted');
  });

  it('the three unbuilt affordances are NAMED on the page, and no add-funds control is drawn', () => {
    const s = read('app', 'wallet', 'page.tsx');
    expect(s).toContain("gapNoteKey('add_funds')");
    expect(s).toContain("gapNoteKey('payout_bank_change')");
    expect(s).toContain("gapNoteKey('tenant_hold_freeze')");
    expect(s).not.toMatch(/addFundsAction|topUpAction|addFunds\(/);
  });

  it('the health panel prints the platform note instead of restating "0 breaks"', () => {
    const s = read('app', 'wallet', 'page.tsx');
    expect(s).toContain('wal.healthPlatformNote');
    expect(s).not.toMatch(/0 breaks|zeroBreaks/);
  });

  it('W144 has NO edit control, and refuses the canon\'s page-number pager (the roster rule)', () => {
    const s = read('app', 'wallet', 'transactions', 'page.tsx');
    expect(s).toContain('wal.noEditByDesign');
    expect(s).toContain('wal.keysetOnly');
    expect(s).not.toMatch(/rowsPerPage|perPage|page=\{|&page=/);
    expect(s).toContain('cursor: nextCursor');
  });

  it('its filters are a GET form and its type chips come from the tenant\'s own rows', () => {
    const s = read('app', 'wallet', 'transactions', 'page.tsx');
    expect(s).toContain('method="get"');
    expect(s).toContain('orgWallet.txnTypes()');
  });

  it('the export action checks the window before the round trip and reports the RECEIPT\'s count', () => {
    const s = read('app', 'wallet', 'transactions', 'actions.ts');
    expect(s).toContain('isAllowedWindow');
    expect(s).toContain('WALLET_EXPORT_TOO_LARGE');
    expect(s).toContain('res.receipt.rowCount');
    expect(s).not.toContain('res.rows.length');
  });

  it('every new key is translated in all three launch languages', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('wal.'));
    expect(mine.length).toBeGreaterThan(70);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
  });
});
