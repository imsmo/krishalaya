// PC-56 TENANT-4c · W147/W148 — the settlement cycle that did not exist, the close two people sign, and the
// honest arithmetic that replaces "generates 186 statements atomically".
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CYCLE_STATUSES, DEFAULT_CYCLE_LENGTH, NOTE_FLOOR, approveRefusal, assertOrgStatement, buildOrgStatement,
  canTransition, deductionBasis, isClosedMonth, isCompletable, isCycleLength, isMonthPeriod, netReconciles,
  nextPeriod, periodFor, periodHasEnded, progressOf, rejectRefusal, requestRefusal, seriesPeriod,
  statementDayCount, statementPeriodKind, type CycleForDecision,
} from '../domain/settlement-cycle';

const NOW = new Date('2026-07-16T06:00:00Z');
const cyc = (over: Partial<CycleForDecision> = {}): CycleForDecision => ({
  id: 'c1', status: 'open', periodStart: '2026-07-01', periodEnd: '2026-07-15',
  requestedBy: null, sellersExpected: null, statementsGenerated: 0, ...over,
});

describe('TENANT-4c · the cycle state machine', () => {
  it('OPEN CANNOT REACH CLOSING — no code path can generate a cycle nobody signed', () => {
    expect(canTransition('open', 'closing')).toBe(false);
    expect(canTransition('open', 'pending_close')).toBe(true);
    expect(canTransition('pending_close', 'closing')).toBe(true);
    expect(canTransition('pending_close', 'rejected')).toBe(true);
    expect(canTransition('closing', 'closed')).toBe(true);
  });
  it('a closed cycle is terminal, and a rejected close returns the period to open', () => {
    expect(canTransition('closed', 'open')).toBe(false);
    expect(canTransition('closed', 'closing')).toBe(false);
    expect(canTransition('rejected', 'open')).toBe(true);
    expect(canTransition('rejected', 'closing')).toBe(false);
    expect([...CYCLE_STATUSES]).toEqual(['open', 'pending_close', 'closing', 'closed', 'rejected']);
  });
});

describe('TENANT-4c · the period is a SETTING, not a hardcoded fortnight', () => {
  it('fortnightly splits the month at the 15th, and the second half ends on the real last day', () => {
    expect(DEFAULT_CYCLE_LENGTH).toBe('fortnightly');
    expect(periodFor(new Date('2026-07-08T00:00:00Z'), 'fortnightly')).toEqual({ startIso: '2026-07-01', endIso: '2026-07-15' });
    expect(periodFor(new Date('2026-07-16T00:00:00Z'), 'fortnightly')).toEqual({ startIso: '2026-07-16', endIso: '2026-07-31' });
    // February, and a leap February — a 32nd never appears.
    expect(periodFor(new Date('2026-02-20T00:00:00Z'), 'fortnightly')).toEqual({ startIso: '2026-02-16', endIso: '2026-02-28' });
    expect(periodFor(new Date('2028-02-20T00:00:00Z'), 'fortnightly')).toEqual({ startIso: '2028-02-16', endIso: '2028-02-29' });
  });
  it('monthly is the whole month, and an unknown length is not silently honoured', () => {
    expect(periodFor(new Date('2026-07-08T00:00:00Z'), 'monthly')).toEqual({ startIso: '2026-07-01', endIso: '2026-07-31' });
    expect(isCycleLength('weekly')).toBe(false);
    expect(isCycleLength('monthly')).toBe(true);
  });
  it('the next period follows without a gap or an overlap, across a year boundary', () => {
    expect(nextPeriod({ startIso: '2026-07-01', endIso: '2026-07-15' }, 'fortnightly')).toEqual({ startIso: '2026-07-16', endIso: '2026-07-31' });
    expect(nextPeriod({ startIso: '2026-12-16', endIso: '2026-12-31' }, 'fortnightly')).toEqual({ startIso: '2027-01-01', endIso: '2027-01-15' });
  });
  it('THE PERIOD ENDS AT THE END OF ITS LAST DAY, not at its start', () => {
    const p = { startIso: '2026-07-01', endIso: '2026-07-15' };
    expect(periodHasEnded(p, new Date('2026-07-15T23:59:00Z'))).toBe(false);
    expect(periodHasEnded(p, new Date('2026-07-16T00:00:00Z'))).toBe(true);
  });
  it('both halves of a month share one number series, so numbering reads continuously', () => {
    expect(seriesPeriod({ startIso: '2026-07-01', endIso: '2026-07-15' })).toBe('2026-07');
    expect(seriesPeriod({ startIso: '2026-07-16', endIso: '2026-07-31' })).toBe('2026-07');
  });
});

describe('TENANT-4c · the close is two acts by two people', () => {
  it('a close cannot be requested before the period ends, or over nobody', () => {
    expect(requestRefusal(cyc(), 5, new Date('2026-07-15T12:00:00Z'))).toBe('SETTLEMENT_CYCLE_PERIOD_NOT_ENDED');
    expect(requestRefusal(cyc(), 0, NOW)).toBe('SETTLEMENT_CYCLE_NOTHING_TO_SETTLE');
    expect(requestRefusal(cyc({ status: 'pending_close' }), 5, NOW)).toBe('SETTLEMENT_CYCLE_NOT_OPEN');
    expect(requestRefusal(cyc(), 5, NOW)).toBeNull();
  });
  it('THE REQUESTER MAY NEVER APPROVE — unconditionally, with no threshold anywhere', () => {
    const pending = cyc({ status: 'pending_close', requestedBy: 'u-maker' });
    expect(approveRefusal(pending, 'u-maker')).toBe('SETTLEMENT_CYCLE_CHECKER_IS_REQUESTER');
    expect(approveRefusal(pending, 'u-checker')).toBeNull();
    expect(approveRefusal(cyc({ status: 'open' }), 'u-checker')).toBe('SETTLEMENT_CYCLE_NOT_PENDING');
  });
  it('a rejection needs its reason — and MAY be made by the requester, so a mistake is fixable', () => {
    const pending = cyc({ status: 'pending_close', requestedBy: 'u-maker' });
    expect(rejectRefusal(pending, 'too short')).toBe('SETTLEMENT_CYCLE_NOTE_TOO_SHORT');
    expect(rejectRefusal(pending, 'Two sellers are missing their QC results for this fortnight')).toBeNull();
    expect(NOTE_FLOOR).toBe(20);
    expect(rejectRefusal(cyc({ status: 'closed' }), 'x'.repeat(30))).toBe('SETTLEMENT_CYCLE_NOT_PENDING');
  });
});

describe('TENANT-4c · progress, which is what "atomically" becomes', () => {
  it('the count climbs, and a remainder is stated rather than implied', () => {
    expect(progressOf({ status: 'closing', sellersExpected: null, statementsGenerated: 0 })).toEqual({ kind: 'not_started' });
    expect(progressOf({ status: 'closing', sellersExpected: 186, statementsGenerated: 184 }))
      .toEqual({ kind: 'generating', generated: 184, expected: 186, remaining: 2 });
    expect(progressOf({ status: 'closing', sellersExpected: 186, statementsGenerated: 186 })).toEqual({ kind: 'complete', generated: 186 });
  });
  it('MORE STATEMENTS THAN EXPECTED IS ITS OWN CASE, not rounded down to "complete"', () => {
    expect(progressOf({ status: 'closing', sellersExpected: 186, statementsGenerated: 187 }))
      .toEqual({ kind: 'over_generated', generated: 187, expected: 186 });
  });
  it('THE STATUS CANNOT OUTRUN THE DOCUMENTS: a cycle completes only when the work is done', () => {
    expect(isCompletable({ status: 'closing', sellersExpected: 186, statementsGenerated: 185 })).toBe(false);
    expect(isCompletable({ status: 'closing', sellersExpected: 186, statementsGenerated: 186 })).toBe(true);
    expect(isCompletable({ status: 'closing', sellersExpected: 186, statementsGenerated: 187 })).toBe(true);
    // ...and only from `closing` — a cycle nobody approved cannot be marked closed.
    expect(isCompletable({ status: 'pending_close', sellersExpected: 0, statementsGenerated: 0 })).toBe(false);
    expect(isCompletable({ status: 'open', sellersExpected: null, statementsGenerated: 0 })).toBe(false);
  });
});

describe('TENANT-4c · W147\'s deduction columns say WHY they read zero', () => {
  it('buyer-charged, seller-charged and NO RULE RESOLVED are three different facts', () => {
    expect(deductionBasis('buyer')).toBe('charged_to_buyer');
    expect(deductionBasis('seller')).toBe('charged_to_seller');
    expect(deductionBasis(null)).toBe('no_rule_resolved');
    expect(deductionBasis(undefined)).toBe('no_rule_resolved');
    expect(deductionBasis('')).toBe('no_rule_resolved');
  });
  it('gross − commission − tax = net is CHECKED, not trusted', () => {
    expect(netReconciles({ grossMinor: '10842000', commissionMinor: '0', taxMinor: '0', netMinor: '10842000' })).toBe(true);
    expect(netReconciles({ grossMinor: '10842000', commissionMinor: '100', taxMinor: '0', netMinor: '10842000' })).toBe(false);
    expect(netReconciles({ grossMinor: '1000', commissionMinor: '100', taxMinor: '50', netMinor: '850' })).toBe(true);
  });
});

describe('TENANT-4c · a pre-wave statement is named for what it is', () => {
  it('a statement with no cycle is a DAILY document, never relabelled as a cycle one', () => {
    expect(statementPeriodKind({ cycleId: 'c1', periodStart: '2026-07-01', periodEnd: '2026-07-15' })).toBe('cycle');
    expect(statementPeriodKind({ cycleId: null, periodStart: '2026-07-14', periodEnd: '2026-07-14' })).toBe('legacy_daily');
  });
  it('the day count is inclusive, and junk dates do not become a plausible span', () => {
    expect(statementDayCount({ periodStart: '2026-07-01', periodEnd: '2026-07-15' })).toBe(15);
    expect(statementDayCount({ periodStart: '2026-07-14', periodEnd: '2026-07-14' })).toBe(1);
    expect(statementDayCount({ periodStart: '2026-07-15', periodEnd: '2026-07-01' })).toBe(0);
    expect(statementDayCount({ periodStart: 'nope', periodEnd: '2026-07-01' })).toBe(0);
  });
});

describe('TENANT-4c · the ORG statement is derived, and refuses if it does not reconcile', () => {
  const lines = [
    { txnType: 'commission_earn', creditMinor: '6348000', debitMinor: '0', count: 12 },
    { txnType: 'payout', creditMinor: '0', debitMinor: '4466000', count: 30 },
  ];
  it('opening + credits − debits must equal closing', () => {
    const ok = buildOrgStatement({ period: '2026-06', openingMinor: '1000000', closingMinor: '2882000', lines });
    expect(ok.reconciles).toBe(true);
    expect(ok.basis).toBe('derived_from_ledger');
    expect(assertOrgStatement(ok)).toBe(ok);
  });
  it('A STATEMENT WHOSE ARITHMETIC DOES NOT CLOSE IS NOT ISSUED', () => {
    const bad = buildOrgStatement({ period: '2026-06', openingMinor: '1000000', closingMinor: '9999999', lines });
    expect(bad.reconciles).toBe(false);
    expect(() => assertOrgStatement(bad)).toThrow();
    try { assertOrgStatement(bad); } catch (e) {
      expect((e as { code?: string }).code).toBe('ORG_STATEMENT_DOES_NOT_RECONCILE');
    }
  });
  it('an OPEN month is refused — a statement of a running month changes after it is handed over', () => {
    expect(isMonthPeriod('2026-06')).toBe(true);
    expect(isMonthPeriod('2026-13')).toBe(false);
    expect(isClosedMonth('2026-06', new Date('2026-07-01T00:00:00Z'))).toBe(true);
    expect(isClosedMonth('2026-07', new Date('2026-07-31T23:59:00Z'))).toBe(false);
    expect(isClosedMonth('2026-13', new Date('2027-01-01T00:00:00Z'))).toBe(false);
  });
});

describe('TENANT-4c · the service generates in bounded, resumable passes', () => {
  const svc = fs.readFileSync(path.join(__dirname, '..', 'services', 'settlement-cycle.service.ts'), 'utf8');
  it('one transaction PER SELLER, bounded per pass — never one transaction for the whole cycle', () => {
    expect(svc).toContain('GENERATION_BATCH');
    expect(svc).toContain('this.statements.generate(');
    // The pass loops sellers and calls the existing idempotent generator; it does not wrap them all.
    const body = svc.slice(svc.indexOf('async generatePass'));
    expect(body).toMatch(/for \(const s of sellers\)/);
    expect(body).not.toMatch(/uow\.run\([^)]*\)\s*=>\s*\{[\s\S]{0,200}for \(const s of sellers\)/);
  });
  it('generation happens ONLY after an approved close, and the cycle closes only when complete', () => {
    const body = svc.slice(svc.indexOf('async generatePass'));
    expect(body).toContain("c.status !== 'closing'");
    expect(body).toContain('SETTLEMENT_CYCLE_NOT_CLOSING');
    expect(body).toContain('isCompletable(');
    expect(body).toContain('markClosed');
  });
  it('the period passed to the generator INCLUDES the cycle\'s last day', () => {
    const body = svc.slice(svc.indexOf('async generatePass'));
    // [from, to) with to = last day + 1: a fortnight ending on the 15th must contain the 15th.
    expect(body).toContain('+ 86_400_000');
  });
  it('one seller failing does not stop the cycle, and is counted rather than swallowed', () => {
    const body = svc.slice(svc.indexOf('async generatePass'));
    expect(body).toContain('failed += 1');
    expect(body).toContain('payments.settlement_statement_failed');
  });
  it('the checker rule is enforced in the service as well as the schema', () => {
    expect(svc).toContain('approveRefusal(');
    expect(svc).toContain('SETTLEMENT_CYCLE_CHECKER_IS_REQUESTER');
    expect(svc).toContain('getForUpdate');
  });
});

describe('TENANT-4c · every query is tenant-scoped (the repository funnel)', () => {
  const repo = fs.readFileSync(path.join(__dirname, '..', 'repositories', 'settlement-cycle.repository.ts'), 'utf8');
  const code = repo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const stmts = code.split(/(?=`\s*(?:SELECT|INSERT|UPDATE))/).filter((s) => /SELECT|INSERT|UPDATE/.test(s));

  it('every statement touching a tenant table binds tenant_id', () => {
    const touching = stmts.filter((s) => /settlement_cycles|settlement_statements|settlement_lines|commission_rules|wallet_accounts/.test(s));
    expect(touching.length).toBeGreaterThanOrEqual(8);
    // Every dynamic WHERE in this file must START from the tenant, so an interpolated predicate cannot be
    // the one that forgot it — this is the assertion TENANT-4b's `WHERE 1=1` would have failed.
    for (const w of code.match(/let where = `[^`]*`/g) ?? []) expect(w).toMatch(/tenant_id\s*=\s*\$1/);
    for (const s of touching) {
      expect(s).toMatch(/tenant_id\s*=\s*\$|owner_tenant_id\s*=\s*\$|tenant_id\)?\s*VALUES|tenant_id,|\$\{where\}/);
    }
  });
  it('the ledger read for the org statement joins the TENANT\'s own accounts', () => {
    const org = code.slice(code.indexOf('orgMonthMovements'));
    expect((org.match(/owner_kind='tenant' AND a\.owner_tenant_id=\$1/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it('there is no OFFSET, and nothing deletes a cycle or a statement', () => {
    expect(code).not.toMatch(/\bOFFSET\b/i);
    expect(code).not.toMatch(/DELETE FROM/);
  });
});

describe('TENANT-4c · 0144 says what the wave claims (comments stripped)', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', '..', '..', 'db', 'migrations', '0144_settlement_cycle_close.sql'), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

  it('the cycle table exists with its maker, checker, note and counts', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS settlement_cycles');
    for (const c of ['requested_by', 'decided_by', 'decision_note', 'sellers_expected', 'statements_generated']) expect(sql).toContain(c);
  });
  it('CHECKER <> REQUESTER and the note floor both assert NOT NULL FIRST (0139\'s lesson)', () => {
    expect(sql).toContain('requested_by IS NOT NULL AND decided_by <> requested_by');
    expect(sql).toContain('decision_note IS NOT NULL AND char_length(btrim(decision_note)) >= 20');
  });
  it('THE STATUS CANNOT OUTRUN THE DOCUMENTS — the schema repeats it', () => {
    expect(sql).toContain('ck_settlement_cycle_closed_complete');
    expect(sql).toContain('statements_generated >= sellers_expected');
  });
  it('one cycle per period and one live cycle per tenant', () => {
    expect(sql).toContain('uq_settlement_cycle_period');
    expect(sql).toContain('uq_settlement_cycle_live');
  });
  it('EXACTLY ONE STATEMENT PER SELLER PER PERIOD becomes a unique index, not an argument', () => {
    expect(sql).toContain('uq_settlement_statement_seller_period');
    expect(sql).toContain('ON settlement_statements (tenant_id, seller_user_id, period_start, period_end)');
  });
  it('the permission W147 names twice is seeded and granted, without 4a\'s roles.tenant_id mistake', () => {
    expect(sql).toContain("('settlement.close'");
    expect(sql).toContain("r.code = 'tenant_admin'");
    expect(sql).not.toMatch(/r\.tenant_id IS NULL/);
  });
  it('the cycle length is a SETTING and the behaviour change is behind a FLAG', () => {
    expect(sql).toContain('settlements.cycle_length');
    expect(sql).toContain("'settlement_cycles'");
    expect(sql).toMatch(/feature_flags[\s\S]*false/);
  });
  it('RLS with a write check, and a cycle is never deleted', () => {
    expect(sql).toContain('ALTER TABLE settlement_cycles ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('WITH CHECK (tenant_id = current_tenant_id())');
    expect(sql).toContain('REVOKE DELETE, TRUNCATE ON settlement_cycles FROM kv_app');
  });
  it('and it adds the index a tenant-wide statements list had never had', () => {
    expect(sql).toContain('idx_settlement_statement_tenant_created');
  });
});
