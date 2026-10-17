// apps/web-storefront/src/test-render/install-invite.render.test.tsx · PC-56 STORE-6b · D3 (founder Q8) / C2 (canon W3138, W3139, W3140) — THE INSTALL
// INVITATION:
//   • mounted ONCE in each chrome's layout: the organisation's layout passes the NAME and ICON exactly as its manifest has them (the published
//     display name; the logo, else the monogram) and ITS `storefront_install_prompt` (OFF or unreadable → false); the platform layout passes the
//     platform store's name and icon and `false` (the tenant-scoped key reads absent there — named); the offline shell mounts none;
//   • the island arms itself (a hidden marker in the server's HTML) only with the flag ON; nothing at all with it OFF;
//   • the sheet (W3138): "Add <organisation> to your home screen?", its icon, "It opens full-screen…", Add / Not now — no size figure;
//     its next states: W3139 "Added — opens as <organisation>" → /app?install=success; W3140 "Not added — add it later from the App page" →
//     /app?install=failure; an error → /app?install=error. Before the browser offers its prompt: nothing (the SSR state).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
jest.mock('../components/install/InstallInvite', () => {
  const actual = jest.requireActual('../components/install/InstallInvite');
  return { ...actual, InstallInvite: (p: { name: string; iconHref: string; flagOn: boolean; appHref: string; labels: { title: string } }) => <i data-kv-invite-mounted={String(p.flagOn)} data-kv-invite-name={p.name} data-kv-invite-icon={p.iconHref} data-kv-invite-app={p.appHref} data-kv-invite-title={p.labels.title} /> };
});

import PlatformLayout from '../app/(platform)/layout';
import TenantLayout from '../app/[tenantSlug]/layout';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { PLATFORM_BRAND } from '../features/branding/brand-theme';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';
import { C, ORG, SLUG, brandWith, reset } from './store6a-fixtures';

const { InstallInvite: RealInvite, InstallSheetView } = jest.requireActual('../components/install/InstallInvite') as typeof import('../components/install/InstallInvite');
beforeEach(() => reset());
const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;
const tenant = async () => renderResolved(await TenantLayout({ children: <p>page</p>, params: { tenantSlug: SLUG } }), [TenantHeader]);
const L = {
  title: en['store6b.invite.title'], body: en['store6b.invite.body'], add: en['store6b.invite.add'], notNow: en['store6b.invite.notNow'], added: en['store6b.invite.added'],
  notAdded: en['store6b.invite.notAdded'], close: en['store6b.invite.close'], appLink: en['store6b.invite.appLink'], label: en['store6b.invite.label'],
};

describe('STORE-6b · the invitation is mounted ONCE per chrome, with the manifest\'s name and icon', () => {
  it('the organisation, flag ON: its manifest name and its monogram (no logo published), flagOn true, its /app', async () => {
    C.flags = { storefront_install_prompt: true };
    const h = await tenant();
    expect(count(h, /data-kv-invite-mounted=/g)).toBe(1);
    expect(h).toContain('data-kv-invite-mounted="true"');
    expect(h).toContain(`data-kv-invite-name="${ORG}"`);
    expect(h).toContain(`data-kv-invite-icon="/${SLUG}/app-icon.svg"`);
    expect(h).toContain(`data-kv-invite-app="/${SLUG}/app"`);
    expect(h).toContain(`data-kv-invite-title="Add {name} to your home screen?"`);
  });
  it('a published logo is the icon (as the manifest has it)', async () => {
    C.flags = { storefront_install_prompt: true };
    C.branding = brandWith({ logoPath: '/v1/storefront/branding/logo/01a10000-0000-7000-8000-00000000000a/3', logoMime: 'image/png' });
    expect(await tenant()).toContain('data-kv-invite-icon="https://api.test/v1/storefront/branding/logo/01a10000-0000-7000-8000-00000000000a/3"');
  });
  it('the flag OFF, absent, or unreadable → flagOn false (fail closed)', async () => {
    for (const f of [{ storefront_install_prompt: false }, {}, new Error('flags down')]) {
      C.flags = f as never;
      expect(await tenant()).toContain('data-kv-invite-mounted="false"');
    }
  });
  it('the platform chrome: the platform store\'s name and icon, flagOn FALSE (the tenant-scoped key reads absent there)', async () => {
    const h = await renderResolved(await PlatformLayout({ children: <p>page</p> }), [SiteHeader]);
    expect(count(h, /data-kv-invite-mounted=/g)).toBe(1);
    expect(h).toContain('data-kv-invite-mounted="false"');
    expect(h).toContain(`data-kv-invite-name="${PLATFORM_BRAND.platformStoreName}"`);
    expect(h).toContain('data-kv-invite-icon="/icon-192.png"'); expect(h).toContain('data-kv-invite-app="/app"');
  });
  it('the organisation\'s offline page (the session-free shell) mounts none', async () => {
    C.flags = { storefront_install_prompt: true };
    C.headers = { 'x-kv-shell': 'offline' };
    const h = renderToStaticMarkup(await TenantLayout({ children: <p>page</p>, params: { tenantSlug: SLUG } }));
    expect(h).not.toContain('data-kv-invite-mounted');
  });
});

describe('STORE-6b · the island and the sheet (W3138 → W3139 / W3140)', () => {
  it('the island arms itself only with the flag ON; before the browser offers its prompt, no sheet (the SSR state)', () => {
    const on = renderToStaticMarkup(<RealInvite name={ORG} iconHref="/i.svg" flagOn appHref={`/${SLUG}/app`} labels={L} />);
    expect(on).toBe('<span hidden="" data-kv-install-invite="on"></span>');
    expect(renderToStaticMarkup(<RealInvite name={ORG} iconHref="/i.svg" flagOn={false} appHref="/app" labels={L} />)).toBe('');
  });
  it('W3138 — the organisation named, its icon, the honest line, Add / Not now; no size figure, never the platform', () => {
    const h = renderToStaticMarkup(<InstallSheetView state="open" name={ORG} iconHref={`/${SLUG}/app-icon.svg`} labels={L} appHref={`/${SLUG}/app`} />);
    const w = text(h);
    expect(w).toContain(`Add ${ORG} to your home screen?`);
    expect(w).toContain(en['store6b.invite.body']);
    expect(h).toContain(`src="/${SLUG}/app-icon.svg"`);
    expect(h).toMatch(/<button[^>]*data-kv-act="install-add"[^>]*>Add to home screen<\/button>/);
    expect(h).toMatch(/<button[^>]*data-kv-act="install-notnow"[^>]*>Not now<\/button>/);
    expect(w).not.toMatch(/\d+(\.\d+)?\s?MB|under \d|small download/i);
    expect(w).not.toContain(PLATFORM_BRAND.name);
    expect(h).toContain('role="dialog"'); expect(h).toContain('aria-modal="false"');      // never blocks the page
  });
  it('W3139 "Added — opens as <organisation>" → /app?install=success · W3140 "Not added — add it later from the App page" → /app?install=failure · error → ?install=error', () => {
    const v = (state: 'added' | 'notadded' | 'error') => renderToStaticMarkup(<InstallSheetView state={state} name={ORG} iconHref="/i.svg" labels={L} appHref={`/${SLUG}/app`} />);
    expect(text(v('added'))).toContain(`Added — opens as ${ORG}.`); expect(v('added')).toContain(`href="/${SLUG}/app?install=success"`);
    expect(text(v('notadded'))).toContain(en['store6b.invite.notAdded']); expect(v('notadded')).toContain(`href="/${SLUG}/app?install=failure"`);
    expect(v('error')).toContain(`href="/${SLUG}/app?install=error"`);
    for (const s of ['added', 'notadded', 'error'] as const) expect(text(v(s))).not.toMatch(/audit|zero-sum|on-call/i);
    expect(renderToStaticMarkup(<InstallSheetView state="closed" name={ORG} iconHref="/i.svg" labels={L} appHref="/app" />)).toBe('');
  });
});
