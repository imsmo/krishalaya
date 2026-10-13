// apps/web-storefront/src/test-render/login.render.test.tsx · PC-56 STORE-1a — the REAL sign-in screen (components/LoginScreen.tsx),
// rendered state by state (the harness: jest.render.config.js). Proves, in the markup a person receives:
//   W321  the phone field KEEPS what was typed (defaultValue) on a refusal, marked aria-invalid and tied to the error; the digit rule
//         names +91 from the country rule; the rate-limit states print the server's numbers; Idempotency-Key minted at render;
//         voice / USSD / helpline are refused by name, never offered;
//   W322  the phone is MASKED (canon "+91 98••• ••742"), never printed in full; "valid N min" from the server TTL; resend disabled with
//         the server's seconds; wrong code with tries left, the digits kept; anti-phishing; "Listen instead" refused;
//   2FA   the second-factor step; done: the buyer state, the other-session notice (device family + last active, no city), Continue;
//   no rendered href or hidden value carries a phone number.
// The request-scoped modules are jest fakes (the seam web-tenant's rtl-sweep test documents); `useFormStatus` (Next's React canary) is
// supplied for react-dom 18.3.1's server renderer.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mockState: {
  lang: string; tenant: unknown; pending: unknown; twoFa: unknown; sessions: unknown[]; signedIn: boolean;
} = { lang: 'en', tenant: null, pending: null, twoFa: null, sessions: [], signedIn: false };

jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return {
    getLang: () => mockState.lang,
    getTranslator: () => new T(mockState.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')),
  };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => (mockState.signedIn ? 'tok' : null) }));
jest.mock('../lib/api-client', () => ({ serverClient: () => ({ auth: { sessions: async () => mockState.sessions } }) }));
jest.mock('../lib/login-flow', () => ({ readPendingLogin: () => mockState.pending, readPendingTwoFactor: () => mockState.twoFa }));
jest.mock('../lib/tenant-context', () => ({ resolveStorefrontTenant: async () => mockState.tenant }));
jest.mock('../app/login/actions', () => ({
  requestCodeAction: async () => undefined, verifyCodeAction: async () => undefined, verifyTwoFactorAction: async () => undefined,
  resendCodeAction: async () => undefined, resetLoginAction: async () => undefined, logoutAction: async () => undefined,
}));

import { LoginScreen } from '../components/LoginScreen';

const TENANT = { ok: true, slug: 'anand-fpo', tenant: { tenantId: '0190a8b2-0000-7000-8000-000000000001', slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' } };
const PHONE = '+919812345742';
const now = () => Math.floor(Date.now() / 1000);

async function render(searchParams: Record<string, string>, routeSlug: string | null = 'anand-fpo'): Promise<string> {
  return renderToStaticMarkup(await LoginScreen({ routeSlug, searchParams }));
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
function noPhoneAnywhere(html: string) {
  expect(html).not.toContain('9812345742');
  for (const m of html.matchAll(/(?:href|value)="([^"]*)"/g)) expect([m[1], /\d{7,}/.test(m[1])]).toEqual([m[1], false]);
}

beforeEach(() => {
  mockState.lang = 'en'; mockState.tenant = TENANT; mockState.pending = null; mockState.twoFa = null; mockState.sessions = []; mockState.signedIn = false;
});

describe('STORE-1a · W321 phone step', () => {
  it('keeps what was typed on a refusal, marks it invalid, ties the error to it, and names the digit rule', async () => {
    mockState.pending = { typed: '98123 4574' };
    const html = await render({ step: 'phone', err: 'phone_digits', need: '10', have: '9', dial: '91' });
    expect(html).toMatch(/<input[^>]*id="kv-phone"[^>]*value="98123 4574"/);
    expect(html).toMatch(/<input[^>]*id="kv-phone"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<input[^>]*id="kv-phone"[^>]*aria-describedby="kv-phone-hint kv-login-error"/);
    expect(html).toContain('id="kv-login-error"');
    expect(text(html)).toContain('This needs 10 digits after +91 — this one has 9.');
    expect(html).toContain('placeholder="10-digit mobile number"');
  });

  it('mints an Idempotency-Key at render and carries the tenant + next as hidden fields', async () => {
    const html = await render({ next: '/anand-fpo/listings/7' });
    expect(html).toMatch(/name="idem" value="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/);
    expect(html).toContain('name="t" value="anand-fpo"');
    expect(html).toContain('name="next" value="/anand-fpo/listings/7"');
    expect(text(html)).toContain('Send my code');
  });

  it('rate limits print the SERVER\'s numbers (the real rule, not the canon\'s "5 in 10 minutes … 30 minutes")', async () => {
    expect(text(await render({ err: 'rate_hourly', n: '1790', max: '5' }))).toContain('5 codes were asked for on this number in the last hour. To protect it, the next code can be sent in 30 min.');
    expect(text(await render({ err: 'rate_cooldown', n: '24' }))).toContain('You can ask for another in 24 s.');
    expect(text(await render({ err: 'unavailable' }))).toContain('We could not reach the sign-in service. Nothing was sent or changed');
  });

  it('voice, USSD, missed call and the helpline are refused by name — no button, no number', async () => {
    const html = await render({});
    const tx = text(html);
    expect(tx).toContain('Codes come by SMS only. A call that reads the code aloud is not available yet.');
    expect(tx).toContain('There is no phone-line, missed-call or USSD sign-in yet');
    expect(html).not.toMatch(/1800|\*123#|Call me/);
    expect(html.match(/<button/g)?.length).toBe(1);   // "Send my code" only
    expect(tx).toContain('ready to buy from Anand FPO');
  });

  it('carries the offline guard (no USSD text in it)', async () => {
    const html = await render({});
    expect(html).not.toContain('data-kv-signal="degraded"');   // live by default; the banner appears only without signal
  });

  it('an unknown store and an unconfigured platform are named states, never a guessed tenant', async () => {
    mockState.tenant = { ok: false, kind: 'not_found', slug: 'nope' };
    expect(text(await render({}))).toContain('There is no open store at this address');
    mockState.tenant = { ok: false, kind: 'not_configured', slug: null };
    expect(text(await render({}, null))).toContain('Sign-in is not set up for this storefront yet.');
  });

  it('already signed in → straight on to next', async () => {
    mockState.signedIn = true;
    await expect(render({ next: '/cart' })).rejects.toThrow('REDIRECT /cart');
  });
});

describe('STORE-1a · W322 code step', () => {
  beforeEach(() => { mockState.pending = { typed: '9812345742', phone: PHONE, sentAt: now(), ttlSec: 300, resendAt: now() + 24 }; });

  it('masks the phone (canon "+91 98••• ••742"), prints the server TTL, and never prints the number', async () => {
    const html = await render({ step: 'code' });
    expect(text(html)).toContain('Sent by SMS to +91 98••• ••742');
    expect(text(html)).toContain('valid for 5 min');
    noPhoneAnywhere(html);
  });

  it('resend is disabled with the server\'s seconds left', async () => {
    const html = await render({ step: 'code' });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send a new code in 2[0-4] s<\/button>/);
  });

  it('a wrong code: tries left, the digits STAY, marked invalid', async () => {
    mockState.pending = { ...(mockState.pending as object), code: '123450' };
    const html = await render({ step: 'code', err: 'code_wrong', left: '2' });
    expect(text(html)).toContain('That code doesn’t match — 2 tries left on this code.');
    expect(html).toMatch(/<input[^>]*id="kv-code"[^>]*value="123450"/);
    expect(html).toMatch(/<input[^>]*id="kv-code"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/autoComplete="one-time-code"|autocomplete="one-time-code"/);
  });

  it('expired / locked / suspended are each named', async () => {
    expect(text(await render({ step: 'code', err: 'code_expired' }))).toContain('nothing wrong on your side');
    expect(text(await render({ step: 'code', err: 'code_locked', n: '300' }))).toContain('try again in 5 min, with a new code');
    expect(text(await render({ step: 'code', err: 'suspended' }))).toContain('Your membership of Anand FPO is paused');
  });

  it('anti-phishing, and "Listen instead" refused by name', async () => {
    const tx = text(await render({ step: 'code' }));
    expect(tx).toContain('Nobody will ever call and ask for this code.');
    expect(tx).toContain('Not us, not Anand FPO, not “bank staff”.');
    expect(tx).toContain('Hearing the code read aloud instead of reading it is not available yet.');
  });

  it('a code step whose server-held half is gone falls back to the phone step, said in words', async () => {
    mockState.pending = null;
    const tx = text(await render({ step: 'code' }));
    expect(tx).toContain('That sign-in step expired. Enter your number again.');
    expect(tx).toContain('Send my code');
  });
});

describe('STORE-1a · 2FA and signed in', () => {
  it('the second-factor step: authenticator code or one recovery code', async () => {
    mockState.twoFa = { challengeToken: 'c'.repeat(40), until: now() + 300 };
    const html = await render({ step: '2fa' });
    expect(text(html)).toContain('One more step');
    expect(html).toContain('name="totp"');
    expect(html).toContain('name="recovery"');
    expect(html).not.toContain('c'.repeat(40));   // the challenge never reaches the HTML
  });

  it('signed in: buyer ready, the other session by device family + last active (no city), Continue to next', async () => {
    const two = new Date(Date.now() - 2 * 3600 * 1000 - 60_000).toISOString();
    mockState.sessions = [
      { id: 's1', deviceFamily: null, current: true, lastSeenAt: new Date().toISOString(), createdAt: two, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null },
      { id: 's2', deviceFamily: 'android', current: false, lastSeenAt: two, createdAt: two, expiresAt: '2099-01-01T00:00:00Z', revokedAt: null },
    ];
    const html = await render({ step: 'done', buy: 'granted', next: '/anand-fpo/listings/7' });
    const tx = text(html);
    expect(tx).toContain('Your buyer account at Anand FPO is ready');
    expect(tx).toContain('You are also signed in on an Android phone, last active 2 h ago.');
    expect(tx).toContain('We never show where a device is');
    expect(html).toMatch(/<a role="link" aria-disabled="true"/);
    expect(html).toContain('href="/anand-fpo/listings/7"');
  });

  it('the flag-OFF buyer state is named, not a fake success', async () => {
    expect(text(await render({ step: 'done', buy: 'off' }))).toContain('Buying is not switched on for new accounts at Anand FPO yet');
  });
});
