// apps/web-storefront/src/test/store1c-signup.spec.ts · PC-56 STORE-1c — the PURE half of canon W307 /for-organisations and /pricing:
//   • the pending-cookie codec round-trips and RE-VALIDATES every field (a cookie is input like any other);
//   • step resolution: no step past its prerequisite;
//   • the form's refusals: every one at once, each against its field;
//   • the API refusal map: every named code to its step and sentence (SIGNUP_DISABLED, taken, reserved, plan, OTP wrong/expired/locked, the
//     route's rate limit with its wait, the verify throttle, a 5xx / network error = unavailable — Law 12);
//   • the Idempotency-Key shape; the URL never carries PII (signupHref throws on a phone-shaped value);
//   • the price printer: minor units through the one money formatter, the exponent must agree with the currency, setup fee only above zero;
//   • the W307 refusals and the 14 chain pages are recorded by name.
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import {
  FIELD_REFUSALS, NAME_RULES, REFUSAL_FIELD, SIGNUP_ERRORS, checkSignupForm, classifyCodeRequestFailure, classifySignupFailure, decodePending,
  encodePending, formatDay, isIdemKey, readSignupParams, resolveSignupStep, signupHref, signupLang, type PendingSignup,
} from '../features/signup/flow';
import { countryName, planPrice, pricingCountry, showsSetupFee } from '../features/pricing/plans';
import { STORE1C_CHAIN_PAGES, STORE1C_REFUSALS, signupRefusalKeys } from '../features/home/refusals';
import { STATIC_TOP_SEGMENTS } from '../features/auth/redirect';

const TYPE = '0190a8b2-0000-7000-8000-0000000000f0';
const KEY = '0190a8b2-0000-7000-8000-00000000c0de';
const VALUES = { orgName: 'Bhavnagar Kisan FPC', orgTypeId: TYPE, fullName: 'Kavita Ben', typed: '98765 43210', lang: 'gu' as const };
const err = (code: string, status: number, details?: Record<string, unknown>) => ({ code, status, details });

describe('STORE-1c · the pending cookie (kv_signup)', () => {
  it('round-trips every field', () => {
    const p: PendingSignup = { ...VALUES, phone: '+919876543210', sentAt: 100, resendAt: 130, ttlSec: 300, code: '123456', idem: KEY,
      done: { org: 'Bhavnagar Kisan FPC', slug: 'bhavnagar-kisan-fpc', trialEndsOn: '2026-10-28', resumed: false } };
    expect(decodePending(encodePending(p))).toEqual(p);
  });

  it('re-validates on the way in: a bad phone, code, key, type, slug or date is DROPPED, never trusted; garbage is null', () => {
    const raw = Buffer.from(JSON.stringify({ orgName: 'x'.repeat(500), orgTypeId: 'not-a-uuid', fullName: 'K', typed: '1'.repeat(80), lang: 'fr',
      phone: '9876543210', code: '12ab', idem: 'my-key', done: { org: 'X', slug: 'Bad Slug', trialEndsOn: 'soon', resumed: 'yes' } }), 'utf8').toString('base64url');
    const p = decodePending(raw)!;
    expect(p.orgName.length).toBe(200); expect(p.typed.length).toBe(32);
    expect(p.orgTypeId).toBe(''); expect(p.lang).toBe('en');
    expect(p.phone).toBeUndefined(); expect(p.code).toBeUndefined(); expect(p.idem).toBeUndefined(); expect(p.done).toBeUndefined();
    expect(decodePending('%%%not-base64-json')).toBeNull(); expect(decodePending(undefined)).toBeNull();
  });
});

describe('STORE-1c · steps (no step past its prerequisite)', () => {
  const sent: PendingSignup = { ...VALUES, phone: '+919876543210' };
  it.each([
    ['form', null, 'form'], ['nonsense', null, 'form'], ['code', null, 'form'], ['code', VALUES, 'form'], ['code', sent, 'code'],
    ['review', sent, 'code'], ['review', VALUES, 'form'], ['review', { ...sent, code: '123456' }, 'review'],
    ['done', sent, 'form'], ['done', { ...VALUES, done: { org: 'X', slug: 'x', trialEndsOn: null, resumed: false } }, 'done'],
    ['failure', sent, 'form'], ['failure', { ...sent, code: '123456' }, 'failure'],
  ] as const)('?step=%s with %j → %s', (raw, p, want) => {
    expect(resolveSignupStep(raw, p as PendingSignup | null)).toBe(want);
  });
});

describe('STORE-1c · the form\'s refusals (W2466: every invalid field, with its reason)', () => {
  it('a good form passes and normalises the phone for the platform country', () => {
    expect(checkSignupForm(VALUES, 'IN')).toEqual({ ok: true, e164: '+919876543210' });
  });
  it('every refusal at once, each mapped to its field; the digit rule carries its numbers', () => {
    const r = checkSignupForm({ orgName: 'ab', orgTypeId: '', fullName: 'K', typed: '98765', lang: 'en' }, 'IN');
    expect(r).toEqual({ ok: false, refusals: ['org_short', 'type_missing', 'name_short', 'phone_digits'], digits: { need: 10, have: 5, dial: '91' } });
    expect(FIELD_REFUSALS.map((f) => REFUSAL_FIELD[f])).toEqual(['orgName', 'orgName', 'orgTypeId', 'fullName', 'fullName', 'phone', 'phone', 'phone']);
  });
  it('length only, any script — the canon\'s own tenant name passes; too long is refused', () => {
    expect(checkSignupForm({ ...VALUES, orgName: 'આનંદ ખેડૂત ઉત્પાદક કંપની' }, 'IN').ok).toBe(true);
    expect(checkSignupForm({ ...VALUES, orgName: 'x'.repeat(NAME_RULES.orgMax + 1) }, 'IN')).toMatchObject({ refusals: ['org_long'] });
    expect(checkSignupForm({ ...VALUES, typed: '' }, 'IN')).toMatchObject({ refusals: ['phone_empty'] });
    expect(checkSignupForm({ ...VALUES, typed: '12345678' }, null)).toMatchObject({ refusals: ['phone_invalid'] });
  });
  it('the console language is one of en/hi/gu, else the reader\'s, else en', () => {
    expect(signupLang('gu', 'en')).toBe('gu'); expect(signupLang('fr', 'hi')).toBe('hi'); expect(signupLang(undefined, 'ar')).toBe('en');
  });
});

describe('STORE-1c · the API\'s refusals, by name (W2469 = W3067)', () => {
  it.each([
    [err('SIGNUP_DISABLED', 403), { step: 'failure', err: 'disabled' }],
    [err('SIGNUP_SLUG_UNAVAILABLE', 409), { step: 'form', err: 'taken' }],
    [err('SIGNUP_SLUG_RESERVED', 409), { step: 'form', err: 'reserved' }],
    [err('SIGNUP_PLAN_NOT_OFFERED', 400), { step: 'failure', err: 'plan_not_offered' }],
    [err('SIGNUP_TRIAL_PLAN_UNAVAILABLE', 503), { step: 'failure', err: 'trial_unavailable' }],
    [err('SIGNUP_ROLE_MISSING', 503), { step: 'failure', err: 'trial_unavailable' }],
    [err('OTP_INVALID', 401, { reason: 'wrong', attemptsLeft: 3 }), { step: 'code', err: 'code_wrong', left: 3 }],
    [err('OTP_INVALID', 401, { reason: 'expired', attemptsLeft: 0 }), { step: 'code', err: 'code_expired' }],
    [err('OTP_INVALID', 401, { reason: 'locked', attemptsLeft: 0, retryAfterSec: 300 }), { step: 'code', err: 'code_locked', n: 300 }],
    [err('RATE_LIMITED', 429, { limit: 5, windowSec: 3600 }), { step: 'failure', err: 'rate_signup', n: 3600 }],
    [err('RATE_LIMITED', 429, { limit: 'verifications_per_hour', max: 30, retryAfterSec: 1200 }), { step: 'failure', err: 'rate_verify', n: 1200, max: 30 }],
    [err('VALIDATION_FAILED', 400), { step: 'form', err: 'invalid' }],
    [err('INTERNAL', 503), { step: 'failure', err: 'unavailable' }],
    [new Error('fetch failed'), { step: 'failure', err: 'unavailable' }],
  ])('%j → %j', (e, want) => {
    expect(classifySignupFailure(e)).toEqual(want);
  });
  it('the code request (POST /v1/auth/otp) refusals land on the form with their waits; ivr/whatsapp refusal is "channel"', () => {
    expect(classifyCodeRequestFailure(err('RATE_LIMITED', 429, { limit: 'resend_cooldown', retryAfterSec: 22 }))).toEqual({ step: 'form', err: 'rate_cooldown', n: 22 });
    expect(classifyCodeRequestFailure(err('RATE_LIMITED', 429, { limit: 'requests_per_hour', max: 5, retryAfterSec: 1800 }))).toEqual({ step: 'form', err: 'rate_hourly', n: 1800, max: 5 });
    expect(classifyCodeRequestFailure(err('OTP_CHANNEL_UNAVAILABLE', 409))).toEqual({ step: 'form', err: 'channel' });
    expect(classifyCodeRequestFailure(new Error('down'))).toEqual({ step: 'form', err: 'unavailable' });
  });
  it('every named refusal has its sentence in all three catalogues', () => {
    for (const cat of [en, hi, gu] as Record<string, string>[]) {
      for (const e of SIGNUP_ERRORS) expect([e, typeof cat[`signup.err.${e}`]]).toEqual([e, 'string']);
      for (const f of FIELD_REFUSALS) expect([f, typeof cat[`signup.field.${f}`]]).toEqual([f, 'string']);
    }
  });
});

describe('STORE-1c · the key and the URL', () => {
  it('isIdemKey: a UUID minted at render; anything else is replaced', () => {
    expect(isIdemKey(KEY)).toBe(true);
    for (const bad of ['', 'abc', `${KEY}x`, 42, null, undefined]) expect(isIdemKey(bad)).toBe(false);
  });
  it('signupHref carries the step, named codes and small numbers only — and THROWS on a phone-shaped value (E5)', () => {
    expect(signupHref('form', { fields: ['org_short', 'phone_digits'], need: 10, have: 9, dial: '91' })).toBe('/for-organisations?step=form&e=org_short.phone_digits&need=10&have=9&dial=91');
    expect(signupHref('code', { err: 'code_wrong', left: 3 })).toBe('/for-organisations?step=code&err=code_wrong&left=3');
    expect(signupHref('failure', { err: 'rate_signup', n: 3600 })).toBe('/for-organisations?step=failure&err=rate_signup&n=3600');
    expect(() => signupHref('code', { n: 9876543210 })).toThrow(/personal data/);
  });
  it('readSignupParams accepts only known codes and bounded numbers', () => {
    const p = readSignupParams({ step: 'form', e: 'org_short.hacked.phone_empty', err: 'taken', n: '9999999', left: '3', dial: '9100' });
    expect(p).toMatchObject({ step: 'form', err: 'taken', fields: ['org_short', 'phone_empty'], n: null, left: 3, dial: null });
    expect(readSignupParams({ err: 'drop table' }).err).toBeNull();
  });
  it('the trial end date is a calendar DATE in the reader\'s language (no clock shift)', () => {
    expect(formatDay('2026-10-28', 'en-IN')).toBe('28 October 2026');
    expect(formatDay('garbage', 'en-IN')).toBe('garbage');
  });
});

describe('STORE-1c · /pricing — the price printer (founder D2)', () => {
  it('minor units through the one formatter, with the currency\'s own exponent', () => {
    expect(planPrice('499900', 'INR', 2, 'en')).toBe('₹4,999.00');
    expect(planPrice('1500', 'JPY', 0, 'en')).toMatch(/^[^0-9]*1,500$/);    // 0 decimals: 1,500 yen, not 15.00
    expect(planPrice('1500', 'BHD', 3, 'en')).toMatch(/1\.500/);
  });
  it('REFUSES to print when the exponent disagrees with the currency, or the minor units are malformed', () => {
    expect(planPrice('499900', 'INR', 0, 'en')).toBeNull();
    expect(planPrice('4999.00', 'INR', 2, 'en')).toBeNull();
    expect(planPrice('-1', 'INR', 2, 'en')).toBeNull();
    expect(planPrice('100', 'JPY', 2, 'en')).toBeNull();                    // the DB says 2, the currency has 0
    expect(planPrice('100', 'INRX', 2, 'en')).toBeNull();                   // not a currency code at all
  });
  it('a setup fee line only above zero', () => {
    expect(showsSetupFee({ setupFeeMinor: '0' })).toBe(false);
    expect(showsSetupFee({ setupFeeMinor: '2500000' })).toBe(true);
    expect(showsSetupFee({ setupFeeMinor: 'x' })).toBe(false);
  });
  it('the country: ?country= two letters, else the platform\'s; never a guess', () => {
    expect(pricingCountry('bd', 'IN')).toBe('BD'); expect(pricingCountry(['np'], 'IN')).toBe('NP');
    expect(pricingCountry('India', 'IN')).toBe('IN'); expect(pricingCountry(undefined, null)).toBeNull();
    expect(countryName('IN', 'en-IN')).toBe('India');
  });
});

describe('STORE-1c · the record (brief §E, C3)', () => {
  it('every W307 refusal printed by name has its sentence in all three catalogues', () => {
    const keys = signupRefusalKeys();
    expect(keys.length).toBe(11);
    for (const cat of [en, hi, gu] as Record<string, string>[]) for (const k of [...keys, 'signup.refused.title']) expect([k, typeof cat[k]]).toEqual([k, 'string']);
    expect(STORE1C_REFUSALS.map((r) => r.id)).toEqual(expect.arrayContaining(['partnerships_desk', 'resolution_desk', 'member_count_field', 'oncall_paging_signup', 'confirm_over_replay']));
  });
  it('the 14 chain pages are recorded by filename, the mutate six as PARITY-DECOR with the flowmap citation', () => {
    expect(STORE1C_CHAIN_PAGES.length).toBe(14);
    expect(new Set(STORE1C_CHAIN_PAGES.map((c) => c.file)).size).toBe(14);
    for (const c of STORE1C_CHAIN_PAGES.filter((x) => /mutate/.test(x.file))) expect(c.verdict).toMatch(/^PARITY-DECOR/);
    expect(STORE1C_CHAIN_PAGES.find((c) => c.file.startsWith('W2470'))!.verdict).toContain('FLOWMAP_tenant:1011 decor-offline-retry');
  });
  it('/for-organisations is a storefront route (never a tenant slug)', () => {
    expect(STATIC_TOP_SEGMENTS).toContain('for-organisations');
  });
});
