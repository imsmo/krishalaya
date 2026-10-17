// apps/web-storefront/src/test-render/press.render.test.tsx · PC-56 STORE-SWEEP-a · C3 (survey F-9; founders D5 / D7) — PRESS, reworded: no promised
// reply time ("two business days" gone), no channel that does not exist — the press mailbox is the facts read (set → a mailto link; empty → "not
// published yet"; a failed read → said), and the Contact page linked.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import Press from '../app/(platform)/press/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { FULL_FACTS, S, reset } from './sweep-fixtures';

beforeEach(() => reset());
const page = async () => renderToStaticMarkup(await Press());

describe('STORE-SWEEP-a · Press', () => {
  it('no promised reply time; the press mailbox "not published yet"; no @; the Contact page linked', async () => {
    const h = await page(); const w = text(h);
    expect(w).toContain(en['press.body']);
    expect(w).not.toMatch(/two business days|within \S+ (business|working) days/i);
    expect(h).toContain('data-kv-fact="mailbox.press" data-kv-fact-state="unpublished"');
    expect(h).not.toContain('@');
    expect(h).toContain('href="/contact"');
  });
  it('the press mailbox published → a mailto link', async () => {
    S.facts = FULL_FACTS;
    expect(await page()).toContain('href="mailto:press@example.test"');
  });
  it('the facts read fails → said, never "not published yet"', async () => {
    S.facts = new Error('down');
    const h = await page();
    expect(h).toContain('data-kv-state="facts-error"');
    expect(text(h)).not.toContain(en['sweep.fact.unpublished']);
  });
});
