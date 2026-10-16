// apps/web-storefront/src/test-render/message-thread-hotfix6.render.test.tsx · PC-56 HOTFIX-6 · C2 (survey STORE-4 F-1 / F-2, founder D2) —
// the conversation page under the buyer's shape:
//   • NO person id in the DOM (no hidden callee input, no uuid anywhere) and NO Call button / call form;
//   • the other side is the ORGANISATION ("Conversation with Anand FPO"); the order number as the context;
//   • every message labelled by `from` (You · the organisation's name · System) — never "Them", never a sender id;
//   • "Call" refused BY NAME through the store4 registry (RefusalList surface `thread`);
//   • a page that is not the buyer's → notFound; the thread's actions export no call act.
// PC-56 STORE-4b · C2: the thread now lives under the organisation's chrome (/<slug>/messages/[id]; the platform route is a door) — these
// HOTFIX-6 guarantees are re-asserted against THAT page and its actions. Its DOM now also carries the order's id (the "Open order" link) and the
// composer's key nonce (minted at render) — neither is a person; the person-uuid guarantee is unchanged.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./hotfix6-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./hotfix6-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./hotfix6-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import ThreadPage from '../app/[tenantSlug]/messages/[id]/page';
import * as threadActions from '../app/[tenantSlug]/messages/[id]/actions';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text } from './store1b-harness';
import { C, reset, CONVO, FARMER_UUID } from './hotfix6-fixtures';
import { STORE4_HOTFIX6_REFUSALS, store4RefusalKeys } from '../features/store4/refusals';

const page = async (id = CONVO, sp: Record<string, string> = {}) => renderToStaticMarkup(await ThreadPage({ params: { tenantSlug: 'anand-fpo', id }, searchParams: sp }));
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
beforeEach(() => { reset(); });

describe('HOTFIX-6 · C2 the conversation names the organisation, never a person', () => {
  it('no person uuid in the DOM — the only uuid printed is the conversation\'s own; no callee input', async () => {
    // even if a (pre-HOTFIX-6) API still served a sender id, the page reads none
    C.messages = C.messages.map((m) => (m.from === 'organisation' ? { ...m, senderUserId: FARMER_UUID } : m));
    const h = await page();
    expect(h).not.toContain(FARMER_UUID);
    expect(h).not.toContain('calleeUserId');
    const nonce = ((h.match(/name="key" value="send:([0-9a-f-]{36})"/) ?? [])[1] ?? '').toLowerCase();
    expect(new Set((h.match(UUID_RE) ?? []).map((u) => u.toLowerCase()))).toEqual(new Set([CONVO, C.convo.contextId, nonce]));   // STORE-4b: + the order link, the key
  });
  it('no Call button and no call form; the thread actions export no call act and the SDK is never asked to call', async () => {
    const h = await page();
    expect(h).not.toContain('kv-thread__call');
    expect(text(h)).not.toMatch(/Call \(|number stays private/);
    expect(Object.keys(threadActions)).toEqual(['postMessageAction']);
    expect(C.calls.some((c) => c[0] === 'maskedCalls.initiate')).toBe(false);
  });
  it('the organisation is named in the heading; the order number is the context', async () => {
    const h = await page();
    expect(text(h)).toContain('Conversation with Anand FPO');
    expect(h).toContain('data-kv-context="order"');
    expect(text(h)).toContain('Order KV2026-0A1B2C3D');
  });
  it('messages labelled by `from`: You · the organisation · System — oldest first; never "Them"', async () => {
    const h = await page();
    expect(h).toMatch(/data-kv-from="you".*data-kv-from="organisation".*data-kv-from="system"/s);
    expect(text(h)).toMatch(/You When can I collect\?.*Anand FPO Ready on Thursday.*System Order confirmed/s);
    expect(text(h)).not.toContain(en['messages.them']);
    expect(h).toMatch(/class="kv-msg kv-msg--mine" data-kv-from="you"/);
  });
  it('a platform message is "Platform support"; with no organisation name the label falls back to "The organisation"', async () => {
    C.convo = { ...C.convo, counterpartyName: null, counterpartyRole: 'platform' };
    C.messages = [{ ...C.messages[1], from: 'platform' }, { ...C.messages[2], id: 'm4', from: 'organisation' }];
    const h = await page();
    expect(text(h)).toContain(en['store4.from.platform']);
    expect(text(h)).toContain(en['store4.from.organisation']);
    expect(text(h)).toContain(en['messages.threadTitle']);
  });
  it('"Call" is refused BY NAME through the store4 registry (en and hi)', async () => {
    expect(STORE4_HOTFIX6_REFUSALS.map((r) => r.id)).toEqual(['call']);
    const h = await page();
    expect(h).toContain('data-kv-refused="thread"');
    expect(h).toContain('data-kv-refusal="call"');
    for (const k of store4RefusalKeys('thread')) expect(text(h)).toContain(en[k as keyof typeof en]);
    C.lang = 'hi';
    expect(text(await page())).toContain(hi['store4.refusal.call']);
  });
  it('a thread that is not the buyer\'s → notFound', async () => {
    await expect(page('0213c000-0000-7000-8000-0000000000ff')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
