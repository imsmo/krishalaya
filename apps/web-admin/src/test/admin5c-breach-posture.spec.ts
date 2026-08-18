// PC-56 ADMIN-5c · the breach checklist and posture console helpers. Pure, framework-free.
// Both screens are read by people with an incentive to check them, so the governing rule is stricter than elsewhere:
// a figure whose source could not be read says so, and "all quiet" is only claimable when everything was looked at.
import {
  NOTIFICATION_STEPS, stepState, stepTone, notifyOfferable, notifyBlockedKey, signOffOfferable,
  clockTone, clockKey, reachShortfall, buildRecordStep,
  tileValue, retentionKey, retentionTone, attentionTone, allQuiet, unreadSources,
  certificationHeld, certificationTone, digestState,
  type ChecklistLine, type Notifiable, type RetentionTile, type SourcesRead, type Certification,
} from '../features/compliance/breach-notification';

const line = (over: Partial<ChecklistLine> = {}): ChecklistLine => ({
  step: 'board_filing', outcome: 'done', evidenceRef: 'DPB/2026/00412', reachedCount: null,
  channel: null, note: null, performedBy: 'op-a', performedAt: null, ...over,
});
const READ: SourcesRead = { dsr: true, breaches: true, retention: true, consent: true };

describe('ADMIN-5c console · the Notify control is ABSENT until the checklist stands up', () => {
  it('is not offered while steps are outstanding', () => {
    // A Notify button that always 409s teaches an operator the checklist is paperwork — which is the attitude that let
    // two typed timestamps stand in for a statutory act.
    const n: Notifiable = { ok: false, reason: 'steps_outstanding', outstanding: ['tenant_briefed'] };
    expect(notifyOfferable(n)).toBe(false);
    expect(notifyBlockedKey(n)).toBe('outstanding');
  });
  it('is not offered without a DPO sign-off, and that is a DIFFERENT message', () => {
    // The next action is a different person, not more work.
    const n: Notifiable = { ok: false, reason: 'no_dpo_signoff' };
    expect(notifyOfferable(n)).toBe(false);
    expect(notifyBlockedKey(n)).toBe('signOff');
  });
  it('is not offered when the checklist could not be read — silence must not read as satisfied', () => {
    expect(notifyOfferable(null)).toBe(false);
    expect(notifyOfferable(undefined)).toBe(false);
    expect(notifyBlockedKey(null)).toBe('unknown');
  });
  it('IS offered once evidenced and signed', () => {
    expect(notifyOfferable({ ok: true, steps: 3 })).toBe(true);
    expect(notifyBlockedKey({ ok: true, steps: 3 })).toBeNull();
  });
});

describe('ADMIN-5c console · step states', () => {
  it('separates outstanding from not-applicable', () => {
    // null = nobody looked. not_applicable = somebody decided, with a reason.
    expect(stepState(line({ outcome: null }))).toBe('outstanding');
    expect(stepState(line({ outcome: 'not_applicable' }))).toBe('notApplicable');
    expect(stepState(line({ outcome: 'done' }))).toBe('done');
    expect(stepState(line({ outcome: 'retracted' }))).toBe('retracted');
  });
  it('not-applicable is NOT a failure colour; outstanding is a warning; RETRACTED is a failure', () => {
    // A withdrawn statutory claim is the one state here that needs explaining.
    expect(stepTone(line({ outcome: 'not_applicable' }))).toBe('neutral');
    expect(stepTone(line({ outcome: 'not_applicable' }))).not.toBe('danger');
    expect(stepTone(line({ outcome: null }))).toBe('warning');
    expect(stepTone(line({ outcome: 'retracted' }))).toBe('danger');
    expect(stepTone(line({ outcome: 'done' }))).toBe('success');
  });
});

describe('ADMIN-5c console · the DPO sign-off is offered to somebody else', () => {
  it('is NOT offered to whoever declared the breach', () => {
    expect(signOffOfferable('op-opener', 'op-opener', false)).toBe(false);
  });
  it('IS offered to a different operator', () => {
    expect(signOffOfferable('op-opener', 'op-dpo', false)).toBe(true);
  });
  it('is not offered once already signed', () => {
    expect(signOffOfferable('op-opener', 'op-dpo', true)).toBe(false);
  });
  it('an UNKNOWN viewer or opener is offered it — the server refuses if wrong', () => {
    expect(signOffOfferable('op-opener', null, false)).toBe(true);
    expect(signOffOfferable(null, 'op-dpo', false)).toBe(true);
  });
});

describe('ADMIN-5c console · the clock', () => {
  it('UNMEASURED is a warning, not a pass', () => {
    // A breach with no detection time cannot be shown to have been notified in time.
    expect(clockTone({ kind: 'unmeasured' })).toBe('warning');
    expect(clockTone({ kind: 'unmeasured' })).not.toBe('success');
    expect(clockKey(undefined)).toBe('unmeasured');
  });
  it('under a day left on a statutory window is urgent, not merely noteworthy', () => {
    expect(clockTone({ kind: 'due', hoursLeft: 20 })).toBe('danger');
    expect(clockTone({ kind: 'due', hoursLeft: 40 })).toBe('warning');
    expect(clockTone({ kind: 'met', hoursTaken: 4 })).toBe('success');
    expect(clockTone({ kind: 'breached', hoursOver: 3 })).toBe('danger');
  });
  it('a missing clock is muted, never met', () => {
    expect(clockTone(null)).toBe('neutral');
    expect(clockTone(null)).not.toBe('success');
  });
  it('the reach shortfall is UNKNOWN when either side is', () => {
    // A fabricated "0 unreached" converts "nobody counted" into "everybody was told".
    expect(reachShortfall(64, null).known).toBe(false);
    expect(reachShortfall(null, 60).known).toBe(false);
    expect(reachShortfall(Number.NaN, 60).known).toBe(false);
    expect(reachShortfall(64, 60)).toEqual({ known: true, missing: 4 });
    expect(reachShortfall(60, 64)).toEqual({ known: true, missing: 0 });
  });
});

describe('ADMIN-5c console · the step form', () => {
  const base = { step: 'board_filing', outcome: 'done', evidenceRef: 'DPB/2026/00412' };

  it('accepts a proper record', () => {
    expect(buildRecordStep(base).ok).toBe(true);
  });
  it('a DONE step needs evidence and a NOT-APPLICABLE step needs a reason', () => {
    expect(!buildRecordStep({ step: 'board_filing', outcome: 'done' }).ok).toBe(true);
    const r = buildRecordStep({ step: 'tenant_briefed', outcome: 'not_applicable' });
    expect(!r.ok && r.error).toBe('note');
  });
  it('checks the PII SHAPE before the required fields', () => {
    // A filing reference that is actually a pasted phone number should be told about the phone number, not about
    // being present. Asserted with the required field ALSO wrong so the ordering is genuinely exercised.
    const r = buildRecordStep({ step: 'principals_notified', outcome: 'not_applicable', note: '', channel: 'sms to 9812345210' });
    expect(!r.ok && r.error).toBe('looksLikePii');
    const r2 = buildRecordStep({ step: 'board_filing', outcome: 'done', evidenceRef: 'ramesh@example.com' });
    expect(!r2.ok && r2.error).toBe('looksLikePii');
  });
  it('allows a filing reference with a short digit run', () => {
    expect(buildRecordStep({ step: 'board_filing', outcome: 'done', evidenceRef: 'DPB/2026/00412' }).ok).toBe(true);
  });
  it('a BLANK count is omitted rather than sent as zero', () => {
    const r = buildRecordStep({ ...base, reachedCount: '' });
    expect(r.ok && 'reachedCount' in r.value).toBe(false);
    const z = buildRecordStep({ ...base, reachedCount: '0' });
    expect(z.ok && z.value.reachedCount).toBe(0);
  });
  it('refuses a non-numeric count and an unknown step or outcome', () => {
    expect(buildRecordStep({ ...base, reachedCount: 'many' }).ok).toBe(false);
    expect(buildRecordStep({ ...base, step: 'press_release' }).ok).toBe(false);
    expect(buildRecordStep({ ...base, outcome: 'retracted' }).ok).toBe(false);
  });
  it('offers exactly the three acts', () => {
    expect([...NOTIFICATION_STEPS]).toEqual(['board_filing', 'principals_notified', 'tenant_briefed']);
  });
});

describe('ADMIN-5c console · the posture page', () => {
  it('a tile with no value is UNKNOWN, never 0', () => {
    expect(tileValue({ kind: 'unavailable', reason: 'x' })).toEqual({ known: false, value: 0 });
    expect(tileValue(null)).toEqual({ known: false, value: 0 });
    expect(tileValue({ kind: 'value', value: 0 })).toEqual({ known: true, value: 0 });
  });
  it('the retention tile is never a green tick over policies nothing can run', () => {
    const partial: RetentionTile = { kind: 'coverage', runnable: 7, unrunnable: 6, total: 13, unrunnableActions: ['anonymise', 'archive'], complete: false };
    expect(retentionKey(partial)).toBe('partial');
    expect(retentionTone(partial)).toBe('warning');
    expect(retentionTone(partial)).not.toBe('success');
    const complete: RetentionTile = { kind: 'coverage', runnable: 7, unrunnable: 0, total: 7, unrunnableActions: [], complete: true };
    expect(retentionTone(complete)).toBe('success');
    expect(retentionKey({ kind: 'unavailable', reason: 'x' })).toBe('unavailable');
    expect(retentionKey({ kind: 'coverage', runnable: 0, unrunnable: 0, total: 0, unrunnableActions: [], complete: false })).toBe('none');
  });
  it('overdue and blocking are failures; due-soon is a warning', () => {
    expect(attentionTone('overdue')).toBe('danger');
    expect(attentionTone('blocking')).toBe('danger');
    expect(attentionTone('due_soon')).toBe('warning');
    expect(attentionTone('info')).toBe('neutral');
  });
  it('ALL QUIET needs an empty list AND every source read', () => {
    expect(allQuiet([], READ)).toBe(true);
    expect(allQuiet([], { ...READ, retention: false })).toBe(false);
    expect(allQuiet([{ id: 'x', severity: 'info', messageKey: 'y' }], READ)).toBe(false);
    expect(allQuiet(null, READ)).toBe(false);
    expect(allQuiet([], null)).toBe(false);
  });
  it('names the sources that could not be read', () => {
    expect(unreadSources({ ...READ, breaches: false, consent: false })).toEqual(['breaches', 'consent']);
    expect(unreadSources(READ)).toEqual([]);
    expect(unreadSources(null)).toEqual(['dsr', 'breaches', 'retention', 'consent']);
  });
  it('only a claimable certification renders as held, and a MISSING flag is not held', () => {
    // The failure direction that matters is a page claiming something the platform does not hold.
    const held: Certification = { code: 'a', name: 'A', state: 'live', note: '', claimable: true };
    const notHeld: Certification = { code: 'b', name: 'B', state: 'in_progress', note: '', claimable: false };
    expect(certificationHeld(held)).toBe(true);
    expect(certificationHeld(notHeld)).toBe(false);
    expect(certificationHeld(undefined)).toBe(false);
    expect(certificationHeld({} as Certification)).toBe(false);
    expect(certificationTone(held)).toBe('success');
    expect(certificationTone(notHeld)).toBe('neutral');
  });
});

describe('ADMIN-5c console · the receipt digest', () => {
  it('reports a missing digest as ABSENT rather than hiding the field', () => {
    // Five surfaces shipped without one. A blank cell would make an un-updated surface invisible.
    expect(digestState({ id: 'r', report: 'x', generatedAt: '', generatedBy: '', rowCount: 0, truncated: false })).toBe('absent');
    expect(digestState({ id: 'r', report: 'x', generatedAt: '', generatedBy: '', rowCount: 0, truncated: false, contentSha256: 'nope' })).toBe('absent');
    expect(digestState({ id: 'r', report: 'x', generatedAt: '', generatedBy: '', rowCount: 0, truncated: false, contentSha256: 'a'.repeat(64) })).toBe('present');
    expect(digestState(null)).toBe('unknown');
  });
});
