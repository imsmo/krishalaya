// apps/web-storefront/src/test-render/legal-pages.render.test.tsx · PC-56 LEGAL-1 — THE FOUR POLICY PAGES SAY WHAT IS PUBLISHED, AND ONLY THAT.
//   • published: the title (h1), "Version N · published <date>" in the page's language, the body's headings / lists from the safe renderer, the
//     platform's facts in its tokens (a set mailbox as a mailto link; an unset fact "not published yet"; a failed facts read never fails the page);
//   • a body in another language than the one asked for carries the fallback notice;
//   • nothing published (404) → the page's localized name and "not published yet" — no legal text; any other failure → "could not be loaded" + Retry;
//   • raw HTML and unsafe links in a body never become elements;
//   • the store route reads the STORE's policy (its slug rides the client) in the page's language; both footers link all four pages;
//   • the <title> and description are localized.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./legal-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import Terms, { generateMetadata as termsMeta, dynamic as termsDynamic } from '../app/(platform)/terms/page';
import Privacy from '../app/(platform)/privacy/page';
import Refunds from '../app/(platform)/refunds/page';
import Shipping, { generateMetadata as shippingMeta } from '../app/(platform)/shipping/page';
import TenantTerms from '../app/[tenantSlug]/terms/page';
import TenantRefunds, { generateMetadata as tenantRefundsMeta } from '../app/[tenantSlug]/refunds/page';
import { SiteFooter } from '../components/SiteFooter';
import { TenantFooter } from '../components/TenantFooter';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { EMPTY_FACTS, FULL_FACTS, S, SLUG, reset } from './sweep-fixtures';
import { L, httpError, policy, resetLegal } from './legal-fixtures';

beforeEach(() => { reset(); resetLegal(EMPTY_FACTS); });
const render = async (el: Promise<JSX.Element>) => renderToStaticMarkup(await el);
const terms = () => render(Terms());

describe('LEGAL-1 · a published policy', () => {
  it('title, version line, the body\'s headings and list; asked in the page\'s language; force-dynamic', async () => {
    L.policy.terms = policy();
    const h = await terms(); const w = text(h);
    expect(h).toContain('<h1 lang="en">Terms of use</h1>');
    expect(w).toContain('Version 3 · published 2 November 2026');
    expect(h).toContain('<h2 id="who-we-are">Who we are</h2>');
    expect(h).toContain('<h3 id="contact">Contact</h3>');
    expect(h).toMatch(/<ul><li>Write to /);
    expect(h).toContain('data-kv-policy-state="published"');
    expect(h).not.toContain('data-kv-state="policy-fallback"');
    expect(L.calls).toContainEqual(['policy:terms', 'en', null]);
    expect(termsDynamic).toBe('force-dynamic');
  });
  it('the version line in Hindi and Gujarati, the date formatted for the language', async () => {
    L.policy.terms = policy();
    S.lang = 'hi';
    let w = text(await terms());
    expect(w).toContain(hi['legal.versionLine'].replace('{version}', '3').replace('{date}', new Intl.DateTimeFormat('hi-IN', { dateStyle: 'long' }).format(new Date('2026-11-02T10:00:00.000Z'))));
    expect(L.calls).toContainEqual(['policy:terms', 'hi', null]);
    S.lang = 'gu';
    w = text(await terms());
    expect(w).toContain(gu['legal.versionLine'].replace('{version}', '3').replace('{date}', new Intl.DateTimeFormat('gu-IN', { dateStyle: 'long' }).format(new Date('2026-11-02T10:00:00.000Z'))));
  });
  it('tokens: set facts are printed (a mailbox as a mailto link)', async () => {
    L.policy.terms = policy(); L.facts = FULL_FACTS;
    const h = await terms();
    expect(text(h)).toContain('Run by Example Agritech Private Limited');
    expect(h).toContain('<a href="mailto:grievance@example.test" data-kv-fact="platform.grievance.email" data-kv-fact-state="set">grievance@example.test</a>');
    expect(h).not.toContain('{{');
  });
  it('tokens: an UNSET fact reads "not published yet"; a FAILED facts read does too — the page still renders', async () => {
    L.policy.terms = policy();
    L.facts = { ...EMPTY_FACTS, legal: { ...EMPTY_FACTS.legal, entityName: 'Example Agritech Private Limited' } };
    let h = await terms();
    expect(h).toContain('data-kv-fact="platform.grievance.email" data-kv-fact-state="unpublished">not published yet</em>');
    expect(h).toContain('data-kv-fact="platform.legal.entity_name" data-kv-fact-state="set"');
    expect(h).not.toContain('mailto:');
    L.facts = httpError(503);
    h = await terms();
    expect((h.match(/data-kv-fact-state="unpublished"/g) ?? []).length).toBe(2);
    expect(h).toContain('<h1 lang="en">Terms of use</h1>');
  });
  it('an unknown token stays literal; a fact value is never read as markdown or HTML', async () => {
    L.policy.terms = policy({ body: 'Hello {{anything.else}} — {{platform.legal.entity_name}}' });
    L.facts = { ...EMPTY_FACTS, legal: { entityName: '[a](javascript:x) **b** <img src=x onerror=alert(1)>', registeredOffice: null } };
    const h = await terms();
    expect(text(h)).toContain('Hello {{anything.else}}');
    expect(h).toContain('[a](javascript:x) **b** &lt;img src=x onerror=alert(1)&gt;');
    expect(h).not.toContain('javascript:x"');
    expect(h).not.toMatch(/<img|<strong>b/);
  });
  it('raw HTML and unsafe links in the body never become elements; safe links do (external with rel)', async () => {
    L.policy.terms = policy({ body: '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [bad2](JAVASCRIPT:alert(1)) [d](data:text/html,x) [v](vbscript:x) [p](//evil.example)\n\n[ok](https://example.test/a) [home](/trust-data#grievances) [mail](mailto:x@example.test)' });
    const h = await terms();
    expect(h).not.toMatch(/<script|<img/);
    expect(h).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(h).not.toMatch(/href="(javascript|JAVASCRIPT|data|vbscript):|href="\/\/evil/);
    expect(text(h)).toContain('bad bad2 d v p');
    expect(h).toContain('<a href="https://example.test/a" rel="noopener noreferrer" data-kv-policy-link="external">ok</a>');
    expect(h).toContain('<a href="/trust-data#grievances" data-kv-policy-link="internal">home</a>');
    expect(h).toContain('<a href="mailto:x@example.test" data-kv-policy-link="internal">mail</a>');
  });
  it('a body in another language: the fallback notice names both languages', async () => {
    S.lang = 'gu';
    L.policy.terms = policy({ requestedLanguage: 'gu', language: 'en', fallbackLanguage: 'en' });
    const h = await terms();
    expect(h).toContain('data-kv-state="policy-fallback"');
    expect(text(h)).toContain(gu['legal.fallbackNotice'].replace('{requested}', 'ગુજરાતી').replace('{shown}', 'English'));
    expect(h).toContain('<div data-kv-policy-body="" lang="en">');
  });
});

describe('LEGAL-1 · nothing published, and a failed read', () => {
  it('404 (not published): the localized page name and "not published yet" — no body, no version', async () => {
    L.policy.privacy = httpError(404);
    const h = await render(Privacy()); const w = text(h);
    expect(h).toContain(`<h1>${en['legal.privacy.title']}</h1>`);
    expect(w).toContain(en['legal.notPublished']);
    expect(h).toContain('data-kv-policy-state="not_found"');
    expect(w).not.toMatch(/Version/);
    expect(h).not.toContain('data-kv-retry');
    S.lang = 'hi';
    const hh = text(await render(Privacy()));
    expect(hh).toContain(hi['legal.privacy.title']);
    expect(hh).toContain(hi['legal.notPublished']);
  });
  it('any other failure: "could not be loaded" + a Retry that reloads the same page', async () => {
    L.policy.refunds = httpError(503);
    const h = await render(Refunds());
    expect(h).toContain('data-kv-policy-state="unavailable"');
    expect(text(h)).toContain(en['legal.error']);
    expect(h).toMatch(/<a href="\/refunds" class="kv-btn" data-kv-retry="reload">Try again<\/a>/);
    expect(text(h)).not.toContain(en['legal.notPublished']);
  });
  it('every platform page renders its own name when nothing is published', async () => {
    for (const [P, s] of [[Terms, 'terms'], [Privacy, 'privacy'], [Refunds, 'refunds'], [Shipping, 'shipping']] as const) {
      const h = await render(P());
      expect([s, h.includes(`<h1>${en[`legal.${s}.title`].replace('&', '&amp;')}</h1>`)]).toEqual([s, true]);
    }
  });
});

describe('LEGAL-1 · the store route', () => {
  it('reads THE STORE\'s policy (its slug rides the client), in the page\'s language; its Retry stays in the store', async () => {
    S.lang = 'hi';
    L.policy.terms = policy({ source: 'tenant', title: 'दुकान की शर्तें', language: 'hi', requestedLanguage: 'hi' });
    const h = await render(TenantTerms({ params: Promise.resolve({ tenantSlug: SLUG }) }));
    expect(L.calls).toContainEqual(['policy:terms', 'hi', SLUG]);
    expect(h).toContain('data-kv-chrome="tenant"');
    expect(h).toContain('data-kv-policy-source="tenant"');
    expect(h).toContain('<h1 lang="hi">दुकान की शर्तें</h1>');
    L.policy.refunds = httpError(500);
    const r = await render(TenantRefunds({ params: Promise.resolve({ tenantSlug: SLUG }) }));
    expect(r).toContain(`href="/${SLUG}/refunds"`);
  });
});

describe('LEGAL-1 · footers and metadata', () => {
  it('the platform footer links all four pages (localized)', () => {
    const h = renderToStaticMarkup(<SiteFooter />);
    for (const s of ['terms', 'privacy', 'refunds', 'shipping']) expect([s, h.includes(`href="/${s}"`), text(h).includes(en[`legal.footer.${s}`])]).toEqual([s, true, true]);
    expect(h).toContain('data-kv-foot-col="legal"');
  });
  it('a store\'s footer links ITS four pages; in Gujarati the labels are Gujarati', () => {
    S.lang = 'gu';
    const h = renderToStaticMarkup(<TenantFooter name="Anand FPO Mandi" slug={SLUG} showPoweredBy={false} />);
    for (const s of ['terms', 'privacy', 'refunds', 'shipping']) expect([s, h.includes(`href="/${SLUG}/${s}"`), text(h).includes(gu[`legal.footer.${s}`])]).toEqual([s, true, true]);
  });
  it('the <title> and description are localized', () => {
    expect(termsMeta()).toEqual({ title: en['legal.terms.title'], description: en['legal.terms.description'] });
    S.lang = 'hi';
    expect(shippingMeta()).toEqual({ title: hi['legal.shipping.title'], description: hi['legal.shipping.description'] });
    S.lang = 'gu';
    expect(tenantRefundsMeta()).toEqual({ title: gu['legal.refunds.title'], description: gu['legal.refunds.description'] });
  });
});
