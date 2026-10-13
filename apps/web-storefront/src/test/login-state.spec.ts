// apps/web-storefront/src/test/login-state.spec.ts · PC-56 STORE-1a · C5–C9 — the sign-in chain's URL states: unknown values fall back
// safely, `next` is same-origin only, and a sign-in URL NEVER carries a phone, a code or a token. Every named failure and buyer state has
// its sentence in all three languages.
import { loginStep, loginError, readLoginParams, loginHref, assertPiiFree, LOGIN_ERRORS, BUYER_STATES } from '../features/auth/login-state';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

describe('STORE-1a · login state', () => {
  it('steps and errors: unknown → phone / null', () => {
    expect(loginStep('code')).toBe('code');
    expect(loginStep('otp')).toBe('phone');
    expect(loginStep(undefined)).toBe('phone');
    expect(loginError('code_wrong')).toBe('code_wrong');
    expect(loginError('<script>')).toBeNull();
  });
  it('reads only bounded numbers and a same-origin next', () => {
    const p = readLoginParams({ step: '2fa', err: 'rate_hourly', n: '1800', max: '5', left: 'x', next: '//evil.example', dial: '9100' });
    expect(p).toMatchObject({ step: '2fa', err: 'rate_hourly', n: 1800, max: 5, left: null, next: '/', dial: null });
    expect(readLoginParams({ next: '/anand-fpo/listings/1' }).next).toBe('/anand-fpo/listings/1');
    expect(readLoginParams({ next: '/\\evil' }).next).toBe('/');
  });
  it('builds the chain hrefs on the house carryValues (step first, blanks dropped)', () => {
    expect(loginHref('/login', { step: 'code' })).toBe('/login?step=code');
    expect(loginHref('/anand-fpo/login', { step: 'phone', err: 'phone_digits', need: 10, have: 9, dial: '91', next: '/cart' }))
      .toBe('/anand-fpo/login?step=phone&next=%2Fcart&err=phone_digits&need=10&have=9&dial=91');
    expect(loginHref('/login', { step: 'done', buy: 'granted', next: '/' })).toBe('/login?step=done&buy=granted');
  });
  it('NEVER PII in a sign-in URL: a phone-shaped value is refused', () => {
    expect(() => assertPiiFree('/login?step=code&n=9876543210')).toThrow(/personal data/);
    expect(() => assertPiiFree('/login?step=code&phone=x')).toThrow(/personal data/);
    expect(() => assertPiiFree('/login?step=code&code=1')).toThrow(/personal data/);
    expect(() => assertPiiFree('/login?step=code&n=86400')).not.toThrow();
    expect(() => loginHref('/login', { step: 'code', n: 9876543210 })).toThrow();
  });
  it('every named failure, buyer state and tenant state has a sentence in en, hi and gu', () => {
    const keys = [...LOGIN_ERRORS.map((e) => `auth.err.${e}`), ...BUYER_STATES.map((b) => `auth.done.buy.${b}`),
      'auth.tenant.not_configured', 'auth.tenant.not_found', 'auth.tenant.unavailable'];
    for (const cat of [en, hi, gu]) for (const k of keys) expect([k, typeof cat[k]]).toEqual([k, 'string']);
  });
});
