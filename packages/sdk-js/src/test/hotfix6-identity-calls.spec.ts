// @krishalaya/sdk-js · PC-56 HOTFIX-6 — the contract this hotfix touches, pinned with an injected fake fetch (no network):
//   B5 consents reach `/v1/consents` (the dead `privacy/consents` path is gone) — list and set, the set under the caller's key;
//   B1 a masked call names a CONVERSATION and nothing else (no callee, no context from the client), under the caller's key;
//   B6 the inbox's `unreadOnly` and the conversations' `archived` travel as the strict strings ('true' / 'false');
//   B3/B4/B7 the address book's create/update carry `countryCode`, an optional key, and the copy-on-write answer.
import { createClient } from '../client';
import { CONSENTS_PATH } from '../resources/privacy';
import type { ConsentRecord, AddressWriteResult, MaskedCallStarted, Message, MessageFrom, UserProfile } from '../types';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call); const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });
const path = (c: Call) => new URL(c.url).pathname;

describe('PC-56 HOTFIX-6 · SDK consents (B5)', () => {
  it('listConsents GETs /v1/consents and returns the API\'s camelCase rows', async () => {
    const rows: ConsentRecord[] = [{ purposeCode: 'marketing', granted: false, version: 'v1', channel: 'web', updatedAt: '2026-10-16T05:00:00.000Z' }];
    const { fn, calls } = fakeFetch(() => ({ body: { data: rows } }));
    expect(await client(fn).privacy.listConsents()).toEqual(rows);
    expect([calls[0].init.method, path(calls[0])]).toEqual(['GET', '/v1/consents']);
    expect(CONSENTS_PATH).toBe('consents');
  });
  it('setConsent POSTs the decision to /v1/consents under the caller\'s key — a withdrawal is `granted: false`', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { data: { ok: true, version: 'v1' } } }));
    expect(await client(fn).privacy.setConsent('marketing', false, 'k-consent-1')).toEqual({ ok: true, version: 'v1' });
    expect([calls[0].init.method, path(calls[0]), hdr(calls[0])['idempotency-key'], JSON.parse(String(calls[0].init.body))])
      .toEqual(['POST', '/v1/consents', 'k-consent-1', { purposeCode: 'marketing', granted: false }]);
    expect(calls.some((c) => c.url.includes('privacy/consents'))).toBe(false);
  });
});

describe('PC-56 HOTFIX-6 · SDK masked calls (B1, founder D2)', () => {
  it('initiate sends ONLY the conversation id, under the key; the answer names no person', async () => {
    const started: MaskedCallStarted = { id: 'call-1', conversationId: 'c-1', contextType: 'order', contextId: 'o-1' };
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { data: started } }));
    // a caller that still tries to smuggle a callee is stripped by the resource (and refused by the API's .strict() schema)
    const smuggled = { conversationId: 'c-1', calleeUserId: 'u-farmer' } as unknown as { conversationId: string };
    expect(await client(fn).maskedCalls.initiate(smuggled, 'k-call-1')).toEqual(started);
    expect([path(calls[0]), hdr(calls[0])['idempotency-key'], JSON.parse(String(calls[0].init.body))]).toEqual(['/v1/masked-calls', 'k-call-1', { conversationId: 'c-1' }]);
    expect(Object.keys(started)).not.toContain('calleeUserId');
  });
});

describe('PC-56 HOTFIX-6 · SDK strict query booleans (B6 / C3)', () => {
  it('inbox: unreadOnly false → "false" (the All tab), true → "true", omitted → absent', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [], meta: { nextCursor: null } } }));
    await client(fn).notifications.inbox({ unreadOnly: false });
    await client(fn).notifications.inbox({ unreadOnly: true });
    await client(fn).notifications.inbox({});
    expect(calls.map((c) => new URL(c.url).searchParams.get('unreadOnly'))).toEqual(['false', 'true', null]);
  });
  it('conversations: archived false → "false", true → "true", omitted → absent', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [], meta: { nextCursor: null } } }));
    await client(fn).conversations.list({ archived: false });
    await client(fn).conversations.list({ archived: true });
    await client(fn).conversations.list();
    expect(calls.map((c) => new URL(c.url).searchParams.get('archived'))).toEqual(['false', 'true', null]);
  });
});

describe('PC-56 HOTFIX-6 · SDK address book (B3 / B4 / B7)', () => {
  it('create carries countryCode and the optional key; without a key no header is sent', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { data: { id: 'a-1' } } }));
    await client(fn).addresses.create({ line1: '14 Mill Lane', pincode: '12345', countryCode: 'GB' }, 'k-addr-1');
    await client(fn).addresses.create({ line1: '14 Mill Lane', pincode: '12345', countryCode: 'GB' });
    expect([hdr(calls[0])['idempotency-key'], JSON.parse(String(calls[0].init.body)).countryCode]).toEqual(['k-addr-1', 'GB']);
    expect(hdr(calls[1])['idempotency-key']).toBeUndefined();
  });
  it('update PATCHes the patch (country editable) under the key and returns the copy-on-write answer', async () => {
    const answer: AddressWriteResult = { ok: true, id: 'a-2', copied: true, previousId: 'a-1' };
    const { fn, calls } = fakeFetch(() => ({ body: { data: answer } }));
    const r = await client(fn).addresses.update('a-1', { line1: 'Gate 2, Plot 14', countryCode: 'IN' }, 'k-edit-1');
    expect([r.id, r.copied, r.previousId]).toEqual(['a-2', true, 'a-1']);
    expect([calls[0].init.method, path(calls[0]), hdr(calls[0])['idempotency-key'], JSON.parse(String(calls[0].init.body))])
      .toEqual(['PATCH', '/v1/addresses/a-1', 'k-edit-1', { line1: 'Gate 2, Plot 14', countryCode: 'IN' }]);
  });
  it('remove answers the default the server promoted', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: { ok: true, defaultId: 'a-3' } } }));
    expect(await client(fn).addresses.remove('a-1')).toEqual({ ok: true, defaultId: 'a-3' });
  });
});

describe('PC-56 HOTFIX-6 · type-level contract (B7): new fields optional, the buyer message shape names no person', () => {
  it('a buyer message type-checks with `from` and no senderUserId; a profile with the masked fields and without them', () => {
    const from: MessageFrom = 'organisation';
    const m: Message = { id: 'm-1', conversationId: 'c-1', from, body: 'Ready Thursday', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false };
    const bare: UserProfile = { id: 'u-1', displayName: null, roles: [], locale: 'en' };
    const full: UserProfile = { ...bare, fullName: 'Asha', phone: '+91 98••• ••742', email: 'a***@x.in', countryCode: 'IN' };
    expect([m.senderUserId, m.from, bare.phone, full.phone]).toEqual([undefined, 'organisation', undefined, '+91 98••• ••742']);
  });
});
