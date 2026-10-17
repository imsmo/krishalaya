// apps/web-storefront/src/test-render/online-guard-both-chromes.render.test.tsx · PC-56 STORE-6a · D1 (founder Q1) — THE MONEY STOP IS IN BOTH CHROMES.
// The drift-pinned port (components/OnlineGuard.tsx) renders nothing while the signal is live (its SSR state), so the chrome's mount is proven
// with the port and the storefront-local layer stood in by markers that echo their props:
//   • the platform layout mounts the guard ONCE, "Why?" → `/offline`; the organisation's layout ONCE, "Why?" → `/<slug>/offline`;
//   • beside it, `SignalReasons` with every reason in words (17) and the port's "— needs signal"; and the polite `UpdateNotice`;
//   • the organisation's OFFLINE page (its session-free shell mode) mounts none of them — the (shell) rule;
//   • the sign-in screen no longer mounts a second guard of its own (it was the only mount before);
// and the port's own banner, rendered degraded with the storefront's words, says so and links THIS chrome's policy page.
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
// the port and the storefront-local pieces, stood in by markers (the port's own SignalBanner is kept — rendered below)
jest.mock('../components/OnlineGuard', () => {
  const actual = jest.requireActual('../components/OnlineGuard');
  return { ...actual, OnlineGuard: ({ labels }: { labels: { policyHref: string; needsSignal: string; banner: string } }) => <i data-kv-guard={labels.policyHref} data-kv-guard-word={labels.needsSignal} data-kv-guard-banner={labels.banner} /> };
});
jest.mock('../components/offline/SignalReasons', () => ({ SignalReasons: ({ words, needsSignal }: { words: Record<string, string>; needsSignal: string }) => <i data-kv-reasons={Object.keys(words).length} data-kv-reasons-word={needsSignal} data-kv-reason-pay={words.paymentAttempt} /> }));
jest.mock('../components/offline/UpdateNotice', () => ({ UpdateNotice: ({ labels }: { labels: { ready: string } }) => <i data-kv-update-mounted={labels.ready} /> }));

import PlatformLayout from '../app/(platform)/layout';
import TenantLayout from '../app/[tenantSlug]/layout';
import { SignalBanner } from '../components/OnlineGuard';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { REASON_KEYS } from '../features/store6/acts';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';
import { C, SLUG, reset } from './store6a-fixtures';

beforeEach(() => reset());
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;

describe('STORE-6a · D1 · OnlineGuard mounted ONCE in BOTH chromes, with the reasons and the polite update', () => {
  it('the platform chrome: one guard ("Why?" → /offline), the reasons in words, the update notice', async () => {
    const h = await renderResolved(PlatformLayout({ children: <p>page</p> }), [SiteHeader]);
    expect(count(h, /data-kv-guard="/g)).toBe(1);
    expect(h).toContain('data-kv-guard="/offline"');
    expect(h).toContain(`data-kv-guard-word="${en['store6.signal.needsSignal']}"`);
    expect(h).toContain(`data-kv-reasons="${REASON_KEYS.length}"`); expect(REASON_KEYS.length).toBe(17);
    expect(h).toContain(`data-kv-reason-pay="${en['store6.reason.paymentAttempt']}"`);
    expect(count(h, /data-kv-update-mounted=/g)).toBe(1);
  });
  it('the organisation\'s chrome: one guard ("Why?" → /<slug>/offline), the reasons, the update notice', async () => {
    const h = await renderResolved(await TenantLayout({ children: <p>page</p>, params: { tenantSlug: SLUG } }), [TenantHeader]);
    expect(count(h, /data-kv-guard="/g)).toBe(1);
    expect(h).toContain(`data-kv-guard="/${SLUG}/offline"`);
    expect(h).toContain(`data-kv-reasons="${REASON_KEYS.length}"`);
    expect(count(h, /data-kv-update-mounted=/g)).toBe(1);
  });
  it('the organisation\'s OFFLINE page (shell mode) mounts none of them — the session-free shell rule', async () => {
    C.headers = { 'x-kv-shell': 'offline' };
    const h = await renderResolved(await TenantLayout({ children: <p>page</p>, params: { tenantSlug: SLUG } }), [TenantHeader]);
    expect(h).not.toMatch(/data-kv-guard=|data-kv-reasons=|data-kv-update-mounted=/);
  });
  it('the sign-in screen no longer mounts its own guard (the chrome\'s one serves it; its code forms carry their reason)', () => {
    const src = readFileSync(join(__dirname, '..', 'components', 'LoginScreen.tsx'), 'utf8');
    expect(src).not.toMatch(/<OnlineGuard|from '\.\/OnlineGuard'/);
    expect((src.match(/<form action=\{\w+\} data-kv-act-class="countdown" data-kv-needs-signal-reason="signInCode"/g) ?? []).length).toBe(4);
  });
  it('the port\'s banner, degraded, with the storefront\'s words: it says so and "Why?" opens THIS chrome\'s policy page', () => {
    const labels = { banner: en['store6.signal.banner'], detail: en['store6.signal.detail'], needsSignal: en['store6.signal.needsSignal'], policy: en['store6.signal.policy'], policyHref: `/${SLUG}/offline` };
    const h = renderToStaticMarkup(<SignalBanner mode="degraded" labels={labels} />);
    expect(h).toContain('data-kv-signal="degraded"');
    expect(text(h)).toContain(en['store6.signal.banner']); expect(text(h)).toContain(en['store6.signal.needsSignal']);
    expect(h).toContain(`<a href="/${SLUG}/offline" class="kv-btn--link">${en['store6.signal.policy']}</a>`);
    expect(renderToStaticMarkup(<SignalBanner mode="live" labels={labels} />)).toBe('');
  });
});
