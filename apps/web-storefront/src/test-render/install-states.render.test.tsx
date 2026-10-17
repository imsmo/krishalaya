// apps/web-storefront/src/test-render/install-states.render.test.tsx · PC-56 STORE-6b · D3 / C2 (canon W3137, W3139, W3140 on the `/app` page) —
// THE INSTALL PAGE'S INVITATION SECTION, under both chromes:
//   • the four states: `?install=success` (W3139 "Added — opens as <organisation>"), `?install=failure` (W3140), `?install=error` (W3137 "This
//     browser can't install from here — use Share, then Add to Home Screen") and none; the device's status line: "Not now — until <date>" / "added" /
//     W3137 for a browser with no install prompt;
//   • the rule line when the organisation's switch is ON ("from your second visit … waits 30 days"), the honest OFF line otherwise — and the
//     platform's page passes OFF (the tenant-scoped key is absent there); still NO install button or form on this page; no size figure;
//   • the drafts line is TRUE now and links "On this phone"; the 6b refusals print beside 6a's.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
import PlatformApp from '../app/(platform)/app/page';
import TenantApp from '../app/[tenantSlug]/app/page';
import { InstallStatusView } from '../components/install/InstallStatus';
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { store6bRefusalKeys } from '../features/store6b/refusals';
import { store6RefusalKeys } from '../features/store6/refusals';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, ORG, SLUG, reset } from './store6a-fixtures';

beforeEach(() => reset());
const tenant = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantApp({ params: { tenantSlug: SLUG }, searchParams: sp }));
const SL = { notNow: en['store6b.app.status.notNow'], added: en['store6b.app.status.added'], cannot: en['store6b.app.cannot'] };

describe('STORE-6b · /app — the invitation section', () => {
  it('?install=success · failure · error (W3139 / W3140 / W3137) — and none', async () => {
    expect(text(await tenant({ install: 'success' }))).toContain(`Added — opens as ${ORG}.`);
    expect(await tenant({ install: 'success' })).toContain('data-kv-install-state="success"');
    expect(text(await tenant({ install: 'failure' }))).toContain(en['store6b.app.failure']);
    expect(text(await tenant({ install: 'error' }))).toContain('This browser can\'t install from here — use Share, then Add to Home Screen.');
    expect(await tenant()).not.toContain('data-kv-install-state');
    expect(await tenant({ install: 'junk' })).not.toContain('data-kv-install-state');
  });
  it('the device\'s status line: "Not now — until <date>" · "added" · W3137 for a browser with no prompt · nothing', () => {
    const until = Date.parse('2026-11-16T10:00:00.000Z');
    const r = (view: Parameters<typeof InstallStatusView>[0]['view']) => renderToStaticMarkup(<InstallStatusView view={view} labels={SL} fmt={() => '16 Nov 2026'} />);
    expect(text(r({ kind: "notnow", until })).trim()).toBe('You said "Not now" on this phone — the invitation waits until 16 Nov 2026.');
    expect(r({ kind: 'added' })).toContain('data-kv-install-status="added"');
    expect(text(r({ kind: "cannot" })).trim()).toBe(en['store6b.app.cannot']);
    expect(r(null)).toBe('');
  });
  it('the switch ON → the rule (second visit, 30 days, the organisation named); OFF → the honest line; the platform → OFF', async () => {
    C.flags = { storefront_install_prompt: true };
    let h = await tenant();
    expect(h).toContain('data-kv-invite="on"');
    expect(text(h)).toContain(en['store6b.app.rule'].replace('{name}', ORG).replace('{days}', '30'));
    C.flags = { storefront_install_prompt: false };
    h = await tenant();
    expect(h).toContain('data-kv-invite="off"'); expect(text(h)).toContain(en['store6b.app.off'].replace('{name}', ORG));
    const p = renderToStaticMarkup(PlatformApp({ searchParams: { install: 'error' } }));
    expect(p).toContain('data-kv-invite="off"'); expect(text(p)).toContain(en['store6b.app.off'].replace('{name}', PLATFORM_BRAND.platformStoreName));
    expect(p).toContain('data-kv-install-state="error"');
  });
  it('still no install button or form on this page; no size figure; the drafts line is TRUE and links On this phone', async () => {
    for (const h of [await tenant({ install: 'success' }), renderToStaticMarkup(PlatformApp({}))]) {
      expect(h).not.toMatch(/<button|<form/);
      expect(text(h)).not.toMatch(/\d+(\.\d+)?\s?MB|under \d|6,?000/i);
      expect(h).toContain('data-kv-drafts="kept"'); expect(h).not.toContain('data-kv-coming');
      expect(text(h)).toContain(en['store6.queued.coming']);
    }
    expect(await tenant()).toContain(`href="/${SLUG}/sync"`);
  });
  it('the refusals: 6a\'s W319 list and 6b\'s invitation list, by name', async () => {
    const w = text(await tenant());
    for (const k of [...store6RefusalKeys('install'), ...store6bRefusalKeys('install')]) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(store6bRefusalKeys('install').length).toBe(5);
  });
});
