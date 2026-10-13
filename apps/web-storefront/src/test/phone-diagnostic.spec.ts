// apps/web-storefront/src/test/phone-diagnostic.spec.ts · PC-56 STORE-1a · C5 — the phone field's refusals: the digit rule comes from
// the country (no +91 literal on the screen), and every number the storefront accepts for India is one the API's OWN normaliser
// (apps/api/src/shared/utils/phone.ts, imported here) reads as the same E.164 — so the screen never promises what the API refuses.
import { checkPhone, phoneRuleFor, PHONE_RULES } from '../features/auth/phone';
import { normalizePhoneE164 } from '../../../api/src/shared/utils/phone';

describe('STORE-1a · phone diagnostic', () => {
  it.each([
    ['9876543210'], ['09876543210'], ['919876543210'], ['+919876543210'], ['0091 98765 43210'], ['+91 98765-43210'], ['(98765) 43210'],
  ])('IN accepts %s exactly as the API normaliser does', (raw) => {
    const c = checkPhone(raw, 'IN');
    expect(c).toEqual({ kind: 'ok', e164: '+919876543210' });
    expect(normalizePhoneE164(raw)).toBe('+919876543210');
  });
  it('a short Indian number names the rule: "needs 10 digits after +91 — this one has 9" (canon W321)', () => {
    expect(checkPhone('987654321', 'IN')).toEqual({ kind: 'digits', dial: '91', need: 10, have: 9 });
    expect(checkPhone('+91 98765 4321', 'IN')).toEqual({ kind: 'digits', dial: '91', need: 10, have: 9 });
    expect(checkPhone('98765432100', 'IN')).toEqual({ kind: 'digits', dial: '91', need: 10, have: 11 });
    expect(normalizePhoneE164('987654321')).toBeNull();
  });
  it('empty, letters, and a bare number with no known country rule are not guessed at', () => {
    expect(checkPhone('', 'IN')).toEqual({ kind: 'empty' });
    expect(checkPhone('call me', 'IN')).toEqual({ kind: 'generic' });
    expect(checkPhone('7700900123', null)).toEqual({ kind: 'generic' });
    expect(checkPhone('7700900123', 'GB')).toEqual({ kind: 'generic' });
  });
  it('a full international number is accepted whatever the store country', () => {
    expect(checkPhone('+447700900123', 'IN')).toEqual({ kind: 'ok', e164: '+447700900123' });
    expect(checkPhone('+447700900123', null)).toEqual({ kind: 'ok', e164: '+447700900123' });
  });
  it('the rule table is data: India first, keyed by ISO country, case-insensitive', () => {
    expect(Object.keys(PHONE_RULES)[0]).toBe('IN');
    expect(phoneRuleFor('in')).toEqual({ country: 'IN', dial: '91', nationalDigits: 10, trunkPrefix: '0' });
    expect(phoneRuleFor('ZZ')).toBeNull();
  });
});
