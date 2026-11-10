// apps/web-gov/src/test-render/gov-login.render.test.tsx · PC-56 GOV-1a — W355 (`/login`), every step: phone, code, the chooser, the
// authenticator code, the set-up step (the key and its otpauth address as the API gives them, the code to confirm, the recovery codes once),
// switched off; Q5-A printed in its TRUE half only, in en / hi / gu; no other way to sign in is offered or named (no single sign-on, no
// departmental identifier, no hardware key, no device claim); the phone never in a field or a link; the refusals listed BY NAME.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginView, type LoginActions, type LoginViewProps } from '../components/gov1/LoginViews';
import { LOGIN_ERRORS } from '../features/gov1/login';
import { gov1RefusalKeys } from '../features/gov1/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { FALSE_1A, text, tr, visible } from './gov1a-fixtures';

const act = async () => undefined;
const ACTIONS: LoginActions = { requestOtp: act, verifyOtp: act, choose: act, twoFactor: act, enrol: act, confirmEnrol: act, startOver: act };
const render = (p: Partial<LoginViewProps>, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<LoginView t={tr(cat)} step="phone" actions={ACTIONS} {...p} />);
const STEPS: Array<Partial<LoginViewProps>> = [
  { step: 'phone' }, { step: 'verify', phoneMasked: '••••••318' },
  { step: 'choose', choices: [{ id: 'a1', name: 'Test Authority One' }, { id: 'a2', name: 'Test Authority Two' }] },
  { step: '2fa' }, { step: 'enrol' }, { step: 'enrol-confirm', enrolKey: { secret: 'JBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://totp/Krishalaya:test?secret=JBSWY3DPEHPK3PXP' } },
  { step: 'enrol-confirm', enrolKey: null }, { step: 'enrolled', recoveryCodes: ['abcd-efgh-01', 'abcd-efgh-02'] }, { step: 'enrolled', recoveryCodes: null }, { step: 'off' },
];
const Q5_TRUE = 'Sign in with the code sent to your phone, then the code from your authenticator app.';
const Q5_SECOND = 'Every sign-in, successful or not, is recorded with the time and the network address it came from.';

describe('PC-56 GOV-1a · W355 /login — every step', () => {
  it('phone: one tel field, one submit; Q5-A\'s true half verbatim; its second sentence NOT printed (a refused sign-in is not recorded)', () => {
    const h = render({ step: 'phone' });
    expect(h).toContain('data-kv-login="phone"'); expect(h).toContain('name="phone"'); expect(h).toContain('type="tel"');
    expect(text(h)).toContain(Q5_TRUE); expect(h).toContain('data-kv-statement="gov1.login.q5"');
    expect(text(h)).not.toContain(Q5_SECOND); expect(text(h)).not.toMatch(/successful or not/i);
    expect(text(h)).toContain('For people who hold a role in a government authority on this platform.');
    expect((h.match(/<button/g) ?? []).length).toBe(1); expect(h).toMatch(/<button class="kv-btn" type="submit">Send OTP<\/button>/);
  });
  it('code: the phone shown MASKED only — never in a field, never in a link; 4–8 digits as the API takes', () => {
    const h = render({ step: 'verify', phoneMasked: '••••••318' });
    expect(text(h)).toContain('If ••••••318 can receive messages, a code has been sent to it.');
    expect(h).not.toContain('name="phone"'); expect(h).toContain('name="code"'); expect(h).toContain('pattern="\\d{4,8}"');
    expect(h).toContain('data-kv-form="verify"'); expect(text(h)).toContain('Start again');
  });
  it('the chooser: the authorities the API named, radio by id; no token in a field', () => {
    const h = render(STEPS[2]);
    expect(h).toMatch(/name="authorityId"[^>]*value="a1"/); expect(h).toMatch(/name="authorityId"[^>]*value="a2"/);
    expect(text(h)).toContain('This phone holds a role in more than one authority. Choose the one to sign in to.');
    expect(h).not.toMatch(/name="(choiceToken|token)"/);
  });
  it('the authenticator step: one field (a 6-digit code or a recovery code); no challenge in a field', () => {
    const h = render({ step: '2fa' });
    expect(h).toContain('data-kv-form="2fa"'); expect(text(h)).toContain('The 6-digit code from your authenticator app, or one of your recovery codes');
    expect(h).not.toMatch(/name="challengeToken"/);
  });
  it('the set-up step (Q5-A): no session until set up; the key and its otpauth address as given; no picture code claimed; a 6-digit confirm', () => {
    expect(text(render({ step: 'enrol' }))).toContain('This account has no confirmed authenticator app. No session is opened until one is set up.');
    const h = render(STEPS[5]);
    expect(h).toContain('<code data-kv-secret="">JBSWY3DPEHPK3PXP</code>');
    expect(h).toContain('href="otpauth://totp/Krishalaya:test?secret=JBSWY3DPEHPK3PXP"');
    expect(text(h)).toContain('No picture code is shown.'); expect(h).not.toMatch(/<img|<svg|<canvas/);
    expect(h).toContain('pattern="\\d{6}"'); expect(h).not.toMatch(/name="enrolToken"/);
    expect(render(STEPS[6])).toContain('data-kv-enrol-key="missing"');
  });
  it('enrolled: the recovery codes once, then "Sign in again"; gone → said so', () => {
    const h = render(STEPS[7]);
    expect(h).toContain('data-kv-recovery="2"'); expect(text(h)).toContain('abcd-efgh-01'); expect(text(h)).toContain('they are shown only now');
    expect(text(h)).toContain('Sign in again');
    expect(render(STEPS[8])).toContain('data-kv-recovery="gone"');
  });
  it('switched off: the switch\'s own sentence, no form', () => {
    const h = render({ step: 'off' });
    expect(text(h)).toContain('The government console is switched off on this platform.'); expect(h).not.toContain('<form');
  });
  it('the refusals BY NAME on the page: no other way in, no staff identifier, no payment key, the sign-in record as it is, no authority shown before sign-in, no helpdesk', () => {
    const h = render({ step: 'phone' });
    for (const k of gov1RefusalKeys('login')) expect([k, text(h).includes(en[k])]).toEqual([k, true]);
    expect(text(h)).toContain('The network address recorded is this console\'s own server, not yours.');
    expect(text(h)).toContain('A sign-in refused because the phone holds no role here is not recorded.');
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: no step offers or names another way in (single sign-on, a departmental id, a hardware key, a device record) — anywhere on the page', (_l, cat) => {
    for (const p of STEPS) {
      const h = render(p, cat);
      expect(FALSE_1A.test(text(h))).toBe(false);
      expect(h).not.toMatch(/<button[^>]*>[^<]*(SSO|sign-on|Pramaan|department)/i);
      expect(/gov1\.|login\./.test(text(h))).toBe(false);
    }
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: Q5-A\'s true half is the catalogue\'s own sentence on the phone step', (_l, cat) => {
    expect(text(render({ step: 'phone' }, cat))).toContain(cat['gov1.login.q5']);
  });
  it('gu: Q5-A says phone code THEN authenticator, in Gujarati', () => {
    const h = text(render({ step: 'phone' }, gu));
    expect(h).toContain('તમારા ફોન પર મોકલેલા કોડથી સાઇન ઇન કરો, પછી તમારી ઓથેન્ટિકેટર ઍપના કોડથી.');
  });
});

describe('PC-56 GOV-1a · W355 — every named refusal, x3', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: each code prints its own sentence (with the tries left / the wait), role=alert', (_l, cat) => {
    for (const [code, e] of Object.entries(LOGIN_ERRORS)) {
      const h = render({ act: e.state, error: code, left: 2, wait: 7, step: e.state === 'form-error' ? 'verify' : 'phone' }, cat);
      expect([code, h.includes(`data-kv-error="${code}"`)]).toEqual([code, true]);
      expect([code, text(h).includes(tr(cat).t(e.key, { left: 2, minutes: 7 }))]).toEqual([code, true]);
      expect(h).toContain('role="alert"');
      expect(visible(h)).not.toMatch(FALSE_1A);
    }
  });
  it('the tries left and the wait are the server\'s numbers', () => {
    expect(text(render({ act: 'form-error', error: 'OTP_WRONG', left: 2, step: 'verify' }))).toContain('That code is wrong. Tries left on this code: 2.');
    expect(text(render({ act: 'failure', error: 'OTP_LOCKED', wait: 15 }))).toContain('You can ask for a new code in 15 minutes.');
    expect(text(render({ act: 'failure', error: 'GOV_ACCESS_NONE' }))).toContain('This phone holds no active role in a government authority on this platform.');
    expect(text(render({ act: 'failure', error: 'SOMETHING_ELSE' }))).toContain('Signing in did not work. Try again.');
  });
});
