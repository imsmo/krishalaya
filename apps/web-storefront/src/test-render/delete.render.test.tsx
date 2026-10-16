// apps/web-storefront/src/test-render/delete.render.test.tsx · PC-56 STORE-4a · C7 — the deletion request on the W3031–W3033 shape (DELTA;
// components/account/DeleteScreen.tsx + requestDeletionAction). Every figure is the server's (`privacy.commitments()`):
//   • BLOCKED → the open orders, the escrow and the wallet figures in the DATA's currency, "pay it out first", and NO submit;
//   • ALLOWED → "kept by law: N invoices for R years" (R from the setting — a changed setting changes the page), the cooling days, "recorded",
//     the submit with a key minted at render;
//   • success → the request and its cooling date; failure → named (blocked on a race / concurrency / server) with the SAME key; "within 30
//     days" refused by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store4a-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4a-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import DeletePage from '../app/(platform)/account/delete/page';
import { requestDeletionAction } from '../app/(platform)/account/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset } from './store4a-fixtures';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await DeletePage({ searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message); } };
const CLEAN = { openOrders: 0, escrowMinor: '0', walletMinor: '0', currencyCode: null, multiCurrency: false, invoiceCount: 17, blocked: false, retentionYears: 8, coolingDays: 90 };
beforeEach(() => { reset(); });

describe('STORE-4a · deletion — BLOCKED (founder D1)', () => {
  it('the open orders, the escrow and the wallet in the data\'s currency, "pay it out first" — and NO submit', async () => {
    C.commitments = { openOrders: 2, escrowMinor: '250000', walletMinor: '125050', currencyCode: 'INR', multiCurrency: false, invoiceCount: 17, blocked: true, retentionYears: 8, coolingDays: 90 };
    const h = await page(); const v = text(h);
    expect(h).toContain('data-kv-state="blocked"'); expect(h).toContain('data-kv-open-orders="2"');
    expect(v).toContain('2 orders must complete first'); expect(v).toContain('₹2,500.00 is held for your orders');
    expect(v).toMatch(/Wallet balance ₹1,250\.50 — pay it out to your bank first/);
    expect(v).toContain(en['store4a.delete.nothingMoves']);
    expect(h).not.toContain('data-kv-submit'); expect(h).not.toContain('name="key"');
  });
  it('a zero figure draws no line (the API\'s strings compared, never computed)', async () => {
    C.commitments = { ...CLEAN, openOrders: 1, blocked: true };
    const h = await page();
    expect(h).toContain('data-kv-open-orders="1"'); expect(h).not.toContain('data-kv-escrow'); expect(h).not.toContain('data-kv-wallet');
  });
});

describe('STORE-4a · deletion — ALLOWED, success, failure (founder D1 / D3)', () => {
  it('kept by law with the invoice count and the setting\'s years; the cooling days; "this action is recorded"; a key minted at render', async () => {
    C.commitments = CLEAN;
    const h = await page(); const v = text(h);
    expect(v).toContain('Kept by law: your 17 invoices, for 8 years.');
    expect(v).toContain('after a 90-day cooling period'); expect(v).toContain(en['store4a.delete.recorded']);
    expect(h).toMatch(/name="key" value="dsr-delete:[0-9a-f-]{36}"/);
    C.commitments = { ...CLEAN, retentionYears: 10 };
    expect(text(await page())).toContain('for 10 years');            // the SETTING's number, never a literal
    C.commitments = { ...CLEAN, retentionYears: null };
    expect(text(await page())).toContain('Kept by law: your 17 invoices.');
  });
  it('"within 30 days" is refused by name; the desk erases after the cooling (honest about the manual executor)', async () => {
    C.commitments = CLEAN;
    const h = await page();
    expect(h).toContain('data-kv-refusal="thirty_days"'); expect(text(h)).not.toMatch(/within 30 days/i);
  });
  it('confirm → the request reaches the API with the key; the page then shows the request and its cooling date', async () => {
    const key = 'dsr-delete:0214bbbb-0000-4000-8000-000000000001';
    expect(await redirectOf(requestDeletionAction(form({ chrome: 'platform', key })))).toBe('REDIRECT /account/delete?ok=requested');
    expect(C.calls).toContainEqual(['privacy.requestAccountDeletion', {}, key]);
    C.requests = [{ id: 'dsr-9', kind: 'deletion', status: 'open', coolingEndsAt: '2027-01-14T05:00:00.000Z', requestedAt: '2026-10-16T05:00:00.000Z', export: null }];
    const h = await page({ ok: 'requested' });
    expect(h).toContain('data-kv-state="requested"'); expect(text(h)).toContain('It cools until 14 January 2027'); expect(text(h)).toContain(en['store4a.delete.desk']);
    expect(h).not.toContain('data-kv-submit');
  });
  it.each([['blocked', new SdkError('DSR_BLOCKED', 409, 'x')], ['concurrency', new SdkError('CONFLICT', 409, 'x')], ['server', new SdkError('INTERNAL', 500, 'x')]])(
    'failure %s → named, the SAME key on Retry', async (name, err) => {
      const key = 'dsr-delete:0214bbbb-0000-4000-8000-000000000002';
      C.fail.deletion = err;
      expect(await redirectOf(requestDeletionAction(form({ chrome: 'platform', key })))).toBe(`REDIRECT /account/delete?failure=${name}&k=${encodeURIComponent(key)}`);
      C.commitments = name === 'blocked' ? { ...CLEAN, openOrders: 1, blocked: true } : CLEAN;
      const h = await page({ failure: name, k: key });
      expect(h).toContain(`data-kv-failure="${name}"`);
      if (name !== 'blocked') expect(h).toContain(`name="key" value="${key}"`);
    });
});
