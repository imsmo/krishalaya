// apps/web-storefront/src/test-render/offline-form-chain.render.test.tsx · PC-56 STORE-6a · C3 (canon W3127–W3130 — DECOR, founder D8) — THE OFFLINE
// FORM CHAIN PRINTS THE REFUSAL AND THE LIVE ACT. `/offline?form=error|review|success|failure` under both chromes: each state says "Add to cart —
// needs signal. Nothing is saved on the phone.", its own true sentence, a link to the LIVE act (the store's browse, with signal) and back to the
// offline rules — never the canon's W273 links (DELTA); "the audit trail has the entry", "reconcile zero-sum" and "page the on-call" refused.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/offline', useSearchParams: () => new URLSearchParams() }));
import ShellOffline from '../app/(shell)/offline/page';
import TenantOffline from '../app/[tenantSlug]/offline/page';
import { OFFLINE_FORM_STATES } from '../features/store6/paths';
import { STORE6A_DELTAS, store6RefusalKeys } from '../features/store6/refusals';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { SLUG, reset } from './store6a-fixtures';

beforeEach(() => reset());

describe('STORE-6a · W3127–W3130 · the offline form chain (DECOR)', () => {
  it.each(OFFLINE_FORM_STATES.map((s) => [s]))('%s: the refusal, its true sentence, the live act and the way back — both chromes', async (state) => {
    for (const [chrome, html, live, back] of [
      ['platform', renderToStaticMarkup(ShellOffline({ searchParams: { form: state } })), '/search', '/offline'],
      ['tenant', renderToStaticMarkup(await TenantOffline({ params: { tenantSlug: SLUG }, searchParams: { form: state } })), `/${SLUG}/search`, `/${SLUG}/offline`],
    ] as const) {
      const words = text(html);
      expect([chrome, html.includes(`data-kv-offline-form="${state}"`)]).toEqual([chrome, true]);
      expect(words).toContain(en['store6.form.refused']);
      expect(words).toContain(en[`store6.form.${state}.title`]); expect(words).toContain(en[`store6.form.${state}.body`]);
      expect(html).toContain(`href="${live}" class="kv-btn" data-kv-live-act="add-to-cart"`);
      expect(html).toContain(`href="${back}" class="kv-btn--link" data-kv-back="offline"`);
      for (const k of store6RefusalKeys('offline_form')) expect([chrome, k, words.includes(en[k])]).toEqual([chrome, k, true]);
      expect(words).not.toMatch(/audit trail has the entry|reconcile zero-sum|page the on-call|will sync/i);
    }
  });
  it('no chain state without ?form (the policy page itself); an unknown state is the policy page', () => {
    expect(renderToStaticMarkup(ShellOffline({ searchParams: {} }))).not.toContain('data-kv-offline-form');
    expect(renderToStaticMarkup(ShellOffline({ searchParams: { form: 'confirm' } }))).not.toContain('data-kv-offline-form');
  });
  it('the canon\'s link defects are recorded as DELTAs, not copied', () => {
    expect(STORE6A_DELTAS.map((d) => d.id)).toEqual(expect.arrayContaining(['chain_links', 'chain_shape', 'policy_routes', 'w314_moved', 'monogram_route', 'aging_tier']));
  });
});
