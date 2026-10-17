// apps/web-storefront/src/test-render/rtl-store6b.render.test.tsx · PC-56 STORE-6b · C5 — "On this phone" (both chromes, each chain state), its list
// (rows, the question, the confirm), the keeper's line, the chip, the install sheet (each state) and the `/app` invitation section under
// dir="rtl" carry no PHYSICAL-direction class or inline style and no bare arrow outside .kv-dir-flip (store1b-harness). In Hindi and Gujarati too.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
import PlatformSync from '../app/(platform)/sync/page';
import TenantSync from '../app/[tenantSlug]/sync/page';
import TenantApp from '../app/[tenantSlug]/app/page';
import { SyncListView } from '../components/sync/SyncList';
import { DraftKeeperView } from '../components/drafts/DraftKeeper';
import { DraftsChipView } from '../components/drafts/DraftsChip';
import { InstallSheetView } from '../components/install/InstallInvite';
import { InstallStatusView } from '../components/install/InstallStatus';
import { PLATFORM_CHROME, tenantChrome } from '../features/store4a/account';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { C, SLUG, reset, withCookies } from './store6a-fixtures';
import { phone, SYNC_LABELS, NOW } from './store6b-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
const ID = 'd_msg0000000000000000000';
const IL = { title: 'Add {name}?', body: 'b', add: 'Add', notNow: 'Not now', added: 'Added {name}', notAdded: 'Not added', close: 'Close', appLink: 'App page', label: 'l' };
const KL = { kept: 'k', restored: 'r {age}', ask: 'a', missing: 'm', link: 'On this phone', syncHref: '/x/sync', now: 'n', minutes: '{n} m', hours: '{n} h', days: '{n} d' };
const STATES: Array<[string, () => Promise<React.ReactNode> | React.ReactNode]> = [
  ['W315 platform', () => PlatformSync({ searchParams: {} })],
  ['W315 organisation', () => TenantSync({ params: { tenantSlug: SLUG }, searchParams: {} })],
  ['W3151 confirm', () => TenantSync({ params: { tenantSlug: SLUG }, searchParams: { discard: ID } })],
  ['W3152 success', () => PlatformSync({ searchParams: { done: 'discarded' } })],
  ['W3153 failure', () => TenantSync({ params: { tenantSlug: SLUG }, searchParams: { done: 'failed', discard: ID } })],
  ['/app error (W3137)', () => TenantApp({ params: { tenantSlug: SLUG }, searchParams: { install: 'error' } })],
  ['/app success (W3139)', () => TenantApp({ params: { tenantSlug: SLUG }, searchParams: { install: 'success' } })],
  ['the list', async () => <SyncListView chrome={PLATFORM_CHROME} state={{ kind: 'list' }} view={{ kind: 'ready', drafts: await (await phone()).visible(), now: NOW, expired: 1 }} labels={SYNC_LABELS} />],
  ['the confirm island', async () => <SyncListView chrome={tenantChrome(SLUG)} state={{ kind: 'confirm', id: ID }} view={{ kind: 'ready', drafts: await (await phone()).visible(), now: NOW, expired: 0 }} labels={SYNC_LABELS} />],
  ['the keeper', () => <DraftKeeperView kind="message" refId="r" state="restored" note={{ restored: '2 h', ask: true }} labels={KL} />],
  ['the chip', () => <DraftsChipView n={2} href="/sync" labels={{ chip: '{n} on this phone', aria: '{n}' }} />],
  ['W3138 the sheet', () => <InstallSheetView state="open" name="Anand" iconHref="/i.svg" labels={IL} appHref="/app" />],
  ['W3139 added', () => <InstallSheetView state="added" name="Anand" iconHref="/i.svg" labels={IL} appHref="/app" />],
  ['W3140 not added', () => <InstallSheetView state="notadded" name="Anand" iconHref="/i.svg" labels={IL} appHref="/app" />],
  ['the status line', () => <InstallStatusView view={{ kind: 'cannot' }} labels={{ notNow: 'n {date}', added: 'a', cannot: 'c' }} fmt={() => 'd'} />],
];
beforeEach(() => { reset(); C.flags = { storefront_install_prompt: true }; });

describe('STORE-6b · rtl', () => {
  it.each(STATES)('%s: no physical-direction class or style, no bare arrow', async (_n, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('in Hindi and Gujarati too', async () => {
    for (const l of ['hi', 'gu']) for (const i of [0, 1, 2, 3, 4, 5, 6]) {
      reset(); C.flags = { storefront_install_prompt: true }; withCookies({ kv_lang: l });
      const html = await rtl(await STATES[i][1]());
      expect(physical(html)).toEqual([]);
      expect(bareArrows(html)).toBe(0);
    }
  });
});
