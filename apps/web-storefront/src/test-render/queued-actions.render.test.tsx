// apps/web-storefront/src/test-render/queued-actions.render.test.tsx · PC-56 STORE-6a · C3 (canon W314, moved in from the sweep; founder D1) —
// "MONEY NEVER QUEUES", UNDER BOTH CHROMES. The list printed is DERIVED here from features/store6/acts.ts (the money + countdown entries — never a
// copy): every one in order, with its name, "— needs signal" and its reason in words; then the truth about everything else and the 6b "coming"
// line; the canon's queue drawer refused by name (no "queued / sending… / confirmed / failed — needs you" UI, no "3 waiting to sync", no
// Undo / Fix). Mutant M1 (a money act reclassified content) turns this red: the money list printed no longer matches the founder's 16.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
import PlatformQueued from '../app/(platform)/queued/page';
import TenantQueued from '../app/[tenantSlug]/queued/page';
import { actsOf, neverQueued } from '../features/store6/acts';
import { store6RefusalKeys } from '../features/store6/refusals';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { SLUG, reset } from './store6a-fixtures';

beforeEach(() => reset());
const FOUNDER_16 = ['placeOrder', 'pay', 'payFromWallet', 'chooseDelivery', 'choosePayment', 'applyCoupon', 'bid', 'makeOffer', 'acceptOffer', 'counterOffer',
  'declineOffer', 'acceptPrice', 'cancelRefund', 'received', 'raiseDispute', 'requestDeletion'];

describe('STORE-6a · W314 · money never queues', () => {
  it.each([['the platform', () => PlatformQueued()], ['the organisation', () => TenantQueued({ params: { tenantSlug: SLUG } })]])('%s: the full list from the registry, in order, each with its reason', (_n, make) => {
    const h = renderToStaticMarkup(make()); const words = text(h);
    const printed = [...h.matchAll(/data-kv-act="([^"]+)" data-kv-act-class="(money|countdown)"/g)].map((m) => [m[1], m[2]]);
    expect(printed).toEqual(neverQueued().map((a) => [a.id, a.cls]));          // derived from acts.ts — never a copy
    expect(printed.filter((p) => p[1] === 'money').map((p) => p[0])).toEqual(FOUNDER_16);
    expect(actsOf('money').length).toBe(16);
    for (const a of neverQueued()) {
      expect(words).toContain(`${en[`store6.act.${a.id}`]} ${en['store6.signal.needsSignal']}: ${en[`store6.reason.${a.reason}`]}`);
    }
    expect(words).toContain(en['store6.queued.title']);
    expect(words).toContain(en['store6.queued.coming']);
    expect(words).toContain(en['store6.queued.content.body']);
    for (const k of store6RefusalKeys('queued')) expect([k, words.includes(en[k])]).toEqual([k, true]);
    expect(store6RefusalKeys('queued').length).toBe(8);
    // the drawer is refused, never drawn: no state chip, no Undo / Fix control, no count
    expect(h).not.toMatch(/data-kv-queue-item|data-kv-sync|<button/);
    expect(words).not.toMatch(/\b\d+ waiting/);
  });
  it('the organisation\'s page links back to ITS offline page; the platform\'s to /offline', () => {
    expect(renderToStaticMarkup(TenantQueued({ params: { tenantSlug: SLUG } }))).toContain(`href="/${SLUG}/offline"`);
    expect(renderToStaticMarkup(PlatformQueued())).toContain('href="/offline"');
  });
});
