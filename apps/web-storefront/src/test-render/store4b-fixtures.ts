// apps/web-storefront/src/test-render/store4b-fixtures.ts · PC-56 STORE-4b — the shared world of the messages list / thread / report chain /
// header render tests (not a test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS
// module, so the page under test and the test read the same mutable state `C`: the buyer's threads WITH THE ORGANISATION (as the API's buyer
// shape answers them — the organisation's name, the context label, `lastMessageFromYou`, `lastMessageHidden`, `lockKind`), one thread and its
// messages (a reported one served hidden), the `report_reason` vocabulary, the store's public flags, the session's store, and every SDK call.
// A name in `C.fail` makes that call throw the given SdkError.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const FARMER_UUID = '0216f000-0000-7000-8000-00000000f4a1';
export const IDS = Object.freeze({
  order: '0216c000-0000-7000-8000-000000000001', listing: '0216c000-0000-7000-8000-000000000002', locked: '0216c000-0000-7000-8000-000000000003',
  orderCtx: '0216e000-0000-7000-8000-000000000001', listingCtx: '0216e000-0000-7000-8000-000000000002',
  m1: '0216d000-0000-7000-8000-000000000001', m2: '0216d000-0000-7000-8000-000000000002', m3: '0216d000-0000-7000-8000-000000000003', m4: '0216d000-0000-7000-8000-000000000004',
});

export const C: {
  lang: string; threads: any[]; nextCursor: string | null; convo: any; messages: any[]; reasons: any[];
  flags: Record<string, boolean>; sessionFlags: Record<string, boolean>; storeSlug: string | null; calls: any[]; fail: Record<string, SdkError | undefined>;
} = {} as any;

const thread = (o: Record<string, unknown>) => ({
  id: IDS.order, contextType: 'order', contextId: IDS.orderCtx, isLocked: false, lockKind: null, createdAt: '2026-10-16T05:00:00.000Z',
  isArchived: false, unreadCount: 0, lastMessageAt: '2026-10-16T05:10:00.000Z', lastMessageBody: null, lastMessageHasAttachment: false, lastMessageHasVoice: false,
  lastMessageFromYou: false, lastMessageHidden: false, counterpartyName: 'Anand FPO', counterpartyRole: 'organisation', contextLabel: 'KV2026-0A1B2C3D', ...o,
});

export function reset(): void {
  Object.assign(C, {
    lang: 'en', nextCursor: null,
    threads: [
      // the order thread: the buyer wrote last ("You: …"), one unread
      thread({ id: IDS.order, lastMessageBody: 'Gate 2, tell the driver', lastMessageFromYou: true, unreadCount: 1 }),
      // a listing thread whose last message was REPORTED — the API blanked its body
      thread({ id: IDS.listing, contextType: 'listing', contextId: IDS.listingCtx, contextLabel: 'GG-20 Groundnut', lastMessageHidden: true, lastMessageBody: null }),
      // a thread locked by its dispute
      thread({ id: IDS.locked, isLocked: true, lockKind: 'dispute', lastMessageBody: 'Refund decided', contextLabel: 'KV2026-0FFFFFFF' }),
    ],
    convo: thread({ id: IDS.order, unreadCount: 1 }),
    // newest first, as the API answers: system · a REPORTED organisation message (served hidden) · a voice note · the buyer's own
    messages: [
      { id: IDS.m4, conversationId: IDS.order, from: 'system', body: 'Order confirmed', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false, hidden: false, createdAt: '2026-10-16T05:04:00.000Z' },
      { id: IDS.m3, conversationId: IDS.order, from: 'organisation', body: null, voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: true, hidden: true, createdAt: '2026-10-16T05:03:00.000Z' },
      { id: IDS.m2, conversationId: IDS.order, from: 'organisation', body: null, voiceMediaId: '0216b000-0000-7000-8000-0000000000aa', attachmentMediaId: null, isAiGenerated: false, isFlagged: false, hidden: false, createdAt: '2026-10-16T05:02:00.000Z' },
      { id: IDS.m1, conversationId: IDS.order, from: 'you', body: 'When can I collect?', voiceMediaId: null, attachmentMediaId: null, isAiGenerated: false, isFlagged: false, hidden: false, createdAt: '2026-10-16T05:01:00.000Z' },
    ],
    // the platform vocabulary (seed core/0005) — labels FROM the vocabulary
    reasons: [
      { id: 'lv-1', code: 'spam', name: 'Spam', sortOrder: 10, meta: {} },
      { id: 'lv-2', code: 'fraud', name: 'Fraud or scam', sortOrder: 20, meta: {} },
      { id: 'lv-5', code: 'harassment', name: 'Harassment', sortOrder: 50, meta: {} },
    ],
    flags: { communication: true, offers: true, auctions: false, group_lots: false, disputes: false },
    sessionFlags: { communication: false },
    storeSlug: 'anand-fpo',
    calls: [], fail: {},
  });
}
reset();

const boom = (name: string) => { const e = C.fail[name]; if (e) throw e; };
export function serverClient(): any {
  return {
    conversations: {
      list: async (q: any) => { C.calls.push(['conversations.list', q]); boom('list'); return { items: C.threads, nextCursor: C.nextCursor }; },
      get: async (id: string) => { C.calls.push(['conversations.get', id]); boom('get'); if (id !== C.convo.id) throw new SdkError('CONVERSATION_NOT_FOUND', 404, 'nf'); return C.convo; },
      listMessages: async (id: string, q: any) => { C.calls.push(['conversations.listMessages', id, q]); boom('messages'); return { items: C.messages, nextCursor: null }; },
      markRead: async () => ({ ok: true }),
      postMessage: async (id: string, input: any, key: string) => { C.calls.push(['conversations.postMessage', id, input, key]); boom('post'); return {}; },
      flagMessage: async (id: string, input: any, key: string) => { C.calls.push(['conversations.flagMessage', id, input, key]); boom('flag'); return {}; },
      openWithOrganisation: async (input: any, key: string) => { C.calls.push(['conversations.openWithOrganisation', input, key]); boom('open'); return { id: IDS.order }; },
    },
    maskedCalls: { initiate: async (input: any, key: string) => { C.calls.push(['maskedCalls.initiate', input, key]); return { id: 'call' }; } },
    storefront: { flags: async () => { C.calls.push(['storefront.flags']); boom('flags'); return C.flags; } },
    lookups: { values: async (type: string) => { C.calls.push(['lookups.values', type]); boom('reasons'); return C.reasons; } },
  };
}
export const publicClient = serverClient;
export function sessionTenantClient(): any {
  return { storefront: {
    flags: async () => { boom('sessionFlags'); return C.sessionFlags; },
    tenant: async () => { boom('storeSlug'); return { slug: C.storeSlug, displayName: 'Anand FPO', countryCode: 'IN' }; },
  } };
}
