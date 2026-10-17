// apps/web-storefront/src/test-render/order-tracking.render.test.tsx · PC-56 STORE-SWEEP-b · C3 (founder D1 — canon W292 as a SECTION of the order page,
// HOTFIX-9 Q3) — THE REAL ORDER PAGE (`/<slug>/orders/[id]`) with its delivery section `#tracking`, right after "Where it stands":
//   • `logistics` ON + a shipment with events: the status chip, the milestones and their times, "a delivery partner is assigned", the attempt count, the
//     partner's reference — and a NOTE, a COORDINATE and a RIDER ID planted in the read (as a leaky API would send them) NEVER reach the markup;
//   • `riderAssigned` false → no assigned line (mutant M1 — the line printed anyway — turns this red);
//   • a `pending` shipment / none → "No journey updates yet";
//   • `logistics` OFF → "This organisation does not record deliveries here", and the read is never asked; the flag unreadable → said (never ON);
//   • the read failing → the section's own sentence while the REST of the order page renders (Law 12);
//   • the W292 refusals printed by name; no "Loading", no map, no person.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store3a-fixtures').cookieJar() }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: false }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3a-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => 't' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3a-fixtures');
  return {
    publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient,
    serverClient: () => {
      const c = f.serverClient();
      c.orders.tracking = async (id: string) => {
        f.C.calls.push(['orders.tracking', id]);
        const v = (f.C as unknown as { tracking: Record<string, unknown> }).tracking?.[id];
        if (v instanceof Error || v === undefined) throw new (jest.requireActual('@krishalaya/sdk-js').SdkError)('UNAVAILABLE', 503, 'down');
        return v;
      };
      return c;
    },
  };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantOrderPage from '../app/[tenantSlug]/orders/[id]/page';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text } from './store1b-harness';
import { C, reset, DETAIL, SLUG, OID } from './store3a-fixtures';
import { sweepRefusalKeys } from '../features/sweep/refusals';

const T = C as unknown as { tracking: Record<string, unknown> };
const RIDER = '0210f000-0000-7000-8000-00000000d41e';
const LEAKY = (over: Record<string, unknown> = {}) => ({
  orderId: OID.cod, status: 'confirmed', createdAt: '2026-10-15T11:42:00.000Z', completedAt: null,
  orderEvents: [{ fromStatus: 'placed', toStatus: 'confirmed', at: '2026-10-15T12:00:00.000Z', note: 'seller note: call before 9' }],
  shipment: { id: 's1', status: 'in_transit', riderUserId: RIDER, awbNo: 'AWB-77881', scheduledPickupAt: null, pickedUpAt: '2026-10-16T05:10:00.000Z', deliveredAt: null,
    riderAssigned: true, deliveryAttempts: 1, ...over },
  shipmentEvents: [
    { status: 'assigned', at: '2026-10-16T04:00:00.000Z', lat: null, lng: null, note: 'assigned to Vikram D.' },
    { status: 'picked_up', at: '2026-10-16T05:10:00.000Z', lat: 23.598765, lng: 72.369876, note: 'rider: gate code 4412' },
    { status: 'in_transit', at: '2026-10-16T07:00:00.000Z', lat: 23.612345, lng: 72.401234, note: null },
    { status: 'in_transit', at: '2026-10-16T08:30:00.000Z', lat: 23.701234, lng: 72.501234, note: 'ping near Kadi' },
  ],
});
const page = async (id: string) => renderToStaticMarkup(await TenantOrderPage({ params: { tenantSlug: SLUG, id }, searchParams: {} }));
const section = (h: string) => h.slice(h.indexOf('<section class="kv-order__section" aria-labelledby="tracking-h"'), h.indexOf('</section>', h.indexOf('kv-refused-tracking')) + 10);
beforeEach(() => { reset(); T.tracking = {}; C.orders[OID.cod] = DETAIL(OID.cod, { status: 'confirmed' }); });

describe('STORE-SWEEP-b · W292 the delivery section (logistics ON)', () => {
  it('the journey: the status chip, each milestone with its time, assigned (never who), the attempts, the partner\'s reference', async () => {
    C.flags = { ...C.flags, logistics: true }; T.tracking[OID.cod] = LEAKY();
    const h = await page(OID.cod); const s = section(h); const w = text(s);
    expect(h).toContain('id="tracking"');
    expect(s).toContain('data-kv-tracking="journey"');
    expect(s).toContain('data-kv-shipment="in_transit"');
    expect(w).toContain(`${en['sweep.tracking.statusLabel']} ${en['sweep.tracking.status.in_transit']}`);
    expect(s).toContain('data-kv-journey="3"');                                  // assigned · picked up · on the way (the ping folded in)
    for (const st of ['assigned', 'picked_up', 'in_transit']) expect(s).toContain(`data-kv-step="${st}"`);
    expect(s).toContain('dateTime="2026-10-16T05:10:00.000Z"');
    expect(s).not.toContain('2026-10-16T08:30:00.000Z');                         // a location ping is not a milestone
    expect(w).toContain(en['sweep.tracking.assigned']);
    expect(w).toContain('Delivery attempts that did not succeed: 1.');
    expect(w).toContain('The delivery partner\'s reference: AWB-77881');
    expect(C.calls).toContainEqual(['orders.tracking', OID.cod]);
  });
  it('a note, a coordinate or a rider id in the read NEVER reaches the page', async () => {
    C.flags = { ...C.flags, logistics: true }; T.tracking[OID.cod] = LEAKY();
    const h = await page(OID.cod);
    for (const leak of [RIDER, 'd41e', '23.598765', '72.369876', '23.7', '72.5', 'gate code', 'Vikram', 'Kadi', 'call before 9', 'seller note']) expect([leak, h.includes(leak)]).toEqual([leak, false]);
    expect(h).not.toMatch(/\blat\b|\blng\b|latitude|longitude/i);
  });
  it('riderAssigned false → no assigned line; no attempts → no count; no reference → none (no invented number)', async () => {
    C.flags = { ...C.flags, logistics: true }; T.tracking[OID.cod] = LEAKY({ riderAssigned: false, riderUserId: null, deliveryAttempts: 0, awbNo: null, status: 'pickup_scheduled' });
    const s = section(await page(OID.cod));
    expect(s).not.toContain('data-kv-assigned');
    expect(text(s)).not.toContain(en['sweep.tracking.assigned']);
    expect(s).not.toContain('data-kv-attempts');
    expect(s).not.toContain('data-kv-awb');
  });
  it('a pending shipment, or none yet → "No journey updates yet"', async () => {
    C.flags = { ...C.flags, logistics: true };
    T.tracking[OID.cod] = { ...LEAKY({ status: 'pending' }), shipmentEvents: [] };
    let s = section(await page(OID.cod));
    expect(s).toContain('data-kv-tracking="pending"');
    expect(text(s)).toContain(en['sweep.tracking.pending']);
    T.tracking[OID.cod] = { ...LEAKY(), shipment: null, shipmentEvents: [] };
    s = section(await page(OID.cod));
    expect(text(s)).toContain(en['sweep.tracking.pending']);
  });
  it('the read failing → the section\'s own sentence and a plain reload link; the REST of the order page renders', async () => {
    C.flags = { ...C.flags, logistics: true }; T.tracking[OID.cod] = new Error('down');
    const h = await page(OID.cod); const s = section(h);
    expect(s).toContain('data-kv-tracking="error"');
    expect(text(s)).toContain(en['sweep.tracking.error']);
    expect(s).toContain(`href="/${SLUG}/orders/${OID.cod}#tracking"`);
    expect(h).toContain('aria-labelledby="money-h"');                            // the money section is still there
    expect(h).toContain('aria-labelledby="where-h"');
    expect(h).not.toContain('store3a.detail.error');
  });
});

describe('STORE-SWEEP-b · W292 behind the organisation\'s `logistics` flag', () => {
  it('OFF → "This organisation does not record deliveries here"; the read is never asked; no "store settings"', async () => {
    C.flags = { ...C.flags, logistics: false }; T.tracking[OID.cod] = LEAKY();
    const s = section(await page(OID.cod));
    expect(s).toContain('data-kv-tracking="off"');
    expect(text(s)).toContain(en['sweep.tracking.off']);
    expect(C.calls.some((c) => c[0] === 'orders.tracking')).toBe(false);
    expect(s).not.toContain('data-kv-journey');
  });
  it('the flag unreadable (the flags read fails, or the key is absent) → said; never read as ON', async () => {
    C.flags = new Error('down'); T.tracking[OID.cod] = LEAKY();
    let s = section(await page(OID.cod));
    expect(s).toContain('data-kv-tracking="unknown"');
    expect(text(s)).toContain(en['sweep.tracking.unknown']);
    reset(); T.tracking = { [OID.cod]: LEAKY() }; C.orders[OID.cod] = DETAIL(OID.cod);
    s = section(await page(OID.cod));                                           // the fixture's flags carry no `logistics` key
    expect(s).toContain('data-kv-tracking="unknown"');
    expect(C.calls.some((c) => c[0] === 'orders.tracking')).toBe(false);
  });
  it('the W292 refusals printed by name in every state; no map, person, slot or "Loading" offered', async () => {
    for (const flags of [{ logistics: true }, { logistics: false }]) {
      reset(); T.tracking = { [OID.cod]: LEAKY() }; C.orders[OID.cod] = DETAIL(OID.cod); C.flags = { ...C.flags, ...flags };
      const s = section(await page(OID.cod)); const w = text(s);
      expect(s).toContain('data-kv-refused="tracking"');
      for (const k of sweepRefusalKeys('tracking')) expect([k, w.includes(en[k as keyof typeof en] as string)]).toEqual([k, true]);
      expect(w.replace(/<[^>]+>/g, '')).not.toMatch(/Loading…/);
    }
  });
  it('in Hindi: the section in Hindi', async () => {
    C.lang = 'hi'; C.flags = { ...C.flags, logistics: true }; T.tracking[OID.cod] = LEAKY();
    const w = text(section(await page(OID.cod)));
    expect(w).toContain(hi['sweep.tracking.title']);
    expect(w).toContain(hi['sweep.tracking.assigned']);
    expect(w).toContain(hi['sweep.tracking.status.in_transit']);
  });
});
