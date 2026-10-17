// apps/web-storefront/src/test-render/trace-verify.render.test.tsx · PC-56 STORE-5b · C2 (canon W304) — the verify page: the SERVER's recompute per
// step (recomputes ✓ / MISMATCH — every hash after it breaks / written before version 2), the chain's summary, the full hashes, the exact formula
// and the steps to recompute, the seal (sealed at / not yet sealed), the honesty note, "Download the record" → the export page, the refusals.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined }), headers: () => ({ get: () => null }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store5b-fixtures');
  return { getLang: () => f.C.lang, getLanguageDef: () => ({ code: f.C.lang, dir: 'ltr' }), getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store5b-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, publicClientIn: f.publicClientIn };
});
jest.mock('server-only', () => ({}), { virtual: true });
import VerifyPage from '../app/(platform)/trace/[qrToken]/verify/page';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, TOKEN, HASHES, VERIFY, UUIDS } from './store5b-fixtures';
import { store5bRefusalKeys } from '../features/store5b/refusals';

const render = async () => renderToStaticMarkup(await VerifyPage({ params: { qrToken: TOKEN }, searchParams: {} }));
beforeEach(() => { reset(); });

describe('STORE-5b · W304 verify', () => {
  it('ok: every step "recomputes ✓", the full hashes, the summary, the formula and how to recompute, the seal at its time, no uuid', async () => {
    const html = await render(); const h = text(html);
    expect(html).toContain('data-kv-chain="ok"');
    expect((html.match(/data-kv-recomputed="ok"/g) ?? []).length).toBe(2);
    expect(html).toContain(HASHES[0]); expect(html).toContain(HASHES[1]);
    expect(h).toContain(en['store5b.verify.allOk']);
    expect(h).toContain(en['store5b.verify.formula']);
    for (const k of ['store5b.verify.how.prev', 'store5b.verify.how.meta', 'store5b.verify.how.time', 'store5b.verify.how.join'] as const) expect(h).toContain(en[k]);
    expect(h).toMatch(/Sealed by the platform at .* — the seal stamps the latest hash as it stands\./);
    expect(h).toContain(en['store5b.verify.honesty']);
    expect(html).toContain(`href="/trace/${TOKEN}/export"`);
    expect(html).toContain('href="/trace"');   // "Check another code" — the canon's "No verification yet" has no input (DELTA)
    expect(UUIDS(html)).toEqual([]);
  });
  it('mismatch: the step and every step after it say MISMATCH; the summary names the step, loudly (role=alert); never "flagged platform-wide"', async () => {
    C.verify = VERIFY({ chain: 'broken_at', brokenAt: 1, events: VERIFY().events.map((e: any) => ({ ...e, recomputed: 'mismatch' })) });   // eslint-disable-line @typescript-eslint/no-explicit-any
    const html = await render(); const h = text(html);
    expect(html).toContain('data-kv-chain="broken_at"'); expect(html).toContain('data-kv-summary="broken_at:1"');
    expect((html.match(/data-kv-recomputed="mismatch"/g) ?? []).length).toBe(2);
    expect(h).toContain('MISMATCH at step 1 — every hash after it breaks.');
    expect(html).toMatch(/class="kv-state kv-state--error" role="alert" data-kv-summary/);
    expect(text(html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, ''))).not.toMatch(/flagged platform-wide/i);
  });
  it('v1: "written before version 2 — not recomputable from the stored record" — never a mismatch; the summary says so', async () => {
    C.verify = VERIFY({ v1Count: 1, events: [{ ...VERIFY().events[0], hashVersion: 1, recomputed: 'unverifiable_v1' }, VERIFY().events[1]] });
    const html = await render(); const h = text(html);
    expect(html).toContain('data-kv-recomputed="unverifiable_v1"'); expect(html).not.toContain('data-kv-recomputed="mismatch"');
    expect(h).toContain(en['store5b.verify.v1']);
    expect(h).toContain(en['store5b.verify.okWithV1'].replace('{n}', '1'));
  });
  it('not sealed: "Not yet sealed — the next seal runs daily"; no public ledger, no polygon, no block', async () => {
    C.verify = VERIFY({ anchor: { value: null, anchoredAt: null, anchoredEventCount: null, matchesHead: false } });
    const html = await render();
    expect(html).toContain('data-kv-seal="not_sealed"');
    expect(text(html)).toContain(en['store5b.verify.notSealed']);
    expect(text(html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, ''))).not.toMatch(/polygon|block \d|written to a public ledger/i);
    for (const k of store5bRefusalKeys('trace_verify')) expect(text(html)).toContain(en[k as keyof typeof en]);
  });
});
