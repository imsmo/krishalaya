// apps/web-storefront/src/test-render/contact.render.test.tsx · PC-56 STORE-SWEEP-a · C3 (canon W312; founders D3 / D7) — THE PLATFORM'S CONTACT
// PAGE. The five mailboxes come ONLY from the facts read: unset → "not published yet" ×5 and no `@` on the page; set → each printed as a mailto
// link; the entity and the registered office likewise; the self-serve signup link; the 4b door named (message the organisation from the order or
// the lot); Grievances → /trust-data#grievances; phone, short code, chat app, callbacks, one ticket system, the languages-by-voice line and the
// legal figures refused by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import Contact from '../app/(platform)/contact/page';
import { sweepRefusalKeys } from '../features/sweep/refusals';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { EMPTY_FACTS, FULL_FACTS, S, reset } from './sweep-fixtures';

beforeEach(() => reset());
const page = async () => renderToStaticMarkup(await Contact());
const MAILBOXES = ['mailbox.general', 'mailbox.press', 'mailbox.partners', 'mailbox.security', 'mailbox.grievance'];
const state = (h: string, s: string) => [...h.matchAll(new RegExp(`data-kv-fact="([a-z.]+)" data-kv-fact-state="${s}"`, 'g'))].map((m) => m[1]);

describe('STORE-SWEEP-a · W312 · the platform\'s contact page', () => {
  it('nothing published: the five mailboxes say "not published yet" (×5), the entity and the office too; no @, no mailto', async () => {
    S.facts = EMPTY_FACTS;
    const h = await page();
    expect(state(h, 'unpublished').filter((id) => id.startsWith('mailbox.'))).toEqual(MAILBOXES);
    expect(state(h, 'unpublished').filter((id) => id.startsWith('legal.'))).toEqual(['legal.entity', 'legal.office']);
    expect(h).not.toContain('@');
    expect(h).not.toContain('mailto:');
  });
  it('everything published: each mailbox a mailto link with its synthetic value; the entity and the office printed', async () => {
    S.facts = FULL_FACTS;
    const h = await page(); const w = text(h);
    expect(state(h, 'set')).toEqual([...MAILBOXES, 'legal.entity', 'legal.office']);
    for (const m of ['hello', 'press', 'partners', 'security', 'grievance']) expect(h).toContain(`href="mailto:${m}@example.test"`);
    expect(w).toContain(`${en['sweep.fact.office']}: 12 Example Road, Example City`);
    expect(w).not.toContain(en['sweep.fact.unpublished']);
  });
  it('one mailbox published: exactly that one printed, the other four "not published yet"', async () => {
    S.facts = { ...EMPTY_FACTS, contact: { ...EMPTY_FACTS.contact, generalEmail: 'hello@example.test' } };
    const h = await page();
    expect(state(h, 'set')).toEqual(['mailbox.general']);
    expect(state(h, 'unpublished').filter((id) => id.startsWith('mailbox.')).length).toBe(4);
  });
  it('the facts read fails: said, with a reload — never "not published yet"', async () => {
    S.facts = new Error('down');
    const h = await page();
    expect(h).toContain('data-kv-state="facts-error"');
    expect(text(h)).not.toContain(en['sweep.fact.unpublished']);
  });
  it('the doors that exist: message the organisation (orders), open your storefront yourself, Grievances on the trust page', async () => {
    const h = await page(); const w = text(h);
    expect(w).toContain(en['sweep.contact.buyers']);
    expect(h).toContain('href="/orders"');
    expect(h).toContain('href="/for-organisations"');
    expect(h).toContain('href="/trust-data#grievances"');
  });
  it('the refusals by name: phone, short code, chat app, callbacks, one ticket system, voice / languages, the legal figures', async () => {
    const w = text(await page());
    for (const k of sweepRefusalKeys('contact')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(sweepRefusalKeys('contact').length).toBe(7);
    expect(w).not.toMatch(/1800|\*123#|WhatsApp|within one working day|same ticket system/i);
  });
});
