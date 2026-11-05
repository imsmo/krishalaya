// apps/web-ops/src/test/aeps.spec.ts · OW-5 (PC-55 B3). Every spec here corresponds to a line in Ledger Appendix 3
// (canon W390–W392). These are not style rules: each one is the difference between a person being helped and a
// person being sent away — or worse, a biometric being read on a device nobody certified.
import {
  SERVICE_KINDS, EVENT_STATUSES, EXCEPTION_CODES, MAX_ATTEMPTS,
  isServiceKind, isEventStatus, isExceptionCode, uncertifiedAllowed, escalationRequired, amountExpected,
  buildAepsEvent, nextStep, moneyUntouched, attemptsLeft, maskLast4,
} from '../features/aeps/service';
import { parseMajorToMinor } from '../features/money';
import * as fs from 'node:fs';
import * as path from 'node:path';

// NAMED UPDATE (PC-56 OPS-1b, founder Q7-A 2026-11-05): the form carries no `aadhaarLast4` and no `customerUserId` any more — the builder has
// neither field. The Law 2 cases that typed an Aadhaar now prove the digits are DROPPED from what is sent, never recorded (below).
const form = (over: Partial<Record<string, string | boolean>> = {}) => ({
  serviceKind: 'cash_withdrawal', status: 'success', attemptNo: '1', deviceCertified: true,
  bankName: 'SBI', accountLast4: '4321',
  amountMajor: '2000', balanceAfterMajor: '', exceptionCode: '', npciRrn: '', escalationNote: '',
  ...over,
} as Parameters<typeof buildAepsEvent>[0]);

const build = (over: Partial<Record<string, string | boolean>> = {}) => buildAepsEvent(form(over), parseMajorToMinor);

describe('vocabularies mirror the API exactly', () => {
  it('service kinds, statuses and the W392 exception taxonomy', () => {
    expect([...SERVICE_KINDS]).toEqual(['cash_withdrawal', 'balance_enquiry', 'mini_statement']);
    expect([...EVENT_STATUSES]).toEqual(['success', 'failed', 'declined', 'blocked']);
    expect([...EXCEPTION_CODES]).toEqual(['device_not_rd_certified', 'finger_fail', 'bank_server_down', 'cap_exceeded', 'bank_declined']);
    expect(MAX_ATTEMPTS).toBe(3);
  });
  it('rejects anything outside them (including an invented OTP fallback)', () => {
    expect(isServiceKind('cash_deposit')).toBe(false);
    expect(isEventStatus('pending')).toBe(false);
    expect(isExceptionCode('otp_fallback')).toBe(false);   // there is NO OTP path in AePS (W391)
    expect(isExceptionCode('otp_failed')).toBe(false);
    expect(isExceptionCode(undefined)).toBe(false);
  });
});

describe('LAW 2 — masked identifiers only', () => {
  it('accepts exactly four digits, or nothing', () => {
    expect(build({ accountLast4: '' }).ok).toBe(true);
    expect(build({ accountLast4: '4321' }).ok).toBe(true);
  });
  it('refuses a longer account number', () => {
    expect(build({ accountLast4: '12345678' })).toEqual({ ok: false, error: 'last4Account' });
    expect(build({ accountLast4: '43a1' })).toEqual({ ok: false, error: 'last4Account' });
  });
  it('the display mask never prints more than four digits, even if a longer value somehow arrives', () => {
    expect(maskLast4('4321')).toBe('•••• 4321');
    expect(maskLast4('123456789012')).toBe('•••• 9012');   // defensive: a bad backfill must not leak here
    expect(maskLast4(null)).toBe('');
    expect(maskLast4('   ')).toBe('');
  });
});

describe('LAW 3 — three attempts, and no OTP fallback', () => {
  it('accepts 1..3 only, and refuses a fractional attempt rather than truncating it', () => {
    for (const n of ['1', '2', '3']) expect(build({ attemptNo: n, exceptionCode: '', status: 'success' }).ok).toBe(true);
    expect(build({ attemptNo: '0' })).toEqual({ ok: false, error: 'attempt' });
    expect(build({ attemptNo: '4' })).toEqual({ ok: false, error: 'attempt' });
    expect(build({ attemptNo: '2.5' })).toEqual({ ok: false, error: 'attempt' });
    expect(build({ attemptNo: '' })).toEqual({ ok: false, error: 'attempt' });
  });
  it('counts attempts left, and 0 left means escalate (never "try another way")', () => {
    expect(attemptsLeft(1)).toBe(2);
    expect(attemptsLeft(3)).toBe(0);
    expect(attemptsLeft(9)).toBe(0);        // never negative
    expect(attemptsLeft(null)).toBe(3);
    expect(nextStep({ exceptionCode: 'finger_fail', attemptNo: 3 })).toBe('escalate');
    expect(nextStep({ exceptionCode: 'finger_fail', attemptNo: 2 })).toBe('retry_allowed');
  });
});

describe('LAW 4 — an uncertified reader can only BLOCK', () => {
  it('permits exactly one shape of record', () => {
    expect(uncertifiedAllowed('blocked', 'device_not_rd_certified')).toBe(true);
    expect(uncertifiedAllowed('blocked', 'finger_fail')).toBe(false);
    expect(uncertifiedAllowed('failed', 'device_not_rd_certified')).toBe(false);
    expect(uncertifiedAllowed('success', undefined)).toBe(false);
  });
  it('refuses a SUCCESS on an uncertified device — the fraud the certification exists to stop', () => {
    expect(build({ deviceCertified: false, status: 'success' })).toEqual({ ok: false, error: 'uncertified' });
    expect(build({ deviceCertified: false, status: 'failed', exceptionCode: 'finger_fail' })).toEqual({ ok: false, error: 'uncertified' });
  });
  it('accepts the blocked device record, and tells the operator to switch readers', () => {
    const r = build({ deviceCertified: false, status: 'blocked', exceptionCode: 'device_not_rd_certified', amountMajor: '2000' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ status: 'blocked', exceptionCode: 'device_not_rd_certified', deviceCertified: false });
    expect(nextStep({ exceptionCode: 'device_not_rd_certified' })).toBe('switch_device');
    expect(nextStep({ deviceCertified: false })).toBe('switch_device');
  });
});

describe('LAW 5 — the third finger-fail must escalate', () => {
  it('knows exactly when the note becomes mandatory', () => {
    expect(escalationRequired('finger_fail', 3)).toBe(true);
    expect(escalationRequired('finger_fail', 2)).toBe(false);
    expect(escalationRequired('bank_server_down', 3)).toBe(false);
    expect(escalationRequired(undefined, 3)).toBe(false);
  });
  it('refuses the third failure without it, and accepts it with the note', () => {
    expect(build({ status: 'failed', exceptionCode: 'finger_fail', attemptNo: '3', escalationNote: '  ' }))
      .toEqual({ ok: false, error: 'escalation' });
    const ok = build({ status: 'failed', exceptionCode: 'finger_fail', attemptNo: '3', escalationNote: 'sent to SBI mitra, Nadiad road' });
    expect(ok.ok && ok.value.escalationNote).toBe('sent to SBI mitra, Nadiad road');
  });
  it('says the money is untouched for every non-success — the sentence a frightened customer needs first', () => {
    expect(moneyUntouched({ status: 'failed' })).toBe(true);
    expect(moneyUntouched({ status: 'declined' })).toBe(true);
    expect(moneyUntouched({ status: 'blocked' })).toBe(true);
    expect(moneyUntouched({ status: 'success' })).toBe(false);
  });
});

describe('LAW 1 — a log, not a money primitive', () => {
  it('an amount belongs to a withdrawal and to nothing else', () => {
    expect(amountExpected('cash_withdrawal')).toBe(true);
    expect(amountExpected('balance_enquiry')).toBe(false);
    expect(build({ serviceKind: 'cash_withdrawal', amountMajor: '' })).toEqual({ ok: false, error: 'amountMissing' });
    expect(build({ serviceKind: 'balance_enquiry', amountMajor: '2000' })).toEqual({ ok: false, error: 'amountNotAllowed' });
    expect(build({ serviceKind: 'balance_enquiry', amountMajor: '' }).ok).toBe(true);
  });
  it('money is a bigint minor STRING, parsed float-free (Law 2 of the platform)', () => {
    const r = build({ amountMajor: '2000.50' });
    expect(r.ok && r.value.amountMinor).toBe('200050');
    expect(typeof (r.ok && r.value.amountMinor)).toBe('string');
    expect(build({ amountMajor: '0' })).toEqual({ ok: false, error: 'amount' });
    expect(build({ amountMajor: 'two thousand' })).toEqual({ ok: false, error: 'amount' });
    expect(build({ amountMajor: '-500' })).toEqual({ ok: false, error: 'amount' });
  });
  it('a FAILED withdrawal still records what was attempted (the number the customer will ask about)', () => {
    const r = build({ status: 'declined', exceptionCode: 'bank_declined', amountMajor: '1500' });
    expect(r.ok && r.value.amountMinor).toBe('150000');
  });
  it('the bank-reported balance is optional and equally float-free', () => {
    const r = build({ balanceAfterMajor: '1234.05' });
    expect(r.ok && r.value.balanceAfterMinor).toBe('123405');
    expect(build({ balanceAfterMajor: 'unknown' })).toEqual({ ok: false, error: 'balance' });
    const blank = build({ balanceAfterMajor: '' });
    expect(blank.ok && 'balanceAfterMinor' in blank.value).toBe(false);
  });
});

describe('cross-field rules and the operator’s next step', () => {
  it('a success cannot also carry a fault', () => {
    expect(build({ status: 'success', exceptionCode: 'bank_declined' })).toEqual({ ok: false, error: 'successException' });
  });
  it('an unknown fault code never reaches the API', () => {
    expect(build({ exceptionCode: 'otp_fallback' })).toEqual({ ok: false, error: 'exception' });
  });
  it('optional fields are validated rather than silently dropped', () => {
    expect(build({ npciRrn: 'x'.repeat(41) })).toEqual({ ok: false, error: 'rrn' });
  });
  it('a bank outage is retryable; a settled event needs no chasing', () => {
    expect(nextStep({ exceptionCode: 'bank_server_down' })).toBe('retry_allowed');
    expect(nextStep({ status: 'success' })).toBe('none');
    expect(nextStep({ status: 'declined', exceptionCode: 'bank_declined' })).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// PC-56 OPS-1b · Q7-A (founder 2026-11-05) — the AePS record keeps the least, and the device box starts UNTICKED
// ---------------------------------------------------------------------------

describe('OPS-1b · Q7-A · no Aadhaar digit and no customer link ever leave the console', () => {
  it('even if a raw form somehow carries them (a stale page, a hand-made POST), the built event carries neither key', () => {
    const r = buildAepsEvent({ ...form(), aadhaarLast4: '9876', customerUserId: '0190a000-0000-7000-8000-00000000c0de' } as Parameters<typeof buildAepsEvent>[0], parseMajorToMinor);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(Object.keys(r.value).filter((k) => /aadhaar|customer/i.test(k))).toEqual([]); expect(JSON.stringify(r.value)).not.toMatch(/9876|c0de/); }
  });
  it('the record action reads no Aadhaar or customer field from the form, and the record view has no such input', () => {
    const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join('\n');
    for (const rel of ['app/aeps/withdrawal/actions.ts', 'components/ops1/AepsViews.tsx']) expect([rel, /aadhaar|customerUserId|customer_user/i.test(src(rel))]).toEqual([rel, false]);
  });
  it('the device box is UNTICKED by default: no defaultChecked / checked on it in the view', () => {
    const v = fs.readFileSync(path.join(__dirname, '..', 'components/ops1/AepsViews.tsx'), 'utf8');
    const box = v.slice(v.indexOf('name="deviceCertified"') - 200, v.indexOf('name="deviceCertified"') + 200);
    expect(box).toContain('type="checkbox"');
    expect(/defaultChecked|\bchecked\b/.test(box)).toBe(false);
  });
  it('the old /money pages are gone (moved to /aeps/withdrawal and /aeps/exceptions)', () => {
    for (const rel of ['app/money/page.tsx', 'app/money/actions.ts', 'app/money/oversight/page.tsx']) expect([rel, fs.existsSync(path.join(__dirname, '..', rel))]).toEqual([rel, false]);
  });
});
