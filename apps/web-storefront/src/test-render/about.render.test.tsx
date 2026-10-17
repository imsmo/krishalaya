// apps/web-storefront/src/test-render/about.render.test.tsx · PC-56 STORE-SWEEP-a · C3 (canon W308; founder D5) — ABOUT, PLATFORM-ONLY.
//   • the three PRECOMPUTED counts (organisations, districts, live listings) with the "as of" stamp from `computedAt`, and the cadence (every 15
//     minutes — not "refreshed daily"); stats down → the home's error sentence (never zeros); never computed → "not counted yet";
//   • no GMV figure — the 1b refusal printed instead; no "12 languages", no USSD, no "voice-first", no "escrow on every order", no "where the
//     money went" as a claim; "From Farm to Future" as a vision with its note; the principles; the refusals by name;
//   • the press mailbox from the facts read, or "not published yet".
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import About from '../app/(platform)/about/page';
import { sweepRefusalKeys } from '../features/sweep/refusals';
import { STATS_EVERY_MINUTES } from '../features/sweep/trust-claims';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { FULL_FACTS, S, reset } from './sweep-fixtures';

beforeEach(() => reset());
const page = async () => renderToStaticMarkup(await About());

describe('STORE-SWEEP-a · W308 · About', () => {
  it('the three counts with "as of" and the cadence; no payments figure — the refusal instead', async () => {
    const h = await page(); const w = text(h);
    expect(w).toContain(en['home.glance.orgs'].replace('{count}', '312'));
    expect(w).toContain(en['home.glance.districts'].replace('{count}', '41'));
    expect(w).toContain(en['home.glance.listings'].replace('{count}', '2,418'));
    expect(h).toMatch(/dateTime="2026-10-17T09:45:00.000Z"/i);
    expect(w).toContain(en['about.countsCadence'].replace('{minutes}', String(STATS_EVERY_MINUTES)));
    expect(h).toContain('data-kv-refusal="gmv_yesterday"');
    expect(w).toContain(en['home.refusal.gmv']);
    expect(w).not.toMatch(/₹|paid to farmers yesterday|refreshed daily/i);
  });
  it('stats down → the error sentence, never zeros; never computed → "not counted yet"', async () => {
    S.stats = new Error('down');
    let h = await page();
    expect(h).toContain('data-kv-state="stats-error"');
    expect(h).not.toContain('data-kv-count=');
    S.stats = { liveListings: 0, verifiedOrganisations: 0, districts: 0, computedAt: null };
    h = await page();
    expect(h).toContain('data-kv-state="stats-not-yet"');
    expect(h).not.toContain('data-kv-count=');
  });
  it('the vision as a vision; the principles only where code makes them true; the refusals by name', async () => {
    const h = await page(); const w = text(h);
    expect(w).toContain(en['about.vision']); expect(w).toContain(en['about.visionNote']);
    for (const p of ['principle1', 'principle2', 'principle3']) expect(w).toContain(`${en[`about.${p}.title`]} ${en[`about.${p}.body`]}`);
    for (const k of sweepRefusalKeys('about')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    const body = text(h.split('data-kv-refused="about"')[0]);
    expect(body).not.toMatch(/12 languages|USSD|voice-first|escrow on every order|where the money went|secure payments, logistics/i);
    expect(w).not.toMatch(/12 languages|USSD|Voice-first/i);
  });
  it('press & partnership: the press mailbox from the facts, or "not published yet"', async () => {
    let h = await page();
    expect(h).toContain('data-kv-fact="mailbox.press" data-kv-fact-state="unpublished"');
    expect(h).not.toContain('@');
    S.facts = FULL_FACTS;
    h = await page();
    expect(h).toContain('href="mailto:press@example.test"');
  });
});
