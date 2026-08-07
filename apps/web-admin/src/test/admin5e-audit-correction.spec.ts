// PC-56 ADMIN-5e · the audit-trail and manual-correction console helpers. Pure, framework-free.
// Two rules govern everything here: an unrecorded audit value is not an unchanged row, and money never becomes a
// JavaScript number — not in a validator, not in a sum, not in a comparison.
import {
  SAVED_VIEWS, isSavedView, viewChipClass, diffStateKey, diffSign, diffLineClass, valueCell, MASK,
  retentionKey, windowTooWide, MAX_LIVE_WINDOW_DAYS,
  statusClass, balanceClass, balanceText, stepOf, submitBlockedKey, approveBlockedKey,
  aboveFounderThreshold, FOUNDER_THRESHOLD_MINOR, buildLeg, sumLegs, formatMinorText,
  type DiffPanel, type BalanceView, type SubmitState, type ApproveState,
} from '../features/audit/audit-console';

const NOW = new Date('2026-08-07T10:00:00.000Z');
const bal = (over: Partial<BalanceView> = {}): BalanceView => ({
  sumMinor: '0', sumText: '₹0.00', balanced: true, legCount: 2,
  grossMinor: '1245000', grossText: '₹12,450.00', ...over,
});

/* ================================================================================================ */
describe('ADMIN-5e console · W039 saved views and the window rule', () => {
  it('offers exactly the three views', () => {
    expect([...SAVED_VIEWS]).toEqual(['all', 'writes', 'money']);
    expect(isSavedView('money')).toBe(true);
    expect(isSavedView('payouts')).toBe(false);
    expect(isSavedView(null)).toBe(false);
    expect(viewChipClass('money', 'money')).toContain('is-active');
    expect(viewChipClass('all', 'money')).not.toContain('is-active');
  });
  it('REFUSES a window wider than the live limit before the query is sent', () => {
    expect(MAX_LIVE_WINDOW_DAYS).toBe(90);
    expect(windowTooWide('2026-01-01T00:00:00.000Z', undefined, NOW)).toBe(true);
    expect(windowTooWide('2026-07-01T00:00:00.000Z', undefined, NOW)).toBe(false);
  });
  it('a MISSING from is fine — the server defaults to today, which is the pruning rule', () => {
    expect(windowTooWide(undefined, undefined, NOW)).toBe(false);
  });
  it('a MALFORMED date is left to the server rather than silently passing or blocking', () => {
    expect(windowTooWide('not-a-date', undefined, NOW)).toBe(false);
    expect(windowTooWide('2026-01-01T00:00:00.000Z', 'not-a-date', NOW)).toBe(false);
  });
  it('the retention line reports which half of the claim holds', () => {
    expect(retentionKey({ immutable: true, yearsEnforced: false })).toBe('immutableOnly');
    expect(retentionKey({ immutable: true, yearsEnforced: true })).toBe('both');
    expect(retentionKey({ immutable: false, yearsEnforced: false })).toBe('unknown');
    expect(retentionKey(null)).toBe('unknown');
    expect(retentionKey({ immutable: true })).toBe('unknown');
  });
});

describe('ADMIN-5e console · W040 diff states', () => {
  it('NOT RECORDED and EMPTY are DIFFERENT states', () => {
    // "Nobody wrote down what changed" vs "we recorded both sides and they matched" are opposite facts about
    // whether the platform knows what a privileged action did. One message for both would hide the first, which is
    // the state of nearly every row on the platform.
    expect(diffStateKey({ kind: 'not_recorded' })).toBe('notRecorded');
    expect(diffStateKey({ kind: 'diff', lines: [] })).toBe('empty');
    expect(diffStateKey({ kind: 'created', lines: [] })).toBe('empty');
  });
  it('a masked panel with NO keys is not-recorded, not an empty mask', () => {
    // Otherwise a viewer without the values permission sees "values withheld" over a row where nothing was ever
    // written — implying there is something behind the mask.
    expect(diffStateKey({ kind: 'masked', keys: [] })).toBe('notRecorded');
    expect(diffStateKey({ kind: 'masked', keys: ['status'] })).toBe('masked');
  });
  it('reports diff, created and opaque', () => {
    expect(diffStateKey({ kind: 'diff', lines: [{ kind: 'changed', key: 'a', before: '1', after: '2' }] })).toBe('diff');
    expect(diffStateKey({ kind: 'created', lines: [{ kind: 'added', key: 'a', before: null, after: '2' }] })).toBe('created');
    expect(diffStateKey({ kind: 'opaque', before: '"x"', after: '"y"' })).toBe('opaque');
    expect(diffStateKey(null)).toBe('notRecorded');
    expect(diffStateKey(undefined)).toBe('notRecorded');
  });
  it('a REMOVED key is a failure colour and a minus sign', () => {
    // The direction a quickly-written diff drops, because it iterates the new object.
    expect(diffSign('removed')).toBe('−');
    expect(diffSign('added')).toBe('+');
    expect(diffSign('changed')).toBe('±');
    expect(diffLineClass('removed')).toContain('danger');
    expect(diffLineClass('added')).toContain('ok');
    expect(diffLineClass('changed')).toContain('warn');
  });
  it('a masked cell renders the MASK, never a blank', () => {
    // A blank looks like a value that was ABSENT rather than one withheld, and those carry opposite implications.
    expect(valueCell('secret', true)).toBe(MASK);
    expect(valueCell(null, true)).toBe(MASK);
    expect(valueCell(null, false)).toBe('—');
    expect(valueCell('"rejected"', false)).toBe('"rejected"');
  });
  it('a masked panel never carries the values it masks', () => {
    const p: DiffPanel = { kind: 'masked', keys: ['phone', 'status'] };
    expect(JSON.stringify(p)).not.toContain('9812345210');
  });
});

/* ================================================================================================ */
describe('ADMIN-5e console · money never becomes a JavaScript number', () => {
  it('sums legs with BIGINT arithmetic, so a huge correction is exact', () => {
    expect(sumLegs(['9007199254740993', '-9007199254740993'])).toEqual({ known: true, sumMinor: '0' });
    expect(sumLegs(['-1245000', '1245000'])).toEqual({ known: true, sumMinor: '0' });
    expect(sumLegs(['-1245000', '1'])).toEqual({ known: true, sumMinor: '-1244999' });
  });
  it('the RESULT survives, not just the addition — a sum beyond float precision is exact', () => {
    // A MUTATION TEST CAUGHT THIS AND IT SHARPENS THE RULE THE LAST THREE WAVES HAVE BEEN LEARNING. Replacing the
    // bigint result with String(Number(sum)) left every case above passing, because a CANCELLING PAIR sums to 0 —
    // and 0 is the one value that survives any lossy conversion. The inputs were extreme; the expected output was
    // the safest number there is, so the test proved the addition was exact and nothing about the result.
    //
    // ADMIN-5b, 5c and 5d each found a guard tested with the caller's ordinary inputs. This is the next turn of the
    // same screw: **feeding a guard a dangerous input is not enough — the EXPECTED RESULT must be one that a broken
    // implementation could not also produce.**
    expect(sumLegs(['9007199254740993'])).toEqual({ known: true, sumMinor: '9007199254740993' });
    expect(sumLegs(['9007199254740992', '1'])).toEqual({ known: true, sumMinor: '9007199254740993' });
    // …and the same for the formatter, which is the other place a rupee figure could quietly lose its last digit.
    // Grouped en-IN (lakh/crore), not western — this is a platform for Indian farmers and the separator placement
    // is the one they read. My first expectation here used western grouping and was simply wrong about the locale.
    expect(formatMinorText('9007199254740993')).toBe('₹9,00,71,99,25,47,409.93');
    expect(formatMinorText('1245000')).toBe('₹12,450.00');
  });
  it('an INVALID amount makes the whole sum UNKNOWN rather than being skipped', () => {
    // Skipping it would show a balanced Σ over a set containing a leg the server will reject — the most misleading
    // possible state of the readout the operator is trusting.
    expect(sumLegs(['-1245000', 'oops'])).toEqual({ known: false, sumMinor: '0' });
    expect(sumLegs(['12.50', '-12.50'])).toEqual({ known: false, sumMinor: '0' });
    expect(sumLegs([''])).toEqual({ known: false, sumMinor: '0' });
  });
  it('an empty leg set sums to zero and is KNOWN — the emptiness is what blocks submission', () => {
    expect(sumLegs([])).toEqual({ known: true, sumMinor: '0' });
  });
  it('the founder threshold is compared as BIGINT minor units', () => {
    expect(FOUNDER_THRESHOLD_MINOR).toBe(5_000_000n);
    expect(aboveFounderThreshold('4999999')).toBe(false);
    expect(aboveFounderThreshold('5000000')).toBe(true);       // AT the threshold, not merely above
    expect(aboveFounderThreshold('900000000000000000')).toBe(true);
    // A value beyond float precision must still compare correctly.
    expect(aboveFounderThreshold('9007199254740993')).toBe(true);
    expect(aboveFounderThreshold('-6000000')).toBe(true);       // magnitude, not sign
  });
  it('an unreadable gross is NOT above the threshold — and is refused elsewhere', () => {
    expect(aboveFounderThreshold(null)).toBe(false);
    expect(aboveFounderThreshold('lots')).toBe(false);
    expect(aboveFounderThreshold('50.00')).toBe(false);
  });
  it('formats from a STRING and never round-trips through a number', () => {
    expect(formatMinorText('1245000')).toBe('₹12,450.00');
    expect(formatMinorText('-1245000')).toBe('−₹12,450.00');
    expect(formatMinorText('5')).toBe('₹0.05');
    expect(formatMinorText('bad')).toBe('—');
    expect(formatMinorText(null)).toBe('—');
  });
});

describe('ADMIN-5e console · the leg form', () => {
  const good = { ownerKind: 'user', ownerId: 'u1', accountCode: 'main', amountMinor: '1245000' };
  it('accepts a proper leg', () => { expect(buildLeg(good).ok).toBe(true); });
  it('a PLATFORM leg has no owner and a user leg must have one', () => {
    // Getting this wrong credits the platform suspense account instead of a named farmer. It balances perfectly.
    expect(buildLeg({ ...good, ownerKind: 'platform' }).ok).toBe(false);
    expect(buildLeg({ ownerKind: 'platform', accountCode: 'suspense', amountMinor: '-1' }).ok).toBe(true);
    const r = buildLeg({ ...good, ownerId: '' });
    expect(!r.ok && r.error).toBe('ownerId');
  });
  it('REFUSES a zero amount however it is written', () => {
    expect(!buildLeg({ ...good, amountMinor: '0' }).ok).toBe(true);
    expect(!buildLeg({ ...good, amountMinor: '000' }).ok).toBe(true);
    expect(!buildLeg({ ...good, amountMinor: '-0' }).ok).toBe(true);
    const r = buildLeg({ ...good, amountMinor: '0' });
    expect(!r.ok && r.error).toBe('zeroAmount');
  });
  it('REFUSES a decimal — minor units are whole', () => {
    expect(!buildLeg({ ...good, amountMinor: '12450.00' }).ok).toBe(true);
    expect(!buildLeg({ ...good, amountMinor: '1.5' }).ok).toBe(true);
  });
  it('tolerates the separators people paste from a spreadsheet', () => {
    const r = buildLeg({ ...good, amountMinor: ' 1,245,000 ' });
    expect(r.ok && r.value.amountMinor).toBe('1245000');
  });
  it('refuses an unknown owner kind and a malformed account code', () => {
    expect(buildLeg({ ...good, ownerKind: 'bank' }).ok).toBe(false);
    expect(buildLeg({ ...good, accountCode: 'Main Account' }).ok).toBe(false);
    expect(buildLeg({ ...good, accountCode: '' }).ok).toBe(false);
  });
  it('omits blank optional fields rather than sending empty strings', () => {
    const r = buildLeg({ ...good, legNote: '' });
    expect(r.ok && 'legNote' in r.value).toBe(false);
  });
});

describe('ADMIN-5e console · W068 states and gating', () => {
  it('the balance readout is a FAILURE colour when unbalanced, never a note in progress', () => {
    expect(balanceClass(bal())).toContain('ok');
    expect(balanceClass(bal({ balanced: false, sumMinor: '1245000', sumText: '₹12,450.00' }))).toContain('danger');
    expect(balanceClass(null)).toContain('muted');
    expect(balanceText(bal())).toBe('Σ = 0 ✓');
    expect(balanceText(bal({ balanced: false, sumText: '₹12,450.00' }))).toBe('Σ = ₹12,450.00 ≠ 0');
    expect(balanceText(null)).toBe('—');
  });
  it('a REJECTED or WITHDRAWN draft is finished, not back at step 2', () => {
    // Showing it mid-flow would invite somebody to carry on with a correction a checker refused.
    expect(stepOf('rejected', true)).toBeNull();
    expect(stepOf('withdrawn', true)).toBeNull();
    expect(stepOf('drafting', false)).toBe(2);
    expect(stepOf('awaiting_checker', true)).toBe(3);
    expect(stepOf('posted', true)).toBe(4);
    expect(stepOf(null, true)).toBeNull();
  });
  it('statuses carry distinct colours and posted is the only green', () => {
    expect(statusClass('posted')).toContain('ok');
    expect(statusClass('awaiting_checker')).toContain('warn');
    expect(statusClass('rejected')).toContain('danger');
    expect(statusClass('withdrawn')).toContain('muted');
    expect(statusClass('drafting')).toContain('muted');
    expect(statusClass(null)).toContain('muted');
  });
  it('SUBMIT is blocked with a distinct reason per next move', () => {
    expect(submitBlockedKey({ ok: false, reason: 'unbalanced', sumMinor: '1' } as SubmitState)).toBe('unbalanced');
    expect(submitBlockedKey({ ok: false, reason: 'too_few_legs', legCount: 1 } as SubmitState)).toBe('tooFewLegs');
    expect(submitBlockedKey({ ok: false, reason: 'no_reason' })).toBe('noReason');
    expect(submitBlockedKey({ ok: false, reason: 'not_drafting' })).toBe('notDrafting');
    expect(submitBlockedKey(null)).toBe('notDrafting');
    expect(submitBlockedKey({ ok: true, gross: '1245000', needsFounderConfirmation: false })).toBeNull();
  });
  it('APPROVE is ABSENT to the maker, and that is computed from who is looking', () => {
    const ok: ApproveState = { ok: true };
    expect(approveBlockedKey(ok, 'op-a', 'op-a')).toBe('yourOwn');
    expect(approveBlockedKey(ok, 'op-a', 'op-b')).toBeNull();
  });
  it('an UNKNOWN viewer or maker is offered it — the server refuses if wrong', () => {
    expect(approveBlockedKey({ ok: true }, 'op-a', null)).toBeNull();
    expect(approveBlockedKey({ ok: true }, null, 'op-a')).toBeNull();
  });
  it('names not-submitted, already-decided and a balance that drifted', () => {
    expect(approveBlockedKey({ ok: false, reason: 'not_submitted' }, 'op-a', 'op-b')).toBe('notSubmitted');
    expect(approveBlockedKey({ ok: false, reason: 'already_decided' }, 'op-a', 'op-b')).toBe('alreadyDecided');
    expect(approveBlockedKey({ ok: false, reason: 'unbalanced', sumMinor: '1' } as ApproveState, 'op-a', 'op-b')).toBe('unbalanced');
    expect(approveBlockedKey(null, 'op-a', 'op-b')).toBe('notSubmitted');
  });
});
