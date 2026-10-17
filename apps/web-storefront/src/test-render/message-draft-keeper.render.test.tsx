// apps/web-storefront/src/test-render/message-draft-keeper.render.test.tsx · PC-56 STORE-6b · D4 / C3 — THE THREAD COMPOSER KEEPS YOUR WORDS ON THIS
// PHONE (canon W298's "saved on this phone" half TRUE; "sends when signal returns" still refused):
//   • the composer mounts the keeper INSIDE its form — kind `message`, ref = THIS conversation, the field `body` only; the hidden slug /
//     conversationId / key stay the form's; the key is still MINTED AT THIS RENDER (keyed-at-render kept); no keeper on a locked thread;
//   • the success render (`?status=sent`) mounts `DraftDone` for this conversation (the draft that was sent goes); no other render does;
//   • the keeper's view: the honest line ("kept on this phone as you type, sent only when you press Send") + On this phone, "Restored from this
//     phone · <age>", the 7-day question, the missing-draft line — and nothing at all in the server's HTML before the phone answers;
//   • the 4b `offline_queue` refusal reworded: kept on this phone — TRUE; sent by itself — refused.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store4b-fixtures'); return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient }; });
jest.mock('server-only', () => ({}), { virtual: true });

import ThreadPage from '../app/[tenantSlug]/messages/[id]/page';
import { DraftKeeperView, type KeeperLabels } from '../components/drafts/DraftKeeper';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, IDS } from './store4b-fixtures';

beforeEach(() => reset());
const page = async (sp: Record<string, string> = {}, id: string = IDS.order) => renderToStaticMarkup(await ThreadPage({ params: { tenantSlug: 'anand-fpo', id }, searchParams: sp }));
const formOf = (h: string) => (h.match(/<form[^>]*data-kv-form="send"[\s\S]*?<\/form>/) ?? [''])[0];

describe('STORE-6b · the composer mounts the keeper', () => {
  it('INSIDE the send form: kind message, ref = this conversation; the form keeps its own hidden fields and its render-minted key', async () => {
    const h = await page(); const f = formOf(h);
    expect(f).toContain('data-kv-draft-keeper="message"');
    expect(f).toContain(`data-kv-draft-state="idle" data-kv-draft-kind="message" data-kv-draft-ref="${IDS.order}"`);
    expect(f).toMatch(/name="key" value="send:[0-9a-f-]{36}"/);
    expect(f).toContain('name="body"');
    expect(f).not.toContain('data-kv-draft-note');                     // nothing in the server's HTML before the phone answers
    expect(text(f)).not.toContain(en['store6b.keeper.kept']);
  });
  it('a locked thread has no composer — and no keeper', async () => {
    C.convo = { ...C.convo, isLocked: true, lockKind: 'dispute' };
    expect(await page()).not.toContain('data-kv-draft-keeper');
  });
  it('the success render (?status=sent) mounts DraftDone for THIS conversation; no other render does', async () => {
    const ok = await page({ status: 'sent' });
    expect(ok).toContain(`data-kv-draft-done="" data-kv-draft-kind="message" data-kv-draft-ref="${IDS.order}"`);
    for (const sp of [{}, { status: 'senderr', code: 'server' }, { status: 'reported' }] as Record<string, string>[]) expect(await page(sp)).not.toContain('data-kv-draft-done');
  });
  it('the 4b offline_queue refusal says the truth: kept on this phone, sent only when you press Send', async () => {
    const w = text(await page());
    expect(w).toContain(en['store4b.refusal.offlineQueue']);
    expect(en['store4b.refusal.offlineQueue']).toMatch(/kept on this phone/); expect(en['store4b.refusal.offlineQueue']).toMatch(/no message is queued to send by itself/);
  });
});

describe('STORE-6b · the keeper\'s words', () => {
  const L: KeeperLabels = {
    kept: en['store6b.keeper.kept'], restored: en['store6b.keeper.restored'], ask: en['store6b.keeper.ask'].replace('{days}', '7'), missing: en['store6b.keeper.missing'],
    link: en['store6b.keeper.link'], syncHref: '/anand-fpo/sync', now: 'just now', minutes: '{n} min ago', hours: '{n} h ago', days: '{n} d ago',
  };
  const v = (state: Parameters<typeof DraftKeeperView>[0]['state'], note: Parameters<typeof DraftKeeperView>[0]['note'] = null) =>
    renderToStaticMarkup(<DraftKeeperView kind="message" refId={IDS.order} state={state} note={note} labels={L} />);
  it('empty: the honest line + On this phone; restored: "Restored from this phone · <age>"; 7 days: the question; a gone draft: said', () => {
    expect(text(v('empty'))).toContain('Your words are kept on this phone as you type, and sent only when you press Send.');
    expect(v('empty')).toContain('href="/anand-fpo/sync"');
    expect(text(v('restored', { restored: '2 h ago' }))).toContain('Restored from this phone · 2 h ago.');
    expect(v('restored', { restored: '8 d ago', ask: true })).toContain('data-kv-draft-ask');
    expect(text(v('restored', { restored: '8 d ago', ask: true }))).toContain('This draft is 7 days old or more — still want to send it?');
    expect(text(v('empty', { missing: true }))).toContain(en['store6b.keeper.missing']);
  });
  it('off (no owner marker) and done (the success render): nothing shown but the hidden state', () => {
    for (const s of ['off', 'done', 'idle'] as const) {
      expect(v(s)).not.toContain('data-kv-draft-note');
      expect(v(s)).toContain(`data-kv-draft-state="${s}"`);
    }
  });
});
