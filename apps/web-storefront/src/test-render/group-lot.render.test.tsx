// apps/web-storefront/src/test-render/group-lot.render.test.tsx · PC-56 STORE-3c · C1 / C5 — canon W279 "Group lot" under the organisation:
//   • the badge + the status (all six × three languages); H1 "<product> — building a <target> <unit> lot"; "<count> farmers pledging" (a COUNT,
//     never a name); "Coordinated by <organisation> (coordination fee <bps as %>, shown, not hidden)"; progress from the SERVER's bps; the deadline;
//     "nothing was paid, nothing is owed" (TRUE with the deadline clock); the TRUE payout sentence;
//   • listed → the listing ("buy it as one purchase"); cancelled → the reason by its code + "See similar lots" (the group-lot facet); not found;
//   • the `group_lots` flag OFF → "this organisation does not run group lots"; error → Retry reload (W3089–W3091 DECOR — "Register interest"
//     refused by name); the platform /g/[id] is a door.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => jest.requireActual('./store3c-fixtures').C.token, requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store3c-fixtures').C.sessionTenant, hasSessionCookie: () => true }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store3c-fixtures').shell(s) }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantGroupLotPage from '../app/[tenantSlug]/g/[id]/page';
import PlatformGroupLotDoor from '../app/(platform)/g/[id]/page';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { C, reset, GROUP_LOT, LOT, LISTING, SLUG, FARMER } from './store3c-fixtures';
import { GROUP_LOT_STATUS_LIST } from '../features/store3c/group-lot';
import { STORE3C_REFUSALS } from '../features/store3c/refusals';

const page = async () => renderToStaticMarkup(await TenantGroupLotPage({ params: { tenantSlug: SLUG, id: LOT }, searchParams: {} }));
const CATS: Record<string, Record<string, string>> = { en, hi, gu };
beforeEach(() => { reset(); });

describe('STORE-3c · W279 the lot, from the public read', () => {
  it('badge + status; the H1; the pledger COUNT; the organisation + the fee as %; progress from the server\'s bps; the deadline; the true sentences', async () => {
    const h = await page();
    const tx = text(h);
    expect(h).toContain('data-kv-badge="group-lot"');
    expect(h).toContain('data-kv-chip="pledging"');
    expect(tx).toContain('Vanthali GG-20 Groundnut — building a 200 quintal lot');
    expect(tx).toContain('9 farmers pledging');
    expect(tx).toContain('Coordinated by Anand FPO (coordination fee 1.5%, shown, not hidden)');
    expect(tx).toContain('148 of 200 quintal pledged (74%)');
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-valuenow="74"');
    expect(h).toContain('style="width:74%"');
    expect(tx).toMatch(/Pledge deadline .+2026/);
    expect(tx).toContain('If the lot doesn’t fill by then it closes; nothing was paid, nothing is owed.');
    expect(tx).toContain(en['store3c.gl.payout']);
    expect(tx).not.toContain(FARMER);
    expect(h).not.toMatch(/coordinatorUserId|memberShortName|Phone/);
  });
  it.each(['en', 'hi', 'gu'])('%s: all six statuses labelled — never the raw enum', async (l) => {
    C.lang = l;
    for (const s of GROUP_LOT_STATUS_LIST) {
      C.lot = GROUP_LOT({ status: s, listingId: s === 'listed' ? LISTING : null });
      const tx = text(await page());
      expect([s, tx.includes(CATS[l][`store3c.gl.status.${s}`])]).toEqual([s, true]);
    }
  });
  it('listed → "buy it as one purchase" + the listing link; ready → the next step; sold / settled', async () => {
    C.lot = GROUP_LOT({ status: 'listed', listingId: LISTING, pledgedQuantity: '200.000', progressBps: 10000 });
    const h = await page();
    expect(text(h)).toContain('Listed — buy it as one purchase.');
    expect(h).toContain(`data-kv-listing="${LISTING}" href="/${SLUG}/listings/${LISTING}"`);
    expect(h).not.toContain('data-kv-unfilled=');
    C.lot = GROUP_LOT({ status: 'ready' });
    expect(text(await page())).toContain(en['store3c.gl.ready']);
    C.lot = GROUP_LOT({ status: 'settled' });
    expect(text(await page())).toContain(en['store3c.gl.settled']);
  });
  it('cancelled (the deadline clock, `target_missed`) → the reason by its code, never free text; "See similar lots" → the group-lot facet', async () => {
    C.lot = GROUP_LOT({ status: 'cancelled', cancelReasonCode: 'target_missed' });
    const h = await page();
    expect(h).toContain('data-kv-reason="target_missed"');
    expect(text(h)).toContain('This lot closed: the target was not reached by the deadline.');
    expect(h).toContain(`data-kv-similar="" href="/${SLUG}/search?saleType=group_lot"`);
  });
});

describe('STORE-3c · W279 off ≠ not found ≠ error; the refusals; the door', () => {
  it('the `group_lots` flag OFF → "this organisation does not run group lots", and no read', async () => {
    C.flags = { ...C.flags, group_lots: false };
    const h = await page();
    expect(h).toContain('data-kv-state="flag-off"');
    expect(text(h)).toContain('Anand FPO does not run group lots — nothing is broken.');
    expect(C.calls.filter((c) => c[0] === 'storefront.groupLot')).toEqual([]);
  });
  it('not found ≠ error (Retry reloads — W3089–W3091 DECOR)', async () => {
    C.lot = new SdkError('NOT_FOUND', 404, 'nf');
    expect(await page()).toContain('data-kv-state="not-found"');
    C.lot = new Error('down');
    const x = await page();
    expect(x).toContain('data-kv-state="error"');
    expect(x).toContain(`href="/${SLUG}/g/${LOT}" class="kv-btn" data-kv-retry="reload"`);
  });
  it('every W279 refusal is printed by name — "Register interest", indicative price, grading, verified quintals, pay-when-fills, verified-buyer, helpline', async () => {
    const h = await page();
    for (const r of STORE3C_REFUSALS.filter((x) => x.surfaces.includes('group'))) expect(h).toContain(`data-kv-refusal="${r.id}"`);
    expect(text(h)).not.toMatch(/Register interest —|Interested buyers so far|Full lot value/);
  });
  it('the platform /g/[id] is a door: a session → its store\'s lot; anonymous → "which store"', async () => {
    await expect(PlatformGroupLotDoor({ params: { id: LOT } })).rejects.toThrow(`REDIRECT /${SLUG}/g/${LOT}`);
    C.token = null;
    const h = renderToStaticMarkup(await PlatformGroupLotDoor({ params: { id: LOT } }));
    expect(h).toContain('data-kv-state="which-store"');
  });
});
