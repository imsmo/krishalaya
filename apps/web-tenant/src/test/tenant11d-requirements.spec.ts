// apps/web-tenant/src/test/tenant11d-requirements.spec.ts · PC-56 TENANT-11d — the console's pure rules for buyer requirements:
// the states come from the API (flag 404 → flagged off, 403 → restricted), every refusal is a sentence key, the desk's post needs a
// buyer + consent (+ evidence for voice / written), the line form refuses by name, money is rupees ↔ paise on the digits,
// quantities are thousandths, a decision the desk makes for the buyer is a consent act, and Retry is never a mutation.
import {
  AUDIT, BUYER_DECISIONS, REQ_TABS, actHref, addable, budgetShape, codeKey, consoleState, createBody, failureCodesFrom, indiaToday, lineHref, minorToRupees,
  missingNames, qtyMilli, qtyText, reasonRule, reqEntries, retryIsMutation, reviewLine, reviewRequirement, rupeesToMinor, tabHref,
} from '../features/requirements/console';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const U = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('PC-56 TENANT-11d · states from the API, not the web env', () => {
  it('404 → flagged off (or not found for an id), 403 / desk refusals → restricted, else error', () => {
    expect(consoleState('NOT_FOUND', 404)).toBe('flaggedOff');
    expect(consoleState('NOT_FOUND', 404, true, { id: U })).toBe('notFound');
    expect(consoleState('REQUIREMENT_DESK_FORBIDDEN', 403)).toBe('restricted');
    expect(consoleState('AUDITOR_READ_ONLY', 403)).toBe('restricted');
    expect(consoleState('BOOM', 500)).toBe('error');
  });
  it('every tab is a status filter (+ all); the need-by sort is carried', () => {
    expect(REQ_TABS).toEqual(['all', 'open', 'partially_matched', 'fulfilled', 'expired', 'closed']);
    expect(tabHref('fulfilled', 'need_by')).toBe('/marketplace/requirements?tab=fulfilled&sort=need_by');
    expect(tabHref('all', 'recent')).toBe('/marketplace/requirements');
  });
});

describe('PC-56 TENANT-11d · the post-requirement form (W2371–W2374)', () => {
  const today = '2026-10-02';
  it('as the buyer desk: buyer + consent required, voice needs evidence; the body carries onBehalf', () => {
    const e = reqEntries({ title: 'GG-20 groundnut', quantity: '40', unitCode: 'quintal', budgetMax: '6500', asDesk: '1', consentChannel: 'voice' });
    expect(reviewRequirement(e, today).map((r) => r.code)).toEqual(['BUYER_REQUIRED', 'CONSENT_EVIDENCE_REQUIRED']);
    const ok = reqEntries({ title: 'GG-20 groundnut', quantity: '40', unitCode: 'quintal', budgetMax: '6500', needBy: '2026-10-16', isUrgent: '1', pincode: '360002', asDesk: '1', buyerUserId: U, consentChannel: 'otp' });
    expect(reviewRequirement(ok, today)).toEqual([]);
    expect(createBody(ok)).toEqual({ title: 'GG-20 groundnut', quantity: '40', unitCode: 'quintal', budgetMaxMinor: '650000', needBy: '2026-10-16', deliveryPincode: '360002', isUrgent: true,
      onBehalf: { buyerUserId: U, consent: { channel: 'otp' } } });
  });
  it('refuses a past need-by, an inverted budget, a bad pincode, a zero quantity — all at once', () => {
    const e = reqEntries({ title: 'x', quantity: '0', unitCode: '', budgetMin: '700', budgetMax: '600', needBy: '2026-10-01', pincode: '3600' });
    expect(reviewRequirement(e, today).map((r) => r.code)).toEqual(['TITLE_INVALID', 'QUANTITY_INVALID', 'UNIT_REQUIRED', 'BUDGET_INVALID', 'NEED_BY_INVALID', 'PINCODE_INVALID']);
  });
  it('a member posting for themself sends no onBehalf', () => {
    expect(createBody(reqEntries({ title: 'Need cumin', quantity: '5', unitCode: 'quintal' }))).toEqual({ title: 'Need cumin', quantity: '5', unitCode: 'quintal' });
  });
  it('the India day is the need-by day', () => { expect(indiaToday(new Date('2026-10-01T19:00:00Z'))).toBe('2026-10-02'); });
});

describe('PC-56 TENANT-11d · the member line (W2364–W2367) and the money', () => {
  it('add needs a listing + quantity; consent needs a channel (+ evidence for voice / written)', () => {
    expect(reviewLine({ quantity: '17' }, 'add').map((r) => r.code)).toEqual(['LISTING_REQUIRED']);
    expect(reviewLine({ listingId: U, quantity: '17', price: '0' }, 'add').map((r) => r.code)).toEqual(['PRICE_INVALID']);
    expect(reviewLine({ consentChannel: 'written' }, 'consent').map((r) => r.code)).toEqual(['CONSENT_EVIDENCE_REQUIRED']);
    expect(reviewLine({ consentChannel: 'otp' }, 'consent')).toEqual([]);
  });
  it('rupees ↔ paise on the digits; quantities as thousandths', () => {
    expect(rupeesToMinor('6,340.5')).toBe('634050'); expect(rupeesToMinor('0')).toBe('invalid'); expect(rupeesToMinor('')).toBeUndefined();
    expect(minorToRupees('634000')).toBe('6340'); expect(minorToRupees('634050')).toBe('6340.50');
    expect(qtyMilli('12.5')).toBe(12_500n); expect(qtyText('40.000')).toBe('40'); expect(qtyText('12.500')).toBe('12.5');
    expect(addable('30.000', '40.000')).toBe('30.000'); expect(addable('30', '17')).toBe('17.000'); expect(addable('5', '0')).toBe('0.000');
  });
  it('the budget is read as a ceiling', () => {
    expect(budgetShape(null, '650000')).toBe('max'); expect(budgetShape('600000', '650000')).toBe('range'); expect(budgetShape(null, null)).toBe('none');
  });
});

describe('PC-56 TENANT-11d · the mutate chain (W2368–W2370)', () => {
  it('the desk\'s decisions for the buyer are the consent acts; withdraw always needs a reason, a moderator\'s close too', () => {
    expect(BUYER_DECISIONS).toEqual(['accept', 'acceptGroup', 'shortlist', 'reject', 'rejectGroup']);
    expect(reasonRule('withdraw', false)).toBe('required'); expect(reasonRule('close', true)).toBe('required'); expect(reasonRule('close', false)).toBe('optional');
    expect(reasonRule('accept', true)).toBe('none');
  });
  it('the success screen reads the right audit row back', () => {
    expect(AUDIT.send).toEqual({ entityType: 'requirement_response_group', action: 'requirement.group_sent' });
    expect(AUDIT.accept).toEqual({ entityType: 'requirement_response', action: 'requirement.quote_accepted' });
    expect(AUDIT.close).toEqual({ entityType: 'requirement', action: 'requirement.closed' });
  });
  it('codes → sentences; CONSENT_MISSING carries the member names (short names only); Retry is a page load', () => {
    expect(codeKey('CONSENT_MISSING')).toBe('rq.code.CONSENT_MISSING'); expect(codeKey('REASON_REQUIRED')).toBe('rq.refusal.REASON_REQUIRED'); expect(codeKey('wat')).toBe('rq.code.unknown');
    expect(failureCodesFrom(undefined, 403)).toEqual(['FORBIDDEN']);
    expect(missingNames({ members: [{ userId: U, name: 'Meera J.' }] })).toEqual(['Meera J.']);
    expect(missingNames(null)).toEqual([]);
    expect(retryIsMutation()).toBe(false);
    expect(actHref(U, 'send', { gid: U })).toBe(`/marketplace/requirements/${U}/act?step=confirm&act=send&gid=${U}`);
    expect(lineHref(U, { mode: 'add', gid: U })).toBe(`/marketplace/requirements/${U}/line?step=edit&mode=add&gid=${U}`);
  });
  it('every code and refusal the console can print has a sentence in en / hi / gu; the refusals by name are printed', () => {
    for (const k of ['rq.code.CONSENT_MISSING', 'rq.code.REQUIREMENT_BUYER_CONSENT_REQUIRED', 'rq.stock.aiRefused', 'rq.crossTenantRefused', 'rq.demandMapRefused', 'rq.draftKeptNote']) {
      for (const cat of [en, hi, gu]) expect(typeof (cat as Record<string, string>)[k]).toBe('string');
    }
    expect(en['rq.stock.aiRefused']).toMatch(/AI score not yet available/);
    expect(Object.keys(en).some((k) => k.startsWith('reqs.'))).toBe(false);
  });
});
