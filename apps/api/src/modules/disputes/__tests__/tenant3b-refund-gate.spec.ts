// PC-56 TENANT-3b · the dispute & return money door: the maker-checker gate, the honest money state, W140's tabs,
// and the two aggregate rules 0139 made enforceable.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_CHECKER_THRESHOLD_MINOR, MIN_NOTE_CHARS, RefundGateError, assertCheckerDistinct, assertNote,
  assertRefundAllowed, needsChecker, refundGate, thresholdFrom,
} from '../domain/refund-gate';
import { disputeMoneyState, maxRefundable, PARTIAL_FREEZE_BUILT } from '../domain/dispute-money-state';
import { DISPUTE_VIEWS, outcomeSide, slaClock, statusesInDisputeView, viewOfDisputeStatus } from '../domain/dispute-console';
import { DISPUTE_STATUSES } from '../domain/dispute.state';
import { Return } from '../domain/return.entity';
import { Dispute } from '../domain/dispute.entity';
import { InvalidReturnError, InvalidDisputeError } from '../domain/disputes.errors';
import { DisputeConsoleReadModel } from '../read-models/dispute-console.read-model';

const APPROVED = (over: Partial<{ id: string; status: string; amountMinor: bigint; proposedBy: string; decidedBy: string | null }> = {}) =>
  ({ id: 'ra-1', status: 'approved', amountMinor: 1_282_000n, proposedBy: 'u-maker', decidedBy: 'u-checker', ...over }) as any;

describe('TENANT-3b · the threshold is a SETTING, and an unreadable one falls back STRICTER', () => {
  it('reads an integer or a numeric string', () => {
    expect(thresholdFrom(500000)).toEqual({ minor: 500000n, usedDefault: false });
    expect(thresholdFrom('2500000')).toEqual({ minor: 2500000n, usedDefault: false });
    expect(thresholdFrom(0)).toEqual({ minor: 0n, usedDefault: false });     // 0 = EVERY refund needs two people
  });
  it('falls back to the shipped ₹10,000 and SAYS it did — never to an open gate', () => {
    for (const bad of [undefined, null, {}, [], 'lots', '12.50', -1, 1.5, true]) {
      expect(thresholdFrom(bad)).toEqual({ minor: DEFAULT_CHECKER_THRESHOLD_MINOR, usedDefault: true });
    }
    expect(DEFAULT_CHECKER_THRESHOLD_MINOR).toBe(1_000_000n);                // ₹10,000 in paise, W140/W141/W142's figure
  });
  it('"≥ ₹10,000" INCLUDES ₹10,000 — the canon wrote the operator, and the boundary is the whole rule', () => {
    expect(needsChecker(999_999n, 1_000_000n)).toBe(false);
    expect(needsChecker(1_000_000n, 1_000_000n)).toBe(true);
    expect(needsChecker(1_000_001n, 1_000_000n)).toBe(true);
    expect(needsChecker(1n, 0n)).toBe(true);                                 // threshold 0 → always two people
  });
});

describe('TENANT-3b · the gate is a sentence for every state money can be in', () => {
  it('below the threshold, one holder of order.refund acts alone', () => {
    expect(refundGate({ amountMinor: 400_000n, thresholdMinor: 1_000_000n, approval: null }))
      .toEqual({ kind: 'single_signature' });
  });
  it('at/above with nothing proposed asks for a proposal, carrying the threshold that applied', () => {
    expect(refundGate({ amountMinor: 1_282_000n, thresholdMinor: 1_000_000n, approval: null }))
      .toEqual({ kind: 'needs_proposal', thresholdMinor: 1_000_000n });
  });
  it('distinguishes waiting, refused, ready and a CHANGED amount', () => {
    const t = { amountMinor: 1_282_000n, thresholdMinor: 1_000_000n };
    expect(refundGate({ ...t, approval: APPROVED({ status: 'pending', decidedBy: null }) }).kind).toBe('awaiting_checker');
    expect(refundGate({ ...t, approval: APPROVED({ status: 'rejected' }) }).kind).toBe('rejected_by_checker');
    expect(refundGate({ ...t, approval: APPROVED() }).kind).toBe('ready');
    // A signature is for an AMOUNT, not for a case.
    expect(refundGate({ ...t, approval: APPROVED({ amountMinor: 6_410_000n }) }))
      .toEqual({ kind: 'amount_changed', approvalId: 'ra-1', approvedMinor: 6_410_000n });
  });
  it('AN APPLIED APPROVAL OUTRANKS THE THRESHOLD — otherwise a big refund signed once lets a small one through', () => {
    // ₹9,000 sits UNDER the ₹10,000 threshold, so a threshold-first gate would return single_signature and pay
    // a second time on a case that has already been refunded.
    expect(refundGate({ amountMinor: 900_000n, thresholdMinor: 1_000_000n, approval: APPROVED({ status: 'applied' }) }))
      .toEqual({ kind: 'already_applied', approvalId: 'ra-1' });
  });
  it('a checker who somehow equals the maker does NOT open the gate (belt over 0139’s CHECK)', () => {
    expect(refundGate({ amountMinor: 1_282_000n, thresholdMinor: 1_000_000n, approval: APPROVED({ decidedBy: 'u-maker' }) }).kind)
      .toBe('awaiting_checker');
  });
  it('only single_signature and ready let money move; every refusal carries its own CODE', () => {
    expect(() => assertRefundAllowed({ kind: 'single_signature' })).not.toThrow();
    expect(() => assertRefundAllowed({ kind: 'ready', approvalId: 'x' })).not.toThrow();
    const codes = (['needs_proposal', 'awaiting_checker', 'rejected_by_checker', 'amount_changed', 'already_applied'] as const)
      .map((kind) => {
        try { assertRefundAllowed({ kind, approvalId: 'x', thresholdMinor: 1n, approvedMinor: 1n } as any); return 'NO_THROW'; }
        catch (e) { return (e as RefundGateError).code; }
      });
    expect(codes).toEqual(['REFUND_NEEDS_CHECKER', 'REFUND_AWAITING_CHECKER', 'REFUND_REJECTED_BY_CHECKER', 'REFUND_AMOUNT_CHANGED', 'REFUND_ALREADY_APPLIED']);
  });
  it('the maker may not be the checker, and a note has a floor the other party can read', () => {
    expect(() => assertCheckerDistinct('u1', 'u1')).toThrow(RefundGateError);
    expect(() => assertCheckerDistinct('u1', 'u2')).not.toThrow();
    expect(MIN_NOTE_CHARS).toBe(20);
    expect(() => assertNote('ok', 'decision')).toThrow(RefundGateError);
    expect(() => assertNote('   ' + 'x'.repeat(19), 'proposal')).toThrow(RefundGateError);   // trimmed, not padded
    expect(assertNote('  Transporter loss confirmed by weighbridge slip.  ', 'proposal'))
      .toBe('Transporter loss confirmed by weighbridge slip.');
  });
});

describe('TENANT-3b · W141’s money card tells the truth about what is actually held', () => {
  const gross = 6_410_000n;
  it('escrow holding the order gross is the common case, and the disputed part is only PART of what is held', () => {
    const v = disputeMoneyState({ paymentGrossMinor: gross, settled: false, disputedAmountMinor: 1_282_000n, disputedQuantity: '2.000' });
    expect(v.basis).toBe('escrow_holds_order_gross');
    expect(v.heldMinor).toBe(gross);                       // NOT the disputed figure — the canon's sentence is not true here
    expect(v.undisputedMinor).toBe(5_128_000n);
    expect(v.undisputedHeldToo).toBe(true);                // the sentence W141 does not have
    expect(PARTIAL_FREEZE_BUILT).toBe(false);              // and the flag that says why, in one place
  });
  it('a settled order holds NOTHING — a refund claws it back instead', () => {
    const v = disputeMoneyState({ paymentGrossMinor: gross, settled: true, disputedAmountMinor: 1_282_000n, disputedQuantity: null });
    expect(v.basis).toBe('settled_to_seller_before_dispute');
    expect(v.heldMinor).toBe(0n);
    expect(v.undisputedHeldToo).toBe(false);
  });
  it('no captured payment is zero BECAUSE, not zero-with-no-reason', () => {
    const v = disputeMoneyState({ paymentGrossMinor: null, settled: false, disputedAmountMinor: 1_282_000n, disputedQuantity: null });
    expect(v.basis).toBe('no_escrowed_payment');
    expect(v.undisputedMinor).toBeNull();
    expect(v.maxRefundableMinor).toBeNull();               // nothing to bound a refund by → the API refuses
  });
  it('AN UNRECORDED SCOPE IS NEITHER ZERO NOR THE ORDER TOTAL', () => {
    const v = disputeMoneyState({ paymentGrossMinor: gross, settled: false, disputedAmountMinor: null, disputedQuantity: null });
    expect(v.scope).toEqual({ kind: 'not_recorded' });
    expect(v.undisputedMinor).toBeNull();                  // no arithmetic on a number nobody wrote
    expect(v.undisputedHeldToo).toBe(false);
    expect(v.maxRefundableMinor).toBe(gross);              // ceiling is the payment; the API makes a human type the figure
  });
  it('a disputed amount LARGER than the payment is refused as unknowable rather than clamped silently', () => {
    const v = disputeMoneyState({ paymentGrossMinor: 100n, settled: false, disputedAmountMinor: 500n, disputedQuantity: null });
    expect(v.undisputedMinor).toBeNull();
    expect(v.maxRefundableMinor).toBe(100n);               // never more than was paid
  });
  it('the refund ceiling is the SMALLER of the payment and the recorded claim', () => {
    expect(maxRefundable(gross, { kind: 'recorded', amountMinor: 1_282_000n, quantity: null })).toBe(1_282_000n);
    expect(maxRefundable(1_000n, { kind: 'recorded', amountMinor: 9_000n, quantity: null })).toBe(1_000n);
    expect(maxRefundable(null, { kind: 'recorded', amountMinor: 9_000n, quantity: null })).toBeNull();
  });
});

describe('TENANT-3b · W140’s four tabs are EXHAUSTIVE over the seven-state machine', () => {
  it('every status the machine knows maps to exactly one tab — a dispute in no tab is one nobody works', () => {
    expect(DISPUTE_STATUSES.filter((s) => viewOfDisputeStatus(s) === null)).toEqual([]);
  });
  it('the mapping is a partition: no status in two tabs, and the union is the machine', () => {
    const all = DISPUTE_VIEWS.flatMap((v) => statusesInDisputeView(v));
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(DISPUTE_STATUSES));
  });
  it('open AND seller_responded are both "needs response" — both sit on the tenant’s desk', () => {
    expect(statusesInDisputeView('needs_response')).toEqual(['open', 'seller_responded']);
    expect(statusesInDisputeView('closed')).toEqual(['rejected', 'resolved', 'withdrawn']);
  });
  it('an unknown status returns null rather than a default tab — a wrong tab hides a dispute', () => {
    expect(viewOfDisputeStatus('teleported')).toBeNull();
  });
  it('REPLACEMENT IS NOT A WIN FOR ANYBODY, and a withdrawal is not a decision', () => {
    expect(outcomeSide('refund_partial', 'resolved')).toBe('raiser');
    expect(outcomeSide('refund_full', 'resolved')).toBe('raiser');
    expect(outcomeSide('replacement', 'resolved')).toBe('amicable');
    expect(outcomeSide('rejected', 'rejected')).toBe('respondent');
    expect(outcomeSide(null, 'withdrawn')).toBe('no_decision');
    expect(outcomeSide('refund_full', 'withdrawn')).toBe('no_decision');   // withdrawal wins over a stale column
    expect(outcomeSide(null, 'resolved')).toBe('no_decision');
  });
  it('the SLA clock exists only where a clock is real', () => {
    const now = new Date('2026-07-13T14:00:00Z');
    expect(slaClock('open', '2026-07-13T23:00:00Z', now)).toEqual({ kind: 'left', minutes: 540 });
    expect(slaClock('open', '2026-07-13T13:00:00Z', now)).toEqual({ kind: 'overdue', minutes: 60 });
    expect(slaClock('escalated', '2026-07-13T23:00:00Z', now)).toBeNull();   // the platform owns that clock
    expect(slaClock('resolved', '2026-07-13T23:00:00Z', now)).toBeNull();
    expect(slaClock('open', null, now)).toBeNull();
    expect(slaClock('teleported', '2026-07-13T23:00:00Z', now)).toBeNull();
  });
});

describe('TENANT-3b · the two aggregate rules 0139 made enforceable', () => {
  const mkReturn = (over: any = {}) => Return.request({ id: 'r1', tenantId: 't1', orderId: 'o1', ...over });
  const received = (over: any = {}) => { const r = mkReturn(over); r.approve(); r.ship(); r.receive(); return r; };

  it('A REFUND REFUSES ON AN UNINSPECTED PARCEL — W142’s "inspect within 24h → refund", enforced', () => {
    const r = received({ refundAmountMinor: 418_000n });
    expect(() => r.refund(null)).toThrow(InvalidReturnError);
    r.inspect('u-staff', 'Opened the box: wrong fittings, 1/2 inch instead of 3/4.');
    expect(() => r.refund('txn-9')).not.toThrow();
    expect(r.status).toBe('refunded');
  });
  it('and refuses without a RECORDED AMOUNT rather than assuming the order total', () => {
    const r = received();
    r.inspect('u-staff', 'Opened the box: wrong fittings, 1/2 inch instead of 3/4.');
    expect(() => r.refund(null)).toThrow(InvalidReturnError);
  });
  it('an inspection is only possible on a RECEIVED return, and its note has a floor', () => {
    const fresh = mkReturn({ refundAmountMinor: 100n });
    expect(() => fresh.inspect('u', 'Opened the box and found the wrong item inside.')).toThrow(InvalidReturnError);
    const r = received({ refundAmountMinor: 100n });
    expect(() => r.inspect('u', 'looks fine')).toThrow(InvalidReturnError);
    r.inspect('u', 'Seal intact, contents match, resalable.');
    expect(r.inspectedAt).toBeInstanceOf(Date);
    expect(r.pullEvents().map((e) => e.type)).toContain('disputes.return_inspected');
  });
  it('a dispute’s recorded scope must be positive, and a refund may not exceed it', () => {
    expect(() => Dispute.raise({ id: 'd', tenantId: 't', orderId: 'o', raisedBy: 'a', againstUser: 'b', reasonId: 'r', disputedAmountMinor: 0n }))
      .toThrow(InvalidDisputeError);
    const d = Dispute.raise({ id: 'd', tenantId: 't', orderId: 'o', raisedBy: 'a', againstUser: 'b', reasonId: 'r', disputedAmountMinor: 1_282_000n });
    expect(() => d.resolve('mod', 'refund_partial', 6_410_000n)).toThrow(InvalidDisputeError);
    d.resolve('mod', 'refund_partial', 1_282_000n);
    expect(d.status).toBe('resolved');
  });
  it('an UNSCOPED dispute is not bounded by the entity — the service bounds it by the payment instead', () => {
    const d = Dispute.raise({ id: 'd', tenantId: 't', orderId: 'o', raisedBy: 'a', againstUser: 'b', reasonId: 'r' });
    expect(() => d.resolve('mod', 'refund_partial', 6_410_000n)).not.toThrow();
  });
});

describe('TENANT-3b · the console reads', () => {
  class StubPool {
    calls: Array<{ sql: string; params: unknown[] }> = [];
    rows: any[] = [];
    async query(sql: string, params: unknown[] = []) { this.calls.push({ sql, params }); return { rows: this.rows, rowCount: this.rows.length }; }
  }
  const rm = (pool: StubPool) => new DisputeConsoleReadModel({ forTenant: async () => pool } as any);

  it('tab counts fold statuses through the ONE mapping and count the unmapped rather than dropping them', async () => {
    const pool = new StubPool();
    pool.rows = [{ status: 'open', n: 2 }, { status: 'escalated', n: 1 }, { status: 'teleported', n: 4 }];
    const out = await rm(pool).viewCounts('t1');
    expect(out.needs_response).toBe(2);
    expect(out.escalated).toBe(1);
    expect(out.unmapped).toBe(4);
    expect(out.all).toBe(7);
  });

  it('the queue filters by the tab’s status SET, keyset only, and surfaces a pending approval', async () => {
    const pool = new StubPool();
    await rm(pool).queue('t1', { view: 'needs_response', cursor: { c: '2026-07-01', id: 'x' }, limit: 50 });
    const { sql, params } = pool.calls[0];
    expect(sql).toContain('d.status = ANY(');
    expect(params).toContainEqual(['open', 'seller_responded']);
    expect(sql).toContain('d.created_at <');
    expect(sql.toUpperCase()).not.toContain('OFFSET');
    expect(sql).toContain("ra.status = 'pending'");
    expect(sql).toContain('disputed_amount_minor');
  });

  it('the money read joins payments BY (reference_type, reference_id) — an order_id column does not exist there', async () => {
    const pool = new StubPool();
    await rm(pool).moneyFacts('t1', 'd-1');
    const { sql } = pool.calls[0];
    expect(sql).toContain("pm.reference_type = 'order'");
    expect(sql).toContain('pm.reference_id = d.order_id');
    expect(sql).not.toMatch(/pm\.order_id/);
    expect(sql).toContain('FROM settlement_lines');
  });

  it('the median is taken over RESOLVED rows only — a withdrawal has no resolution time to average', async () => {
    const pool = new StubPool();
    await rm(pool).kpis('t1');
    const { sql } = pool.calls[0];
    expect(sql).toContain('percentile_cont(0.5)');
    // The guard that matters: the median subquery excludes NULL durations, so withdrawals cannot flatter it.
    const median = sql.slice(sql.indexOf('percentile_cont(0.5)'));
    expect(median.slice(0, median.indexOf('AS median_secs'))).toContain('WHERE secs IS NOT NULL');
    // And replacements are counted in their OWN column rather than folded into either side.
    expect(sql).toContain("resolution_type = 'replacement'");
    expect((sql.match(/COUNT\(\*\)::int FROM closed WHERE/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('the returns queue carries the amount, the inspection and the pending approval', async () => {
    const pool = new StubPool();
    await rm(pool).returnsQueue('t1', { status: 'received', cursor: null, limit: 20 });
    const { sql } = pool.calls[0];
    expect(sql).toContain('refund_amount_minor');
    expect(sql).toContain('r.inspected_at');
    expect(sql).toContain("ra.subject_type = 'return'");
    expect(sql.toUpperCase()).not.toContain('OFFSET');
  });
});

describe('TENANT-3b · the schema and the wiring say what the wave claims (comments stripped)', () => {
  const root = path.join(__dirname, '..', '..', '..', '..', '..', '..');
  const sql = fs.readFileSync(path.join(root, 'db', 'migrations', '0139_dispute_refund_gate.sql'), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('0139 seeds `order.refund` — the permission W142 and W133 name and NO file granted', () => {
    expect(sql).toContain("'order.refund'");
    expect(sql).toContain('INSERT INTO role_permissions');
    // and NOT to support_agent: deciding a case is not releasing the cash (0139 §139.4)
    expect(sql).not.toContain("r.code = 'support_agent'");
  });
  it('the maker-checker CHECK exists with the NULL escape a pending proposal needs', () => {
    expect(sql).toContain('ck_refund_approval_maker_ne_checker');
    expect(sql).toContain('decided_by IS NULL OR decided_by <> proposed_by');
  });
  it('one OPEN and one APPLIED proposal per subject — the race guard and the double-refund guard', () => {
    expect(sql).toContain('uq_refund_approval_open');
    expect(sql).toContain('uq_refund_approval_applied');
    expect((sql.match(/WHERE status = 'applied' AND deleted_at IS NULL/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
  it('the threshold is a money_path SETTING, not a constant', () => {
    expect(sql).toContain("'disputes.refund_checker_threshold_minor'");
    expect(sql).toContain("'money_path'");
    expect(sql).toContain("'1000000'::jsonb");
  });
  it('THE NULL-LOGIC GUARDS: a CHECK that evaluates to NULL passes, so every text floor names its column', () => {
    // Found by applying 0139 to a real Postgres and trying the thing it forbids: `status='rejected'` with a NULL
    // decision_note committed cleanly, because `false OR NULL` is NULL and a NULL CHECK is satisfied. Both floors
    // now assert the column IS NOT NULL first. Without these two clauses the constraints are comments.
    expect(sql).toContain('decision_note IS NOT NULL AND char_length(btrim(decision_note)) >= 20');
    expect(sql).toContain('inspection_note IS NOT NULL AND char_length(btrim(inspection_note)) >= 20');
    expect(sql).toContain('proposal_note IS NOT NULL AND char_length(btrim(proposal_note)) >= 20');
  });
  it('a refund on a return needs an inspection, and neither column is backfilled', () => {
    expect(sql).toContain('ck_returns_refunded_needs_inspection');
    expect(sql).toContain('ck_returns_inspection_shape');
    expect(sql).not.toMatch(/UPDATE returns SET refund_amount_minor\s*=/);
    expect(sql).not.toMatch(/UPDATE disputes SET disputed_amount_minor\s*=/);
  });
  it('0139 REFUSES to store the frozen figure — the ledger is the only copy', () => {
    expect(sql).not.toContain('frozen_amount_minor');
  });
  it('the return refund event finally has a subscriber, and the stamp has a handler', () => {
    const mod = read('disputes.module.ts');
    expect(mod).toContain('ReturnRefundedStampHandler');
    expect(mod).toContain('this.registry.register(this.returnRefundedStamp)');
    const payments = strip(fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'modules', 'payments', 'payments.module.ts'), 'utf8'));
    expect(payments).toContain('this.registry.register(this.returnRefunded)');
    const handler = strip(fs.readFileSync(path.join(root, 'apps', 'api', 'src', 'modules', 'payments', 'events', 'handlers', 'return-refunded.handler.ts'), 'utf8'));
    expect(handler).toContain("readonly eventType = 'disputes.return_refunded'");
    expect(handler).toContain("isEnabled('dispute_refunds'");            // Law 10: default OFF
    expect(handler).toContain('return-refund:');                          // Law 3: idempotent money
    expect(handler).toContain('RETURN_REFUND_AFTER_STATEMENT');           // refuses rather than guessing
  });
  it('the resolve path requires order.refund for a refund and consults the gate before the entity', () => {
    const svc = read('services', 'dispute.service.ts');
    expect(svc).toContain("requires order.refund");
    expect(svc).toContain('assertRefundAllowed');
    expect(svc).toContain('markApplied');
    // The figure is required BEFORE the gate — a refund_full with no amount used to bypass any threshold.
    expect(svc).toContain('state the refund amount explicitly');
  });
});
