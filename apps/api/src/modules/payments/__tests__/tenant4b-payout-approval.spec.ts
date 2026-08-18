// PC-56 TENANT-4b · W145/W146 — the gate between a prepared batch and 42 farmers' bank accounts, plus the
// tenant scoping of a read that used to have none, pinned against the files' own source and 0143's own text.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AUTO_REQUEUE_BUCKETS, DEFAULT_CHECKER_THRESHOLD_MINOR, MAX_AUTO_ATTEMPTS, NOTE_FLOOR, PAYOUT_TABS,
  RETRY_BACKOFF_MINUTES, approvalRefusal, batchWindow, executionVerdict, isAutoRequeueable, laneOf,
  needsChecker, preflight, preflightBlocksApproval, rejectionRefusal, retryPlan, tabOf, windowState,
  type BatchForDecision, type PreflightInput,
} from '../domain/payout-approval';
import {
  PAYOUT_BATCH_STATUSES, canTransition, isApprovalPlane,
} from '../domain/payout-batch.state';

const NOW = new Date('2026-08-14T12:00:00Z');
const pre = (over: Partial<PreflightInput> = {}) => preflight({
  itemCount: 42, itemsTotalMinor: 34_218_000n, kycVerifiedCount: 42,
  serverSumMinor: 34_218_000n, availableMinor: 86_441_000n, frozenPayeeCount: 0, ...over,
});
const batch = (over: Partial<BatchForDecision> = {}): BatchForDecision => ({
  id: 'b1', tenantId: 't1', status: 'pending_approval', preparedBy: 'u-maker', decidedBy: null,
  itemsTotalMinor: 34_218_000n, checkerThresholdMinor: 10_000_000n,
  cutOffAt: new Date('2026-08-14T17:30:00Z'), executeAt: new Date('2026-08-14T18:00:00Z'), ...over,
});

describe('TENANT-4b · the batch state machine now has the gate the canon promised', () => {
  it('a pending batch CANNOT reach executing — no code path can disburse an unsigned run', () => {
    expect(canTransition('pending_approval', 'executing')).toBe(false);
    expect(canTransition('pending_approval', 'approved')).toBe(true);
    expect(canTransition('pending_approval', 'rejected')).toBe(true);
    expect(canTransition('pending_approval', 'expired')).toBe(true);
    expect(canTransition('approved', 'executing')).toBe(true);
  });
  it('a rejected or expired batch is terminal — there is no path back to money moving', () => {
    expect(canTransition('rejected', 'executing')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('expired', 'executing')).toBe(false);
    expect(canTransition('expired', 'approved')).toBe(false);
  });
  it('the legacy platform sweep still works, and is distinguishable from the approval plane', () => {
    expect(canTransition('open', 'executing')).toBe(true);
    expect(isApprovalPlane('open')).toBe(false);
    expect(isApprovalPlane('pending_approval')).toBe(true);
    expect([...PAYOUT_BATCH_STATUSES]).toEqual(['open', 'pending_approval', 'approved', 'rejected', 'expired', 'executing', 'executed', 'failed']);
  });
});

describe('TENANT-4b · the pre-flight (W146: "all must pass")', () => {
  it('all four checkable things pass on a clean batch — and the fifth reports its missing source', () => {
    const v = pre();
    expect(v.lines.map((l) => l.check)).toEqual(['payee_kyc', 'items_sum', 'funds_available', 'no_frozen_payee', 'risk_desk']);
    expect(v.passed).toBe(true);
    // THERE IS NO RISK DESK on this platform. It is unverifiable forever, never a tick.
    expect(v.lines.find((l) => l.check === 'risk_desk')).toEqual({ check: 'risk_desk', state: 'unverifiable', detail: 'no_risk_desk_exists' });
  });
  it('AN UNVERIFIABLE CHECK DOES NOT BLOCK — otherwise the missing risk desk stops every payout', () => {
    expect(preflightBlocksApproval(pre())).toBe(false);
    expect(pre().lines.some((l) => l.state === 'unverifiable')).toBe(true);
  });
  it('one unverified payee fails it, with the count, rather than rounding to "verified"', () => {
    const v = pre({ kycVerifiedCount: 41 });
    expect(v.passed).toBe(false);
    expect(v.blocking).toEqual(['payee_kyc']);
    expect(v.lines[0]).toEqual({ check: 'payee_kyc', state: 'fail', detail: '41/42' });
  });
  it('TWO INDEPENDENT SUMS MUST AGREE — the figure a checker signs must describe the rows', () => {
    const v = pre({ serverSumMinor: 34_218_001n });
    expect(v.passed).toBe(false);
    expect(v.blocking).toContain('items_sum');
  });
  it('a batch bigger than the balance is refused UP FRONT, not row by row at the bank', () => {
    const v = pre({ availableMinor: 1_000n });
    expect(v.blocking).toContain('funds_available');
    // ...and a balance that cannot be read is unverifiable, never "enough".
    const u = pre({ availableMinor: null });
    expect(u.lines.find((l) => l.check === 'funds_available')).toEqual({ check: 'funds_available', state: 'unverifiable', detail: 'balance_unreadable' });
    expect(u.passed).toBe(true);
  });
  it('a frozen payee blocks, and an empty batch cannot claim its payees are verified', () => {
    expect(pre({ frozenPayeeCount: 1 }).blocking).toContain('no_frozen_payee');
    const empty = pre({ itemCount: 0, kycVerifiedCount: 0, itemsTotalMinor: 0n, serverSumMinor: 0n });
    expect(empty.lines[0]).toEqual({ check: 'payee_kyc', state: 'unverifiable', detail: 'no_items' });
  });
});

describe('TENANT-4b · the clock (W146: "after 17:30 the batch locks")', () => {
  it('the cut-off is derived from the execution instant and the tenant setting', () => {
    const w = batchWindow(new Date('2026-08-14T18:00:00Z'), 30, NOW);
    expect(w.cutOffAt.toISOString()).toBe('2026-08-14T17:30:00.000Z');
    expect(w.executeAt.toISOString()).toBe('2026-08-14T18:00:00.000Z');
  });
  it('a window whose cut-off has already passed is REFUSED — it could never be signed', () => {
    expect(() => batchWindow(new Date('2026-08-14T12:10:00Z'), 30, NOW)).toThrow();
    try {
      batchWindow(new Date('2026-08-14T12:10:00Z'), 30, NOW);
    } catch (e) {
      // The CODE is what the screen translates, so the code is what this pins.
      expect((e as { code?: string }).code).toBe('PAYOUT_BATCH_WINDOW_TOO_SOON');
    }
  });
  it('past the cut-off a pending batch is locked, and at execution time it is due', () => {
    const w = { cutOffAt: new Date('2026-08-14T17:30:00Z'), executeAt: new Date('2026-08-14T18:00:00Z') };
    expect(windowState(w, NOW)).toBe('open_for_approval');
    expect(windowState(w, new Date('2026-08-14T17:31:00Z'))).toBe('locked');
    expect(windowState(w, new Date('2026-08-14T18:00:00Z'))).toBe('due');
  });
});

describe('TENANT-4b · who may sign, and the rule actually in force', () => {
  it('the threshold decides whether the maker may sign their own batch — and the default is the STRICT one', () => {
    expect(DEFAULT_CHECKER_THRESHOLD_MINOR).toBe(10_000_000n);
    expect(needsChecker(10_000_000n, 10_000_000n)).toBe(true);       // "at or above"
    expect(needsChecker(9_999_999n, 10_000_000n)).toBe(false);
    expect(needsChecker(1n, 0n)).toBe(true);                          // threshold 0 = always two humans
  });
  it('AT OR ABOVE THE THRESHOLD THE MAKER IS REFUSED, BY NAME', () => {
    expect(approvalRefusal(batch(), 'u-maker', NOW, pre())).toBe('PAYOUT_BATCH_CHECKER_IS_MAKER');
    expect(approvalRefusal(batch(), 'u-checker', NOW, pre())).toBeNull();
  });
  it('below the threshold the maker may sign — and nothing pretends two humans looked', () => {
    const small = batch({ itemsTotalMinor: 500_000n });
    expect(approvalRefusal(small, 'u-maker', NOW, pre())).toBeNull();
  });
  it('a missing pinned threshold falls back to the strict default rather than to "no checker needed"', () => {
    expect(approvalRefusal(batch({ checkerThresholdMinor: null }), 'u-maker', NOW, pre())).toBe('PAYOUT_BATCH_CHECKER_IS_MAKER');
  });
  it('the order of refusals is state → clock → person → evidence, so the message is the first true reason', () => {
    expect(approvalRefusal(batch({ status: 'approved' }), 'u-maker', NOW, pre({ kycVerifiedCount: 0 }))).toBe('PAYOUT_BATCH_NOT_PENDING');
    expect(approvalRefusal(batch(), 'u-maker', new Date('2026-08-14T17:31:00Z'), pre())).toBe('PAYOUT_BATCH_LOCKED');
    expect(approvalRefusal(batch(), 'u-checker', NOW, pre({ kycVerifiedCount: 0 }))).toBe('PAYOUT_BATCH_PREFLIGHT_FAILED');
  });
  it('REJECTING does not need the pre-flight to pass — that is what a checker is FOR — but needs the reason', () => {
    const badPre = pre({ kycVerifiedCount: 0 });
    expect(rejectionRefusal(batch(), 'Two payees are not KYC verified yet', NOW)).toBeNull();
    expect(preflightBlocksApproval(badPre)).toBe(true);
    expect(rejectionRefusal(batch(), 'too small', NOW)).toBe('PAYOUT_BATCH_NOTE_TOO_SHORT');
    expect(NOTE_FLOOR).toBe(20);
    expect(rejectionRefusal(batch(), 'x'.repeat(20), new Date('2026-08-14T17:31:00Z'))).toBe('PAYOUT_BATCH_LOCKED');
  });
});

describe('TENANT-4b · THE EXECUTOR OBEYS THE DECISION', () => {
  it('an approved batch runs at its time, and not before', () => {
    expect(executionVerdict({ status: 'approved', tenantId: 't1', executeAt: new Date('2026-08-14T18:00:00Z') }, NOW, true))
      .toEqual({ kind: 'refuse', reason: 'not_due' });
    expect(executionVerdict({ status: 'approved', tenantId: 't1', executeAt: new Date('2026-08-14T18:00:00Z') }, new Date('2026-08-14T18:00:01Z'), true))
      .toEqual({ kind: 'execute', basis: 'approved' });
  });
  it('A REJECTED OR EXPIRED BATCH IS REFUSED WHATEVER THE FLAG SAYS', () => {
    for (const flag of [true, false]) {
      expect(executionVerdict({ status: 'rejected', tenantId: 't1', executeAt: null }, NOW, flag)).toEqual({ kind: 'refuse', reason: 'rejected' });
      expect(executionVerdict({ status: 'expired', tenantId: 't1', executeAt: null }, NOW, flag)).toEqual({ kind: 'refuse', reason: 'rejected' });
    }
  });
  it('an UNSIGNED tenant batch is refused when approval is required, and the legacy sweep is NAMED', () => {
    expect(executionVerdict({ status: 'pending_approval', tenantId: 't1', executeAt: null }, NOW, false)).toEqual({ kind: 'refuse', reason: 'not_approved' });
    expect(executionVerdict({ status: 'open', tenantId: 't1', executeAt: null }, NOW, true)).toEqual({ kind: 'refuse', reason: 'not_approved' });
    // Flag off: the pilot's behaviour continues, and the verdict SAYS which regime moved the money.
    expect(executionVerdict({ status: 'open', tenantId: 't1', executeAt: null }, NOW, false)).toEqual({ kind: 'execute', basis: 'legacy_open_sweep' });
    // A platform-wide run (no tenant) is not in the tenant approval plane at all.
    expect(executionVerdict({ status: 'open', tenantId: null, executeAt: null }, NOW, true)).toEqual({ kind: 'execute', basis: 'legacy_open_sweep' });
  });
  it('a batch already executing or finished is never re-run', () => {
    for (const s of ['executing', 'executed', 'failed']) {
      expect(executionVerdict({ status: s, tenantId: 't1', executeAt: null }, NOW, true)).toEqual({ kind: 'refuse', reason: 'already_terminal' });
    }
  });
});

describe('TENANT-4b · W145\'s failure column: the real reason and the exact time', () => {
  it('an invalid account is NEVER auto-retried — it would fail identically forever', () => {
    expect(isAutoRequeueable('invalid_account')).toBe(false);
    expect(isAutoRequeueable('insufficient_funds')).toBe(false);
    expect([...AUTO_REQUEUE_BUCKETS]).toEqual(['timeout', 'bank_declined', 'other']);
    expect(retryPlan('invalid_account', 0, NOW)).toEqual({ kind: 'needs_human', reason: 'account_must_be_fixed' });
  });
  it('the backoff grows, and the plan carries the EXACT time the screen prints', () => {
    expect([...RETRY_BACKOFF_MINUTES]).toEqual([15, 60, 240, 1440]);
    const p1 = retryPlan('timeout', 0, NOW);
    expect(p1).toEqual({ kind: 'retry_at', at: new Date('2026-08-14T12:15:00Z'), attempt: 1 });
    expect(retryPlan('timeout', 1, NOW)).toEqual({ kind: 'retry_at', at: new Date('2026-08-14T13:00:00Z'), attempt: 2 });
    expect(retryPlan('timeout', 3, NOW)).toEqual({ kind: 'retry_at', at: new Date('2026-08-15T12:00:00Z'), attempt: 4 });
  });
  it('AFTER THE LAST ATTEMPT THE ROW SAYS SO — it does not say "retrying" forever', () => {
    expect(MAX_AUTO_ATTEMPTS).toBe(4);
    expect(retryPlan('timeout', 4, NOW)).toEqual({ kind: 'exhausted', attempts: 4 });
  });
});

describe('TENANT-4b · the tabs partition the machine, and the lane word is honest', () => {
  it('every payout status maps to exactly one tab', () => {
    for (const s of ['queued', 'processing', 'success', 'failed', 'reversed', 'cancelled']) expect(tabOf(s)).not.toBeNull();
    expect(tabOf('something_new')).toBeNull();
    expect(Object.values(PAYOUT_TABS).flat().sort()).toEqual(['cancelled', 'failed', 'processing', 'queued', 'reversed', 'success']);
  });
  it('A WAGE PAYOUT THAT WAS NOT PROMOTED DOES NOT SAY "priority lane"', () => {
    expect(laneOf(10, 'wage')).toBe('wage_priority');
    expect(laneOf(100, 'wage')).toBe('wage_not_promoted');
    expect(laneOf(100, 'settlement')).toBe('standard');
    expect(laneOf(5, 'settlement')).toBe('wage_priority');
  });
});

describe('TENANT-4b · THE LEAK IS CLOSED: every batch read takes a tenant', () => {
  const repo = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'payout-batch.repository.ts'), 'utf8');
  const code = repo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sql = [...code.matchAll(/`([^`]*(?:SELECT|UPDATE|INSERT)[^`]*)`/g)].map((m) => m[1]).join('\n');

  it('the WHERE 1=1 that read every tenant\'s payout runs is gone', () => {
    expect(code).not.toContain('WHERE 1=1');
    expect(code).toMatch(/async list\(opts: \{ tenantId: string/);
    expect(code).toMatch(/async getById\(tenantId: string, id: string\)/);
    expect(code).toMatch(/async getApprovalById\(tenantId: string, id: string\)/);
  });
  it('every REPLICA read of payout_batches filters on tenant_id', () => {
    // The replica reads are the ones a tenant request reaches. Each is its own method, so this asserts on
    // the methods rather than on a regex over the whole file.
    const methods = ['getById', 'getApprovalById', 'list'];
    for (const m of methods) {
      const body = code.slice(code.indexOf(`async ${m}(`), code.indexOf(`async ${m}(`) + 900);
      expect(body).toContain('this.pools.replica(0)');
      expect(body).toMatch(/tenant_id\s*=\s*\$|tenant_id=\$\{/);
    }
    // The ONE tx-level read without a tenant predicate is `getForUpdate`, which the privileged worker path
    // uses on a batch id ALREADY resolved through a tenant-scoped read (runApproved calls getApprovalById
    // first) — and 0143's RLS covers kv_app regardless. Named here so it is a decision, not an oversight.
    const forUpdate = code.slice(code.indexOf('async getForUpdate('), code.indexOf('async getForUpdate(') + 400);
    expect(forUpdate).toContain('FOR UPDATE');
    expect(forUpdate).not.toContain('this.pools.replica');
  });
  it('and the claim respects the backoff, so a requeue is not a tight loop against the bank', () => {
    expect((sql.match(/next_retry_at IS NULL OR next_retry_at <= now\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('a run is never deleted from this file', () => {
    expect(code).not.toMatch(/DELETE FROM payout_batches/);
  });
});

describe('TENANT-4b · the executor gate is in the service, not only in the docs', () => {
  const svc = fs.readFileSync(path.join(__dirname, '..', 'services', 'payout-batch.service.ts'), 'utf8');
  it('runApproved asks executionVerdict before it moves anything, and counts its refusals', () => {
    expect(svc).toContain('executionVerdict(');
    expect(svc).toContain('payments.payout_batch_execution_refused');
    const body = svc.slice(svc.indexOf('async runApproved'));
    // The verdict is consulted BEFORE the batch is marked executing.
    expect(body.indexOf('executionVerdict(')).toBeLessThan(body.indexOf('markExecuting()'));
  });
  it('the approval service re-reads UNDER LOCK before recording a decision', () => {
    const s = fs.readFileSync(path.join(__dirname, '..', 'services', 'payout-approval.service.ts'), 'utf8');
    expect(s).toContain('getPendingForUpdate');
    expect(s.indexOf('getPendingForUpdate')).toBeLessThan(s.indexOf('recordDecision'));
    // And a rejection releases the claims, so no farmer's money stays pinned to a dead run.
    expect(s).toContain('releaseClaims');
    // The KYC aggregate reuses the per-payout gate rather than re-deciding eligibility in SQL.
    expect(s).toContain('kycVerdictFor(');
  });
});

describe('TENANT-4b · 0143 says what the wave claims (comments stripped)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0143_payout_approval_gate.sql'), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

  it('the batch gains a maker, a checker, a window, a pinned threshold and its evidence', () => {
    for (const c of ['prepared_by', 'decided_by', 'decision_note', 'cut_off_at', 'execute_at', 'checker_threshold_minor', 'preflight', 'items_total_minor']) {
      expect(sql).toContain(c);
    }
  });
  it('MAKER <> CHECKER IS IN THE SCHEMA, AND ASSERTS NOT NULL FIRST (0139\'s NULL-CHECK lesson)', () => {
    const ck = sql.slice(sql.indexOf('ck_payout_batch_maker_ne_checker'));
    expect(ck).toContain('prepared_by IS NOT NULL AND decided_by <> prepared_by');
    const note = sql.slice(sql.indexOf('ck_payout_batch_decision_note'));
    expect(note).toContain('decision_note IS NOT NULL AND char_length(btrim(decision_note)) >= 20');
  });
  it('one pending batch per tenant and type — the double-pay race guard', () => {
    expect(sql).toContain('uq_payout_batch_pending');
    expect(sql).toContain("WHERE status IN ('pending_approval', 'approved')");
  });
  it('THE LEAK IS CLOSED IN THE DATABASE TOO: RLS with a write check, and no DELETE', () => {
    expect(sql).toContain('ALTER TABLE payout_batches ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY payout_batches_read ON payout_batches FOR SELECT');
    expect(sql).toContain('WITH CHECK (tenant_id = current_tenant_id())');
    expect(sql).toContain('REVOKE DELETE, TRUNCATE ON payout_batches FROM kv_app');
  });
  it('the maker gets a key of its own, and the threshold and cut-off are SETTINGS (Law 6)', () => {
    expect(sql).toContain("('payout.prepare'");
    expect(sql).toContain("r.code = 'tenant_admin'");
    expect(sql).not.toMatch(/r\.tenant_id IS NULL/);          // TENANT-4a's live-apply lesson: roles has no tenant_id
    expect(sql).toContain('payouts.batch_checker_threshold_minor');
    expect(sql).toContain('payouts.batch_cut_off_minutes');
  });
  it('the retry columns exist, because "auto-retry with backoff" could not exist without them', () => {
    expect(sql).toContain('auto_attempts');
    expect(sql).toContain('next_retry_at');
    expect(sql).toContain('ck_payout_retry_shape');
  });
  it('and the change is behind a flag, default OFF (Law 10)', () => {
    expect(sql).toContain("'payout_batch_approval'");
    expect(sql).toMatch(/feature_flags[\s\S]*false/);
  });
});
