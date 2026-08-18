// PC-56 TENANT-4c · W147's cycle and W148's statements — the console rules, and the pages' own promises
// pinned against their source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  CYCLE_STATUSES, NOTE_FLOOR, approveBlockedBy, canGenerate, closedMonths, cycleStatusKey, deductionNoteKey,
  hasPeriodEnded, isClosedMonth, isMonthPeriod, isNoteLongEnough, pdfStateKey, periodKindKey, periodLabel,
  progressKey, refusalKey, rejectBlockedBy, requestBlockedBy, rowNeedsAttention,
} from '../features/settlements/console';

const NOW = new Date('2026-07-16T06:00:00Z');

describe('TENANT-4c · the cycle card', () => {
  it('every status has its own word, and an unknown one is not dressed as a known one', () => {
    expect([...CYCLE_STATUSES]).toEqual(['open', 'pending_close', 'closing', 'closed', 'rejected']);
    expect(cycleStatusKey('closing')).toBe('stl.status.closing');
    expect(cycleStatusKey('something_new')).toBe('stl.status.unknown');
  });
  it('the period reads as a span of days, and ends at the END of its last day', () => {
    expect(periodLabel('2026-07-01', '2026-07-15')).toBe('2026-07-01 → 2026-07-15');
    expect(hasPeriodEnded('2026-07-15', new Date('2026-07-15T23:59:00Z'))).toBe(false);
    expect(hasPeriodEnded('2026-07-15', NOW)).toBe(true);
    expect(hasPeriodEnded('nope', NOW)).toBe(false);
  });
});

describe('TENANT-4c · progress replaces "atomically"', () => {
  it('each progress kind has its own sentence, including the over-generated case', () => {
    expect(progressKey({ kind: 'not_started' })).toBe('stl.progress.notStarted');
    expect(progressKey({ kind: 'generating', generated: 184, expected: 186, remaining: 2 })).toBe('stl.progress.generating');
    expect(progressKey({ kind: 'complete', generated: 186 })).toBe('stl.progress.complete');
    expect(progressKey({ kind: 'over_generated', generated: 187, expected: 186 })).toBe('stl.progress.overGenerated');
  });
  it('ANOTHER PASS IS OFFERED ONLY WHILE THERE IS WORK, and only on an approved close', () => {
    expect(canGenerate('closing', { kind: 'generating', generated: 1, expected: 5, remaining: 4 })).toBe(true);
    expect(canGenerate('closing', { kind: 'not_started' })).toBe(true);
    expect(canGenerate('closing', { kind: 'complete', generated: 5 })).toBe(false);
    expect(canGenerate('pending_close', { kind: 'not_started' })).toBe(false);
    expect(canGenerate('open', { kind: 'not_started' })).toBe(false);
  });
});

describe('TENANT-4c · who may close, and when', () => {
  const open = { status: 'open', periodEnd: '2026-07-15', sellerCount: 186 };
  it('permission, then state, then the clock, then whether there is anything to settle', () => {
    expect(requestBlockedBy(open, { canClose: false }, NOW)).toBe('noPermission');
    expect(requestBlockedBy({ ...open, status: 'closed' }, { canClose: true }, NOW)).toBe('notOpen');
    expect(requestBlockedBy(open, { canClose: true }, new Date('2026-07-14T00:00:00Z'))).toBe('periodNotEnded');
    expect(requestBlockedBy({ ...open, sellerCount: 0 }, { canClose: true }, NOW)).toBe('nothingToSettle');
    expect(requestBlockedBy(open, { canClose: true }, NOW)).toBeNull();
  });
  it('THE REQUESTER IS TOLD THEY CANNOT ALSO APPROVE, rather than shown a button that fails', () => {
    const pending = { status: 'pending_close', requestedBy: 'u-maker' };
    expect(approveBlockedBy(pending, 'u-maker', { canClose: true })).toBe('youRequested');
    expect(approveBlockedBy(pending, 'u-checker', { canClose: true })).toBeNull();
    expect(approveBlockedBy(pending, null, { canClose: true })).toBeNull();     // viewer unknown: the API decides
    expect(approveBlockedBy({ status: 'open', requestedBy: null }, 'u', { canClose: true })).toBe('notPending');
  });
  it('rejecting is always offered to a holder of the key — including the requester', () => {
    expect(rejectBlockedBy({ status: 'pending_close' }, { canClose: true })).toBeNull();
    expect(rejectBlockedBy({ status: 'closed' }, { canClose: true })).toBe('notPending');
    expect(rejectBlockedBy({ status: 'pending_close' }, { canClose: false })).toBe('noPermission');
  });
  it('the note floor is the same 20 characters as every other note in this programme', () => {
    expect(NOTE_FLOOR).toBe(20);
    expect(isNoteLongEnough('short')).toBe(false);
    expect(isNoteLongEnough('  ' + 'x'.repeat(20) + ' ')).toBe(true);
  });
});

describe('TENANT-4c · the deduction columns and the seller rows', () => {
  it('NO RULE RESOLVED IS NOT PRESENTED AS "buyers pay"', () => {
    expect(deductionNoteKey('charged_to_buyer')).toBe('stl.deduction.buyer');
    expect(deductionNoteKey('charged_to_seller')).toBe('stl.deduction.seller');
    expect(deductionNoteKey('no_rule_resolved')).toBe('stl.deduction.noRule');
    expect(deductionNoteKey('anything')).toBe('stl.deduction.noRule');
    expect(deductionNoteKey('no_rule_resolved')).not.toBe(deductionNoteKey('charged_to_buyer'));
  });
  it('a row whose arithmetic does not close is flagged', () => {
    expect(rowNeedsAttention({ reconciles: false })).toBe(true);
    expect(rowNeedsAttention({ reconciles: true })).toBe(false);
  });
});

describe('TENANT-4c · statements say what period they cover', () => {
  it('a daily document is never labelled a cycle', () => {
    expect(periodKindKey('cycle')).toBe('stl.period.cycle');
    expect(periodKindKey('legacy_daily')).toBe('stl.period.daily');
    expect(periodKindKey('anything')).toBe('stl.period.daily');
  });
  it('a missing PDF says it is not rendered rather than showing nothing', () => {
    expect(pdfStateKey(true)).toBe('stl.pdf.ready');
    expect(pdfStateKey(false)).toBe('stl.pdf.notRendered');
  });
  it('the org-statement picker offers only months that have ENDED', () => {
    const months = closedMonths(new Date('2026-08-14T00:00:00Z'), 3);
    expect(months).toEqual(['2026-07', '2026-06', '2026-05']);
    for (const m of months) expect(isClosedMonth(m, new Date('2026-08-14T00:00:00Z'))).toBe(true);
    expect(isClosedMonth('2026-08', new Date('2026-08-14T00:00:00Z'))).toBe(false);
    expect(isMonthPeriod('2026-8')).toBe(false);
  });
});

describe('TENANT-4c · every refusal is translated by NAME', () => {
  it('each API code has its own key and an unknown one is not swallowed', () => {
    expect(refusalKey('SETTLEMENT_CYCLE_CHECKER_IS_REQUESTER')).toBe('stl.err.checkerIsRequester');
    expect(refusalKey('SETTLEMENT_CYCLE_PERIOD_NOT_ENDED')).toBe('stl.err.periodNotEnded');
    expect(refusalKey('ORG_STATEMENT_PERIOD_OPEN')).toBe('stl.err.monthOpen');
    expect(refusalKey('ORG_STATEMENT_DOES_NOT_RECONCILE')).toBe('stl.err.statementBroken');
    expect(refusalKey('WHAT_IS_THIS')).toBe('stl.err.generic');
  });
});

describe('TENANT-4c · the pages state their own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('W147 is gated by 0144\'s new permission and reflects the gate', () => {
    const s = read('app', 'settlements', 'page.tsx');
    expect(s).toContain("tenantHasPerm('settlement.close')");
    expect(s).toContain('stl.restricted');
  });

  it('it shows the COUNT, never a claim that everything happened at once', () => {
    const s = read('app', 'settlements', 'page.tsx');
    expect(s).toContain('progressKey(');
    expect(s).toContain('stl.progressHint');
    expect(s).not.toMatch(/atomic/i);
  });

  it('the close is TWO forms — request, then decide — and never one button', () => {
    const s = read('app', 'settlements', 'page.tsx');
    expect(s).toContain('requestCloseAction');
    expect(s).toContain('decideCloseAction');
    expect(s).toContain('stl.youRequested');
    expect(s).toContain('stl.twoHumans');
  });

  it('the deduction basis and a non-reconciling row are both on the page', () => {
    const s = read('app', 'settlements', 'page.tsx');
    expect(s).toContain('deductionNoteKey(');
    expect(s).toContain('stl.netMismatch');
    expect(s).toContain('stl.legacyDaily');
  });

  it('W148 distinguishes a cycle statement from a daily one, and says the org statement is DERIVED', () => {
    const s = read('app', 'settlements', 'statements', 'page.tsx');
    expect(s).toContain('periodKindKey(');
    expect(s).toContain('stl.orgStatementDerived');
    expect(s).toContain('stl.gaplessNote');
    expect(s).toContain('stl.mixedPeriods');
  });

  it('the actions check the note floor and the month BEFORE the round trip, and report the receipt', () => {
    const s = read('app', 'settlements', 'actions.ts');
    expect(s).toContain('isNoteLongEnough');
    expect(s).toContain('isClosedMonth');
    expect(s).toContain('res.receipt.rowCount');
    // The generated figure comes from the server's own recount, not from what the call happened to write.
    expect(s).toContain('res.statementsGenerated');
  });

  it('every new key is translated in all three launch languages', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('stl.'));
    expect(mine.length).toBeGreaterThan(85);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
  });
});
