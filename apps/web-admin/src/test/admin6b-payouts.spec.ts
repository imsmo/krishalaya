// apps/web-admin/src/test/admin6b-payouts.spec.ts (PC-56 ADMIN-6b)
import {
  approvalNoticeClass, approvalNoticeKey, bankCell, basisKey, balanceClass, balanceKey, cycleInFuture,
  driftKey, executionSummary, failureKey, formatMinor, isCycleDate, laneKey, lineAgreementKey,
  outcomeClass, outcomeKey, payableDiffers, payoutStatusClass, pdfClass, pdfKey, phaseClass, phaseKey,
  preflightClass, preflightKey, preflightVerdict, shortHash, shortfallKey, showApprove, showReturn,
  sumMinor, tileText,
} from '../features/payouts/payouts';

describe('formatMinor', () => {
  it('formats from a STRING through bigint, en-IN grouped', () => {
    expect(formatMinor('482120000')).toBe('₹48,21,200.00');
    expect(formatMinor('5')).toBe('₹0.05');
    // DEV-56 Part 5: formatMinor now delegates to the canonical formatMoneyMinor (@krishalaya/i18n) — its negative
    // sign is Intl's own en-IN minusSign literal (ASCII hyphen, verified directly), not the U+2212 hardcoded here
    // before. Deliberate, disclosed change.
    expect(formatMinor('-100')).toBe('-₹1.00');
  });
  it('renders an unreadable figure as an em dash, NEVER as ₹0.00', () => {
    // "₹0.00 awaiting approval" and "we could not read this figure" are opposite statements. On the money door the
    // second must never be shown as the first.
    for (const v of [null, undefined, '', 'abc', '1.5', '12,000']) expect(formatMinor(v)).toBe('—');
  });
  it('is exact past 2^53', () => {
    // The last digit is what a float loses, so the expected value is chosen to end in one a float cannot hold:
    // 9007199254740993 → …09.93, where 9007199254740992 would give …09.92.
    //
    // AND THE GROUPING IS LAKH/CRORE, NOT THOUSANDS. I first wrote this expectation Western-grouped
    // ('₹90,071,992,547,409.93') and the test failed against correct code — `toLocaleString('en-IN')` groups 2,2,3, so
    // ₹90 lakh crore reads ₹9,00,71,99,25,47,409.93. Worth keeping as a comment rather than silently corrected: this
    // platform's money is read by people who count in lakhs, and a reviewer who does not will read the right output as
    // a bug.
    expect(formatMinor('9007199254740993')).toBe('₹9,00,71,99,25,47,409.93');
    expect(formatMinor('9007199254740992')).toBe('₹9,00,71,99,25,47,409.92');
  });
});

describe('sumMinor', () => {
  it('sums exactly in bigint', () => {
    expect(sumMinor(['9007199254740993', '9007199254740993'])).toBe('18014398509481986');
  });
  it('returns NULL when any entry is unreadable, rather than summing the rest', () => {
    // Skipping would produce a total over a subset and present it as the total — and on a batch-approval screen that is
    // the number a human signs.
    expect(sumMinor(['100', 'oops', '200'])).toBeNull();
    expect(sumMinor(['100', null])).toBeNull();
    expect(sumMinor(['100', ''])).toBeNull();
  });
  it('a sum whose result is 0 still fails on a bad entry', () => {
    // ADMIN-5e's C7 lesson: a cancelling pair sums to 0, and 0 survives any lossy conversion — so the assertion has to
    // be about the FAILURE and not about the arithmetic, or the test proves nothing.
    expect(sumMinor(['100', 'x', '-100'])).toBeNull();
  });
});

describe('phase rendering', () => {
  it('draws awaiting_checker as a WARNING, not a neutral note', () => {
    // On this screen a batch nobody has signed is money sitting still and farmers are waiting for it. Grey would make
    // the queue restful.
    expect(phaseClass('awaiting_checker')).toContain('is-warn');
    expect(phaseClass('executed')).toContain('is-ok');
    expect(phaseClass('failed')).toContain('is-danger');
  });
  it('keys every phase, including the unrecognised one', () => {
    for (const p of ['awaiting_checker', 'approved', 'returned', 'executing', 'executed', 'failed', 'unknown'] as const) {
      expect(phaseKey(p)).toBe(`po.phase.${p}`);
    }
  });
});

describe('executionSummary', () => {
  it('returns null for a batch that has not executed, so the cell shows a dash', () => {
    // "0/0" reads as a run that found nothing rather than a run that has not happened.
    expect(executionSummary({ phase: 'awaiting_checker', count: 214, executedAt: null })).toBeNull();
    expect(executionSummary({ phase: 'approved', count: 214, executedAt: null })).toBeNull();
  });
  it('returns null for an executed batch with no timestamp rather than inventing one', () => {
    expect(executionSummary({ phase: 'executed', count: 96, executedAt: null })).toBeNull();
  });

  it('refuses to summarise an execution on a batch whose STATUS says it has not executed', () => {
    // `status` and `executed_at` are two columns, and until this test nothing forced them to agree: `markExecuted` sets
    // the timestamp and nothing ever clears it, so a row can carry a date its status contradicts. A summary drawn from
    // the date alone would report a run that, according to the status, never happened.
    //
    // THIRD MUTATION IN THIS WAVE TO SURVIVE ON THE SAME WEAKNESS — every case I had written kept the two fields
    // consistent, so two independent checks looked like one. It also earned a constraint:
    // `ck_payout_batch_executed_at` in 0114 now refuses the pair in the database, which is where the rule belongs. The
    // guard here is still not redundant: it protects the render from a row written before that constraint is validated.
    expect(executionSummary({ phase: 'awaiting_checker', count: 214, executedAt: '2026-07-13T18:40:00Z' })).toBeNull();
    expect(executionSummary({ phase: 'approved', count: 214, executedAt: '2026-07-13T18:40:00Z' })).toBeNull();
  });
  it('summarises a clean run', () => {
    expect(executionSummary({ phase: 'executed', count: 96, executedAt: '2026-07-13T11:20:00Z' }))
      .toEqual({ at: '2026-07-13T11:20:00Z', ok: 96, total: 96, failed: 0 });
  });
  it('marks the count UNKNOWN on a shortfall rather than guessing how many failed', () => {
    // The batch row records a settled TOTAL and a count, not a per-payout tally, so the exact number is not derivable —
    // and inventing one would be a figure with nothing behind it.
    const r = executionSummary({ phase: 'executed', count: 1842, executedAt: '2026-07-12T18:40:00Z', shortfall: true });
    expect(r?.ok).toBe(-1);
    expect(shortfallKey(true)).toBe('po.batch.shortfall');
    expect(shortfallKey(false)).toBeNull();
  });
});

describe('the approve control — maker-checker BY ABSENCE', () => {
  it('is drawn ONLY when the state is approvable', () => {
    // A disabled Approve button teaches an operator that they nearly have the right to authorise their own disbursement.
    expect(showApprove('approvable')).toBe(true);
    for (const k of ['needs_other_operator', 'already', 'empty', 'blocked', 'no_preflight'] as const) {
      expect(showApprove(k)).toBe(false);
    }
  });
  it('SHOWS Return to the maker of the batch', () => {
    // Refusing your own batch is noticing your own mistake, and making the safe action the expensive one is how a bad
    // run gets approved at 02:00 because stopping it needed a colleague.
    expect(showReturn('needs_other_operator')).toBe(true);
    expect(showReturn('blocked')).toBe(true);
    expect(showReturn('already')).toBe(false);
  });
  it('draws blocked and no_preflight as DANGER, not as warnings', () => {
    // Each means the batch cannot be trusted as displayed.
    expect(approvalNoticeClass('blocked')).toContain('is-danger');
    expect(approvalNoticeClass('no_preflight')).toContain('is-danger');
    expect(approvalNoticeClass('needs_other_operator')).toContain('is-warn');
  });
  it('keys a notice for every state, so the control is never absent without an explanation', () => {
    for (const k of ['approvable', 'needs_other_operator', 'already', 'empty', 'blocked', 'no_preflight'] as const) {
      expect(approvalNoticeKey(k)).toBe(`po.approval.${k}`);
    }
  });
});

describe('preflight rendering', () => {
  it('reports NOT RUN as its own verdict, not as a pass', () => {
    // This is the state W067's PASS badge silently occupied before this wave: nothing had ever checked.
    expect(preflightVerdict(null, null)).toBe('not_run');
    expect(preflightVerdict({ pass: true, checked: 3, blocked: 0 }, null)).toBe('pass');
    expect(preflightVerdict({ pass: false, checked: 3, blocked: 1 }, null)).toBe('blocked');
  });
  it('over_limit wins over any verdict, because a partial check is not a verdict', () => {
    expect(preflightVerdict({ pass: true, checked: 5000, blocked: 0 }, { limit: 5000 })).toBe('over_limit');
  });
  it('draws NOT RUN and OVER LIMIT as danger, not as neutral', () => {
    // A grey badge over 214 unchecked payouts is exactly the reassurance this wave exists to withdraw.
    expect(preflightClass('not_run')).toContain('is-danger');
    expect(preflightClass('over_limit')).toContain('is-danger');
    expect(preflightClass('pass')).toContain('is-ok');
    expect(preflightClass('blocked')).toContain('is-danger');
  });
  it('keys each verdict', () => {
    expect(preflightKey('pass')).toBe('po.pf.verdict.pass');
    expect(preflightKey('over_limit')).toBe('po.pf.verdict.over_limit');
  });
  it('maps every known failure to its own key and an unknown one to a generic line', () => {
    // Showing `zero_or_negative` to an operator is showing them our variable names; showing nothing would hide a blocked
    // payout.
    expect(failureKey('wallet_frozen')).toBe('po.pf.wallet_frozen');
    expect(failureKey('kyc_unknown')).toBe('po.pf.kyc_unknown');
    expect(failureKey('something_new')).toBe('po.pf.other');
  });
  it('only shows the second figure when the two differ', () => {
    expect(payableDiffers('100', '100')).toBe(false);
    expect(payableDiffers('100', '200')).toBe(true);
  });
});

describe('driftKey', () => {
  it('is silent when nothing drifted', () => {
    expect(driftKey(null)).toBeNull();
    expect(driftKey({ drifted: false })).toBeNull();
  });
  it('names each drift so the operator knows which figure moved', () => {
    expect(driftKey({ drifted: true, reason: 'payable_changed' })).toBe('po.drift.payable');
    expect(driftKey({ drifted: true, reason: 'no_record' })).toBe('po.drift.noRecord');
    expect(driftKey({ drifted: true })).toBe('po.drift.other');
  });
});

describe('payout line cells', () => {
  it('names the LANE rather than showing the raw priority integer', () => {
    // Lower is more urgent, which is the opposite of how most people read a "priority" number.
    expect(laneKey(10)).toBe('po.lane.wage');
    expect(laneKey(1)).toBe('po.lane.wage');
    expect(laneKey(50)).toBe('po.lane.expedited');
    expect(laneKey(100)).toBe('po.lane.settlement');
  });
  it('does not read a non-finite priority as the settlement lane', () => {
    // `Number.isFinite` first: without it NaN falls through every comparison and lands on 'settlement', labelling an
    // unreadable row as ordinary.
    expect(laneKey(NaN)).toBe('po.lane.unknown');
    expect(laneKey(Infinity)).toBe('po.lane.unknown');
  });
  it('shows four digits and an IFSC, never an account number', () => {
    expect(bankCell('4417', 'SBIN0001234')).toBe('XXXX-4417 · SBIN0001234');
    expect(bankCell(null, null)).toBe('—');
    // The IFSC's first four characters are the bank code, and resolving that to a NAME needs a table this platform does
    // not have. A wrong bank name beside somebody's account is worse than a code they can look up.
    expect(bankCell('4417', null)).toBe('XXXX-4417');
  });
  it('classes each payout status', () => {
    expect(payoutStatusClass('success')).toContain('is-ok');
    expect(payoutStatusClass('failed')).toContain('is-danger');
    expect(payoutStatusClass('reversed')).toContain('is-warn');
    expect(payoutStatusClass('anything')).toBe('kv-badge');
  });
});

describe('the settlement tiles', () => {
  it('renders an unknown as words and a dash, never as a figure', () => {
    expect(tileText({ known: false, reason: 'no_run_today' })).toEqual({ value: '—', unknownKey: 'po.tile.noRun' });
    expect(tileText({ known: false, reason: 'not_recorded' })).toEqual({ value: '—', unknownKey: 'po.tile.notRecorded' });
  });
  it('renders a KNOWN zero as ₹0.00 with no unknown note', () => {
    // The distinction the whole tile type exists for.
    expect(tileText({ known: true, minor: '0', note: null })).toEqual({ value: '₹0.00', unknownKey: null });
  });
});

describe('run outcome rendering', () => {
  it('draws ABANDONED as seriously as FAILED', () => {
    // A cycle that stopped without saying so is worse than one that reported a failure: nobody was told, and the
    // statements tomorrow's payouts are built from are missing.
    expect(outcomeClass('abandoned')).toContain('is-danger');
    expect(outcomeClass('failed')).toContain('is-danger');
    expect(outcomeClass('partial')).toContain('is-warn');
    expect(outcomeClass('clean')).toContain('is-ok');
  });
  it('keys every outcome', () => {
    for (const k of ['running', 'clean', 'partial', 'failed', 'abandoned', 'unknown'] as const) {
      expect(outcomeKey(k)).toBe(`po.run.${k}`);
    }
  });
  it('says which basis the totals used, and stays silent when it is the run itself', () => {
    // A total that silently switches its own definition is worse than one that says which it is.
    expect(basisKey('period')).toBe('po.basis.period');
    expect(basisKey('none')).toBe('po.basis.none');
    expect(basisKey('run')).toBeNull();
  });
});

describe('the statement', () => {
  it('draws an unbalanced statement as danger', () => {
    expect(balanceClass(true)).toContain('is-ok');
    expect(balanceClass(false)).toContain('is-danger');
    expect(balanceKey(false)).toBe('po.stmt.unbalanced');
  });
  it('reports a line disagreement SEPARATELY from the statement arithmetic', () => {
    // One flag covering both would tell an investigator nothing about where to look.
    expect(lineAgreementKey(true, 41)).toBeNull();
    expect(lineAgreementKey(false, 41)).toBe('po.stmt.linesDisagree');
    expect(lineAgreementKey(true, 0)).toBe('po.stmt.noLines');
  });
  it('reports no lines even when the (vacuous) agreement holds', () => {
    // `0 === 0` on both totals, so an empty statement "agrees" with itself — and an operator would be told nothing.
    expect(lineAgreementKey(true, 0)).toBe('po.stmt.noLines');
  });
  it('draws never_hashed as a WARNING and not an ok', () => {
    // W442 called the PDF "hash-anchored" and until 0114 there was no column to anchor it in, so this is the state
    // almost every existing statement is in.
    expect(pdfClass('never_hashed')).toContain('is-warn');
    expect(pdfClass('anchored')).toContain('is-ok');
    expect(pdfClass('mismatch')).toContain('is-danger');
    expect(pdfClass('not_generated')).toBe('kv-badge');
    expect(pdfKey('mismatch')).toBe('po.pdf.mismatch');
  });
});

describe('shortHash', () => {
  it('abbreviates a 64-hex digest the way the ledger explorer does', () => {
    const h = 'a'.repeat(28) + 'b'.repeat(28) + 'c'.repeat(8);
    expect(shortHash(h)).toBe(`${h.slice(0, 8)}…${h.slice(-8)}`);
  });
  it('shows a short value WHOLE rather than mangling it', () => {
    // Also a signal: a 64-hex digest is what the CHECK constrains, so anything shorter came from somewhere that did not
    // compute one.
    expect(shortHash('abc')).toBe('abc');
    expect(shortHash(null)).toBe('—');
  });
});

describe('cycle dates', () => {
  it('accepts a business day and rejects a calendar impossibility the pattern allows', () => {
    expect(isCycleDate('2026-07-13')).toBe(true);
    expect(isCycleDate('2026-02-31')).toBe(false);
    expect(isCycleDate('2026-7-13')).toBe(false);
    expect(isCycleDate('2026-07-13T18:00:00Z')).toBe(false);
  });
  it('refuses a cycle for a period that has not finished', () => {
    // The job aggregates un-statemented lines in a window; asking for tomorrow would open a run over a period in which
    // orders are still being delivered, and its `completed` row would then block the real cycle.
    expect(cycleInFuture('2026-07-14', '2026-07-13')).toBe(true);
    expect(cycleInFuture('2026-07-13', '2026-07-13')).toBe(false);
    expect(cycleInFuture('2026-07-12', '2026-07-13')).toBe(false);
  });
});
