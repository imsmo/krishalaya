// PC-56 ADMIN-5f · the moderation-queue console helpers. Pure, framework-free.
// "Hold fast, remove slow" is the rule every assertion here defends: Remove is ABSENT unless the listing is already
// held, and above ₹1,00,000 unless a second operator is looking.
import {
  HOLD_SOURCES, REASON_MIN, SUBJECT_TYPES, PLATFORM_OUTCOMES, OUTCOME_MIN,
  slaClass, slaKey, formatMinor, removeBlockedKey, valueDrift, orderClass, noticeClass, noticeKey,
  buildOrder, priorityClass, reportSlaClass, handlerKey, subjectCountText, pageOrderCaveatVisible, buildDecide,
  type RemoveState,
} from '../features/moderation/queue';

/* ================================================================================================ */
describe('ADMIN-5f console · the hold SLA', () => {
  it('UNMEASURED is a warning, never a pass', () => {
    // A hold with no clock cannot be shown to be inside its SLA, and the farmer under it loses money by the hour.
    expect(slaClass({ kind: 'unmeasured' })).toContain('warn');
    expect(slaClass({ kind: 'unmeasured' })).not.toContain('--ok');
    expect(slaKey(null)).toBe('unmeasured');
    expect(slaKey(undefined)).toBe('unmeasured');
  });
  it('breached is a failure and under-an-hour is a warning', () => {
    expect(slaClass({ kind: 'breached', hoursOver: 1 })).toContain('danger');
    expect(slaClass({ kind: 'page_lead', hoursLeft: 0.5 })).toContain('warn');
    expect(slaClass({ kind: 'ok', hoursLeft: 3 })).toContain('ok');
    expect(slaClass(null)).toContain('muted');
    expect(slaClass(null)).not.toContain('--ok');
  });
});

describe('ADMIN-5f console · REMOVE is absent, not disabled', () => {
  const held: RemoveState = { ok: true, needsChecker: false };
  const heldBig: RemoveState = { ok: true, needsChecker: true };
  it('is not offered when the listing is not held, and the reason carries the doctrine', () => {
    expect(removeBlockedKey({ ok: false, reason: 'not_held' }, null, 'op-a')).toBe('notHeld');
    expect(removeBlockedKey(null, null, 'op-a')).toBe('notHeld');
    expect(removeBlockedKey(undefined, null, 'op-a')).toBe('notHeld');
  });
  it('is not offered when a checker is required and none has looked', () => {
    expect(removeBlockedKey({ ok: false, reason: 'needs_checker', valueMinor: '44820000' }, 'op-a', 'op-b')).toBe('needsChecker');
  });
  it('is not offered to the operator who PLACED THE HOLD, above the threshold', () => {
    expect(removeBlockedKey(heldBig, 'op-a', 'op-a')).toBe('yourOwnHold');
    expect(removeBlockedKey(heldBig, 'op-a', 'op-b')).toBeNull();
  });
  it('IS offered to the same operator BELOW the threshold — a small removal is one person', () => {
    // The asymmetry is the point: gating every removal on a colleague would make the cheap path "leave it held",
    // which on perishable produce is its own harm.
    expect(removeBlockedKey(held, 'op-a', 'op-a')).toBeNull();
  });
  it('an UNKNOWN viewer or holder is offered it — the server refuses if wrong', () => {
    expect(removeBlockedKey(heldBig, 'op-a', null)).toBeNull();
    expect(removeBlockedKey(heldBig, null, 'op-a')).toBeNull();
  });
});

describe('ADMIN-5f console · value at stake', () => {
  it('formats from a STRING of minor units, grouped en-IN', () => {
    // A platform for Indian farmers reads lakh/crore grouping.
    expect(formatMinor('44820000')).toBe('₹4,48,200.00');
    expect(formatMinor('10000000')).toBe('₹1,00,000.00');
    expect(formatMinor('5')).toBe('₹0.05');
    expect(formatMinor('-100')).toBe('−₹1.00');
  });
  it('is EXACT beyond float precision', () => {
    // The result must survive, not just the parse — a cancelling or small value would prove nothing here.
    expect(formatMinor('9007199254740993')).toBe('₹9,00,71,99,25,47,409.93');
  });
  it('an unreadable value is a dash, never 0', () => {
    expect(formatMinor(null)).toBe('—');
    expect(formatMinor('lots')).toBe('—');
    expect(formatMinor('12.50')).toBe('—');
  });
  it('reports a value that CHANGED since the hold', () => {
    // The seller edited the listing while held, so the removal threshold was judged on the older figure.
    expect(valueDrift('44820000', '44820000')).toEqual({ drifted: false, known: true });
    expect(valueDrift('44820000', '9999999')).toEqual({ drifted: true, known: true });
  });
  it('an unreadable pair is UNKNOWN, not "no drift"', () => {
    expect(valueDrift('44820000', null)).toEqual({ drifted: false, known: false });
    expect(valueDrift(null, '1')).toEqual({ drifted: false, known: false });
    expect(valueDrift('44820000', 'lots')).toEqual({ drifted: false, known: false });
  });
});

describe('ADMIN-5f console · colours say what the act does to the seller', () => {
  it('a REMOVE is a failure and a RELEASE is the success case', () => {
    expect(orderClass('remove')).toContain('danger');
    expect(orderClass('release')).toContain('ok');
    expect(orderClass('hold')).toContain('warn');
    expect(orderClass('unknown')).toContain('muted');
  });
  it('QUEUED is NOT delivered and is not styled as success', () => {
    // admin-api writes `queued` and nothing has been sent. A console showing that as done would tell an operator the
    // farmer knows why their listing was stopped.
    expect(noticeClass('queued')).toContain('warn');
    expect(noticeClass('queued')).not.toContain('--ok');
    expect(noticeClass('delivered')).toContain('ok');
    expect(noticeClass('failed')).toContain('danger');
    expect(noticeClass('refused')).toContain('danger');
    expect(noticeClass(null)).toContain('muted');
    expect(noticeKey('queued')).toBe('queued');
    expect(noticeKey('sent')).toBe('unknown');
    expect(noticeKey(null)).toBe('unknown');
  });
});

describe('ADMIN-5f console · the order form', () => {
  const good = { source: 'fraud_flag', reason: 'price 4.2x above the mandi band', languageCode: 'gu' };
  it('accepts a proper hold', () => { expect(buildOrder(good, true).ok).toBe(true); });
  it('a HOLD requires a source; a release and a remove inherit it', () => {
    // Asking again on the release would invite a different answer for the same case.
    expect(buildOrder({ ...good, source: '' }, true).ok).toBe(false);
    expect(buildOrder({ ...good, source: '' }, false).ok).toBe(true);
    const r = buildOrder({ ...good, source: 'guesswork' }, true);
    expect(!r.ok && r.error).toBe('source');
  });
  it('REFUSES a thin reason — it is sent to the farmer about their own produce', () => {
    expect(REASON_MIN).toBe(20);
    const r = buildOrder({ ...good, reason: 'policy violation' }, true);
    expect(!r.ok && r.error).toBe('reason');
    expect(buildOrder({ ...good, reason: '   ' }, true).ok).toBe(false);
  });
  it('REFUSES a missing language', () => {
    const r = buildOrder({ ...good, languageCode: '' }, true);
    expect(!r.ok && r.error).toBe('language');
  });
  it('omits blank optional fields and drops an unknown source rather than sending it', () => {
    const r = buildOrder({ reason: good.reason, languageCode: 'en', source: 'nonsense', sourceRef: '', reporterUserId: '' }, false);
    expect(r.ok && 'source' in r.value).toBe(false);
    expect(r.ok && 'sourceRef' in r.value).toBe(false);
    expect(r.ok && 'reporterUserId' in r.value).toBe(false);
  });
  it('offers exactly the four sources', () => {
    expect([...HOLD_SOURCES]).toEqual(['fraud_flag', 'reported', 'regulated_category', 'spot_audit']);
  });
});

/* ================================================================================================ */
describe('ADMIN-5f console · W092 triage colours and cells', () => {
  it('a SAFETY-DESK row is a failure colour even when fresh', () => {
    // The colour marks what the row is about, not how late it is.
    expect(priorityClass('safety_desk')).toContain('danger');
    expect(priorityClass('sla_breached')).toContain('warn');
    expect(priorityClass('normal')).toContain('muted');
    expect(priorityClass(null)).toContain('muted');
  });
  it('an UNMEASURED report age is a warning, not a pass', () => {
    expect(reportSlaClass({ kind: 'unmeasured' })).toContain('warn');
    expect(reportSlaClass({ kind: 'unmeasured' })).not.toContain('--ok');
    expect(reportSlaClass({ kind: 'breached', overHours: 1 })).toContain('danger');
    expect(reportSlaClass({ kind: 'ok', ageHours: 1 })).toContain('ok');
    expect(reportSlaClass(null)).toContain('muted');
  });
  it('REPORTS ON SUBJECT is a dash when unknown, never 1', () => {
    // "This is the only report" is the reading that makes an operator dismiss something eighteen people flagged.
    expect(subjectCountText({ known: false, count: 0 })).toBe('—');
    expect(subjectCountText(null)).toBe('—');
    expect(subjectCountText({ known: true, count: 0 })).toBe('0');
    expect(subjectCountText({ known: true, count: 18 })).toBe('18');
  });
  it('a decided report with NO handler is reported as a gap, not assumed to be the platform', () => {
    expect(handlerKey('neither')).toBe('neither');
    expect(handlerKey('platform')).toBe('platform');
    expect(handlerKey('tenant')).toBe('tenant');
    expect(handlerKey(null)).toBe('open');
    expect(handlerKey('nonsense' as never)).toBe('open');
  });
  it('the page-order caveat appears only when there IS another page', () => {
    // On a single page "ordered within the page" and "ordered" are the same thing, and the caveat would only confuse.
    expect(pageOrderCaveatVisible(true, true)).toBe(true);
    expect(pageOrderCaveatVisible(true, false)).toBe(false);
    expect(pageOrderCaveatVisible(false, true)).toBe(false);
    expect(pageOrderCaveatVisible(null, true)).toBe(false);
  });
});

describe('ADMIN-5f console · the report decision form', () => {
  const base = { outcomeNote: 'the photos match the graded sample', languageCode: 'hi' };
  it('an ACTIONED decision must name an outcome', () => {
    expect(buildDecide({ ...base, status: 'actioned' }).ok).toBe(false);
    const r = buildDecide({ ...base, status: 'actioned', outcome: '' });
    expect(!r.ok && r.error).toBe('outcome');
    expect(buildDecide({ ...base, status: 'actioned', outcome: 'removed' }).ok).toBe(true);
  });
  it('a DISMISSAL must NOT carry one, and it is refused rather than stripped', () => {
    // Silently dropping it would let an operator believe they recorded an action.
    const r = buildDecide({ ...base, status: 'dismissed', outcome: 'removed' });
    expect(!r.ok && r.error).toBe('outcome');
    expect(buildDecide({ ...base, status: 'dismissed' }).ok).toBe(true);
    expect(buildDecide({ ...base, status: 'dismissed', outcome: '' }).ok).toBe(true);
  });
  it('REFUSES a thin explanation — even a dismissal owes the reporter words', () => {
    expect(OUTCOME_MIN).toBe(20);
    const r = buildDecide({ ...base, status: 'dismissed', outcomeNote: 'no action' });
    expect(!r.ok && r.error).toBe('note');
  });
  it('refuses an unknown status, an unknown outcome and a missing language', () => {
    expect(buildDecide({ ...base, status: 'escalated' }).ok).toBe(false);
    expect(buildDecide({ ...base, status: 'actioned', outcome: 'suspended' }).ok).toBe(false);
    const r = buildDecide({ ...base, status: 'dismissed', languageCode: '' });
    expect(!r.ok && r.error).toBe('language');
  });
  it('offers exactly the subject types and outcomes the platform may record', () => {
    expect([...SUBJECT_TYPES]).toEqual(['listing', 'review', 'message', 'user']);
    // `suspended` is absent: that is a band change on the risk plane with its own permission and second-person rule.
    expect([...PLATFORM_OUTCOMES]).toEqual(['hidden', 'removed', 'warned']);
  });
});
