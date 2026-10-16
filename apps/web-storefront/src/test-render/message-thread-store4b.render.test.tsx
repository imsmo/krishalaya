// apps/web-storefront/src/test-render/message-thread-store4b.render.test.tsx · PC-56 STORE-4b · C2 — canon W298 under the organisation's chrome:
//   • the ORGANISATION's name in the header; the context strip with "Open order" (→ /<slug>/orders/[id]) or the listing's title + its link;
//   • messages by `from`; a REPORTED message prints "hidden pending review" (no body); a voice note its label (playback refused by name);
//   • the composer's key MINTED AT RENDER (`send:<uuid>`) and the action posts THAT key — a retry of the same form posts the same key;
//   • a locked thread: "Readable forever, writable never" + the kind's sentence, no composer; the post failure names the lock's kind;
//   • ⋮ "Report" only on another party's visible message; the refusals by name (call, block, translation, transcript, AI, KYC, mic, …);
//   • NO uuid in the DOM but the thread's, the messages', the context's and the key nonces (never a person's); flag OFF → the sentence, no
//     API call; a thread that is not the buyer's → notFound; the platform /messages/[id] is a door carrying the id.
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

import ThreadPage from '../app/[tenantSlug]/messages/[id]/page';
import * as threadActions from '../app/[tenantSlug]/messages/[id]/actions';
import { openOrganisationThreadAction } from '../app/[tenantSlug]/messages/actions';
import PlatformThreadDoor from '../app/(platform)/messages/[id]/page';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text } from './store1b-harness';
import { C, reset, IDS, FARMER_UUID } from './store4b-fixtures';
import { store4bRefusalKeys } from '../features/store4b/refusals';
import { store4RefusalKeys } from '../features/store4/refusals';

const page = async (sp: Record<string, string> = {}, id: string = IDS.order) => renderToStaticMarkup(await ThreadPage({ params: { tenantSlug: 'anand-fpo', id }, searchParams: sp }));
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const redirectOf = async (p: Promise<unknown>) => { try { await p; return 'no redirect'; } catch (e) { return String((e as Error).message); } };
const keyIn = (h: string) => (h.match(/name="key" value="(send:[0-9a-f-]{36})"/) ?? [])[1];
beforeEach(() => { reset(); });

describe('STORE-4b · W298 the organisation, the context', () => {
  it('the header names the ORGANISATION; the order strip links to THIS store\'s order', async () => {
    const h = await page();
    expect(text(h)).toContain('Conversation with Anand FPO');
    expect(h).toContain('data-kv-context="order"');
    expect(text(h)).toContain('Order KV2026-0A1B2C3D');
    expect(h).toContain(`data-kv-context-link="order" href="/anand-fpo/orders/${IDS.orderCtx}"`);
    expect(text(h)).not.toMatch(/KYC/);
  });
  it('a listing thread: the listing\'s title + "Open listing" → /<slug>/listings/[id]', async () => {
    C.convo = { ...C.convo, contextType: 'listing', contextId: IDS.listingCtx, contextLabel: 'GG-20 Groundnut' };
    const h = await page();
    expect(text(h)).toContain('Listing · GG-20 Groundnut');
    expect(h).toContain(`data-kv-context-link="listing" href="/anand-fpo/listings/${IDS.listingCtx}"`);
  });
  it('no person uuid in the DOM — the thread, the messages, the context and the key nonce only', async () => {
    C.messages = C.messages.map((m) => (m.from === 'organisation' ? { ...m, senderUserId: FARMER_UUID } : m));
    const h = await page();
    expect(h).not.toContain(FARMER_UUID);
    const nonce = keyIn(h)!.slice(5);
    const allowed = new Set([IDS.order, IDS.orderCtx, IDS.m1, IDS.m2, IDS.m3, IDS.m4, nonce]);
    for (const u of new Set((h.match(UUID_RE) ?? []).map((x) => x.toLowerCase()))) expect([u, allowed.has(u)]).toEqual([u, true]);
    expect(h).not.toContain('0216b000-0000-7000-8000-0000000000aa');   // the voice note's media id is never printed either
  });
});

describe('STORE-4b · W298 the messages', () => {
  it('by `from`, oldest first: You · the organisation · System; a REPORTED message prints "hidden pending review", never a body', async () => {
    const h = await page();
    expect(h).toMatch(/data-kv-from="you".*data-kv-from="organisation".*data-kv-from="organisation".*data-kv-from="system"/s);
    expect(h).toContain('data-kv-body="hidden"');
    expect(text(h)).toContain(en['store4b.thread.hidden']);
  });
  it('a voice note prints its label (playback refused by name — the download link is the uploader\'s only)', async () => {
    const h = await page();
    expect(h).toContain('data-kv-body="voice"');
    expect(text(h)).toContain(en['messages.voiceMessage']);
    expect(h).not.toContain('<audio');
    expect(h).toContain('data-kv-refusal="voice_playback"');
  });
  it('⋮ Report only on another party\'s visible message — never your own, never one already hidden', async () => {
    const h = await page();
    expect(h).toContain(`href="/anand-fpo/messages/${IDS.order}/report/${IDS.m2}"`);
    expect(h).toContain(`href="/anand-fpo/messages/${IDS.order}/report/${IDS.m4}"`);
    expect(h).not.toContain(`/report/${IDS.m1}`);
    expect(h).not.toContain(`/report/${IDS.m3}`);
  });
});

describe('STORE-4b · W298 the composer (the key minted at render)', () => {
  it('a hidden `send:<uuid>` per render; the action posts THAT key; the same form again posts the same key (a retry after a timeout is ONE message)', async () => {
    const a = await page(); const b = await page();
    const k = keyIn(a)!;
    expect(k).toMatch(/^send:[0-9a-f-]{36}$/);
    expect(keyIn(b)).not.toBe(k);
    const fd = form({ slug: 'anand-fpo', conversationId: IDS.order, key: k, body: 'Thursday is fine' });
    expect(await redirectOf(threadActions.postMessageAction(fd))).toBe(`REDIRECT /anand-fpo/messages/${IDS.order}?status=sent`);
    expect(await redirectOf(threadActions.postMessageAction(fd))).toBe(`REDIRECT /anand-fpo/messages/${IDS.order}?status=sent`);
    const posts = C.calls.filter((c) => c[0] === 'conversations.postMessage');
    expect(posts.map((p) => p[3])).toEqual([k, k]);
    expect(Object.keys(threadActions)).toEqual(['postMessageAction']);
    expect(C.calls.some((c) => c[0] === 'maskedCalls.initiate')).toBe(false);
  });
  it('no key → never posted; a locked thread → ?status=senderr&code=lock_dispute, said as the dispute sentence', async () => {
    expect(await redirectOf(threadActions.postMessageAction(form({ slug: 'anand-fpo', conversationId: IDS.order, body: 'x' })))).toContain('status=senderr');
    expect(C.calls.some((c) => c[0] === 'conversations.postMessage')).toBe(false);
    C.fail.post = new SdkError('CONVERSATION_LOCKED', 409, 'locked', undefined, { lockKind: 'dispute' });
    expect(await redirectOf(threadActions.postMessageAction(form({ slug: 'anand-fpo', conversationId: IDS.order, key: `send:${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, body: 'x' }))))
      .toBe(`REDIRECT /anand-fpo/messages/${IDS.order}?status=senderr&code=lock_dispute`);
    expect(text(await page({ status: 'senderr', code: 'lock_dispute' }))).toContain(en['store4b.lock.sentence.dispute']);
    expect(text(await page({ status: 'senderr', code: 'server' }))).toContain(en['store4b.thread.sendFailure.server']);
  });
  it('a locked thread: "Readable forever, writable never" + the kind\'s sentence; no composer; no Report links', async () => {
    C.convo = { ...C.convo, isLocked: true, lockKind: 'dispute' };
    const h = await page();
    expect(h).toContain('data-kv-state="locked" data-kv-lock="dispute"');
    expect(text(h)).toContain(en['store4b.thread.lockedTitle']);
    expect(text(h)).toContain(en['store4b.lock.sentence.dispute']);
    expect(h).not.toContain('data-kv-form="send"');
    expect(h).not.toContain('/report/');
    C.convo = { ...C.convo, lockKind: 'moderator' };
    expect(text(await page())).toContain(en['store4b.lock.sentence.moderator']);
  });
  it('W3110 on the thread: "Reported — hidden from you pending review"; ?status=sent → "Sent."', async () => {
    expect(text(await page({ status: 'reported' }))).toContain(en['store4b.report.success']);
    expect(text(await page({ status: 'sent' }))).toContain(en['store4b.thread.sent']);
  });
});

describe('STORE-4b · the entry act (C4)', () => {
  it('"Message the organisation" posts the RENDERED key with the context, then opens the thread; a failure lands on the list by name', async () => {
    const fd = form({ slug: 'anand-fpo', contextType: 'order', contextId: IDS.orderCtx, key: 'openorg:0216aaaa-0000-4000-8000-000000000001' });
    expect(await redirectOf(openOrganisationThreadAction(fd))).toBe(`REDIRECT /anand-fpo/messages/${IDS.order}`);
    expect(C.calls.find((c) => c[0] === 'conversations.openWithOrganisation')).toEqual(['conversations.openWithOrganisation', { contextType: 'order', contextId: IDS.orderCtx }, 'openorg:0216aaaa-0000-4000-8000-000000000001']);
    C.fail.open = new SdkError('CONVERSATION_CONTEXT_NOT_FOUND', 404, 'nf');
    expect(await redirectOf(openOrganisationThreadAction(fd))).toBe('REDIRECT /anand-fpo/messages?failure=open&code=context');
    C.fail.open = new SdkError('CONVERSATION_NO_RESPONDER', 422, 'x');
    expect(await redirectOf(openOrganisationThreadAction(fd))).toBe('REDIRECT /anand-fpo/messages?failure=open&code=no_responder');
    expect(await redirectOf(openOrganisationThreadAction(form({ slug: 'anand-fpo', contextType: 'direct', contextId: IDS.orderCtx, key: 'openorg:0216aaaa-0000-4000-8000-000000000001' }))))
      .toBe('REDIRECT /anand-fpo/messages?failure=open&code=context');
  });
});

describe('STORE-4b · W298 the refusals, the flag, the door', () => {
  it('the refusals by name — call (HOTFIX-6) and every STORE-4b thread refusal; in Hindi too', async () => {
    const h = await page();
    expect(h).toContain('data-kv-refused="thread"');
    for (const k of [...store4RefusalKeys('thread'), ...store4bRefusalKeys('thread')]) expect(text(h)).toContain(en[k as keyof typeof en]);
    for (const id of ['call', 'block', 'translation', 'transcript', 'ai', 'kyc', 'mic', 'read_receipts', 'offline_queue']) expect(h).toContain(`data-kv-refusal="${id}"`);
    C.lang = 'hi';
    expect(text(await page())).toContain(hi['store4b.refusal.translation']);
  });
  it('`communication` OFF → the sentence and no conversation read; a thread that is not the buyer\'s → notFound', async () => {
    C.flags = { ...C.flags, communication: false };
    const h = await page();
    expect(text(h)).toContain(en['store4b.messages.off']);
    expect(C.calls.some((c) => c[0] === 'conversations.get')).toBe(false);
    reset();
    await expect(page({}, '0216c000-0000-7000-8000-0000000000ff')).rejects.toThrow('NEXT_NOT_FOUND');
    C.fail.get = new SdkError('UNAVAILABLE', 503, 'x');
    const e = await page();
    expect(e).toContain('data-kv-state="error"'); expect(e).toContain('data-kv-retry="reload"');
  });
  it('the platform /messages/[id] → /<slug>/messages/[id] (the id carried)', async () => {
    await expect(PlatformThreadDoor({ params: { id: IDS.order }, searchParams: {} })).rejects.toThrow(`REDIRECT /anand-fpo/messages/${IDS.order}`);
  });
});
