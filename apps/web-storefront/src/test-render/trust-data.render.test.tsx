// apps/web-storefront/src/test-render/trust-data.render.test.tsx · PC-56 STORE-SWEEP-a · C3 (canon W310; founders D2 / D3) — TRUST & YOUR DATA SAYS
// WHAT THE CODE DOES. Derived from features/sweep/trust-claims.ts: every TRUE claim with its mechanism sentence beside it; every unprovable one
// refused BY NAME; the grievance block and the company facts from the platform-facts read — each fact SET printed (a mailbox as a mailto link),
// each EMPTY one "not published yet", and with every fact empty there is no `@` on the page; a failed read is said (never "not published");
// none of the canon's legal figures ("48 hours / 30 days / intermediary rules") unless they are the published facts.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import TrustData from '../app/(platform)/trust-data/page';
import { TRUST_CLAIMS, ZERO_SUM_EVERY_MINUTES, refusedClaims, trueClaims } from '../features/sweep/trust-claims';
import { QUALITY_WINDOW_HOURS } from '../features/sweep/quality-rules';
import { SWEEP_REFUSALS, sweepRefusalKeys } from '../features/sweep/refusals';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { EMPTY_FACTS, FULL_FACTS, S, reset } from './sweep-fixtures';

beforeEach(() => reset());
const page = async () => renderToStaticMarkup(await TrustData());
const fill = (k: string) => en[k].replace('{minutes}', String(ZERO_SUM_EVERY_MINUTES)).replace('{hours}', String(QUALITY_WINDOW_HOURS));
const facts = (h: string, state: 'set' | 'unpublished') => [...h.matchAll(new RegExp(`data-kv-fact="([a-z.]+)" data-kv-fact-state="${state}"`, 'g'))].map((m) => m[1]);

describe('STORE-SWEEP-a · W310 · the claims', () => {
  it('every TRUE claim, in its group, with the mechanism that makes it true', async () => {
    const h = await page(); const w = text(h);
    const printed = [...h.matchAll(/data-kv-claim="([a-z_]+)" data-kv-verdict="true"/g)].map((m) => m[1]);
    expect(printed).toEqual(trueClaims().map((c) => c.id));
    for (const c of trueClaims()) {
      expect([c.id, w.includes(`${fill(c.key)} ${fill(c.mechanismKey)}`)]).toEqual([c.id, true]);
      expect(h).toContain(`data-kv-mechanism="${c.id}"`);
    }
    expect(w).toContain(`every ${ZERO_SUM_EVERY_MINUTES} minutes`);   // not "hourly" (W310)
    expect(w).not.toMatch(/hourly/i);
  });
  it('every UNPROVABLE claim is refused by name (the regulated partner, independent audit, encryption, consent gate, data sale, certification, proxied calls)', async () => {
    const w = text(await page());
    for (const id of refusedClaims()) {
      const r = SWEEP_REFUSALS.find((x) => x.id === id)!;
      expect([id, w.includes(en[r.key])]).toEqual([id, true]);
    }
    for (const k of sweepRefusalKeys('trust')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(TRUST_CLAIMS.length).toBe(16);
    expect(w).not.toMatch(/regulated payment partner|in progress —|independently auditable|intermediary rules|48 hours|30 days/i);
  });
});

describe('STORE-SWEEP-a · W310 · the facts are data', () => {
  it('every fact EMPTY (the seed): each says "not published yet"; no @ anywhere on the page; no figure', async () => {
    S.facts = EMPTY_FACTS;
    const h = await page(); const w = text(h);
    expect(facts(h, 'unpublished')).toEqual(['grievance.officer', 'grievance.address', 'grievance.email', 'grievance.ack', 'grievance.resolve', 'legal.entity', 'legal.office', 'contact.security']);
    expect(facts(h, 'set')).toEqual([]);
    expect((w.match(new RegExp(en['sweep.fact.unpublished'], 'g')) ?? []).length).toBe(8);
    expect(h).not.toContain('@');
    expect(h).not.toContain('mailto:');
    expect(h).toContain('id="grievances"');
  });
  it('every fact SET: each printed — the figures as sentences, the mailboxes as mailto links; nothing "not published"', async () => {
    S.facts = FULL_FACTS;
    const h = await page(); const w = text(h);
    expect(facts(h, 'set').length).toBe(8);
    expect(facts(h, 'unpublished')).toEqual([]);
    expect(w).toContain(`${en['sweep.fact.officer']}: A. Example`);
    expect(h).toContain('href="mailto:grievance@example.test"');
    expect(h).toContain('href="mailto:security@example.test"');
    expect(w).toContain(en['sweep.fact.ackSet'].replace('{n}', '48'));
    expect(w).toContain(en['sweep.fact.resolveSet'].replace('{n}', '30'));
    expect(w).toContain(`${en['sweep.fact.entity']}: Example Agritech Private Limited`);
    expect(w).not.toContain(en['sweep.fact.unpublished']);
  });
  it('a MIX: only the figures that are set print a figure; the rest say "not published yet"', async () => {
    S.facts = { ...EMPTY_FACTS, grievance: { ...EMPTY_FACTS.grievance, email: 'grievance@example.test', ackHours: 48 } };
    const h = await page();
    expect(facts(h, 'set')).toEqual(['grievance.email', 'grievance.ack']);
    expect(facts(h, 'unpublished')).toContain('grievance.resolve');
    expect(text(h)).not.toMatch(/Resolution within/);
  });
  it('the facts read FAILS: the error sentence and a reload — never "not published yet" (ERROR ≠ EMPTY)', async () => {
    S.facts = new Error('down');
    const h = await page(); const w = text(h);
    expect(h).toContain('data-kv-state="facts-error"');
    expect(w).toContain(en['sweep.fact.error']);
    expect(w).not.toContain(en['sweep.fact.unpublished']);
    expect(h).toContain('href="/trust-data"');
    // the claims still print: the page is not the read
    expect(h).toContain('data-kv-claim="escrow_ledger"');
  });
});
