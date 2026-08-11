// apps/web-tenant/src/test/tenant1d3b-signup.spec.ts · W113's four steps (PC-56 TENANT-1d-3b).
//
// The theme: **a signup screen must never cost somebody their progress, and never claim something it did not do.** Every
// case below is either a step that must survive a dropped connection or a sentence that must not be said.
import * as fs from 'fs';
import * as path from 'path';
import {
  AFTER_SIGNUP_PATH, SIGNUP_STEPS, TOTAL_STEPS, buildSignup, isStep, looksLikeCode, looksLikePhone,
  maskForDisplay, outcomeMessage, resendState, resolveStep, stepNumber,
} from '../features/signup/steps';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const T = {
  t(key: string, vars?: Record<string, string | number>): string {
    const raw = (en as Record<string, string>)[key];
    if (raw === undefined) throw new Error(`missing i18n key: ${key}`);
    return raw.replace(/\{(\w+)\}/g, (_m, k) => String(vars?.[k] ?? ''));
  },
};
const UUID = '11111111-1111-4111-8111-111111111111';

/**
 * **EVERY SOURCE GUARD SCANS CODE, NEVER COMMENTS.**
 *
 * Two assertions in the first version of this file failed against the page's own header — which explains why it does not
 * call `requireSession` and why it prints no "2,847 organisations" — because the words were in the file. That is the
 * "matching prose instead of code" shape for the fifth time in this programme; the previous four cost a fix, a batch of
 * mutation verdicts, an import-line guard and a dead-branch guard. Stripped here from the start.
 */
function code(rel: string[]): string {
  const src = fs.readFileSync(path.join(__dirname, '..', ...rel), 'utf8');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

describe('TENANT-1d-3b · the step lives in the URL', () => {
  it('W113ʼs four steps, and "Step 1 of 4" counts from one', () => {
    expect(SIGNUP_STEPS).toEqual(['you', 'verify', 'org', 'done']);
    expect(TOTAL_STEPS).toBe(4);
    expect(stepNumber('you')).toBe(1);
    expect(stepNumber('done')).toBe(4);
  });

  it('an unknown step is step ONE, never step four', () => {
    // A hand-typed or truncated URL must not land somebody on a success page.
    expect(stepNumber('nonsense')).toBe(1);
    expect(stepNumber(undefined)).toBe(1);
    expect(isStep('nonsense')).toBe(false);
  });

  it('a step cannot be reached past its prerequisite', () => {
    // `?step=org` with no verified phone would render a form whose submit is guaranteed to fail, which teaches a farmer
    // that the platform is broken.
    expect(resolveStep({ step: 'org' })).toBe('you');
    expect(resolveStep({ step: 'org', phone: '+919876543210' })).toBe('verify');
    expect(resolveStep({ step: 'verify' })).toBe('you');
  });

  it('the prerequisites being met lets the step through', () => {
    expect(resolveStep({ step: 'verify', phone: '+919876543210' })).toBe('verify');
    expect(resolveStep({ step: 'org', phone: '+919876543210', code: '123456' })).toBe('org');
  });

  it('a blank phone is not a phone', () => {
    expect(resolveStep({ step: 'verify', phone: '   ' })).toBe('you');
  });
});

describe('TENANT-1d-3b · the form is never stricter than the API', () => {
  it('accepts a plain Indian mobile in the shapes people type', () => {
    for (const p of ['9876543210', '+91 98765 43210', '098765 43210', '+919876543210']) {
      expect(looksLikePhone(p)).toBe(true);
    }
  });

  it('refuses only what is obviously not a number', () => {
    expect(looksLikePhone('98765')).toBe(false);
    expect(looksLikePhone('')).toBe(false);
  });

  it('the code rule matches the APIʼs own 4–8 digits', () => {
    expect(looksLikeCode('123456')).toBe(true);
    expect(looksLikeCode('1234')).toBe(true);
    expect(looksLikeCode('12')).toBe(false);
    expect(looksLikeCode('12345a')).toBe(false);
  });

  it('AN ORGANISATION NAME IN ANY SCRIPT IS ACCEPTED', () => {
    // The canon's own tenant is "આનંદ ખેડૂત ઉત્પાદક કંપની". A pattern demanding Latin letters would refuse the customers
    // this platform exists for.
    for (const org of ['આનંદ ખેડૂત ઉત્પાદક કંપની', 'आनंद किसान उत्पादक कंपनी', 'Anand FPO']) {
      const built = buildSignup({ phone: '9876543210', code: '123456', fullName: 'Ramesh P.', orgName: org, orgTypeId: UUID, lang: 'gu' });
      expect(built.ok).toBe(true);
    }
  });

  it('no character class exists in the builder OR in the markup', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'signup', 'steps.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function buildSignup'), src.indexOf('export function resendState'));
    // The only regex allowed in there is the uuid check for the org TYPE.
    expect(fn.match(/\/\^\[/g)?.length ?? 0).toBeLessThanOrEqual(1);
    const page = code(['app', 'signup', 'page.tsx']);
    const orgInput = page.split('\n').find((l) => l.includes('name="orgName"')) ?? '';
    expect(orgInput).not.toMatch(/pattern=/);
  });

  it('reports the FIRST thing wrong, so the message matches the field somebody is looking at', () => {
    const bad = { phone: '123', code: 'x', fullName: '', orgName: '', orgTypeId: 'nope', lang: 'en' };
    expect(buildSignup(bad)).toEqual({ ok: false, error: 'phone' });
    expect(buildSignup({ ...bad, phone: '9876543210' })).toEqual({ ok: false, error: 'code' });
    expect(buildSignup({ ...bad, phone: '9876543210', code: '123456' })).toEqual({ ok: false, error: 'name' });
    expect(buildSignup({ ...bad, phone: '9876543210', code: '123456', fullName: 'R P' })).toEqual({ ok: false, error: 'org' });
    expect(buildSignup({ ...bad, phone: '9876543210', code: '123456', fullName: 'R P', orgName: 'Anand FPO' }))
      .toEqual({ ok: false, error: 'orgType' });
  });

  it('CANNOT construct a plan, a price or a status', () => {
    const built = buildSignup({ phone: '9876543210', code: '123456', fullName: 'Ramesh P.', orgName: 'Anand FPO', orgTypeId: UUID, lang: 'en' });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(Object.keys(built.value).sort()).toEqual(['code', 'fullName', 'lang', 'orgName', 'orgTypeId', 'phone']);
    }
  });

  it('an unknown language is omitted rather than sent, so the API picks its own default', () => {
    const built = buildSignup({ phone: '9876543210', code: '123456', fullName: 'Ramesh P.', orgName: 'Anand FPO', orgTypeId: UUID, lang: 'zz' });
    expect(built.ok && 'lang' in built.value).toBe(false);
  });
});

describe('TENANT-1d-3b · the masked confirmation line', () => {
  it('matches the platformʼs five-of-ten policy — W113: "+91 99••• ••482"', () => {
    expect(maskForDisplay('+919912345482')).toBe('+91 99••• ••482');
  });

  it('masks a bare ten-digit number too', () => {
    expect(maskForDisplay('9912345482')).toBe('99••• ••482');
  });

  it('never renders a partial number for junk input', () => {
    expect(maskForDisplay('123')).toBe('••••');
    expect(maskForDisplay('')).toBe('••••');
  });
});

describe('TENANT-1d-3b · what the page refuses to claim', () => {
  it('the voice fallback is NEVER claimable, because no voice provider exists', () => {
    // W113 says "We will also try a voice call automatically at 60s". Nothing in this platform can place a call.
    expect(resendState(0).voiceClaimable).toBe(false);
    expect(resendState(120).voiceClaimable).toBe(false);
  });

  it('resend is offered after the cooldown and the wait never goes negative', () => {
    expect(resendState(0)).toMatchObject({ canResend: false, waitSec: 30 });
    expect(resendState(29.2)).toMatchObject({ canResend: false, waitSec: 1 });
    expect(resendState(45)).toMatchObject({ canResend: true, waitSec: 0 });
  });

  it('A RESUME IS NOT A SUCCESS MESSAGE', () => {
    // W113: "This mobile runs Junagadh Kisan Producer Co. — sign in instead." Telling somebody their organisation is ready
    // when nothing was created sends them looking for an FPO they never made.
    const resumed = outcomeMessage({ resumed: true, displayName: 'Junagadh Kisan Producer Co.', trialEndsOn: null }, T);
    const created = outcomeMessage({ resumed: false, displayName: 'Anand FPO', trialEndsOn: '2026-08-25' }, T);
    expect(resumed).toContain('already runs');
    expect(resumed).not.toBe(created);
    expect(created).toContain('is ready');
  });

  it('the page invents no social proof', () => {
    // W113's "2,847 organisations" is a number this page cannot verify, and a signup screen asking for trust is the last
    // place to print an unverifiable count.
    expect(code(['app', 'signup', 'page.tsx'])).not.toMatch(/2,847|2847/);
    for (const k of ['signup.proof.languages', 'signup.proof.oneplace', 'signup.proof.dataOwnership']) {
      expect((en as Record<string, string>)[k]).not.toMatch(/\d{3,}/);
    }
  });

  it('no hard-coded list of organisation types exists anywhere on the page', () => {
    // W113: "Types come from the platform registry — more are added without app updates." A fallback list here would be
    // the data-not-code rule broken on the very screen that promises it, and would offer types the API refuses.
    const page = code(['app', 'signup', 'page.tsx']);
    for (const t of ['Dairy union', 'SHG federation', 'Agri startup', "'fpo'", "'cooperative'"]) {
      expect(page).not.toContain(t);
    }
    expect(page).toContain("lookups.values('tenant_type')");
  });
});

describe('TENANT-1d-3b · the page is public, and the OTP is spent once', () => {
  const page = () => code(['app', 'signup', 'page.tsx']);

  it('does NOT call requireSession — it is for somebody who has no session', () => {
    expect(page()).not.toContain('requireSession');
    expect(page()).toContain('anonClient()');
  });

  it('the code is not verified on the intermediate step', () => {
    // An OTP is single-use: verifying it on the way to the org step would consume it, and the real submit would then fail
    // on a code the farmer typed correctly.
    const src = page();
    const fn = src.slice(src.indexOf('async function toOrgStep'), src.indexOf('async function createOrg'));
    expect(fn).not.toContain('verifyOtp');
    expect(fn).not.toContain('signUp(');
  });

  it('the OTP request is enumeration-safe, exactly as login is', () => {
    const src = page();
    const fn = src.slice(src.indexOf('async function sendOtp'), src.indexOf('async function toOrgStep'));
    expect(fn).toMatch(/catch \{[^}]*\}/);
  });

  it('the session is set from the returned tokens, as httpOnly cookies', () => {
    const src = page();
    expect(src).toContain('setSession(res.tokens.accessToken');
    // No token may reach the browser's JavaScript.
    expect(src).not.toMatch(/localStorage|document\.cookie/);
  });

  it('a failure brings the form back FILLED IN', () => {
    // W113's own form-error state: "values you entered are preserved, nothing was saved."
    const src = page();
    const fn = src.slice(src.indexOf('async function createOrg'));
    // **THE FIELDS, NOT JUST THE MECHANISM.** A mutation emptied the preserved parameters to `{ step: 'org' }` and this
    // assertion stayed green, because the URLSearchParams call and the redirect were both still there — so it proved the
    // shape of the code and not the promise ("values you entered are preserved"). Every field the farmer typed is named.
    const keep = /const keep = new URLSearchParams\(\{([^}]*)\}\)/.exec(fn)?.[1] ?? '';
    for (const field of ['phone', 'code', 'fullName', 'lang', 'orgName']) expect(keep).toContain(field);
    expect(fn).toMatch(/keep\.toString\(\)\}&error=/);
  });

  it('a new organisation lands on the go-live checklist, not an empty dashboard', () => {
    expect(AFTER_SIGNUP_PATH).toBe('/get-started');
    expect(page()).toContain('AFTER_SIGNUP_PATH');
  });
});

describe('TENANT-1d-3b · the three catalogues stay in step', () => {
  it('every signup.* key exists in Hindi and Gujarati', () => {
    const keys = Object.keys(en as Record<string, string>).filter((k) => k.startsWith('signup.'));
    expect(keys.length).toBeGreaterThan(35);
    // A signup page falling back to English is the first thing a Gujarati-speaking secretary would see of this platform.
    expect(keys.filter((k) => !(k in hi))).toEqual([]);
    expect(keys.filter((k) => !(k in gu))).toEqual([]);
  });

  it('every failure message says whether an organisation was created', () => {
    for (const k of ['signup.error.otp', 'signup.error.plan', 'signup.error.unavailable', 'signup.error.generic', 'signup.typesUnavailable']) {
      expect((en as Record<string, string>)[k].toLowerCase()).toMatch(/nothing was created|nothing has been created|nothing was sent/);
    }
  });
});
