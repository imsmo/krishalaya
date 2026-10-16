// apps/web-storefront/src/test-render/report-chain.render.test.tsx · PC-56 STORE-4b · C3 — the REPORT chain, canon W3109 → W3110 / W3111 (REAL):
//   • W3109 the confirm: the reasons FROM the platform vocabulary (`lookups.values('report_reason')` — labels from it), the sentence "hidden from
//     you pending review — the reporter is never shown", the key minted at render (`report:<uuid>`), Proceed / Cancel;
//   • W3110: the act posts the RENDERED key and the chosen code, then lands on the thread with ?status=reported;
//   • W3111: each failure by name (not found / your own / not a reason / switched off / server) — Retry carries the SAME key and the reason;
//   • the vocabulary unreadable → said, with a reload (never a guessed list); flag OFF → the sentence; block / safety desk / on-call refused.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store4b-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store4b-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import ReportPage from '../app/[tenantSlug]/messages/[id]/report/[messageId]/page';
import { reportMessageAction } from '../app/[tenantSlug]/messages/[id]/report/[messageId]/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, IDS } from './store4b-fixtures';
import { store4bRefusalKeys } from '../features/store4b/refusals';

const P = { tenantSlug: 'anand-fpo', id: IDS.order, messageId: IDS.m2 };
const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ReportPage({ params: P, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return 'no redirect'; } catch (e) { return String((e as Error).message); } };
const keyIn = (h: string) => (h.match(/name="key" value="(report:[0-9a-f-]{36})"/) ?? [])[1];
const KEY = 'report:0216abcd-0000-4000-8000-000000000001';
beforeEach(() => { reset(); });

describe('STORE-4b · W3109 the confirm', () => {
  it('the reasons from the vocabulary (codes + their labels), the sentence, the key minted at render, Proceed and Cancel', async () => {
    const h = await page();
    expect(C.calls.find((c) => c[0] === 'lookups.values')?.[1]).toBe('report_reason');
    for (const [code, name] of [['spam', 'Spam'], ['fraud', 'Fraud or scam'], ['harassment', 'Harassment']]) expect(h).toContain(`value="${code}" data-kv-reason="${code}">${name}</option>`);
    expect(text(h)).toContain(en['store4b.report.sentence']);
    expect(keyIn(h)).toMatch(/^report:[0-9a-f-]{36}$/);
    expect(keyIn(await page())).not.toBe(keyIn(h));
    expect(h).toContain('data-kv-act="proceed"');
    expect(h).toContain(`data-kv-cancel="true" href="/anand-fpo/messages/${IDS.order}"`);
    expect(h).toContain(`name="messageId" value="${IDS.m2}"`);
  });
  it('block, the safety desk and on-call paging are refused by name', async () => {
    const h = await page();
    for (const k of store4bRefusalKeys('report')) expect(text(h)).toContain(en[k as keyof typeof en]);
    expect(h).toContain('data-kv-refusal="block"');
  });
});

describe('STORE-4b · W3110 the report lands', () => {
  it('posts the RENDERED key and the chosen code → the thread with ?status=reported', async () => {
    const out = await redirectOf(reportMessageAction(form({ slug: 'anand-fpo', conversationId: IDS.order, messageId: IDS.m2, key: KEY, reason: 'fraud' })));
    expect(out).toBe(`REDIRECT /anand-fpo/messages/${IDS.order}?status=reported`);
    expect(C.calls.find((c) => c[0] === 'conversations.flagMessage')).toEqual(['conversations.flagMessage', IDS.m2, { reason: 'fraud' }, KEY]);
  });
});

describe('STORE-4b · W3111 failures by name, Retry with the SAME key', () => {
  const cases: Array<[SdkError, string]> = [
    [new SdkError('MESSAGE_NOT_FOUND', 404, 'nf'), 'not_found'],
    [new SdkError('MESSAGE_REPORT_OWN', 422, 'own'), 'own'],
    [new SdkError('MESSAGE_REPORT_REASON_UNKNOWN', 422, 'r'), 'reason'],
    [new SdkError('NOT_FOUND', 404, 'off'), 'off'],
    [new SdkError('UNAVAILABLE', 503, 'x'), 'server'],
  ];
  it.each(cases)('%s → ?failure=… with the key and the reason kept', async (err, failure) => {
    C.fail.flag = err;
    const out = await redirectOf(reportMessageAction(form({ slug: 'anand-fpo', conversationId: IDS.order, messageId: IDS.m2, key: KEY, reason: 'spam' })));
    expect(out).toBe(`REDIRECT /anand-fpo/messages/${IDS.order}/report/${IDS.m2}?failure=${failure}&key=${encodeURIComponent(KEY)}&reason=spam`);
    const h = await page({ failure, key: KEY, reason: 'spam' });
    expect(h).toContain(`data-kv-failure="${failure}"`);
    expect(text(h)).toContain(en[`store4b.report.failure.${failure}` as keyof typeof en]);
    expect(keyIn(h)).toBe(KEY);                                   // the SAME key on Retry
    expect(h).toContain('data-kv-act="retry"');
    expect(h).toMatch(/<option value="spam" data-kv-reason="spam" selected="">|<select[^>]*>[\s\S]*value="spam"/);
  });
  it('a forged key on the way back is not honoured (a fresh one is minted); a malformed reason never reaches the API', async () => {
    expect(keyIn(await page({ failure: 'server', key: 'report:not-a-uuid' }))).not.toBe('report:not-a-uuid');
    const out = await redirectOf(reportMessageAction(form({ slug: 'anand-fpo', conversationId: IDS.order, messageId: IDS.m2, key: KEY, reason: 'DROP TABLE' })));
    expect(out).toContain('failure=reason');
    expect(C.calls.some((c) => c[0] === 'conversations.flagMessage')).toBe(false);
  });
});

describe('STORE-4b · the report page\'s states', () => {
  it('the vocabulary unreadable → said, with a reload (never a guessed list); flag OFF → the sentence and no act', async () => {
    C.fail.reasons = new SdkError('UNAVAILABLE', 503, 'x');
    const e = await page();
    expect(e).toContain('data-kv-state="error"'); expect(e).toContain('data-kv-retry="reload"');
    expect(e).not.toContain('data-kv-form="report"');
    reset();
    C.flags = { ...C.flags, communication: false };
    const off = await page();
    expect(text(off)).toContain(en['store4b.messages.off']);
    expect(off).not.toContain('data-kv-form="report"');
  });
  it('a thread that is not the buyer\'s → notFound', async () => {
    await expect(ReportPage({ params: { ...P, id: '0216c000-0000-7000-8000-0000000000ff' }, searchParams: {} })).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
