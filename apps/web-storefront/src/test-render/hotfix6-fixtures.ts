// apps/web-storefront/src/test-render/hotfix6-fixtures.ts · PC-56 HOTFIX-6 — the shared world of the account address form, the conversation
// and the inbox render tests (not a test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories
// `require` THIS module, so the page under test and the test read the same mutable state `C`: the session store's country, the buyer's
// profile and addresses, one conversation in the BUYER's shape (the API's HOTFIX-6 answer), its messages, the inbox, and every SDK call made.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const FARMER_UUID = '0213a000-0000-7000-8000-00000000f4a1';
export const CONVO = '0213c000-0000-7000-8000-000000000001';
export const ADDR = Object.freeze({ home: '0213d000-0000-7000-8000-000000000001', shop: '0213d000-0000-7000-8000-000000000002' });
export const RECEIVER_PHONE = '+919898012742';

export const C: {
  lang: string; storeCountry: string | null; storeFails: boolean; me: any; addresses: any[]; convo: any; messages: any[]; inbox: any[];
  calls: any[]; cookies: Map<string, string>;
} = {} as any;

export function reset(): void {
  Object.assign(C, {
    lang: 'en', storeCountry: 'GB', storeFails: false,
    me: { id: '0213b000-0000-7000-8000-0000000000b1', displayName: null, roles: [], locale: 'en', fullName: 'Asha', phone: '+91 98••• ••742', email: 'a***@x.in' },
    addresses: [
      { id: ADDR.home, line1: '14 Mill Lane', line2: null, village: 'Wembley', pincode: '12345', countryCode: 'GB', contactName: 'Asha', contactPhone: RECEIVER_PHONE, isDefault: true },
      { id: ADDR.shop, line1: 'Plot 14, GIDC', line2: null, village: null, pincode: '382330', countryCode: 'IN', contactName: null, contactPhone: null, isDefault: false },
    ],
    // the API's BUYER shape (HOTFIX-6 B2): the organisation's name, a party label, the order number — no counterpartyUserId, no person
    convo: { id: CONVO, contextType: 'order', contextId: '0213e000-0000-7000-8000-000000000001', isLocked: false, createdAt: '2026-10-16T05:00:00.000Z',
      isArchived: false, unreadCount: 1, lastMessageAt: null, lastMessageBody: null, lastMessageHasAttachment: false, lastMessageHasVoice: false,
      counterpartyName: 'Anand FPO', counterpartyRole: 'organisation', contextLabel: 'KV2026-0A1B2C3D' },
    // newest first, as the API answers
    messages: [
      { id: 'm3', conversationId: CONVO, from: 'system', body: 'Order confirmed', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false, createdAt: '2026-10-16T05:03:00.000Z' },
      { id: 'm2', conversationId: CONVO, from: 'organisation', body: 'Ready on Thursday', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false, createdAt: '2026-10-16T05:02:00.000Z' },
      { id: 'm1', conversationId: CONVO, from: 'you', body: 'When can I collect?', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false, createdAt: '2026-10-16T05:01:00.000Z' },
    ],
    inbox: [
      { id: 'n1', eventCode: 'order.created', status: 'read', readAt: '2026-10-16T05:10:00.000Z', payload: { title: 'Your order is placed' }, createdAt: '2026-10-16T05:00:00.000Z' },
      { id: 'n2', eventCode: 'order.confirmed', status: 'sent', readAt: null, payload: { title: 'Your order is confirmed' }, createdAt: '2026-10-16T05:05:00.000Z' },
    ],
    calls: [], cookies: new Map(),
  });
}
reset();

export function serverClient(): any {
  return {
    auth: { me: async () => C.me },
    users: { updateMe: async (p: any) => { C.calls.push(['users.updateMe', p]); return C.me; } },
    addresses: {
      list: async () => C.addresses,
      create: async (input: any, key?: string) => { C.calls.push(['addresses.create', input, key]); return { id: 'new' }; },
      update: async (id: string, p: any) => { C.calls.push(['addresses.update', id, p]); return { id, ok: true, copied: false, previousId: null }; },
      remove: async (id: string) => { C.calls.push(['addresses.remove', id]); return { ok: true, defaultId: null }; },
    },
    conversations: {
      get: async (id: string) => { C.calls.push(['conversations.get', id]); if (id !== C.convo.id) throw new SdkError('CONVERSATION_NOT_FOUND', 404, 'nf'); return C.convo; },
      listMessages: async (id: string, q: any) => { C.calls.push(['conversations.listMessages', id, q]); return { items: C.messages, nextCursor: null }; },
      markRead: async () => ({ ok: true }),
      postMessage: async (id: string, input: any, key: string) => { C.calls.push(['conversations.postMessage', id, input, key]); return {}; },
    },
    maskedCalls: { initiate: async (input: any, key: string) => { C.calls.push(['maskedCalls.initiate', input, key]); return { id: 'call' }; } },
    notifications: {
      // the API's HOTFIX-6 reading: `unreadOnly: false` (the All tab) answers read AND unread; `true` answers unread only
      inbox: async (q: any) => { C.calls.push(['notifications.inbox', q]); return { items: q.unreadOnly === true ? C.inbox.filter((n) => !n.readAt) : C.inbox, nextCursor: null }; },
    },
  };
}
export function sessionTenantClient(): any {
  return { storefront: { tenant: async () => { if (C.storeFails) throw new SdkError('UNAVAILABLE', 503, 'down'); return { slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: C.storeCountry }; } } };
}
export const publicClient = serverClient;
export function cookieJar(): any {
  return { get: (k: string) => (C.cookies.has(k) ? { name: k, value: C.cookies.get(k) } : undefined), set: (k: string, v: string) => { C.cookies.set(k, v); }, delete: (k: string) => { C.cookies.delete(k); } };
}
