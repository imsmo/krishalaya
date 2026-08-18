// PC-56 TENANT-4b · W145's queue and W146's approval — the console rules, and the pages' own promises pinned
// against their source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  QUEUE_TABS, approveBlockedBy, checkerRuleKey, earliestExecuteLocal, isAllowedExecuteAt, isNoteLongEnough,
  kpiCount, laneKey, NOTE_FLOOR, preflightBlocks, preflightIcon, preflightLabelKey, refusalKey,
  rejectBlockedBy, retryBlockedBy, retryKey, retryView, tabFilter, unverifiableCount,
} from '../features/payouts/org-console';

const PRE_OK = { lines: [{ state: 'pass' as const }, { state: 'unverifiable' as const }] };
const PRE_BAD = { lines: [{ state: 'fail' as const }, { state: 'pass' as const }] };
const V = {
  status: 'pending_approval', window: 'open_for_approval', viewerIsMaker: false, needsChecker: true, preflight: PRE_OK,
};

describe('TENANT-4b · the queue tabs partition every status', () => {
  it('the five tabs are the canon\'s five, and an unknown tab degrades to "all"', () => {
    expect([...QUEUE_TABS]).toEqual(['queued', 'processing', 'failed', 'success', 'reversed_cancelled']);
    expect(tabFilter('failed')).toBe('failed');
    expect(tabFilter('everything')).toBeNull();
    expect(tabFilter(undefined)).toBeNull();
  });
  it('the KPI count folds reversed and cancelled together and never invents a figure', () => {
    const counts = { queued: 42, processing: 0, failed: 3, success: 312, reversed: 1, cancelled: 2 };
    expect(kpiCount(counts, 'queued')).toBe(42);
    expect(kpiCount(counts, 'reversed_cancelled')).toBe(3);
    expect(kpiCount({}, 'success')).toBe(0);
  });
});

describe('TENANT-4b · the lane word, and the failure sentence', () => {
  it('A WAGE PAYOUT THAT WAS NOT PROMOTED IS NOT LABELLED "priority lane"', () => {
    expect(laneKey('wage_priority')).toBe('wage');
    expect(laneKey('wage_not_promoted')).toBe('wageNotPromoted');
    expect(laneKey('standard')).toBe('standard');
    expect(laneKey('wage_not_promoted')).not.toBe(laneKey('wage_priority'));
  });
  it('the retry view has three different sentences, and "none" is not one of the three', () => {
    expect(retryView({ kind: 'retry_at', at: '2026-08-14T16:00:00Z', attempt: 2 })).toEqual({ kind: 'at', at: '2026-08-14T16:00:00Z', attempt: 2 });
    expect(retryView({ kind: 'needs_human' })).toEqual({ kind: 'needsHuman' });
    expect(retryView({ kind: 'exhausted', attempts: 4 })).toEqual({ kind: 'exhausted', attempts: 4 });
    expect(retryView(null)).toEqual({ kind: 'none' });
    expect(retryKey({ kind: 'needsHuman' })).toBe('po.retry.needsHuman');
    expect(retryKey({ kind: 'at', at: 'x', attempt: 1 })).toBe('po.retry.at');
  });
  it('the Retry control is WITHHELD where it would fail, with the reason on the row', () => {
    expect(retryBlockedBy({ status: 'queued', retry: null }, { canApprove: true })).toBe('notFailed');
    expect(retryBlockedBy({ status: 'failed', retry: { kind: 'retry_at' } }, { canApprove: false })).toBe('noPermission');
    expect(retryBlockedBy({ status: 'failed', retry: { kind: 'needs_human' } }, { canApprove: true })).toBe('needsHuman');
    expect(retryBlockedBy({ status: 'failed', retry: { kind: 'exhausted' } }, { canApprove: true })).toBe('exhausted');
    expect(retryBlockedBy({ status: 'failed', retry: { kind: 'retry_at' } }, { canApprove: true })).toBeNull();
  });
});

describe('TENANT-4b · the pre-flight has three marks, and one of them is not a tick', () => {
  it('unverifiable renders differently from pass — W146 says "all must pass"', () => {
    expect(preflightIcon('pass')).toBe('✓');
    expect(preflightIcon('fail')).toBe('✕');
    expect(preflightIcon('unverifiable')).toBe('?');
    expect(preflightIcon('unverifiable')).not.toBe(preflightIcon('pass'));
  });
  it('only a FAILED check blocks; an unverifiable one is counted and explained', () => {
    expect(preflightBlocks(PRE_OK.lines)).toBe(false);
    expect(preflightBlocks(PRE_BAD.lines)).toBe(true);
    expect(unverifiableCount(PRE_OK.lines)).toBe(1);
    expect(preflightLabelKey('risk_desk')).toBe('po.pre.risk_desk');
  });
});

describe('TENANT-4b · who the screen lets sign', () => {
  it('the maker is told they cannot also approve, rather than shown a button that fails', () => {
    expect(approveBlockedBy({ ...V, viewerIsMaker: true }, { canApprove: true })).toBe('youPrepared');
    expect(approveBlockedBy(V, { canApprove: true })).toBeNull();
  });
  it('BELOW THE THRESHOLD THE MAKER MAY SIGN — and the sentence says which rule is in force', () => {
    expect(approveBlockedBy({ ...V, viewerIsMaker: true, needsChecker: false }, { canApprove: true })).toBeNull();
    expect(checkerRuleKey(true)).toBe('po.rule.twoHumans');
    expect(checkerRuleKey(false)).toBe('po.rule.singleSigner');
  });
  it('state, then clock, then permission, then evidence', () => {
    expect(approveBlockedBy({ ...V, status: 'approved' }, { canApprove: true })).toBe('notPending');
    expect(approveBlockedBy({ ...V, window: 'locked' }, { canApprove: true })).toBe('locked');
    expect(approveBlockedBy(V, { canApprove: false })).toBe('noPermission');
    expect(approveBlockedBy({ ...V, preflight: PRE_BAD }, { canApprove: true })).toBe('preflightFailed');
  });
  it('REJECTING a failing batch is always offered — that is what a checker is for', () => {
    expect(rejectBlockedBy({ status: 'pending_approval', window: 'open_for_approval' }, { canApprove: true })).toBeNull();
    expect(rejectBlockedBy({ status: 'pending_approval', window: 'locked' }, { canApprove: true })).toBe('locked');
    expect(rejectBlockedBy({ status: 'rejected', window: 'open_for_approval' }, { canApprove: true })).toBe('notPending');
  });
  it('the note floor is the same 20 characters as every other note in this programme', () => {
    expect(NOTE_FLOOR).toBe(20);
    expect(isNoteLongEnough('too short')).toBe(false);
    expect(isNoteLongEnough('  ' + 'x'.repeat(20) + '  ')).toBe(true);
    expect(isNoteLongEnough(undefined)).toBe(false);
  });
});

describe('TENANT-4b · the execution time must leave room for a signature', () => {
  const now = new Date('2026-08-14T12:00:00Z');
  it('an instant inside the cut-off window is refused before the round trip', () => {
    expect(isAllowedExecuteAt('2026-08-14T18:00:00Z', now)).toBe(true);
    expect(isAllowedExecuteAt('2026-08-14T12:20:00Z', now)).toBe(false);
    expect(isAllowedExecuteAt('2026-08-14T11:00:00Z', now)).toBe(false);
    expect(isAllowedExecuteAt('tonight', now)).toBe(false);
  });
  it('the min offered is later than now + the cut-off, and is a LOCAL datetime value', () => {
    const v = earliestExecuteLocal(now, 30);
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(isAllowedExecuteAt(v, now, 30)).toBe(true);
  });
});

describe('TENANT-4b · every refusal is translated by NAME', () => {
  it('each API code has its own key, and an unknown code is not silently swallowed', () => {
    expect(refusalKey('PAYOUT_BATCH_CHECKER_IS_MAKER')).toBe('po.err.checkerIsMaker');
    expect(refusalKey('PAYOUT_BATCH_ALREADY_PENDING')).toBe('po.err.alreadyPending');
    expect(refusalKey('PAYOUT_RETRY_NEEDS_HUMAN')).toBe('po.err.retryNeedsHuman');
    expect(refusalKey('PAYOUT_BATCH_LOCKED')).toBe('po.err.locked');
    expect(refusalKey('SOMETHING_NEW')).toBe('po.err.generic');
  });
});

describe('TENANT-4b · the pages state their own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('W145 reads the ORGANISATION\'s queue, not the signed-in user\'s withdrawals', () => {
    const s = read('app', 'payouts', 'page.tsx');
    expect(s).toContain('payoutConsole.queue(');
    expect(s).not.toMatch(/payouts\.list\(|payouts\.request\(/);
    // ...and it links to the personal surface, which moved rather than being deleted.
    expect(s).toContain('/payouts/my');
  });

  it('the personal withdrawal page still exists at /payouts/my and still requests payouts', () => {
    const s = read('app', 'payouts', 'my', 'page.tsx');
    expect(s).toContain('payouts.list(');
    expect(read('app', 'payouts', 'my', 'actions.ts')).toContain('payouts.request(');
  });

  it('the queue names the lane, the exact retry time, and any status the tabs miss', () => {
    const s = read('app', 'payouts', 'page.tsx');
    expect(s).toContain('po.lane.');
    expect(s).toContain('retryKey(');
    expect(s).toContain('po.unmapped');
    expect(s).toContain('po.bankUnverified');
  });

  it('W146 shows the pre-flight, the clock, the rule in force, and the signed evidence', () => {
    const s = read('app', 'payouts', 'batches', '[id]', 'page.tsx');
    expect(s).toContain('preflightIcon(');
    expect(s).toContain('windowKey(');
    expect(s).toContain('checkerRuleKey(');
    expect(s).toContain('po.signedEvidence');
    expect(s).toContain('po.preUnverifiableNote');
  });

  it('IT DOES NOT DRAW AN APPROVE BUTTON THE SERVER WOULD REFUSE', () => {
    const s = read('app', 'payouts', 'batches', '[id]', 'page.tsx');
    expect(s).toContain('approveBlockedBy(');
    expect(s).toContain('{!approveBlock && (');
    expect(s).toContain('po.youPrepared');
  });

  it('preparing a batch carries an Idempotency-Key, and the local time is converted to an instant', () => {
    const s = read('app', 'payouts', 'actions.ts');
    expect(s).toContain('randomUUID()');
    expect(s).toContain('new Date(local).toISOString()');
    expect(s).toContain('isAllowedExecuteAt');
    expect(s).toContain('isNoteLongEnough');
  });

  it('every new key is translated in all three launch languages', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('po.'));
    expect(mine.length).toBeGreaterThan(120);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
  });
});
