// apps/web-storefront/src/test-render/notifications-hotfix6.render.test.tsx · PC-56 HOTFIX-6 · C3 (survey STORE-4 F-10) — the inbox's All tab.
// There was no notifications render test before this hotfix (the brief's "existing render test" did not exist — named in the report): this
// one pins that the All tab asks the SDK with `unreadOnly: false` (serialised to the strict 'false' the API now reads — pinned by the SDK's
// hotfix6 spec) and therefore lists READ rows too; the Unread tab asks `true` and lists unread only.
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

// PC-56 STORE-4c · C1 (founder Q13): the inbox moved under the organisation's chrome (/<slug>/notifications — the platform /notifications is a
// door now), so this pin is RETARGETED to that page; the rule it pins (the strict All / Unread boolean) is unchanged.
import NotificationsPage from '../app/[tenantSlug]/notifications/page';
import { text } from './store1b-harness';
import { C, reset } from './hotfix6-fixtures';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await NotificationsPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }));
beforeEach(() => { reset(); });

describe('HOTFIX-6 · C3 the inbox\'s All tab lists read rows', () => {
  it('All → `unreadOnly: false` sent, and the READ row is listed beside the unread one', async () => {
    const h = await page();
    expect(C.calls).toEqual([['notifications.inbox', { unreadOnly: false, cursor: undefined, limit: 30 }]]);
    expect(text(h)).toContain('Your order is placed');      // read
    expect(text(h)).toContain('Your order is confirmed');   // unread
    expect((h.match(/kv-notif__item--unread/g) ?? []).length).toBe(1);
  });
  it('Unread → `unreadOnly: true` sent; only the unread row', async () => {
    const h = await page({ unread: '1' });
    expect(C.calls[0]).toEqual(['notifications.inbox', { unreadOnly: true, cursor: undefined, limit: 30 }]);
    expect(text(h)).not.toContain('Your order is placed');
    expect(text(h)).toContain('Your order is confirmed');
  });
});
