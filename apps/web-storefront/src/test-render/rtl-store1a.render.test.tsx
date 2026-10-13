// apps/web-storefront/src/test-render/rtl-store1a.render.test.tsx · PC-56 STORE-1a · C11 — the sign-in states under dir="rtl".
// The phone, code, 2FA and signed-in states (plus the offline banner and the ported DirArrow) are mounted inside <div dir="rtl">, and
// the markup must carry (a) no PHYSICAL-direction class (ml-/mr-/pl-/pr-/left-/right-/text-left|right/rounded-l|r/border-l|r/float-*),
// (b) no physical inline style, (c) no bare "→"/"←" outside the flipping `.kv-dir-flip` span — the same guards as web-tenant's
// rtl-sweep test (copied, and proven to bite below). Same jest seam as login.render.test.tsx.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Translator } from '@krishalaya/i18n';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const mockState: { tenant: unknown; pending: unknown; twoFa: unknown; sessions: unknown[] } = { tenant: null, pending: null, twoFa: null, sessions: [] };
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => 'en', getTranslator: () => new T('en').register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => null }));
jest.mock('../lib/api-client', () => ({ serverClient: () => ({ auth: { sessions: async () => mockState.sessions } }) }));
jest.mock('../lib/login-flow', () => ({ readPendingLogin: () => mockState.pending, readPendingTwoFactor: () => mockState.twoFa }));
jest.mock('../lib/tenant-context', () => ({ resolveStorefrontTenant: async () => mockState.tenant }));
jest.mock('../app/(platform)/login/actions', () => ({
  requestCodeAction: async () => undefined, verifyCodeAction: async () => undefined, verifyTwoFactorAction: async () => undefined,
  resendCodeAction: async () => undefined, resetLoginAction: async () => undefined, logoutAction: async () => undefined,
}));

import { LoginScreen } from '../components/LoginScreen';
import { SignalBanner } from '../components/OnlineGuard';
import { DirArrow } from '../components/DirArrow';

const t = new Translator('en').register('en', en).register('hi', hi).register('gu', gu);
const rtl = (el: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{el}</div>);
const PHYSICAL_CLASS = /^-?(?:m[lr]|p[lr]|left|right)-|^(?:text-(?:left|right)|float-(?:left|right))$|^(?:rounded-[lr]|border-[lr])(?:-|$)/;
const PHYSICAL_STYLE = /(?:margin|padding|border)-(?:left|right)|(?:^|;)\s*(?:left|right)\s*:|text-align\s*:\s*(?:left|right)|float\s*:\s*(?:left|right)/;
function physical(html: string): string[] {
  const hits: string[] = [];
  for (const m of html.matchAll(/\sclass="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c && PHYSICAL_CLASS.test(c)) hits.push(c);
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) if (PHYSICAL_STYLE.test(m[1])) hits.push(`style="${m[1]}"`);
  return hits;
}
const bareArrows = (html: string) => (html.replace(/<span class="kv-dir-flip">→<\/span>/g, '').match(/[→←]/g) ?? []).length;
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  mockState.tenant = { ok: true, slug: 'anand-fpo', tenant: { tenantId: '0190a8b2-0000-7000-8000-000000000001', slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' } };
  mockState.pending = { typed: '9812345742', phone: '+919812345742', sentAt: now(), ttlSec: 300, resendAt: now() + 20 };
  mockState.twoFa = { challengeToken: 'c'.repeat(40), until: now() + 300 };
  mockState.sessions = [{ id: 's2', deviceFamily: 'ios', current: false, lastSeenAt: new Date(Date.now() - 600_000).toISOString(), createdAt: new Date().toISOString(), expiresAt: '2099-01-01T00:00:00Z', revokedAt: null }];
});

describe('the guards bite (so a pass below means something)', () => {
  it('flags physical classes / styles / bare arrows; passes logical ones', () => {
    expect(physical('<p class="ml-2 pr-4 text-right rounded-l-md border-r float-left left-0"></p>')).toHaveLength(7);
    expect(physical('<p style="margin-left:4px"></p><p style="text-align:right"></p>')).toHaveLength(2);
    expect(physical('<p class="kv-auth kv-btn--link kv-auth__note"></p>')).toEqual([]);
    expect(bareArrows('a → b')).toBe(1);
    expect(bareArrows(renderToStaticMarkup(<p>a <DirArrow /> b</p>))).toBe(0);
  });
});

describe('STORE-1a sign-in states under dir="rtl"', () => {
  const cases: Array<[string, Record<string, string>, string]> = [
    ['phone (W321) with a refusal', { step: 'phone', err: 'phone_digits', need: '10', have: '9', dial: '91' }, t.t('auth.phone.heading')],
    ['code (W322) with a wrong code', { step: 'code', err: 'code_wrong', left: '2' }, t.t('auth.code.heading')],
    ['2FA sub-step', { step: '2fa' }, t.t('auth.2fa.heading')],
    ['signed in (W3132) with the other-session notice', { step: 'done', buy: 'granted' }, t.t('auth.done.heading')],
  ];
  it.each(cases)('%s', async (_n, sp, heading) => {
    const html = rtl(await LoginScreen({ routeSlug: 'anand-fpo', searchParams: sp }));
    expect(html.startsWith('<div dir="rtl">')).toBe(true);
    expect(html).toContain(heading);
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('the offline banner (degraded) under rtl: "— needs signal", no USSD', () => {
    const html = rtl(<SignalBanner mode="degraded" labels={{ banner: t.t('auth.offline.banner'), detail: t.t('auth.offline.detail'), needsSignal: t.t('auth.offline.needsSignal'), policy: t.t('auth.offline.policy'), policyHref: '/offline' }} />);
    expect(html).toContain('— needs signal');
    expect(html).not.toMatch(/USSD|\*123#/);
    expect(physical(html)).toEqual([]);
  });
});
